/**
 * Plain-language summaries follow the model's own thresholds and rules.
 * Run: npm run test:economy
 */
import assert from 'node:assert/strict';
import { buildTakeaways, cardSummary, describeChanges, describeLevels, describeRule, isDerived, signalStatus } from './insights.ts';
import { classifySignal } from './scoring.ts';
import type { EconomicObservation, IndicatorScoreDetail, IndicatorType } from './types.ts';
import { DEFAULT_PHASE_MODEL } from './weights.ts';

assert.equal(signalStatus(1, true, 'expansion'), 'supports');
assert.equal(signalStatus(0.5, true, 'expansion'), 'mixed');
assert.equal(signalStatus(0, true, 'expansion'), 'conflicts');
assert.equal(signalStatus(null, false, 'expansion'), 'insufficient');
assert.equal(signalStatus(0.9, true, null), 'unscored');
console.log('OK: status cut-offs match the page');

assert.equal(describeLevels('gdp_growth', ['moderate', 'high']), 'at or above 0.0%');
assert.equal(describeLevels('unemployment', ['low']), 'below 4.5%');
assert.equal(describeLevels('yield_curve', ['low', 'moderate']), 'at or below 1.25 pp');
assert.equal(describeLevels('business_activity_pmi', ['moderate']), 'between 48.0 and 52.0');
assert.equal(describeChanges(['falling', 'stable']), 'not rising');
assert.equal(describeChanges(['rising']), 'rising');
assert.equal(describeRule({ indicator: 'share_market', weight: 0.6, changes: ['falling'] }), 'falling');
// Every rule in the model has readable text.
for (const rules of Object.values(DEFAULT_PHASE_MODEL.rules)) {
  for (const rule of rules) assert.ok(describeRule(rule).length > 3, `${rule.indicator} rule text`);
}
console.log('OK: rule text comes from the thresholds');

function reading(indicator: IndicatorType, value: number, previous: number | null) {
  const signal = classifySignal(indicator, value, previous);
  const detail: IndicatorScoreDetail = { ...signal, score: 0, contribution: 0, fit: 0 };
  const observation = { indicatorType: indicator, value, previousValue: previous } as EconomicObservation;
  return { indicator, observation, signal: detail, stale: false };
}

const mixed = buildTakeaways(
  new Map([
    ['gdp_growth', reading('gdp_growth', 0.9, 0.4)],
    ['consumer_spending', reading('consumer_spending', -0.4, 0.3)],
  ]),
);
assert.equal(mixed.length, 1, 'only themes with data');
assert.equal(mixed[0]!.headline, 'Growth signals are mixed');
assert.match(mixed[0]!.detail, /GDP 0\.9%, up from 0\.4%/);

const prices = buildTakeaways(new Map([['inflation_cpi', reading('inflation_cpi', 3.4, 2.9)]]));
assert.equal(prices[0]!.headline, 'Inflation is rising, above 3.0%');

const jobs = buildTakeaways(new Map([['unemployment', reading('unemployment', 4.2, 4.0)]]));
assert.equal(jobs[0]!.headline, 'Jobs market is softening from a low base', 'rising unemployment from a low level');

const unknown = buildTakeaways(new Map([['gdp_growth', reading('gdp_growth', 0.3, null)]]));
assert.equal(unknown[0]!.trend, 'unknown');
assert.equal(unknown[0]!.headline, 'Growth trend unclear');
console.log('OK: takeaways follow level and change');

const first = reading('gdp_growth', 0.3, null);
assert.equal(cardSummary('gdp_growth', first.observation, first.signal), 'Inside the 0.0% to 0.5% middle band with no earlier reading to compare.');
assert.equal(cardSummary('gdp_growth', null, null), null);
console.log('OK: card summary');

assert.equal(isDerived('gdp_growth', null), false);
assert.equal(isDerived('credit_conditions', 'Net percentage easing, calculated in this app as the negative of …'), true);
assert.equal(isDerived('employment_growth', null), true);
console.log('OK: derived flag');
console.log('insights tests passed');
