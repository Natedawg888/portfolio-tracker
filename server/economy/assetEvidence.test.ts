/**
 * Asset evidence uses stored series only and withholds thin samples.
 * Run: npm run test:economy
 */
import assert from 'node:assert/strict';
import { MIN_QUARTERS, buildAssetEvidence, drawdownsFrom, quarterlyShareChanges } from './assetEvidence.ts';
import type { TimelinePoint } from './scoring.ts';
import type { EconomicObservation, IndicatorType, Phase } from './types.ts';

function monthly(indicator: IndicatorType, period: string, value: number): EconomicObservation {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return {
    country: 'NZ',
    indicatorType: indicator,
    value,
    unit: 'percent',
    period,
    periodStart: `${period}-01`,
    periodEnd: `${period}-${String(last).padStart(2, '0')}`,
    previousValue: null,
    previousPeriod: null,
    source: 'Test share index',
    sourceUrl: null,
    publishedAt: `${period}-28`,
    publishedAtPrecision: 'period_end',
    retrievedAt: '2026-01-01T00:00:00.000Z',
    providerId: 'test',
    providerKind: 'live',
    frequency: 'monthly',
    seriesId: null,
    notes: null,
  };
}

function point(period: string, phase: Phase): TimelinePoint {
  return { period, phase } as TimelinePoint;
}

// Only quarter-end months count, so overlapping three-month changes are not double counted.
const changes = quarterlyShareChanges([
  monthly('share_market', '2020-01', 9),
  monthly('share_market', '2020-03', -10),
  monthly('share_market', '2020-06', 5),
]);
assert.deepEqual([...changes.entries()], [['2020-Q1', -10], ['2020-Q2', 5]]);
console.log('OK: quarter-end months only');

// −20% then +25% regains the peak exactly.
const dd = drawdownsFrom(
  [
    { period: '2020-Q1', change: -20 },
    { period: '2020-Q2', change: 10 },
    { period: '2020-Q3', change: 13.7 },
  ],
  () => 'recession',
);
assert.equal(dd.length, 1);
assert.equal(dd[0]!.peakPeriod, '2019-Q4');
assert.equal(dd[0]!.troughPeriod, '2020-Q1');
assert.equal(dd[0]!.depth, -20);
assert.equal(dd[0]!.recoveredPeriod, '2020-Q3');
assert.equal(dd[0]!.recoveryQuarters, 2);
console.log('OK: drawdown depth and recovery quarters');

const open = drawdownsFrom([{ period: '2021-Q1', change: -15 }], () => null);
assert.equal(open[0]!.recoveredPeriod, null, 'an unrecovered fall says so');
const small = drawdownsFrom([{ period: '2021-Q1', change: -5 }], () => null);
assert.equal(small.length, 0, 'falls under 10% are not listed');
const gap = drawdownsFrom(
  [
    { period: '2021-Q1', change: 2 },
    { period: '2021-Q3', change: -40 },
  ],
  () => null,
);
assert.equal(gap.length, 0, 'chaining stops at a missing quarter instead of bridging it');
console.log('OK: unrecovered, small, and gapped drawdowns');

// Following-quarter statistics and the minimum sample.
const quarters = ['2019-Q1', '2019-Q2', '2019-Q3', '2019-Q4', '2020-Q1'];
const shareRows = [
  monthly('share_market', '2019-06', 1),
  monthly('share_market', '2019-09', 2),
  monthly('share_market', '2019-12', 3),
  monthly('share_market', '2020-03', 4),
  monthly('share_market', '2020-06', 5),
];
const rateRows = quarters.map((q, i) => monthly('interest_rates', `${q.slice(0, 4)}-${String(Number(q.slice(-1)) * 3).padStart(2, '0')}`, 2 + i));
const evidence = buildAssetEvidence(
  {
    timeline: quarters.map((q) => point(q, 'expansion')),
    byType: new Map<IndicatorType, EconomicObservation[]>([
      ['share_market', shareRows],
      ['interest_rates', rateRows],
    ]),
  },
  'New Zealand',
);
const shares = evidence.find((row) => row.id === 'shares')!;
const expansion = shares.metrics[0]!.byPhase.find((row) => row.phase === 'expansion')!;
assert.equal(expansion.quarters, 5, 'each expansion quarter pairs with the next quarter');
assert.equal(expansion.median, 3);
assert.equal(expansion.positiveShare, 100);
const recession = shares.metrics[0]!.byPhase.find((row) => row.phase === 'recession')!;
assert.equal(recession.quarters, 0);
assert.equal(recession.median, null, 'no quarters, no figure');
assert.ok(shares.excludes.includes('Dividends'), 'dividends are listed as excluded');
const cash = evidence.find((row) => row.id === 'cash')!;
assert.equal(cash.metrics[0]!.byPhase.find((row) => row.phase === 'expansion')!.median, 4);
assert.equal(cash.metrics[1]!.byPhase.find((row) => row.phase === 'expansion')!.quarters, 0, 'no CPI, no real rate');
console.log('OK: following-quarter shares and cash medians');

const thin = buildAssetEvidence(
  {
    timeline: quarters.slice(0, MIN_QUARTERS - 2).map((q) => point(q, 'slowdown')),
    byType: new Map<IndicatorType, EconomicObservation[]>([['share_market', shareRows]]),
  },
  'New Zealand',
);
const slowdown = thin.find((row) => row.id === 'shares')!.metrics[0]!.byPhase.find((row) => row.phase === 'slowdown')!;
assert.ok(slowdown.quarters > 0 && slowdown.quarters < MIN_QUARTERS);
assert.equal(slowdown.median, null, 'thin samples are withheld');
console.log('OK: thin samples withheld');

for (const id of ['property', 'bonds', 'gold', 'crypto']) {
  const row = evidence.find((item) => item.id === id)!;
  assert.equal(row.status, 'unavailable');
  assert.equal(row.metrics.length, 0, `${id} has no invented figures`);
  assert.ok(row.requires && row.requires.length > 20, `${id} explains the data it needs`);
}
const text = JSON.stringify(evidence);
assert.ok(!/\b(buy|sell|you should|move your money)\b/i.test(text), 'no advice wording');
console.log('OK: unavailable classes and neutral wording');
console.log('asset evidence tests passed');
