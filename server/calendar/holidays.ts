/**
 * NZ public holidays from Nager.Date (date.nager.at/api/v3/PublicHolidays/{year}/NZ, no key).
 * National holidays only for now: regional anniversary days (which Nager marks with counties)
 * are left out. Dates are already the observed NZ dates (Mondayised Anzac and Waitangi Day,
 * Matariki). Nothing is hard-coded or filled in: a year that can't be fetched shows no holidays.
 */
import { isYmd } from '../../src/lib/invoiceCalc.ts';
import { logger } from '../lib/logger.ts';

export interface PublicHoliday {
  date: string;
  name: string;
}

export type HolidayFetch = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const FETCH_MS = 15_000;
const OK_TTL_MS = 24 * 60 * 60 * 1000;
const FAIL_TTL_MS = 10 * 60 * 1000;

type CacheEntry = { at: number; ttl: number; holidays: PublicHoliday[] | null };
const cache = new Map<number, CacheEntry>();

export function clearHolidayCache(): void {
  cache.clear();
}

/** Nager rows → national holidays. A day with two national holidays keeps both names. */
export function parseNager(body: unknown): PublicHoliday[] {
  if (!Array.isArray(body)) return [];
  const byDate = new Map<string, string[]>();
  for (const r of body) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (o.global !== true || !isYmd(o.date)) continue;
    const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : typeof o.localName === 'string' ? o.localName.trim() : '';
    if (!name) continue;
    byDate.set(o.date, [...(byDate.get(o.date) ?? []), name]);
  }
  return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, names]) => ({ date, name: [...new Set(names)].join(' / ') }));
}

async function yearHolidays(year: number, fetcher: HolidayFetch, nowMs: number): Promise<PublicHoliday[] | null> {
  const hit = cache.get(year);
  if (hit && nowMs - hit.at < hit.ttl) return hit.holidays;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetcher(`https://date.nager.at/api/v3/PublicHolidays/${year}/NZ`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const holidays = parseNager(await res.json());
    cache.set(year, { at: nowMs, ttl: OK_TTL_MS, holidays });
    return holidays;
  } catch (err) {
    logger.warn('holidays_fetch_failed', { year, error: err instanceof Error ? err.message : String(err) });
    cache.set(year, { at: nowMs, ttl: FAIL_TTL_MS, holidays: null });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** National holidays on NZ dates from..to. `available` is false when any year couldn't be fetched. */
export async function holidaysBetween(from: string, to: string, opts: { fetcher?: HolidayFetch; nowMs?: number } = {}): Promise<{ available: boolean; holidays: PublicHoliday[] }> {
  const fetcher = opts.fetcher ?? (fetch as unknown as HolidayFetch);
  const nowMs = opts.nowMs ?? Date.now();
  const years: number[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.push(y);
  const results = await Promise.all(years.map((y) => yearHolidays(y, fetcher, nowMs)));
  return {
    available: results.every((r) => r != null),
    holidays: results.flatMap((r) => r ?? []).filter((h) => h.date >= from && h.date <= to),
  };
}
