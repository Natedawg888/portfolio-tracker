/**
 * Load one user's balances and cashflow, then project them.
 * Every read is filtered by user_id. Prices are whatever computeNetWorth
 * already uses; this module does not look up a new quote.
 */
import type { Database } from 'sql.js';
import { queryAll } from '../db/index.ts';
import { computeNetWorth } from '../lib/netWorth.ts';
import { listDebtsForUser } from '../debts/store.ts';
import { monthBounds, roundMoney } from '../debts/model.ts';
import { homeMonthSnapshot } from '../budget/homeSnapshot.ts';
import { paySourcesExpected } from '../paySources/store.ts';
import {
  completeMonthsBefore,
  observedKiwiSaverMonthly,
  observedMonthlySaving,
  projectSeries,
  savingWithExpectedPay,
  type ProjectionResult,
} from './model.ts';
import type { ProjectionQuery } from './params.ts';

function kiwiSaverAmounts(
  db: Database,
  userId: string,
  from: string,
  to: string,
): number[] {
  const rows = queryAll<{ amount_nzd?: number }>(
    db,
    `SELECT a.amount_nzd
     FROM kiwisaver_activity a
     INNER JOIN kiwisaver_accounts k ON k.id = a.account_id
     WHERE k.user_id = ? AND a.date >= ? AND a.date <= ?`,
    [userId, from, to],
  );
  return rows.map((row) => Number(row.amount_nzd)).filter((n) => Number.isFinite(n));
}

export async function loadUserProjection(
  db: Database,
  userId: string,
  query: ProjectionQuery,
  asOf: string,
): Promise<ProjectionResult> {
  const netWorth = await computeNetWorth(db, userId);
  const debts = listDebtsForUser(db, userId, asOf);
  const months = completeMonthsBefore(asOf, query.savingWindowMonths);
  const snapshots = months.map((yearMonth) => homeMonthSnapshot(db, userId, yearMonth));
  const observed = observedMonthlySaving(
    query.savingWindowMonths,
    snapshots.map((snapshot) => ({
      incomeNzd: snapshot?.incomeNzd ?? 0,
      spendingNzd: snapshot?.spendingNzd ?? 0,
    })),
    asOf,
  );

  const windowStart = months[0] ?? asOf.slice(0, 7);
  const windowEnd = months[months.length - 1] ?? windowStart;
  const startBounds = monthBounds(`${windowStart}-01`);
  const endBounds = monthBounds(`${windowEnd}-01`);
  const ks = observedKiwiSaverMonthly(
    startBounds && endBounds
      ? kiwiSaverAmounts(db, userId, startBounds.from, endBounds.to)
      : [],
    query.savingWindowMonths,
  );

  const expectedPay = paySourcesExpected(db, userId);
  const fromPay = savingWithExpectedPay(observed, query.savingWindowMonths, expectedPay);
  const monthlySavingNzd =
    query.monthlySavingNzd != null ? query.monthlySavingNzd : (fromPay?.monthlyNzd ?? observed.monthlyNzd);
  const monthlySavingSource = query.monthlySavingNzd != null ? 'query' : 'user_data';
  const monthlySavingReason =
    query.monthlySavingNzd != null
      ? 'Taken from the monthlySavingNzd query parameter. Budget spending already includes debt repayments, and this amount is not reduced again when a debt balance falls.'
      : (fromPay?.reason ?? observed.reason);

  return projectSeries({
    asOf,
    horizonMonths: query.months,
    compoundingAssetsNzd: roundMoney(netWorth.assetsKnownNzd - netWorth.cashLiabilitiesNzd),
    bankLiabilitiesNzd: netWorth.cashLiabilitiesNzd,
    propertyMortgageNzd: netWorth.realEstateMortgageNzd ?? 0,
    kiwiSaverBalanceNzd: netWorth.kiwiSaverNzd,
    debts: debts.map((debt) => ({
      id: debt.id,
      name: debt.name,
      balanceNzd: debt.outstandingNzd,
      annualRatePercent: debt.interestRatePercent,
      interestPeriod: debt.interestPeriod,
      actualPaymentNzd: debt.actualPaymentNzd,
    })),
    annualReturnPercent: query.annualReturnPercent ?? 0,
    annualReturnSource: query.annualReturnPercent == null ? 'default' : 'query',
    monthlySavingNzd,
    monthlySavingSource,
    monthlySavingReason,
    observedSaving: {
      windowMonths: query.savingWindowMonths,
      windowStart,
      windowEnd,
      incomeNzd: observed.incomeNzd,
      spendingNzd: observed.spendingNzd,
      monthsWithActivity: observed.monthsWithActivity,
      monthlyNzd: observed.monthlyNzd,
      reason: observed.reason,
      expectedPayMonthlyNzd: expectedPay?.monthlyNetNzd ?? null,
      usedExpectedPay: query.monthlySavingNzd == null && fromPay != null,
    },
    kiwiSaverContributionMonthlyNzd: ks.monthlyNzd,
    kiwiSaverContributionReason: ks.reason,
  });
}
