/**
 * Period labels and as-of selection. No scoring.
 */
import type { Frequency } from './types.ts';

export type PeriodRange = {
  period: string;
  start: string;
  end: string;
  frequency: Frequency;
};

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function quarterOfMonth(month: number): 1 | 2 | 3 | 4 {
  return (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

export function quarterEndDate(year: number, quarter: 1 | 2 | 3 | 4): string {
  const month = quarter * 3;
  return `${year}-${pad(month)}-${pad(lastDay(year, month))}`;
}

export function quarterStartDate(year: number, quarter: 1 | 2 | 3 | 4): string {
  const month = quarter * 3 - 2;
  return `${year}-${pad(month)}-01`;
}

export function monthRange(year: number, month: number): PeriodRange {
  return {
    period: `${year}-${pad(month)}`,
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDay(year, month))}`,
    frequency: 'monthly',
  };
}

export function quarterRange(year: number, quarter: 1 | 2 | 3 | 4): PeriodRange {
  return {
    period: `${year}-Q${quarter}`,
    start: quarterStartDate(year, quarter),
    end: quarterEndDate(year, quarter),
    frequency: 'quarterly',
  };
}

/**
 * Stats NZ Infoshare periods look like 2026.06 for both months and quarter-ends.
 * The caller supplies the series frequency.
 */
export function periodFromStatsNz(raw: string, frequency: Frequency): PeriodRange | null {
  const m = raw.trim().match(/^(\d{4})\.(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (frequency === 'monthly') return monthRange(year, month);
  if (frequency === 'annual') {
    return { period: String(year), start: `${year}-01-01`, end: `${year}-12-31`, frequency: 'annual' };
  }
  if (month % 3 !== 0) return null;
  return quarterRange(year, quarterOfMonth(month));
}

/** OECD periods: 2026-Q2, 2026-08, or 2026. */
export function periodFromOecd(raw: string): PeriodRange | null {
  const text = raw.trim();
  const q = text.match(/^(\d{4})-Q([1-4])$/);
  if (q) return quarterRange(Number(q[1]), Number(q[2]) as 1 | 2 | 3 | 4);
  const month = text.match(/^(\d{4})-(\d{2})$/);
  if (month) {
    const mm = Number(month[2]);
    if (mm < 1 || mm > 12) return null;
    return monthRange(Number(month[1]), mm);
  }
  const year = text.match(/^(\d{4})$/);
  if (year) {
    const y = Number(year[1]);
    return { period: String(y), start: `${y}-01-01`, end: `${y}-12-31`, frequency: 'annual' };
  }
  return null;
}

export function periodEnd(period: string): string | null {
  const q = period.match(/^(\d{4})-Q([1-4])$/);
  if (q) return quarterEndDate(Number(q[1]), Number(q[2]) as 1 | 2 | 3 | 4);
  const month = period.match(/^(\d{4})-(\d{2})$/);
  if (month) return monthRange(Number(month[1]), Number(month[2])).end;
  const year = period.match(/^(\d{4})$/);
  if (year) return `${year[1]}-12-31`;
  return null;
}

export function addMonths(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function comparePeriods(a: string, b: string): number {
  const ae = periodEnd(a) ?? a;
  const be = periodEnd(b) ?? b;
  if (ae < be) return -1;
  if (ae > be) return 1;
  return 0;
}

export function aucklandDateParts(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  return {
    year: Number(parts.find((p) => p.type === 'year')?.value),
    month: Number(parts.find((p) => p.type === 'month')?.value),
    day: Number(parts.find((p) => p.type === 'day')?.value),
  };
}

/** Latest quarter whose end date is on or before today in Pacific/Auckland. */
export function latestCompletedQuarter(now: Date): string {
  const { year, month, day } = aucklandDateParts(now);
  const currentQ = quarterOfMonth(month);
  const endMonth = currentQ * 3;
  const endDay = lastDay(year, endMonth);
  let q: number = currentQ;
  let y = year;
  if (!(month === endMonth && day >= endDay)) {
    q -= 1;
    if (q === 0) {
      q = 4;
      y -= 1;
    }
  }
  return `${y}-Q${q}`;
}

export function listQuarters(fromPeriod: string, toPeriod: string): string[] {
  const start = fromPeriod.match(/^(\d{4})-Q([1-4])$/);
  const end = toPeriod.match(/^(\d{4})-Q([1-4])$/);
  if (!start || !end) return [];
  let y = Number(start[1]);
  let q = Number(start[2]);
  const endKey = Number(end[1]) * 4 + Number(end[2]);
  const out: string[] = [];
  while (y * 4 + q <= endKey) {
    out.push(`${y}-Q${q}`);
    q += 1;
    if (q === 5) {
      q = 1;
      y += 1;
    }
  }
  return out;
}

export function daysAfter(periodEndDate: string, now: Date): number {
  const end = Date.parse(`${periodEndDate}T00:00:00Z`);
  const today = Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00Z');
  return Math.round((today - end) / 86_400_000);
}

export function latestAsOf<T extends { periodEnd: string }>(rows: T[], asOfEnd: string): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (row.periodEnd > asOfEnd) continue;
    if (!best || row.periodEnd > best.periodEnd) best = row;
  }
  return best;
}

/** Sort key for catalogue titles such as "June 2026 quarter". */
export function titleRecencyKey(title: string): number {
  const m = title.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i,
  );
  if (!m) return 0;
  return Number(m[2]) * 12 + (MONTHS[m[1].toLowerCase()] ?? 0);
}
