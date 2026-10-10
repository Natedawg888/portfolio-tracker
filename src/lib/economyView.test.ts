/**
 * Economic Cycle page helpers. Run: npm run test:economy-page
 */
import {
  PHASE_ORDER,
  filterNews,
  flattenNews,
  formatChange,
  groupBySignal,
  newsTopics,
  overridesKey,
  phaseRelation,
  relatedReading,
  scenarioOverrides,
  scorePosition,
  shortPeriod,
  usefulSummary,
} from './economyView.ts';
import type { EconomicIndicatorCard, PhaseNewsGroup } from '../types/economy.ts';

const assert = {
  ok(cond: unknown, msg = 'expected truthy'): void {
    if (!cond) throw new Error(`FAIL: ${msg}`);
  },
  equal(actual: unknown, expected: unknown, msg = ''): void {
    if (actual !== expected) throw new Error(`FAIL: ${msg} expected ${String(expected)}, got ${String(actual)}`);
  },
  deepEqual(actual: unknown, expected: unknown, msg = ''): void {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error(`FAIL: ${msg} expected ${b}, got ${a}`);
  },
  match(actual: string, pattern: RegExp, msg = ''): void {
    if (!pattern.test(actual)) throw new Error(`FAIL: ${msg} ${JSON.stringify(actual)} does not match ${pattern}`);
  },
};

function card(partial: Partial<EconomicIndicatorCard>): EconomicIndicatorCard {
  return {
    type: 'gdp_growth',
    label: 'GDP growth',
    description: '',
    available: true,
    value: 0.2,
    valueLabel: '0.2%',
    previousValue: 0.5,
    previousLabel: '0.5%',
    unit: 'percent',
    direction: 'down',
    directionLabel: 'Down',
    status: 'Consistent with this phase',
    signal: 'supports',
    summary: null,
    expects: null,
    weight: 1,
    thresholds: { lowBelow: 0, highAbove: 0.5, flatBand: 0.1 },
    derived: false,
    frequency: 'quarterly',
    periodEnd: '2026-06-30',
    previousPeriod: '2026-Q1',
    previousPeriodLabel: null,
    level: 'moderate',
    change: 'falling',
    score: 100,
    contribution: 1,
    period: '2026-Q2',
    periodLabel: null,
    source: 'Stats NZ',
    sourceUrl: null,
    publishedAt: null,
    publishedAtPrecision: null,
    publishedLabel: null,
    retrievedAt: null,
    stale: false,
    notes: null,
    history: [],
    ...partial,
  };
}

assert.equal(shortPeriod('2026-Q2'), 'Jun 2026 qtr');
assert.equal(shortPeriod('2026-08'), 'Aug 2026');
assert.equal(shortPeriod(null), '—');
assert.deepEqual(formatChange(card({})), { text: '−0.3 pts', direction: 'down', arrow: '↓' });
assert.equal(formatChange(card({ unit: 'percentage points', value: 0.4, previousValue: 0.15 })).text, '+0.25 pp');
assert.equal(formatChange(card({ previousValue: 0.2 })).direction, 'flat');
assert.equal(formatChange(card({ previousValue: null })).direction, 'unknown');
assert.equal(scorePosition(-100), 0);
assert.equal(scorePosition(0), 50);
assert.equal(scorePosition(100), 100);
console.log('OK: periods, changes, score track');

const groups = groupBySignal([
  card({ type: 'a', signal: 'supports', weight: 1 }),
  card({ type: 'b', signal: 'supports', weight: 1.8 }),
  card({ type: 'c', signal: 'conflicts' }),
  card({ type: 'd', signal: 'insufficient', available: false }),
  card({ type: 'e', signal: 'unscored' }),
  card({ type: 'f', signal: 'mixed' }),
]);
assert.deepEqual(groups.supports.map((row) => row.type), ['b', 'a'], 'heaviest rule first');
assert.equal(groups.conflicts.length, 1);
assert.equal(groups.mixed.length, 1);
assert.equal(groups.insufficient.length, 2, 'unscored folds into insufficient');
console.log('OK: why-this-phase grouping');

// Exploring a phase never claims it is occurring.
for (const selected of PHASE_ORDER) {
  const text = phaseRelation('slowdown', selected);
  if (selected === 'slowdown') assert.match(text, /calculates from the latest data/);
  else assert.match(text, /not occurring now/);
}
assert.match(phaseRelation('slowdown', 'recession'), /Usually follows/);
assert.match(phaseRelation('recovery', 'recession'), /Usually comes before/, 'recession wraps round to recovery');
assert.match(phaseRelation(null, 'expansion'), /general description/);
console.log('OK: phase exploration wording');

const news: PhaseNewsGroup[] = [
  {
    id: 'rates',
    title: 'Central-bank rates',
    sourceName: 'Google News',
    status: 'ok',
    message: null,
    items: [
      { headline: 'RBNZ cuts OCR', publication: 'RNZ', publishedAt: '2026-10-08T00:00:00Z', summary: 'RBNZ cuts OCR RNZ', url: 'https://a', sourceName: 'Google News', topic: 'Central-bank rates', topicId: 'rates' },
      { headline: 'Older story', publication: 'Stuff', publishedAt: '2026-09-01T00:00:00Z', summary: null, url: 'https://b', sourceName: 'Google News', topic: 'Central-bank rates', topicId: 'rates' },
    ],
  },
  {
    id: 'inflation',
    title: 'Inflation',
    sourceName: 'Google News',
    status: 'ok',
    message: null,
    items: [
      { headline: 'RBNZ cuts OCR', publication: 'RNZ', publishedAt: '2026-10-08T00:00:00Z', summary: null, url: 'https://a', sourceName: 'Google News', topic: 'Inflation', topicId: 'inflation' },
      { headline: 'Prices rise', publication: 'NZ Herald', publishedAt: '2026-10-09T00:00:00Z', summary: 'Food prices rose 4 percent in the year to September, led by fruit and vegetables.', url: 'https://c', sourceName: 'Google News', topic: 'Inflation', topicId: 'inflation' },
    ],
  },
  { id: 'gdp', title: 'GDP', sourceName: 'Google News', status: 'error', message: 'Google News: timeout', items: [] },
];
const flat = flattenNews(news);
assert.deepEqual(flat.map((item) => item.url), ['https://c', 'https://a', 'https://b'], 'deduplicated, newest first');
assert.deepEqual(newsTopics(flat).map((topic) => topic.label), ['Interest rates', 'Inflation'], 'only topics with articles');
assert.equal(filterNews(flat, 'inflation').length, 1);
assert.equal(filterNews(flat, 'all').length, 3);
assert.ok(flat.every((item) => item.url.startsWith('https://')), 'links are the feed links');
assert.equal(usefulSummary(flat[1]!), null, 'summary that repeats the headline is hidden');
assert.match(usefulSummary(flat[0]!) ?? '', /Food prices/);
console.log('OK: news flatten, topics, filter, summary');

const cards = [card({ type: 'inflation_cpi', label: 'Inflation (CPI)', valueLabel: '3.1%', value: 3.1, previousValue: 2.9 })];
const article = (topicId: string, headline: string, summary: string | null = null) => ({ topicId, headline, summary });
assert.equal(
  relatedReading(article('inflation', 'Annual inflation rises to 3.1%'), cards),
  'Inflation (CPI): 3.1% (+0.2 pts), Jun 2026 qtr. Supports phase.',
);
assert.equal(
  relatedReading(article('inflation', 'Budget update', 'Treasury expects CPI to ease next year and more besides.'), cards),
  'Inflation (CPI): 3.1% (+0.2 pts), Jun 2026 qtr. Supports phase.',
  'a summary that names the topic counts',
);
assert.equal(
  relatedReading(article('inflation', 'NZ First vows to permanently raise Working for Families payments'), cards),
  null,
  'search topic alone is not grounds for a reading',
);
assert.equal(relatedReading(article('politics', 'Inflation debate in parliament'), cards), null, 'no indicator for politics');
assert.equal(relatedReading(article('gdp', 'GDP grows 0.5%'), cards), null, 'no card, no claim');

const ranked = flattenNews([
  { id: 'world', title: 'World', status: 'ok', items: [{ headline: 'World story', url: 'https://example.test/w', publication: 'BBC News', publishedAt: '2026-10-10T10:00:00Z', summary: null }] },
  { id: 'rates', title: 'Rates', status: 'ok', items: [{ headline: 'OCR held', url: 'https://example.test/r', publication: 'RNZ', publishedAt: '2026-10-09T10:00:00Z', summary: null }] },
] as never);
assert.deepEqual(ranked.map((item) => item.topicId), ['rates', 'world'], 'economy topics come before broad world news');
console.log('OK: related reading is grounded in a card');

const inputs = [
  { indicator: 'gdp_growth', value: 0.2 },
  { indicator: 'unemployment', value: null },
];
assert.deepEqual(scenarioOverrides(inputs, { gdp_growth: 0.2 }), {}, 'unchanged slider is not sent');
assert.deepEqual(scenarioOverrides(inputs, { gdp_growth: -1, unemployment: 6 }), { gdp_growth: -1 }, 'missing real value cannot be overridden');
assert.equal(overridesKey({ b: 1, a: 2 }), 'a=2&b=1');
console.log('OK: scenario overrides');
console.log('economy page helper tests passed');
