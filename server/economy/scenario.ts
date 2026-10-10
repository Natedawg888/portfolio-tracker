/**
 * What-if scoring. Takes a copy of the inputs the current quarter was scored
 * on, replaces the values a user supplied, and runs the same assessCycle.
 *
 * Hypothetical values never leave this function: no store, no provider, no
 * cache. Each overridden indicator keeps its real previous value, so its
 * change is measured against the last published reading.
 */
import type { Analysis } from './analyse.ts';
import { INDICATOR_CATALOG } from './catalog.ts';
import { assessCycle } from './scoring.ts';
import type { CycleAssessment, IndicatorInput, IndicatorType, Phase } from './types.ts';
import { PHASE_CYCLE_ORDER, PHASE_LABEL } from './weights.ts';

/** Indicators a scenario may change, with the range a slider may reach. */
export const SCENARIO_LIMITS: Partial<Record<IndicatorType, { min: number; max: number; step: number }>> = {
  gdp_growth: { min: -5, max: 5, step: 0.1 },
  inflation_cpi: { min: -2, max: 15, step: 0.1 },
  unemployment: { min: 1, max: 15, step: 0.1 },
  interest_rates: { min: 0, max: 15, step: 0.05 },
  consumer_spending: { min: -5, max: 5, step: 0.1 },
};

export type ScenarioOverrides = Partial<Record<IndicatorType, number>>;

export class ScenarioInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioInputError';
  }
}

/** Accept only known, finite, in-range numbers for the scenario indicators. */
export function parseOverrides(raw: unknown): ScenarioOverrides {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ScenarioInputError('overrides must be an object of indicator → number');
  }
  const out: ScenarioOverrides = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const limits = SCENARIO_LIMITS[key as IndicatorType];
    if (!limits) throw new ScenarioInputError(`${key} cannot be changed in a scenario`);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ScenarioInputError(`${key} must be a finite number`);
    }
    if (value < limits.min || value > limits.max) {
      throw new ScenarioInputError(`${key} must be between ${limits.min} and ${limits.max}`);
    }
    out[key as IndicatorType] = value;
  }
  return out;
}

export type ScenarioSide = {
  phase: Phase | null;
  phaseLabel: string | null;
  confidence: number;
  score: number;
  phaseFits: Array<{ id: Phase; label: string; fit: number }>;
};

export type ScenarioResult = {
  hypothetical: true;
  asOfPeriod: string | null;
  baseline: ScenarioSide;
  scenario: ScenarioSide;
  changed: Array<{
    indicator: IndicatorType;
    label: string;
    actual: number;
    hypothetical: number;
    previous: number | null;
    level: string;
    change: string;
  }>;
  /** Requested indicators with no real reading this quarter, so they could not be changed. */
  unavailable: Array<{ indicator: IndicatorType; label: string }>;
  note: string;
};

function side(assessment: CycleAssessment): ScenarioSide {
  return {
    phase: assessment.phase,
    phaseLabel: assessment.phase ? PHASE_LABEL[assessment.phase] : null,
    confidence: assessment.confidence,
    score: assessment.score,
    phaseFits: PHASE_CYCLE_ORDER.map((id) => ({
      id,
      label: PHASE_LABEL[id],
      fit: Math.round(assessment.phaseScores[id].normalized * 100),
    })),
  };
}

export const SCENARIO_NOTE =
  'Hypothetical. These figures were typed in, not published. The result shows how the same scoring rules would read them. It is not a forecast and nothing is saved.';

export function runScenario(
  analysis: Pick<Analysis, 'frames' | 'timeline' | 'current'>,
  overrides: ScenarioOverrides,
): ScenarioResult {
  const frame = analysis.frames.at(-1) ?? null;
  const current = analysis.current;
  const previousPhase = analysis.timeline.length > 1 ? (analysis.timeline.at(-2)?.phase ?? null) : null;
  const baseInputs: IndicatorInput[] = frame ? frame.inputs.map((row) => ({ ...row })) : [];
  const baseline = current ?? assessCycle(baseInputs, { previousPhase });

  const unavailable: ScenarioResult['unavailable'] = [];
  const scenarioInputs = baseInputs.map((row) => ({ ...row }));
  for (const [key, value] of Object.entries(overrides) as Array<[IndicatorType, number]>) {
    const row = scenarioInputs.find((input) => input.indicator === key);
    if (!row) {
      unavailable.push({ indicator: key, label: INDICATOR_CATALOG[key].label });
      continue;
    }
    row.value = value;
  }
  const scenario = assessCycle(scenarioInputs, { previousPhase });

  const changed: ScenarioResult['changed'] = [];
  for (const row of scenarioInputs) {
    const original = baseInputs.find((input) => input.indicator === row.indicator);
    if (!original || original.value === row.value) continue;
    const detail = scenario.indicators.find((item) => item.indicator === row.indicator);
    changed.push({
      indicator: row.indicator,
      label: INDICATOR_CATALOG[row.indicator].label,
      actual: original.value,
      hypothetical: row.value,
      previous: row.previousValue,
      level: detail?.level ?? 'unknown',
      change: detail?.change ?? 'unknown',
    });
  }

  return {
    hypothetical: true,
    asOfPeriod: frame?.period ?? null,
    baseline: side(baseline),
    scenario: side(scenario),
    changed,
    unavailable,
    note: SCENARIO_NOTE,
  };
}
