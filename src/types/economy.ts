/** Dashboard payload from GET /api/economy/cycle. Scoring stays on the server. */

export type EconomicPhase = 'recovery' | 'expansion' | 'late_expansion' | 'slowdown' | 'recession';
export type EconomicMomentum = 'strengthening' | 'weakening' | 'steady';

export type EconomicSignalStatus = 'supports' | 'mixed' | 'conflicts' | 'insufficient' | 'unscored';

export type EconomicTakeaway = {
  id: 'growth' | 'prices' | 'jobs';
  title: string;
  headline: string;
  detail: string;
  trend: 'up' | 'down' | 'flat' | 'mixed' | 'unknown';
  indicators: string[];
};

export type EconomicConfidenceDetail = {
  support: number;
  margin: number;
  coverage: number;
  weights: { support: number; margin: number; coverage: number };
  cap: number | null;
};

export type EconomicPhaseGuide = {
  id: EconomicPhase;
  label: string;
  summary: string;
  currentFit: number;
  rules: Array<{ indicator: string; label: string; weight: number; expects: string; currentFit: number | null }>;
  quartersInPhase: number;
  totalQuarters: number;
  lastSeen: string | null;
  typical: Array<{ indicator: string; label: string; median: number; unitSuffix: string; quarters: number }>;
  assets: Array<{ id: string; label: string; tendency: string; explanation: string }>;
};

export type EconomicPhaseStat = {
  phase: EconomicPhase;
  label: string;
  quarters: number;
  median: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
  positiveShare: number | null;
  volatility: number | null;
};

export type EconomicAssetEvidence = {
  id: 'shares' | 'property' | 'bonds' | 'cash' | 'gold' | 'crypto';
  label: string;
  status: 'available' | 'unavailable';
  dataset: string | null;
  coverage: { from: string; to: string; quarters: number } | null;
  metrics: Array<{ id: string; label: string; unit: '%' | 'pp' | '% p.a.'; byPhase: EconomicPhaseStat[] }>;
  drawdowns: Array<{
    peakPeriod: string;
    troughPeriod: string;
    depth: number;
    recoveredPeriod: string | null;
    recoveryQuarters: number | null;
    peakPhase: EconomicPhase | null;
    troughPhase: EconomicPhase | null;
  }>;
  includes: string[];
  excludes: string[];
  caveats: string[];
  requires: string | null;
  relatedIndicators: string[];
};

export type EconomicFreshness = {
  newestPeriod: string | null;
  oldestPeriod: string | null;
  staleCount: number;
  missingCount: number;
  derivedCount: number;
  mixedPeriods: boolean;
};

export type EconomicScenarioSide = {
  phase: EconomicPhase | null;
  phaseLabel: string | null;
  confidence: number;
  score: number;
  phaseFits: Array<{ id: EconomicPhase; label: string; fit: number }>;
};

export type EconomicScenarioResult = {
  hypothetical: true;
  asOfPeriod: string | null;
  baseline: EconomicScenarioSide;
  scenario: EconomicScenarioSide;
  changed: Array<{
    indicator: string;
    label: string;
    actual: number;
    hypothetical: number;
    previous: number | null;
    level: string;
    change: string;
  }>;
  unavailable: Array<{ indicator: string; label: string }>;
  note: string;
};

export type EconomicIndicatorCard = {
  type: string;
  label: string;
  description: string;
  available: boolean;
  value: number | null;
  valueLabel: string | null;
  previousValue: number | null;
  previousLabel: string | null;
  unit: string | null;
  direction: 'up' | 'down' | 'flat' | 'unknown';
  directionLabel: string;
  status: string;
  signal: EconomicSignalStatus;
  summary: string | null;
  expects: string | null;
  weight: number | null;
  thresholds: { lowBelow: number; highAbove: number; flatBand: number };
  derived: boolean;
  frequency: 'monthly' | 'quarterly' | 'annual' | null;
  periodEnd: string | null;
  previousPeriod: string | null;
  previousPeriodLabel: string | null;
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

export type EconomicCycleResponse = {
  country: string;
  countryName: string;
  countries: Array<{ code: string; name: string }>;
  modelVersion: number;
  disclaimer: string;
  provider: { id: string; label: string; kind: 'live' | 'sample' };
  lastUpdated: string | null;
  asOfPeriod: string | null;
  asOfLabel: string | null;
  vintageNote: string;
  refreshError: string | null;
  coverageNote: string | null;
  phase: null | {
    id: EconomicPhase;
    label: string;
    confidence: number;
    score: number;
    previousPhase: EconomicPhase | null;
    previousPhaseLabel: string | null;
    momentum: EconomicMomentum;
    momentumLabel: string;
    explanation: string;
    confidenceDetail: EconomicConfidenceDetail;
    availableCount: number;
    catalogueCount: number;
  };
  phaseFits: Array<{ id: EconomicPhase; label: string; fit: number; weightUsed: number }>;
  takeaways: EconomicTakeaway[];
  phaseGuide: EconomicPhaseGuide[];
  assetEvidence: EconomicAssetEvidence[];
  freshness: EconomicFreshness;
  scenarioInputs: Array<{ indicator: string; label: string; min: number; max: number; step: number; value: number | null }>;
  cycle: Array<{ id: EconomicPhase; label: string; active: boolean }>;
  indicators: EconomicIndicatorCard[];
  timeline: Array<{
    period: string;
    label: string;
    phase: EconomicPhase;
    phaseLabel: string;
    score: number;
    confidence: number;
    momentum: EconomicMomentum;
  }>;
  assetClasses: Array<{ id: string; label: string; tendency: string; explanation: string }>;
  assetNote: string | null;
};

export type PhaseNewsItem = {
  headline: string;
  publication: string;
  publishedAt: string | null;
  summary: string | null;
  url: string;
  sourceName: string;
  topic: string;
  topicId: string;
};

export type PhaseNewsGroup = {
  id: string;
  title: string;
  sourceName: string;
  status: 'ok' | 'empty' | 'error';
  message: string | null;
  items: PhaseNewsItem[];
};

export type PhaseNewsResponse = {
  country: string;
  countryName: string;
  phase: EconomicPhase | null;
  phaseLabel: string | null;
  note: string;
  fetchedAt: string;
  groups: PhaseNewsGroup[];
};
