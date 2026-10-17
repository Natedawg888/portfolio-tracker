/**
 * Employee helpers: the next pay date rolls forward from the one entered, monthly pay keeps its
 * day (clamped to short months), rates and bank accounts read right. Run: npm run test:business
 */
import { maskBankAccount, nextPayDate, payRateText } from './employees.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

const today = '2026-10-17';
eq(nextPayDate('2026-10-23', 'fortnightly', today), '2026-10-23', 'a date still to come stays');
eq(nextPayDate('2026-10-17', 'weekly', today), '2026-10-17', 'today counts');
eq(nextPayDate('2026-10-09', 'fortnightly', today), '2026-10-23', 'fortnightly rolls on 14 days');
eq(nextPayDate('2026-10-02', 'weekly', today), '2026-10-23', 'weekly rolls to the next one on or after today');
eq(nextPayDate('2026-09-01', 'four_weekly', today), '2026-10-27', 'four-weekly');
eq(nextPayDate('2026-01-31', 'monthly', '2026-02-10'), '2026-02-28', 'monthly on the 31st falls on the last day of February');
eq(nextPayDate('2026-01-31', 'monthly', '2026-03-01'), '2026-03-31', 'and back to the 31st in March');
eq(nextPayDate('2026-06-20', 'monthly', today), '2026-10-20', 'monthly keeps its day');
eq(nextPayDate(null, 'weekly', today), null, 'no date, no next pay');
eq(nextPayDate('20/10/2026', 'weekly', today), null, 'a malformed date is ignored');

const money = (n: number) => `$${n.toFixed(2)}`;
eq(payRateText(28.5, 'hour', money), '$28.50/hr', 'hourly rate');
eq(payRateText(65000, 'year', money), '$65000.00/yr', 'salary');
eq(payRateText(null, 'hour', money), '', 'no rate');

eq(maskBankAccount('12-3456-7890123-00'), '12-••••-•••••23-00', 'bank account masked');
eq(maskBankAccount(''), '', 'no account');
eq(maskBankAccount('old free text'), '••••', 'unrecognised format hidden entirely');

console.log('employee helpers: ok');
