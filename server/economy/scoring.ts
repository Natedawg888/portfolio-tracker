/**
 * Transparent phase scoring. Deterministic: same inputs and model, same result.
 * There is no clock and no network in this module.
 */
import {
  INDICATOR_TYPES,
  PHASES,
  type ChangeName,
  type ClassifiedSignal,
  type ConfidenceDetail,
  type CycleAssessment,
  type DirectionName,
  type IndicatorInput,
  type IndicatorScoreDetail,
  type IndicatorType,
  type LevelName,
  type MomentumName,
  type Phase,
  type PhaseScoreDetail,
} from './types.ts';
import { DEFAULT_PHASE_MODEL, type PhaseModel, type PhaseRule } from './weights.ts';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function roundTo(n: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

export function classifySignal(
  indicator: IndicatorType,
  value: number,
  previousValue: number | null,
  model: PhaseModel = DEFAULT_PHASE_MODEL,
): ClassifiedSignal {
  const threshold = model.thresholds[indicator];
  const level: LevelName =
    value < threshold.lowBelow ? 'low' : value > threshold.highAbove ? 'high' : 'moderate';
  let change: ChangeName | 'unknown' = 'unknown';
  let direction: DirectionName = 'unknown';
  if (previousValue != null && Number.isFinite(previousValue)) {
    const delta = roundTo(value - previousValue, 6);
    if (Math.abs(delta) <= threshold.flatBand) {
      change = 'stable';
      direction = 'flat';
    } else if (delta > 0) {
      change = 'rising';
      direction = 'up';
    } else {
      change = 'falling';
      direction = 'down';
    }
  }
  return { indicator, value, previousValue, level, change, direction };
}

/** 1 when every stated condition matches, 0 when one fails, 0.5 when change is unknown. */
export function ruleFit(signal: ClassifiedSignal, rule: PhaseRule): number {
  const parts: number[] = [];
  if (rule.levels && rule.levels.length > 0) {
    parts.push(rule.levels.includes(signal.level) ? 1 : 0);
  }
  if (rule.changes && rule.changes.length > 0) {
    if (signal.change === 'unknown') parts.push(0.5);
    else parts.push(rule.changes.includes(signal.change) ? 1 : 0);
  }
  if (parts.length === 0) return 0;
  return Math.min(...parts);
}

function emptyPhaseScores(): Record<Phase, PhaseScoreDetail> {
  const scores = {} as Record<Phase, PhaseScoreDetail>;
  for (const phase of PHASES) {
    scores[phase] = { raw: 0, normalized: 0, weightUsed: 0 };
  }
  return scores;
}

function momentumOf(signals: ClassifiedSignal[], model: PhaseModel): MomentumName {
  const scores: number[] = [];
  for (const signal of signals) {
    const polarity = model.activity[signal.indicator];
    if (!polarity) continue;
    if (signal.change === 'unknown') continue;
    if (signal.change === 'stable') {
      scores.push(0);
      continue;
    }
    const rising = signal.change === 'rising';
    if (polarity === 'higher_is_stronger') scores.push(rising ? 1 : -1);
    else scores.push(rising ? -1 : 1);
  }
  if (scores.length === 0) return 'steady';
  const average = scores.reduce((sum, n) => sum + n, 0) / scores.length;
  if (average > model.momentumBand) return 'strengthening';
  if (average < -model.momentumBand) return 'weakening';
  return 'steady';
}

/** How support, margin, and coverage are blended into confidence. */
export const CONFIDENCE_WEIGHTS = { support: 0.62, margin: 0.23, coverage: 0.15 } as const;

export type AssessOptions = {
  model?: PhaseModel;
  previousPhase?: Phase | null;
};

export function assessCycle(inputs: IndicatorInput[], options: AssessOptions = {}): CycleAssessment {
  const model = options.model ?? DEFAULT_PHASE_MODEL;
  const byIndicator = new Map<IndicatorType, ClassifiedSignal>();
  for (const row of inputs) {
    if (!Number.isFinite(row.value)) continue;
    byIndicator.set(
      row.indicator,
      classifySignal(row.indicator, row.value, row.previousValue, model),
    );
  }
  const signals = [...byIndicator.values()];
  const phaseScores = emptyPhaseScores();

  for (const phase of PHASES) {
    let raw = 0;
    let weightUsed = 0;
    for (const rule of model.rules[phase]) {
      const signal = byIndicator.get(rule.indicator);
      if (!signal) continue;
      weightUsed += rule.weight;
      raw += rule.weight * ruleFit(signal, rule);
    }
    phaseScores[phase] = {
      raw: roundTo(raw, 6),
      normalized: weightUsed > 0 ? roundTo(raw / weightUsed, 6) : 0,
      weightUsed: roundTo(weightUsed, 6),
    };
  }

  const ranked = PHASES.filter((phase) => phaseScores[phase].weightUsed > 0).sort((a, b) => {
    const normDiff = phaseScores[b].normalized - phaseScores[a].normalized;
    if (Math.abs(normDiff) > 1e-9) return normDiff;
    const rawDiff = phaseScores[b].raw - phaseScores[a].raw;
    if (Math.abs(rawDiff) > 1e-9) return rawDiff;
    return model.tieOrder.indexOf(a) - model.tieOrder.indexOf(b);
  });

  const best = ranked[0] ?? null;
  const bestNorm = best ? phaseScores[best].normalized : 0;
  const phase = best != null && bestNorm > 0 ? best : null;
  const secondNorm = ranked.length > 1 ? phaseScores[ranked[1]!]!.normalized : 0;

  let score = 0;
  if (phase) {
    let numerator = 0;
    let denominator = 0;
    for (const candidate of PHASES) {
      const normalized = phaseScores[candidate].normalized;
      if (normalized <= 0) continue;
      numerator += model.anchors[candidate] * normalized;
      denominator += normalized;
    }
    score = denominator > 0 ? Math.round(numerator / denominator) : 0;
  }

  const availableCount = signals.length;
  let confidence = 0;
  const confidenceDetail: ConfidenceDetail = {
    support: 0,
    margin: 0,
    coverage: 0,
    weights: { ...CONFIDENCE_WEIGHTS },
    cap: null,
  };
  if (phase && availableCount > 0) {
    const support = bestNorm;
    const margin = bestNorm <= 0 ? 0 : (bestNorm - secondNorm) / bestNorm;
    const coverage = availableCount / INDICATOR_TYPES.length;
    const rawConfidence =
      CONFIDENCE_WEIGHTS.support * support +
      CONFIDENCE_WEIGHTS.margin * margin +
      CONFIDENCE_WEIGHTS.coverage * coverage;
    confidence = Math.round(100 * clamp(rawConfidence, 0, 1));
    const cap = availableCount < 3 ? 45 : availableCount < 5 ? 70 : null;
    if (cap != null) confidence = Math.min(confidence, cap);
    confidenceDetail.support = roundTo(support, 4);
    confidenceDetail.margin = roundTo(margin, 4);
    confidenceDetail.coverage = roundTo(coverage, 4);
    confidenceDetail.cap = cap;
  }

  const indicators: IndicatorScoreDetail[] = signals
    .sort((a, b) => INDICATOR_TYPES.indexOf(a.indicator) - INDICATOR_TYPES.indexOf(b.indicator))
    .map((signal) => {
      const rule = phase ? model.rules[phase].find((item) => item.indicator === signal.indicator) : undefined;
      const fit = rule ? ruleFit(signal, rule) : 0;
      const weight = rule?.weight ?? 0;
      return {
        indicator: signal.indicator,
        score: Math.round(fit * 100),
        direction: signal.direction,
        contribution: roundTo(weight * fit, 4),
        level: signal.level,
        change: signal.change,
        fit,
      };
    });

  return {
    phase,
    score,
    confidence,
    confidenceDetail,
    momentum: momentumOf(signals, model),
    previousPhase: options.previousPhase ?? null,
    phaseScores,
    indicators,
    availableCount,
  };
}

export type TimelineFrame = {
  period: string;
  inputs: IndicatorInput[];
};

export type TimelinePoint = CycleAssessment & { period: string };

/** Score each frame on its own indicators. Previous phase is the prior frame only. */
export function assessTimeline(frames: TimelineFrame[], model: PhaseModel = DEFAULT_PHASE_MODEL): TimelinePoint[] {
  const points: TimelinePoint[] = [];
  let previousPhase: Phase | null = null;
  for (const frame of frames) {
    const assessment = assessCycle(frame.inputs, { model, previousPhase });
    points.push({ period: frame.period, ...assessment });
    previousPhase = assessment.phase;
  }
  return points;
}
