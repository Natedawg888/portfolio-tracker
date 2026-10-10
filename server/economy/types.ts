/**
 * Economic-cycle domain types. Shared by the scorer, providers, and API.
 * Macro data is country-level, not per-user portfolio data.
 */

export const INDICATOR_TYPES = [
  'gdp_growth',
  'inflation_cpi',
  'interest_rates',
  'unemployment',
  'employment_growth',
  'consumer_spending',
  'business_activity_pmi',
  'credit_conditions',
  'housing_activity',
  'share_market',
  'yield_curve',
] as const;

export type IndicatorType = (typeof INDICATOR_TYPES)[number];

export const PHASES = [
  'recovery',
  'expansion',
  'late_expansion',
  'slowdown',
  'recession',
] as const;

export type Phase = (typeof PHASES)[number];

export type LevelName = 'low' | 'moderate' | 'high';
export type ChangeName = 'falling' | 'stable' | 'rising';
export type DirectionName = 'up' | 'down' | 'flat' | 'unknown';
export type MomentumName = 'strengthening' | 'weakening' | 'steady';
export type Frequency = 'monthly' | 'quarterly' | 'annual';
export type ProviderKind = 'live' | 'sample';
export type PublishedAtPrecision = 'release' | 'period_end';

export type IndicatorInput = {
  indicator: IndicatorType;
  value: number;
  previousValue: number | null;
};

export type ClassifiedSignal = IndicatorInput & {
  level: LevelName;
  change: ChangeName | 'unknown';
  direction: DirectionName;
};

export type PhaseScoreDetail = {
  raw: number;
  normalized: number;
  weightUsed: number;
};

export type IndicatorScoreDetail = {
  indicator: IndicatorType;
  /** Fit to the winning phase, 0–100. Zero when that phase has no rule for it. */
  score: number;
  direction: DirectionName;
  /** Weight × fit for the winning phase. */
  contribution: number;
  level: LevelName;
  change: ChangeName | 'unknown';
  /** 0–1 fit before scaling to the indicator score. */
  fit: number;
};

export type ConfidenceDetail = {
  /** Winning phase fit, 0–1. */
  support: number;
  /** Lead over the runner-up as a share of the winner's fit, 0–1. */
  margin: number;
  /** Indicators present ÷ catalogue size, 0–1. */
  coverage: number;
  /** Weights applied to support, margin, and coverage. */
  weights: { support: number; margin: number; coverage: number };
  /** Ceiling applied for thin coverage, or null when none applied. */
  cap: number | null;
};

export type CycleAssessment = {
  phase: Phase | null;
  /** Blend of phase anchors, about -100 to +100. Not a forecast. */
  score: number;
  /** 0–100 support from the indicators that were present. Not a probability. */
  confidence: number;
  /** The parts confidence was built from. Reported, not recalculated elsewhere. */
  confidenceDetail: ConfidenceDetail;
  momentum: MomentumName;
  previousPhase: Phase | null;
  phaseScores: Record<Phase, PhaseScoreDetail>;
  indicators: IndicatorScoreDetail[];
  /** How many catalogue indicators were supplied. */
  availableCount: number;
};

export type EconomicObservation = {
  country: string;
  indicatorType: IndicatorType;
  value: number;
  unit: string;
  /** Canonical period: YYYY-Qn, YYYY-MM, or YYYY. */
  period: string;
  periodStart: string;
  periodEnd: string;
  previousValue: number | null;
  previousPeriod: string | null;
  source: string;
  sourceUrl: string | null;
  publishedAt: string;
  publishedAtPrecision: PublishedAtPrecision;
  retrievedAt: string;
  providerId: string;
  providerKind: ProviderKind;
  frequency: Frequency;
  seriesId: string | null;
  notes: string | null;
};
