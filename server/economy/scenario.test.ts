/**
 * Scenarios re-score a copy. Real observations and the stored assessment never change.
 * Run: npm run test:economy
 */
import assert from 'node:assert/strict';
import { analyseObservations } from './analyse.ts';
import { ScenarioInputError, parseOverrides, runScenario } from './scenario.ts';
import { ScenarioUnavailableError, getEconomicScenario } from './service.ts';
import type { EconomicObservation, IndicatorType } from './types.ts';

function obs(indicator: IndicatorType, value: number, previous: number): EconomicObservation {
  return {
    country: 'NZ',
    indicatorType: indicator,
    value,
    unit: 'percent',
    period: '2026-Q2',
    periodStart: '2026-04-01',
    periodEnd: '2026-06-30',
    previousValue: previous,
    previousPeriod: '2026-Q1',
    source: 'Test',
    sourceUrl: null,
    publishedAt: '2026-08-01',
    publishedAtPrecision: 'release',
    retrievedAt: '2026-09-01T00:00:00.000Z',
    providerId: 'nz-public',
    providerKind: 'live',
    frequency: 'quarterly',
    seriesId: null,
    notes: null,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const slowdown = [
  obs('gdp_growth', 0.2, 0.8),
  obs('inflation_cpi', 2.4, 3.0),
  obs('interest_rates', 4.6, 5.0),
  obs('unemployment', 5.0, 4.6),
  obs('employment_growth', 0.4, 1.2),
  obs('consumer_spending', 0.2, 0.9),
  obs('business_activity_pmi', 49, 52),
  obs('credit_conditions', 4, 14),
  obs('share_market', 0, 4),
  obs('yield_curve', 0.4, 0.9),
];
const now = new Date('2026-10-10T00:00:00.000Z');
const frozen = deepFreeze(slowdown.map((row) => ({ ...row })));
const analysis = deepFreeze(analyseObservations(frozen, now));
const realPhase = analysis.current?.phase;
const realConfidence = analysis.current?.confidence;

// No overrides: the scenario is the real assessment.
const same = runScenario(analysis, {});
assert.equal(same.hypothetical, true);
assert.equal(same.baseline.phase, realPhase);
assert.equal(same.scenario.phase, realPhase);
assert.equal(same.scenario.confidence, realConfidence);
assert.deepEqual(same.scenario.phaseFits, same.baseline.phaseFits);
assert.equal(same.changed.length, 0);
console.log('OK: empty scenario equals the real assessment');

// A recession-like scenario moves the scores; frozen inputs prove nothing was written back.
const severe = runScenario(analysis, { gdp_growth: -1.5, unemployment: 6.5, consumer_spending: -1.2 });
assert.equal(severe.baseline.phase, realPhase, 'baseline stays the calculated phase');
const recessionFit = (side: typeof severe.scenario) => side.phaseFits.find((row) => row.id === 'recession')!.fit;
assert.ok(recessionFit(severe.scenario) > recessionFit(severe.baseline), 'recession fit rises');
assert.equal(severe.changed.length, 3);
const gdp = severe.changed.find((row) => row.indicator === 'gdp_growth')!;
assert.equal(gdp.actual, 0.2);
assert.equal(gdp.previous, 0.8, 'change is measured against the real previous reading');
assert.equal(gdp.level, 'low');
assert.equal(analysis.current?.phase, realPhase, 'real analysis is unchanged');
assert.equal(frozen.find((row) => row.indicatorType === 'gdp_growth')?.value, 0.2, 'observations unchanged');
console.log('OK: scenario changes scores without touching real data');

// Housing has no reading in this fixture, so it cannot be changed — and it is not a scenario input anyway.
const missing = runScenario(
  analyseObservations(slowdown.filter((row) => row.indicatorType !== 'consumer_spending'), now),
  { consumer_spending: 1 },
);
assert.deepEqual(missing.unavailable.map((row) => row.indicator), ['consumer_spending']);
assert.equal(missing.changed.length, 0);
console.log('OK: missing indicators are reported, not invented');

assert.throws(() => parseOverrides({ housing_activity: 3 }), ScenarioInputError);
assert.throws(() => parseOverrides({ gdp_growth: '1' }), ScenarioInputError);
assert.throws(() => parseOverrides({ gdp_growth: Number.NaN }), ScenarioInputError);
assert.throws(() => parseOverrides({ inflation_cpi: 99 }), ScenarioInputError);
assert.throws(() => parseOverrides([1, 2]), ScenarioInputError);
assert.deepEqual(parseOverrides({ gdp_growth: -1 }), { gdp_growth: -1 });
console.log('OK: overrides are validated');

// The service only reads. An injected reader stands in for the store; there is no writer to call.
let reads = 0;
const result = await getEconomicScenario('NZ', { gdp_growth: -1 }, {
  now,
  read: async () => {
    reads += 1;
    return frozen;
  },
});
assert.equal(reads, 1);
assert.equal(result.baseline.phase, realPhase);
await assert.rejects(
  getEconomicScenario('NZ', {}, { now, read: async () => [] }),
  ScenarioUnavailableError,
  'no stored extract is a clear error',
);
console.log('OK: service reads once and never fetches');
console.log('scenario tests passed');
