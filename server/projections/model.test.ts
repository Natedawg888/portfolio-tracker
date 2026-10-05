/**
 * Projection formulas. Amounts are the ones passed in.
 * Run: npm run test:projections
 */
import { projectPayoff } from '../debts/model.ts';
import {
  addCalendarMonths,
  completeMonthsBefore,
  observedKiwiSaverMonthly,
  observedMonthlySaving,
  projectSeries,
  type ProjectionBuildInput,
} from './model.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function eq(actual: number | null | undefined, expected: number, msg: string): void {
  if (actual == null || Math.abs(actual - expected) > 1e-9) {
    throw new Error(`FAIL: ${msg} (got ${actual}, expected ${expected})`);
  }
}

assert(addCalendarMonths('2026-01-31', 1) === '2026-02-28', '31 January moves to 28 February');
assert(addCalendarMonths('2026-01-31', 2) === '2026-03-31', 'the original day returns in March');
assert(addCalendarMonths('2024-01-31', 1) === '2024-02-29', 'a leap-year February keeps the 29th');
assert(
  JSON.stringify(completeMonthsBefore('2026-10-05', 3)) === JSON.stringify(['2026-07', '2026-08', '2026-09']),
  'the window is the complete months before asOf',
);

const quiet = observedMonthlySaving(
  3,
  [
    { incomeNzd: 0, spendingNzd: 0 },
    { incomeNzd: 0, spendingNzd: 0 },
    { incomeNzd: 0, spendingNzd: 0 },
  ],
  '2026-10-05',
);
assert(quiet.monthlyNzd == null, 'a window with no cashflow does not become a zero rate');
assert(quiet.reason != null && quiet.reason.includes('2026-10-05'), 'the empty window names the as-of date');

const mixed = observedMonthlySaving(
  3,
  [
    { incomeNzd: 1000, spendingNzd: 400 },
    { incomeNzd: 0, spendingNzd: 0 },
    { incomeNzd: 500, spendingNzd: 500 },
  ],
  '2026-10-05',
);
eq(mixed.incomeNzd, 1500, 'window income sums the months');
eq(mixed.spendingNzd, 900, 'window spending sums the months');
eq(mixed.monthsWithActivity, 2, 'a zero month is not activity');
eq(mixed.monthlyNzd, 200, 'the quiet month stays in the divisor');

const ksEmpty = observedKiwiSaverMonthly([], 3);
assert(ksEmpty.monthlyNzd == null, 'no KiwiSaver rows do not become a zero contribution');
assert(ksEmpty.reason != null && ksEmpty.reason.includes('percent'), 'the employee percent is not used as dollars');
eq(observedKiwiSaverMonthly([150, 150], 3).monthlyNzd ?? NaN, 100, 'contributions are averaged across the window');

function baseInput(overrides: Partial<ProjectionBuildInput> = {}): ProjectionBuildInput {
  return {
    asOf: '2026-10-05',
    horizonMonths: 2,
    compoundingAssetsNzd: 10000,
    bankLiabilitiesNzd: 0,
    propertyMortgageNzd: 0,
    kiwiSaverBalanceNzd: null,
    debts: [
      {
        id: 'debt_loan',
        name: 'Loan',
        balanceNzd: 1200,
        annualRatePercent: 12,
        interestPeriod: 'month',
        actualPaymentNzd: 200,
      },
    ],
    annualReturnPercent: 12,
    annualReturnSource: 'query',
    monthlySavingNzd: 500,
    monthlySavingSource: 'query',
    monthlySavingReason: null,
    observedSaving: {
      windowMonths: 3,
      windowStart: '2026-07',
      windowEnd: '2026-09',
      incomeNzd: 0,
      spendingNzd: 0,
      monthsWithActivity: 0,
      monthlyNzd: null,
      reason: 'No income or spending is recorded in the 3 complete months before 2026-10-05.',
    },
    kiwiSaverContributionMonthlyNzd: null,
    kiwiSaverContributionReason: 'No KiwiSaver contribution transactions are recorded in the window.',
    ...overrides,
  };
}

const grown = projectSeries(baseInput());
assert(grown.currency === 'NZD', 'currency is NZD');
assert(grown.timezone === 'Pacific/Auckland', 'timezone is Pacific/Auckland');
assert(grown.points.length === 3, 'horizon includes the starting month');
eq(grown.points[0].netWorthNzd, 8800, 'month 0 is assets minus the debt');
eq(grown.points[0].debtOutstandingNzd, 1200, 'month 0 debt is the saved balance');
eq(grown.points[1].compoundingAssetsNzd, 10600, 'month 1 compounds 1% then adds saving');
eq(grown.points[1].debtOutstandingNzd, 1012, 'month 1 interest is 12 then the payment is 200');
eq(grown.points[1].netWorthNzd, 9588, 'month 1 net worth uses the new asset and debt balances');
eq(grown.points[1].savingsAddedNzd, 500, 'saving added is the monthly amount once');
eq(grown.points[2].compoundingAssetsNzd, 11206, 'month 2 compounds the new asset balance');
eq(grown.points[2].debtOutstandingNzd, 822.12, 'month 2 interest is 10.12 on 1012');
eq(grown.points[2].netWorthNzd, 10383.88, 'month 2 net worth is assets minus the remaining debt');
assert(grown.points[1].date === '2026-11-05', 'the next point is one calendar month ahead');
assert(grown.assumptions.annualReturnPercent.source === 'query', 'a supplied return is labelled query');
assert(grown.assumptions.annualReturnPercent.value === 12, 'the supplied return is kept');
assert(grown.assumptions.inflationPercent.value == null, 'inflation is not given a number');
assert(grown.assumptions.inflationPercent.source === 'default', 'inflation source is the default of none');
assert(grown.assumptions.dividends.value == null, 'dividends are not given a separate amount');
assert(grown.assumptions.savingsGoals.value == null, 'savings goals are not given an amount');
assert(grown.savings.points != null && grown.savings.points[2].cumulativeNzd === 1000, 'cumulative saving is the monthly amount times months');

const cleared = projectPayoff({
  balance: 1000,
  annualRatePercent: null,
  actualPayment: 100,
  interestPeriod: null,
});
assert(cleared.kind === 'debt_free', '1000 at 100 a month pays off');
const payoffMonths = cleared.kind === 'debt_free' ? cleared.totalMonths : -1;
const paid = projectSeries(baseInput({
  horizonMonths: 12,
  annualReturnPercent: 0,
  annualReturnSource: 'default',
  monthlySavingNzd: 0,
  debts: [
    {
      id: 'debt_plain',
      name: 'Plain',
      balanceNzd: 1000,
      annualRatePercent: null,
      interestPeriod: null,
      actualPaymentNzd: 100,
    },
  ],
}));
eq(paid.points[payoffMonths].debtOutstandingNzd, 0, 'the debt reaches zero in the same month count as payoff');
eq(paid.points[payoffMonths + 1].debtOutstandingNzd, 0, 'a cleared debt stays at zero');
assert(paid.debts[0].paysDown === true, 'a payment that clears the debt is marked paysDown');
eq(paid.points[12].compoundingAssetsNzd, 10000, 'a zero return leaves the asset balance unchanged when saving is zero');

const flat = projectSeries(baseInput({
  horizonMonths: 6,
  annualReturnPercent: 0,
  monthlySavingNzd: 0,
  debts: [
    {
      id: 'debt_flat',
      name: 'Card',
      balanceNzd: 1000,
      annualRatePercent: 12,
      interestPeriod: 'month',
      actualPaymentNzd: 10,
    },
  ],
}));
assert(flat.debts[0].paysDown === false, 'a payment that only covers interest does not pay the debt down');
eq(flat.points[6].debtOutstandingNzd, 1000, 'interest then the matching payment leaves the balance unchanged');

const rising = projectSeries(baseInput({
  horizonMonths: 1,
  annualReturnPercent: 0,
  monthlySavingNzd: 0,
  debts: [
    {
      id: 'debt_rise',
      name: 'Card',
      balanceNzd: 1000,
      annualRatePercent: 12,
      interestPeriod: 'month',
      actualPaymentNzd: 5,
    },
  ],
}));
eq(rising.points[1].debtOutstandingNzd, 1005, 'a payment below interest leaves a higher balance');

const held = projectSeries(baseInput({
  horizonMonths: 4,
  annualReturnPercent: 0,
  monthlySavingNzd: 0,
  debts: [
    {
      id: 'debt_hold',
      name: 'Unknown',
      balanceNzd: 1000,
      annualRatePercent: null,
      interestPeriod: null,
      actualPaymentNzd: null,
    },
  ],
}));
assert(held.debts[0].stepped === false, 'a debt with no payment is not stepped');
eq(held.points[4].debtOutstandingNzd, 1000, 'a debt with no payment keeps its balance');
assert(held.debts[0].reason != null && held.debts[0].reason.includes('payment'), 'the hold reason names the missing payment');

const yearly = projectSeries(baseInput({
  horizonMonths: 6,
  annualReturnPercent: 0,
  monthlySavingNzd: 0,
  debts: [
    {
      id: 'debt_year',
      name: 'Yearly',
      balanceNzd: 1000,
      annualRatePercent: 10,
      interestPeriod: 'year',
      actualPaymentNzd: 200,
    },
  ],
}));
eq(yearly.points[1].debtOutstandingNzd, 900, 'yearly interest is added on the first projected month');
eq(yearly.points[6].debtOutstandingNzd, 0, 'monthly payments then clear the balance');

const unknownSaving = projectSeries(baseInput({
  horizonMonths: 2,
  annualReturnPercent: 0,
  annualReturnSource: 'default',
  monthlySavingNzd: null,
  monthlySavingSource: 'user_data',
  monthlySavingReason: 'No income or spending is recorded in the 3 complete months before 2026-10-05.',
  debts: [],
  compoundingAssetsNzd: 250,
}));
assert(unknownSaving.savings.points == null, 'unknown saving does not produce a saving series');
assert(unknownSaving.assumptions.monthlySavingNzd.value == null, 'unknown saving stays null');
assert(unknownSaving.assumptions.monthlySavingNzd.source === 'user_data', 'the missing rate is labelled as user data');
eq(unknownSaving.points[2].netWorthNzd, 250, 'assets are not given a made-up saving amount');
assert(unknownSaving.assumptions.annualReturnPercent.source === 'default', 'an omitted return is the default');
eq(unknownSaving.assumptions.annualReturnPercent.value, 0, 'the default return is zero');

const liabilities = projectSeries(baseInput({
  horizonMonths: 3,
  annualReturnPercent: 12,
  monthlySavingNzd: 0,
  compoundingAssetsNzd: 10000,
  bankLiabilitiesNzd: -200,
  propertyMortgageNzd: 80000,
  debts: [],
  kiwiSaverContributionMonthlyNzd: 100,
  kiwiSaverContributionReason: null,
  kiwiSaverBalanceNzd: 4000,
}));
eq(liabilities.points[0].netWorthNzd, 10000 - 200 - 80000, 'starting net worth subtracts both liabilities');
eq(liabilities.points[3].bankLiabilitiesNzd, -200, 'bank liabilities are not compounded');
eq(liabilities.points[3].propertyMortgageNzd, 80000, 'the property mortgage is not amortised');
eq(liabilities.points[1].kiwiSaverContributionsAddedNzd, 100, 'an observed KiwiSaver contribution is added once');
eq(liabilities.points[1].compoundingAssetsNzd, 10200, 'the contribution is added after the 1% compound step');
assert(liabilities.propertyMortgage.stepped === false, 'the mortgage path says it is not stepped');
assert(liabilities.assumptions.kiwiSaverContributionMonthlyNzd.source === 'user_data', 'KiwiSaver contribution source is user data');

const endOfMonth = projectSeries(baseInput({
  asOf: '2026-01-31',
  horizonMonths: 2,
  annualReturnPercent: 0,
  monthlySavingNzd: null,
  monthlySavingSource: 'user_data',
  debts: [],
}));
assert(endOfMonth.points[1].date === '2026-02-28', 'January 31 projects to February 28');
assert(endOfMonth.points[2].date === '2026-03-31', 'March keeps the 31st');

const text = JSON.stringify(grown).toLowerCase();
assert(!/\b(buy|sell|recommend)\b/.test(text), 'the projection does not use buy, sell, or recommend');
assert(!text.includes('should invest'), 'the projection does not tell the reader to invest');

console.log('projection model tests ok');
