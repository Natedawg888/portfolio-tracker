/**
 * KiwiSaver calculator (KAN-59). Figures worked by hand. Run: npm run test:kiwisaver-calc
 */
import { calculateKiwiSaver, type KiwiSaverCalcInput } from './kiwiSaverCalc.ts';
import { esctRate } from './kiwiSaverRules.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}
const flat: KiwiSaverCalcInput = { age: 64, balance: 0, salary: 50000, salaryGrowthPct: 0, employeeRatePct: 3.5, employerRatePct: 3.5, extraPerYear: 0, returnPct: 0, inflationPct: 0 };

// ESCT bands from 1 April 2025.
eq(esctRate(18720), 0.105, 'ESCT 10.5% to $18,720');
eq(esctRate(18721), 0.175, 'ESCT 17.5% from $18,721');
eq(esctRate(64201), 0.3, 'ESCT 30% from $64,201');
eq(esctRate(216000), 0.33, 'ESCT 33% to $216,000');
eq(esctRate(216001), 0.39, 'ESCT 39% above');

// One year, no growth: you $1,750; employer $1,750 less ESCT 17.5% on $51,750 = $306.25 → $1,443.75;
// government min(25% × 1,750, 260.72) = $260.72. At 65: $3,454.47.
let r = calculateKiwiSaver(flat)!;
eq(r.years, 1, 'one year to 65');
eq(r.firstYear.you, 1750, 'you');
eq(r.firstYear.esct, 306.25, 'ESCT');
eq(r.firstYear.esctRatePct, 17.5, 'ESCT rate');
eq(r.firstYear.employer, 1443.75, 'employer after ESCT');
eq(r.firstYear.government, 260.72, 'full government contribution');
eq(r.firstYear.governmentFull, true, 'full');
eq(r.atWithdrawal, 3454.47, 'balance at 65');

// Small contributions: $20,000 at 3.5% = $700 → government $175, with the note to put in $1,042.86.
r = calculateKiwiSaver({ ...flat, salary: 20000 })!;
eq(r.firstYear.government, 175, 'government 25c per $1');
eq(r.firstYear.governmentNote?.includes('1,042.86'), true, 'how much for the full amount');

// High income: no government contribution over $180,000; ESCT 33% on $206,000.
r = calculateKiwiSaver({ ...flat, salary: 200000, employerRatePct: 3 })!;
eq(r.firstYear.government, 0, 'none over $180,000');
eq(r.firstYear.esctRatePct, 33, 'ESCT 33%');
eq(r.firstYear.governmentNote?.includes('180,000'), true, 'says why');

// Growth: $12,000 a year in monthly, 6% a year → FV of monthly deposits.
r = calculateKiwiSaver({ ...flat, salary: 100000, employeeRatePct: 6, employerRatePct: 6, returnPct: 6 })!;
const rm = 1.06 ** (1 / 12) - 1;
const you = 6000;
const employer = 6000 * (1 - 0.33); // ESCT 33% on $106,000 ($93,721–$216,000)
const fv = ((you + employer) / 12) * (((1 + rm) ** 12 - 1) / rm) + 260.72;
eq(r.atWithdrawal, Math.round(fv * 100) / 100, 'one year at 6%');

// Starting balance grows; today's dollars divide out inflation.
r = calculateKiwiSaver({ ...flat, age: 45, balance: 10000, salary: 0, employeeRatePct: 0, employerRatePct: 0, returnPct: 5, inflationPct: 2 })!;
eq(r.years, 20, '20 years');
eq(r.atWithdrawal, Math.round(10000 * 1.05 ** 20 * 100) / 100, 'balance compounds');
eq(r.atWithdrawalToday, Math.round(((10000 * 1.05 ** 20) / 1.02 ** 20) * 100) / 100, 'in today’s dollars');
eq(r.totals.government, 0, 'nothing put in, no government contribution');

// Nothing to project at 65 or over.
eq(calculateKiwiSaver({ ...flat, age: 65 }), null, '65: nothing to project');

// Under 16: no government contribution until 16.
r = calculateKiwiSaver({ ...flat, age: 15, salary: 10000 })!;
eq(r.rows[0].government, 0, 'none at 15');
eq(r.rows[1].government > 0, true, 'from 16');

console.log('kiwiSaverCalc.test.ts ok');
