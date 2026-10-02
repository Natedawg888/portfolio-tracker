/**
 * BTC/USD + BTC/NZD FX for GoMining earnings display.
 * Primary: CoinGecko public simple/price.
 * Fallback: Coinbase spot (BTC-USD + BTC-NZD), or BTC-USD + Frankfurter USD→NZD.
 * Never invent FX — on total failure return unavailable with null prices.
 *
 * Docs:
 * - https://docs.coingecko.com/reference/simple-price
 * - https://docs.cloud.coinbase.com/sign-in-with-coinbase/docs/api-prices
 * - https://www.frankfurter.app/docs/ (api.frankfurter.dev)
 */

export type BtcFxStatus = 'ok' | 'unavailable';

export type BtcFxSource =
  | 'coingecko'
  | 'coinbase'
  | 'coinbase+frankfurter'
  | 'stub';

export interface BtcFxQuote {
  btcUsd: number | null;
  btcNzd: number | null;
  status: BtcFxStatus;
  source: BtcFxSource;
  asOf: string | null;
  message: string | null;
}

const CACHE_MS = 60_000;
const FETCH_MS = 12_000;

/** CoinGecko / some CDNs reject bare undici UA — identify as a local app. */
const UA = 'PortfolioTracker/1.0 (local NZD portfolio; +https://localhost)';

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,nzd';
const COINBASE_BTC_USD = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';
const COINBASE_BTC_NZD = 'https://api.coinbase.com/v2/prices/BTC-NZD/spot';
/** Current Frankfurter host (api.frankfurter.app → 301 to this). */
const FRANKFURTER_USD_NZD =
  'https://api.frankfurter.dev/v1/latest?from=USD&to=NZD';

let cache: { at: number; quote: BtcFxQuote } | null = null;

function positiveNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function unavailable(
  asOf: string,
  source: BtcFxSource,
  message: string,
): BtcFxQuote {
  return {
    btcUsd: null,
    btcNzd: null,
    status: 'unavailable',
    source,
    asOf,
    message,
  };
}

async function fetchJson(
  url: string,
  label: string,
): Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': UA,
      },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      const snippet = text.replace(/\s+/g, ' ').slice(0, 160);
      return {
        ok: false,
        detail: `${label} HTTP ${res.status}${snippet ? `: ${snippet}` : ''}`,
      };
    }
    try {
      return { ok: true, data: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, detail: `${label} returned non-JSON` };
    }
  } catch (err) {
    return {
      ok: false,
      detail: `${label} fetch failed: ${(err as Error).message}`,
    };
  }
}

async function fetchCoinGecko(): Promise<
  | { ok: true; btcUsd: number | null; btcNzd: number | null }
  | { ok: false; detail: string }
> {
  const r = await fetchJson(COINGECKO_URL, 'CoinGecko');
  if (!r.ok) return r;
  const data = r.data as { bitcoin?: { usd?: number; nzd?: number } };
  const btcUsd = positiveNum(data.bitcoin?.usd);
  const btcNzd = positiveNum(data.bitcoin?.nzd);
  if (btcUsd == null && btcNzd == null) {
    return { ok: false, detail: 'CoinGecko returned no BTC prices' };
  }
  return { ok: true, btcUsd, btcNzd };
}

async function fetchCoinbaseSpot(url: string, label: string): Promise<number | null> {
  const r = await fetchJson(url, label);
  if (!r.ok) return null;
  const data = r.data as { data?: { amount?: string } };
  return positiveNum(data.data?.amount);
}

async function fetchUsdToNzdFrankfurter(): Promise<number | null> {
  const r = await fetchJson(FRANKFURTER_USD_NZD, 'Frankfurter');
  if (!r.ok) return null;
  const data = r.data as { rates?: { NZD?: number } };
  return positiveNum(data.rates?.NZD);
}

/**
 * Fallback when CoinGecko fails or returns a partial pair.
 * Prefer Coinbase BTC-USD + BTC-NZD; else BTC-USD × Frankfurter USD→NZD.
 */
async function fetchFallback(
  preferUsd: number | null,
  preferNzd: number | null,
): Promise<
  | { ok: true; btcUsd: number; btcNzd: number; source: BtcFxSource; note: string }
  | { ok: false; detail: string }
> {
  let btcUsd = preferUsd;
  let btcNzd = preferNzd;
  const notes: string[] = [];

  if (btcUsd == null) {
    btcUsd = await fetchCoinbaseSpot(COINBASE_BTC_USD, 'Coinbase BTC-USD');
    if (btcUsd != null) notes.push('BTC/USD Coinbase');
  } else {
    notes.push('BTC/USD CoinGecko');
  }

  if (btcNzd == null) {
    btcNzd = await fetchCoinbaseSpot(COINBASE_BTC_NZD, 'Coinbase BTC-NZD');
    if (btcNzd != null) {
      notes.push('BTC/NZD Coinbase');
    } else if (btcUsd != null) {
      const usdNzd = await fetchUsdToNzdFrankfurter();
      if (usdNzd != null) {
        btcNzd = btcUsd * usdNzd;
        notes.push(`BTC/NZD via Frankfurter USD→NZD ${usdNzd}`);
      }
    }
  } else {
    notes.push('BTC/NZD CoinGecko');
  }

  if (btcUsd != null && btcNzd != null) {
    const usedFrankfurter = notes.some((n) => n.includes('Frankfurter'));
    const usedCoinbaseOnly =
      !notes.some((n) => n.includes('CoinGecko')) && !usedFrankfurter;
    const source: BtcFxSource = usedCoinbaseOnly
      ? 'coinbase'
      : usedFrankfurter
        ? 'coinbase+frankfurter'
        : 'coinbase';
    // If we mixed CoinGecko partial + Coinbase/Frankfurter, label honestly
    const mixed = notes.some((n) => n.includes('CoinGecko'));
    return {
      ok: true,
      btcUsd,
      btcNzd,
      source: mixed && usedFrankfurter ? 'coinbase+frankfurter' : mixed ? 'coinbase' : source,
      note: notes.join('; '),
    };
  }

  return {
    ok: false,
    detail: `Fallback incomplete (usd=${btcUsd ?? 'null'}, nzd=${btcNzd ?? 'null'}). ${notes.join('; ') || 'no sources'}`,
  };
}

export async function fetchBtcFx(force = false): Promise<BtcFxQuote> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return cache.quote;
  }

  const asOf = new Date().toISOString();
  const errors: string[] = [];

  const primary = await fetchCoinGecko();
  if (primary.ok && primary.btcUsd != null && primary.btcNzd != null) {
    const quote: BtcFxQuote = {
      btcUsd: primary.btcUsd,
      btcNzd: primary.btcNzd,
      status: 'ok',
      source: 'coingecko',
      asOf,
      message: 'Live FX from CoinGecko',
    };
    cache = { at: Date.now(), quote };
    return quote;
  }
  if (!primary.ok) {
    errors.push(primary.detail);
  } else {
    errors.push(
      `CoinGecko partial (usd=${primary.btcUsd ?? 'null'}, nzd=${primary.btcNzd ?? 'null'})`,
    );
  }

  const fb = await fetchFallback(
    primary.ok ? primary.btcUsd : null,
    primary.ok ? primary.btcNzd : null,
  );
  if (fb.ok) {
    const quote: BtcFxQuote = {
      btcUsd: fb.btcUsd,
      btcNzd: fb.btcNzd,
      status: 'ok',
      source: fb.source,
      asOf,
      message: `Live FX (fallback): ${fb.note}`,
    };
    cache = { at: Date.now(), quote };
    return quote;
  }
  errors.push(fb.detail);

  const quote = unavailable(
    asOf,
    'stub',
    `${errors.join(' · ')} — BTC FX unavailable (never invent).`,
  );
  cache = { at: Date.now(), quote };
  return quote;
}

/** Test helper — clears in-memory cache. */
export function clearBtcFxCache(): void {
  cache = null;
}
