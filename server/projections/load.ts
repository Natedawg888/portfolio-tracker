/**
 * Load one user's balances and cashflow, then project them.
 * Every read is filtered by user_id. Prices are whatever computeNetWorth
 * already uses; this module does not look up a new quote.
 */
import { bondProjectionFlows } from '../bonds/store.ts';
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
import { projectMining, type MiningProjection } from '../../src/lib/miningProjection.ts';
import { GOMINING_DEFAULT_KWH_USD } from '../../src/lib/gominingEarnings.ts';
import type { MiningPlan } from '../../src/lib/projectionClasses.ts';
import { fetchGoMiningIncome } from '../quotes/gominingIncome.ts';
import { fetchBtcFx } from '../quotes/btc.ts';
import { goMiningSettingsForUser } from '../routes/settings.ts';
import { readAssetClassPrefs } from '../lib/userAssetClassPrefs.ts';
import { hiddenTotals, type HiddenClass } from '../../src/lib/visibleNetWorth.ts';
import { isAssetClassEnabled, type AssetClassPrefKey, type AssetClassPrefs } from '../../src/lib/assetClassPrefs.ts';

const MINING_INCOME_SLUG = 'cat-income-mining';

export type ProjectionMining = {
  status: 'ok' | 'unavailable' | 'no_miners';
  reason: string | null;
  plan: MiningPlan & { rewardsTo: 'crypto' | 'cash' | 'reinvest' };
  inputs: {
    th: number;
    avgWth: number | null;
    poolSatPerThDay: number | null;
    btcUsd: number | null;
    btcNzd: number | null;
    kWhCostUsd: number;
    discountPct: number;
    btcPriceChangePctYear: number;
    rewardChangePctYear: number;
    /** Mining income already recorded in the budget (monthly average), taken off cash. */
    recordedMiningIncomeMonthlyNzd: number;
    asOf: string | null;
  } | null;
  projection: MiningProjection | null;
};

/** Money flows the mining plan adds to classes, per month (index 0 = month 1). */
type MiningFlows = {
  toCrypto: number[];
  toCash: number[];
  toMining: number[];
  spendNzd: number[];
  recordedIncomeMonthly: number;
  rewardsTo: string;
};

function recordedMiningIncome(db: Database, userId: string, from: string, to: string): number {
  const categoryId = resolveCategoryId(db, userId, MINING_INCOME_SLUG);
  if (!categoryId) return 0;
  const records = queryAll<{ total?: number }>(
    db,
    `SELECT COALESCE(SUM(amount_nzd), 0) AS total FROM income_records
     WHERE user_id = ? AND category_id = ? AND date >= ? AND date <= ?`,
    [userId, categoryId, from, to],
  )[0];
  const txns = queryAll<{ total?: number }>(
    db,
    `SELECT COALESCE(SUM(t.amount), 0) AS total FROM transactions t
     WHERE t.user_id = ? AND t.category_id = ? AND t.date >= ? AND t.date <= ? AND t.amount > 0
       AND NOT EXISTS (SELECT 1 FROM income_records r WHERE r.user_id = t.user_id AND r.transaction_id = t.id)`,
    [userId, categoryId, from, to],
  )[0];
  return roundMoney(Number(records?.total ?? 0) + Number(txns?.total ?? 0));
}

async function loadMining(opts: {
  db: Database;
  userId: string;
  months: number;
  plan: MiningPlan;
  btcPriceChangePctYear: number;
  recordedIncomeMonthly: number;
}): Promise<ProjectionMining> {
  const plan = { ...opts.plan, rewardsTo: opts.plan.rewardsTo ?? ('crypto' as const) };
  const miners = queryAll<{ hashrate_ths?: number | null; energy_efficiency_wth?: number | null }>(
    opts.db,
    `SELECT hashrate_ths, energy_efficiency_wth FROM holdings WHERE user_id = ? AND asset_class = 'gomining_miner'`,
    [opts.userId],
  )
    .map((m) => ({ th: Number(m.hashrate_ths) || 0, wth: m.energy_efficiency_wth == null ? null : Number(m.energy_efficiency_wth) }))
    .filter((m) => m.th > 0);
  if (miners.length === 0) {
    return { status: 'no_miners', reason: 'No GoMining miners with a hashrate are recorded on Portfolio.', plan, inputs: null, projection: null };
  }
  const settings = goMiningSettingsForUser(opts.db, opts.userId);
  const [income, fx] = await Promise.all([
    fetchGoMiningIncome().catch(() => null),
    fetchBtcFx().catch(() => null),
  ]);
  const pool = income && income.status === 'ok' ? income.poolIncomeBtcPerTh : null;
  const btcUsd = settings.btcUsd ?? (income && income.status === 'ok' ? income.btcCourseInUsd : null) ?? fx?.btcUsd ?? null;
  const btcNzd = fx?.btcNzd ?? null;
  const kWhCostUsd = settings.kWhCostUsd ?? (income && income.status === 'ok' ? income.impliedKwhCostUsd : null) ?? GOMINING_DEFAULT_KWH_USD;
  const th = miners.reduce((s, m) => s + m.th, 0);
  const withW = miners.filter((m) => m.wth != null);
  const avgWth = withW.length ? withW.reduce((s, m) => s + m.th * (m.wth as number), 0) / withW.reduce((s, m) => s + m.th, 0) : null;
  const inputs = {
    th,
    avgWth: avgWth == null ? null : Math.round(avgWth * 100) / 100,
    poolSatPerThDay: pool == null ? null : Math.round(pool * 1e8 * 100) / 100,
    btcUsd,
    btcNzd,
    kWhCostUsd,
    discountPct: settings.discountPct,
    btcPriceChangePctYear: opts.btcPriceChangePctYear,
    rewardChangePctYear: plan.rewardChangePct ?? 0,
    recordedMiningIncomeMonthlyNzd: opts.recordedIncomeMonthly,
    asOf: income?.asOf ?? null,
  };
  if (pool == null || btcUsd == null || btcNzd == null) {
    return {
      status: 'unavailable',
      reason:
        pool == null
          ? 'GoMining’s live pool reward is unavailable right now, so mining rewards are not projected (never invented).'
          : 'The live BTC price is unavailable right now, so mining rewards are not projected.',
      plan,
      inputs,
      projection: null,
    };
  }
  const projection = projectMining({
    months: opts.months,
    miners,
    poolBtcPerThDay: pool,
    gbpSatPerThDay: income?.goBtcPaySatPerTh ?? 0,
    btcUsd,
    btcNzd,
    kWhCostUsd,
    discountPct: settings.discountPct,
    btcPriceChangePctYear: opts.btcPriceChangePctYear,
    rewardChangePctYear: plan.rewardChangePct ?? 0,
    addThPerMonth: plan.addThPerMonth ?? 0,
    addThOnce: plan.addThOnce ?? 0,
    newThWth: plan.newThWth ?? null,
    thPriceNzd: plan.thPriceNzd ?? null,
    wthDropPerMonth: plan.wthDropPerMonth ?? 0,
    upgradeCostPerMonthNzd: plan.upgradeCostPerMonthNzd ?? 0,
    rewardsTo: plan.rewardsTo,
  });
  return { status: 'ok', reason: null, plan, inputs, projection };
}

function miningFlows(mining: ProjectionMining): MiningFlows | null {
  const p = mining.projection;
  if (!p) return null;
  const to = mining.plan.rewardsTo;
  return {
    rewardsTo: to,
    toCrypto: p.months.map((m) => (to === 'crypto' ? m.rewardNzd : 0)),
    toCash: p.months.map((m) => (to === 'cash' ? m.rewardNzd : 0) - m.spendNzd),
    // Money spent on TH and upgrades, and rewards reinvested, become miner value.
    toMining: p.months.map((m) => m.spendNzd + m.reinvestedNzd),
    spendNzd: p.months.map((m) => m.spendNzd),
    recordedIncomeMonthly: mining.inputs?.recordedMiningIncomeMonthlyNzd ?? 0,
  };
}

const INVESTMENTS_SLUG = 'cat-investments';

/** Net money moved into the Investments category (out minus back in) over the window. */
export function investmentsMoved(db: Database, userId: string, from: string, to: string): { total: number; count: number } {
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

/**
 * Asset classes (Settings → Categories & assets) behind each projection class. A projection class
 * is left out when every class behind it is hidden; "other" drops just its hidden parts.
 */
export const PROJECTION_CLASS_PREFS: Record<ProjectionClassKey, AssetClassPrefKey[]> = {
  cash: ['cash'],
  shares: ['stock'],
  kiwiSaver: ['kiwisaver'],
  crypto: ['crypto'],
  mining: ['gomining'],
  metals: ['metal'],
  property: ['real_estate'],
  bonds: ['bonds'],
  other: ['art', 'stone', 'collectable', 'forex', 'commodities'],
};

/** Today's value of each class, from the same net-worth figures as the dashboard, without hidden classes. */
export function classStartValues(nw: Awaited<ReturnType<typeof computeNetWorth>>, prefs?: AssetClassPrefs): ClassStart {
  const on = (key: AssetClassPrefKey) => isAssetClassEnabled(prefs, key);
  const v = (key: AssetClassPrefKey, value: number | null | undefined) => (on(key) ? (value ?? 0) : 0);
  return {
    cash: roundMoney(v('cash', nw.cashNzd)),
    shares: roundMoney(v('stock', nw.stocksNzd)),
    kiwiSaver: roundMoney(v('kiwisaver', nw.kiwiSaverNzd)),
    crypto: roundMoney(v('crypto', nw.cryptoNzd)),
    mining: roundMoney(v('gomining', nw.gominingMinersNzd)),
    metals: roundMoney(v('metal', nw.metalsNzd)),
    property: roundMoney(v('real_estate', nw.realEstateNzd)),
    bonds: roundMoney(v('bonds', nw.bondsNzd)),
    other: roundMoney(v('art', nw.artNzd) + v('stone', nw.stonesNzd) + v('collectable', nw.collectablesNzd) + v('forex', nw.forexNzd) + v('commodities', nw.commoditiesNzd)),
  };
}

/** A projection class whose asset classes are all hidden: nothing at the start, nothing added. */
export function withoutHiddenClasses(classes: ProjectionClassInput[], prefs?: AssetClassPrefs): ProjectionClassInput[] {
  return classes.map((c) => {
    const keys = PROJECTION_CLASS_PREFS[c.key];
    if (!keys || keys.some((k) => isAssetClassEnabled(prefs, k))) return c;
    return {
      ...c,
      startNzd: 0,
      monthlyAdditionNzd: null,
      monthlyAdditionsNzd: undefined,
      additionSource: 'default',
      additionReason: 'Hidden in Settings → Categories & assets, so it is left out.',
    };
  });
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
  mining?: MiningFlows | null;
  /** Bond coupons and maturities (KAN-80, Plus), month by month. */
  bonds?: { couponsNzd: number[]; maturedValueNzd: number[]; principalNzd: number[] } | null;
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
  for (const key of ['crypto', 'mining', 'metals', 'property', 'bonds', 'other'] as const) {
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

  // Mining plan: month-by-month flows into crypto / cash / mining.
  const schedules = new Map<ProjectionClassKey, number[]>();
  const flows = opts.mining;
  if (flows) {
    const mining = additions.get('mining')!;
    if (mining.source !== 'query' && mining.source !== 'saved' && flows.toMining.some((n) => n !== 0)) {
      schedules.set('mining', flows.toMining.map((n) => roundMoney(n)));
      additions.set('mining', { value: null, source: 'user_data', reason: 'TH bought, upgrades and reinvested rewards from your mining plan.' });
    }
    const crypto = additions.get('crypto')!;
    if (flows.toCrypto.some((n) => n !== 0)) {
      schedules.set('crypto', flows.toCrypto.map((n) => roundMoney(n + (crypto.value ?? 0))));
      additions.set('crypto', {
        value: crypto.value,
        source: crypto.source === 'default' ? 'user_data' : crypto.source,
        reason: `${crypto.value ? `${crypto.value.toFixed(2)} a month you set, plus ` : ''}mining rewards kept as BTC (GoMining model).`,
      });
    }
    const cash = additions.get('cash')!;
    const cashSet = query.classAdditions.cash != null || saved.contributions.cash != null;
    if (!cashSet && (flows.toCash.some((n) => n !== 0) || flows.recordedIncomeMonthly !== 0)) {
      schedules.set('cash', flows.toCash.map((n) => roundMoney((cash.value ?? 0) + n - flows.recordedIncomeMonthly)));
      const parts = [cash.reason ?? 'Your monthly budget saving.'];
      if (flows.recordedIncomeMonthly !== 0) parts.push(`Less ${flows.recordedIncomeMonthly.toFixed(2)} a month of recorded Mining income (now projected by the mining model).`);
      if (flows.rewardsTo === 'cash') parts.push('Plus mining rewards sold to cash.');
      if (flows.spendNzd.some((n) => n > 0)) parts.push('Less what you spend on TH and upgrades.');
      additions.set('cash', { value: cash.value, source: cash.source, reason: parts.join(' ') });
    }
  }

  // Bonds (KAN-80): coupons and principal come back into cash on their dates; the holding's value
  // leaves the bond class at maturity. Coupons are paid out, so the class doesn't also grow by default.
  const bondFlows = opts.bonds;
  if (bondFlows) {
    const bonds = additions.get('bonds')!;
    schedules.set('bonds', bondFlows.maturedValueNzd.map((n) => roundMoney((bonds.value ?? 0) - n)));
    additions.set('bonds', { value: bonds.value, source: bonds.source === 'default' ? 'user_data' : bonds.source, reason: 'Each holding leaves at maturity; its coupons and principal go to cash.' });
    const cashSet = query.classAdditions.cash != null || saved.contributions.cash != null;
    if (!cashSet) {
      const cash = additions.get('cash')!;
      const base = schedules.get('cash') ?? new Array(bondFlows.couponsNzd.length).fill(cash.value ?? 0);
      schedules.set('cash', base.map((n, i) => roundMoney(n + (bondFlows.couponsNzd[i] ?? 0) + (bondFlows.principalNzd[i] ?? 0))));
      additions.set('cash', {
        ...cash,
        reason:
          cash.value == null
            ? 'No budget saving is known, so only bond coupons (after RWT) and principal at maturity are added to cash.'
            : `${cash.reason ?? 'Your monthly budget saving.'} Plus bond coupons (after RWT) and principal at maturity.`,
      });
    }
  }

  return PROJECTION_CLASS_KEYS.map((key) => {
    const ownReturn = query.classReturns[key] ?? saved.returns[key] ?? null;
    const returnSource: AssumptionClassSource =
      query.classReturns[key] != null ? 'query' : saved.returns[key] != null ? 'saved' : defaultSource;
    // Coupons are already cash flows; don't grow bonds by the default return as well.
    if (key === 'bonds' && ownReturn == null) {
      const add = additions.get(key)!;
      return {
        key,
        startNzd: start[key],
        annualReturnPercent: 0,
        returnSource: 'default' as const,
        monthlyAdditionNzd: add.value,
        ...(schedules.has(key) ? { monthlyAdditionsNzd: schedules.get(key) } : {}),
        additionSource: add.source,
        additionReason: add.reason,
      };
    }
    const add = additions.get(key)!;
    return {
      key,
      startNzd: start[key],
      annualReturnPercent: ownReturn ?? defaultReturn,
      returnSource,
      monthlyAdditionNzd: add.value,
      ...(schedules.has(key) ? { monthlyAdditionsNzd: schedules.get(key) } : {}),
      ...(query.classGrowth[key] != null
        ? { additionGrowthPercentYear: query.classGrowth[key]!, growthSource: 'query' as const }
        : saved.growth?.[key] != null
          ? { additionGrowthPercentYear: saved.growth[key]!, growthSource: 'saved' as const }
          : {}),
      additionSource: add.source,
      additionReason: add.reason,
    };
  });
}

export function kiwiSaverAmounts(
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
): Promise<ProjectionResult & { mining: ProjectionMining; hiddenClasses: HiddenClass[] }> {
  const netWorth = await computeNetWorth(db, userId);
  const prefs = readAssetClassPrefs(db, userId);
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
  const saved = loadSavedAssumptions(db, userId);
  const cryptoReturn = query.classReturns.crypto ?? saved.returns.crypto ?? query.annualReturnPercent ?? 0;
  const mining = await loadMining({
    db,
    userId,
    months: query.months,
    plan: { ...(saved.mining ?? {}), ...query.mining },
    btcPriceChangePctYear: cryptoReturn,
    recordedIncomeMonthly:
      startBounds && endBounds
        ? roundMoney(recordedMiningIncome(db, userId, startBounds.from, endBounds.to) / query.savingWindowMonths)
        : 0,
  });
  const assetClasses = withoutHiddenClasses(buildClassInputs({
    start: classStartValues(netWorth, prefs),
    query,
    saved,
    // Hidden classes bring no flows either (mining rewards, bond coupons and maturities).
    mining: isAssetClassEnabled(prefs, 'gomining') ? miningFlows(mining) : null,
    bonds: isAssetClassEnabled(prefs, 'bonds') ? bondProjectionFlows(db, userId, asOf, query.months) : null,
    monthlySavingNzd,
    investmentsMonthlyNzd,
    investmentsReason:
      investmentsMonthlyNzd == null
        ? 'No transfers to the Investments budget category in the window.'
        : `Average money moved to the Investments budget category over ${query.savingWindowMonths} month(s) (${invested.count} transaction${invested.count === 1 ? '' : 's'}).`,
    kiwiSaverMonthlyNzd: isAssetClassEnabled(prefs, 'kiwisaver') ? ks.monthlyNzd : null,
  }), prefs);

  const growth =
    query.additionGrowthPct != null
      ? { value: query.additionGrowthPct, source: 'query' as const }
      : saved.additionGrowthPct != null
        ? { value: saved.additionGrowthPct, source: 'saved' as const }
        : { value: 0, source: 'default' as const };
  const result = projectSeries({
    additionGrowthPercentYear: growth.value,
    additionGrowthSource: growth.source,
    assetClasses,
    asOf,
    horizonMonths: query.months,
    compoundingAssetsNzd: roundMoney(netWorth.assetsKnownNzd - netWorth.cashLiabilitiesNzd),
    bankLiabilitiesNzd: netWorth.cashLiabilitiesNzd,
    // A hidden property takes its mortgage with it, as on the Dashboard.
    propertyMortgageNzd: isAssetClassEnabled(prefs, 'real_estate') ? (netWorth.realEstateMortgageNzd ?? 0) : 0,
    kiwiSaverBalanceNzd: isAssetClassEnabled(prefs, 'kiwisaver') ? netWorth.kiwiSaverNzd : null,
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
    kiwiSaverContributionMonthlyNzd: isAssetClassEnabled(prefs, 'kiwisaver') ? ks.monthlyNzd : null,
    kiwiSaverContributionReason: ks.reason,
  });
  // Classes hidden in Settings that hold something, so the page can say what it leaves out.
  return { ...result, mining, hiddenClasses: hiddenTotals(netWorth.breakdown.byClass, prefs).classes };
}
