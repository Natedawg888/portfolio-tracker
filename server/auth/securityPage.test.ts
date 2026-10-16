/**
 * Settings → Security redesign, server side: sessions linked to trusted devices, provider
 * and passkey in the sign-in log, new-device sign-ins ("Was this you?"), securing the
 * account, and setting a first password only after a recent sign-in.
 * Run: npm run test:security-page
 *
 * Uses a throwaway sqlite file and data dir. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-secpage-'));
process.env.DATABASE_PATH = path.join(tmp, 'portfolio.db');
delete process.env.AUTH_ENCRYPTION_KEY;

let passed = 0;
const check = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
};

const { base32Decode, hotp, totpStep } = await import('./totp.ts');
const { getDb, queryOne, run } = await import('../db/index.ts');
const { createLoginChallenge } = await import('./twoFactor.ts');
const { createSession, hashToken } = await import('./sessions.ts');
const { NO_PASSWORD, createUserAccount } = await import('./users.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { default: authRouter } = await import('../routes/auth.ts');
const { default: securityRouter } = await import('../routes/security.ts');

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/auth', authRouter);
app.use('/api/auth', securityRouter);
const server: Server = await new Promise((r) => {
  const s = app.listen(0, '127.0.0.1', () => r(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth`;

const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

type Jar = { cookies: Map<string, string>; ua: string };
const browser = (ua: string): Jar => ({ cookies: new Map(), ua });
async function call(jar: Jar, method: string, p: string, body?: unknown) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'user-agent': jar.ua,
      cookie: [...jar.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie()) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    const v = kv.slice(i + 1);
    if (v && !/Max-Age=0/.test(c)) jar.cookies.set(kv.slice(0, i), v);
    else jar.cookies.delete(kv.slice(0, i));
  }
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

type Security = {
  sessions: Array<{ id: string; current: boolean; deviceLabel: string; trustedDeviceId: string | null }>;
  trustedDevices: Array<{ id: string; current: boolean }>;
  recentSignIns: Array<{ id: string; method: string; provider: string | null; deviceLabel: string; newDevice: boolean; signedIn: boolean; current: boolean }>;
  newSignIns: Array<{ id: string; deviceLabel: string }>;
  passwordLastUsedAt: string | null;
};
const security = async (jar: Jar) => (await call(jar, 'GET', '/security')).json as Security;

const db = await getDb();
const pw = 'Correct-horse-9';
const email = 'secpage@example.test';

try {
  // Browser A (this device): sign up and turn on two-factor.
  const a = browser(LINUX);
  check((await call(a, 'POST', '/register', { email, password: pw, firstName: 'Sec', lastName: 'Page' })).status === 201, 'register');
  const setup = await call(a, 'POST', '/2fa/setup', { password: pw });
  const secret = base32Decode(setup.json.secret)!;
  const enable = await call(a, 'POST', '/2fa/enable', { code: hotp(secret, totpStep()) });
  const backup: string[] = enable.json.backupCodes;

  // Browser B: password + code, trusted. The session is linked to the new trusted device.
  const b = browser(WINDOWS);
  const ch = await call(b, 'POST', '/login', { email, password: pw });
  check((await call(b, 'POST', '/login/2fa', { challenge: ch.json.challenge, code: hotp(secret, totpStep() + 1), trustDevice: true })).status === 200, 'B signs in, trusted');
  let s = await security(a);
  check(s.trustedDevices.length === 1, 'one trusted device');
  const tdev = s.trustedDevices[0].id;
  const bSession = s.sessions.find((x) => x.deviceLabel === 'Chrome on Windows')!;
  check(bSession.trustedDeviceId === tdev, 'session opened while trusting is linked to the trusted device');

  // B signs out and back in; the trusted browser skips the code and the new session is linked too.
  await call(b, 'POST', '/logout');
  const again = await call(b, 'POST', '/login', { email, password: pw });
  check(again.status === 200 && !again.json.twoFactorRequired, 'trusted browser skips the code');
  s = await security(a);
  const bSessions = s.sessions.filter((x) => x.deviceLabel === 'Chrome on Windows');
  check(bSessions.length === 1 && bSessions[0].trustedDeviceId === tdev, 'sign-in on a trusted browser is linked to it');
  const linkedRow = queryOne<{ trusted_device_id: string }>(db, `SELECT trusted_device_id FROM sessions WHERE id = ?`, [bSessions[0].id]);
  check(linkedRow?.trusted_device_id === tdev, 'link stored on the session row');

  // A's own session isn't linked (A never trusted itself).
  check(s.sessions.find((x) => x.current)?.trustedDeviceId === null, 'this browser has no trusted device');

  // Browser C (iPhone): password + backup code, not trusted. A new device.
  const c = browser(IPHONE);
  const chC = await call(c, 'POST', '/login', { email, password: pw });
  check((await call(c, 'POST', '/login/2fa', { challenge: chC.json.challenge, code: backup[0] })).status === 200, 'C signs in with a backup code');
  s = await security(a);
  const cEvent = s.recentSignIns.find((e) => e.deviceLabel === 'Safari on iPhone')!;
  check(cEvent.newDevice && cEvent.signedIn && !cEvent.current, 'iPhone sign-in is new and still signed in');
  check(cEvent.method === 'two_factor' && cEvent.provider === null, 'password + code has no provider');
  const winEvents = s.recentSignIns.filter((e) => e.deviceLabel === 'Chrome on Windows');
  check(winEvents.length === 2 && winEvents[1].newDevice && !winEvents[0].newDevice, 'only the first Windows sign-in is new');
  check(!s.recentSignIns.find((e) => e.method === 'register')!.newDevice, 'sign-up is never new');
  check(s.newSignIns.map((e) => e.deviceLabel).join() === 'Safari on iPhone,Chrome on Windows', 'Was this you? lists unreviewed new-device sign-ins, newest first');

  // The new device's own view doesn't ask about itself.
  check((await security(c)).newSignIns.every((e) => e.deviceLabel !== 'Safari on iPhone'), 'not asked about the sign-in you are using');

  // "Yes, it was me" for the Windows one.
  const winNew = s.newSignIns.find((e) => e.deviceLabel === 'Chrome on Windows')!;
  check((await call(a, 'POST', `/sign-ins/${winNew.id}/reviewed`)).status === 200, 'mark reviewed');
  check((await security(a)).newSignIns.length === 1, 'reviewed sign-in no longer asked about');
  check((await call(c, 'POST', `/sign-ins/${winNew.id}/reviewed`)).status === 404, 'already reviewed');
  const other = browser(LINUX);
  await call(other, 'POST', '/register', { email: 'other@example.test', password: pw, firstName: 'O', lastName: 'Ther' });
  check((await call(other, 'POST', `/sign-ins/${s.newSignIns[0].id}/reviewed`)).status === 404, 'another account cannot review my sign-ins');

  // Single sign-on followed by a code: the provider is kept; it isn't a password sign-in.
  const userId = queryOne<{ id: string }>(db, `SELECT id FROM users WHERE email = ?`, [email])!.id;
  const passwordBefore = (await security(a)).passwordLastUsedAt;
  const ssoChallenge = createLoginChallenge(db, userId, true, 'google');
  const d = browser(IPHONE);
  check((await call(d, 'POST', '/login/2fa', { challenge: ssoChallenge.token, code: backup[1] })).status === 200, 'Google then code');
  s = await security(a);
  check(s.recentSignIns[0].method === 'two_factor' && s.recentSignIns[0].provider === 'google', 'provider recorded after the code step');
  check(s.passwordLastUsedAt === passwordBefore, 'Google + code is not counted as a password sign-in');

  // "No, secure my account": others signed out, trusted devices gone, sign-ins reviewed.
  const secured = await call(a, 'POST', '/secure-account');
  check(secured.status === 200 && secured.json.signedOut === 3 && secured.json.untrusted === 1, 'secure account counts');
  s = await security(a);
  check(s.sessions.length === 1 && s.sessions[0].current, 'only this browser stays signed in');
  check(s.trustedDevices.length === 0 && s.newSignIns.length === 0, 'no trusted devices, nothing left to review');
  check((await call(b, 'GET', '/me')).json.user === null, 'B is signed out');
  const bLogin = await call(b, 'POST', '/login', { email, password: pw });
  check(bLogin.json.twoFactorRequired === true, 'B asks for the code again');

  // Setting a first password needs a recent sign-in.
  const ssoUser = createUserAccount(db, { email: 'nopw@example.test', passwordHash: NO_PASSWORD, firstName: 'No', lastName: 'Pw' });
  const old = await createSession(ssoUser.id, { deviceLabel: 'Chrome on Linux' });
  run(db, `UPDATE sessions SET created_at = ? WHERE token_hash = ?`, [new Date(Date.now() - 20 * 60 * 1000).toISOString(), hashToken(old.rawToken)]);
  const stale = browser(LINUX);
  stale.cookies.set('pt_sid', encodeURIComponent(old.rawToken));
  const refused = await call(stale, 'POST', '/change-password', { currentPassword: '', newPassword: 'Brand-new-pw-1' });
  check(refused.status === 403 && refused.json.code === 'REAUTH_REQUIRED', 'old session cannot set a first password');
  const fresh = await createSession(ssoUser.id, { deviceLabel: 'Chrome on Linux' });
  const recent = browser(LINUX);
  recent.cookies.set('pt_sid', encodeURIComponent(fresh.rawToken));
  check((await call(recent, 'POST', '/change-password', { currentPassword: '', newPassword: 'Brand-new-pw-1' })).status === 200, 'recent sign-in can set a first password');

  console.log(`security page server tests ok (${passed} checks)`);
} finally {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
