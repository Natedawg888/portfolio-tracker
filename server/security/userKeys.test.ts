/**
 * Data key lifecycle (KAN-110): made and wrapped at signup, unlocked at sign-in, rewrapped on
 * password change, cleared on sign-out / revoke / expiry; accounts from before KAN-106 get a key
 * on their next sign-in; SSO accounts set and use a data-unlock passphrase; the 2FA hand-over.
 * Run: npm run test:isolation
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-userkeys-'));
process.env.DATABASE_PATH = path.join(dir, 'portfolio.db');
process.env.NODE_ENV = 'test';

const { getDb, queryAll, queryOne, run } = await import('../db/index.ts');
const { default: authRouter } = await import('../routes/auth.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { sessionKeyStore } = await import('./dataKey.ts');
const { hashPassword } = await import('../auth/passwords.ts');
const { createSession, purgeExpiredSessions, revokeOtherSessions, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { holdKeyForChallenge, takeKeyForChallenge, pendingKeyCountForTest } = await import('./userKeys.ts');

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/auth', authRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function call(method: string, p: string, cookie?: string, body?: unknown) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(`${base}/api/auth${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const setCookie = r.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`) && !c.startsWith(`${SESSION_COOKIE}=;`))?.split(';')[0];
  return { status: r.status, json: (await r.json().catch(() => null)) as Record<string, unknown> | null, cookie: setCookie };
}
const state = async (cookie: string) => (await call('GET', '/data-key', cookie)).json?.state;

try {
  const db = await getDb();
  const PW = 'correct horse battery 1';

  // Signup: key made, wrapped under the password, unlocked for the first session.
  const reg = await call('POST', '/register', undefined, { email: 'k1@example.com', password: PW, firstName: 'Kia', lastName: 'Ora' });
  assert(reg.status === 201 && reg.cookie, 'registered');
  const uid = String((reg.json?.user as { id: string }).id);
  assert(await state(reg.cookie!) === 'unlocked', 'unlocked after signup');
  const wraps = queryAll<{ kind: string; wrapped: string }>(db, `SELECT kind, wrapped FROM user_key_wraps WHERE user_id = ?`, [uid]);
  assert(wraps.length === 1 && wraps[0].kind === 'password' && wraps[0].wrapped.startsWith('dk1:argon2id:'), 'one password wrap stored');
  assert(!wraps[0].wrapped.includes(PW), 'password not in the wrap');

  // Sign-out clears; sign-in unlocks again with the same key.
  const keyBefore = Buffer.from(sessionKeyStore.forUser(uid)!);
  const sizeBefore = sessionKeyStore.size();
  await call('POST', '/logout', reg.cookie);
  assert(sessionKeyStore.size() === sizeBefore - 1 && !sessionKeyStore.forUser(uid), 'sign-out clears the key');
  const login = await call('POST', '/login', undefined, { email: 'k1@example.com', password: PW });
  assert(login.status === 200 && await state(login.cookie!) === 'unlocked', 'sign-in unlocks');
  assert(sessionKeyStore.forUser(uid)!.equals(keyBefore), 'same key after sign-in');

  // Password change rewraps; the old password no longer opens it, the new one does.
  const NEW = 'another strong pass 2';
  const ch = await call('POST', '/change-password', login.cookie, { currentPassword: PW, newPassword: NEW });
  assert(ch.status === 200, 'password changed');
  await call('POST', '/logout', login.cookie);
  const again = await call('POST', '/login', undefined, { email: 'k1@example.com', password: NEW });
  assert(await state(again.cookie!) === 'unlocked' && sessionKeyStore.forUser(uid)!.equals(keyBefore), 'new password unlocks the same key');
  assert((await call('POST', '/data-key/unlock', again.cookie, { secret: PW })).status === 403, 'old password refused for unlock');

  // Revoking other sessions and expiry clear their keys.
  const other = await call('POST', '/login', undefined, { email: 'k1@example.com', password: NEW });
  const sessions = queryAll<{ id: string }>(db, `SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at`, [uid]);
  assert(sessions.length === 2 && sessions.every((s) => sessionKeyStore.get(s.id, uid)), 'two unlocked sessions');
  revokeOtherSessions(db, uid, sessions[1].id);
  assert(!sessionKeyStore.get(sessions[0].id, uid) && sessionKeyStore.get(sessions[1].id, uid), 'revoked session key cleared');
  run(db, `UPDATE sessions SET expires_at = ? WHERE id = ?`, ['2000-01-01T00:00:00.000Z', sessions[1].id]);
  purgeExpiredSessions(db);
  assert(!sessionKeyStore.forUser(uid), 'expired session key cleared');
  void other;

  // An account from before KAN-106 (no wrap) gets its key on the next password sign-in.
  run(db, `INSERT INTO users (id, email, password_hash, first_name, last_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, ['user_old', 'old@example.com', await hashPassword(PW), 'Old', 'User', '2026-01-01', '2026-01-01']);
  const oldLogin = await call('POST', '/login', undefined, { email: 'old@example.com', password: PW });
  assert(oldLogin.status === 200 && await state(oldLogin.cookie!) === 'unlocked', 'old account unlocked');
  assert(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM user_key_wraps WHERE user_id = 'user_old'`)?.n === 1, 'old account got a wrap');

  // SSO-only account: no password, so it sets a passphrase, then unlocks with it.
  run(db, `INSERT INTO users (id, email, password_hash, first_name, last_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, ['user_sso', 'sso@example.com', '', 'Sso', 'User', '2026-01-01', '2026-01-01']);
  const ssoSession = await createSession('user_sso');
  const sc = `${SESSION_COOKIE}=${ssoSession.rawToken}`;
  assert(await state(sc) === 'needs_passphrase', 'SSO account needs a passphrase');
  assert((await call('POST', '/data-key/passphrase', sc, { passphrase: 'short' })).status === 400, 'weak passphrase refused');
  const PP = 'my long unlock phrase 9';
  assert((await call('POST', '/data-key/passphrase', sc, { passphrase: PP })).status === 200 && await state(sc) === 'unlocked', 'passphrase set, unlocked');
  const ssoKey = Buffer.from(sessionKeyStore.forUser('user_sso')!);
  const ssoSession2 = await createSession('user_sso');
  const sc2 = `${SESSION_COOKIE}=${ssoSession2.rawToken}`;
  assert(await state(sc2) === 'locked', 'next SSO sign-in starts locked');
  assert((await call('POST', '/data-key/passphrase', sc2, { passphrase: 'another long phrase 8' })).status === 409, "can't replace the passphrase while locked");
  assert((await call('POST', '/data-key/unlock', sc2, { secret: 'wrong phrase here 1' })).status === 403, 'wrong passphrase refused');
  assert((await call('POST', '/data-key/unlock', sc2, { secret: PP })).status === 200, 'right passphrase unlocks');
  assert(sessionKeyStore.get(ssoSession2.id, 'user_sso')!.equals(ssoKey), 'same key');
  assert(sessionKeyStore.get(ssoSession2.id, uid) === null, "a session's key is never returned for another user");

  // 2FA hand-over: held once, for the right user only, then gone.
  const k = Buffer.alloc(32, 7);
  holdKeyForChallenge('h1', 'u1', k);
  assert(takeKeyForChallenge('h1', 'u2') === null && pendingKeyCountForTest() === 0, 'wrong user gets nothing and the hold is dropped');
  holdKeyForChallenge('h2', 'u1', k);
  assert(takeKeyForChallenge('h2', 'u1')?.equals(k) && takeKeyForChallenge('h2', 'u1') === null, 'taken once');

  assert(!JSON.stringify(queryAll(db, `SELECT * FROM user_key_wraps`)).includes(keyBefore.toString('base64')), 'raw key never stored');
  console.log('user keys tests passed');
} finally {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
