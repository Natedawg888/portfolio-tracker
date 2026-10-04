/**
 * Starting-point phase definitions for New Zealand.
 * Edit weights and thresholds here; the scorer reads this object and does not
 * hard-code a phase.
 */
import type { IndicatorType, Phase } from './types.ts';

export type LevelName = 'low' | 'moderate' | 'high';
export type ChangeName = 'falling' | 'stable' | 'rising';
export type ActivityPolarity = 'higher_is_stronger' | 'higher_is_weaker';

export type IndicatorThreshold = {
  /** value < lowBelow → low */
  lowBelow: number;
  /** value > highAbove → high; otherwise moderate when it is not low */
  highAbove: number;
  /** |value − previous| <= flatBand → stable */
  flatBand: number;
};

/** A rule matches only when every listed condition matches. */
export type PhaseRule = {
  indicator: IndicatorType;
  weight: number;
  levels?: LevelName[];
  changes?: ChangeName[];
};

export type PhaseModel = {
  version: number;
  thresholds: Record<IndicatorType, IndicatorThreshold>;
  rules: Record<Phase, PhaseRule[]>;
  /** Position on a -100…+100 summary scale. */
  anchors: Record<Phase, number>;
  activity: Partial<Record<IndicatorType, ActivityPolarity>>;
  /** |average activity score| must clear this to count as strengthening or weakening. */
  momentumBand: number;
  tieOrder: Phase[];
};

function rule(
  indicator: IndicatorType,
  weight: number,
  levels?: LevelName[],
  changes?: ChangeName[],
): PhaseRule {
  return { indicator, weight, levels, changes };
}

export const PHASE_MODEL_VERSION = 1;

export const DEFAULT_PHASE_MODEL: PhaseModel = {
  version: PHASE_MODEL_VERSION,
  thresholds: {
    // Quarterly percent change. Contracting is low; a firm quarter is high.
    gdp_growth: { lowBelow: 0, highAbove: 0.5, flatBand: 0.1 },
    // Annual CPI percent. Inside the 1–3 band is moderate.
    inflation_cpi: { lowBelow: 1, highAbove: 3, flatBand: 0.15 },
    // Percent per annum. A tight policy setting is high.
    interest_rates: { lowBelow: 2, highAbove: 4, flatBand: 0.1 },
    // Unemployment rate, percent. A tight labour market is low.
    unemployment: { lowBelow: 4.5, highAbove: 5.5, flatBand: 0.1 },
    // Annual percent change in filled jobs.
    employment_growth: { lowBelow: 0, highAbove: 1.5, flatBand: 0.15 },
    // Quarterly real percent change in retail sales.
    consumer_spending: { lowBelow: 0, highAbove: 0.6, flatBand: 0.1 },
    // PMI-style index, 50 as the centre of the moderate band.
    business_activity_pmi: { lowBelow: 48, highAbove: 52, flatBand: 0.5 },
    // Net percentage of banks easing standards. Below zero is net tightening.
    // Above 10 is a clear easing. Moves of 5 points or less are stable.
    credit_conditions: { lowBelow: 0, highAbove: 10, flatBand: 5 },
    // Annual percent change in housing activity (consents or housing starts).
    housing_activity: { lowBelow: 0, highAbove: 5, flatBand: 1 },
    // Three-month percent change in a share-price index.
    share_market: { lowBelow: -2, highAbove: 3, flatBand: 0.5 },
    // Long rate minus short rate, percentage points.
    yield_curve: { lowBelow: 0.25, highAbove: 1.25, flatBand: 0.05 },
  },
  rules: {
    recovery: [
      rule('gdp_growth', 1.7, ['low', 'moderate'], ['rising']),
      rule('inflation_cpi', 1.1, ['low', 'moderate'], ['falling', 'stable']),
      rule('interest_rates', 1.3, undefined, ['falling']),
      rule('unemployment', 1.3, undefined, ['falling', 'stable']),
      rule('employment_growth', 0.9, undefined, ['rising', 'stable']),
      rule('consumer_spending', 0.9, undefined, ['rising']),
      rule('business_activity_pmi', 1.0, undefined, ['rising']),
      rule('credit_conditions', 0.6, undefined, ['rising', 'stable']),
      rule('housing_activity', 0.4, undefined, ['rising', 'stable']),
      rule('share_market', 0.5, ['moderate', 'high']),
      rule('yield_curve', 0.5, undefined, ['rising', 'stable']),
    ],
    expansion: [
      rule('gdp_growth', 1.6, ['moderate', 'high'], ['stable', 'rising']),
      rule('inflation_cpi', 1.4, ['moderate'], ['stable', 'falling']),
      rule('interest_rates', 0.7, ['low', 'moderate']),
      rule('unemployment', 1.3, ['low', 'moderate'], ['stable', 'falling']),
      rule('employment_growth', 1.3, ['moderate', 'high']),
      rule('consumer_spending', 1.3, ['moderate', 'high']),
      rule('business_activity_pmi', 1.1, ['high']),
      rule('credit_conditions', 0.5, ['moderate', 'high']),
      rule('housing_activity', 0.5, ['moderate', 'high']),
      rule('share_market', 0.4, ['moderate', 'high']),
      rule('yield_curve', 0.3, ['moderate', 'high']),
    ],
    late_expansion: [
      rule('gdp_growth', 1.4, ['high']),
      rule('inflation_cpi', 1.5, ['high'], ['rising', 'stable']),
      rule('interest_rates', 1.5, ['high'], ['rising', 'stable']),
      rule('unemployment', 1.4, ['low']),
      rule('employment_growth', 0.8, ['high']),
      rule('consumer_spending', 0.8, ['high']),
      rule('business_activity_pmi', 0.6, ['high']),
      rule('credit_conditions', 0.5, undefined, ['falling']),
      rule('housing_activity', 0.6, ['high']),
      rule('share_market', 0.8, ['high']),
      rule('yield_curve', 0.9, ['low'], ['falling', 'stable']),
    ],
    slowdown: [
      rule('gdp_growth', 1.6, ['moderate'], ['falling']),
      rule('inflation_cpi', 0.8, undefined, ['falling', 'stable']),
      rule('interest_rates', 1.2, ['moderate', 'high'], ['falling', 'stable']),
      rule('unemployment', 1.4, ['low', 'moderate'], ['rising']),
      rule('employment_growth', 1.1, ['moderate'], ['falling']),
      rule('consumer_spending', 1.3, ['moderate'], ['falling']),
      rule('business_activity_pmi', 1.2, ['moderate'], ['falling']),
      rule('credit_conditions', 0.7, undefined, ['falling']),
      rule('housing_activity', 0.6, ['moderate'], ['falling']),
      rule('share_market', 0.6, undefined, ['falling']),
      rule('yield_curve', 0.5, ['low', 'moderate'], ['falling', 'stable']),
    ],
    recession: [
      rule('gdp_growth', 1.8, ['low'], ['falling', 'stable']),
      rule('inflation_cpi', 0.6, undefined, ['falling', 'stable']),
      rule('interest_rates', 1.1, undefined, ['falling']),
      rule('unemployment', 1.6, ['high'], ['rising']),
      rule('employment_growth', 1.3, ['low'], ['falling', 'stable']),
      rule('consumer_spending', 1.4, ['low']),
      rule('business_activity_pmi', 1.4, ['low']),
      rule('credit_conditions', 1.0, ['low']),
      rule('housing_activity', 0.8, ['low']),
      rule('share_market', 0.7, ['low']),
      rule('yield_curve', 0.4, undefined, ['rising', 'stable']),
    ],
  },
  anchors: {
    recession: -80,
    slowdown: -40,
    recovery: 15,
    expansion: 55,
    late_expansion: 75,
  },
  activity: {
    gdp_growth: 'higher_is_stronger',
    unemployment: 'higher_is_weaker',
    employment_growth: 'higher_is_stronger',
    consumer_spending: 'higher_is_stronger',
    business_activity_pmi: 'higher_is_stronger',
    housing_activity: 'higher_is_stronger',
  },
  momentumBand: 0.2,
  tieOrder: ['recession', 'slowdown', 'recovery', 'expansion', 'late_expansion'],
};

export const PHASE_LABEL: Record<Phase, string> = {
  recovery: 'Recovery',
  expansion: 'Expansion',
  late_expansion: 'Late Expansion',
  slowdown: 'Slowdown',
  recession: 'Recession',
};

/** Visual order. Recession can be followed by Recovery; that is not a timer. */
export const PHASE_CYCLE_ORDER: Phase[] = [
  'recovery',
  'expansion',
  'late_expansion',
  'slowdown',
  'recession',
];
