/**
 * Warranty dates (KAN-61). Run: npm run test:warranties
 */
import { daysLeft, daysLeftText, warrantyEndDate, warrantyStatus } from './warranty.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}

eq(warrantyEndDate('2026-10-09', 12), '2027-10-08', '1 year ends the day before');
eq(warrantyEndDate('2026-01-01', 1), '2026-01-31', 'one month');
eq(warrantyEndDate('2026-04-15', 6), '2026-10-14', 'six months');
eq(warrantyEndDate('2026-03-01', 24), '2028-02-29', 'into a leap year');

eq(daysLeft('2026-10-09', '2026-10-09'), 0, 'last day');
eq(daysLeft('2026-10-19', '2026-10-09'), 10, 'ten days');
eq(daysLeft('2026-10-01', '2026-10-09'), -8, 'expired');

eq(warrantyStatus('2027-10-08', '2026-10-09'), 'active', 'a year out');
eq(warrantyStatus('2026-12-08', '2026-10-09'), 'expiring', '60 days is expiring soon');
eq(warrantyStatus('2026-12-09', '2026-10-09'), 'active', '61 days is not');
eq(warrantyStatus('2026-10-09', '2026-10-09'), 'expiring', 'last day still covered');
eq(warrantyStatus('2026-10-08', '2026-10-09'), 'expired', 'day after the end');
eq(warrantyStatus('2026-10-20', '2026-10-09', 7), 'active', 'custom window');

eq(daysLeftText('2026-10-09', '2026-10-09'), 'Ends today', 'today');
eq(daysLeftText('2026-10-10', '2026-10-09'), '1 day left', 'one day');
eq(daysLeftText('2026-10-30', '2026-10-09'), '21 days left', 'days');
eq(daysLeftText('2026-10-08', '2026-10-09'), 'Expired yesterday', 'yesterday');
eq(daysLeftText('2026-09-09', '2026-10-09'), 'Expired 30 days ago', 'past');

console.log('warranty date tests ok');
