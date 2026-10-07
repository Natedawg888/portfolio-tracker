/**
 * EVM adapter (KAN-36: Ethereum; KAN-37 extends `supports` to Polygon / Base / Arbitrum).
 *
 * Native balance: `eth_getBalance` at `latest` over JSON-RPC (CHAIN_<NETWORK>_RPC_URL).
 *
 * ERC-20 discovery + balances: plain JSON-RPC can't list the tokens an address holds,
 * so they come from a Blockscout API v2 indexer (CHAIN_<NETWORK>_INDEXER_URL, default
 * public eth.blockscout.com): /addresses/:a/tokens?type=ERC-20, 50 per page, capped.
 * Zero balances, malformed rows and tokens Blockscout flags as scam are dropped;
 * symbols/names are sanitised (spam tokens put URLs and junk there). Tokens stay
 * unpriced in valuation until KAN-39, so nothing here can inflate net worth.
 * If discovery fails the native balance is still returned (logged, not thrown).
 *
 * History: native transactions from /addresses/:a/transactions (newest first). The
 * cursor is the Blockscout page params of the page we stopped in plus how many of its
 * items were already returned, so any `limit` pages correctly.
 *
 * Docs: https://docs.blockscout.com/devs/apis/rest
 */
import { WALLET_NETWORKS, toChecksumAddress, type WalletNetwork } from '../lib/walletAddress.ts';
import { resolveIndexerEndpoint, type ChainEndpoint } from './config.ts';
import { getJson, jsonRpc } from './http.ts';
import { NETWORK_CHAIN_INFO } from './networks.ts';
import {
  ChainProviderError,
  type ChainAsset,
  type ChainBalance,
  type ChainProvider,
  type ChainTransaction,
  type ProviderContext,
  type TransactionPage,
} from './types.ts';

/** Networks this adapter serves. KAN-37 adds polygon, base, arbitrum. */
export const EVM_ADAPTER_NETWORKS: readonly WalletNetwork[] = ['ethereum'];

/** Blockscout pages are 50 items; 4 pages = 200 tokens is plenty for a personal wallet. */
const MAX_TOKEN_PAGES = 4;
/** Upstream pages per history call (50 each) — covers the service max limit of 100. */
const MAX_HISTORY_PAGES = 3;
const MAX_DECIMALS = 77; // uint256 max has 78 digits

type PageParams = Record<string, string | number>;

type BlockscoutToken = {
  address_hash?: string;
  address?: string; // older Blockscout versions
  type?: string;
  symbol?: string | null;
  name?: string | null;
  decimals?: string | null;
  reputation?: string | null;
};
type BlockscoutTokenRow = { token?: BlockscoutToken; value?: string | null };
type BlockscoutTx = {
  hash: string;
  from?: { hash?: string } | null;
  to?: { hash?: string } | null;
  created_contract?: { hash?: string } | null;
  value?: string | null;
  fee?: { value?: string | null } | null;
  status?: string | null; // 'ok' | 'error' | null (pending)
  result?: string | null; // 'success' | 'pending' | error text
  timestamp?: string | null;
};
type Page<T> = { items?: T[]; next_page_params?: PageParams | null };

function indexer(network: WalletNetwork): ChainEndpoint {
  const r = resolveIndexerEndpoint(network);
  if (!r.ok) {
    const label = WALLET_NETWORKS[network].label;
    throw new ChainProviderError('not_configured', network, `${label} token indexer is not configured: ${r.reason}`);
  }
  return r.endpoint;
}

function withParams(path: string, params: PageParams | null | undefined, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams(extra);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  }
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

function addressPath(address: string, suffix: string): string {
  return `addresses/${encodeURIComponent(address)}/${suffix}`;
}

/** Strip control / bidi / zero-width characters and collapse whitespace; spam tokens abuse these. */
export function cleanLabel(raw: string | null | undefined, max: number): string {
  const s = (raw ?? '')
    .replace(/\s+/g, ' ') // newlines / tabs become spaces first so words don't run together
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function hexToDecimal(hex: unknown): string {
  if (typeof hex !== 'string' || !/^0x[0-9a-f]*$/i.test(hex)) throw new Error('eth_getBalance returned a non-hex value');
  return BigInt(hex === '0x' ? '0x0' : hex).toString();
}

/** One Blockscout token row → a balance, or null when it should be dropped. */
export function mapTokenRow(row: BlockscoutTokenRow): ChainBalance | null {
  const t = row.token;
  if (!t || t.type !== 'ERC-20') return null;
  if (t.reputation === 'scam') return null;
  const contract = t.address_hash ?? t.address ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) return null;
  const value = row.value ?? '';
  if (!/^\d+$/.test(value) || /^0+$/.test(value)) return null;
  const decimals = Number(t.decimals);
  if (t.decimals == null || !Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) return null;
  const symbol = cleanLabel(t.symbol, 24) || 'ERC20';
  const asset: ChainAsset = {
    kind: 'token',
    symbol,
    name: cleanLabel(t.name, 64) || symbol,
    decimals,
    contract: toChecksumAddress(contract.slice(2)),
  };
  return { asset, amountRaw: value.replace(/^0+(?=\d)/, '') };
}

export async function discoverErc20Balances(network: WalletNetwork, address: string): Promise<ChainBalance[]> {
  const endpoint = indexer(network);
  const out = new Map<string, ChainBalance>();
  let params: PageParams | null = null;
  for (let page = 0; page < MAX_TOKEN_PAGES; page++) {
    const res: Page<BlockscoutTokenRow> = await getJson(
      endpoint,
      withParams(addressPath(address, 'tokens'), params, { type: 'ERC-20' }),
    );
    if (!res || !Array.isArray(res.items)) throw new Error('Blockscout token list response has no items');
    for (const row of res.items) {
      const b = mapTokenRow(row);
      if (b?.asset.contract && !out.has(b.asset.contract)) out.set(b.asset.contract, b);
    }
    params = res.next_page_params ?? null;
    if (!params) break;
  }
  return [...out.values()];
}

export async function getEvmBalances(ctx: ProviderContext, address: string): Promise<ChainBalance[]> {
  const nativeAsset = NETWORK_CHAIN_INFO[ctx.network].nativeAsset;
  const [weiHex, tokens] = await Promise.all([
    jsonRpc<string>(ctx.endpoint, 'eth_getBalance', [address, 'latest']),
    discoverErc20Balances(ctx.network, address).catch((err: unknown) => {
      // Tokens are unpriced until KAN-39, so a missing token list never changes a total —
      // keep the native balance rather than failing the whole wallet.
      const detail = err instanceof Error ? err.message : String(err);
      console.warn(`[chain] ${ctx.network} token discovery failed; native balance only: ${detail}`);
      return [] as ChainBalance[];
    }),
  ]);
  return [{ asset: nativeAsset, amountRaw: hexToDecimal(weiHex) }, ...tokens];
}

/** Map one Blockscout transaction to the wallet's point of view (native value only). */
export function mapBlockscoutTx(tx: BlockscoutTx, address: string, asset: ChainAsset): ChainTransaction {
  const me = address.toLowerCase();
  const from = tx.from?.hash?.toLowerCase() ?? null;
  const to = (tx.to?.hash ?? tx.created_contract?.hash)?.toLowerCase() ?? null;
  const direction: ChainTransaction['direction'] =
    from === me && to === me ? 'self' : from === me ? 'out' : 'in';
  const value = /^\d+$/.test(tx.value ?? '') ? String(tx.value) : '0';
  const fee = tx.fee?.value && /^\d+$/.test(tx.fee.value) ? tx.fee.value : null;
  const pending = !tx.status || tx.result === 'pending';
  const counterpartyRaw = direction === 'out' ? (tx.to?.hash ?? tx.created_contract?.hash) : direction === 'in' ? tx.from?.hash : null;
  return {
    hash: tx.hash,
    timestamp: !pending && tx.timestamp ? new Date(tx.timestamp).toISOString() : null,
    status: pending ? 'pending' : tx.status === 'error' ? 'failed' : 'confirmed',
    direction,
    asset,
    // A failed tx moves no value; the sender still pays gas.
    amountRaw: tx.status === 'error' || direction === 'self' ? '0' : value,
    feeRaw: from === me ? fee : null,
    counterparty: counterpartyRaw ?? null,
  };
}

type HistoryCursor = { p: PageParams | null; skip: number };

function encodeCursor(c: HistoryCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): HistoryCursor {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as HistoryCursor;
    const flat = (v: unknown) => typeof v === 'string' || typeof v === 'number';
    if (
      c &&
      Number.isInteger(c.skip) &&
      c.skip >= 0 &&
      (c.p === null || (typeof c.p === 'object' && Object.values(c.p).every(flat)))
    ) {
      return c;
    }
  } catch {
    /* fall through */
  }
  throw new Error('Invalid EVM history cursor');
}

export async function getEvmTransactions(
  ctx: ProviderContext,
  address: string,
  opts: { cursor?: string | null; limit: number },
): Promise<TransactionPage> {
  const endpoint = indexer(ctx.network);
  const asset = NETWORK_CHAIN_INFO[ctx.network].nativeAsset;
  const start = opts.cursor?.trim() ? decodeCursor(opts.cursor.trim()) : { p: null, skip: 0 };

  const out: ChainTransaction[] = [];
  let params = start.p;
  let skip = start.skip;
  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const res: Page<BlockscoutTx> = await getJson(endpoint, withParams(addressPath(address, 'transactions'), params));
    if (!res || !Array.isArray(res.items)) throw new Error('Blockscout history response has no items');
    const items = res.items.slice(skip);
    const room = opts.limit - out.length;
    out.push(...items.slice(0, room).map((t) => mapBlockscoutTx(t, address, asset)));
    if (items.length > room) {
      // Stopped mid-page: resume from this same page, past what we returned.
      return { transactions: out, nextCursor: encodeCursor({ p: params, skip: skip + room }) };
    }
    const next = res.next_page_params ?? null;
    if (!next) return { transactions: out, nextCursor: null };
    params = next;
    skip = 0;
    if (out.length >= opts.limit) break;
  }
  return { transactions: out, nextCursor: encodeCursor({ p: params, skip: 0 }) };
}

export const evmProvider: ChainProvider = {
  id: 'evm-rpc-blockscout',
  label: 'EVM (JSON-RPC + Blockscout)',
  supports: (network) => EVM_ADAPTER_NETWORKS.includes(network),
  getBalances: getEvmBalances,
  getTransactions: getEvmTransactions,
};
