/** Dashboard payload from GET /api/economy/cycle. Scoring stays on the server. */

export type EconomicPhase = 'recovery' | 'expansion' | 'late_expansion' | 'slowdown' | 'recession';
export type EconomicMomentum = 'strengthening' | 'weakening' | 'steady';

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
  };
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
