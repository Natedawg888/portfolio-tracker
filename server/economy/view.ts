/**
 * Turn stored observations and a score into the dashboard payload.
 * The page renders this. It does not classify phases itself.
 */
import { analyseObservations } from './analyse.ts';
import { assetClassContext } from './assetContext.ts';
import { INDICATOR_CATALOG } from './catalog.ts';
import { economyCountry, listEconomyCountries } from './countries.ts';
import { daysAfter, periodEnd } from './periods.ts';
import {
  INDICATOR_TYPES,
  type CycleAssessment,
  type DirectionName,
  type EconomicObservation,
  type Frequency,
  type IndicatorType,
  type MomentumName,
  type Phase,
  type ProviderKind,
} from './types.ts';
import { PHASE_CYCLE_ORDER, PHASE_LABEL, PHASE_MODEL_VERSION } from './weights.ts';

const DISCLAIMER =
  'Educational context only. This is not financial advice and it does not recommend any investment action. Confidence is how strongly the available indicators support the phase. It is not a forecast.';

const VINTAGE_NOTE =
  'History uses the latest vintage of each series, including revisions. It is not a record of what the phase would have been when each period was first published.';

const MOMENTUM_LABEL: Record<MomentumName, string> = {
  strengthening: 'Strengthening',
  weakening: 'Weakening',
  steady: 'Steady',
};

const DIRECTION_LABEL: Record<DirectionName, string> = {
  up: 'Up',
  down: 'Down',
  flat: 'Little change',
  unknown: 'No previous value',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatPeriod(period: string): string {
  const quarter = period.match(/^(\d{4})-Q([1-4])$/);
  if (quarter) {
    const endMonth = Number(quarter[2]) * 3;
    return `${MONTHS[endMonth - 1]} ${quarter[1]} quarter`;
  }
  const month = period.match(/^(\d{4})-(\d{2})$/);
  if (month) return `${MONTHS[Number(month[2]) - 1]} ${month[1]}`;
  return period;
}

export function formatIndicatorNumber(value: number, unit: string): string {
  if (unit === 'percentage points') return `${value.toFixed(2)} pp`;
  if (unit === 'percent') return `${value.toFixed(1)}%`;
  return value.toFixed(1);
}

function statusFor(fit: number | null, available: boolean, phase: Phase | null): string {
  if (!available) return 'Not available';
  if (phase == null || fit == null) return 'Not scored';
  if (fit >= 0.75) return 'Consistent with this phase';
  if (fit >= 0.4) return 'Mixed for this phase';
  return 'Diverges from this phase';
}

export function isStale(
  indicator: IndicatorType,
  periodEndDate: string,
  now: Date,
  frequency?: Frequency,
): boolean {
  const allowance =
    frequency === 'monthly' ? 75 : frequency === 'quarterly' ? 200 : frequency === 'annual' ? 400 : INDICATOR_CATALOG[indicator].staleAfterDays;
  return daysAfter(periodEndDate, now) > allowance;
}

export type CycleResponse = {
  country: string;
  countryName: string;
  countries: Array<{ code: string; name: string }>;
  modelVersion: number;
  disclaimer: string;
  provider: { id: string; label: string; kind: ProviderKind };
  lastUpdated: string | null;
  asOfPeriod: string | null;
  asOfLabel: string | null;
  vintageNote: string;
  refreshError: string | null;
  coverageNote: string | null;
  phase: null | {
    id: Phase;
    label: string;
    confidence: number;
    score: number;
    previousPhase: Phase | null;
    previousPhaseLabel: string | null;
    momentum: MomentumName;
    momentumLabel: string;
    explanation: string;
  };
  cycle: Array<{ id: Phase; label: string; active: boolean }>;
  indicators: IndicatorCard[];
  timeline: Array<{
    period: string;
    label: string;
    phase: Phase;
    phaseLabel: string;
    score: number;
    confidence: number;
    momentum: MomentumName;
  }>;
  assetClasses: Array<{ id: string; label: string; tendency: string; explanation: string }>;
  assetNote: string | null;
};

export type IndicatorCard = {
  type: IndicatorType;
  label: string;
  description: string;
  available: boolean;
  value: number | null;
  valueLabel: string | null;
  previousValue: number | null;
  previousLabel: string | null;
  unit: string | null;
  direction: DirectionName;
  directionLabel: string;
  status: string;
  level: string | null;
  change: string | null;
  score: number | null;
  contribution: number | null;
  period: string | null;
  periodLabel: string | null;
  source: string | null;
  sourceUrl: string | null;
  publishedAt: string | null;
  publishedAtPrecision: 'release' | 'period_end' | null;
  publishedLabel: string | null;
  retrievedAt: string | null;
  stale: boolean;
  notes: string | null;
  history: Array<{ period: string; value: number }>;
};

function explain(assessment: CycleAssessment, available: number): string {
  if (!assessment.phase) {
    return 'Not enough indicator data to classify a phase.';
  }
  const names = assessment.indicators
    .filter((row) => row.fit >= 0.5)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .map((row) => INDICATOR_CATALOG[row.indicator].label);
  const who = names.length > 0 ? names.join(', ') : 'the available indicators';
  return `${PHASE_LABEL[assessment.phase]} is the closest match among the five phases. The strongest support from the indicators on hand comes from ${who}. Confidence measures how strongly those available indicators agree with this phase. It is not a forecast. ${available} of ${INDICATOR_TYPES.length} indicator types had a value for this quarter.`;
}

export function buildCycleView(args: {
  observations: EconomicObservation[];
  country?: string;
  provider: { id: string; label: string; kind: ProviderKind };
  warnings: string[];
  refreshError: string | null;
  now: Date;
}): CycleResponse {
  const profile = economyCountry(args.country) ?? economyCountry('NZ');
  const analysis = analyseObservations(args.observations, args.now);
  const current = analysis.current;
  const phase = current?.phase ?? null;
  const scoreRows = new Map((current?.indicators ?? []).map((row) => [row.indicator, row]));
  const availableCount = INDICATOR_TYPES.filter((indicator) => analysis.used.get(indicator)).length;

  const indicators: IndicatorCard[] = INDICATOR_TYPES.map((indicator) => {
    const meta = INDICATOR_CATALOG[indicator];
    const row = analysis.used.get(indicator) ?? null;
    const scored = scoreRows.get(indicator) ?? null;
    const asOfEnd = periodEnd(analysis.asOfPeriod) ?? '9999-12-31';
    const history = (analysis.byType.get(indicator) ?? [])
      .filter((point) => point.periodEnd <= asOfEnd)
      .sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1))
      .slice(-16)
      .map((point) => ({ period: point.period, value: point.value }));
    const stale = row ? isStale(indicator, row.periodEnd, args.now, row.frequency) : false;
    return {
      type: indicator,
      label: meta.label,
      description: profile?.descriptions[indicator] ?? meta.description,
      available: row != null,
      value: row?.value ?? null,
      valueLabel: row ? formatIndicatorNumber(row.value, row.unit) : null,
      previousValue: row?.previousValue ?? null,
      previousLabel:
        row?.previousValue != null ? formatIndicatorNumber(row.previousValue, row.unit) : null,
      unit: row?.unit ?? null,
      direction: scored?.direction ?? 'unknown',
      directionLabel: DIRECTION_LABEL[scored?.direction ?? 'unknown'],
      status: statusFor(scored?.fit ?? null, row != null, phase),
      level: scored?.level ?? null,
      change: scored?.change ?? null,
      score: row ? (scored?.score ?? null) : null,
      contribution: row ? (scored?.contribution ?? null) : null,
      period: row?.period ?? null,
      periodLabel: row ? formatPeriod(row.period) : null,
      source: row?.source ?? null,
      sourceUrl: row?.sourceUrl ?? null,
      publishedAt: row?.publishedAt ?? null,
      publishedAtPrecision: row?.publishedAtPrecision ?? null,
      publishedLabel: publishedLabel(row),
      retrievedAt: row?.retrievedAt ?? null,
      stale,
      notes: row?.notes ?? null,
      history,
    };
  });

  const retrieved = args.observations.map((row) => row.retrievedAt).sort();
  const lastUpdated = retrieved.at(-1) ?? null;
  const missing = indicators.filter((card) => !card.available).map((card) => card.label);
  const coverageBits = [
    ...args.warnings,
    missing.length > 0 ? `No value for this quarter: ${missing.join(', ')}.` : '',
  ].filter(Boolean);

  return {
    country: profile?.code ?? 'NZ',
    countryName: profile?.name ?? 'New Zealand',
    countries: listEconomyCountries(),
    modelVersion: PHASE_MODEL_VERSION,
    disclaimer: DISCLAIMER,
    provider: args.provider,
    lastUpdated,
    asOfPeriod: current ? analysis.asOfPeriod : null,
    asOfLabel: current ? formatPeriod(analysis.asOfPeriod) : null,
    vintageNote: VINTAGE_NOTE,
    refreshError: args.refreshError,
    coverageNote: coverageBits.length > 0 ? coverageBits.join(' ') : null,
    phase: current?.phase
      ? {
          id: current.phase,
          label: PHASE_LABEL[current.phase],
          confidence: current.confidence,
          score: current.score,
          previousPhase: current.previousPhase,
          previousPhaseLabel: current.previousPhase ? PHASE_LABEL[current.previousPhase] : null,
          momentum: current.momentum,
          momentumLabel: MOMENTUM_LABEL[current.momentum],
          explanation: explain(current, availableCount),
        }
      : null,
    cycle: PHASE_CYCLE_ORDER.map((id) => ({
      id,
      label: PHASE_LABEL[id],
      active: id === phase,
    })),
    indicators,
    timeline: analysis.timeline
      .filter((point): point is typeof point & { phase: Phase } => point.phase != null)
      .map((point) => ({
        period: point.period,
        label: formatPeriod(point.period),
        phase: point.phase,
        phaseLabel: PHASE_LABEL[point.phase],
        score: point.score,
        confidence: point.confidence,
        momentum: point.momentum,
      })),
    assetClasses: phase ? assetClassContext(phase) : [],
    assetNote: phase
      ? 'Historical tendencies for this phase. They describe past patterns and are not instructions.'
      : 'Asset-class context appears once a phase can be calculated.',
  };
}

function publishedLabel(row: EconomicObservation | null): string | null {
  if (!row) return null;
  if (row.publishedAtPrecision === 'release') return `Published ${row.publishedAt}`;
  return `Publication time is not in the source extract. Period ends ${row.periodEnd}.`;
}
