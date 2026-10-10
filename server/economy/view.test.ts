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

// Redesign fields -----------------------------------------------------------
assert(view.phase?.confidenceDetail != null, 'confidence parts are reported');
assert(view.phase?.catalogueCount === 11 && view.phase?.availableCount === 11, 'coverage counts');
assert(view.phaseFits.length === 5, 'every phase has a fit');
const winner = view.phaseFits.find((row) => row.id === view.phase?.id);
assert(winner && view.phaseFits.every((row) => row.fit <= winner.fit), 'calculated phase has the top fit');
assert(view.takeaways.length === 3, `three takeaways, got ${view.takeaways.length}`);
assert(view.takeaways.find((row) => row.id === 'growth')?.headline === 'Growth is slowing', 'growth falls in the recession fixture');
assert(view.phaseGuide.length === 5, 'guide for every phase');
assert(view.phaseGuide.every((row) => row.rules.length === 11), 'guide lists the model rules');
assert(view.assetEvidence.map((row) => row.id).join(',') === 'shares,property,bonds,cash,gold,crypto', 'asset explorer order');
assert(view.assetEvidence.find((row) => row.id === 'property')?.status === 'unavailable', 'no property dataset');
assert(view.freshness.missingCount === 0 && view.freshness.staleCount === 0, 'fixture is complete and fresh');
const gdp = view.indicators.find((card) => card.type === 'gdp_growth')!;
assert(gdp.signal === 'supports', `gdp supports recession, got ${gdp.signal}`);
assert(gdp.expects === 'below 0.0%, not rising', `gdp rule text ${gdp.expects}`);
assert(gdp.weight === 1.8, 'gdp weight in recession');
assert(gdp.contribution != null && gdp.contribution <= gdp.weight!, 'contribution is at most the weight');
assert(gdp.derived === false, 'fixture gdp is published, not derived');
assert(view.indicators.find((card) => card.type === 'yield_curve')?.derived === true, 'yield spread is derived');
assert(gdp.summary === 'Below the 0.0% low line and falling.', `summary ${gdp.summary}`);

// Stale and missing data ------------------------------------------------------
const partial = buildCycleView({
  observations: [
    ...recession.filter((row) => row.indicatorType !== 'credit_conditions' && row.indicatorType !== 'housing_activity'),
    { ...obs('credit_conditions', -1, 0, '2023-Q1', '2023-03-31') },
  ],
  provider: { id: 'test', label: 'Test', kind: 'live' },
  warnings: [],
  refreshError: null,
  now,
});
const housing = partial.indicators.find((card) => card.type === 'housing_activity')!;
assert(housing.available === false && housing.signal === 'insufficient', 'missing series is insufficient');
assert(housing.summary === null && housing.weight === null, 'missing series has no summary or weight');
assert(partial.indicators.find((card) => card.type === 'credit_conditions')?.stale === true, 'old credit print is stale');
assert(partial.freshness.missingCount === 1 && partial.freshness.staleCount === 1, 'freshness counts');
assert(partial.freshness.mixedPeriods === true, 'periods differ across cards');
assert(blank.takeaways.length === 0 && blank.phaseFits.length === 0, 'no takeaways without a phase');
assert(blank.assetEvidence.find((row) => row.id === 'shares')?.status === 'unavailable', 'no share series, no evidence');

console.log('6 view tests passed');
