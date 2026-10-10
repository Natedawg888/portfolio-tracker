/**
 * Plain-language summaries built from the scorer's own classifications.
 * Nothing here changes a score. It reads levels, changes, fits, and rules.
 */
import { assetClassContext, type AssetClassContext } from './assetContext.ts';
import type { Analysis } from './analyse.ts';
import { INDICATOR_CATALOG } from './catalog.ts';
import {
  INDICATOR_TYPES,
  type ChangeName,
  type EconomicObservation,
  type IndicatorScoreDetail,
  type IndicatorType,
  type LevelName,
  type Phase,
} from './types.ts';
import {
  DEFAULT_PHASE_MODEL,
  PHASE_CYCLE_ORDER,
  PHASE_LABEL,
  type PhaseModel,
  type PhaseRule,
} from './weights.ts';

/** How an indicator relates to the calculated phase. Same cut-offs the page has always used. */
export type SignalStatus = 'supports' | 'mixed' | 'conflicts' | 'insufficient' | 'unscored';

export function signalStatus(fit: number | null, available: boolean, phase: Phase | null): SignalStatus {
  if (!available) return 'insufficient';
  if (phase == null || fit == null) return 'unscored';
  if (fit >= 0.75) return 'supports';
  if (fit >= 0.4) return 'mixed';
  return 'conflicts';
}

/** Display suffix for a threshold. Units follow the stored series. */
const UNIT_SUFFIX: Record<IndicatorType, string> = {
  gdp_growth: '%',
  inflation_cpi: '%',
  interest_rates: '%',
  unemployment: '%',
  employment_growth: '%',
  consumer_spending: '%',
  business_activity_pmi: '',
  credit_conditions: '',
  housing_activity: '%',
  share_market: '%',
  yield_curve: ' pp',
};

function num(value: number, indicator: IndicatorType): string {
  const places = indicator === 'yield_curve' ? 2 : 1;
  return `${value.toFixed(places)}${UNIT_SUFFIX[indicator]}`;
}

/** Turn the level buckets in a rule into a numeric range from the thresholds. */
export function describeLevels(indicator: IndicatorType, levels: LevelName[] | undefined, model: PhaseModel = DEFAULT_PHASE_MODEL): string | null {
  if (!levels || levels.length === 0 || levels.length === 3) return null;
  const t = model.thresholds[indicator];
  const has = (level: LevelName) => levels.includes(level);
  if (has('low') && has('moderate')) return `at or below ${num(t.highAbove, indicator)}`;
  if (has('moderate') && has('high')) return `at or above ${num(t.lowBelow, indicator)}`;
  if (has('low') && has('high')) return `outside ${num(t.lowBelow, indicator)}–${num(t.highAbove, indicator)}`;
  if (has('low')) return `below ${num(t.lowBelow, indicator)}`;
  if (has('high')) return `above ${num(t.highAbove, indicator)}`;
  return `between ${num(t.lowBelow, indicator)} and ${num(t.highAbove, indicator)}`;
}

export function describeChanges(changes: ChangeName[] | undefined): string | null {
  if (!changes || changes.length === 0 || changes.length === 3) return null;
  const has = (change: ChangeName) => changes.includes(change);
  if (has('rising') && has('stable')) return 'not falling';
  if (has('falling') && has('stable')) return 'not rising';
  if (has('rising') && has('falling')) return 'moving';
  if (has('rising')) return 'rising';
  if (has('falling')) return 'falling';
  return 'little changed';
}

/** "at or above 0.0%, not falling" — what a phase rule expects of one indicator. */
export function describeRule(rule: PhaseRule, model: PhaseModel = DEFAULT_PHASE_MODEL): string {
  const parts = [describeLevels(rule.indicator, rule.levels, model), describeChanges(rule.changes)].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(', ') : 'any reading';
}

export function ruleFor(phase: Phase, indicator: IndicatorType, model: PhaseModel = DEFAULT_PHASE_MODEL): PhaseRule | null {
  return model.rules[phase].find((rule) => rule.indicator === indicator) ?? null;
}

// ---------------------------------------------------------------------------
// Takeaways

export type TakeawayTrend = 'up' | 'down' | 'flat' | 'mixed' | 'unknown';

export type Takeaway = {
  id: 'growth' | 'prices' | 'jobs';
  title: string;
  headline: string;
  detail: string;
  trend: TakeawayTrend;
  indicators: IndicatorType[];
};

type Reading = {
  indicator: IndicatorType;
  observation: EconomicObservation;
  signal: IndicatorScoreDetail;
  stale: boolean;
};

const SHORT_LABEL: Record<IndicatorType, string> = {
  gdp_growth: 'GDP',
  inflation_cpi: 'CPI inflation',
  interest_rates: 'Short-term rate',
  unemployment: 'Unemployment',
  employment_growth: 'Jobs growth',
  consumer_spending: 'Spending',
  business_activity_pmi: 'Business activity',
  credit_conditions: 'Credit',
  housing_activity: 'Housing activity',
  share_market: 'Shares (3 mo)',
  yield_curve: 'Yield spread',
};

function fragment(reading: Reading): string {
  const { observation, indicator, signal } = reading;
  const value = num(observation.value, indicator);
  const prev = observation.previousValue;
  const stale = reading.stale ? ' (older print)' : '';
  if (prev == null || signal.change === 'unknown') return `${SHORT_LABEL[indicator]} ${value}${stale}`;
  if (signal.change === 'stable') return `${SHORT_LABEL[indicator]} ${value}, little changed${stale}`;
  return `${SHORT_LABEL[indicator]} ${value}, ${signal.change === 'rising' ? 'up' : 'down'} from ${num(prev, indicator)}${stale}`;
}

/** +1 stronger, −1 weaker, 0 flat, null unknown. */
function strength(reading: Reading, higherIsStronger: boolean): number | null {
  const change = reading.signal.change;
  if (change === 'unknown') return null;
  if (change === 'stable') return 0;
  const up = change === 'rising';
  return up === higherIsStronger ? 1 : -1;
}

function blend(scores: Array<number | null>): TakeawayTrend {
  const known = scores.filter((n): n is number => n != null);
  if (known.length === 0) return 'unknown';
  const ups = known.filter((n) => n > 0).length;
  const downs = known.filter((n) => n < 0).length;
  if (ups > 0 && downs > 0 && ups === downs) return 'mixed';
  if (ups > downs) return 'up';
  if (downs > ups) return 'down';
  return 'flat';
}

export function buildTakeaways(readings: Map<IndicatorType, Reading>): Takeaway[] {
  const pick = (...types: IndicatorType[]) =>
    types.map((type) => readings.get(type)).filter((row): row is Reading => row != null);
  const out: Takeaway[] = [];

  const growth = pick('gdp_growth', 'consumer_spending', 'business_activity_pmi');
  if (growth.length > 0) {
    const trend = blend(growth.map((row) => strength(row, true)));
    const headline =
      trend === 'up'
        ? 'Growth is picking up'
        : trend === 'down'
          ? 'Growth is slowing'
          : trend === 'mixed'
            ? 'Growth signals are mixed'
            : trend === 'flat'
              ? 'Growth is holding steady'
              : 'Growth trend unclear';
    out.push({
      id: 'growth',
      title: 'Growth',
      headline,
      detail: growth.map(fragment).join(' · '),
      trend,
      indicators: growth.map((row) => row.indicator),
    });
  }

  const prices = pick('inflation_cpi', 'interest_rates');
  if (prices.length > 0) {
    const cpi = readings.get('inflation_cpi');
    const trend: TakeawayTrend = cpi
      ? cpi.signal.change === 'rising'
        ? 'up'
        : cpi.signal.change === 'falling'
          ? 'down'
          : cpi.signal.change === 'stable'
            ? 'flat'
            : 'unknown'
      : blend(prices.map((row) => strength(row, true)));
    let headline: string;
    if (cpi) {
      const band = DEFAULT_PHASE_MODEL.thresholds.inflation_cpi;
      const where =
        cpi.signal.level === 'high'
          ? `above ${num(band.highAbove, 'inflation_cpi')}`
          : cpi.signal.level === 'low'
            ? `below ${num(band.lowBelow, 'inflation_cpi')}`
            : `within ${band.lowBelow.toFixed(1)}–${num(band.highAbove, 'inflation_cpi')}`;
      headline =
        trend === 'up'
          ? `Inflation is rising, ${where}`
          : trend === 'down'
            ? `Inflation is easing, ${where}`
            : trend === 'flat'
              ? `Inflation is steady, ${where}`
              : `Inflation is ${where}`;
    } else {
      headline = 'Interest rates only — no inflation reading';
    }
    out.push({
      id: 'prices',
      title: 'Prices & rates',
      headline,
      detail: prices.map(fragment).join(' · '),
      trend,
      indicators: prices.map((row) => row.indicator),
    });
  }

  const jobs = pick('unemployment', 'employment_growth');
  if (jobs.length > 0) {
    const trend = blend([
      readings.get('unemployment') ? strength(readings.get('unemployment')!, false) : null,
      readings.get('employment_growth') ? strength(readings.get('employment_growth')!, true) : null,
    ]);
    const unemployment = readings.get('unemployment');
    const resilientLevel = unemployment ? unemployment.signal.level !== 'high' : false;
    const headline =
      trend === 'up'
        ? 'Jobs market is strengthening'
        : trend === 'down'
          ? resilientLevel
            ? 'Jobs market is softening from a low base'
            : 'Jobs market is weakening'
          : trend === 'mixed'
            ? 'Jobs signals are mixed'
            : trend === 'flat'
              ? 'Jobs market is holding steady'
              : 'Jobs trend unclear';
    out.push({
      id: 'jobs',
      title: 'Jobs',
      headline,
      detail: jobs.map(fragment).join(' · '),
      trend,
      indicators: jobs.map((row) => row.indicator),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// One-line card summary

/** A single sentence for a card: where the reading sits against the model's lines, and its move. */
export function cardSummary(
  indicator: IndicatorType,
  observation: EconomicObservation | null,
  signal: IndicatorScoreDetail | null,
  model: PhaseModel = DEFAULT_PHASE_MODEL,
): string | null {
  if (!observation) return null;
  if (!signal) return null;
  const t = model.thresholds[indicator];
  const band =
    signal.level === 'high'
      ? `Above the ${num(t.highAbove, indicator)} high line`
      : signal.level === 'low'
        ? `Below the ${num(t.lowBelow, indicator)} low line`
        : `Inside the ${num(t.lowBelow, indicator)} to ${num(t.highAbove, indicator)} middle band`;
  const move =
    signal.change === 'rising'
      ? 'and rising'
      : signal.change === 'falling'
        ? 'and falling'
        : signal.change === 'stable'
          ? 'and little changed'
          : 'with no earlier reading to compare';
  return `${band} ${move}.`;
}

// ---------------------------------------------------------------------------
// Phase guide

/** General definitions. Educational, not calculated. */
const PHASE_SUMMARY: Record<Phase, string> = {
  recovery: 'Output stops shrinking and starts to rise from a weak base. Spare capacity is still large and interest rates are often falling.',
  expansion: 'Growth is solid and broad. Jobs and spending rise, and inflation is usually near the target band.',
  late_expansion: 'The economy runs close to capacity. Inflation and interest rates tend to be high and the yield curve flattens.',
  slowdown: 'Growth is still positive but losing pace. Spending, hiring, and business activity cool.',
  recession: 'Output, jobs, and spending contract. Unemployment rises and credit tightens.',
};

export type PhaseGuideRule = {
  indicator: IndicatorType;
  label: string;
  weight: number;
  expects: string;
  /** Fit of today's reading to this rule, 0–1, or null when there is no reading. */
  currentFit: number | null;
};

export type PhaseGuideTypical = {
  indicator: IndicatorType;
  label: string;
  median: number;
  unitSuffix: string;
  quarters: number;
};

export type PhaseGuide = {
  id: Phase;
  label: string;
  summary: string;
  /** Fit of today's indicators to this phase, 0–100. */
  currentFit: number;
  rules: PhaseGuideRule[];
  quartersInPhase: number;
  totalQuarters: number;
  lastSeen: string | null;
  typical: PhaseGuideTypical[];
  assets: AssetClassContext[];
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export { median };

export function buildPhaseGuide(
  analysis: Pick<Analysis, 'timeline' | 'frames' | 'current'>,
  fitFor: (phase: Phase, indicator: IndicatorType) => number | null,
  model: PhaseModel = DEFAULT_PHASE_MODEL,
): PhaseGuide[] {
  const inputsByPeriod = new Map(analysis.frames.map((frame) => [frame.period, frame.inputs]));
  const scored = analysis.timeline.filter((point) => point.phase != null);
  return PHASE_CYCLE_ORDER.map((phase) => {
    const quarters = scored.filter((point) => point.phase === phase);
    const typical: PhaseGuideTypical[] = [];
    for (const indicator of INDICATOR_TYPES) {
      const values: number[] = [];
      for (const point of quarters) {
        const row = inputsByPeriod.get(point.period)?.find((input) => input.indicator === indicator);
        if (row) values.push(row.value);
      }
      const mid = median(values);
      if (mid == null) continue;
      typical.push({
        indicator,
        label: INDICATOR_CATALOG[indicator].label,
        median: Math.round(mid * 100) / 100,
        unitSuffix: UNIT_SUFFIX[indicator],
        quarters: values.length,
      });
    }
    return {
      id: phase,
      label: PHASE_LABEL[phase],
      summary: PHASE_SUMMARY[phase],
      currentFit: Math.round((analysis.current?.phaseScores[phase].normalized ?? 0) * 100),
      rules: [...model.rules[phase]]
        .sort((a, b) => b.weight - a.weight)
        .map((rule) => ({
          indicator: rule.indicator,
          label: INDICATOR_CATALOG[rule.indicator].label,
          weight: rule.weight,
          expects: describeRule(rule, model),
          currentFit: fitFor(phase, rule.indicator),
        })),
      quartersInPhase: quarters.length,
      totalQuarters: scored.length,
      lastSeen: quarters.at(-1)?.period ?? null,
      typical,
      assets: assetClassContext(phase),
    };
  });
}

// ---------------------------------------------------------------------------
// Freshness

export type Freshness = {
  newestPeriod: string | null;
  oldestPeriod: string | null;
  staleCount: number;
  missingCount: number;
  derivedCount: number;
  /** True when the cards do not all share one reporting period. */
  mixedPeriods: boolean;
};

export function buildFreshness(
  cards: Array<{ available: boolean; period: string | null; periodEnd: string | null; stale: boolean; derived: boolean }>,
): Freshness {
  const present = cards.filter((card) => card.available && card.period && card.periodEnd);
  const sorted = [...present].sort((a, b) => (a.periodEnd! < b.periodEnd! ? -1 : a.periodEnd! > b.periodEnd! ? 1 : 0));
  return {
    newestPeriod: sorted.at(-1)?.period ?? null,
    oldestPeriod: sorted[0]?.period ?? null,
    staleCount: cards.filter((card) => card.available && card.stale).length,
    missingCount: cards.filter((card) => !card.available).length,
    derivedCount: cards.filter((card) => card.available && card.derived).length,
    mixedPeriods: new Set(present.map((card) => card.period)).size > 1,
  };
}

/** Indicators whose stored value is arithmetic in this app on a published level. */
const DERIVED_INDICATORS = new Set<IndicatorType>([
  'employment_growth',
  'housing_activity',
  'business_activity_pmi',
  'share_market',
  'yield_curve',
]);

export function isDerived(indicator: IndicatorType, notes: string | null | undefined): boolean {
  if (DERIVED_INDICATORS.has(indicator)) return true;
  return /calculated (here|in this app)|calculated as/i.test(notes ?? '');
}

export { UNIT_SUFFIX, SHORT_LABEL };
