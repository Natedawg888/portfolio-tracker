/**
 * Dashboard payload uses real observation dates and the scorer.
 * Run: npm run test:economy
 */
import { buildCycleView, isStale } from './view.ts';
import type { EconomicObservation, IndicatorType } from './types.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function obs(
  indicator: IndicatorType,
  value: number,
  previous: number,
  period: string,
  periodEnd: string,
): EconomicObservation {
  return {
    country: 'NZ',
    indicatorType: indicator,
    value,
    unit: 'percent',
    period,
    periodStart: '2024-10-01',
    periodEnd,
    previousValue: previous,
    previousPeriod: null,
    source: 'Test source',
    sourceUrl: null,
    publishedAt: '2025-01-10',
    publishedAtPrecision: 'release',
    retrievedAt: '2025-01-16T00:00:00.000Z',
    providerId: 'test',
    providerKind: 'live',
    frequency: 'quarterly',
    seriesId: 'test',
    notes: null,
  };
}

const now = new Date('2025-01-16T00:00:00.000Z');
const recession = [
  obs('gdp_growth', -0.8, -0.2, '2024-Q4', '2024-12-31'),
  obs('inflation_cpi', 2.2, 3.2, '2024-Q4', '2024-12-31'),
  obs('interest_rates', 4.8, 5.5, '2024-Q4', '2024-12-31'),
  obs('unemployment', 6.4, 5.6, '2024-Q4', '2024-12-31'),
  obs('employment_growth', -1.4, -0.2, '2024-Q4', '2024-12-31'),
  obs('consumer_spending', -0.8, -0.1, '2024-Q4', '2024-12-31'),
  obs('business_activity_pmi', 43, 47, '2024-Q4', '2024-12-31'),
  obs('credit_conditions', -1.2, -0.2, '2024-Q4', '2024-12-31'),
  obs('housing_activity', -8, -1, '2024-Q4', '2024-12-31'),
  obs('share_market', -6, -1, '2024-Q4', '2024-12-31'),
  obs('yield_curve', 0.1, -0.3, '2024-Q4', '2024-12-31'),
];

const view = buildCycleView({
  observations: recession,
  provider: { id: 'test', label: 'Test', kind: 'live' },
  warnings: [],
  refreshError: null,
  now,
});

assert(view.phase?.id === 'recession', `phase ${view.phase?.id}`);
assert(view.lastUpdated === '2025-01-16T00:00:00.000Z', `last updated ${view.lastUpdated}`);
assert(view.asOfPeriod === '2024-Q4', `as of ${view.asOfPeriod}`);
assert(view.indicators.length === 11, 'all catalogue cards');
assert(view.indicators.every((card) => card.stale === false), 'recent quarter is not stale');
assert(view.assetClasses.length === 5, 'asset classes follow the phase');
assert(!/(\bbuy\b|\bsell\b|\bhold\b)/i.test(view.disclaimer), 'disclaimer stays neutral');

const old = isStale('gdp_growth', '2019-12-31', new Date('2026-10-04T00:00:00.000Z'));
assert(old === true, 'a 2019 print is stale in 2026');
const recent = isStale('gdp_growth', '2026-06-30', new Date('2026-10-04T00:00:00.000Z'));
assert(recent === false, 'June 2026 GDP is still inside the quarterly lag in October 2026');
const june = '2026-06-30';
const october = new Date('2026-10-04T00:00:00.000Z');
assert(isStale('business_activity_pmi', june, october, 'monthly') === true, 'June is stale on a monthly window in October');
assert(
  isStale('business_activity_pmi', june, october, 'quarterly') === false,
  'June is still current on a quarterly window in October',
);

const blank = buildCycleView({
  observations: [],
  provider: { id: 'test', label: 'Test', kind: 'live' },
  warnings: ['download failed'],
  refreshError: 'download failed',
  now,
});
assert(blank.phase === null, 'no observations means no phase');
assert(blank.indicators.every((card) => !card.available), 'cards stay blank');
assert(blank.refreshError === 'download failed', 'refresh error is surfaced');

console.log('3 view tests passed');
