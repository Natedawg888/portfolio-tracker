/**
 * Scenario tool helper (KAN-32). Run: npm run test:projections
 */
import { calculatePaye } from './payeCalc.ts';
import { extraTakeHomeMonthly } from './whatIf.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}
const extra = extraTakeHomeMonthly(80_000, 5);
eq(extra > 0 && extra < (4_000 / 12), true, `5% on $80k is less than $333 a month after tax (${extra})`);
eq(extraTakeHomeMonthly(80_000, 0), 0, 'no rise, no change');
eq(extraTakeHomeMonthly(0, 5), 0, 'no salary, no change');
const opts = { employment: 'primary' as const, secondaryTotalAnnualIncome: 0, otherAnnualGross: 0, kiwiSaverOptIn: true, kiwiSaverEmployeeRatePct: 3.5, kiwiSaverEmployerRatePct: 3.5, salarySacrifice: false, studentLoan: false, ietc: true, payrollGivingAnnual: 0, frequency: 'year' as const, hoursPerWeek: 40 };
const exact = Math.round(((calculatePaye({ ...opts, amount: 84_000 }).takeHome - calculatePaye({ ...opts, amount: 80_000 }).takeHome) / 12) * 100) / 100;
eq(extra, exact, 'same as calculatePaye at both salaries');
console.log('whatIf.test.ts ok');
