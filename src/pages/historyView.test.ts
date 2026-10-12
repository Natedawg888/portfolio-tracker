/**
 * History header, year change, and closed-at-cost chart flags.
 * Run: npm run test:history
 */
import {
  closedAtCostMatches,
  costFlagChartNote,
  costFlagClause,
  costFlagIndex,
  historyPointAriaLabel,
  historySnapshotCaption,
  historyYearChange,
  isStoredNonPositive,
  snapshotPoint,
} from './historyView.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function eq<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message} (got ${String(actual)}, expected ${String(expected)})`);
}

assert(isStoredNonPositive(0), 'stored 0 is closed');
assert(isStoredNonPositive('0'), 'stored "0" is closed');
assert(isStoredNonPositive(-1), 'a negative stored quantity is closed');
assert(!isStoredNonPositive(null), 'a missing quantity is not closed');
assert(!isStoredNonPositive(undefined), 'an absent quantity is not closed');
assert(!isStoredNonPositive(''), 'a blank quantity is not closed');
assert(!isStoredNonPositive(0.64), 'a positive quantity is open');

eq(historySnapshotCaption(0), '0 snapshots · from real snapshots only', 'no snapshots yet');
eq(historySnapshotCaption(1), '1 snapshot · from real snapshots only', 'one snapshot');
eq(historySnapshotCaption(12), '12 snapshots · from real snapshots only', 'many snapshots');
eq(historySnapshotCaption(Number.NaN), '0 snapshots · from real snapshots only', 'a bad count is not a snapshot');

assert(historyYearChange([100]) === null, 'one snapshot has no change');
assert(historyYearChange([]) === null, 'no snapshots have no change');
const up = historyYearChange([100, 80, 140]);
eq(up?.amount, 40, 'change is last minus first');
eq(up?.direction, 'up', 'a higher last total is up');
const down = historyYearChange([200, 50]);
eq(down?.amount, -150, 'a lower last total keeps the signed amount');
eq(down?.direction, 'down', 'a lower last total is down');
eq(historyYearChange([10, 10])?.direction, 'flat', 'an equal pair is flat');
assert(historyYearChange([Number.NaN, 10]) === null, 'a non-finite first total has no change');

const tsla = { id: 'tsla', assetClass: 'stock', symbol: 'TSLA', shares: 0, costBasisNzd: 914.45 };
const example = { id: 'ex', assetClass: 'stock', symbol: 'EXAMPLE', shares: null, costBasisNzd: 5000 };
const qyld = { id: 'qyld', assetClass: 'stock', symbol: 'QYLD', shares: 0.64, costBasisNzd: 135.1 };
const xrp = { id: 'xrp', assetClass: 'crypto', name: 'XRP', amount: 0, costBasisNzd: 36.72 };
const eth = { id: 'eth', assetClass: 'crypto', name: 'ETH', amount: null, costBasisNzd: 40 };

const matches = closedAtCostMatches(
  [
    { id: 'tsla', label: 'TSLA', valueNzd: 914.45 },
    { id: 'qyld', label: 'QYLD', valueNzd: 20.56 },
    { id: 'ex', label: 'EXAMPLE', valueNzd: 5000 },
    { id: 'xrp', label: 'XRP', valueNzd: 36.72 },
    { id: 'eth', label: 'ETH', valueNzd: 40 },
    { id: 'gone', label: 'GONE', valueNzd: 10 },
  ],
  [tsla, example, qyld, xrp, eth],
);
eq(matches.map((m) => m.holdingId).join(','), 'tsla,xrp', '0-share and 0-amount rows valued at cost match');
eq(matches[0].valueNzd, 914.45, 'the match keeps the stored snapshot value');
eq(matches[0].costNzd, 914.45, 'the match records the live cost it was compared with');

assert(
  closedAtCostMatches([{ id: 'tsla', label: 'TSLA', valueNzd: 1.37 }], [tsla]).length === 0,
  'a residual value is not the cost',
);
assert(
  closedAtCostMatches([{ id: 'tsla', label: 'TSLA', valueNzd: 914.46 }], [tsla]).length === 1,
  'one cent of rounding still matches',
);
assert(
  closedAtCostMatches([{ id: 'tsla', label: 'TSLA', valueNzd: 914.47 }], [tsla]).length === 0,
  'two cents off is not the cost',
);
assert(
  closedAtCostMatches([{ id: 'ex', label: 'EXAMPLE', valueNzd: 5000 }], [example]).length === 0,
  'a null share count valued at cost is the cost-basis path, not this flag',
);
assert(
  closedAtCostMatches([{ id: 'qyld', label: 'QYLD', valueNzd: 135.1 }], [qyld]).length === 0,
  'an open holding is not flagged when its value happens to equal cost',
);

eq(
  costFlagClause(['TSLA']),
  'TSLA valued at cost. Stored value unchanged.',
  'one closed holding names itself',
);
assert(costFlagClause([]) === null, 'no match has no clause');
eq(
  costFlagChartNote(['TSLA', 'TSLA', 'XRP']),
  'TSLA, XRP valued at cost on a stored snapshot. Marked points keep that stored total.',
  'the chart note lists each name once',
);
assert(costFlagChartNote([]) === null, 'no names has no chart note');

const flags = costFlagIndex(
  [
    {
      takenAt: '2026-10-01T01:00:00.000Z',
      holdings: [{ id: 'tsla', label: 'TSLA', valueNzd: 914.45 }],
    },
    {
      takenAt: '2026-10-02T01:00:00.000Z',
      holdings: [{ id: 'tsla', label: 'TSLA', valueNzd: 1.37 }],
    },
  ],
  [tsla],
);
eq(flags.byTakenAt.size, 1, 'only the snapshot that stored the cost is flagged');
eq(
  flags.byTakenAt.get('2026-10-01T01:00:00.000Z'),
  'TSLA valued at cost. Stored value unchanged.',
  'the clause is keyed by the snapshot time',
);
assert(!flags.byTakenAt.has('2026-10-02T01:00:00.000Z'), 'the residual snapshot is not flagged');

const flagged = snapshotPoint('2026-10-01T01:00:00.000Z', 914.45, flags.byTakenAt.get('2026-10-01T01:00:00.000Z') ?? null);
eq(flagged.value, 914.45, 'flagging does not change the stored value');
eq(flagged.flagged, true, 'the cost snapshot point is marked');
eq(flagged.takenAt, '2026-10-01T01:00:00.000Z', 'the mark keeps the snapshot time');
const clean = snapshotPoint('2026-10-02T01:00:00.000Z', 1.37, null);
eq(clean.value, 1.37, 'a clean point keeps its value');
assert(clean.flagged === undefined, 'a clean point is not marked');

const aria = historyPointAriaLabel(
  '2026-10-12T01:00:00.000Z',
  1038.27,
  (n) => `$${n}`,
  'Stocks',
  'TSLA valued at cost. Stored value unchanged.',
  'day',
);
assert(aria?.startsWith('Stocks, ') === true, 'the point names its series');
assert(aria?.includes('$1038.27') === true, 'the point names the stored value');
assert(aria?.includes('12 Oct 2026') === true, 'a timestamp uses the Auckland date');
assert(aria?.includes('TSLA valued at cost. Stored value unchanged.') === true, 'the flag clause is appended');
assert(
  historyPointAriaLabel('not-a-date', 1, (n) => String(n), 'Stocks', null) === null,
  'an unreadable time has no label',
);
assert(
  historyPointAriaLabel('2026-10-12T01:00:00.000Z', Number.NaN, (n) => String(n), 'Stocks', null) === null,
  'a non-finite value has no label',
);
eq(
  historyPointAriaLabel('2026-10-12', 10, (n) => `$${n}`, 'Total net worth', null, 'day'),
  'Total net worth, 12 Oct 2026, $10',
  'a day bucket is the date, with no invented clock time',
);
eq(
  historyPointAriaLabel('2026-10-01', 10, (n) => `$${n}`, 'Total net worth', null, 'month'),
  'Total net worth, Oct 2026, $10',
  'a month bucket is the month, not a fake 1st-of-month snapshot',
);

console.log('history view tests passed');
