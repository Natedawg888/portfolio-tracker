/**
 * Settings → Security view helpers. Run: npm run test:security-page
 */
import type { AccountSecurity, AuthEvent } from '../api/client';
import {
  canDisconnectIdentity,
  canRemovePasskey,
  deviceTwoFactorText,
  eventMethodShort,
  eventText,
  groupDevices,
  lowOnBackupCodes,
  needsReauth,
  passwordAcceptable,
  passwordChecks,
  securitySummary,
  shortWhen,
} from './securityView.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}

const now = new Date('2026-10-16T03:00:00Z');
eq(shortWhen('2026-10-15T00:58:00Z', now), '15 Oct, 1:58 pm', 'this year: day and NZ time');
eq(shortWhen('2025-03-02T00:00:00Z', now), '2 Mar 2025', 'earlier years: date only');
eq(shortWhen(null, now), '—', 'missing');
eq(shortWhen('nope', now), '—', 'invalid');

eq(passwordChecks('abc').map((c) => c.ok).join(), 'false,true,false', 'short, letters only');
eq(passwordAcceptable('abcdefg1'), true, '8 with a letter and a number');
eq(passwordAcceptable('12345678'), false, 'needs a letter');
eq(passwordAcceptable('abcdefgh'), false, 'needs a number');
eq(passwordAcceptable(`a1${'x'.repeat(127)}`), false, 'too long');

eq(lowOnBackupCodes(2), true, 'two is low');
eq(lowOnBackupCodes(3), false, 'three is fine');

const pk = { id: 'p', name: 'Chrome on Windows', createdAt: '', lastUsedAt: null, backedUp: false };
const google = { id: 'g', provider: 'google', label: 'Google', email: 'a@gmail.test', createdAt: '', lastUsedAt: null };
eq(canRemovePasskey({ hasPassword: false, identities: [], passkeys: [pk] }), false, 'only passkey of a passwordless account stays');
eq(canRemovePasskey({ hasPassword: true, identities: [], passkeys: [pk] }), true, 'password remains');
eq(canRemovePasskey({ hasPassword: false, identities: [google], passkeys: [pk] }), true, 'Google remains');
eq(canDisconnectIdentity({ hasPassword: false, identities: [google], passkeys: [pk] }), false, 'last provider without a password stays (server rule)');
eq(canDisconnectIdentity({ hasPassword: true, identities: [google], passkeys: [] }), true, 'with a password it can go');

eq(needsReauth({ recentSignInUntil: '2026-10-16T03:10:00Z' }, now), false, 'recent sign-in');
eq(needsReauth({ recentSignInUntil: '2026-10-16T02:59:00Z' }, now), true, 'expired');
eq(needsReauth({ recentSignInUntil: null }, now), true, 'unknown');

let n = 0;
const session = (current: boolean, more: Partial<AccountSecurity['sessions'][number]> = {}) => ({
  id: current ? 'c' : `o${++n}`,
  deviceLabel: null,
  createdAt: '2026-10-16T01:00:00Z',
  lastSeenAt: null,
  expiresAt: '',
  persistent: true,
  current,
  trustedDeviceId: null,
  ...more,
});
const base = { hasPassword: true, passkeys: [pk], sessions: [session(true), session(false), session(false)], trustedDevices: [] };
const good = securitySummary({ ...base, twoFactor: { enabled: true, enabledAt: null, backupCodesRemaining: 8 } });
eq(good.title, 'Your account is well protected', 'everything fine');
eq(good.items.map((i) => i.text).join(' | '), 'Two-factor sign-in is on | 1 passkey | 8 backup codes left | 2 other browsers signed in', 'checklist');
eq(good.items.find((i) => i.key === 'others')?.linkText, 'review below', 'other browsers link');
const low = securitySummary({ ...base, twoFactor: { enabled: true, enabledAt: null, backupCodesRemaining: 2 } });
eq(low.title, 'Your account is protected', 'low on codes');
eq(low.items.find((i) => i.key === 'backup')?.status, 'warn', 'codes warn');
const off = securitySummary({ ...base, sessions: [session(true)], twoFactor: { enabled: false, enabledAt: null, backupCodesRemaining: 0 } });
eq(off.title, 'Turn on two-factor sign-in', 'two-factor off');
eq(off.items.some((i) => i.key === 'backup'), false, 'no backup codes line when off');
eq(off.items.find((i) => i.key === 'others')?.text, 'No other browsers signed in', 'only this browser');

// --- devices -------------------------------------------------------------------------------
{
  const tdev = (id: string, current: boolean) => ({
    id,
    label: 'Chrome on Windows',
    createdAt: '2026-10-14T01:00:00Z',
    lastUsedAt: '2026-10-14T01:00:00Z',
    expiresAt: '2026-11-13T01:00:00Z',
    current,
  });
  const here = session(true, { deviceLabel: 'Chrome on Linux' });
  const win1 = session(false, { deviceLabel: 'Chrome on Windows', trustedDeviceId: 't1', lastSeenAt: '2026-10-16T02:00:00Z' });
  const iphone = session(false, { deviceLabel: 'Safari on iPhone', lastSeenAt: '2026-10-15T00:58:00Z' });
  const devices = groupDevices({ sessions: [iphone, win1, here], trustedDevices: [tdev('t1', false), tdev('t2', false)] });
  eq(devices.map((d) => d.name).join(' | '), 'Chrome on Linux | Chrome on Windows | Safari on iPhone | Chrome on Windows', 'this device first, then most recent');
  eq(devices[1].sessions.length === 1 && devices[1].trusted?.id === 't1', true, 'session joins its trusted device');
  eq(devices[3].signedIn, false, 'trusted device without a session is not signed in');
  eq(deviceTwoFactorText(devices[1], true, now), 'Skips two-factor until 13 Nov', 'trusted');
  eq(deviceTwoFactorText(devices[2], true, now), 'Asks for two-factor', 'not trusted');
  eq(deviceTwoFactorText(devices[2], false, now), null, 'two-factor off');

  // This browser's trusted device and session join even without the recorded link.
  const legacy = groupDevices({ sessions: [here], trustedDevices: [tdev('t3', true)] });
  eq(legacy.length === 1 && legacy[0].current && legacy[0].signedIn, true, 'current session + current trusted device = one device');

  // The summary counts devices, not sessions.
  const twoOnOne = securitySummary({
    ...base,
    sessions: [here, win1, session(false, { trustedDeviceId: 't1' })],
    trustedDevices: [tdev('t1', false)],
    twoFactor: { enabled: true, enabledAt: null, backupCodesRemaining: 8 },
  });
  eq(twoOnOne.items.find((i) => i.key === 'others')?.text, '1 other browser signed in', 'two sessions on one trusted browser');
}

// --- sign-in log wording ------------------------------------------------------------------
{
  const ev = (more: Partial<AuthEvent>): AuthEvent => ({
    id: 'e',
    kind: 'sign_in',
    method: null,
    provider: null,
    passkeyName: null,
    deviceLabel: 'Safari on iPhone',
    createdAt: '',
    signedIn: false,
    current: false,
    newDevice: false,
    reviewed: false,
    ...more,
  });
  const providers = [
    { id: 'google', label: 'Google' },
    { id: 'apple', label: 'Apple' },
  ];
  eq(eventText(ev({ method: 'sso', provider: 'google' }), providers).text, 'Signed in with Google', 'provider named');
  eq(eventText(ev({ method: 'sso', provider: 'google' }), providers).icon, 'google', 'provider icon');
  eq(eventText(ev({ method: 'sso' }), providers).text, 'Signed in with single sign-on', 'older event, several providers');
  eq(eventText(ev({ method: 'sso' }), [providers[0]]).text, 'Signed in with Google', 'older event, only one provider offered');
  eq(eventText(ev({ method: 'two_factor', provider: 'apple' }), providers).text, 'Signed in with Apple and a 2FA code', 'provider then code');
  eq(eventText(ev({ method: 'two_factor' }), providers).text, 'Signed in with password and a 2FA code', 'password then code');
  eq(eventText(ev({ method: 'passkey', passkeyName: 'Chrome on Windows' }), providers).text, 'Signed in with the passkey “Chrome on Windows”', 'passkey named');
  eq(eventText(ev({ method: 'passkey' }), providers).text, 'Signed in with a passkey', 'removed passkey');
  eq(eventText(ev({ kind: 'passkey_added' }), providers).icon, 'passkey_added', 'passkey added icon');
  eq(eventMethodShort(ev({ method: 'two_factor' }), providers), 'your password and a 2FA code', 'short method');
}

console.log('security page tests ok');
