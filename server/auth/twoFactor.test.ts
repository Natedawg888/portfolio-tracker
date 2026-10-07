/**
 * 2FA sign-in, trusted devices, sessions and "keep me signed in" (KAN-16).
 * Run: npm run test:2fa
 *
 * Uses a throwaway sqlite file and data dir. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-2fa-'));
process.env.DATABASE_PATH = path.join(tmp, 'portfolio.db');
delete process.env.AUTH_ENCRYPTION_KEY;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
let passed = 0;
const check = (cond: unknown, msg: string) => {
  assert(cond, msg);
  passed++;
};

const { base32Decode, base32Encode, hotp, totpStep, verifyTotp, otpauthUri } = await import('./totp.ts');
const { sealSecret, openSecret } = await import('./secretBox.ts');
const { deviceLabel } = await import('./deviceLabel.ts');
const { getDb, queryOne } = await import('../db/index.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { default: authRouter } = await import('../routes/auth.ts');
const { default: securityRouter } = await import('../routes/security.ts');
const { resetLoginRateLimitForTest, MAX_FAILURES_PER_ACCOUNT } = await import('./loginRateLimit.ts');

// --- TOTP primitives (RFC 6238 Appendix B, SHA-1 secret "12345678901234567890") ----------
{
  const rfc = Buffer.from('12345678901234567890', 'ascii');
  // RFC lists 8-digit codes; 6 digits are the last 6 of the same truncation.
  check(hotp(rfc, Math.floor(59 / 30)) === '287082', 'RFC 6238 T=59');
  check(hotp(rfc, Math.floor(1111111109 / 30)) === '081804', 'RFC 6238 T=1111111109');
  check(hotp(rfc, Math.floor(20000000000 / 30)) === '353130', 'RFC 6238 T=20000000000');
  const b32 = base32Encode(rfc);
  check(b32 === 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 'base32 encode');
  check(base32Decode(b32)?.equals(rfc), 'base32 round trip');
  check(base32Decode('not base32!') === null, 'bad base32 rejected');

  const now = 1_700_000_000_000;
  const step = totpStep(now);
  const code = hotp(rfc, step);
  check(verifyTotp(b32, code, { nowMs: now }) === step, 'current code accepted');
  check(verifyTotp(b32, hotp(rfc, step - 1), { nowMs: now }) === step - 1, 'previous step accepted (drift)');
  check(verifyTotp(b32, hotp(rfc, step - 2), { nowMs: now }) === null, 'two steps old rejected');
  check(verifyTotp(b32, code, { nowMs: now, lastUsedStep: step }) === null, 'replayed code rejected');
  check(verifyTotp(b32, hotp(rfc, step - 1), { nowMs: now, lastUsedStep: step }) === null, 'older code after use rejected');
  check(verifyTotp(b32, `${code.slice(0, 3)} ${code.slice(3)}`, { nowMs: now }) === step, 'spaced code accepted');
  check(verifyTotp(b32, '12345', { nowMs: now }) === null, 'short code rejected');
  const uri = otpauthUri(b32, 'a+b@example.com');
  check(uri.startsWith('otpauth://totp/KoruLedger%3Aa%2Bb%40example.com?') && uri.includes('issuer=KoruLedger'), 'otpauth URI');
}

// --- secret box --------------------------------------------------------------------------
{
  const sealed = sealSecret('JBSWY3DPEHPK3PXP');
  check(!sealed.includes('JBSWY3DPEHPK3PXP') && sealed.startsWith('v1:'), 'sealed secret is not plaintext');
  check(openSecret(sealed) === 'JBSWY3DPEHPK3PXP', 'open round trip');
  const parts = sealed.split(':');
  parts[3] = `${parts[3].slice(0, -2)}AA`;
  check(openSecret(parts.join(':')) === null, 'tampered ciphertext rejected');
  check(fs.statSync(path.join(tmp, 'secrets', 'auth.key')).isFile(), 'local key file generated');
}

check(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36') === 'Chrome on Windows', 'UA: Chrome on Windows');
check(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1') === 'Safari on iPhone', 'UA: Safari on iPhone');
check(deviceLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0') === 'Edge on Windows', 'UA: Edge');
check(deviceLabel(undefined) === 'Unknown device', 'UA: missing');

// --- API ---------------------------------------------------------------------------------
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

type Jar = Map<string, string>;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
async function call(jar: Jar, method: string, p: string, body?: unknown) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'user-agent': UA,
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookies = res.headers.getSetCookie();
  for (const c of setCookies) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    const v = kv.slice(i + 1);
    if (v && !/Max-Age=0/.test(c)) jar.set(kv.slice(0, i), v);
    else jar.delete(kv.slice(0, i));
  }
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, setCookies };
}

const db = await getDb();
const pw = 'Correct-horse-9';
const email = 'twofa@example.test';

try {
  const a: Jar = new Map();
  const reg = await call(a, 'POST', '/register', { email, password: pw, firstName: 'Two', lastName: 'Factor' });
  check(reg.status === 201 && a.has('pt_sid'), 'register signs in');

  // Enable: wrong password, then setup, wrong code, right code.
  check((await call(a, 'POST', '/2fa/setup', { password: 'nope' })).status === 403, 'setup needs password');
  const setup = await call(a, 'POST', '/2fa/setup', { password: pw });
  check(setup.status === 200 && /^[A-Z2-7]{32}$/.test(setup.json.secret), 'setup returns base32 secret');
  check(String(setup.json.qrSvg).startsWith('<svg') && setup.json.otpauthUri.startsWith('otpauth://'), 'setup returns QR + URI');
  const userRow = () =>
    queryOne<{ totp_secret_enc: string | null; totp_pending_enc: string | null }>(db, `SELECT totp_secret_enc, totp_pending_enc FROM users WHERE email = ?`, [email])!;
  check(!userRow().totp_pending_enc!.includes(setup.json.secret), 'pending secret sealed at rest');
  const secret = base32Decode(setup.json.secret)!;
  const codeAt = (offset: number) => hotp(secret, totpStep() + offset);
  check((await call(a, 'POST', '/2fa/enable', { code: '000000' === codeAt(0) ? '111111' : '000000' })).status === 400, 'wrong code does not enable');
  const enable = await call(a, 'POST', '/2fa/enable', { code: codeAt(0) });
  check(enable.status === 200 && enable.json.backupCodes.length === 10, 'enable returns 10 backup codes');
  const backup: string[] = enable.json.backupCodes;
  check(backup.every((c) => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(c)), 'backup code format');
  check(userRow().totp_secret_enc && !userRow().totp_secret_enc!.includes(setup.json.secret), 'secret sealed at rest');
  const hashes = queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM user_backup_codes WHERE code_hash = ?`, [backup[0]]);
  check(Number(hashes?.c) === 0, 'backup codes stored hashed');
  check((await call(a, 'POST', '/2fa/setup', { password: pw })).status === 409, 'setup refused while enabled');

  // Sign in on a second browser: password alone → challenge, no session.
  const b: Jar = new Map();
  const login = await call(b, 'POST', '/login', { email, password: pw });
  check(login.status === 200 && login.json.twoFactorRequired === true && !b.has('pt_sid'), 'password → challenge, no session yet');
  check((await call(b, 'GET', '/me')).json.user === null, 'not signed in during challenge');
  const challenge = login.json.challenge;

  const bad = await call(b, 'POST', '/login/2fa', { challenge, code: '000000' === codeAt(1) ? '111111' : '000000' });
  check(bad.status === 401 && bad.json.code === 'INVALID_CODE' && !b.has('pt_sid'), 'wrong code refused');
  // The step used to enable is spent; the next step's code is inside the drift window.
  const ok = await call(b, 'POST', '/login/2fa', { challenge, code: codeAt(1), trustDevice: true });
  check(ok.status === 200 && b.has('pt_sid') && ok.json.user.email === email, 'right code signs in');
  check(b.has('pt_tdev'), 'trust device cookie set');
  check(ok.setCookies.some((c) => c.startsWith('pt_tdev=') && c.includes('Path=/api/auth') && c.includes('HttpOnly')), 'trusted cookie scoped + httpOnly');
  check((await call(b, 'POST', '/login/2fa', { challenge, code: codeAt(1) })).json.code === 'CHALLENGE_INVALID', 'challenge single use');

  // Trusted browser: password alone is enough next time.
  await call(b, 'POST', '/logout');
  const again = await call(b, 'POST', '/login', { email, password: pw });
  check(again.status === 200 && !again.json.twoFactorRequired && b.has('pt_sid'), 'trusted device skips the code');

  // Third browser: backup code works once; attempts are capped per challenge.
  const c: Jar = new Map();
  const l3 = await call(c, 'POST', '/login', { email, password: pw, remember: false });
  const viaBackup = await call(c, 'POST', '/login/2fa', { challenge: l3.json.challenge, code: backup[0].toUpperCase() });
  check(viaBackup.status === 200 && viaBackup.json.usedBackupCode && viaBackup.json.backupCodesRemaining === 9, 'backup code signs in');
  const sidCookie = viaBackup.setCookies.find((x) => x.startsWith('pt_sid='))!;
  check(!/Max-Age/.test(sidCookie), 'keep me signed in off → browser-session cookie');
  const persisted = queryOne<{ persistent: number; expires_at: string }>(db, `SELECT persistent, expires_at FROM sessions ORDER BY created_at DESC LIMIT 1`)!;
  check(persisted.persistent === 0 && Date.parse(persisted.expires_at) - Date.now() < 25 * 3600_000, 'short session expires within a day');
  const d: Jar = new Map();
  const l4 = await call(d, 'POST', '/login', { email, password: pw });
  check((await call(d, 'POST', '/login/2fa', { challenge: l4.json.challenge, code: backup[0] })).status === 401, 'backup code single use');
  let last = 0;
  for (let i = 0; i < 5; i++) last = (await call(d, 'POST', '/login/2fa', { challenge: l4.json.challenge, code: 'zzzzz-zzzzz' })).status;
  const capped = await call(d, 'POST', '/login/2fa', { challenge: l4.json.challenge, code: codeAt(1) });
  check(last === 401 && capped.json.code !== undefined && !d.has('pt_sid'), 'challenge locked after 5 attempts');

  // Sessions list + revoke.
  const sec = await call(a, 'GET', '/security');
  check(sec.json.twoFactor.enabled && sec.json.twoFactor.backupCodesRemaining === 9, 'security: 2FA state');
  check(sec.json.sessions.length >= 3 && sec.json.sessions.filter((s: { current: boolean }) => s.current).length === 1, 'security: sessions with current flag');
  check(sec.json.sessions.every((s: { deviceLabel: string }) => s.deviceLabel === 'Safari on macOS'), 'security: device labels');
  check(sec.json.trustedDevices.length === 1 && !sec.json.trustedDevices[0].current, 'security: trusted device (not this browser)');
  const other = sec.json.sessions.find((s: { current: boolean }) => !s.current);
  check((await call(a, 'DELETE', `/sessions/${other.id}`)).status === 200, 'revoke one session');
  const current = sec.json.sessions.find((s: { current: boolean }) => s.current);
  check((await call(a, 'DELETE', `/sessions/${current.id}`)).status === 400, 'cannot revoke current via list');
  const others = await call(a, 'POST', '/sessions/revoke-others');
  check(others.json.signedOut >= 1 && (await call(c, 'GET', '/me')).json.user === null, 'revoke others signs other browsers out');
  check((await call(a, 'GET', '/me')).json.user?.email === email, 'this browser stays signed in');

  // Revoking the trusted device brings the code back on that browser.
  check((await call(a, 'DELETE', '/trusted-devices')).json.revoked === 1, 'revoke trusted devices');
  const b2 = await call(b, 'POST', '/login', { email, password: pw });
  check(b2.json.twoFactorRequired === true, 'revoked trusted device needs the code again');

  // Regenerate backup codes, then disable (needs password + code).
  const regen = await call(a, 'POST', '/2fa/backup-codes', { password: pw, code: backup[1] });
  check(regen.status === 200 && regen.json.backupCodes.length === 10 && !regen.json.backupCodes.includes(backup[2]), 'regenerate backup codes');
  check((await call(a, 'POST', '/2fa/disable', { password: pw, code: backup[2] })).status === 403, 'old backup codes stop working');
  const off = await call(a, 'POST', '/2fa/disable', { password: pw, code: regen.json.backupCodes[0] });
  check(off.status === 200 && !off.json.twoFactor.enabled, 'disable 2FA');
  check(userRow().totp_secret_enc === null, 'secret removed on disable');
  const e: Jar = new Map();
  check((await call(e, 'POST', '/login', { email, password: pw })).json.twoFactorRequired !== true && e.has('pt_sid'), 'password-only sign-in after disable');

  // Brute force: the account locks after repeated wrong passwords, even with the right one.
  resetLoginRateLimitForTest();
  const f: Jar = new Map();
  for (let i = 0; i < MAX_FAILURES_PER_ACCOUNT; i++) await call(f, 'POST', '/login', { email, password: 'wrong-pass-1' });
  const locked = await call(f, 'POST', '/login', { email, password: pw });
  check(locked.status === 429 && locked.json.code === 'TOO_MANY_ATTEMPTS' && !f.has('pt_sid'), 'locked after repeated failures');

  // Changing the password signs out other sessions.
  resetLoginRateLimitForTest();
  const g: Jar = new Map();
  await call(g, 'POST', '/login', { email, password: pw });
  const changed = await call(a, 'POST', '/change-password', { currentPassword: pw, newPassword: 'Another-horse-7' });
  check(changed.json.signedOutSessions >= 1 && (await call(g, 'GET', '/me')).json.user === null, 'password change signs out other sessions');
} finally {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`2fa: ${passed} checks passed`);
