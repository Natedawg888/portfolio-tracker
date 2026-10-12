/**
 * Shared line chart axis. Projections needs a non-negative domain and one 0
 * tick for an all-zero line. Large balances (KiwiSaver, History) stay zoomed.
 * Run: npm run test:projections-page
 */
import { computeYDomain, computeYTicks, resampleSeries, seriesPaintOrder } from './AssetLineChart.tsx';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const zero = computeYDomain([0, 0, 0]);
assert(zero.vMin === 0 && zero.vMax === 0, 'an all-zero line uses a zero domain');
const zeroTicks = computeYTicks(zero.vMin, zero.vMax);
assert(zeroTicks.length === 1 && zeroTicks[0] === 0, 'an all-zero line has a single 0 tick');

const grew = computeYDomain([0, 500, 77_500]);
assert(grew.vMin === 0, 'a series that starts at 0 does not pad below 0');
assert(grew.vMax > 77_500, 'the top of a growing series still has headroom');
assert(computeYTicks(grew.vMin, grew.vMax).every((tick) => tick >= 0), 'ticks on a non-negative series stay at or above 0');

const balances = computeYDomain([50_000, 52_000, 55_000]);
assert(balances.vMin > 40_000 && balances.vMin < 50_000, 'large balances stay zoomed in instead of starting at 0');
assert(balances.vMax > 55_000, 'large balances keep padding above the max');

const crossed = computeYDomain([-1_000, 500]);
assert(crossed.vMin < 0, 'a series that goes negative still shows below 0');

const painted = seriesPaintOrder(
  [{ key: 'netWorth' }, { key: 'assets' }, { key: 'saved' }],
  'netWorth',
);
assert(
  painted.map((series) => series.key).join(',') === 'assets,saved,netWorth',
  'net worth is painted last so it stays visible',
);
const unchanged = seriesPaintOrder([{ key: 'balance' }, { key: 'contributions' }]);
assert(
  unchanged.map((series) => series.key).join(',') === 'balance,contributions',
  'charts that do not set a foreground series keep their order',
);

// 13 Oct 2026 09:00 and 21:30 NZDT, then 2 Nov 08:00 NZDT.
const raw = [
  { at: '2026-10-12T20:00:00Z', value: 100, takenAt: '2026-10-12T20:00:00Z' },
  { at: '2026-10-13T08:30:00Z', value: 120, takenAt: '2026-10-13T08:30:00Z' },
  { at: '2026-11-01T19:00:00Z', value: 130, takenAt: '2026-11-01T19:00:00Z' },
];
const byDay = resampleSeries([{ key: 'net', label: 'Net', colour: '#000', points: raw }], 'day')[0].points;
assert(byDay.length === 2, 'two Auckland days with snapshots give two day points');
assert(byDay[0].at === '2026-10-13' && byDay[0].value === 120, 'a day keeps its last real snapshot');
assert(byDay[0].takenAt === '2026-10-13T08:30:00Z', 'a day point keeps the real takenAt of that last snapshot');
const byMonth = resampleSeries([{ key: 'net', label: 'Net', colour: '#000', points: raw }], 'month')[0].points;
assert(byMonth[0].at === '2026-10-01' && byMonth[0].takenAt === '2026-10-13T08:30:00Z', 'a month point keeps the real takenAt');
assert(byMonth[1].takenAt === '2026-11-01T19:00:00Z', 'each month point keeps its own takenAt');
const plain = resampleSeries([{ key: 'b', label: 'B', colour: '#000', points: [{ at: '2026-10-01', value: 1 }] }], 'day')[0].points;
assert(!('takenAt' in plain[0]), 'points without takenAt stay unchanged for other charts');

console.log('line chart tests passed');
