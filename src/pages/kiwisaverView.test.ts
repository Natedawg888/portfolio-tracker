/**
 * KiwiSaver header: subline omits null parts, sync control and scheme picker rules.
 * Run: npm run test:kiwisaver
 */
import { formatAuckland } from '../api/client.ts';
import {
  KIWISAVER_READONLY_NOTE,
  kiwiSaverActiveRange,
  kiwiSaverChangeLine,
  kiwiSaverHeaderParts,
  kiwiSaverHeaderSubline,
  kiwiSaverPointAriaLabel,
  kiwiSaverSchemeLabel,
  kiwiSaverSplit,
  kiwiSaverSplitLabels,
  kiwiSaverSyncNote,
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

console.log('kiwisaverView.test.ts ok');
