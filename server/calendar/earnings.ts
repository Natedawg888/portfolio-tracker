/**
 * Earnings report dates for the user's US-listed stocks, from Finnhub's earnings calendar
 * (finnhub.io/api/v1/calendar/earnings, FINNHUB_API_KEY). Nothing is filled in: a holding gets
 * an entry only when Finnhub lists one.
 *
 * What Finnhub gives: the report date in the US (exchange-local, Eastern), and at best a session
 * ("bmo" before the open, "dmh" during market hours, "amc" after the close), the fiscal quarter
 * and year. No exact time, no confirmed/estimated flag, no webcast link.
 *
 * NZ date: NZ is 16 to 18 hours ahead of New York depending on both daylight-saving periods.
 * During market hours (09:30–16:00 ET) and after the close (16:00–20:00 ET) are therefore always
 * the next day in NZ (01:30–14:00 NZ), whatever the offset. Before the open (04:00–09:30 ET) can
 * fall either side of NZ midnight, and no session says nothing; those stay on the US date and say
 * so (nzDateKnown false). The time is never shown, because Finnhub doesn't give one.
 */
import { addDays } from '../../src/lib/nzTime.ts';
import { isYmd } from '../../src/lib/invoiceCalc.ts';
import { logger } from '../lib/logger.ts';

export type EarningsSession = 'bmo' | 'dmh' | 'amc';

export interface EarningsEvent {
  symbol: string;
  /** Report date in the US, as Finnhub gives it. */
  usDate: string;
  session: EarningsSession | null;
  /** The calendar day in NZ: the next day after the US close or during market hours; else the US date. */
  nzDate: string;
  /** False when the NZ day can't be known (before the open, or no session); nzDate is then the US date. */
  nzDateKnown: boolean;
  quarter: number | null;
  year: number | null;
}

export type EarningsStatus = 'ok' | 'not_configured' | 'unavailable';

export interface EarningsResult {
  status: EarningsStatus;
  events: EarningsEvent[];
  /** Held stocks Finnhub's free calendar doesn't cover (not US-listed). */
  uncovered: string[];
  /** Covered stocks whose lookup failed just now; their dates are missing, not absent. */
  failed: string[];
}

export type FinnhubFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'NYSEARCA', 'NYSE ARCA', 'NYSEAMERICAN', 'NYSE AMERICAN', 'AMEX', 'BATS', 'CBOE', 'ARCA', 'NMS', 'NYQ', 'US']);
const FETCH_MS = 15_000;
const OK_TTL_MS = 12 * 60 * 60 * 1000;
const FAIL_TTL_MS = 10 * 60 * 1000;
/** One request per symbol covers about a year either side; the calendar filters from that. */
const WINDOW_DAYS = 400;

type CacheEntry = { at: number; ttl: number; events: EarningsEvent[] | null };
const cache = new Map<string, CacheEntry>();

export function clearEarningsCache(): void {
  cache.clear();
}

/** US-listed: a US exchange, or no exchange and a plain ticker (no ".NZ"-style suffix). */
export function isUsListed(symbol: string, exchange: string | null | undefined): boolean {
  const ex = (exchange ?? '').trim().toUpperCase();
  if (ex) return US_EXCHANGES.has(ex);
  return /^[A-Z][A-Z0-9-]{0,9}$/.test(symbol.trim().toUpperCase());
}

export function nzDateFor(usDate: string, session: EarningsSession | null): { nzDate: string; nzDateKnown: boolean } {
  if (session === 'amc' || session === 'dmh') return { nzDate: addDays(usDate, 1), nzDateKnown: true };
  return { nzDate: usDate, nzDateKnown: false };
}

function asSession(v: unknown): EarningsSession | null {
  return v === 'bmo' || v === 'amc' || v === 'dmh' ? v : null;
}

/** Finnhub's earningsCalendar rows for one symbol; anything malformed is dropped, never repaired. */
export function parseFinnhub(symbol: string, body: unknown): EarningsEvent[] {
  const rows = body && typeof body === 'object' ? (body as { earningsCalendar?: unknown }).earningsCalendar : null;
  if (!Array.isArray(rows)) return [];
  const out: EarningsEvent[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.symbol === 'string' && o.symbol.toUpperCase() !== symbol.toUpperCase()) continue;
    if (!isYmd(o.date) || seen.has(o.date)) continue;
    seen.add(o.date);
    const session = asSession(o.hour);
    out.push({
      symbol: symbol.toUpperCase(),
      usDate: o.date,
      session,
      ...nzDateFor(o.date, session),
      quarter: Number.isInteger(o.quarter) ? (o.quarter as number) : null,
      year: Number.isInteger(o.year) ? (o.year as number) : null,
    });
  }
  return out.sort((a, b) => a.nzDate.localeCompare(b.nzDate));
}

async function symbolEvents(symbol: string, today: string, key: string, fetcher: FinnhubFetch, nowMs: number): Promise<EarningsEvent[] | null> {
  const hit = cache.get(symbol);
  if (hit && nowMs - hit.at < hit.ttl) return hit.events;
  const url =
    'https://finnhub.io/api/v1/calendar/earnings?' +
    new URLSearchParams({ symbol, from: addDays(today, -WINDOW_DAYS), to: addDays(today, WINDOW_DAYS) }).toString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    // The key goes in a header, not the URL, so it stays out of request logs.
    const res = await fetcher(url, { headers: { 'X-Finnhub-Token': key, Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const events = parseFinnhub(symbol, await res.json());
    cache.set(symbol, { at: nowMs, ttl: OK_TTL_MS, events });
    return events;
  } catch (err) {
    logger.warn('earnings_fetch_failed', { symbol, error: err instanceof Error ? err.message : String(err) });
    cache.set(symbol, { at: nowMs, ttl: FAIL_TTL_MS, events: null });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Report dates for these holdings whose NZ day (or US day, when the NZ day isn't known) falls in
 * from..to. A symbol whose lookup fails is listed in `failed` and the others still show;
 * 'unavailable' means every lookup failed.
 */
export async function earningsFor(
  holdings: { symbol: string; exchange: string | null }[],
  from: string,
  to: string,
  today: string,
  opts: { key?: string; fetcher?: FinnhubFetch; nowMs?: number } = {},
): Promise<EarningsResult> {
  const key = (opts.key ?? process.env.FINNHUB_API_KEY ?? '').trim();
  const symbols = [...new Set(holdings.map((h) => h.symbol.trim().toUpperCase()).filter(Boolean))];
  const covered = symbols.filter((s) => holdings.some((h) => h.symbol.trim().toUpperCase() === s && isUsListed(s, h.exchange)));
  const uncovered = symbols.filter((s) => !covered.includes(s));
  if (!key) return { status: 'not_configured', events: [], uncovered, failed: [] };
  const fetcher = opts.fetcher ?? (fetch as unknown as FinnhubFetch);
  const nowMs = opts.nowMs ?? Date.now();
  const results = await Promise.all(covered.map((s) => symbolEvents(s, today, key, fetcher, nowMs)));
  const events = results.flatMap((r) => r ?? []).filter((e) => e.nzDate >= from && e.nzDate <= to);
  const failed = covered.filter((_, i) => results[i] == null);
  return { status: covered.length > 0 && failed.length === covered.length ? 'unavailable' : 'ok', events, uncovered, failed };
}
