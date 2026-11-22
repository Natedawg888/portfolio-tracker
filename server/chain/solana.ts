/**
 * Solana adapter (KAN-38): SOL and SPL token balances, and SOL history, over JSON-RPC
 * (CHAIN_SOLANA_RPC_URL; the public keyless endpoint otherwise, which is rate-limited).
 *
 * Balances:
 * - SOL: `getBalance` (lamports, 9 decimals).
 * - SPL: `getTokenAccountsByOwner` with jsonParsed encoding, for both the Token program and
 *   Token-2022. Amounts and decimals come from the chain; accounts with the same mint are
 *   summed and zero balances dropped. Token accounts don't carry a symbol, so known mints
 *   (knownSplTokens) get theirs and every other mint is labelled by its address, unpriced:
 *   nothing here can inflate net worth (pricing and spam hiding are KAN-39).
 * If the token call fails the SOL balance is still returned.
 *
 * History: `getSignaturesForAddress` (newest first, `before` = cursor) then `getTransaction`
 * (jsonParsed) for each, giving this address's SOL change. Failed transactions keep the fee
 * they paid; ones that moved no SOL and cost this address nothing are left out. The cursor is
 * the last signature looked at.
 *
 * Docs: https://solana.com/docs/rpc
 */
import { jsonRpc } from './http.ts';
import { NETWORK_CHAIN_INFO } from './networks.ts';
import type { ChainAsset, ChainBalance, ChainProvider, ChainTransaction, ProviderContext, TransactionPage } from './types.ts';

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/** Well-known SPL mints: symbol and name only (decimals always come from the chain). */
export const KNOWN_SPL_TOKENS: Readonly<Record<string, { symbol: string; name: string }>> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', name: 'USD Coin' },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', name: 'Tether USD' },
  So11111111111111111111111111111111111111112: { symbol: 'WSOL', name: 'Wrapped SOL' },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: { symbol: 'MSOL', name: 'Marinade staked SOL' },
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: { symbol: 'JITOSOL', name: 'Jito staked SOL' },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: 'JUP', name: 'Jupiter' },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: 'BONK', name: 'Bonk' },
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: { symbol: 'WIF', name: 'dogwifhat' },
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: { symbol: 'PYTH', name: 'Pyth Network' },
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': { symbol: 'RAY', name: 'Raydium' },
};

const SOL = NETWORK_CHAIN_INFO.solana.nativeAsset;
const BASE58_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** getTransaction calls per history page; the public RPC rate-limits hard. */
const MAX_HISTORY = 25;

type ParsedTokenAccount = {
  account?: { data?: { parsed?: { info?: { mint?: unknown; tokenAmount?: { amount?: unknown; decimals?: unknown } } } } };
};

/** Token asset for a mint: a known symbol, or the shortened mint. */
export function splAsset(mint: string, decimals: number): ChainAsset {
  const known = KNOWN_SPL_TOKENS[mint];
  const short = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  return { kind: 'token', symbol: known?.symbol ?? short, name: known?.name ?? `SPL token ${short}`, decimals, contract: mint };
}

/** Sum jsonParsed token accounts by mint; malformed and zero rows dropped. */
export function mapTokenAccounts(rows: readonly ParsedTokenAccount[]): ChainBalance[] {
  const byMint = new Map<string, { amount: bigint; decimals: number }>();
  for (const r of rows) {
    const info = r.account?.data?.parsed?.info;
    const mint = typeof info?.mint === 'string' ? info.mint : '';
    const amount = typeof info?.tokenAmount?.amount === 'string' ? info.tokenAmount.amount : '';
    const decimals = Number(info?.tokenAmount?.decimals);
    if (!BASE58_MINT.test(mint) || !/^\d+$/.test(amount) || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) continue;
    const prev = byMint.get(mint);
    byMint.set(mint, { amount: (prev?.amount ?? 0n) + BigInt(amount), decimals });
  }
  const out: ChainBalance[] = [];
  for (const [mint, { amount, decimals }] of byMint) {
    if (amount > 0n) out.push({ asset: splAsset(mint, decimals), amountRaw: amount.toString() });
  }
  return out.sort((a, b) => a.asset.symbol.localeCompare(b.asset.symbol));
}

type SignatureInfo = { signature?: string; blockTime?: number | null; err?: unknown; confirmationStatus?: string | null };
type ParsedTx = {
  blockTime?: number | null;
  meta?: { err?: unknown; fee?: number; preBalances?: number[]; postBalances?: number[] } | null;
  transaction?: { message?: { accountKeys?: Array<string | { pubkey?: string; signer?: boolean }> } };
};

/** One transaction's effect on this address in SOL. null when the address isn't in it. */
export function mapSolanaTx(address: string, sig: SignatureInfo, tx: ParsedTx | null): ChainTransaction | null {
  if (!sig.signature) return null;
  const keys = (tx?.transaction?.message?.accountKeys ?? []).map((k) => (typeof k === 'string' ? { pubkey: k, signer: false } : { pubkey: k.pubkey ?? '', signer: k.signer === true }));
  const i = keys.findIndex((k) => k.pubkey === address);
  const failed = sig.err != null || tx?.meta?.err != null;
  const time = sig.blockTime ?? tx?.blockTime ?? null;
  const pre = tx?.meta?.preBalances?.[i];
  const post = tx?.meta?.postBalances?.[i];
  if (i < 0 || pre == null || post == null) return null;
  const paidFee = i === 0 && keys[0]?.signer !== false;
  const fee = paidFee ? BigInt(tx?.meta?.fee ?? 0) : 0n;
  // The change without the fee is what moved; the fee is reported on its own.
  const moved = BigInt(post) - BigInt(pre) + fee;
  // Mentioned but nothing moved and no fee paid (e.g. an SPL-only transfer): not a SOL event.
  if (moved === 0n && !paidFee) return null;
  const direction: ChainTransaction['direction'] = moved > 0n ? 'in' : moved < 0n ? 'out' : 'self';
  return {
    hash: sig.signature,
    timestamp: time != null ? new Date(time * 1000).toISOString() : null,
    status: failed ? 'failed' : sig.confirmationStatus === 'processed' ? 'pending' : 'confirmed',
    direction,
    asset: SOL,
    amountRaw: (moved < 0n ? -moved : moved).toString(),
    feeRaw: paidFee ? fee.toString() : null,
    counterparty: null,
  };
}

async function tokenBalances(ctx: ProviderContext, address: string): Promise<ChainBalance[]> {
  const rows: ParsedTokenAccount[] = [];
  for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    const res = await jsonRpc<{ value?: ParsedTokenAccount[] }>(ctx.endpoint, 'getTokenAccountsByOwner', [address, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    rows.push(...(res?.value ?? []));
  }
  return mapTokenAccounts(rows);
}

export const solanaProvider: ChainProvider = {
  id: 'solana-rpc',
  label: 'Solana JSON-RPC',
  supports: (network) => network === 'solana',

  async getBalances(ctx, address) {
    const res = await jsonRpc<{ value?: number }>(ctx.endpoint, 'getBalance', [address, { commitment: 'confirmed' }]);
    const lamports = Number(res?.value);
    const balances: ChainBalance[] = [{ asset: SOL, amountRaw: Number.isFinite(lamports) && lamports >= 0 ? BigInt(Math.trunc(lamports)).toString() : '0' }];
    try {
      balances.push(...(await tokenBalances(ctx, address)));
    } catch (err) {
      // The SOL balance still stands; token discovery is retried on the next sync.
      console.warn(`[chain] solana token accounts failed for ${address}: ${err instanceof Error ? err.message : 'error'}`);
    }
    return balances;
  },

  async getTransactions(ctx, address, opts): Promise<TransactionPage> {
    const limit = Math.max(1, Math.min(MAX_HISTORY, Math.floor(opts.limit)));
    const sigs = await jsonRpc<SignatureInfo[]>(ctx.endpoint, 'getSignaturesForAddress', [address, { limit, ...(opts.cursor ? { before: opts.cursor } : {}), commitment: 'confirmed' }]);
    const list = Array.isArray(sigs) ? sigs.filter((s) => typeof s.signature === 'string') : [];
    const transactions: ChainTransaction[] = [];
    for (const sig of list) {
      const tx = await jsonRpc<ParsedTx | null>(ctx.endpoint, 'getTransaction', [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
      const mapped = mapSolanaTx(address, sig, tx);
      if (mapped) transactions.push(mapped);
    }
    const last = list[list.length - 1]?.signature ?? null;
    return { transactions, nextCursor: list.length === limit ? last : null };
  },
};
