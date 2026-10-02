/**
 * Calendar month / year helpers in Pacific/Auckland (date-only YYYY-MM-DD).
 * Spending import floor stays 2026-10-01; UI month filter is separate.
 */

export const SPENDING_FLOOR = '2026-10-01';
export const DEFAULT_MONTH = { year: 2026, month: 10 }; // October 2026
export const DEFAULT_REPORT_YEAR = 2026;

export type YearMonth = { year: number; month: number }; // month 1–12

export function todayAucklandYmd(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const m = parts.find((p) => p.type === 'month')?.value ?? '10';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** YYYY-MM key for monthly budget plans. */
export function yearMonthKey(ym: YearMonth): string {
  return `${ym.year}-${pad2(ym.month)}`;
}

/** First day of calendar month (inclusive). */
export function monthStart(ym: YearMonth): string {
  return `${ym.year}-${pad2(ym.month)}-01`;
}

/** Last day of calendar month (inclusive). */
export function monthEnd(ym: YearMonth): string {
  // Day 0 of next month = last day of this month (UTC date arithmetic on Y-M-D)
  const last = new Date(Date.UTC(ym.year, ym.month, 0));
  return `${ym.year}-${pad2(ym.month)}-${pad2(last.getUTCDate())}`;
}

export function addMonths(ym: YearMonth, delta: number): YearMonth {
  const idx = ym.year * 12 + (ym.month - 1) + delta;
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  return { year, month };
}

export function formatMonthLabel(ym: YearMonth): string {
  const d = new Date(Date.UTC(ym.year, ym.month - 1, 1));
  return new Intl.DateTimeFormat('en-NZ', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

export function formatMonthLong(ym: YearMonth): string {
  const d = new Date(Date.UTC(ym.year, ym.month - 1, 1));
  return new Intl.DateTimeFormat('en-NZ', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** True if ym is at or after the spending import floor month. */
export function atOrAfterFloor(ym: YearMonth): boolean {
  return monthStart(ym) >= SPENDING_FLOOR.slice(0, 7) + '-01' || monthStart(ym) >= SPENDING_FLOOR;
}

export function isBeforeFloorMonth(ym: YearMonth): boolean {
  return monthEnd(ym) < SPENDING_FLOOR;
}

/** Budget overlaps calendar month if ranges intersect (inclusive YMD). */
export function budgetOverlapsMonth(
  periodStart: string,
  periodEnd: string,
  ym: YearMonth,
): boolean {
  const start = monthStart(ym);
  const end = monthEnd(ym);
  return periodStart <= end && periodEnd >= start;
}
