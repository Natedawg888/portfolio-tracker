/**
 * Published cash dividends from the Yahoo Finance chart this app already uses
 * for equity prices (query1.finance.yahoo.com/v8/finance/chart).
 * Reads events.dividends only. Never fills in an amount, date, or yield.
 */
import { logger } from '../lib/logger.ts';
import { isYmd } from '../dividends/model.ts';
import { yahooEquitySymbol } from './history.ts';

export type YahooDividendPayment = {
  date: string;
  amountPerShare: number;
};

export type YahooDividendChart = {
  currency: string;
  yahooSymbol: string;
  instrumentType: string | null;
  payments: YahooDividendPayment[];
};

const UA =
  'Mozilla/5.0 (compatible; PortfolioTracker/1.0; +http://127.0.0.1; local NZD portfolio)';
const FETCH_MS = 15_000;
const OK_TTL_MS = 12 * 60 * 60 * 1000;
const FAIL_TTL_MS = 5 * 60 * 1000;
const ALLOWED_INSTRUMENTS = new Set(['EQUITY', 'ETF']);

type CacheEntry = { at: number; ttl: number; value: YahooDividendChart | null };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<YahooDividendChart | null>>();

export function clearYahooDividendCache(): void {
  cache.clear();
  inflight.clear();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function positiveAmount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Calendar date of a Yahoo dividend timestamp in the exchange zone the chart names. */
export function ymdInTimeZone(unixSeconds: number, timeZone: string | null): string | null {
  if (!Number.isFinite(unixSeconds)) return null;
  const dt = new Date(unixSeconds * 1000);
  if (Number.isNaN(dt.getTime())) return null;
  const zone = timeZone && timeZone.trim() ? timeZone.trim() : 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(dt);
    const y = parts.find((part) => part.type === 'year')?.value;
    const m = parts.find((part) => part.type === 'month')?.value;
    const d = parts.find((part) => part.type === 'day')?.value;
    if (!y || !m || !d) return null;
    const ymd = `${y}-${m}-${d}`;
    return isYmd(ymd) ? ymd : null;
  } catch {
    if (zone !== 'UTC') return ymdInTimeZone(unixSeconds, null);
    return null;
  }
}

function symbolsMatch(requested: string, returned: unknown): boolean {
  if (typeof returned !== 'string' || !returned.trim()) return false;
  return requested.trim().toUpperCase() === returned.trim().toUpperCase();
}

/**
 * Pull cash dividends out of a Yahoo chart payload.
 * Returns null when the payload is not a usable chart for this symbol.
 * Returns an empty payment list when the chart is real and lists no dividends.
 */
export function parseYahooDividendChart(payload: unknown, requestedSymbol: string): YahooDividendChart | null {
  const root = asRecord(payload);
  const chart = asRecord(root?.chart);
  const result = Array.isArray(chart?.result) ? asRecord(chart.result[0]) : null;
  if (!result) return null;
  const meta = asRecord(result.meta);
  if (!meta || !symbolsMatch(requestedSymbol, meta.symbol)) return null;

  const instrumentRaw = typeof meta.instrumentType === 'string' ? meta.instrumentType.trim().toUpperCase() : '';
  if (instrumentRaw && !ALLOWED_INSTRUMENTS.has(instrumentRaw)) return null;

  const currency = typeof meta.currency === 'string' ? meta.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) return null;

  const yahooSymbol = typeof meta.symbol === 'string' ? meta.symbol.trim().toUpperCase() : requestedSymbol.toUpperCase();
  const timeZone = typeof meta.exchangeTimezoneName === 'string' ? meta.exchangeTimezoneName : null;
  const events = asRecord(result.events);
  if (result.events != null && !events) return null;
  const dividends = events?.dividends;
  if (dividends == null) {
    return { currency, yahooSymbol, instrumentType: instrumentRaw || null, payments: [] };
  }
  const dividendRecord = asRecord(dividends);
  if (!dividendRecord) return null;

  const payments: YahooDividendPayment[] = [];
  for (const entry of Object.values(dividendRecord)) {
    const row = asRecord(entry);
    if (!row) continue;
    const amount = positiveAmount(row.amount);
    const stamp = typeof row.date === 'number' ? row.date : typeof row.date === 'string' ? Number(row.date) : NaN;
    if (amount == null || !Number.isFinite(stamp)) continue;
    const date = ymdInTimeZone(stamp, timeZone);
    if (!date) continue;
    payments.push({ date, amountPerShare: amount });
  }
  payments.sort((a, b) => a.date.localeCompare(b.date) || a.amountPerShare - b.amountPerShare);
  return { currency, yahooSymbol, instrumentType: instrumentRaw || null, payments };
}

async function fetchChartPayload(symbol: string): Promise<unknown | null> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    '?range=5y&interval=1mo&events=div&includePrePost=false';
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    const text = await res.text();
    if (!res.ok) return null;
    return JSON.parse(text) as unknown;
  } catch (err) {
    logger.warn('Yahoo dividend history request failed', {
      symbol,
      detail: (err as Error).message,
    });
    return null;
  }
}

async function fetchParsed(yahooSymbol: string): Promise<YahooDividendChart | null> {
  const payload = await fetchChartPayload(yahooSymbol);
  if (payload == null) return null;
  return parseYahooDividendChart(payload, yahooSymbol);
}

async function loadUncached(symbol: string, exchange: string | null): Promise<YahooDividendChart | null> {
  const primary = yahooEquitySymbol(symbol, exchange);
  if (!primary) return null;
  const first = await fetchParsed(primary);
  if (first) return first;
  if (!primary.includes('.') && !(exchange ?? '').trim()) {
    const nzSymbol = `${primary}.NZ`;
    const nz = await fetchParsed(nzSymbol);
    if (nz) return nz;
  }
  return null;
}

/** Published dividends for one equity symbol. Null when Yahoo does not return a usable chart. */
export async function fetchYahooPublishedDividends(
  symbol: string,
  exchange?: string | null,
): Promise<YahooDividendChart | null> {
  const key = `${yahooEquitySymbol(symbol, exchange)}|${(exchange ?? '').trim().toUpperCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const pending = inflight.get(key);
  if (pending) return pending;
  const promise = loadUncached(symbol, exchange ?? null)
    .then((value) => {
      cache.set(key, { at: Date.now(), ttl: value ? OK_TTL_MS : FAIL_TTL_MS, value });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}
