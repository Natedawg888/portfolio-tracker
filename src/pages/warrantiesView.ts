/**
 * Warranties list header (phase 1). Counts come from the list response.
 * Active, expiring, and expired are disjoint: active is not inside the
 * expiring window. A missing or negative count is shown as zero.
 */

export type WarrantyTotals = {
  active: number;
  expiring: number;
  expired: number;
};

function wholeCount(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function countLabel(n: number, word: string): string {
  return `${wholeCount(n)} ${word}`;
}

/**
 * "{active} covered · {expiring} ending in {n} days · {expired} expired".
 * "Covered" is totals.active only, so it does not include warranties that are
 * also ending soon. The day count is expiringSoonDays from the list.
 */
export function warrantiesSubtitle(totals: WarrantyTotals, expiringSoonDays: number): string {
  const days = wholeCount(expiringSoonDays);
  const dayLabel = days === 1 ? '1 day' : `${days} days`;
  return `${countLabel(totals.active, 'covered')} · ${countLabel(totals.expiring, 'ending')} in ${dayLabel} · ${countLabel(totals.expired, 'expired')}`;
}
