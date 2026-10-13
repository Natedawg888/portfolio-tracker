/**
 * Mortgage calculator (KAN-56). Run: npm run test:mortgage
 */
import { calculateMortgage, mortgageInputError, shareOfTakeHome } from './mortgageCalc.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}

// $500,000 at 6% over 30 years, monthly: the standard figure is $2,997.75.
const monthly = calculateMortgage({ principal: 500_000, ratePct: 6, years: 30, frequency: 'monthly' })!;
eq(monthly.repayment, 2997.75, 'monthly repayment');
eq(monthly.repayments, 360, '360 repayments');
eq(monthly.totalInterest, 579190.95, 'total interest');
eq(monthly.totalRepaid, 1079190.95, 'total repaid = loan + interest');
eq(monthly.perYear, 35973.03, 'per year');

// Weekly charges interest weekly at 6%/52, so it costs a little less interest overall.
const weekly = calculateMortgage({ principal: 500_000, ratePct: 6, years: 30, frequency: 'weekly' })!;
eq(weekly.repayments, 1560, '1,560 weekly repayments');
eq(weekly.repayment, 691.32, 'weekly repayment (500,000 × i ÷ (1 − (1 + i)^−1560), i = 0.06/52)');
eq(weekly.totalInterest < monthly.totalInterest, true, 'weekly pays less interest than monthly');

const fortnightly = calculateMortgage({ principal: 500_000, ratePct: 6, years: 30, frequency: 'fortnightly' })!;
eq(fortnightly.repayments, 780, '780 fortnightly repayments');
eq(fortnightly.repayment > weekly.repayment && fortnightly.repayment < monthly.repayment, true, 'fortnightly between weekly and monthly');

const free = calculateMortgage({ principal: 360_000, ratePct: 0, years: 30, frequency: 'monthly' })!;
eq(free.repayment, 1000, '0% splits the loan evenly');
eq(free.totalInterest, 0, 'no interest at 0%');

eq(mortgageInputError({ principal: 0, ratePct: 6, years: 30 }), 'Enter the loan amount.', 'amount needed');
eq(mortgageInputError({ principal: 1, ratePct: 31, years: 30 }), 'Enter an interest rate from 0% to 30%.', 'rate range');
eq(mortgageInputError({ principal: 1, ratePct: NaN, years: 30 }), 'Enter an interest rate from 0% to 30%.', 'rate must be a number');
eq(mortgageInputError({ principal: 1, ratePct: 6, years: 0 }), 'Enter a term of 1 to 50 whole years.', 'term needed');
eq(mortgageInputError({ principal: 1, ratePct: 6, years: 25.5 }), 'Enter a term of 1 to 50 whole years.', 'whole years');
eq(calculateMortgage({ principal: 1, ratePct: 6, years: 51, frequency: 'monthly' }), null, 'no result for bad inputs');

eq(shareOfTakeHome(35973.03, 80000), 45, 'share of take-home');
eq(shareOfTakeHome(35973.03, null), null, 'no take-home, no share');
eq(shareOfTakeHome(35973.03, 0), null, 'zero take-home, no share');

console.log('mortgage calculator tests ok');
