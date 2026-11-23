/**
 * Bitcoin adapter (KAN-35) — Esplora REST (blockstream.info / mempool.space / self-hosted).
 *
 * Balance: confirmed only (chain_stats funded − spent), so net worth doesn't swing
 * with unconfirmed mempool activity; pending txs still show in history as `pending`.
 *
 * History: Esplora returns mempool txs + 25 confirmed on /address/:a/txs, then
 * 25 per page from /address/:a/txs/chain/:last_seen_txid. Our cursor is the last
 * confirmed txid returned. Pending txs are only included on the first page.
 *
 * Extended public keys (KAN-68): a wallet can be an xpub / ypub / zpub. Its receive and change
 * addresses are derived (xpub.ts) and scanned up to the gap limit (20 unused in a row). Balance
 * = sum of confirmed balances; history = each used address's recent txs merged and deduped by
 * txid, with in/out/self worked out against the whole address set, so change back to the wallet
 * isn't an "out". The scan is cached for 10 minutes. The key is never logged; errors name
 * derived addresses only.
 *
 * Docs: https://github.com/Blockstream/esplora/blob/master/API.md
 */
import { createHash } from 'node:crypto';
import { getJson } from './http.ts';
import { parseExtendedPublicKey, scanUsedAddresses, type ExtendedPublicKey } from './xpub.ts';
import { NETWORK_CHAIN_INFO } from './networks.ts';
import type {
  ChainBalance,
  ChainProvider,
  ChainTransaction,
  ProviderContext,
  TransactionPage,
} from './types.ts';

/** Esplora fixed page size for confirmed history. */
const ESPLORA_CHAIN_PAGE = 25;
/** Safety cap on upstream page fetches per call (25 × 4 = 100 = service max limit). */
const MAX_UPSTREAM_PAGES = 4;

type EsploraStats = { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
type EsploraAddress = { chain_stats: EsploraStats; mempool_stats: EsploraStats };

type EsploraTx = {
  txid: string;
  fee?: number;
  status: { confirmed: boolean; block_time?: number };
  vin: Array<{ is_coinbase?: boolean; prevout: { scriptpubkey_address?: string; value: number } | null }>;
  vout: Array<{ scriptpubkey_address?: string; value: number }>;
};

const BTC = NETWORK_CHAIN_INFO.bitcoin.nativeAsset;

function addressPath(address: string, suffix = ''): string {
  return `address/${encodeURIComponent(address)}${suffix}`;
}

/** Used addresses of an extended key with their stats, cached by a hash of the key. */
const SCAN_TTL_MS = 10 * 60 * 1000;
const scanCache = new Map<string, { at: number; used: { address: string; stats: EsploraStats }[] }>();
const keyId = (xpub: string) => createHash('sha256').update(xpub).digest('hex');

export function clearXpubScanCacheForTest(): void {
  scanCache.clear();
}

async function scanXpub(ctx: ProviderContext, xpub: string, key: ExtendedPublicKey): Promise<{ address: string; stats: EsploraStats }[]> {
  const id = keyId(xpub);
  const hit = scanCache.get(id);
  if (hit && Date.now() - hit.at < SCAN_TTL_MS) return hit.used;
  const found = await scanUsedAddresses(key, async (address) => {
    const info = await getJson<EsploraAddress>(ctx.endpoint, addressPath(address));
    const chain = info?.chain_stats;
    const pool = info?.mempool_stats;
    if (!chain || !Number.isFinite(chain.funded_txo_sum) || !Number.isFinite(chain.spent_txo_sum)) {
      throw new Error(`Esplora address response missing chain_stats for ${address}`);
    }
    return { used: Number(chain.tx_count ?? 0) + Number(pool?.tx_count ?? 0) > 0, data: chain };
  });
  const used = found.map((f) => ({ address: f.address, stats: f.data }));
  scanCache.set(id, { at: Date.now(), used });
  return used;
}

export async function getBitcoinBalances(ctx: ProviderContext, address: string): Promise<ChainBalance[]> {
  const xkey = parseExtendedPublicKey(address);
  if (xkey) {
    const used = await scanXpub(ctx, address, xkey);
    const total = used.reduce((s, u) => s + (BigInt(u.stats.funded_txo_sum) - BigInt(u.stats.spent_txo_sum)), 0n);
    return [{ asset: BTC, amountRaw: (total < 0n ? 0n : total).toString() }];
  }
  const info = await getJson<EsploraAddress>(ctx.endpoint, addressPath(address));
  const stats = info?.chain_stats;
  if (!stats || !Number.isFinite(stats.funded_txo_sum) || !Number.isFinite(stats.spent_txo_sum)) {
    throw new Error('Esplora address response missing chain_stats');
  }
  const confirmed = BigInt(stats.funded_txo_sum) - BigInt(stats.spent_txo_sum);
  return [{ asset: BTC, amountRaw: (confirmed < 0n ? 0n : confirmed).toString() }];
}

/**
 * Map one Esplora tx to the wallet's point of view.
 * - in:   wallet funded no inputs → amount = value received
 * - out:  wallet funded inputs → amount = value that left the wallet, excluding the fee
 *         when the wallet paid all inputs (so the fee is fully ours and shown in feeRaw)
 * - self: wallet funded every input and received every output → amount 0, fee only
 * Coinjoin-style partial funding: amount = net change, fee unknown (null).
 */
export function mapEsploraTx(tx: EsploraTx, owned: string | ReadonlySet<string>): ChainTransaction {
  const own = (a: string | undefined) => (typeof owned === 'string' ? a === owned : a != null && owned.has(a));
  let sent = 0n;
  let inputsAllOurs = tx.vin.length > 0;
  let foreignInput: string | null = null;
  for (const vin of tx.vin) {
    const prev = vin.prevout;
    if (prev && own(prev.scriptpubkey_address)) {
      sent += BigInt(prev.value);
    } else {
      inputsAllOurs = false;
      foreignInput ??= prev?.scriptpubkey_address ?? null;
    }
  }
  let received = 0n;
  let foreignOutput: string | null = null;
  let hasForeignOutput = false;
  for (const vout of tx.vout) {
    if (own(vout.scriptpubkey_address)) {
      received += BigInt(vout.value);
    } else if (vout.value > 0 || vout.scriptpubkey_address) {
      hasForeignOutput = true;
      foreignOutput ??= vout.scriptpubkey_address ?? null;
    }
  }
  const fee = BigInt(tx.fee ?? 0);
  const ourFee = sent > 0n && inputsAllOurs ? fee : null;

  let direction: ChainTransaction['direction'];
  let amount: bigint;
  let counterparty: string | null;
  if (sent === 0n) {
    direction = 'in';
    amount = received;
    counterparty = foreignInput;
  } else if (inputsAllOurs && !hasForeignOutput) {
    direction = 'self';
    amount = 0n;
    counterparty = null;
  } else {
    const net = sent - received - (ourFee ?? 0n);
    if (net >= 0n) {
      direction = 'out';
      amount = net;
      counterparty = foreignOutput;
    } else {
      direction = 'in'; // e.g. coinjoin where we gained
      amount = -net;
      counterparty = foreignInput;
    }
  }

  return {
    hash: tx.txid,
    timestamp:
      tx.status.confirmed && tx.status.block_time
        ? new Date(tx.status.block_time * 1000).toISOString()
        : null,
    status: tx.status.confirmed ? 'confirmed' : 'pending',
    direction,
    asset: BTC,
    amountRaw: amount.toString(),
    feeRaw: ourFee === null ? null : ourFee.toString(),
    counterparty,
  };
}

export async function getBitcoinTransactions(
  ctx: ProviderContext,
  address: string,
  opts: { cursor?: string | null; limit: number },
): Promise<TransactionPage> {
  const xkey = parseExtendedPublicKey(address);
  if (xkey) return getXpubTransactions(ctx, address, xkey, opts.limit);
  const cursor = opts.cursor?.trim() || null;
  if (cursor && !/^[0-9a-f]{64}$/i.test(cursor)) throw new Error('Invalid Bitcoin history cursor');

  const pending: EsploraTx[] = [];
  const confirmed: EsploraTx[] = [];
  let last = cursor;
  let exhausted = false;

  for (let page = 0; page < MAX_UPSTREAM_PAGES && confirmed.length < opts.limit; page++) {
    const first = page === 0 && !cursor;
    const batch = await getJson<EsploraTx[]>(
      ctx.endpoint,
      first ? addressPath(address, '/txs') : addressPath(address, `/txs/chain/${last ?? ''}`),
    );
    if (!Array.isArray(batch)) throw new Error('Esplora history response is not a list');
    const chainTxs = batch.filter((t) => t.status?.confirmed);
    if (first) pending.push(...batch.filter((t) => !t.status?.confirmed));
    confirmed.push(...chainTxs);
    if (chainTxs.length < ESPLORA_CHAIN_PAGE) {
      exhausted = true;
      break;
    }
    last = chainTxs[chainTxs.length - 1].txid;
  }

  const kept = confirmed.slice(0, opts.limit);
  const more = !exhausted || confirmed.length > kept.length;
  return {
    transactions: [...pending, ...kept].map((t) => mapEsploraTx(t, address)),
    nextCursor: more && kept.length > 0 ? kept[kept.length - 1].txid : null,
  };
}

/**
 * History for an extended key: the latest page of each used address, merged and deduped by
 * txid, newest first (pending first), mapped against the whole address set. One page only:
 * deeper history per address isn't followed (nextCursor is null).
 */
async function getXpubTransactions(ctx: ProviderContext, xpub: string, key: ExtendedPublicKey, limit: number): Promise<TransactionPage> {
  const used = await scanXpub(ctx, xpub, key);
  const owned = new Set(used.map((u) => u.address));
  const byId = new Map<string, EsploraTx>();
  for (const u of used) {
    const batch = await getJson<EsploraTx[]>(ctx.endpoint, addressPath(u.address, '/txs'));
    if (!Array.isArray(batch)) throw new Error(`Esplora history response is not a list for ${u.address}`);
    for (const t of batch) if (t?.txid && !byId.has(t.txid)) byId.set(t.txid, t);
  }
  const txs = [...byId.values()].sort((a, b) => {
    if (a.status?.confirmed !== b.status?.confirmed) return a.status?.confirmed ? 1 : -1;
    return (b.status?.block_time ?? 0) - (a.status?.block_time ?? 0);
  });
  return { transactions: txs.slice(0, Math.max(1, limit)).map((t) => mapEsploraTx(t, owned)), nextCursor: null };
}

export const bitcoinProvider: ChainProvider = {
  id: 'bitcoin-esplora',
  label: 'Bitcoin (Esplora)',
  supports: (network) => network === 'bitcoin',
  getBalances: getBitcoinBalances,
  getTransactions: getBitcoinTransactions,
};
