/**
 * NZD valuation for on-chain wallet balances (KAN-40).
 *
 * Prices come from the existing crypto quote engine (server/quotes/crypto.ts):
 * CoinGecko NZD, else CoinGecko/Coinbase/Kraken USD × USD→NZD FX, cached in memory
 * and in price_quotes, with last-good reuse for up to 24 h. Never invents a price.
 *
 * Degradation rules (totals are never corrupted):
 * - An asset with no price is listed as `unpriced`, contributes 0, and marks the
 *   total `complete: false` — it is never guessed or carried as NaN.
 * - A price older than STALE_AFTER_MS is still used but flagged `stale` with its time.
 * - Tokens (ERC-20 / SPL) stay unpriced until asset normalisation (KAN-39) maps
 *   contracts to known assets — pricing by symbol would let spam tokens inflate totals.
 * - A wallet whose balance fetch fails is reported with its error and excluded.
 */
import type { QuoteResult } from '../../src/types/index.ts';
import { getCryptoQuoteNzd } from '../quotes/crypto.ts';
import { formatUnits } from './networks.ts';
import { fetchWalletBalances, type WalletRef } from './service.ts';
import { ChainProviderError, type ChainAsset, type ChainBalance } from './types.ts';
import { networkBlockedSec } from './rateLimit.ts';

/** Quotes older than this are flagged stale (crypto quote cache TTL is 10 min). */
export const STALE_AFTER_MS = 30 * 60 * 1000;
/**
 * In-memory reuse of chain balances. The sync job refreshes them (default every
 * 30 min), so page loads read what the last sync fetched instead of calling providers.
 * Memory only — balances are never persisted.
 */
const BALANCE_CACHE_MS = 35 * 60 * 1000;

export type PricedItem = {
  asset: ChainAsset;
  amountRaw: string;
  /** Human amount (decimal string, exact). */
  amount: string;
  status: 'priced' | 'stale' | 'unpriced';
  priceNzd: number | null;
  valueNzd: number | null;
  /** When the unit price was observed (ISO); null when unpriced. */
  pricedAt: string | null;
  priceSource: string | null;
  message: string | null;
};

export type Valuation = {
  currency: 'NZD';
  items: PricedItem[];
  /** Sum of priced + stale items only, rounded to cents. */
  totalNzd: number;
  /** False when any non-zero holding could not be priced. */
  complete: boolean;
  /** Oldest pricedAt among priced items — "valued as of" for the total. */
  pricedAt: string | null;
  hasStalePrices: boolean;
};

export type QuoteFn = (ticker: string) => Promise<QuoteResult>;

const roundCents = (n: number) => Math.round(n * 100) / 100;

function isZero(raw: string): boolean {
  return /^0+$/.test(raw);
}

/** Value balances in NZD. `quote` is injectable for tests. */
export async function valueBalancesNzd(
  balances: ChainBalance[],
  quote: QuoteFn = (t) => getCryptoQuoteNzd(t),
  now = Date.now(),
): Promise<Valuation> {
  // One quote per native symbol even if several balances share it.
  const symbols = [...new Set(balances.filter((b) => b.asset.kind === 'native').map((b) => b.asset.symbol))];
  const quotes = new Map<string, QuoteResult | Error>();
  await Promise.all(
    symbols.map(async (s) => {
      try {
        quotes.set(s, await quote(s));
      } catch (err) {
        quotes.set(s, err instanceof Error ? err : new Error(String(err)));
      }
    }),
  );

  const items: PricedItem[] = balances.map((b) => {
    const amount = formatUnits(b.amountRaw, b.asset.decimals);
    const base = { asset: b.asset, amountRaw: b.amountRaw, amount };
    const unpriced = (message: string): PricedItem => ({
      ...base,
      status: 'unpriced',
      priceNzd: null,
      valueNzd: null,
      pricedAt: null,
      priceSource: null,
      message,
    });

    if (b.asset.kind !== 'native') {
      return unpriced('Token prices arrive with asset normalisation; not counted in the total yet.');
    }
    const q = quotes.get(b.asset.symbol);
    if (!q || q instanceof Error) return unpriced(`No ${b.asset.symbol} price: quote lookup failed.`);
    const price = q.price;
    if (q.status !== 'ok' || price == null || !Number.isFinite(price) || price <= 0) {
      return unpriced(q.message ?? `No ${b.asset.symbol} price available right now.`);
    }
    const value = Number(amount) * price;
    if (!Number.isFinite(value)) return unpriced(`${b.asset.symbol} value could not be computed.`);
    const at = q.asOf ? Date.parse(q.asOf) : NaN;
    const stale = !Number.isFinite(at) || now - at > STALE_AFTER_MS;
    return {
      ...base,
      status: stale ? 'stale' : 'priced',
      priceNzd: price,
      valueNzd: roundCents(value),
      pricedAt: Number.isFinite(at) ? new Date(at).toISOString() : null,
      priceSource: q.source,
      message: stale ? (q.message ?? 'Using the last known price.') : null,
    };
  });

  const counted = items.filter((i) => i.valueNzd != null);
  const times = counted.map((i) => i.pricedAt).filter((t): t is string => Boolean(t)).sort();
  return {
    currency: 'NZD',
    items,
    totalNzd: roundCents(counted.reduce((s, i) => s + (i.valueNzd ?? 0), 0)),
    complete: items.every((i) => i.status !== 'unpriced' || isZero(i.amountRaw)),
    pricedAt: times[0] ?? null,
    hasStalePrices: items.some((i) => i.status === 'stale'),
  };
}

// --- wallets -------------------------------------------------------------------

export type WalletValuation =
  | ({ ok: true; fetchedAt: string } & Valuation)
  | { ok: false; error: string; code: string; retryAfterSec: number | null };

const balanceCache = new Map<string, { at: number; balances: ChainBalance[]; fetchedAt: string }>();
const inflight = new Map<string, Promise<{ balances: ChainBalance[]; fetchedAt: string }>>();

async function cachedBalances(wallet: WalletRef): Promise<{ balances: ChainBalance[]; fetchedAt: string }> {
  const key = `${wallet.network}:${wallet.address}`;
  const hit = balanceCache.get(key);
  if (hit && Date.now() - hit.at < BALANCE_CACHE_MS) return hit;
  const running = inflight.get(key);
  if (running) return running;
  const blocked = networkBlockedSec(wallet.network);
  if (blocked > 0) {
    // Respect the provider's back-off window rather than fetching on page load.
    throw new ChainProviderError('rate_limited', wallet.network, 'Provider is rate limited; showing no value until the next sync.', blocked);
  }
  const p = fetchWalletBalances(wallet)
    .then((snap) => {
      const entry = { at: Date.now(), balances: snap.balances, fetchedAt: snap.fetchedAt };
      balanceCache.set(key, entry);
      return entry;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Sync job hands over fresh balances so the next valuation needn't refetch. */
export function primeBalanceCache(wallet: WalletRef, balances: ChainBalance[], fetchedAt: string): void {
  balanceCache.set(`${wallet.network}:${wallet.address}`, { at: Date.now(), balances, fetchedAt });
}

export function clearWalletBalanceCache(): void {
  balanceCache.clear();
}

/** Live balances → NZD. Chain failures come back as `ok: false` (never thrown). */
export async function valueWallet(wallet: WalletRef, quote?: QuoteFn): Promise<WalletValuation> {
  try {
    const { balances, fetchedAt } = await cachedBalances(wallet);
    return { ok: true, fetchedAt, ...(await valueBalancesNzd(balances, quote)) };
  } catch (err) {
    if (err instanceof ChainProviderError) {
      return { ok: false, error: err.message, code: err.code, retryAfterSec: err.retryAfterSec };
    }
    return { ok: false, error: 'Wallet could not be valued right now.', code: 'upstream_error', retryAfterSec: null };
  }
}

export type PortfolioValuation = {
  currency: 'NZD';
  totalNzd: number;
  /** False when any wallet failed or any holding was unpriced. */
  complete: boolean;
  pricedAt: string | null;
  hasStalePrices: boolean;
  failedWallets: number;
};

/** Combine wallet valuations; failed wallets are excluded and mark the total incomplete. */
export function combineValuations(results: WalletValuation[]): PortfolioValuation {
  const ok = results.filter((r): r is Extract<WalletValuation, { ok: true }> => r.ok);
  const times = ok.map((r) => r.pricedAt).filter((t): t is string => Boolean(t)).sort();
  return {
    currency: 'NZD',
    totalNzd: roundCents(ok.reduce((s, r) => s + r.totalNzd, 0)),
    complete: ok.length === results.length && ok.every((r) => r.complete),
    pricedAt: times[0] ?? null,
    hasStalePrices: ok.some((r) => r.hasStalePrices),
    failedWallets: results.length - ok.length,
  };
}
