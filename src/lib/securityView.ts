/**
 * Settings → Security view helpers: the summary card, short dates, the password rule as a
 * checklist, and which sign-in methods can be removed without locking the account out.
 * Pure functions so they can be tested without a browser. Run: npm run test:security-page
 */
import type { AccountSecurity, AuthEvent } from '../api/client';

const TZ = 'Pacific/Auckland';

/** Below this many backup codes the page warns. */
export const LOW_BACKUP_CODES = 3;

export function lowOnBackupCodes(remaining: number): boolean {
  return remaining < LOW_BACKUP_CODES;
}

/** "15 Oct, 1:58 pm" this year, "15 Oct 2025" before; "—" when missing. */
export function shortWhen(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const year = (x: Date) => new Intl.DateTimeFormat('en-NZ', { year: 'numeric', timeZone: TZ }).format(x);
  if (year(d) !== year(now)) {
    return new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }).format(d);
  }
  const day = new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', timeZone: TZ }).format(d);
  const time = new Intl.DateTimeFormat('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ })
    .format(d)
    .replace(/\s*(am|pm)$/i, (_, p: string) => ` ${p.toLowerCase()}`);
  return `${day}, ${time}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export type MethodIconKind = 'password' | 'google' | 'apple' | 'microsoft' | 'passkey' | 'passkey_added' | 'device' | 'shield';

export function providerIconKind(provider: string): MethodIconKind {
  return provider === 'google' || provider === 'apple' || provider === 'microsoft' ? provider : 'shield';
}

// --- password rule (server/auth/passwords.ts validatePassword) ----------------------------

export type PasswordCheck = { label: string; ok: boolean };

export function passwordChecks(pw: string): PasswordCheck[] {
  return [
    { label: 'At least 8 characters', ok: pw.length >= 8 },
    { label: 'A letter', ok: /[A-Za-z]/.test(pw) },
    { label: 'A number', ok: /[0-9]/.test(pw) },
  ];
}

export function passwordAcceptable(pw: string): boolean {
  return pw.length <= 128 && passwordChecks(pw).every((c) => c.ok);
}

// --- lockout rules (mirrors the server; the server still enforces them) --------------------

type Methods = Pick<AccountSecurity, 'hasPassword' | 'identities' | 'passkeys'>;

export function signInMethodCount(d: Methods): number {
  return (d.hasPassword ? 1 : 0) + d.identities.length + d.passkeys.length;
}

/** A passkey can go unless it is the last way to sign in. */
export function canRemovePasskey(d: Methods): boolean {
  return signInMethodCount(d) > 1;
}

/** Providers: the server keeps the last one until a password is set (routes/sso.ts). */
export function canDisconnectIdentity(d: Methods): boolean {
  return d.hasPassword || d.identities.length > 1;
}

/** True when a sensitive change will ask for the password (no recent sign-in). */
export function needsReauth(d: Pick<AccountSecurity, 'recentSignInUntil'>, now: Date = new Date()): boolean {
  const until = d.recentSignInUntil ? Date.parse(d.recentSignInUntil) : NaN;
  return !(Number.isFinite(until) && now.getTime() < until);
}

// --- summary card -------------------------------------------------------------------------

export type SummaryTone = 'good' | 'ok' | 'action';
export type SummaryItem = { key: string; text: string; status: 'ok' | 'warn' | 'info'; href?: string; linkText?: string };
export type Summary = { title: string; tone: SummaryTone; items: SummaryItem[] };

type SummaryInput = Pick<AccountSecurity, 'hasPassword' | 'twoFactor' | 'passkeys' | 'sessions' | 'trustedDevices'>;

export function securitySummary(d: SummaryInput): Summary {
  const items: SummaryItem[] = [];
  const tf = d.twoFactor;
  items.push(
    tf.enabled
      ? { key: '2fa', text: 'Two-factor sign-in is on', status: 'ok' }
      : { key: '2fa', text: d.hasPassword ? 'Two-factor sign-in is off' : 'Two-factor sign-in is off (set a password first)', status: 'warn', href: '#two-factor', linkText: 'Turn it on' },
  );
  items.push(
    d.passkeys.length > 0
      ? { key: 'passkeys', text: plural(d.passkeys.length, 'passkey'), status: 'ok' }
      : { key: 'passkeys', text: 'No passkeys yet', status: 'info', href: '#ways-to-sign-in', linkText: 'Add one' },
  );
  const low = tf.enabled && lowOnBackupCodes(tf.backupCodesRemaining);
  if (tf.enabled) {
    items.push({
      key: 'backup',
      text: `${plural(tf.backupCodesRemaining, 'backup code')} left`,
      status: low ? 'warn' : 'ok',
      ...(low ? { href: '#two-factor', linkText: 'Make new codes' } : {}),
    });
  }
  const others = groupDevices(d).filter((x) => x.signedIn && !x.current).length;
  items.push(
    others > 0
      ? { key: 'others', text: `${plural(others, 'other browser')} signed in`, status: 'info', href: '#devices', linkText: 'review below' }
      : { key: 'others', text: 'No other browsers signed in', status: 'ok' },
  );

  if (!tf.enabled) return { title: 'Turn on two-factor sign-in', tone: 'action', items };
  if (low) return { title: 'Your account is protected', tone: 'ok', items };
  return { title: 'Your account is well protected', tone: 'good', items };
}

// --- devices: signed-in sessions and trusted devices as one list ------------------------------

type Session = AccountSecurity['sessions'][number];
type Trusted = AccountSecurity['trustedDevices'][number];

export type Device = {
  key: string;
  name: string;
  /** This browser. */
  current: boolean;
  /** Live sessions on this device (usually one). */
  sessions: Session[];
  signedIn: boolean;
  lastActiveAt: string | null;
  /** Skips the two-factor code until trusted.expiresAt. */
  trusted: Trusted | null;
};

const lastSeen = (s: Session) => s.lastSeenAt ?? s.createdAt;
const latest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

/**
 * Sessions join the trusted device they were opened on (sessions.trusted_device_id). On this
 * browser the two are also joined by both being "current", which covers sessions from before
 * the link was recorded. Anything else stays its own row.
 */
export function groupDevices(d: Pick<AccountSecurity, 'sessions' | 'trustedDevices'>): Device[] {
  const used = new Set<string>();
  const devices: Device[] = d.trustedDevices.map((t) => {
    const sessions = d.sessions.filter((s) => s.trustedDeviceId === t.id || (t.current && s.current && !s.trustedDeviceId));
    for (const s of sessions) used.add(s.id);
    return {
      key: t.id,
      name: t.label ?? sessions[0]?.deviceLabel ?? 'Unknown device',
      current: t.current || sessions.some((s) => s.current),
      sessions,
      signedIn: sessions.length > 0,
      lastActiveAt: sessions.reduce<string | null>((m, s) => latest(m, lastSeen(s)), t.lastUsedAt ?? t.createdAt),
      trusted: t,
    };
  });
  for (const s of d.sessions) {
    if (used.has(s.id)) continue;
    devices.push({
      key: s.id,
      name: s.deviceLabel ?? 'Unknown device',
      current: s.current,
      sessions: [s],
      signedIn: true,
      lastActiveAt: lastSeen(s),
      trusted: null,
    });
  }
  return devices.sort((a, b) => Number(b.current) - Number(a.current) || (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? ''));
}

/** "13 Nov" (or "13 Nov 2027" in another year), NZ time. */
export function shortDate(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const sameYear = new Intl.DateTimeFormat('en-NZ', { year: 'numeric', timeZone: TZ }).format(d) === new Intl.DateTimeFormat('en-NZ', { year: 'numeric', timeZone: TZ }).format(now);
  return new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: TZ }).format(d);
}

/** The two-factor line for a device; null when two-factor is off (nothing to skip). */
export function deviceTwoFactorText(device: Device, twoFactorOn: boolean, now: Date = new Date()): string | null {
  if (!twoFactorOn) return null;
  return device.trusted ? `Skips two-factor until ${shortDate(device.trusted.expiresAt, now)}` : 'Asks for two-factor';
}

// --- sign-in log wording ---------------------------------------------------------------------

const PROVIDER_LABELS: Record<string, string> = { google: 'Google', apple: 'Apple', microsoft: 'Microsoft' };

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/**
 * What an event says, and its icon. Older single sign-on events have no provider; when the
 * server offers only one provider, that must have been it.
 */
export function eventText(e: AuthEvent, ssoProviders: Array<{ id: string; label: string }>): { text: string; icon: MethodIconKind } {
  if (e.kind === 'passkey_added') return { text: 'Passkey added', icon: 'passkey_added' };
  if (e.kind === 'passkey_removed') return { text: 'Passkey removed', icon: 'passkey' };
  const provider = e.provider ?? (e.method === 'sso' && ssoProviders.length === 1 ? ssoProviders[0].id : null);
  switch (e.method) {
    case 'passkey':
      return { text: e.passkeyName ? `Signed in with the passkey “${e.passkeyName}”` : 'Signed in with a passkey', icon: 'passkey' };
    case 'sso':
      return provider
        ? { text: `Signed in with ${providerLabel(provider)}`, icon: providerIconKind(provider) }
        : { text: 'Signed in with single sign-on', icon: 'shield' };
    case 'two_factor':
      return provider
        ? { text: `Signed in with ${providerLabel(provider)} and a 2FA code`, icon: providerIconKind(provider) }
        : { text: 'Signed in with password and a 2FA code', icon: 'password' };
    case 'password':
      return { text: 'Signed in with password', icon: 'password' };
    case 'register':
      return { text: 'Created the account', icon: 'password' };
    default:
      return { text: 'Signed in', icon: 'device' };
  }
}

/** "a passkey", "Google", "your password and a 2FA code" — the method, for "Was this you?". */
export function eventMethodShort(e: AuthEvent, ssoProviders: Array<{ id: string; label: string }>): string {
  const t = eventText(e, ssoProviders).text;
  return t.replace(/^Signed in with /, '').replace(/^password/, 'your password');
}
