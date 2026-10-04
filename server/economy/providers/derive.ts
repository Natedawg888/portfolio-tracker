/**
 * Turn official level series into the rates the scorer reads.
 * Derived points are labelled by the caller; this file only does the arithmetic.
 */
import type { Frequency } from '../types.ts';
import { addMonths } from '../periods.ts';

export type DatedValue = {
  period: string;
  periodStart: string;
  periodEnd: string;
  value: number;
  frequency: Frequency;
};

export type WithPrevious = DatedValue & {
  previousValue: number | null;
  previousPeriod: string | null;
};

function roundTo(n: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

export function sortByPeriod<T extends { periodEnd: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : a.periodEnd > b.periodEnd ? 1 : 0));
}

export function attachPrevious(rows: DatedValue[]): WithPrevious[] {
  const byPeriod = new Map<string, DatedValue>();
  for (const row of sortByPeriod(rows)) byPeriod.set(row.period, row);
  const sorted = sortByPeriod([...byPeriod.values()]);
  return sorted.map((row, index) => ({
    ...row,
    previousValue: index > 0 ? sorted[index - 1]!.value : null,
    previousPeriod: index > 0 ? sorted[index - 1]!.period : null,
  }));
}

/** Percent change versus the observation `monthsBack` earlier. Skips gaps. */
export function changeOverMonths(levels: DatedValue[], monthsBack: number): DatedValue[] {
  const sorted = sortByPeriod(levels).filter((row) => row.frequency === 'monthly');
  const byPeriod = new Map(sorted.map((row) => [row.period, row]));
  const out: DatedValue[] = [];
  for (const row of sorted) {
    const prior = byPeriod.get(addMonths(row.period, -monthsBack));
    if (!prior || prior.value === 0) continue;
    out.push({
      ...row,
      value: roundTo((row.value / prior.value - 1) * 100, 4),
    });
  }
  return out;
}

/** left − right on shared period labels. */
export function subtractSeries(left: DatedValue[], right: DatedValue[]): DatedValue[] {
  const rightByPeriod = new Map(right.map((row) => [row.period, row]));
  const out: DatedValue[] = [];
  for (const row of sortByPeriod(left)) {
    const other = rightByPeriod.get(row.period);
    if (!other) continue;
    out.push({ ...row, value: roundTo(row.value - other.value, 4) });
  }
  return out;
}
