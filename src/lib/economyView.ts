/**
 * Presentation helpers for the Economic Cycle page. No scoring happens here:
 * every number comes from the API payload. Kept free of React so it can be tested.
 */
import type {
  EconomicIndicatorCard,
  EconomicPhase,
  EconomicSignalStatus,
  PhaseNewsGroup,
  PhaseNewsItem,
} from '../types/economy';

export const PHASE_ORDER: EconomicPhase[] = ['recovery', 'expansion', 'late_expansion', 'slowdown', 'recession'];

export const STATUS_META: Record<EconomicSignalStatus, { label: string; icon: string; tone: string }> = {
  supports: { label: 'Supports phase', icon: '✓', tone: 'supports' },
  mixed: { label: 'Mixed signal', icon: '±', tone: 'mixed' },
  conflicts: { label: 'Conflicts with phase', icon: '✕', tone: 'conflicts' },
  insufficient: { label: 'Insufficient data', icon: '–', tone: 'insufficient' },
  unscored: { label: 'Not scored', icon: '–', tone: 'insufficient' },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-Q2 → "Jun 2026 qtr", 2026-08 → "Aug 2026". */
export function shortPeriod(period: string | null | undefined): string {
  if (!period) return '—';
  const q = period.match(/^(\d{4})-Q([1-4])$/);
  if (q) return `${MONTHS[Number(q[2]) * 3 - 1]} ${q[1]} qtr`;
  const m = period.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return period;
}

export function formatReading(value: number | null | undefined, unit: string | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (unit === 'percentage points') return `${value.toFixed(2)} pp`;
  if (unit === 'percent') return `${value.toFixed(1)}%`;
  return value.toFixed(1);
}

/** Move from the previous reading. Percent series move in points, not percent. */
export function formatChange(card: Pick<EconomicIndicatorCard, 'value' | 'previousValue' | 'unit'>): {
  text: string;
  direction: 'up' | 'down' | 'flat' | 'unknown';
  arrow: string;
} {
  if (card.value == null || card.previousValue == null) return { text: 'No earlier reading', direction: 'unknown', arrow: '' };
  const delta = card.value - card.previousValue;
  const places = card.unit === 'percentage points' ? 2 : 1;
  const rounded = Number(delta.toFixed(places));
  const suffix = card.unit === 'percent' ? ' pts' : card.unit === 'percentage points' ? ' pp' : '';
  if (rounded === 0) return { text: 'No change', direction: 'flat', arrow: '→' };
  const sign = rounded > 0 ? '+' : '−';
  return {
    text: `${sign}${Math.abs(rounded).toFixed(places)}${suffix}`,
    direction: rounded > 0 ? 'up' : 'down',
    arrow: rounded > 0 ? '↑' : '↓',
  };
}

/** Group cards for "Why this phase?". Strongest contribution first in each group. */
export function groupBySignal(cards: EconomicIndicatorCard[]): Record<'supports' | 'mixed' | 'conflicts' | 'insufficient', EconomicIndicatorCard[]> {
  const out = { supports: [], mixed: [], conflicts: [], insufficient: [] } as Record<
    'supports' | 'mixed' | 'conflicts' | 'insufficient',
    EconomicIndicatorCard[]
  >;
  for (const card of cards) {
    const key = card.signal === 'unscored' ? 'insufficient' : card.signal;
    out[key].push(card);
  }
  for (const key of Object.keys(out) as Array<keyof typeof out>) {
    out[key].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || (b.contribution ?? 0) - (a.contribution ?? 0));
  }
  return out;
}

/** How a selected phase relates to the calculated one, in cycle order. */
export function phaseRelation(current: EconomicPhase | null, selected: EconomicPhase): string {
  if (!current) return 'No phase is calculated right now, so this is a general description only.';
  if (current === selected) return 'This is the phase the model calculates from the latest data.';
  const n = PHASE_ORDER.length;
  const from = PHASE_ORDER.indexOf(current);
  const to = PHASE_ORDER.indexOf(selected);
  const ahead = (to - from + n) % n;
  if (ahead === 1) return 'Usually follows the current phase. Shown for exploration — it is not occurring now.';
  if (ahead === n - 1) return 'Usually comes before the current phase. Shown for exploration — it is not occurring now.';
  return 'Not adjacent to the current phase in the usual order. Shown for exploration — it is not occurring now.';
}

/** A meter value clamped to 0–100. */
export function pct(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Position of an overall score (−100…+100) on a 0–100 track. */
export function scorePosition(score: number): number {
  return pct((score + 100) / 2);
}

// ---------------------------------------------------------------------------
// News

export type NewsTopic = { id: string; label: string };

const TOPIC_LABEL: Record<string, string> = {
  phase: 'Cycle',
  rates: 'Interest rates',
  inflation: 'Inflation',
  housing: 'Property',
  unemployment: 'Employment',
  gdp: 'GDP',
  markets: 'Markets',
  global: 'Global',
  world: 'World',
  politics: 'Politics',
};

const TOPIC_ORDER = ['rates', 'inflation', 'housing', 'unemployment', 'gdp', 'markets', 'phase', 'global', 'world', 'politics'];

/** Feed id → the indicator card that measures the same thing. */
export const TOPIC_INDICATOR: Record<string, string> = {
  rates: 'interest_rates',
  inflation: 'inflation_cpi',
  housing: 'housing_activity',
  unemployment: 'unemployment',
  gdp: 'gdp_growth',
  markets: 'share_market',
};

/**
 * Words an article must use before its topic's reading is shown beside it.
 * The topic only says which search returned the article, not what it is about.
 */
const TOPIC_TERMS: Record<string, RegExp> = {
  rates: /\b(ocr|official cash rate|interest rates?|rate (cut|hike|rise|decision)s?|mortgage rates?|reserve bank|rbnz|monetary policy)\b/,
  inflation: /\b(inflation|cpi|consumer prices?|cost of living|price (rises?|increases?))\b/,
  housing: /\b(house|housing|home|property|dwelling|building consents?|construction|real estate|rent)s?\b/,
  unemployment: /\b(unemployment|unemployed|jobless|jobs?|employment|labou?r market|wages?|layoffs?|redundanc(y|ies))\b/,
  gdp: /\b(gdp|gross domestic product|economic growth|economy (grew|shrank|contracted|expanded)|recession)\b/,
  markets: /\b(nzx|sharemarket|share market|stock market|stocks?|shares|equities|investors?)\b/,
};

/** Broad feeds kept for context; listed after economy topics under "All". */
const BROAD_TOPICS = new Set(['world', 'politics']);

export type FlatNewsItem = PhaseNewsItem & { topicLabel: string };

/** One list, economy topics before broad world/politics feeds, newest first, each article once (first topic wins). */
export function flattenNews(groups: PhaseNewsGroup[]): FlatNewsItem[] {
  const seen = new Set<string>();
  const out: FlatNewsItem[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      const key = item.url || `${item.headline}|${item.publication}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const topicId = item.topicId ?? group.id;
      out.push({ ...item, topicId, topicLabel: TOPIC_LABEL[topicId] ?? group.title });
    }
  }
  return out.sort((a, b) => {
    const broad = Number(BROAD_TOPICS.has(a.topicId)) - Number(BROAD_TOPICS.has(b.topicId));
    if (broad !== 0) return broad;
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : Number.NaN;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : Number.NaN;
    if (Number.isFinite(ta) && Number.isFinite(tb)) return tb - ta;
    if (Number.isFinite(ta)) return -1;
    if (Number.isFinite(tb)) return 1;
    return 0;
  });
}

/** Topics that have at least one article, in a fixed order. */
export function newsTopics(items: FlatNewsItem[]): NewsTopic[] {
  const present = new Set(items.map((item) => item.topicId));
  const ordered = TOPIC_ORDER.filter((id) => present.has(id));
  const extra = [...present].filter((id) => !TOPIC_ORDER.includes(id)).sort();
  return [...ordered, ...extra].map((id) => ({ id, label: TOPIC_LABEL[id] ?? id }));
}

export function filterNews(items: FlatNewsItem[], topic: string): FlatNewsItem[] {
  return topic === 'all' ? items : items.filter((item) => item.topicId === topic);
}

function normaliseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/&nbsp;| /g, ' ')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The feed summary, only when it says more than the headline and publisher. */
export function usefulSummary(item: Pick<PhaseNewsItem, 'headline' | 'summary' | 'publication'>): string | null {
  if (!item.summary) return null;
  const summary = normaliseText(item.summary);
  const headline = normaliseText(item.headline);
  const publication = normaliseText(item.publication ?? '');
  if (!summary) return null;
  let rest = summary;
  if (headline) rest = rest.replace(headline, ' ');
  if (publication) rest = rest.replace(publication, ' ');
  rest = rest.replace(/\s+/g, ' ').trim();
  if (rest.split(' ').filter(Boolean).length < 6) return null;
  if (headline.includes(summary)) return null;
  return item.summary.trim();
}

/**
 * Grounded "why it matters": the matching indicator's current reading, only when
 * the headline or summary itself mentions that topic. Null otherwise.
 */
export function relatedReading(
  item: Pick<FlatNewsItem, 'topicId' | 'headline' | 'summary'>,
  cards: EconomicIndicatorCard[],
): string | null {
  const type = TOPIC_INDICATOR[item.topicId];
  const terms = TOPIC_TERMS[item.topicId];
  if (!type || !terms) return null;
  if (!terms.test(normaliseText(`${item.headline} ${item.summary ?? ''}`))) return null;
  const card = cards.find((row) => row.type === type);
  if (!card || !card.available || card.valueLabel == null) return null;
  const change = formatChange(card);
  const move = change.direction === 'unknown' ? '' : change.direction === 'flat' ? ', unchanged' : ` (${change.text})`;
  return `${card.label}: ${card.valueLabel}${move}, ${shortPeriod(card.period)}. ${STATUS_META[card.signal].label}.`;
}

// ---------------------------------------------------------------------------
// Scenario

/** Overrides that differ from the real reading. Unchanged sliders are not sent. */
export function scenarioOverrides(
  inputs: Array<{ indicator: string; value: number | null }>,
  draft: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const input of inputs) {
    const next = draft[input.indicator];
    if (next == null || input.value == null) continue;
    if (Math.abs(next - input.value) < 1e-9) continue;
    out[input.indicator] = Number(next.toFixed(4));
  }
  return out;
}

export function overridesKey(overrides: Record<string, number>): string {
  return Object.keys(overrides)
    .sort()
    .map((key) => `${key}=${overrides[key]}`)
    .join('&');
}
