/**
 * Interest is posted on period starts from the rate and balance given.
 * The payoff line uses only the balance, rate, and payment given.
 * Run: npm run test:debts
 */
import {
  debtToIncomeRatio,
  paymentSliderRange,
  payoffSchedule,
  projectedPaymentMonth,
  sliderPayment,
  interestForPeriod,
  payoffSentence,
  periodStartsAfter,
  projectPayoff,
  rollScheduledInterest,
} from './model.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function eq(actual: number | null, expected: number, msg: string): void {
  if (actual == null || Math.abs(actual - expected) > 1e-6) {
    throw new Error(`FAIL: ${msg} (got ${actual}, expected ${expected})`);
  }
}

const monthly = rollScheduledInterest({
  balance: 1200,
  annualRatePercent: 12,
  interestPeriod: 'month',
  postedThrough: null,
  asOf: '2026-10-05',
});
assert(monthly.appliedStarts.length === 0, 'monthly interest is not added mid-month when the schedule starts');
eq(monthly.balance, 1200, 'balance stays the entered balance before the next month start');
assert(monthly.postedThrough === '2026-10-05', 'cursor waits until the next month start');

const monthEnd = rollScheduledInterest({
  balance: 1200,
  annualRatePercent: 12,
  interestPeriod: 'month',
  postedThrough: monthly.postedThrough,
  asOf: '2026-10-31',
});
assert(monthEnd.appliedStarts.length === 0, 'monthly interest is not added at the end of the month');
eq(monthEnd.balance, 1200, 'end of month does not change the balance');

const nov1 = rollScheduledInterest({
  balance: monthEnd.balance,
  annualRatePercent: 12,
  interestPeriod: 'month',
  postedThrough: monthEnd.postedThrough,
  asOf: '2026-11-01',
});
assert(
  nov1.appliedStarts.length === 1 && nov1.appliedStarts[0] === '2026-11-01',
  'monthly interest is added on the 1st',
);
eq(nov1.interestAdded, interestForPeriod(1200, 12, 'month'), 'November interest is one twelfth of the annual percent');
eq(nov1.balance, 1212, 'November balance is the entered balance plus that interest');

const novAgain = rollScheduledInterest({
  balance: nov1.balance,
  annualRatePercent: 12,
  interestPeriod: 'month',
  postedThrough: nov1.postedThrough,
  asOf: '2026-11-01',
});
assert(novAgain.appliedStarts.length === 0, 'the same month start is not posted twice');
eq(novAgain.balance, 1212, 'repeating the 1st does not add interest again');

const twoMonths = rollScheduledInterest({
  balance: 1200,
  annualRatePercent: 12,
  interestPeriod: 'month',
  postedThrough: '2026-10-05',
  asOf: '2026-12-01',
});
assert(
  twoMonths.appliedStarts.join(',') === '2026-11-01,2026-12-01',
  'missed month starts are applied in order',
);
eq(twoMonths.balance, 1224.12, 'the second month uses the balance after the first month start');

const noRate = rollScheduledInterest({
  balance: 1200,
  annualRatePercent: null,
  interestPeriod: 'month',
  postedThrough: null,
  asOf: '2026-11-02',
});
eq(noRate.balance, 1200, 'a missing rate does not change the balance');
assert(noRate.appliedStarts.length === 0, 'a missing rate posts nothing');
assert(noRate.postedThrough === '2026-11-02', 'a missed month start is not kept for a later rate');

const rateAfterSkip = rollScheduledInterest({
  balance: noRate.balance,
  annualRatePercent: 12,
  interestPeriod: 'month',
  postedThrough: noRate.postedThrough,
  asOf: '2026-11-02',
});
assert(rateAfterSkip.appliedStarts.length === 0, 'entering a rate after the 1st does not backfill that month');

const yearlyStart = rollScheduledInterest({
  balance: 5000,
  annualRatePercent: 10,
  interestPeriod: 'year',
  postedThrough: null,
  asOf: '2026-06-15',
});
assert(yearlyStart.appliedStarts.length === 0, 'yearly interest is not added mid-year when the schedule starts');
eq(yearlyStart.balance, 5000, 'mid-year start leaves the entered balance');

const yearEnd = rollScheduledInterest({
  balance: yearlyStart.balance,
  annualRatePercent: 10,
  interestPeriod: 'year',
  postedThrough: yearlyStart.postedThrough,
  asOf: '2026-12-31',
});
assert(yearEnd.appliedStarts.length === 0, 'yearly interest is not added on the last day of the year');
eq(yearEnd.balance, 5000, '31 December does not add yearly interest');

const jan1 = rollScheduledInterest({
  balance: yearEnd.balance,
  annualRatePercent: 10,
  interestPeriod: 'year',
  postedThrough: yearEnd.postedThrough,
  asOf: '2027-01-01',
});
assert(jan1.appliedStarts.length === 1 && jan1.appliedStarts[0] === '2027-01-01', 'yearly interest is added on 1 January');
eq(jan1.interestAdded, 500, 'yearly interest is the full annual percent of the entered balance');
eq(jan1.balance, 5500, '1 January balance includes that interest');

const feb1 = rollScheduledInterest({
  balance: jan1.balance,
  annualRatePercent: 10,
  interestPeriod: 'year',
  postedThrough: jan1.postedThrough,
  asOf: '2027-02-01',
});
assert(feb1.appliedStarts.length === 0, 'a yearly schedule does not add interest on a later month start');
eq(feb1.balance, 5500, '1 February leaves the January balance unchanged');

assert(
  periodStartsAfter('2026-10-05', '2026-10-31', 'month').length === 0,
  'October has no month start after the 5th',
);
assert(
  periodStartsAfter('2026-10-31', '2026-11-01', 'month')[0] === '2026-11-01',
  'the next month start is the 1st',
);

const fortyFour = projectPayoff({
  balance: 4400,
  annualRatePercent: null,
  actualPayment: 100,
  interestPeriod: null,
});
assert(fortyFour.kind === 'debt_free' && fortyFour.totalMonths === 44, '4400 at 100 a month is 44 months');
assert(
  payoffSentence(fortyFour) === 'At your current repayment rate: Debt-free in 3 years 8 months.',
  'the example sentence is the span of the entered balance and payment',
);

const tenMonths = projectPayoff({
  balance: 1000,
  annualRatePercent: null,
  actualPayment: 100,
  interestPeriod: null,
});
assert(tenMonths.kind === 'debt_free' && tenMonths.totalMonths === 10, '1000 at 100 a month is 10 months');
assert(
  payoffSentence(tenMonths) === 'At your current repayment rate: Debt-free in 10 months.',
  'a different balance does not reuse 3 years 8 months',
);

const ignoresUnusedRate = projectPayoff({
  balance: 1200,
  annualRatePercent: 99,
  actualPayment: 100,
  interestPeriod: null,
});
assert(
  ignoresUnusedRate.kind === 'debt_free' && ignoresUnusedRate.totalMonths === 12,
  'a rate is ignored unless interest is set to recur',
);

const monthlyShort = projectPayoff({
  balance: 100,
  annualRatePercent: 12,
  actualPayment: 50,
  interestPeriod: 'month',
});
assert(monthlyShort.kind === 'debt_free' && monthlyShort.totalMonths === 3, 'monthly payoff uses the entered rate and payment');
assert(
  payoffSentence(monthlyShort) === 'At your current repayment rate: Debt-free in 3 months.',
  'monthly payoff text follows the counted months',
);

const monthlyFlat = projectPayoff({
  balance: 1000,
  annualRatePercent: 12,
  actualPayment: 10,
  interestPeriod: 'month',
});
assert(monthlyFlat.kind === 'does_not_pay_down', 'a monthly payment that equals interest does not pay the debt down');
assert(
  payoffSentence(monthlyFlat) === 'At your current repayment rate: this debt does not pay down.',
  'the payoff line says the debt does not pay down',
);

const yearlyShort = projectPayoff({
  balance: 1000,
  annualRatePercent: 10,
  actualPayment: 200,
  interestPeriod: 'year',
});
assert(
  yearlyShort.kind === 'debt_free' && yearlyShort.totalMonths === 6,
  'yearly interest is added once at the start, then monthly payments reduce the balance',
);

const yearlyFlat = projectPayoff({
  balance: 10000,
  annualRatePercent: 12,
  actualPayment: 100,
  interestPeriod: 'year',
});
assert(
  yearlyFlat.kind === 'does_not_pay_down',
  'twelve monthly payments that only match yearly interest do not pay the debt down',
);

const missingPayment = projectPayoff({
  balance: 4400,
  annualRatePercent: null,
  actualPayment: null,
  interestPeriod: null,
});
assert(missingPayment.kind === 'blank', 'a missing payment does not become a payoff date');
assert(payoffSentence(missingPayment) == null, 'a missing payment leaves the payoff line blank');

const missingRate = projectPayoff({
  balance: 4400,
  annualRatePercent: null,
  actualPayment: 100,
  interestPeriod: 'month',
});
assert(missingRate.kind === 'blank', 'recurring interest without a rate does not assume 0%');

assert(debtToIncomeRatio(400, null) == null, 'debt-to-income is blank when income is missing');
assert(debtToIncomeRatio(null, 4000) == null, 'debt-to-income is blank when the actual payment is missing');
eq(debtToIncomeRatio(400, 4000), 0.1, 'debt-to-income divides the entered payment by the recorded income');

// payoffSchedule: same months as projectPayoff, with a smaller final payment.
const plain = payoffSchedule({ balance: 1000, annualRatePercent: null, actualPayment: 300, interestPeriod: null });
assert(plain.kind === 'schedule', 'no-interest debt has a schedule');
if (plain.kind === 'schedule') {
  eq(plain.totalMonths, 4, '1000 at 300/month takes 4 payments');
  assert(plain.payments.join() === '300,300,300,100', 'final payment is the remainder');
}
const withInterest = { balance: 5000, annualRatePercent: 12, actualPayment: 250, interestPeriod: 'month' as const };
const sched = payoffSchedule(withInterest);
const proj = projectPayoff(withInterest);
assert(sched.kind === 'schedule' && proj.kind === 'debt_free', 'monthly interest schedule exists');
if (sched.kind === 'schedule' && proj.kind === 'debt_free') {
  eq(sched.totalMonths, proj.totalMonths, 'schedule length matches projectPayoff');
  assert(sched.payments.slice(0, -1).every((p) => p === 250), 'every payment but the last is the full payment');
  assert(sched.payments[sched.payments.length - 1] <= 250, 'last payment is at most the full payment');
}
assert(
  payoffSchedule({ balance: 5000, annualRatePercent: 12, actualPayment: 50, interestPeriod: 'month' }).kind === 'does_not_pay_down',
  'payment under the interest does not pay down',
);
assert(payoffSchedule({ balance: 500, annualRatePercent: null, actualPayment: null, interestPeriod: null }).kind === 'blank', 'no payment is blank');

// End-month assumption: first payment next month.
assert(projectedPaymentMonth('2026-10-12', 1) === '2026-11', 'first payment is next month');
assert(projectedPaymentMonth('2026-10-12', 4) === '2027-02', 'fourth payment crosses the year');
assert(projectedPaymentMonth('2026-12-31', 1) === '2027-01', 'December rolls to January');

// Slider range.
const range = paymentSliderRange({ currentPayment: 250, balance: 5000, annualRatePercent: 12, interestPeriod: 'month' });
assert(range != null, 'slider range exists');
if (range) {
  eq(range.step, 10, '$10 steps for a $250 payment');
  eq(sliderPayment(250, range, 0), 250, 'position 0 is the saved payment');
  assert(sliderPayment(250, range, range.minOffset) > 50, 'lowest slider payment still covers the $50 interest');
  eq(sliderPayment(250, range, range.minOffset), 60, 'lowest is the first step above the interest');
  eq(sliderPayment(250, range, range.maxOffset), 750, 'highest is 3 × the payment');
}
const small = paymentSliderRange({ currentPayment: 300, balance: 400, annualRatePercent: null, interestPeriod: null });
assert(small != null && sliderPayment(300, small, small.maxOffset) === 400, 'highest is capped at the balance');
assert(paymentSliderRange({ currentPayment: 0, balance: 400, annualRatePercent: null, interestPeriod: null }) == null, 'no payment, no slider');

console.log('debt model tests ok');
