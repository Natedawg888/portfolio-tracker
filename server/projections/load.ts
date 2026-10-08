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
import { loadSavedAssumptions } from './prefs.ts';
import { resolveCategoryId } from '../lib/categories.ts';
import {
  PROJECTION_CLASS_KEYS,
  type ProjectionClassKey,
} from '../../src/lib/projectionClasses.ts';
import type { AssumptionClassSource, ProjectionClassInput } from './model.ts';

const INVESTMENTS_SLUG = 'cat-investments';

/** Net money moved into the Investments category (out minus back in) over the window. */
function investmentsMoved(db: Database, userId: string, from: string, to: string): { total: number; count: number } {
  const categoryId = resolveCategoryId(db, userId, INVESTMENTS_SLUG);
  if (!categoryId) return { total: 0, count: 0 };
  const row = queryAll<{ total?: number; c?: number }>(
    db,
    `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS c FROM transactions
     WHERE user_id = ? AND category_id = ? AND date >= ? AND date <= ?`,
    [userId, categoryId, from, to],
  )[0];
  return { total: roundMoney(-(Number(row?.total ?? 0))), count: Number(row?.c ?? 0) };
}

type ClassStart = Record<ProjectionClassKey, number>;

/** Today's value of each class, from the same net-worth figures as the dashboard. */
export function classStartValues(nw: Awaited<ReturnType<typeof computeNetWorth>>): ClassStart {
  return {
    cash: roundMoney(nw.cashNzd),
    shares: roundMoney(nw.stocksNzd),
    kiwiSaver: roundMoney(nw.kiwiSaverNzd ?? 0),
    crypto: roundMoney(nw.cryptoNzd),
    mining: roundMoney(nw.gominingMinersNzd ?? 0),
    metals: roundMoney(nw.metalsNzd ?? 0),
    property: roundMoney(nw.realEstateNzd ?? 0),
    other: roundMoney((nw.artNzd ?? 0) + (nw.stonesNzd ?? 0) + (nw.collectablesNzd ?? 0) + (nw.forexNzd ?? 0)),
  };
}

/**
 * Per-class return and monthly addition. Precedence for each: the scenario (query) →
 * the user's saved value → for returns, the default annualReturnPercent (0% when unset);
 * for additions, what the user's data shows.
 * Cash gets the budget saving less what goes into other classes the user funds from the
 * bank (everything except KiwiSaver, which comes out of pay, and mining rewards).
 */
export function buildClassInputs(opts: {
  start: ClassStart;
  query: ProjectionQuery;
  saved: ReturnType<typeof loadSavedAssumptions>;
  monthlySavingNzd: number | null;
  investmentsMonthlyNzd: number | null;
  investmentsReason: string;
  kiwiSaverMonthlyNzd: number | null;
}): ProjectionClassInput[] {
  const { start, query, saved } = opts;
  const defaultReturn = query.annualReturnPercent ?? 0;
  const defaultSource: AssumptionClassSource = query.annualReturnPercent == null ? 'default' : 'query';

  const pick = (key: ProjectionClassKey, observed: number | null, observedReason: string | null) => {
    if (query.classAdditions[key] != null) return { value: query.classAdditions[key]!, source: 'query' as const, reason: 'You entered this in the scenario.' };
    if (saved.contributions[key] != null) return { value: saved.contributions[key]!, source: 'saved' as const, reason: 'Your saved monthly addition.' };
    return { value: observed, source: observed == null ? ('default' as const) : ('user_data' as const), reason: observedReason };
  };

  const additions = new Map<ProjectionClassKey, { value: number | null; source: AssumptionClassSource; reason: string | null }>();
  additions.set('shares', pick('shares', opts.investmentsMonthlyNzd, opts.investmentsReason));
  additions.set('kiwiSaver', pick('kiwiSaver', opts.kiwiSaverMonthlyNzd, opts.kiwiSaverMonthlyNzd == null
    ? 'No KiwiSaver contributions are recorded in the window.'
    : 'Average KiwiSaver contributions in the window. These come out of pay, so they are not taken from cash.'));
  for (const key of ['crypto', 'mining', 'metals', 'property', 'other'] as const) {
    additions.set(key, pick(key, null, key === 'mining'
      ? 'Nothing added. Mining rewards recorded as Mining income are already in your budget saving (cash).'
      : 'Nothing added unless you set a monthly amount.'));
  }
  // Money the user moves from the bank into other classes comes out of the saving.
  const fundedFromCash = (['shares', 'crypto', 'metals', 'property', 'other'] as const).reduce(
    (sum, key) => sum + (additions.get(key)?.value ?? 0),
    0,
  );
  if (query.classAdditions.cash != null || saved.contributions.cash != null) {
    additions.set('cash', pick('cash', null, null));
  } else if (opts.monthlySavingNzd == null) {
    additions.set('cash', {
      value: null,
      source: 'default',
      reason: 'No budget saving is known, so nothing is added to cash and the amounts going into other classes are not taken from it.',
    });
  } else {
    const net = roundMoney(opts.monthlySavingNzd - fundedFromCash);
    additions.set('cash', {
      value: net,
      source: 'user_data',
      reason:
        fundedFromCash === 0
          ? 'Your monthly budget saving (income − spending).'
          : `Monthly budget saving ${opts.monthlySavingNzd.toFixed(2)} less ${roundMoney(fundedFromCash).toFixed(2)} going into other classes each month.`,
    });
  }

  return PROJECTION_CLASS_KEYS.map((key) => {
    const ownReturn = query.classReturns[key] ?? saved.returns[key] ?? null;
    const returnSource: AssumptionClassSource =
      query.classReturns[key] != null ? 'query' : saved.returns[key] != null ? 'saved' : defaultSource;
    const add = additions.get(key)!;
    return {
      key,
      startNzd: start[key],
      annualReturnPercent: ownReturn ?? defaultReturn,
      returnSource,
      monthlyAdditionNzd: add.value,
      additionSource: add.source,
      additionReason: add.reason,
    };
  });
}

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

  const invested =
    startBounds && endBounds ? investmentsMoved(db, userId, startBounds.from, endBounds.to) : { total: 0, count: 0 };
  const investmentsMonthlyNzd = invested.count > 0 ? roundMoney(invested.total / query.savingWindowMonths) : null;
  const assetClasses = buildClassInputs({
    start: classStartValues(netWorth),
    query,
    saved: loadSavedAssumptions(db, userId),
    monthlySavingNzd,
    investmentsMonthlyNzd,
    investmentsReason:
      investmentsMonthlyNzd == null
        ? 'No transfers to the Investments budget category in the window.'
        : `Average money moved to the Investments budget category over ${query.savingWindowMonths} month(s) (${invested.count} transaction${invested.count === 1 ? '' : 's'}).`,
    kiwiSaverMonthlyNzd: ks.monthlyNzd,
  });

  return projectSeries({
    assetClasses,
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
