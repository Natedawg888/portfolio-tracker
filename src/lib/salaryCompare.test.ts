/**
 * Salary compare (KAN-23). Run: npm run test:paye
 */
import { calculatePaye } from './payeCalc.ts';
import { compareSalaries, parseSalaries, type SalaryCompareOptions } from './salaryCompare.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

const options: SalaryCompareOptions = {
  taxYear: 2026,
  employment: 'primary',
  secondaryTotalAnnualIncome: 0,
  otherAnnualGross: 0,
  kiwiSaverOptIn: true,
  kiwiSaverEmployeeRatePct: 3.5,
  kiwiSaverEmployerRatePct: 3.5,
  salarySacrifice: false,
  studentLoan: true,
  ietc: true,
  payrollGivingAnnual: 0,
};

eq(parseSalaries(['75000', '$82,500', '', '-5']).join(), '75000,82500', 'blanks, $ and commas, negatives');
eq(parseSalaries(['1', '2', '3', '4', '5']).length, 4, 'at most four');

const rows = compareSalaries([60000, 80000], options);
const a = calculatePaye({ ...options, amount: 60000, frequency: 'year', hoursPerWeek: 40 });
const b = calculatePaye({ ...options, amount: 80000, frequency: 'year', hoursPerWeek: 40 });
eq(rows[0].takeHome, Math.round(a.takeHome * 100) / 100, 'first row is calculatePaye at 60k');
eq(rows[1].incomeTax, Math.round(b.incomeTax * 100) / 100, 'second row tax is calculatePaye at 80k');
eq(rows[0].vsBaseline, null, 'baseline has no comparison');
eq(rows[1].vsBaseline?.salary, 20000, '+20,000');
eq(rows[1].vsBaseline?.takeHome, Math.round((b.takeHome - a.takeHome) * 100) / 100, 'take-home difference');
const keep = rows[1].vsBaseline?.keepPerDollarPct ?? 0;
eq(keep > 40 && keep < 70, true, `keeps between 40c and 70c of each extra dollar at 33% tax + loan + KS (${keep})`);
eq(rows[0].credits, 520, 'IETC ($520) shows as a credit at 60k');
eq(compareSalaries([70000, 70000], options)[1].vsBaseline?.keepPerDollarPct, null, 'same salary: no per-dollar figure');
eq(compareSalaries([], options).length, 0, 'nothing entered');

console.log('salaryCompare.test.ts ok');
