/**
 * KiwiSaver header, balance card, and holdings view rules.
 * Run: npm run test:kiwisaver
 */
import { formatAuckland } from '../api/client.ts';
import {
  KIWISAVER_READONLY_NOTE,
  kiwiSaverActiveRange,
  kiwiSaverAllocationLabel,
  kiwiSaverAllocationView,
  kiwiSaverChangeLine,
  kiwiSaverHeaderParts,
  kiwiSaverHeaderSubline,
  kiwiSaverHoldingCost,
  kiwiSaverHoldingFacts,
  kiwiSaverHoldingGaps,
  kiwiSaverHoldingReturnLabel,
  kiwiSaverHoldingReturnPct,
  kiwiSaverHoldingRows,
  kiwiSaverHoldingsEmpty,
  kiwiSaverHoldingsShowReturns,
  kiwiSaverPointAriaLabel,
  kiwiSaverSchemeLabel,
  kiwiSaverSignedMoney,
  kiwiSaverSplit,
  kiwiSaverSplitLabels,
  kiwiSaverSyncNote,
  kiwiSaverUnitsLabel,
  kiwiSaverVisibleRanges,
  showKiwiSaverSchemePicker,
  showKiwiSaverSyncButton,
  type KiwiSaverHeaderSource,
} from './kiwisaverView.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function source(partial: Partial<KiwiSaverHeaderSource>): KiwiSaverHeaderSource {
  return {
    name: null,
    schemeName: null,
    provider: null,
    observedAt: null,
    pir: null,
    ...partial,
  };
}

const formatTime = (iso: string) => `TIME(${iso})`;

assert(
  kiwiSaverSchemeLabel({ name: 'Sharesies KiwiSaver', schemeName: null }) === 'Sharesies KiwiSaver',
  'Akahu scheme_name null uses the account name',
);
assert(
  kiwiSaverSchemeLabel({ name: 'ANZ KiwiSaver', schemeName: 'Growth' }) === 'Growth',
  'a stored scheme name is the scheme slot',
);
assert(
  kiwiSaverSchemeLabel({ name: '  ', schemeName: '  ' }) === null,
  'blank scheme name and account name are omitted',
);

const akahu = source({
  name: 'Sharesies KiwiSaver',
  schemeName: null,
  provider: 'sharesies',
  observedAt: '2026-10-11T01:30:00.000Z',
  pir: 28,
});
assert(
  kiwiSaverHeaderSubline(akahu, formatTime) ===
    'Sharesies KiwiSaver · sharesies · synced TIME(2026-10-11T01:30:00.000Z) · PIR 28%',
  'full line is scheme, provider, synced time, PIR',
);
assert(
  kiwiSaverHeaderParts(akahu, formatTime).map((part) => part.kind).join(',') ===
    'scheme,provider,synced,pir',
  'synced sits before PIR so the tip can attach to the time',
);

assert(
  kiwiSaverHeaderSubline(
    source({ name: 'Sharesies KiwiSaver', provider: 'sharesies', pir: 28 }),
    formatTime,
  ) === 'Sharesies KiwiSaver · sharesies · PIR 28%',
  'a null sync time is omitted',
);
assert(
  kiwiSaverHeaderSubline(
    source({ name: 'Sharesies KiwiSaver', observedAt: '2026-10-11T01:30:00.000Z' }),
    formatTime,
  ) === 'Sharesies KiwiSaver · synced TIME(2026-10-11T01:30:00.000Z)',
  'a null provider and PIR are omitted',
);
assert(
  kiwiSaverHeaderSubline(source({ provider: 'ANZ' }), formatTime) === 'ANZ',
  'provider alone is kept when scheme and time and PIR are null',
);
assert(kiwiSaverHeaderSubline(source({}), formatTime) === '', 'an empty account adds no words');
assert(kiwiSaverHeaderSubline(null, formatTime) === '', 'no selected scheme adds no words');
assert(
  kiwiSaverHeaderSubline(source({ name: 'Cash', pir: 0 }), formatTime) === 'Cash · PIR 0%',
  'PIR 0 is a real rate',
);
assert(
  kiwiSaverHeaderSubline(source({ name: 'Cash', pir: Number.NaN }), formatTime) === 'Cash',
  'a non-finite PIR is omitted',
);
assert(
  kiwiSaverHeaderSubline(
    source({ name: 'Cash', observedAt: '2026-10-11T01:30:00.000Z' }),
    () => '—',
  ) === 'Cash',
  'a missing formatted time is omitted rather than "synced —"',
);

const iso = '2026-10-11T01:30:00.000Z';
const withAuckland = kiwiSaverHeaderSubline(
  source({ name: 'Sharesies KiwiSaver', provider: 'sharesies', observedAt: iso, pir: 17.5 }),
  formatAuckland,
);
assert(
  withAuckland === `Sharesies KiwiSaver · sharesies · synced ${formatAuckland(iso)} · PIR 17.5%`,
  'sync time is the Auckland format the page already uses',
);
assert(!withAuckland.includes('null'), 'null is never written into the line');

assert(
  KIWISAVER_READONLY_NOTE ===
    'KiwiSaver via Akahu; synced provider data is read-only. Never scrape. Never store passwords.',
  'the read-only note is the sentence moved into the tip',
);
assert(
  kiwiSaverSyncNote({ hasAkahuAccount: true, akahuConfigured: true }).includes('auto-resync on open'),
  'an Akahu scheme keeps the connected auto-resync sentence',
);
assert(
  kiwiSaverSyncNote({ hasAkahuAccount: false, akahuConfigured: true }).includes('Bank-held schemes stay manual'),
  'configured without a scheme keeps the Sharesies-only sentence',
);
assert(
  kiwiSaverSyncNote({ hasAkahuAccount: false, akahuConfigured: false }).includes('not configured'),
  'no Akahu server config keeps the manual/CSV sentence',
);
assert(
  kiwiSaverSyncNote({ hasAkahuAccount: false, akahuConfigured: null }) === 'Checking Akahu…',
  'unknown status is not reported as configured or not',
);

assert(
  showKiwiSaverSyncButton({ hasAkahuScheme: true, akahuConnected: false }) === true,
  'an Akahu scheme shows Sync now',
);
assert(
  showKiwiSaverSyncButton({ hasAkahuScheme: false, akahuConnected: true }) === true,
  'an Akahu connection shows Sync now before a scheme exists',
);
assert(
  showKiwiSaverSyncButton({ hasAkahuScheme: false, akahuConnected: false }) === false,
  'manual-only hides Sync now',
);

assert(showKiwiSaverSchemePicker(0) === false, 'no schemes means no picker');
assert(showKiwiSaverSchemePicker(1) === false, 'one scheme is shown directly');
assert(showKiwiSaverSchemePicker(2) === true, 'two schemes need a picker');

const money = (n: number) => `$${n.toFixed(2)}`;
const today = '2026-10-12';

assert(
  kiwiSaverChangeLine([{ date: '2026-10-12', value: 29628.83 }], 'All', today, money) === null,
  'one point in range has no change line',
);
assert(
  kiwiSaverChangeLine(
    [
      { date: '2026-09-01', value: 100 },
      { date: '2026-10-12', value: 140 },
    ],
    '1M',
    today,
    money,
  ) === null,
  'a range with a single point has no change line',
);
const ranged = kiwiSaverChangeLine(
  [
    { date: '2026-09-01', value: 100 },
    { date: '2026-10-01', value: 140 },
    { date: '2026-10-12', value: 150 },
  ],
  '1M',
  today,
  money,
);
assert(ranged != null, 'two or more points in range have a change line');
assert(ranged!.amount === 10, 'the change is the last point minus the first point in range');
assert(ranged!.since === '2026-10-01', 'the since-date is the first point in the range');
assert(ranged!.text === '▲ $10.00 since 1 Oct 2026', 'the line names the arrow, amount, and since-date');
const down = kiwiSaverChangeLine(
  [
    { date: '2026-10-01', value: 200 },
    { date: '2026-10-12', value: 150 },
  ],
  'All',
  today,
  money,
);
assert(down!.amount === -50, 'a fall is a negative delta');
assert(down!.arrow === '▼', 'a fall uses a down arrow, not colour alone');
assert(down!.text === '▼ $50.00 since 1 Oct 2026', 'the down line still names the first point');
const flat = kiwiSaverChangeLine(
  [
    { date: '2026-10-01', value: 80 },
    { date: '2026-10-12', value: 80 },
  ],
  'All',
  today,
  money,
);
assert(flat!.arrow === '■' && flat!.amount === 0, 'no movement is marked without a colour');

assert(kiwiSaverSplit(100, 80, null) === null, 'missing returns means no split bar');
assert(kiwiSaverSplit(100, null, 20) === null, 'missing invested means no split bar');
assert(kiwiSaverSplit(100, 110, -10) === null, 'a negative return is not a share of the balance');
assert(kiwiSaverSplit(0, 0, 0) === null, 'a zero balance has no share to draw');
const even = kiwiSaverSplit(100, 80, 20);
assert(even != null, 'invested and returns together produce a bar');
assert(even!.investedPct + even!.returnsPct === 100, 'the two shares of the balance sum to 100');
const evenLabels = kiwiSaverSplitLabels(even!);
assert(evenLabels.invested === 80 && evenLabels.returns === 20, 'exact shares stay exact');
assert(evenLabels.invested + evenLabels.returns === 100, 'labels sum to 100');
const awkward = kiwiSaverSplit(29628.83, 20000, 9628.83);
assert(awkward != null && Math.abs(awkward.investedPct + awkward.returnsPct - 100) < 1e-6, 'real cents still sum to 100');
const awkwardLabels = kiwiSaverSplitLabels(awkward!);
assert(awkwardLabels.invested + awkwardLabels.returns === 100, 'rounded labels of a real split still sum to 100');
const noGrowth = kiwiSaverSplit(100, 100, 0);
assert(noGrowth != null && noGrowth.returnsPct === 0, 'a recorded zero return is present, not missing');
assert(kiwiSaverSplitLabels(noGrowth!).returns === 0, 'zero growth is labelled 0%');

assert(
  kiwiSaverVisibleRanges(
    [
      { date: '2026-10-08', value: 1 },
      { date: '2026-10-12', value: 2 },
    ],
    today,
  ).join(',') === 'All',
  'a week of history only covers All',
);
assert(
  kiwiSaverVisibleRanges(
    [
      { date: '2026-08-12', value: 1 },
      { date: '2026-10-12', value: 2 },
    ],
    today,
  ).join(',') === '1M,All',
  'two months covers 1M and All, not 3M or 1Y',
);
assert(
  kiwiSaverVisibleRanges([{ date: '2026-07-12', value: 1 }], today).join(',') === '1M,3M,All',
  'a first point on the 3M start covers 3M and not 1Y',
);
assert(
  kiwiSaverVisibleRanges(
    [
      { date: '2024-01-01', value: 1 },
      { date: '2026-10-12', value: 2 },
    ],
    today,
  ).join(',') === '1M,3M,1Y,All',
  'history that reaches each start shows every range',
);
assert(kiwiSaverVisibleRanges([], today).length === 0, 'no points means no range toggles');

const longHistory = [
  { date: '2026-08-01', value: 1 },
  { date: '2026-10-12', value: 2 },
];
assert(
  kiwiSaverActiveRange(longHistory, ['1M', 'All'], null, today) === '1M',
  'the default range is the shortest one that contains a point',
);
assert(
  kiwiSaverActiveRange(longHistory, ['1M', 'All'], 'All', today) === 'All',
  'an explicit range choice is kept',
);
assert(
  kiwiSaverActiveRange([{ date: '2024-01-01', value: 1 }], ['1M', '3M', '1Y', 'All'], null, today) === 'All',
  'a covered range with no points inside it is not the default',
);
assert(
  kiwiSaverActiveRange(longHistory, ['1M', 'All'], '1Y', today) === '1M',
  'a choice the history does not cover falls back',
);

let seenValue: number | null = null;
const label = kiwiSaverPointAriaLabel('2026-10-12', 29628.83, (n) => {
  seenValue = n;
  return `$${n}`;
});
assert(seenValue === 29628.83, 'the aria-label is given the exact recorded value');
assert(label === '12 Oct 2026, $29628.83', 'the aria-label is the Auckland date and the exact value');
assert(
  kiwiSaverPointAriaLabel('2026-10-11T13:00:00.000Z', 29628.83, (n) => `$${n}`) === '12 Oct 2026, $29628.83',
  'a timestamp is labelled as its Auckland day, not the UTC date',
);
assert(kiwiSaverPointAriaLabel('not-a-date', 1, (n) => String(n)) === null, 'an unreadable point has no label');
assert(
  kiwiSaverPointAriaLabel('2026-10-12', Number.NaN, (n) => String(n)) === null,
  'a non-finite value is not labelled',
);

assert(kiwiSaverAllocationLabel(60) === '60%', 'a whole allocation stays a whole percent');
assert(kiwiSaverAllocationLabel(17.5) === '17.5%', 'a half percent keeps one decimal');
assert(kiwiSaverAllocationLabel(17.256) === '17.26%', 'allocation labels round to the nearest 0.01');
assert(kiwiSaverAllocationLabel(0) === '0%', 'a recorded zero allocation is 0%');
assert(kiwiSaverAllocationLabel(-5) === '-5%', 'a recorded negative allocation is shown');
assert(kiwiSaverAllocationLabel(null) === '—', 'a missing allocation is a dash');
assert(kiwiSaverAllocationLabel(Number.NaN) === '—', 'a non-finite allocation is a dash');

assert(kiwiSaverHoldingCost(7500, null) === null, 'cost is not estimated from a balance alone');
assert(kiwiSaverHoldingCost(null, 500) === null, 'cost is not estimated from returns alone');
assert(kiwiSaverHoldingCost(7500, 500) === 7000, 'cost is balance minus recorded returns');
assert(kiwiSaverHoldingCost(100, -20) === 120, 'a recorded loss increases cost');
assert(kiwiSaverHoldingCost(100, 0) === 100, 'a recorded zero return is used as a cost input');
assert(kiwiSaverHoldingReturnPct(null, 10) === null, 'a missing cost has no return percent');
assert(kiwiSaverHoldingReturnPct(0, 0) === null, 'a zero cost is not treated as a base');
assert(kiwiSaverHoldingReturnPct(100, 0) === 0, 'a recorded zero return is 0%, not missing');
assert(kiwiSaverHoldingReturnPct(120, -20) === (-20 / 120) * 100, 'the return percent keeps the recorded loss');

assert(kiwiSaverUnitsLabel(null) === null, 'missing units stay missing');
assert(kiwiSaverUnitsLabel(0) === '0', 'zero units are recorded');
assert(kiwiSaverUnitsLabel(1234.5) === '1,234.5', 'units are grouped and not rounded away');
assert(kiwiSaverUnitsLabel(Number.NaN) === null, 'a non-finite unit count is missing');

const dollars = (n: number) => `$${n}`;
let signedSeen: number | null = null;
assert(
  kiwiSaverSignedMoney(12, (n) => {
    signedSeen = n;
    return `$${n}`;
  }) === '+$12',
  'a gain is marked with a plus, not colour alone',
);
assert(signedSeen === 12, 'the money formatter receives the recorded gain');
assert(kiwiSaverSignedMoney(-4, dollars) === '$-4', 'a loss is passed through with its sign');
assert(kiwiSaverSignedMoney(0, dollars) === '$0', 'a zero return is not given a plus');

const mix = kiwiSaverHoldingRows([
  { fundName: 'Cash', allocationPct: 30, balanceNzd: 900, symbol: 'NZX.CASH', shares: 10 },
  { fundName: '  ', allocationPct: 100, balanceNzd: 1 },
  { fundName: 'Growth', allocationPct: 60, balanceNzd: 100, returnsNzd: 10, fundId: 'g1', logo: ' https://cdn.example/g.png ' },
  { fundName: 'Odd', allocationPct: null, balanceNzd: 50, currency: 'usd' },
]);
assert(mix.length === 3, 'a blank fund name is dropped rather than labelled');
assert(mix[0].name === 'Growth' && mix[1].name === 'Cash' && mix[2].name === 'Odd', 'rows follow recorded allocation, then leave missing allocations last');
assert(mix[0].key === 'id:g1:2', 'the row key uses the recorded fund id and its place in the mix');
assert(mix[0].ticker === 'GROW', 'a fund without a symbol uses the name for the icon letters');
assert(mix[1].ticker === 'CASH', 'a dotted symbol uses the ticker after the last dot');
assert(mix[0].costNzd === 90 && mix[0].returnPct === (10 / 90) * 100, 'cost and return percent come from the recorded balance and returns');
assert(mix[0].logo === 'https://cdn.example/g.png', 'a recorded logo is trimmed and kept');
assert(mix[2].allocationLabel === '—' && mix[2].costNzd === null, 'a holding with no allocation and no returns stays blank');
assert(mix[2].currency === 'usd', 'a recorded currency is kept as sent');

const fromBalances = kiwiSaverHoldingRows([
  { fundName: 'Growth', allocationPct: null, balanceNzd: 7500 },
  { fundName: 'Cash', allocationPct: null, balanceNzd: 2500 },
]);
assert(kiwiSaverAllocationView(fromBalances).kind === 'none', 'balances without allocations do not become a bar');
assert(fromBalances.every((row) => row.allocationLabel === '—'), 'a missing allocation stays a dash even when a balance is recorded');

const barRows = kiwiSaverHoldingRows([
  { fundName: 'Cash', allocationPct: 30, balanceNzd: 900 },
  { fundName: 'Growth', allocationPct: 60, balanceNzd: 100 },
  { fundName: 'Zero', allocationPct: 0, balanceNzd: 0 },
]);
const bar = kiwiSaverAllocationView(barRows);
assert(bar.kind === 'bar', 'recorded allocations draw a bar');
if (bar.kind === 'bar') {
  assert(bar.segments[0].name === 'Growth' && bar.segments[0].pct === 60, 'the bar uses the recorded percent, not the balance share');
  assert(bar.segments[1].pct === 30, 'the second recorded percent is kept');
  assert(bar.segments[2].label === '0%', 'a recorded zero stays on the legend');
  assert(bar.gapLabel === 'Not recorded 10%', 'the unrecorded remainder is named, not given a fund');
  assert(bar.gapPct === 10, 'the gap is the complement of the recorded allocations');
}

const full = kiwiSaverAllocationView(
  kiwiSaverHoldingRows([
    { fundName: 'A', allocationPct: 33.33, balanceNzd: 1 },
    { fundName: 'B', allocationPct: 33.33, balanceNzd: 1 },
    { fundName: 'C', allocationPct: 33.34, balanceNzd: 1 },
  ]),
);
assert(full.kind === 'bar' && full.gapLabel === null, 'allocations that round to 100% have no gap');

const over = kiwiSaverAllocationView(
  kiwiSaverHoldingRows([
    { fundName: 'A', allocationPct: 60, balanceNzd: 1 },
    { fundName: 'B', allocationPct: 50, balanceNzd: 1 },
  ]),
);
assert(over.kind === 'overflow' && over.sumLabel === '110%', 'allocations past 100% are reported, not rescaled');

const negativeShare = kiwiSaverHoldingRows([{ fundName: 'Odd', allocationPct: -5, balanceNzd: 10 }]);
assert(negativeShare[0].allocationLabel === '-5%', 'the row shows the recorded negative allocation');
assert(kiwiSaverAllocationView(negativeShare).kind === 'none', 'a negative allocation is not drawn as a share of the mix');

assert(
  kiwiSaverHoldingsShowReturns([{ returnsNzd: null }, { returnsNzd: 0 }]) === true,
  'a recorded zero return shows the return column',
);
assert(kiwiSaverHoldingsShowReturns([{ returnsNzd: null }]) === false, 'no recorded returns hides the return column');

const gainLabel = kiwiSaverHoldingReturnLabel({ returnsNzd: 10, returnPct: (10 / 90) * 100 }, dollars);
assert(gainLabel.text.startsWith('+') && gainLabel.tone === 'up', 'a gain on the row is signed and marked up');
const dollarOnly = kiwiSaverHoldingReturnLabel({ returnsNzd: -4, returnPct: null }, dollars);
assert(dollarOnly.text === '$-4' && dollarOnly.tone === 'down', 'without a cost, the row shows the recorded dollar return');
assert(
  kiwiSaverHoldingReturnLabel({ returnsNzd: null, returnPct: null }, dollars).text === '—',
  'a holding with no return is a dash',
);

const facts = kiwiSaverHoldingFacts(
  {
    symbol: null,
    unitsLabel: null,
    costNzd: 90,
    returnsNzd: 10,
    returnPct: (10 / 90) * 100,
    currency: 'usd',
  },
  dollars,
);
assert(facts.find((fact) => fact.label === 'Symbol')?.text === '—', 'a missing symbol is a dash');
assert(facts.find((fact) => fact.label === 'Units')?.text === '—', 'missing units are a dash');
assert(facts.find((fact) => fact.label === 'Cost')?.text === '$90', 'derived cost is shown once both inputs exist');
assert(facts.find((fact) => fact.label === 'Returns')?.text === '+$10', 'recorded returns keep a plus');
assert(facts.find((fact) => fact.label === 'Currency')?.text === 'USD', 'a non-NZD currency is shown as recorded');
const nzdFacts = kiwiSaverHoldingFacts(
  { symbol: 'VOO', unitsLabel: '2', costNzd: null, returnsNzd: null, returnPct: null, currency: 'NZD' },
  dollars,
);
assert(!nzdFacts.some((fact) => fact.label === 'Currency'), 'NZD is not repeated next to an NZD value');
assert(nzdFacts.find((fact) => fact.label === 'Return')?.text === '—', 'a return percent is not invented');

assert(
  kiwiSaverHoldingGaps({ allocationPct: null, balanceNzd: 1 }, true).join(',') === 'allocation',
  'an editable row with no allocation can add one',
);
assert(
  kiwiSaverHoldingGaps({ allocationPct: 10, balanceNzd: null }, true).join(',') === 'balance',
  'an editable row with no value can add one',
);
assert(
  kiwiSaverHoldingGaps({ allocationPct: null, balanceNzd: null }, false).length === 0,
  'a read-only provider row does not offer Add',
);
assert(
  kiwiSaverHoldingGaps({ allocationPct: 0, balanceNzd: 0 }, true).length === 0,
  'recorded zeros are not treated as missing',
);

assert(
  kiwiSaverHoldingsEmpty({ hasScheme: false, dataSource: null }).message === 'Select a scheme to see holdings.',
  'no scheme asks for a selection',
);
assert(kiwiSaverHoldingsEmpty({ hasScheme: false, dataSource: null }).offerAdd === false, 'no scheme has nothing to add to');
assert(
  kiwiSaverHoldingsEmpty({ hasScheme: true, dataSource: 'akahu' }).message === 'No fund mix from Akahu yet.',
  'an empty Akahu mix says the provider has not sent one',
);
assert(
  kiwiSaverHoldingsEmpty({ hasScheme: true, dataSource: 'akahu' }).offerAdd === false,
  'Akahu holdings are not filled in by hand',
);
assert(
  kiwiSaverHoldingsEmpty({ hasScheme: true, dataSource: 'manual' }).offerAdd === true,
  'a manual scheme can add a fund mix',
);
assert(
  kiwiSaverHoldingsEmpty({ hasScheme: true, dataSource: 'csv' }).offerAdd === true,
  'a CSV scheme can add a fund mix',
);
assert(
  kiwiSaverHoldingsEmpty({ hasScheme: true, dataSource: 'other' }).offerAdd === false,
  'an unknown source does not open the manual form',
);

console.log('kiwisaverView.test.ts ok');
