/**
 * Live FX → NZD for Akahu (and other) holdings.
 * Primary: Frankfurter (ECB) https://api.frankfurter.dev
 * USD fallback: BTC FX path (CoinGecko / Coinbase / Frankfurter via fetchBtcFx)
 *   usdNzd = btcNzd / btcUsd when both sides are live.
 * Never invent rates — return unavailable/null on failure.
 *
 * Docs:
 * - https://www.frankfurter.app/docs/ (api.frankfurter.dev v1 latest)
 * - server/quotes/btc.ts (existing BTC FX path)
 */
import { fetchBtcFx } from './btc.ts';

export type FxToNzdStatus = 'ok' | 'unavailable';

export type FxToNzdSource =
  | 'frankfurter'
  | 'btc_fx_ratio'
  | 'identity'
  | 'unavailable';

export type FxToNzdQuote = {
  fromCurrency: string;
  rate: number | null;
  status: FxToNzdStatus;
  source: FxToNzdSource;
  asOf: string | null;
  message: string | null;
};

export type ConvertToNzdResult = {
  nzd: number;
  rate: number;
  fromCurrency: string;
  source: FxToNzdSource;
  asOf: string;
  message: string;
};

const CACHE_MS = 60_000;
const FETCH_MS = 12_000;
const UA = 'PortfolioTracker/1.0 (local NZD portfolio; +https://localhost)';

/** v1 latest still used by metals/btc; reliable for from→NZD. */
function frankfurterUrl(from: string): string {
  return `https://api.frankfurter.dev/v1/latest?from=${encodeURIComponent(from)}&to=NZD`;
}

const rateCache = new Map<string, { at: number; quote: FxToNzdQuote }>();

function positiveNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function unavailable(from: string, message: string, asOf = new Date().toISOString()): FxToNzdQuote {
  return {
    fromCurrency: from,
    rate: null,
    status: 'unavailable',
    source: 'unavailable',
    asOf,
    message,
  };
}

async function fetchFrankfurterRate(from: string): Promise<FxToNzdQuote> {
  const asOf = new Date().toISOString();
  try {
    const res = await fetch(frankfurterUrl(from), {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      return unavailable(
        from,
        `Frankfurter HTTP ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 120)}`,
        asOf,
      );
    }
    const data = JSON.parse(text) as { rates?: { NZD?: number }; date?: string };
    const rate = positiveNum(data.rates?.NZD);
    if (rate == null) {
      return unavailable(from, 'Frankfurter returned no NZD rate', asOf);
    }
    return {
      fromCurrency: from,
      rate,
      status: 'ok',
      source: 'frankfurter',
      asOf: data.date ? `${data.date}T00:00:00.000Z` : asOf,
      message: `Frankfurter ${from}→NZD ${rate}`,
    };
  } catch (err) {
    return unavailable(from, `Frankfurter fetch failed: ${(err as Error).message}`, asOf);
  }
}

/** USD→NZD via existing BTC FX path when both BTC/USD and BTC/NZD are live. */
async function fetchUsdNzdViaBtcFx(): Promise<FxToNzdQuote> {
  const asOf = new Date().toISOString();
  const btc = await fetchBtcFx();
  if (btc.status !== 'ok' || btc.btcUsd == null || btc.btcNzd == null) {
    return unavailable(
      'USD',
      btc.message ?? 'BTC FX unavailable for USD→NZD ratio',
      asOf,
    );
  }
  const rate = btc.btcNzd / btc.btcUsd;
  if (!Number.isFinite(rate) || rate <= 0) {
    return unavailable('USD', 'BTC FX ratio invalid', asOf);
  }
  return {
    fromCurrency: 'USD',
    rate,
    status: 'ok',
    source: 'btc_fx_ratio',
    asOf: btc.asOf ?? asOf,
    message: `USD→NZD via BTC FX (${btc.source}): BTC/NZD ${btc.btcNzd} ÷ BTC/USD ${btc.btcUsd} = ${rate}`,
  };
}

/**
 * Live rate for 1 unit of `fromCurrency` in NZD.
 * NZD → identity 1. Never invents.
 */
export async function fetchFxToNzd(
  fromCurrency: string,
  force = false,
): Promise<FxToNzdQuote> {
  const from = (fromCurrency || '').trim().toUpperCase();
  if (!from) return unavailable('?', 'Currency missing');
  if (from === 'NZD') {
    return {
      fromCurrency: 'NZD',
      rate: 1,
      status: 'ok',
      source: 'identity',
      asOf: new Date().toISOString(),
      message: 'NZD identity',
    };
  }

  if (!force) {
    const hit = rateCache.get(from);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.quote;
  }

  let quote = await fetchFrankfurterRate(from);
  if (quote.status !== 'ok' && from === 'USD') {
    const fb = await fetchUsdNzdViaBtcFx();
    if (fb.status === 'ok') quote = fb;
    else {
      quote = unavailable(
        'USD',
        `Frankfurter failed (${quote.message}); BTC FX fallback failed (${fb.message})`,
      );
    }
  }

  rateCache.set(from, { at: Date.now(), quote });
  return quote;
}

/** Convert amount in `fromCurrency` to NZD using live FX. Null if FX unavailable. */
export async function convertToNzd(
  amount: number,
  fromCurrency: string,
  force = false,
): Promise<ConvertToNzdResult | null> {
  if (!Number.isFinite(amount)) return null;
  const fx = await fetchFxToNzd(fromCurrency, force);
  if (fx.status !== 'ok' || fx.rate == null) return null;
  return {
    nzd: amount * fx.rate,
    rate: fx.rate,
    fromCurrency: fx.fromCurrency,
    source: fx.source,
    asOf: fx.asOf ?? new Date().toISOString(),
    message: fx.message ?? `${fx.fromCurrency}→NZD @ ${fx.rate}`,
  };
}

/** Prefetch several currencies (deduped). */
export async function prefetchFxToNzd(
  currencies: string[],
  force = false,
): Promise<Map<string, FxToNzdQuote>> {
  const unique = [...new Set(currencies.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  const map = new Map<string, FxToNzdQuote>();
  await Promise.all(
    unique.map(async (c) => {
      map.set(c, await fetchFxToNzd(c, force));
    }),
  );
  return map;
}

/** Test helper. */
export function clearFxCache(): void {
  rateCache.clear();
}

/* --- Any → any convert (Value Search currency exchanger) --- */

export type FxPairSource = FxToNzdSource | 'cross_via_nzd';

export type FxPairQuote = {
  fromCurrency: string;
  toCurrency: string;
  rate: number | null;
  status: FxToNzdStatus;
  source: FxPairSource;
  asOf: string | null;
  message: string | null;
  amount: number | null;
  converted: number | null;
};

const pairCache = new Map<string, { at: number; quote: FxPairQuote }>();

function frankfurterPairUrl(from: string, to: string): string {
  return `https://api.frankfurter.dev/v1/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

function pairUnavailable(
  from: string,
  to: string,
  message: string,
  amount: number | null = null,
  asOf = new Date().toISOString(),
): FxPairQuote {
  return {
    fromCurrency: from,
    toCurrency: to,
    rate: null,
    status: 'unavailable',
    source: 'unavailable',
    asOf,
    message,
    amount,
    converted: null,
  };
}

async function fetchFrankfurterPair(from: string, to: string): Promise<FxPairQuote> {
  const asOf = new Date().toISOString();
  try {
    const res = await fetch(frankfurterPairUrl(from, to), {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      return pairUnavailable(
        from,
        to,
        `Frankfurter HTTP ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 120)}`,
        null,
        asOf,
      );
    }
    const data = JSON.parse(text) as {
      rates?: Record<string, number>;
      date?: string;
      amount?: number;
      base?: string;
    };
    const rate = positiveNum(data.rates?.[to]);
    if (rate == null) {
      return pairUnavailable(from, to, `Frankfurter returned no ${to} rate`, null, asOf);
    }
    return {
      fromCurrency: from,
      toCurrency: to,
      rate,
      status: 'ok',
      source: 'frankfurter',
      asOf: data.date ? `${data.date}T00:00:00.000Z` : asOf,
      message: `Frankfurter ${from}→${to} ${rate}`,
      amount: null,
      converted: null,
    };
  } catch (err) {
    return pairUnavailable(
      from,
      to,
      `Frankfurter fetch failed: ${(err as Error).message}`,
      null,
      asOf,
    );
  }
}

/**
 * Live rate for 1 unit of `fromCurrency` in `toCurrency`.
 * Uses Frankfurter any→any. Identity when from===to.
 * USD→NZD keeps BTC FX ratio fallback (same as fetchFxToNzd).
 * Never invents rates.
 */
export async function fetchFxPair(
  fromCurrency: string,
  toCurrency: string,
  force = false,
): Promise<FxPairQuote> {
  const from = (fromCurrency || '').trim().toUpperCase();
  const to = (toCurrency || '').trim().toUpperCase();
  if (!from || from.length !== 3) {
    return pairUnavailable(from || '?', to || '?', 'from must be a 3-letter ISO currency');
  }
  if (!to || to.length !== 3) {
    return pairUnavailable(from, to || '?', 'to must be a 3-letter ISO currency');
  }

  if (from === to) {
    return {
      fromCurrency: from,
      toCurrency: to,
      rate: 1,
      status: 'ok',
      source: 'identity',
      asOf: new Date().toISOString(),
      message: `${from} identity`,
      amount: null,
      converted: null,
    };
  }

  const cacheKey = `${from}->${to}`;
  if (!force) {
    const hit = pairCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.quote;
  }

  // Prefer dedicated NZD path (includes USD BTC fallback) when converting to NZD.
  if (to === 'NZD') {
    const nzd = await fetchFxToNzd(from, force);
    const quote: FxPairQuote = {
      fromCurrency: nzd.fromCurrency,
      toCurrency: 'NZD',
      rate: nzd.rate,
      status: nzd.status,
      source: nzd.source,
      asOf: nzd.asOf,
      message: nzd.message,
      amount: null,
      converted: null,
    };
    pairCache.set(cacheKey, { at: Date.now(), quote });
    return quote;
  }

  let quote = await fetchFrankfurterPair(from, to);

  // If Frankfurter fails for a non-NZD target, try via NZD when both legs are live
  // (still never invent — only real rates).
  if (quote.status !== 'ok') {
    const fromNzd = await fetchFxToNzd(from, force);
    const toNzd = await fetchFxToNzd(to, force);
    if (
      fromNzd.status === 'ok' &&
      toNzd.status === 'ok' &&
      fromNzd.rate != null &&
      toNzd.rate != null &&
      toNzd.rate > 0
    ) {
      const rate = fromNzd.rate / toNzd.rate;
      if (Number.isFinite(rate) && rate > 0) {
        quote = {
          fromCurrency: from,
          toCurrency: to,
          rate,
          status: 'ok',
          source: 'cross_via_nzd',
          asOf: fromNzd.asOf ?? toNzd.asOf ?? new Date().toISOString(),
          message: `${from}→${to} via NZD: (${from}→NZD ${fromNzd.rate} [${fromNzd.source}]) ÷ (${to}→NZD ${toNzd.rate} [${toNzd.source}]) = ${rate}`,
          amount: null,
          converted: null,
        };
      }
    }
  }

  pairCache.set(cacheKey, { at: Date.now(), quote });
  return quote;
}

/** Convert amount from→to using live FX. Never invents. */
export async function convertFxPair(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  force = false,
): Promise<FxPairQuote> {
  const base = await fetchFxPair(fromCurrency, toCurrency, force);
  if (!Number.isFinite(amount) || amount < 0) {
    return {
      ...base,
      amount: null,
      converted: null,
      message: base.message ?? 'Invalid amount',
    };
  }
  if (base.status !== 'ok' || base.rate == null) {
    return { ...base, amount, converted: null };
  }
  return {
    ...base,
    amount,
    converted: amount * base.rate,
    message:
      base.message ??
      `${amount} ${base.fromCurrency} → ${amount * base.rate} ${base.toCurrency} @ ${base.rate}`,
  };
}

/** Test helper — clears pair cache. */
export function clearFxPairCache(): void {
  pairCache.clear();
}

/** Clears NZD-rate cache and any→any pair cache. */
export function clearAllFxCaches(): void {
  clearFxCache();
  clearFxPairCache();
}
