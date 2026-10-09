/**
 * Compound interest calculator (KAN-57). Run: npm run test:compound
 */
import { calculateCompound, type CompoundInput } from './compoundInterest.ts';

function near(a: number, b: number, msg: string, tol = 0.01): void {
  if (Math.abs(a - b) > tol) throw new Error(`FAIL: ${msg} (got ${a}, expected ${b})`);
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const base: CompoundInput = {
  principal: 10000,
  ratePct: 5,
  compounding: 'yearly',
  contribution: 0,
  contributionFrequency: 'monthly',
  contributeAtStart: false,
  contributionIncreasePct: 0,
  years: 10,
  months: 0,
};

// Lump sum: P(1 + r/n)^(nt).
near(calculateCompound(base).futureValue, 10000 * 1.05 ** 10, 'yearly compounding'); // 16,288.95
near(calculateCompound({ ...base, compounding: 'monthly' }).futureValue, 10000 * (1 + 0.05 / 12) ** 120, 'monthly compounding'); // 16,470.09
near(calculateCompound({ ...base, compounding: 'daily' }).futureValue, 10000 * (1 + 0.05 / 365) ** 3650, 'daily compounding');
near(calculateCompound({ ...base, compounding: 'monthly' }).effectiveAnnualRatePct, 5.1162, 'effective annual rate', 0.0001);

// Regular contributions: C((1+i)^N − 1)/i, ×(1+i) when paid at the start.
const annuity = (100 * ((1.005 ** 120 - 1) / 0.005));
const endPay = calculateCompound({ ...base, principal: 0, ratePct: 6, compounding: 'monthly', contribution: 100 });
near(endPay.futureValue, annuity, '$100/month at the end of each month, 6%'); // 16,387.93
near(endPay.totalContributed, 12000, '120 payments of $100');
near(endPay.totalInterest, annuity - 12000, 'interest = value − contributed');
near(calculateCompound({ ...base, principal: 0, ratePct: 6, compounding: 'monthly', contribution: 100, contributeAtStart: true }).futureValue, annuity * 1.005, 'paid at the start earns one more month');

// Compounding and contribution frequencies that differ: daily interest, monthly payments.
{
  const i = (1 + 0.05 / 365) ** (365 / 12) - 1;
  const expected = 200 * (((1 + i) ** 60 - 1) / i);
  near(calculateCompound({ ...base, principal: 0, compounding: 'daily', contribution: 200, years: 5 }).futureValue, expected, 'daily compounding with monthly payments');
}

// 0% and contribution increases.
near(calculateCompound({ ...base, principal: 1000, ratePct: 0, contribution: 50, years: 2 }).futureValue, 1000 + 24 * 50, '0% just adds up');
near(
  calculateCompound({ ...base, principal: 0, ratePct: 0, contribution: 1000, contributionFrequency: 'yearly', contributionIncreasePct: 100, years: 2 }).futureValue,
  3000,
  'contributions double in year 2',
);

// Part years: interest keeps growing for the leftover months.
{
  const r = calculateCompound({ ...base, principal: 0, ratePct: 10, contribution: 1000, contributionFrequency: 'yearly', years: 1, months: 6 });
  near(r.futureValue, 1000 * 1.1 ** 0.5, 'half a year of interest after the last payment');
  assert(r.rows.length === 2 && r.rows[0].months === 12 && r.rows[1].months === 18, 'a row per year plus the part year');
}

// Year-by-year rows.
{
  const r = calculateCompound(base);
  assert(r.rows.length === 10, 'ten yearly rows');
  near(r.rows[0].balance, 10500, 'year 1');
  near(r.rows[9].balance, r.futureValue, 'last row is the result');
  near(calculateCompound({ ...base, years: 0, months: 0 }).futureValue, 10000, 'no time = no growth');
}

// Negative rate shrinks the balance.
assert(calculateCompound({ ...base, ratePct: -2 }).futureValue < 10000, 'negative rate');

// Tax on returns: 28% PIR on 5% → 3.6% a year after tax.
{
  const r = calculateCompound({ ...base, taxPct: 28 });
  near(r.futureValue, 10000 * 1.036 ** 10, '28% tax on 5% interest = 3.6% net');
  near(r.totalTax / r.grossInterest, 0.28, 'tax is about 28% of interest earned', 0.01);
  const yearly = calculateCompound({ ...base, contributionFrequency: 'yearly', taxPct: 28, years: 1 });
  near(yearly.totalTax, 500 * 0.28, 'one year, yearly crediting: exactly 28% of 500');
  near(r.totalInterest, r.grossInterest - r.totalTax, 'net interest = gross − tax');
}

// Management fee: 1% a year of the balance, after interest.
{
  const r = calculateCompound({ ...base, contributionFrequency: 'yearly', years: 1, feePctYear: 1 });
  near(r.futureValue, 10500 - 105, '10,000 → 10,500, less 1% fee (105)');
  near(r.totalFees, 105, 'fee total');
  const ten = calculateCompound({ ...base, contributionFrequency: 'yearly', feePctYear: 1 });
  const monthly = calculateCompound({ ...base, years: 1, feePctYear: 1 });
  assert(monthly.totalFees > 100 && monthly.totalFees < 105, 'charged monthly: about 1% of the average balance through the year');
  near(ten.futureValue, 10000 * (1.05 * 0.99) ** 10, 'compounds year on year');
}

// Fixed fee: $5 a month = $60 a year; monthly steps spread it evenly.
{
  const r = calculateCompound({ ...base, principal: 1000, ratePct: 0, years: 1, compounding: 'monthly', fixedFee: 5, fixedFeePer: 'month' });
  near(r.futureValue, 940, '$1,000 at 0% less $60 of fees');
  near(r.totalFees, 60, 'twelve $5 fees');
  near(r.rows[0].fees, 60, 'shown in the yearly row');
  const drained = calculateCompound({ ...base, principal: 50, ratePct: 0, years: 2, fixedFee: 100, fixedFeePer: 'year' });
  near(drained.futureValue, 0, 'fees never take the balance below zero');
}

// Tax and fees together, and no tax on losses.
{
  const both = calculateCompound({ ...base, taxPct: 28, feePctYear: 0.5 });
  assert(both.futureValue < calculateCompound({ ...base, taxPct: 28 }).futureValue, 'fees lower the result further');
  near(calculateCompound({ ...base, ratePct: -2, taxPct: 28 }).totalTax, 0, 'no tax on negative returns');
}

console.log('compound interest tests ok');
