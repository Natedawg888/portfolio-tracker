/**
 * Educational net-worth and savings projection.
 *
 * Inputs are balances, rates, and cashflow the caller already has.
 * This module does not fetch prices, FX, or a market return.
 *
 * Month 0 is `asOf` (YYYY-MM-DD). Each later point is the same calendar
 * day that many months ahead, clamped to the last day of the month.
 *
 * At the end of each month, in order:
 *   1. Grow each asset class by its own yearly return / 12 (cash, shares & funds,
 *      KiwiSaver, crypto, mining, metals, property, other). A class with no rate of
 *      its own uses annualReturnPercent.
 *   2. Add each class's monthly addition: cash gets the budget saving less what is
 *      moved into other investments; shares & funds get Investments transfers;
 *      KiwiSaver gets the observed contributions. Any class can be overridden.
 *   3. Step each debt with advanceDebtOneMonth (interest, then payment).
 * Without per-class inputs (older callers) all assets form one pot as before.
 *
 * Net worth = compounding assets + signed bank liabilities
 *             − debt balances − property mortgage.
 * Bank liabilities and property mortgages stay at the recorded balance.
 * No inflation adjustment is applied.
 */
import {
  PROJECTION_CLASS_LABELS,
  type ProjectionClassKey,
} from '../../src/lib/projectionClasses.ts';
import {
  advanceDebtOneMonth,
  formatUtcDate,
  isIsoDate,
  projectPayoff,
  roundMoney,
  type InterestPeriod,
} from '../debts/model.ts';

export const DEFAULT_ANNUAL_RETURN_PERCENT = 0;
export const DEFAULT_HORIZON_MONTHS = 12;
export const MAX_HORIZON_MONTHS = 360;
export const DEFAULT_SAVING_WINDOW_MONTHS = 3;
export const MAX_SAVING_WINDOW_MONTHS = 24;
export const MIN_ANNUAL_RETURN_PERCENT = -50;
export const MAX_ANNUAL_RETURN_PERCENT = 50;
export const MAX_MONTHLY_SAVING_NZD = 10_000_000;

export type AssumptionSource = 'user_data' | 'default' | 'query';

export type NumericAssumption = {
  value: number | null;
  source: AssumptionSource;
  reason: string | null;
};

export type ProjectionDebtInput = {
  id: string;
  name: string;
  balanceNzd: number;
  annualRatePercent: number | null;
  interestPeriod: InterestPeriod | null;
  actualPaymentNzd: number | null;
};

export type ObservedSaving = {
  windowMonths: number;
  /** First YYYY-MM in the window. */
  windowStart: string;
  /** Last YYYY-MM in the window. */
  windowEnd: string;
  incomeNzd: number;
  spendingNzd: number;
  monthsWithActivity: number;
  monthlyNzd: number | null;
  reason: string | null;
  /** Monthly take-home from saved pay sources (KAN-70). Null when none are saved. */
  expectedPayMonthlyNzd?: number | null;
  /** True when expected pay stood in for recorded income. */
  usedExpectedPay?: boolean;
};

export type AssumptionClassSource = 'user_data' | 'default' | 'query' | 'saved';

/** One asset class to grow separately. */
export type ProjectionClassInput = {
  key: ProjectionClassKey;
  startNzd: number;
  annualReturnPercent: number;
  returnSource: AssumptionClassSource;
  /** Added at the end of each month. Null = nothing added. */
  monthlyAdditionNzd: number | null;
  /** Month-by-month amounts (index 0 = month 1) when they change over time; overrides monthlyAdditionNzd. */
  monthlyAdditionsNzd?: number[];
  /** This class's yearly step-up of its monthly addition, %. Missing = the projection default. */
  additionGrowthPercentYear?: number;
  growthSource?: AssumptionClassSource;
  additionSource: AssumptionClassSource;
  additionReason: string | null;
};

export type ProjectionClassResult = ProjectionClassInput & {
  label: string;
  endNzd: number;
  /** Total added over the horizon. */
  addedNzd: number;
  /** End − start − added. */
  growthNzd: number;
};

export type ProjectionBuildInput = {
  /** Per-class growth. When set, compoundingAssetsNzd and the saving / KiwiSaver adds are not used separately. */
  assetClasses?: ProjectionClassInput[];
  /**
   * Yearly step-up of what is added each month, % (100 = year 2 adds twice year 1).
   * Applies to each class's monthly addition, not to mining-model flows.
   */
  additionGrowthPercentYear?: number;
  additionGrowthSource?: 'default' | 'query' | 'saved';
  asOf: string;
  horizonMonths: number;
  compoundingAssetsNzd: number;
  /** Signed sum from net worth. Credit and loan accounts are usually negative. */
  bankLiabilitiesNzd: number;
  propertyMortgageNzd: number;
  kiwiSaverBalanceNzd: number | null;
  debts: ProjectionDebtInput[];
  annualReturnPercent: number;
  annualReturnSource: 'default' | 'query';
  /** Amount added each month. Null when it cannot be known and was not supplied. */
  monthlySavingNzd: number | null;
  monthlySavingSource: 'user_data' | 'query';
  monthlySavingReason: string | null;
  observedSaving: ObservedSaving;
  kiwiSaverContributionMonthlyNzd: number | null;
  kiwiSaverContributionReason: string | null;
};

export type ProjectionPoint = {
  date: string;
  monthIndex: number;
  netWorthNzd: number;
  compoundingAssetsNzd: number;
  /** Cumulative budget saving added. Null when no monthly saving is known. */
  savingsAddedNzd: number | null;
  /** Cumulative KiwiSaver contributions added. Null when none were observed. */
  kiwiSaverContributionsAddedNzd: number | null;
  debtOutstandingNzd: number;
  bankLiabilitiesNzd: number;
  propertyMortgageNzd: number;
  /** Value of each asset class at this point (per-class projections only). */
  byClassNzd?: Partial<Record<ProjectionClassKey, number>>;
};

export type ProjectionDebtPath = {
  id: string;
  name: string;
  startingBalanceNzd: number;
  endingBalanceNzd: number;
  annualRatePercent: number | null;
  interestPeriod: InterestPeriod | null;
  actualPaymentNzd: number | null;
  /** True when the balance is stepped with the debt payoff month. */
  stepped: boolean;
  /** True when projectPayoff would reach zero. False when the payment does not cover interest. */
  paysDown: boolean | null;
  reason: string | null;
};

export type ProjectionResult = {
  currency: 'NZD';
  timezone: 'Pacific/Auckland';
  asOf: string;
  horizonMonths: number;
  note: string;
  formula: {
    netWorth: string;
    compoundingAssets: string;
    monthlySaving: string;
    debt: string;
  };
  starting: {
    netWorthNzd: number;
    compoundingAssetsNzd: number;
    bankLiabilitiesNzd: number;
    debtOutstandingNzd: number;
    propertyMortgageNzd: number;
    kiwiSaverNzd: number | null;
  };
  assumptions: {
    annualReturnPercent: NumericAssumption & {
      compounding: 'monthly';
    };
    monthlySavingNzd: NumericAssumption & {
      windowMonths: number;
      windowStart: string;
      windowEnd: string;
      incomeNzd: number | null;
      spendingNzd: number | null;
      monthsWithActivity: number;
      observedMonthlyNzd: number | null;
      expectedPayMonthlyNzd: number | null;
      usedExpectedPay: boolean;
    };
    inflationPercent: NumericAssumption;
    kiwiSaverContributionMonthlyNzd: NumericAssumption;
    dividends: NumericAssumption;
    savingsGoals: NumericAssumption;
  };
  /** Per-class start, return, monthly addition and end value. Empty for single-pot projections. */
  assetClasses: ProjectionClassResult[];
  additionGrowthPercentYear: { value: number; source: 'default' | 'query' | 'saved'; reason: string };
  debts: ProjectionDebtPath[];
  propertyMortgage: {
    balanceNzd: number;
    stepped: false;
    reason: string;
  };
  bankLiabilities: {
    balanceNzd: number;
    stepped: false;
    reason: string;
  };
  points: ProjectionPoint[];
  savings: {
    monthlyNzd: number | null;
    points: Array<{ date: string; monthIndex: number; cumulativeNzd: number }> | null;
  };
};

const NET_WORTH_FORMULA =
  'compoundingAssets + bankLiabilities − debtOutstanding − propertyMortgage';
const ASSET_FORMULA =
  'previous × (1 + annualReturnPercent / 100 / 12) + monthlySaving + kiwiSaverContribution';
const CLASS_ASSET_FORMULA =
  'For each asset class: previous × (1 + class yearly return / 100 / 12) + class monthly addition; compounding assets = sum of classes';
const SAVING_FORMULA =
  '(income − spending) / windowMonths over the complete calendar months before asOf';
const DEBT_FORMULA =
  'Each month adds scheduled interest, then subtracts the saved actual payment. Same order as debt payoff.';

const PROJECTION_NOTE =
  'Educational projection from stored balances, payments, and cashflow. Not a price forecast.';

export function addCalendarMonths(iso: string, months: number): string {
  if (!isIsoDate(iso) || !Number.isInteger(months)) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  const index = m - 1 + months;
  const year = y + Math.floor(index / 12);
  const month = ((index % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  return formatUtcDate(new Date(Date.UTC(year, month, day)));
}

/** Complete YYYY-MM months strictly before the month of `asOf`, oldest first. */
export function completeMonthsBefore(asOf: string, windowMonths: number): string[] {
  if (!isIsoDate(asOf) || !Number.isInteger(windowMonths) || windowMonths < 1) return [];
  const [y, m] = asOf.split('-').map(Number);
  const out: string[] = [];
  for (let i = windowMonths; i >= 1; i -= 1) {
    out.push(formatUtcDate(new Date(Date.UTC(y, m - 1 - i, 1))).slice(0, 7));
  }
  return out;
}

export function observedMonthlySaving(
  windowMonths: number,
  months: Array<{ incomeNzd: number; spendingNzd: number }>,
  asOf: string,
): { monthlyNzd: number | null; incomeNzd: number; spendingNzd: number; monthsWithActivity: number; reason: string | null } {
  let income = 0;
  let spending = 0;
  let active = 0;
  for (const month of months) {
    const inc = Number.isFinite(month.incomeNzd) ? month.incomeNzd : 0;
    const spend = Number.isFinite(month.spendingNzd) ? month.spendingNzd : 0;
    income = roundMoney(income + inc);
    spending = roundMoney(spending + spend);
    if (inc !== 0 || spend !== 0) active += 1;
  }
  if (active === 0) {
    return {
      monthlyNzd: null,
      incomeNzd: income,
      spendingNzd: spending,
      monthsWithActivity: 0,
      reason: `No income or spending is recorded in the ${windowMonths} complete months before ${asOf}.`,
    };
  }
  return {
    monthlyNzd: roundMoney((income - spending) / windowMonths),
    incomeNzd: income,
    spendingNzd: spending,
    monthsWithActivity: active,
    reason: null,
  };
}

/**
 * Saved pay sources stand in for income only when the window has no recorded income.
 * Monthly saving is then expected take-home minus the window's average monthly spending.
 * Recorded income always wins, so saved pay is never counted on top of real pay.
 */
export function savingWithExpectedPay(
  observed: { incomeNzd: number; spendingNzd: number },
  windowMonths: number,
  expected: { monthlyNetNzd: number; count: number } | null,
): { monthlyNzd: number; reason: string } | null {
  if (!expected || observed.incomeNzd > 0 || windowMonths <= 0) return null;
  const spendingMonthly = roundMoney(observed.spendingNzd / windowMonths);
  const sources = expected.count === 1 ? '1 saved pay source' : `${expected.count} saved pay sources`;
  return {
    monthlyNzd: roundMoney(expected.monthlyNetNzd - spendingMonthly),
    reason: `No income is recorded in the window, so expected take-home of $${expected.monthlyNetNzd.toFixed(2)} a month from ${sources} (PAYE page) is used, minus average recorded spending of $${spendingMonthly.toFixed(2)} a month.`,
  };
}

export function observedKiwiSaverMonthly(
  amounts: number[],
  windowMonths: number,
): { monthlyNzd: number | null; reason: string | null } {
  if (amounts.length === 0) {
    return {
      monthlyNzd: null,
      reason:
        'No KiwiSaver contribution transactions are recorded in the window. The employee contribution percent is not converted into dollars.',
    };
  }
  const total = amounts.reduce((sum, amount) => {
    const n = Number(amount);
    return Number.isFinite(n) ? roundMoney(sum + n) : sum;
  }, 0);
  return {
    monthlyNzd: roundMoney(total / windowMonths),
    reason: null,
  };
}

type DebtRun = {
  path: ProjectionDebtPath;
  balance: number;
  annualRatePercent: number;
  actualPayment: number;
  interestPeriod: InterestPeriod | null;
  step: boolean;
};

function prepareDebt(debt: ProjectionDebtInput): DebtRun {
  const balance = roundMoney(Number.isFinite(debt.balanceNzd) ? debt.balanceNzd : 0);
  const base = {
    id: debt.id,
    name: debt.name,
    startingBalanceNzd: balance,
    endingBalanceNzd: balance,
    annualRatePercent: debt.annualRatePercent,
    interestPeriod: debt.interestPeriod,
    actualPaymentNzd: debt.actualPaymentNzd,
  };
  if (!(balance > 0)) {
    return {
      path: {
        ...base,
        endingBalanceNzd: 0,
        stepped: false,
        paysDown: true,
        reason: 'Balance is already zero.',
      },
      balance: 0,
      annualRatePercent: 0,
      actualPayment: 0,
      interestPeriod: debt.interestPeriod,
      step: false,
    };
  }
  const payoff = projectPayoff({
    balance,
    annualRatePercent: debt.annualRatePercent,
    actualPayment: debt.actualPaymentNzd,
    interestPeriod: debt.interestPeriod,
  });
  if (payoff.kind === 'blank') {
    let reason = 'This balance is held because the saved figures are not enough to step it.';
    if (debt.actualPaymentNzd == null) {
      reason = 'No actual payment is saved, so this balance is held.';
    } else if (debt.interestPeriod && (debt.annualRatePercent == null || debt.annualRatePercent < 0)) {
      reason = 'Interest is set to recur but no usable rate is saved, so this balance is held.';
    }
    return {
      path: { ...base, stepped: false, paysDown: null, reason },
      balance,
      annualRatePercent: 0,
      actualPayment: 0,
      interestPeriod: debt.interestPeriod,
      step: false,
    };
  }
  const rate = debt.interestPeriod && debt.annualRatePercent != null ? debt.annualRatePercent : 0;
  const payment = debt.actualPaymentNzd ?? 0;
  if (payoff.kind === 'does_not_pay_down') {
    return {
      path: {
        ...base,
        stepped: true,
        paysDown: false,
        reason:
          'The saved payment does not cover interest. Each month still adds that interest, then subtracts the payment.',
      },
      balance,
      annualRatePercent: rate,
      actualPayment: payment,
      interestPeriod: debt.interestPeriod,
      step: true,
    };
  }
  return {
    path: {
      ...base,
      stepped: true,
      paysDown: true,
      reason: null,
    },
    balance,
    annualRatePercent: rate,
    actualPayment: payment,
    interestPeriod: debt.interestPeriod,
    step: true,
  };
}

function netWorthOf(
  compoundingAssets: number,
  bankLiabilities: number,
  debtOutstanding: number,
  propertyMortgage: number,
): number {
  return roundMoney(compoundingAssets + bankLiabilities - debtOutstanding - propertyMortgage);
}

export function projectSeries(input: ProjectionBuildInput): ProjectionResult {
  const asOf = input.asOf;
  const horizon = input.horizonMonths;
  const bankLiabilities = roundMoney(input.bankLiabilitiesNzd);
  const propertyMortgage = roundMoney(Math.max(0, input.propertyMortgageNzd));
  const classes = input.assetClasses ?? null;
  const classBalances = new Map<ProjectionClassKey, number>(
    (classes ?? []).map((c) => [c.key, roundMoney(c.startNzd)]),
  );
  const classTotal = (): number => roundMoney([...classBalances.values()].reduce((s, v) => s + v, 0));
  let compounding = classes ? classTotal() : roundMoney(input.compoundingAssetsNzd);
  const runs = input.debts.map(prepareDebt);
  const debtOutstanding = (): number =>
    roundMoney(runs.reduce((sum, run) => sum + run.balance, 0));

  const saving = input.monthlySavingNzd;
  const ks = input.kiwiSaverContributionMonthlyNzd;
  const monthlyFactor = 1 + input.annualReturnPercent / 100 / 12;

  const pointAt = (monthIndex: number): ProjectionPoint => ({
    date: addCalendarMonths(asOf, monthIndex),
    monthIndex,
    netWorthNzd: netWorthOf(compounding, bankLiabilities, debtOutstanding(), propertyMortgage),
    compoundingAssetsNzd: compounding,
    savingsAddedNzd: saving == null ? null : roundMoney(saving * monthIndex),
    kiwiSaverContributionsAddedNzd: ks == null ? null : roundMoney(ks * monthIndex),
    debtOutstandingNzd: debtOutstanding(),
    bankLiabilitiesNzd: bankLiabilities,
    propertyMortgageNzd: propertyMortgage,
    ...(classes ? { byClassNzd: Object.fromEntries(classBalances) as Partial<Record<ProjectionClassKey, number>> } : {}),
  });

  const growth = input.additionGrowthPercentYear ?? 0;
  const stepUp = (month: number, pct: number): number => (1 + pct / 100) ** Math.floor((month - 1) / 12);
  const classAdded = new Map<ProjectionClassKey, number>();

  const points: ProjectionPoint[] = [pointAt(0)];
  for (let month = 1; month <= horizon; month += 1) {
    if (classes) {
      for (const c of classes) {
        const grown = (classBalances.get(c.key) ?? 0) * (1 + c.annualReturnPercent / 100 / 12);
        // Step the class's own monthly amount up once a year; schedules (mining flows) are kept as they are.
        const base = c.monthlyAdditionNzd ?? 0;
        const add = (c.monthlyAdditionsNzd?.[month - 1] ?? base) + base * (stepUp(month, c.additionGrowthPercentYear ?? growth) - 1);
        classAdded.set(c.key, (classAdded.get(c.key) ?? 0) + add);
        classBalances.set(c.key, roundMoney(grown + add));
      }
      compounding = classTotal();
    } else {
      compounding = roundMoney(compounding * monthlyFactor);
      if (saving != null) compounding = roundMoney(compounding + saving);
      if (ks != null) compounding = roundMoney(compounding + ks);
    }
    for (const run of runs) {
      if (!run.step) continue;
      const stepped = advanceDebtOneMonth({
        balance: run.balance,
        annualRatePercent: run.annualRatePercent,
        actualPayment: run.actualPayment,
        interestPeriod: run.interestPeriod,
        monthsElapsed: month - 1,
      });
      run.balance = stepped.balance;
    }
    points.push(pointAt(month));
  }

  const debts = runs.map((run) => ({
    ...run.path,
    endingBalanceNzd: run.balance,
  }));

  const returnReason =
    input.annualReturnSource === 'query'
      ? classes
        ? 'Taken from the annualReturnPercent query parameter. Used for asset classes without a return of their own.'
        : 'Taken from the annualReturnPercent query parameter.'
      : classes
        ? 'No default return was supplied, so asset classes without a return of their own use 0%. This is not taken from prices.'
        : 'No annual return was supplied. Compounding uses 0%, so known asset balances are not grown. This is not taken from prices.';

  const assetClasses: ProjectionClassResult[] = (classes ?? []).map((c) => {
    const endNzd = classBalances.get(c.key) ?? 0;
    const addedNzd = roundMoney(classAdded.get(c.key) ?? 0);
    const { monthlyAdditionsNzd: _schedule, ...rest } = c;
    void _schedule;
    return {
      ...rest,
      // A changing schedule is shown as its average; otherwise the year-1 monthly amount.
      monthlyAdditionNzd: c.monthlyAdditionsNzd && horizon > 0 ? roundMoney(addedNzd / horizon) : c.monthlyAdditionNzd,
      label: PROJECTION_CLASS_LABELS[c.key],
      additionGrowthPercentYear: c.additionGrowthPercentYear ?? growth,
      growthSource: c.growthSource ?? input.additionGrowthSource ?? 'default',
      startNzd: roundMoney(c.startNzd),
      endNzd,
      addedNzd,
      growthNzd: roundMoney(endNzd - c.startNzd - addedNzd),
    };
  });

  const savingReason =
    input.monthlySavingReason ??
    (input.monthlySavingSource === 'query'
      ? 'Taken from the monthlySavingNzd query parameter. Budget spending already includes debt repayments, and this amount is not reduced again when a debt balance falls.'
      : 'Income minus spending, divided by the number of complete months in the window. Budget spending already includes debt repayments, and this amount is not reduced again when a debt balance falls.');

  return {
    currency: 'NZD',
    timezone: 'Pacific/Auckland',
    asOf,
    horizonMonths: horizon,
    note: PROJECTION_NOTE,
    formula: {
      netWorth: NET_WORTH_FORMULA,
      compoundingAssets: classes ? CLASS_ASSET_FORMULA : ASSET_FORMULA,
      monthlySaving: SAVING_FORMULA,
      debt: DEBT_FORMULA,
    },
    starting: {
      netWorthNzd: points[0].netWorthNzd,
      compoundingAssetsNzd: points[0].compoundingAssetsNzd,
      bankLiabilitiesNzd: bankLiabilities,
      debtOutstandingNzd: points[0].debtOutstandingNzd,
      propertyMortgageNzd: propertyMortgage,
      kiwiSaverNzd:
        input.kiwiSaverBalanceNzd == null ? null : roundMoney(input.kiwiSaverBalanceNzd),
    },
    assumptions: {
      annualReturnPercent: {
        value: input.annualReturnPercent,
        source: input.annualReturnSource,
        reason: returnReason,
        compounding: 'monthly',
      },
      monthlySavingNzd: {
        value: saving,
        source: input.monthlySavingSource,
        reason: savingReason,
        windowMonths: input.observedSaving.windowMonths,
        windowStart: input.observedSaving.windowStart,
        windowEnd: input.observedSaving.windowEnd,
        incomeNzd: input.observedSaving.incomeNzd,
        spendingNzd: input.observedSaving.spendingNzd,
        monthsWithActivity: input.observedSaving.monthsWithActivity,
        observedMonthlyNzd: input.observedSaving.monthlyNzd,
        expectedPayMonthlyNzd: input.observedSaving.expectedPayMonthlyNzd ?? null,
        usedExpectedPay: input.observedSaving.usedExpectedPay === true,
      },
      inflationPercent: {
        value: null,
        source: 'default',
        reason: 'No inflation rate is stored. Amounts in this projection are not adjusted for inflation.',
      },
      kiwiSaverContributionMonthlyNzd: {
        value: ks,
        source: 'user_data',
        reason:
          input.kiwiSaverContributionReason ??
          'Average of kiwisaver_activity amounts in the saving window. The balance itself is already inside compounding assets.',
      },
      dividends: {
        value: null,
        source: 'user_data',
        reason:
          'Dividend cash already recorded as income is inside the saving figure. Future dividend amounts are not added.',
      },
      savingsGoals: {
        value: null,
        source: 'default',
        reason: 'Savings goals are targets. They are not a cashflow history, so they are not used here.',
      },
    },
    assetClasses,
    additionGrowthPercentYear: {
      value: growth,
      source: input.additionGrowthSource ?? 'default',
      reason:
        growth === 0
          ? 'Monthly additions stay the same every year.'
          : `Each class's monthly addition goes up ${growth}% at the start of each new year (year 2 = year 1 × ${Math.round((1 + growth / 100) * 100) / 100}), unless the class has its own increase. Mining-model flows are not stepped up.`,
    },
    debts,
    propertyMortgage: {
      balanceNzd: propertyMortgage,
      stepped: false,
      reason:
        'Property mortgage balances are stored without a rate or payment, so they stay at the recorded amount.',
    },
    bankLiabilities: {
      balanceNzd: bankLiabilities,
      stepped: false,
      reason:
        'Credit and loan account balances have no rate or payment stored on the account, so they stay at the recorded amount.',
    },
    points,
    savings: {
      monthlyNzd: saving,
      points:
        saving == null
          ? null
          : points.map((point) => ({
              date: point.date,
              monthIndex: point.monthIndex,
              cumulativeNzd: point.savingsAddedNzd ?? 0,
            })),
    },
  };
}
