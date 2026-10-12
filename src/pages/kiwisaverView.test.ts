/**
 * KiwiSaver header: subline omits null parts, sync control and scheme picker rules.
 * Run: npm run test:kiwisaver
 */
import { formatAuckland } from '../api/client.ts';
import {
  KIWISAVER_READONLY_NOTE,
  kiwiSaverHeaderParts,
  kiwiSaverHeaderSubline,
  kiwiSaverSchemeLabel,
  kiwiSaverSyncNote,
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

console.log('kiwisaverView.test.ts ok');
