/**
 * Net worth history (Dashboard sparkline). Run: npm run test:dashboard
 */
import { accessibleOf, dailySeries, historyDelta, pointsInRange, rangeStart } from './netWorthHistory.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}

const snaps = [
  // 9 Oct NZDT, two readings: the later one wins.
  { takenAt: '2026-10-08T20:00:00Z', totalNzd: 1000, breakdown: { byClass: { kiwiSaver: 300 } } },
  { takenAt: '2026-10-09T09:00:00Z', totalNzd: 1100, breakdown: { byClass: { kiwiSaver: 300 } } },
  // 10 Oct: an old manual row with no breakdown has no accessible figure.
  { takenAt: '2026-10-09T20:00:00Z', totalNzd: 1200, breakdown: {} },
  // 11 Oct: no KiwiSaver held.
  { takenAt: '2026-10-10T20:00:00Z', totalNzd: 1500, breakdown: { byClass: { kiwiSaver: null } } },
  { takenAt: 'not a date', totalNzd: 5, breakdown: {} },
];

const total = dailySeries(snaps, 'total');
eq(total.length, 3, 'one point per Auckland day, bad dates dropped');
eq(total[0].date, '2026-10-09', 'Auckland date, not UTC');
eq(total[0].value, 1100, 'latest reading of the day');
eq(total[2].value, 1500, 'last day');

const accessible = dailySeries(snaps, 'accessible');
eq(accessible.length, 2, 'snapshot without a breakdown is left out of accessible');
eq(accessible[0].value, 800, 'accessible is total minus KiwiSaver');
eq(accessible[1].value, 1500, 'no KiwiSaver held takes nothing off');
eq(accessibleOf(1000, null), 1000, 'accessibleOf with no KiwiSaver');

eq(rangeStart('1M', '2026-10-11'), '2026-09-11', '1M');
eq(rangeStart('6M', '2026-10-11'), '2026-04-11', '6M');
eq(rangeStart('1Y', '2026-10-11'), '2025-10-11', '1Y');
eq(rangeStart('1M', '2026-03-31'), '2026-02-28', 'month end clamps');
eq(rangeStart('1M', '2026-01-15'), '2025-12-15', 'crosses the year');
eq(rangeStart('All', '2026-10-11'), null, 'All has no start');

const long = [
  { date: '2025-09-01', value: 10 },
  { date: '2026-09-12', value: 100 },
  { date: '2026-10-11', value: 512 },
];
eq(pointsInRange(long, '1M', '2026-10-11').length, 2, '1M keeps the last month');
eq(pointsInRange(long, 'All', '2026-10-11').length, 3, 'All keeps everything');

const month = historyDelta(pointsInRange(long, '1M', '2026-10-11'), '1M', '2026-10-11');
eq(month?.amount, 412, 'delta is last minus first');
eq(month?.phrase, 'since last month', 'history reaches the range start');

const short = historyDelta([{ date: '2026-10-08', value: 1 }, { date: '2026-10-11', value: 3 }], '1M', '2026-10-11');
eq(short?.phrase, 'since 8 Oct 2026', 'short history names its first day');
eq(historyDelta([{ date: '2026-10-11', value: 3 }], '1M', '2026-10-11'), null, 'one point has no delta');

console.log('netWorthHistory: ok');
