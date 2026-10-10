/**
 * Scoring contract. These cases define the phase stories and the confidence
 * formula. Run: npm run test:economy
 */
import { INDICATOR_TYPES, type IndicatorInput, type IndicatorType, type Phase } from './types.ts';
import { DEFAULT_PHASE_MODEL, type PhaseModel, type PhaseRule } from './weights.ts';
import { CONFIDENCE_WEIGHTS, assessCycle, assessTimeline, classifySignal, ruleFit } from './scoring.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function input(indicator: IndicatorType, value: number, previousValue: number | null): IndicatorInput {
  return { indicator, value, previousValue };
}

const recession: IndicatorInput[] = [
  input('gdp_growth', -0.8, -0.2),
  input('inflation_cpi', 2.2, 3.2),
  input('interest_rates', 4.8, 5.5),
  input('unemployment', 6.4, 5.6),
  input('employment_growth', -1.4, -0.2),
  input('consumer_spending', -0.8, -0.1),
  input('business_activity_pmi', 43, 47),
  input('credit_conditions', -12, -2),
  input('housing_activity', -8, -1),
  input('share_market', -6, -1),
  input('yield_curve', 0.1, -0.3),
];

const slowdown: IndicatorInput[] = [
  input('gdp_growth', 0.2, 0.8),
  input('inflation_cpi', 2.4, 3.0),
  input('interest_rates', 4.6, 5.0),
  input('unemployment', 5.0, 4.6),
  input('employment_growth', 0.4, 1.2),
  input('consumer_spending', 0.2, 0.9),
  input('business_activity_pmi', 49, 52),
  input('credit_conditions', 4, 14),
  input('housing_activity', 1, 6),
  input('share_market', 0, 4),
  input('yield_curve', 0.4, 0.9),
];

const recovery: IndicatorInput[] = [
  input('gdp_growth', -0.1, -0.7),
  input('inflation_cpi', 2.0, 2.6),
  input('interest_rates', 3.2, 4.0),
  input('unemployment', 5.8, 5.9),
  input('employment_growth', -0.2, -0.8),
  input('consumer_spending', -0.2, -0.7),
  input('business_activity_pmi', 47, 44),
  input('credit_conditions', -4, -12),
  input('housing_activity', -2, -6),
  input('share_market', 1.5, -1),
  input('yield_curve', 0.8, 0.3),
];

const expansion: IndicatorInput[] = [
  input('gdp_growth', 0.8, 0.7),
  input('inflation_cpi', 2.2, 2.3),
  input('interest_rates', 3.0, 3.1),
  input('unemployment', 4.2, 4.3),
  input('employment_growth', 2.0, 1.9),
  input('consumer_spending', 0.9, 0.8),
  input('business_activity_pmi', 54, 53.6),
  input('credit_conditions', 15, 12),
  input('housing_activity', 6, 5.5),
  input('share_market', 2, 1.8),
  input('yield_curve', 1.0, 0.95),
];

const lateExpansion: IndicatorInput[] = [
  input('gdp_growth', 0.9, 0.85),
  input('inflation_cpi', 4.2, 3.4),
  input('interest_rates', 5.2, 4.6),
  input('unemployment', 3.8, 3.9),
  input('employment_growth', 2.2, 2.1),
  input('consumer_spending', 0.8, 0.75),
  input('business_activity_pmi', 55, 54.6),
  input('credit_conditions', 6, 14),
  input('housing_activity', 8, 7.5),
  input('share_market', 4.5, 3.2),
  input('yield_curve', 0.1, 0.5),
];

let passed = 0;

function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`ok ${name}`);
}

check('classifies GDP contraction as low and falling', () => {
  const signal = classifySignal('gdp_growth', -0.8, -0.2);
  assert(signal.level === 'low', `level ${signal.level}`);
  assert(signal.change === 'falling', `change ${signal.change}`);
  assert(signal.direction === 'down', `direction ${signal.direction}`);
});

check('classifies a flat move inside the band as stable', () => {
  const signal = classifySignal('gdp_growth', 0.8, 0.7);
  assert(signal.level === 'high', `level ${signal.level}`);
  assert(signal.change === 'stable', `change ${signal.change}`);
  assert(signal.direction === 'flat', `direction ${signal.direction}`);
});

check('missing previous value leaves change unknown', () => {
  const signal = classifySignal('unemployment', 5, null);
  assert(signal.change === 'unknown', `change ${signal.change}`);
  assert(signal.direction === 'unknown', `direction ${signal.direction}`);
  assert(signal.level === 'moderate', `level ${signal.level}`);
});

check('a rule matches only when every condition holds', () => {
  const both: PhaseRule = { indicator: 'gdp_growth', weight: 1, levels: ['low'], changes: ['falling'] };
  const falling = classifySignal('gdp_growth', -0.8, -0.2);
  const rising = classifySignal('gdp_growth', -0.1, -0.7);
  assert(ruleFit(falling, both) === 1, 'low and falling matches');
  assert(ruleFit(rising, both) === 0, 'low but rising does not match');
  const unknown = classifySignal('gdp_growth', -0.8, null);
  assert(ruleFit(unknown, both) === 0.5, `unknown change is half credit, got ${ruleFit(unknown, both)}`);
});

check('recession story classifies as recession and weakening', () => {
  const result = assessCycle(recession);
  assert(result.phase === 'recession', `phase ${result.phase}`);
  assert(result.momentum === 'weakening', `momentum ${result.momentum}`);
  assert(result.score < 0, `score ${result.score}`);
  assert(result.confidence > 50, `confidence ${result.confidence}`);
  const gdp = result.indicators.find((row) => row.indicator === 'gdp_growth');
  assert(gdp != null && gdp.direction === 'down', 'gdp direction');
  assert(gdp != null && gdp.contribution > 0, 'gdp contributes');
});

check('slowdown story is not yet a recession', () => {
  const result = assessCycle(slowdown);
  assert(result.phase === 'slowdown', `phase ${result.phase}`);
  assert(result.momentum === 'weakening', `momentum ${result.momentum}`);
  assert(result.score < 0, `score ${result.score}`);
});

check('recovery story is strengthening and not a recession', () => {
  const result = assessCycle(recovery);
  assert(result.phase === 'recovery', `phase ${result.phase}`);
  assert(result.momentum === 'strengthening', `momentum ${result.momentum}`);
  assert(result.score > assessCycle(recession).score, 'recovery scores above recession');
});

check('expansion story is expansion and steady', () => {
  const result = assessCycle(expansion);
  assert(result.phase === 'expansion', `phase ${result.phase}`);
  assert(result.momentum === 'steady', `momentum ${result.momentum}`);
  assert(result.score > 0, `score ${result.score}`);
});

check('late expansion is distinct from expansion', () => {
  const result = assessCycle(lateExpansion);
  assert(result.phase === 'late_expansion', `phase ${result.phase}`);
  assert(result.score > 0, `score ${result.score}`);
});

check('the same inputs always return the same assessment', () => {
  const a = assessCycle(recession, { previousPhase: 'slowdown' });
  const b = assessCycle([...recession].reverse(), { previousPhase: 'slowdown' });
  assert(JSON.stringify(a) === JSON.stringify(b), 'order of inputs must not matter');
  assert(a.previousPhase === 'slowdown', 'previous phase is passed through, not invented');
});

check('repeating an assessment does not advance the phase', () => {
  const first = assessCycle(recession);
  const second = assessCycle(recession, { previousPhase: first.phase });
  assert(second.phase === 'recession', `phase moved to ${second.phase}`);
});

check('thin coverage lowers confidence and is capped', () => {
  const full = assessCycle(recession);
  const onlyGdp = assessCycle([recession[0]!]);
  assert(onlyGdp.phase === 'recession' || onlyGdp.phase === 'slowdown' || onlyGdp.phase != null, 'still classifies');
  assert(onlyGdp.confidence < full.confidence, `${onlyGdp.confidence} should be below ${full.confidence}`);
  assert(onlyGdp.confidence <= 45, `single-indicator cap, got ${onlyGdp.confidence}`);
  assert(onlyGdp.availableCount === 1, 'available count');
});

check('empty input is not a phase', () => {
  const result = assessCycle([]);
  assert(result.phase === null, `phase ${result.phase}`);
  assert(result.confidence === 0, `confidence ${result.confidence}`);
  assert(result.score === 0, `score ${result.score}`);
  assert(result.momentum === 'steady', `momentum ${result.momentum}`);
  assert(result.indicators.length === 0, 'no indicator rows');
});

check('a heavier weight wins when two phases fit equally well', () => {
  const match: PhaseRule = { indicator: 'gdp_growth', weight: 1, levels: ['high'], changes: ['rising'] };
  const model: PhaseModel = {
    ...DEFAULT_PHASE_MODEL,
    rules: {
      recovery: [match],
      expansion: [{ ...match, weight: 5 }],
      late_expansion: [],
      slowdown: [],
      recession: [],
    },
  };
  const result = assessCycle([input('gdp_growth', 1.2, 0.2)], { model });
  assert(result.phase === 'expansion', `phase ${result.phase}`);
  // Both normalized scores are 1, so the margin is 0. Coverage is 1/11.
  // 0.62 + 0.15/11 rounds to 63, then the single-indicator cap applies.
  assert(result.confidence === 45, `confidence ${result.confidence}`);
  const blended = Math.round(
    (DEFAULT_PHASE_MODEL.anchors.recovery + DEFAULT_PHASE_MODEL.anchors.expansion) / 2,
  );
  assert(result.score === blended, `score ${result.score}`);
});

check('equal scores use the documented tie order', () => {
  const tied: PhaseRule = { indicator: 'gdp_growth', weight: 2, levels: ['high'] };
  const model: PhaseModel = {
    ...DEFAULT_PHASE_MODEL,
    rules: {
      recovery: [tied],
      expansion: [{ ...tied }],
      late_expansion: [],
      slowdown: [],
      recession: [],
    },
  };
  const result = assessCycle([input('gdp_growth', 1.2, 1.2)], { model });
  assert(result.phase === 'recovery', `tie should prefer recovery, got ${result.phase}`);
});

check('no matching rule leaves the phase unset', () => {
  const model: PhaseModel = {
    ...DEFAULT_PHASE_MODEL,
    rules: {
      recovery: [{ indicator: 'gdp_growth', weight: 1, levels: ['high'] }],
      expansion: [],
      late_expansion: [],
      slowdown: [],
      recession: [],
    },
  };
  const result = assessCycle([input('gdp_growth', -1, -0.2)], { model });
  assert(result.phase === null, `phase ${result.phase}`);
  assert(result.confidence === 0, `confidence ${result.confidence}`);
});

check('timeline carries the previous quarter phase', () => {
  const points = assessTimeline([
    { period: '2020-Q1', inputs: recession },
    { period: '2020-Q2', inputs: recovery },
  ]);
  assert(points.length === 2, 'two points');
  assert(points[0]?.phase === 'recession', `q1 ${points[0]?.phase}`);
  assert(points[0]?.previousPhase === null, 'first quarter has no previous phase');
  assert(points[1]?.phase === 'recovery', `q2 ${points[1]?.phase}`);
  assert(points[1]?.previousPhase === 'recession', `previous ${points[1]?.previousPhase}`);
});

check('catalogue size used by coverage is the full indicator list', () => {
  assert(INDICATOR_TYPES.length === 11, `catalogue ${INDICATOR_TYPES.length}`);
  const result = assessCycle(expansion);
  assert(result.availableCount === 11, `available ${result.availableCount}`);
  const phases: Phase[] = ['recovery', 'expansion', 'late_expansion', 'slowdown', 'recession'];
  for (const phase of phases) {
    assert(result.phaseScores[phase] != null, `missing score for ${phase}`);
  }
});

check('confidence detail reproduces the reported confidence', () => {
  const cases: IndicatorInput[][] = [recession, slowdown, recovery, expansion, recession.slice(0, 2), recovery.slice(0, 4)];
  for (const inputs of cases) {
    const result = assessCycle(inputs);
    const d = result.confidenceDetail;
    assert(d.weights.support === CONFIDENCE_WEIGHTS.support, 'weights are the scorer constants');
    if (!result.phase) continue;
    const raw = d.weights.support * d.support + d.weights.margin * d.margin + d.weights.coverage * d.coverage;
    let rebuilt = Math.round(100 * Math.min(1, Math.max(0, raw)));
    if (d.cap != null) rebuilt = Math.min(rebuilt, d.cap);
    assert(Math.abs(rebuilt - result.confidence) <= 1, `rebuilt ${rebuilt} vs ${result.confidence}`);
    const winner = result.phaseScores[result.phase].normalized;
    assert(Math.abs(d.support - winner) < 1e-3, 'support is the winning phase fit');
    assert(Math.abs(d.coverage - inputs.length / 11) < 1e-3, 'coverage is present / 11');
  }
  assert(assessCycle(recession.slice(0, 2)).confidenceDetail.cap === 45, 'two indicators cap at 45');
  assert(assessCycle(recovery.slice(0, 4)).confidenceDetail.cap === 70, 'four indicators cap at 70');
  assert(assessCycle(recession).confidenceDetail.cap === null, 'full coverage has no cap');
});

console.log(`\n${passed} scoring tests passed`);
