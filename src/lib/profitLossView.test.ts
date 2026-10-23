/**
 * Profit & loss page helpers (KAN-126). Run: npm run test:business
 */
import { compactNzd, customPeriodError, monthLong, monthShort, niceTicks } from './profitLossView.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

eq(niceTicks(0), [0], 'nothing: one tick');
eq(niceTicks(-5), [0], 'negative never happens, but is safe');
eq(niceTicks(1350), [0, 500, 1000, 1500], 'a round top above the max');
eq(niceTicks(1000), [0, 250, 500, 750, 1000], 'an exact round max is the top');
eq(niceTicks(7), [0, 2, 4, 6, 8], 'small amounts');
eq(niceTicks(48_200), [0, 20000, 40000, 60000], 'tens of thousands');
for (const max of [1, 13, 99.5, 1234, 98765, 2_500_000]) {
  const t = niceTicks(max);
  if (t[t.length - 1] < max || t.length < 2 || t.length > 6) throw new Error(`FAIL: ticks cover ${max} in 2–6 steps (got ${t})`);
}
eq([compactNzd(0), compactNzd(950), compactNzd(1000), compactNzd(2500), compactNzd(1_200_000)], ['$0', '$950', '$1k', '$2.5k', '$1.2m'], 'axis labels');
eq([monthShort('2026-04'), monthLong('2027-01')], ['Apr', 'Jan 2027'], 'month labels');
eq(customPeriodError('', '2026-10-01'), 'Pick both dates', 'both dates');
eq(customPeriodError('2026-10-02', '2026-10-01'), 'The end is before the start', 'in order');
eq(customPeriodError('2020-01-01', '2026-01-01'), 'Pick three years or less', 'three years');
eq(customPeriodError('2026-04-01', '2027-03-31'), null, 'a tax year is fine');
console.log('profit & loss view: ok');
