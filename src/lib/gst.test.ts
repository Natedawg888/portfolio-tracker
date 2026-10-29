/**
 * GST returns (KAN-127): periods, due dates and the GST101A boxes. Run: npm run test:business
 */
import { DEFAULT_GST_SETTINGS, gst101a, gstDueDate, periodContaining, shiftPeriod, type GstSettings } from './gst.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

// The ticket's example: $11,500 GST-inclusive sales and $2,300 GST-inclusive expenses.
const r = gst101a({ salesInclNzd: 11500, zeroRatedNzd: 0, purchasesInclNzd: 2300 });
eq([r.box5, r.box7, r.box8, r.box10, r.box11, r.box12, r.box14, r.box15], [11500, 11500, 1500, 1500, 2300, 300, 300, 1200], '$1,500 on sales, $300 on expenses, $1,200 to pay');

// Zero-rated sales are in box 5 but carry no GST; adjustments add to boxes 10 and 14; a refund is negative.
const z = gst101a({ salesInclNzd: 2300 + 1000, zeroRatedNzd: 1000, purchasesInclNzd: 4600, salesAdjustNzd: 10, purchaseAdjustNzd: 5 });
eq([z.box5, z.box6, z.box7, z.box8, z.box10], [3300, 1000, 2300, 300, 310], 'zero-rated out of the GST on sales, adjustment added');
eq([z.box12, z.box14, z.box15], [600, 605, -295], 'more GST on purchases is a refund');
eq(gst101a({ salesInclNzd: 0, zeroRatedNzd: 0, purchasesInclNzd: 0 }).box15, 0, 'an empty period is nil');
eq(gst101a({ salesInclNzd: 100, zeroRatedNzd: 0, purchasesInclNzd: 0 }).box8, 13.04, 'GST rounds to cents');

// Periods.
const two: GstSettings = { frequency: 'two_monthly', periodEndMonth: 3 };
eq(periodContaining('2026-10-23', two), { start: '2026-10-01', end: '2026-11-30' }, 'two-monthly ending odd months: Oct–Nov');
eq(periodContaining('2026-03-31', two), { start: '2026-02-01', end: '2026-03-31' }, 'the anchor month ends a period');
eq(periodContaining('2027-01-15', two), { start: '2026-12-01', end: '2027-01-31' }, 'a period across the year end');
eq(periodContaining('2026-10-23', { frequency: 'two_monthly', periodEndMonth: 2 }), { start: '2026-09-01', end: '2026-10-31' }, 'two-monthly ending even months');
eq(periodContaining('2028-02-10', { frequency: 'two_monthly', periodEndMonth: 2 }), { start: '2028-01-01', end: '2028-02-29' }, 'a leap February');
eq(periodContaining('2026-10-23', { frequency: 'monthly', periodEndMonth: 3 }), { start: '2026-10-01', end: '2026-10-31' }, 'monthly');
eq(periodContaining('2026-10-23', { frequency: 'six_monthly', periodEndMonth: 3 }), { start: '2026-10-01', end: '2027-03-31' }, 'six-monthly ending March and September');
eq(periodContaining('2026-05-01', { frequency: 'six_monthly', periodEndMonth: 3 }), { start: '2026-04-01', end: '2026-09-30' }, 'the other half');
eq(shiftPeriod({ start: '2026-10-01', end: '2026-11-30' }, two, -1), { start: '2026-08-01', end: '2026-09-30' }, 'previous period');
eq(shiftPeriod({ start: '2026-12-01', end: '2027-01-31' }, two, 1), { start: '2027-02-01', end: '2027-03-31' }, 'next period');
eq(DEFAULT_GST_SETTINGS, { frequency: 'two_monthly', periodEndMonth: 3 }, 'default settings');

// Due dates: the 28th of the next month, except November (15 January) and March (7 May).
eq([gstDueDate('2026-09-30'), gstDueDate('2026-11-30'), gstDueDate('2027-03-31'), gstDueDate('2026-12-31')], ['2026-10-28', '2027-01-15', '2027-05-07', '2027-01-28'], 'due dates');

console.log('gst: ok');
