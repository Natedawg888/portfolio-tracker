/**
 * Financial health score for one user (KAN-55). Read-only: computed from the same figures as
 * the dashboard (net worth, budget months, debts) every time it is asked for, so it moves as
 * soon as the underlying data changes. Formula: src/lib/healthScore.ts.
 */
import type { Database } from 'sql.js';
import { computeHealthScore, type HealthScore } from '../../src/lib/healthScore.ts';
import { computeNetWorth } from '../lib/netWorth.ts';
import { homeMonthSnapshot } from '../budget/homeSnapshot.ts';
import { monthBounds } from '../debts/model.ts';
import { completeMonthsBefore } from '../projections/model.ts';
import { investmentsMoved, kiwiSaverAmounts } from '../projections/load.ts';

export const HEALTH_WINDOW_MONTHS = 6;

export async function loadHealthScore(db: Database, userId: string, asOf: string): Promise<HealthScore & { asOf: string; windowStart: string | null; windowEnd: string | null }> {
  const months = completeMonthsBefore(asOf, HEALTH_WINDOW_MONTHS);
  const snapshots = months.map((m) => homeMonthSnapshot(db, userId, m));
  const netWorth = await computeNetWorth(db, userId);
  const start = months[0] ? monthBounds(`${months[0]}-01`) : null;
  const end = months.length ? monthBounds(`${months[months.length - 1]}-01`) : null;
  const invested = start && end ? investmentsMoved(db, userId, start.from, end.to).total : 0;
  const kiwiSaver = start && end ? kiwiSaverAmounts(db, userId, start.from, end.to).reduce((s, n) => s + n, 0) : 0;
  const score = computeHealthScore({
    windowMonths: HEALTH_WINDOW_MONTHS,
    months: snapshots.map((s) => ({ incomeNzd: s?.incomeNzd ?? 0, spendingNzd: s?.spendingNzd ?? 0 })),
    cashNzd: netWorth.cashNzd,
    personalDebtNzd: netWorth.debtOutstandingNzd,
    // Card and loan accounts are stored as negative balances.
    cardDebtNzd: Math.max(0, -netWorth.cashLiabilitiesNzd),
    investedNzd: invested,
    kiwiSaverNzd: kiwiSaver,
  });
  return { ...score, asOf, windowStart: months[0] ?? null, windowEnd: months[months.length - 1] ?? null };
}
