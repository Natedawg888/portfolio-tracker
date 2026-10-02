/**
 * Price history for portfolio cards (crypto / metal / stock).
 * Never invents prices — returns unavailable when sources fail.
 *
 * Sources:
 * - Crypto: CoinGecko market_chart (NZD); on fail/429 best-effort single-point from spot fallbacks
 * - Metals: Metals.Dev timeseries (USD/oz t) × Frankfurter USD→NZD;
 *           fallback Yahoo Finance COMEX futures (GC=F / SI=F / PL=F / PA=F) × Frankfurter
 * - Stocks: Yahoo Finance chart × Frankfurter when quote currency ≠ NZD
 */
import type { MetalKind } from '../../src/types/index.ts';
import { getMetalsApiKey, METAL_KINDS } from './metals.ts';
import { getCryptoQuoteNzd, resolveCoingeckoId, resolveCryptoTicker } from './crypto.ts';

export type HistoryRange = '1d' | '5d' | '1m' | '1y';

export type HistoryPoint = {
  /** ISO-8601 timestamp */
  at: string;
  /** Unit price in NZD (never invented) */
  price: number;
};

export type HistoryResult = {
  assetClass: 'crypto' | 'metal' | 'stock';
  range: HistoryRange;
  currency: 'NZD';
  unit: string;
  status: 'ok' | 'unavailable';
  source: string;
  points: HistoryPoint[];
  message: string | null;
  asOf: string | null;
};

const UA =
  'Mozilla/5.0 (compatible; PortfolioTracker/1.0; +http://127.0.0.1; local NZD portfolio)';
const FETCH_MS = 15_000;

const RANGE_MS: Record<HistoryRange, number> = {
  '1d': 1 * 24 * 60 * 60 * 1000,
  '5d': 5 * 24 * 60 * 60 * 1000,
  '1m': 31 * 24 * 60 * 60 * 1000,
  '1y': 366 * 24 * 60 * 60 * 1000,
};

const CACHE_TTL_MS: Record<HistoryRange, number> = {
  '1d': 15 * 60 * 1000,
  '5d': 30 * 60 * 1000,
  '1m': 2 * 60 * 60 * 1000,
  '1y': 12 * 60 * 60 * 1000,
};

type CacheEntry = { at: number; result: HistoryResult };
const cache = new Map<string, CacheEntry>();
/** Coalesce concurrent history fetches for the same cache key. */
const inflightHistory = new Map<string, Promise<HistoryResult>>();


function cacheGet(key: string, range: HistoryRange): HistoryResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS[range]) {
    cache.delete(key);
    return null;
  }
  return hit.result;
}

function cacheSet(key: string, result: HistoryResult): void {
  cache.set(key, { at: Date.now(), result });
}

function ymdUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function positiveNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchJson(
  url: string,
  label: string,
  init?: RequestInit,
): Promise<
  | { ok: true; data: unknown }
  | { ok: false; detail: string; rateLimited?: boolean }
> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        'User-Agent': UA,
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 429) {
        return {
          ok: false,
          detail: `${label} rate limit — try again in a few minutes.`,
          rateLimited: true,
        };
      }
      return {
        ok: false,
        detail: `${label} HTTP ${res.status}`,
        rateLimited: false,
      };
    }
    try {
      return { ok: true, data: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, detail: `${label} non-JSON` };
    }
  } catch (err) {
    return { ok: false, detail: `${label}: ${(err as Error).message}` };
  }
}

/** Frankfurter historical USD→NZD map (YYYY-MM-DD → rate). */
async function frankfurterUsdNzdMap(
  startYmd: string,
  endYmd: string,
): Promise<{ ok: true; rates: Map<string, number> } | { ok: false; detail: string }> {
  const url = `https://api.frankfurter.dev/v1/${startYmd}..${endYmd}?from=USD&to=NZD`;
  const r = await fetchJson(url, 'Frankfurter history');
  if (!r.ok) return r;
  const data = r.data as { rates?: Record<string, { NZD?: number }> };
  const map = new Map<string, number>();
  for (const [day, row] of Object.entries(data.rates ?? {})) {
    const nzd = positiveNum(row?.NZD);
    if (nzd != null) map.set(day, nzd);
  }
  if (map.size === 0) {
    return { ok: false, detail: 'Frankfurter returned no USD→NZD rates' };
  }
  return { ok: true, rates: map };
}

/** Latest Frankfurter USD→NZD (for intraday points on non-trading FX days). */
async function frankfurterUsdNzdLatest(): Promise<number | null> {
  const r = await fetchJson(
    'https://api.frankfurter.dev/v1/latest?from=USD&to=NZD',
    'Frankfurter latest',
  );
  if (!r.ok) return null;
  const nzd = positiveNum((r.data as { rates?: { NZD?: number } }).rates?.NZD);
  return nzd;
}

function nearestFx(
  day: string,
  rates: Map<string, number>,
  fallback: number | null,
): number | null {
  if (rates.has(day)) return rates.get(day)!;
  // Walk back up to 7 calendar days for weekends/holidays
  const d = new Date(`${day}T12:00:00Z`);
  for (let i = 1; i <= 7; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const k = ymdUTC(d);
    if (rates.has(k)) return rates.get(k)!;
  }
  return fallback;
}

function unavailable(
  assetClass: HistoryResult['assetClass'],
  range: HistoryRange,
  unit: string,
  source: string,
  message: string,
): HistoryResult {
  return {
    assetClass,
    range,
    currency: 'NZD',
    unit,
    status: 'unavailable',
    source,
    points: [],
    message,
    asOf: null,
  };
}

// ── Crypto (CoinGecko) ──────────────────────────────────────────────

const CG_DAYS: Record<HistoryRange, string> = {
  '1d': '1',
  '5d': '5',
  '1m': '30',
  '1y': '365',
};

export async function fetchCryptoHistory(
  ticker: string,
  range: HistoryRange,
): Promise<HistoryResult> {
  const t = ticker.trim().toUpperCase();
  const cacheKey = `crypto:${t}:${range}`;
  const cached = cacheGet(cacheKey, range);
  if (cached) return cached;

  const existing = inflightHistory.get(cacheKey);
  if (existing) return existing;

  const promise = fetchCryptoHistoryInner(t, range, cacheKey).finally(() => {
    inflightHistory.delete(cacheKey);
  });
  inflightHistory.set(cacheKey, promise);
  return promise;
}

async function fetchCryptoHistoryInner(
  t: string,
  range: HistoryRange,
  cacheKey: string,
): Promise<HistoryResult> {
  // Re-check cache after winning the coalesce race
  const cached = cacheGet(cacheKey, range);
  if (cached) return cached;

  if (!t) {
    return unavailable('crypto', range, 'unit', 'stub', 'Ticker required');
  }

  // Prefer id-only resolve so history does not also hit simple/price
  const idResolved = await resolveCoingeckoId(t);
  let cgId = idResolved.coingeckoId;
  if (!cgId) {
    const resolved = await resolveCryptoTicker(t, false);
    cgId = resolved.coingeckoId;
    if (!cgId) {
      const result = unavailable(
        'crypto',
        range,
        'unit',
        'stub',
        resolved.quote.message ??
          `No CoinGecko id for ${t} — history unavailable (never invent).`,
      );
      cacheSet(cacheKey, result);
      return result;
    }
  }

  const url =
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(cgId)}/market_chart` +
    `?vs_currency=nzd&days=${CG_DAYS[range]}`;
  const r = await fetchJson(url, 'CoinGecko');
  if (!r.ok) {
    // Keep a previous ok cache entry if present (even if TTL expired) on 429
    const staleHit = cache.get(cacheKey);
    if (
      r.rateLimited &&
      staleHit &&
      staleHit.result.status === 'ok' &&
      staleHit.result.points.length > 0
    ) {
      return {
        ...staleHit.result,
        message: `Cached history (CoinGecko rate limit) · ${staleHit.result.message ?? ''}`.trim(),
      };
    }
    // Best-effort: live spot (CoinGecko→Coinbase→Kraken→FX) as a single history point
    const spot = await getCryptoQuoteNzd(t, false);
    if (spot.status === 'ok' && spot.price != null && spot.asOf) {
      const result: HistoryResult = {
        assetClass: 'crypto',
        range,
        currency: 'NZD',
        unit: 'unit',
        status: 'ok',
        source: `spot:${spot.source}`,
        points: [{ at: spot.asOf, price: spot.price }],
        message: `History chart unavailable (${r.detail}) — showing live spot only (${spot.message ?? spot.source})`,
        asOf: spot.asOf,
      };
      cacheSet(cacheKey, result);
      return result;
    }
    const result = unavailable(
      'crypto',
      range,
      'unit',
      'coingecko',
      `${r.detail} · spot fallback also unavailable.`,
    );
    cacheSet(cacheKey, result);
    return result;
  }

  const prices = (r.data as { prices?: Array<[number, number]> }).prices ?? [];
  const points: HistoryPoint[] = [];
  for (const row of prices) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const ts = row[0];
    const px = positiveNum(row[1]);
    if (typeof ts !== 'number' || px == null) continue;
    points.push({ at: new Date(ts).toISOString(), price: px });
  }

  if (points.length === 0) {
    const result = unavailable(
      'crypto',
      range,
      'unit',
      'coingecko',
      `CoinGecko returned no NZD prices for ${cgId}`,
    );
    cacheSet(cacheKey, result);
    return result;
  }

  const result: HistoryResult = {
    assetClass: 'crypto',
    range,
    currency: 'NZD',
    unit: 'unit',
    status: 'ok',
    source: `coingecko:${cgId}`,
    points,
    message: `CoinGecko market_chart NZD (${cgId})`,
    asOf: points[points.length - 1]!.at,
  };
  cacheSet(cacheKey, result);
  return result;
}

// ── Metals ──────────────────────────────────────────────────────────

const METAL_YAHOO: Record<MetalKind, string> = {
  gold: 'GC=F',
  silver: 'SI=F',
  platinum: 'PL=F',
  palladium: 'PA=F',
};

type MetalsDevRates = Record<
  string,
  { metals?: Record<string, number>; date?: string }
>;

async function metalsDevTimeseriesChunk(
  apiKey: string,
  startYmd: string,
  endYmd: string,
): Promise<{ ok: true; rates: MetalsDevRates } | { ok: false; detail: string }> {
  const url = new URL('https://api.metals.dev/v1/timeseries');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('start_date', startYmd);
  url.searchParams.set('end_date', endYmd);
  url.searchParams.set('unit', 'toz');
  const r = await fetchJson(url.toString(), 'Metals.Dev timeseries');
  if (!r.ok) return r;
  const data = r.data as { status?: string; rates?: MetalsDevRates; error_message?: string };
  if (data.status === 'failure' || !data.rates) {
    return {
      ok: false,
      detail: data.error_message ?? 'Metals.Dev timeseries failure',
    };
  }
  return { ok: true, rates: data.rates };
}

/** Metals.Dev timeseries is USD + max 30 days — chunk + Frankfurter → NZD/oz t. */
async function fetchMetalHistoryMetalsDev(
  metal: MetalKind,
  range: HistoryRange,
): Promise<HistoryResult | null> {
  const apiKey = getMetalsApiKey();
  if (!apiKey) return null;

  const end = new Date();
  const start = new Date(end.getTime() - RANGE_MS[range]);
  // For 1d, still pull a few calendar days so weekends have prior closes
  const startPad = range === '1d' ? new Date(end.getTime() - 3 * 86400000) : start;

  const chunks: Array<{ start: string; end: string }> = [];
  let cursor = new Date(startPad);
  while (cursor < end) {
    const chunkStart = ymdUTC(cursor);
    const chunkEndDate = new Date(cursor);
    chunkEndDate.setUTCDate(chunkEndDate.getUTCDate() + 29);
    if (chunkEndDate > end) chunkEndDate.setTime(end.getTime());
    const chunkEnd = ymdUTC(chunkEndDate);
    chunks.push({ start: chunkStart, end: chunkEnd });
    cursor = new Date(chunkEndDate);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  // Cap API burn: for 1y allow up to 13 chunks; fail soft if any hard error after partial
  const usdByDay = new Map<string, number>();
  const errors: string[] = [];
  for (const c of chunks) {
    const chunk = await metalsDevTimeseriesChunk(apiKey, c.start, c.end);
    if (!chunk.ok) {
      errors.push(chunk.detail);
      continue;
    }
    for (const [day, row] of Object.entries(chunk.rates)) {
      const raw = positiveNum(row.metals?.[metal]);
      if (raw != null) usdByDay.set(day, raw);
    }
  }

  if (usdByDay.size === 0) {
    return unavailable(
      'metal',
      range,
      'oz_t',
      'metals_dev',
      errors[0] ?? `Metals.Dev timeseries had no ${metal} prices`,
    );
  }

  const fxStart = [...usdByDay.keys()].sort()[0]!;
  const fxEnd = ymdUTC(end);
  const fx = await frankfurterUsdNzdMap(fxStart, fxEnd);
  const latestFx = await frankfurterUsdNzdLatest();
  if (!fx.ok && latestFx == null) {
    return unavailable(
      'metal',
      range,
      'oz_t',
      'metals_dev',
      `Metals.Dev USD history ok but Frankfurter USD→NZD failed — not inventing FX (${fx.ok === false ? fx.detail : 'no rates'})`,
    );
  }
  const rates = fx.ok ? fx.rates : new Map<string, number>();

  const cutoff = end.getTime() - RANGE_MS[range];
  const points: HistoryPoint[] = [];
  for (const day of [...usdByDay.keys()].sort()) {
    const usd = usdByDay.get(day)!;
    const nzdRate = nearestFx(day, rates, latestFx);
    if (nzdRate == null) continue;
    const atMs = Date.parse(`${day}T12:00:00Z`);
    if (!Number.isFinite(atMs) || atMs < cutoff - 86400000) continue;
    points.push({
      at: new Date(atMs).toISOString(),
      price: usd * nzdRate,
    });
  }

  if (points.length === 0) {
    return unavailable(
      'metal',
      range,
      'oz_t',
      'metals_dev',
      `No convertible NZD points for ${metal}`,
    );
  }

  return {
    assetClass: 'metal',
    range,
    currency: 'NZD',
    unit: 'oz_t',
    status: 'ok',
    source: 'metals_dev+frankfurter',
    points,
    message: `Metals.Dev timeseries USD/oz t × Frankfurter USD→NZD (${metal})`,
    asOf: points[points.length - 1]!.at,
  };
}

/** Yahoo COMEX futures history → NZD/oz via Frankfurter (free fallback). */
async function fetchMetalHistoryYahoo(
  metal: MetalKind,
  range: HistoryRange,
): Promise<HistoryResult> {
  const symbol = METAL_YAHOO[metal];
  const yahoo = await fetchYahooChart(symbol, range);
  if (!yahoo.ok) {
    return unavailable('metal', range, 'oz_t', 'yahoo', yahoo.detail);
  }
  if (yahoo.currency !== 'USD') {
    // Unexpected — still try if NZD already
    if (yahoo.currency === 'NZD') {
      return {
        assetClass: 'metal',
        range,
        currency: 'NZD',
        unit: 'oz_t',
        status: 'ok',
        source: `yahoo:${symbol}`,
        points: yahoo.points,
        message: `Yahoo Finance ${symbol} (already NZD)`,
        asOf: yahoo.points.at(-1)?.at ?? null,
      };
    }
  }

  const converted = await convertPointsUsdToNzd(yahoo.points);
  if (!converted.ok) {
    return unavailable('metal', range, 'oz_t', 'yahoo+frankfurter', converted.detail);
  }
  return {
    assetClass: 'metal',
    range,
    currency: 'NZD',
    unit: 'oz_t',
    status: 'ok',
    source: `yahoo:${symbol}+frankfurter`,
    points: converted.points,
    message: `Yahoo Finance ${symbol} futures USD × Frankfurter → NZD/oz (not LBMA spot)`,
    asOf: converted.points.at(-1)?.at ?? null,
  };
}

export async function fetchMetalHistory(
  metal: MetalKind,
  range: HistoryRange,
): Promise<HistoryResult> {
  if (!METAL_KINDS.includes(metal)) {
    return unavailable('metal', range, 'oz_t', 'stub', `Unknown metal ${metal}`);
  }
  const cacheKey = `metal:${metal}:${range}`;
  const cached = cacheGet(cacheKey, range);
  if (cached) return cached;

  // Prefer Metals.Dev when keyed; fall back to Yahoo futures (honest label).
  let result: HistoryResult | null = null;
  if (getMetalsApiKey()) {
    // 1y metals.dev burns ~12 free-tier calls — use Yahoo for 1y to preserve quota
    if (range === '1y') {
      result = await fetchMetalHistoryYahoo(metal, range);
      if (result.status !== 'ok') {
        const md = await fetchMetalHistoryMetalsDev(metal, range);
        if (md && md.status === 'ok') result = md;
      }
    } else {
      result = await fetchMetalHistoryMetalsDev(metal, range);
      if (!result || result.status !== 'ok') {
        const y = await fetchMetalHistoryYahoo(metal, range);
        if (y.status === 'ok') {
          result = {
            ...y,
            message:
              (result?.message ? `${result.message} · ` : '') +
              `Fallback: ${y.message}`,
          };
        } else if (!result) {
          result = y;
        }
      }
    }
  } else {
    result = await fetchMetalHistoryYahoo(metal, range);
    if (result.status === 'ok') {
      result = {
        ...result,
        message:
          `${result.message} · METALS_API_KEY unset (spot still needs key; chart uses Yahoo futures)`,
      };
    } else {
      result = unavailable(
        'metal',
        range,
        'oz_t',
        'stub',
        'Metal history unavailable — set METALS_API_KEY for Metals.Dev timeseries, or Yahoo futures failed. Never invent.',
      );
    }
  }

  cacheSet(cacheKey, result);
  return result;
}

// ── Stocks (Yahoo Finance) ──────────────────────────────────────────

const YAHOO_RANGE: Record<HistoryRange, { range: string; interval: string }> = {
  '1d': { range: '1d', interval: '5m' },
  '5d': { range: '5d', interval: '1h' },
  '1m': { range: '1mo', interval: '1d' },
  '1y': { range: '1y', interval: '1d' },
};

type YahooChartOk = {
  ok: true;
  currency: string;
  points: HistoryPoint[];
};
type YahooChartFail = { ok: false; detail: string };

async function fetchYahooChart(
  symbol: string,
  range: HistoryRange,
): Promise<YahooChartOk | YahooChartFail> {
  const { range: yr, interval } = YAHOO_RANGE[range];
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${yr}&interval=${interval}&includePrePost=false`;
  const r = await fetchJson(url, `Yahoo ${symbol}`);
  if (!r.ok) return r;
  const chart = r.data as {
    chart?: {
      result?: Array<{
        meta?: { currency?: string; symbol?: string };
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
      error?: { description?: string };
    };
  };
  const result = chart.chart?.result?.[0];
  if (!result) {
    return {
      ok: false,
      detail: chart.chart?.error?.description ?? `Yahoo: no chart for ${symbol}`,
    };
  }
  const ts = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const points: HistoryPoint[] = [];
  for (let i = 0; i < ts.length; i++) {
    const px = positiveNum(closes[i]);
    if (px == null) continue;
    points.push({ at: new Date(ts[i]! * 1000).toISOString(), price: px });
  }
  if (points.length === 0) {
    return { ok: false, detail: `Yahoo ${symbol}: no close prices` };
  }
  return {
    ok: true,
    currency: (result.meta?.currency ?? 'USD').toUpperCase(),
    points,
  };
}

async function convertPointsUsdToNzd(
  points: HistoryPoint[],
): Promise<
  | { ok: true; points: HistoryPoint[] }
  | { ok: false; detail: string }
> {
  if (points.length === 0) {
    return { ok: false, detail: 'No points to convert' };
  }
  const days = points.map((p) => p.at.slice(0, 10)).sort();
  const fx = await frankfurterUsdNzdMap(days[0]!, days[days.length - 1]!);
  const latestFx = await frankfurterUsdNzdLatest();
  if (!fx.ok && latestFx == null) {
    return {
      ok: false,
      detail: `Frankfurter USD→NZD failed — not inventing FX`,
    };
  }
  const rates = fx.ok ? fx.rates : new Map<string, number>();
  const out: HistoryPoint[] = [];
  for (const p of points) {
    const day = p.at.slice(0, 10);
    const nzdRate = nearestFx(day, rates, latestFx);
    if (nzdRate == null) continue;
    out.push({ at: p.at, price: p.price * nzdRate });
  }
  if (out.length === 0) {
    return { ok: false, detail: 'No points after FX conversion' };
  }
  return { ok: true, points: out };
}

/** Normalize equity ticker for Yahoo (NZX → .NZ, ASX → .AX when exchange hints). */
export function yahooEquitySymbol(
  ticker: string,
  exchange?: string | null,
): string {
  const raw = ticker.trim().toUpperCase();
  if (!raw) return raw;
  // Already has exchange suffix
  if (/\.(NZ|AX|L|TO|HK|T|DE|PA|MI|AS|OL|ST|CO|HE|LS|SS|SZ)$/i.test(raw)) {
    return raw;
  }
  // Strip .US / NYSE-style noise Yahoo doesn't want
  let symbol = raw.replace(/\.(US|NYSE|NASDAQ|AMEX)$/i, '');
  const ex = (exchange ?? '').toUpperCase();
  if (ex.includes('NZX') || ex === 'NZ') return `${symbol}.NZ`;
  if (ex.includes('ASX') || ex === 'AU') return `${symbol}.AX`;
  if (ex.includes('LSE') || ex === 'LON' || ex === 'UK') return `${symbol}.L`;
  return symbol;
}

export async function fetchStockHistory(
  ticker: string,
  range: HistoryRange,
  exchange?: string | null,
): Promise<HistoryResult> {
  const t = ticker.trim().toUpperCase();
  const yahooSym = yahooEquitySymbol(t, exchange);
  const cacheKey = `stock:${yahooSym}:${range}`;
  const cached = cacheGet(cacheKey, range);
  if (cached) return cached;

  if (!t) {
    return unavailable('stock', range, 'share', 'stub', 'Ticker required');
  }

  const yahoo = await fetchYahooChart(yahooSym, range);
  if (!yahoo.ok) {
    // Try .NZ suffix for bare NZ tickers when exchange unknown
    if (!yahooSym.includes('.') && !exchange) {
      const nz = await fetchYahooChart(`${yahooSym}.NZ`, range);
      if (nz.ok) {
        const result = await finalizeStock(nz, range, `${yahooSym}.NZ`);
        cacheSet(cacheKey, result);
        return result;
      }
    }
    const result = unavailable(
      'stock',
      range,
      'share',
      'yahoo',
      `${yahoo.detail} — equity history unavailable (never invent).`,
    );
    cacheSet(cacheKey, result);
    return result;
  }

  const result = await finalizeStock(yahoo, range, yahooSym);
  cacheSet(cacheKey, result);
  return result;
}

async function finalizeStock(
  yahoo: YahooChartOk,
  range: HistoryRange,
  symbol: string,
): Promise<HistoryResult> {
  if (yahoo.currency === 'NZD') {
    return {
      assetClass: 'stock',
      range,
      currency: 'NZD',
      unit: 'share',
      status: 'ok',
      source: `yahoo:${symbol}`,
      points: yahoo.points,
      message: `Yahoo Finance ${symbol} (NZD)`,
      asOf: yahoo.points.at(-1)?.at ?? null,
    };
  }
  if (yahoo.currency !== 'USD') {
    // AUD etc. — try Frankfurter from that currency
    const converted = await convertPointsToNzd(yahoo.points, yahoo.currency);
    if (!converted.ok) {
      return unavailable(
        'stock',
        range,
        'share',
        `yahoo+frankfurter`,
        `Yahoo ${symbol} is ${yahoo.currency}; FX to NZD failed — not inventing (${converted.detail})`,
      );
    }
    return {
      assetClass: 'stock',
      range,
      currency: 'NZD',
      unit: 'share',
      status: 'ok',
      source: `yahoo:${symbol}+frankfurter`,
      points: converted.points,
      message: `Yahoo Finance ${symbol} ${yahoo.currency} × Frankfurter → NZD`,
      asOf: converted.points.at(-1)?.at ?? null,
    };
  }
  const converted = await convertPointsUsdToNzd(yahoo.points);
  if (!converted.ok) {
    return unavailable(
      'stock',
      range,
      'share',
      'yahoo+frankfurter',
      converted.detail,
    );
  }
  return {
    assetClass: 'stock',
    range,
    currency: 'NZD',
    unit: 'share',
    status: 'ok',
    source: `yahoo:${symbol}+frankfurter`,
    points: converted.points,
    message: `Yahoo Finance ${symbol} USD × Frankfurter → NZD`,
    asOf: converted.points.at(-1)?.at ?? null,
  };
}

async function convertPointsToNzd(
  points: HistoryPoint[],
  fromCurrency: string,
): Promise<
  | { ok: true; points: HistoryPoint[] }
  | { ok: false; detail: string }
> {
  if (fromCurrency === 'NZD') return { ok: true, points };
  if (fromCurrency === 'USD') return convertPointsUsdToNzd(points);
  if (points.length === 0) return { ok: false, detail: 'No points' };
  const days = points.map((p) => p.at.slice(0, 10)).sort();
  const url =
    `https://api.frankfurter.dev/v1/${days[0]}..${days[days.length - 1]}` +
    `?from=${encodeURIComponent(fromCurrency)}&to=NZD`;
  const r = await fetchJson(url, `Frankfurter ${fromCurrency}→NZD`);
  if (!r.ok) return r;
  const data = r.data as { rates?: Record<string, { NZD?: number }> };
  const map = new Map<string, number>();
  for (const [day, row] of Object.entries(data.rates ?? {})) {
    const nzd = positiveNum(row?.NZD);
    if (nzd != null) map.set(day, nzd);
  }
  const latestR = await fetchJson(
    `https://api.frankfurter.dev/v1/latest?from=${encodeURIComponent(fromCurrency)}&to=NZD`,
    'Frankfurter latest',
  );
  let latest: number | null = null;
  if (latestR.ok) {
    latest = positiveNum((latestR.data as { rates?: { NZD?: number } }).rates?.NZD);
  }
  if (map.size === 0 && latest == null) {
    return { ok: false, detail: `No ${fromCurrency}→NZD rates` };
  }
  const out: HistoryPoint[] = [];
  for (const p of points) {
    const day = p.at.slice(0, 10);
    const rate = nearestFx(day, map, latest);
    if (rate == null) continue;
    out.push({ at: p.at, price: p.price * rate });
  }
  if (out.length === 0) return { ok: false, detail: 'No points after FX' };
  return { ok: true, points: out };
}

export function parseHistoryRange(raw: unknown): HistoryRange | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === '1d' || s === 'day') return '1d';
  if (s === '5d' || s === '5day' || s === '5days') return '5d';
  if (s === '1m' || s === '1mo' || s === 'month') return '1m';
  if (s === '1y' || s === '1yr' || s === 'year') return '1y';
  return null;
}

export function clearHistoryCache(): void {
  cache.clear();
  inflightHistory.clear();
}
