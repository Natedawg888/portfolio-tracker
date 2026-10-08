/**
 * Shared line chart axis. Projections needs a non-negative domain and one 0
 * tick for an all-zero line. Large balances (KiwiSaver, History) stay zoomed.
 * Run: npm run test:projections-page
 */
import { computeYDomain, computeYTicks, seriesPaintOrder } from './AssetLineChart.tsx';

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

console.log('line chart tests passed');
