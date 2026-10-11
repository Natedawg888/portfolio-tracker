/**
 * Budget page view logic: month progress, the summary figures and the insight line.
 * Pure functions over figures the page already loads; nothing here is estimated.
 */
import { monthEnd, monthStart, type YearMonth } from './period.ts';

export type MonthProgress =
  | { state: 'current'; day: number; daysInMonth: number; fraction: number }
  | { state: 'past'; daysInMonth: number; fraction: 1 }
  | { state: 'future'; daysInMonth: number; fraction: 0 };

/** Where today sits in the month. Days count whole Auckland days, today included. */
export function monthProgress(month: YearMonth, todayYmd: string): MonthProgress {
  const from = monthStart(month);
  const to = monthEnd(month);
  const daysInMonth = Number(to.slice(8, 10));
  if (todayYmd < from) return { state: 'future', daysInMonth, fraction: 0 };
  if (todayYmd > to) return { state: 'past', daysInMonth, fraction: 1 };
  const day = Number(todayYmd.slice(8, 10));
  return { state: 'current', day, daysInMonth, fraction: day / daysInMonth };
}

export type SpendRowLike = { categoryId: string | null; name: string; spend: number };

export type BudgetUsed = { spent: number; planned: number; fraction: number } | null;

/** Spent in planned categories ÷ total planned. Null when nothing is planned. */
export function budgetUsed(spentInPlanned: number, plannedTotal: number): BudgetUsed {
  if (!(plannedTotal > 0)) return null;
  return { spent: spentInPlanned, planned: plannedTotal, fraction: spentInPlanned / plannedTotal };
}

export type SpendInsight = {
  /** Largest spending category, when it has no plan. */
  largest: { categoryId: string; name: string; spend: number };
  /** All spending outside planned categories, uncategorised included. */
  unplannedTotal: number;
};

/**
 * "Groceries is your biggest spend ($412) and has no plan · $780 unplanned".
 * Only when the largest categorised spend has no plan. Uncategorised spending is
 * not a category, so it never counts as "largest", but it is unplanned.
 */
export function spendInsight(rows: SpendRowLike[], plannedCategoryIds: Set<string>): SpendInsight | null {
  const categorised = rows.filter((r) => r.categoryId != null && r.spend > 0);
  if (categorised.length === 0) return null;
  const largest = categorised.reduce((a, b) => (b.spend > a.spend ? b : a));
  if (plannedCategoryIds.has(largest.categoryId!)) return null;
  const unplannedTotal = rows
    .filter((r) => r.spend > 0 && (r.categoryId == null || !plannedCategoryIds.has(r.categoryId)))
    .reduce((sum, r) => sum + r.spend, 0);
  return {
    largest: { categoryId: largest.categoryId!, name: largest.name, spend: largest.spend },
    unplannedTotal,
  };
}

/**
 * A planned category is "ahead of pace" when the share of its plan already spent is
 * this many percentage points above the share of the month gone (e.g. 55% spent on
 * day 12 of 31, 39% of the month).
 */
export const AHEAD_OF_PACE_POINTS = 10;

export type PlanStatus =
  | { kind: 'over'; overBy: number; percent: number | null }
  | { kind: 'ahead'; left: number; percent: number }
  | { kind: 'on_track'; left: number; percent: number }
  /** Finished month that stayed within its plan. */
  | { kind: 'within'; left: number; percent: number };

/** Spent as a whole percent of plan, not capped (346 means 346%). Null with no plan amount. */
export function percentOfPlan(spent: number, planned: number): number | null {
  if (!(planned > 0)) return null;
  return Math.round((spent / planned) * 100);
}

export function planStatus(spent: number, planned: number, progress: MonthProgress): PlanStatus {
  const percent = percentOfPlan(spent, planned);
  if (spent > planned) return { kind: 'over', overBy: spent - planned, percent };
  const left = planned - spent;
  const pct = percent ?? 0;
  if (progress.state === 'past') return { kind: 'within', left, percent: pct };
  if (progress.state === 'current' && pct - progress.fraction * 100 > AHEAD_OF_PACE_POINTS) {
    return { kind: 'ahead', left, percent: pct };
  }
  return { kind: 'on_track', left, percent: pct };
}

/**
 * Received ÷ days of the month gone, only when payments landed on at least 2
 * different days (one payday isn't a daily rate). Null otherwise.
 */
export function dailyAverage(received: number, dates: string[], progress: MonthProgress): number | null {
  if (new Set(dates).size < 2) return null;
  const elapsed = progress.state === 'current' ? progress.day : progress.state === 'past' ? progress.daysInMonth : 0;
  return elapsed > 0 ? received / elapsed : null;
}

export type TxnFilter =
  | { kind: 'all' }
  | { kind: 'needs' }
  | { kind: 'transfers' }
  | { kind: 'category'; categoryId: string };

/** Transactions list filter pills. Transfers are Transfer out / Transfer in categories. */
export function matchesTxnFilter(
  t: { categoryId?: string | null },
  filter: TxnFilter,
  typeOf: Map<string, string>,
): boolean {
  switch (filter.kind) {
    case 'needs':
      return !t.categoryId;
    case 'transfers': {
      const type = t.categoryId ? typeOf.get(t.categoryId) : undefined;
      return type === 'transfer_out' || type === 'transfer_in';
    }
    case 'category':
      return t.categoryId === filter.categoryId;
    default:
      return true;
  }
}
