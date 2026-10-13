/**
 * Passkeys (KAN-75): registration and sign-in through the real routes and the real
 * @simplewebauthn/server checks, using a software authenticator (ES256 key, "none"
 * attestation). Covers challenge reuse and expiry, user isolation, revocation, the
 * audit log, re-auth for adding a passkey, and rate limiting.
 * Run: npm run test:passkeys
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { isoBase64URL, isoCBOR, isoUint8Array } from '@simplewebauthn/server/helpers';

const dbPath = path.join(os.tmpdir(), `pt-passkeys-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
const ORIGIN = 'http://localhost:5173';
process.env.PUBLIC_URL = ORIGIN;
delete process.env.WEBAUTHN_RP_ID;
delete process.env.WEBAUTHN_ORIGINS;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryOne, queryAll } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('./sessions.ts');
const { resetLoginRateLimitForTest } = await import('./loginRateLimit.ts');
const { attachUser } = await import('../middleware/requireAuth.ts');
const { default: authRouter } = await import('../routes/auth.ts');
const { default: securityRouter } = await import('../routes/security.ts');
const { default: passkeysRouter } = await import('../routes/passkeys.ts');

const db = await getDb();
const now = new Date().toISOString();
for (const [id, email] of [['pk_user_a', 'a@example.com'], ['pk_user_b', 'b@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?,?,?,?,?,?)`, [id, email, 'hash', id === 'pk_user_a' ? 'Alex' : 'Bo', now, now]);
}

const app = express();
app.set('trust proxy', false);
app.use(express.json());
app.use('/api', attachUser);
app.use('/api/auth', authRouter);
app.use('/api/auth', securityRouter);
app.use('/api/auth', passkeysRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
type Json = Record<string, any>;
async function call(method: string, p: string, cookie?: string, body?: unknown, origin = ORIGIN) {
  const headers: Record<string, string> = { Accept: 'application/json', Origin: origin };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json, setCookie: res.headers.get('set-cookie') };
}
const cookieOf = (raw: string) => `${SESSION_COOKIE}=${raw}`;

// ── Software authenticator ────────────────────────────────────────────────────
type Authenticator = { credentialId: Uint8Array; privateKey: KeyObject; cose: Uint8Array; counter: number; userHandle: string };
const b64 = (u: Uint8Array) => isoBase64URL.fromBuffer(u);
const sha256 = (data: Uint8Array) => new Uint8Array(createHash('sha256').update(data).digest());
const FLAGS = { UP: 0x01, UV: 0x04, AT: 0x40 };

function newAuthenticator(userId: string): Authenticator {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, isoBase64URL.toBuffer(jwk.x)],
      [-3, isoBase64URL.toBuffer(jwk.y)],
    ]),
  );
  return { credentialId: new Uint8Array(randomBytes(32)), privateKey, cose, counter: 0, userHandle: b64(isoUint8Array.fromUTF8String(userId)) };
}

function clientData(type: string, challenge: string, origin = ORIGIN): string {
  return b64(isoUint8Array.fromUTF8String(JSON.stringify({ type, challenge, origin, crossOrigin: false })));
}

function counterBytes(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function registrationResponse(a: Authenticator, challenge: string, opts: { origin?: string; uv?: boolean } = {}) {
  const idLen = new Uint8Array([(a.credentialId.length >> 8) & 0xff, a.credentialId.length & 0xff]);
  const authData = isoUint8Array.concat([
    sha256(isoUint8Array.fromUTF8String('localhost')),
    new Uint8Array([FLAGS.UP | (opts.uv === false ? 0 : FLAGS.UV) | FLAGS.AT]),
    counterBytes(0),
    new Uint8Array(16), // aaguid
    idLen,
    a.credentialId,
    a.cose,
  ]);
  const attestationObject = isoCBOR.encode(
    new Map<string, unknown>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData],
    ]) as never,
  );
  const id = b64(a.credentialId);
  return {
    id,
    rawId: id,
    type: 'public-key',
    response: { clientDataJSON: clientData('webauthn.create', challenge, opts.origin), attestationObject: b64(attestationObject), transports: ['internal'] },
    clientExtensionResults: {},
  };
}

function assertionResponse(a: Authenticator, challenge: string, opts: { origin?: string; key?: KeyObject; userHandle?: string } = {}) {
  a.counter += 1;
  const authData = isoUint8Array.concat([sha256(isoUint8Array.fromUTF8String('localhost')), new Uint8Array([FLAGS.UP | FLAGS.UV]), counterBytes(a.counter)]);
  const cd = clientData('webauthn.get', challenge, opts.origin);
  const signature = sign('sha256', isoUint8Array.concat([authData, sha256(isoBase64URL.toBuffer(cd))]), opts.key ?? a.privateKey);
  const id = b64(a.credentialId);
  return {
    id,
    rawId: id,
    type: 'public-key',
    response: { clientDataJSON: cd, authenticatorData: b64(authData), signature: b64(new Uint8Array(signature)), userHandle: opts.userHandle ?? a.userHandle },
    clientExtensionResults: {},
  };
}

try {
  const A = cookieOf((await createSession('pk_user_a')).rawToken);
  const B = cookieOf((await createSession('pk_user_b')).rawToken);

  // ── Registration ──
  assert((await call('POST', '/api/auth/passkeys/register/options')).status === 401, 'signed out cannot add a passkey');
  const regOpts = await call('POST', '/api/auth/passkeys/register/options', A, {});
  assert(regOpts.status === 200 && typeof regOpts.json.challenge === 'string', 'registration options');
  assert(regOpts.json.rp.id === 'localhost' && regOpts.json.authenticatorSelection.userVerification === 'required', 'rp id from PUBLIC_URL; user verification required');
  assert(regOpts.json.authenticatorSelection.residentKey === 'required', 'discoverable passkey');
  const phone = newAuthenticator('pk_user_a');
  const regResponse = registrationResponse(phone, regOpts.json.challenge);
  const reg = await call('POST', '/api/auth/passkeys/register/verify', A, { response: regResponse, name: '  Alex’s   phone ' });
  assert(reg.status === 201 && reg.json.name === 'Alex’s phone', `passkey saved with a tidied name (${reg.status} ${JSON.stringify(reg.json)})`);
  const passkeyId = reg.json.id as string;
  const replayReg = await call('POST', '/api/auth/passkeys/register/verify', A, { response: regResponse });
  assert(replayReg.status === 400 && replayReg.json.code === 'CHALLENGE_INVALID', 'a registration challenge works once');

  // Someone else's registration challenge can't be used, and is spent by the attempt.
  const aOpts = await call('POST', '/api/auth/passkeys/register/options', A, {});
  const stolen = await call('POST', '/api/auth/passkeys/register/verify', B, { response: registrationResponse(newAuthenticator('pk_user_b'), aOpts.json.challenge) });
  assert(stolen.status === 400 && stolen.json.code === 'CHALLENGE_INVALID', 'B cannot use A’s registration challenge');
  const afterSteal = await call('POST', '/api/auth/passkeys/register/verify', A, { response: registrationResponse(newAuthenticator('pk_user_a'), aOpts.json.challenge) });
  assert(afterSteal.status === 400, 'and the challenge is spent by the failed attempt');

  // Without user verification the library rejects it.
  const noUvOpts = await call('POST', '/api/auth/passkeys/register/options', A, {});
  const noUv = await call('POST', '/api/auth/passkeys/register/verify', A, { response: registrationResponse(newAuthenticator('pk_user_a'), noUvOpts.json.challenge, { uv: false }) });
  assert(noUv.status === 400 && noUv.json.code === 'NOT_VERIFIED', 'user verification is required');

  // The same credential can't be registered twice.
  const dupOpts = await call('POST', '/api/auth/passkeys/register/options', A, {});
  const dup = await call('POST', '/api/auth/passkeys/register/verify', A, { response: registrationResponse(phone, dupOpts.json.challenge) });
  assert(dup.status === 409, 'a credential is registered once');

  // ── Sign-in ──
  const loginOpts = await call('POST', '/api/auth/passkeys/login/options', undefined, { remember: true });
  assert(loginOpts.status === 200 && loginOpts.json.userVerification === 'required', 'sign-in options');
  assert(!loginOpts.json.allowCredentials || loginOpts.json.allowCredentials.length === 0, 'discoverable: no account hints in the options');
  const assertion = assertionResponse(phone, loginOpts.json.challenge);
  const login = await call('POST', '/api/auth/passkeys/login/verify', undefined, { response: assertion });
  assert(login.status === 200 && login.json.user?.id === 'pk_user_a' && login.json.user?.email === 'a@example.com', `signed in as A (${login.status} ${JSON.stringify(login.json)})`);
  assert(login.setCookie?.includes(`${SESSION_COOKIE}=`), 'session cookie set');
  const passkeySessionCookie = cookieOf(/pt_sid=([^;]+)/.exec(login.setCookie ?? '')![1]);
  assert((await call('GET', '/api/auth/me', passkeySessionCookie)).json.user?.id === 'pk_user_a', 'the new session works');
  const stored = queryOne<{ counter: number; last_used_at: string | null }>(db, `SELECT counter, last_used_at FROM user_passkeys WHERE id = ?`, [passkeyId]);
  assert(stored?.counter === 1 && stored.last_used_at, 'counter and last used updated');
  assert(queryOne(db, `SELECT id FROM sessions WHERE passkey_id = ?`, [passkeyId]), 'session remembers its passkey');

  const replay = await call('POST', '/api/auth/passkeys/login/verify', undefined, { response: assertion });
  assert(replay.status === 401 && replay.json.code === 'CHALLENGE_INVALID', 'a sign-in challenge works once (replay rejected)');

  const expiredOpts = await call('POST', '/api/auth/passkeys/login/options', undefined, {});
  run(db, `UPDATE webauthn_challenges SET expires_at = ? WHERE challenge = ?`, [new Date(Date.now() - 1000).toISOString(), expiredOpts.json.challenge]);
  const expired = await call('POST', '/api/auth/passkeys/login/verify', undefined, { response: assertionResponse(phone, expiredOpts.json.challenge) });
  assert(expired.status === 401 && expired.json.code === 'CHALLENGE_INVALID', 'an expired challenge is rejected');

  const forgedOpts = await call('POST', '/api/auth/passkeys/login/options', undefined, {});
  const otherKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  const forged = await call('POST', '/api/auth/passkeys/login/verify', undefined, { response: assertionResponse(phone, forgedOpts.json.challenge, { key: otherKey }) });
  assert(forged.status === 401 && forged.json.code === 'NOT_VERIFIED', 'a wrong signature is rejected');

  const evilOpts = await call('POST', '/api/auth/passkeys/login/options', undefined, {});
  const evil = await call('POST', '/api/auth/passkeys/login/verify', undefined, { response: assertionResponse(phone, evilOpts.json.challenge, { origin: 'https://evil.example' }) });
  assert(evil.status === 401 && evil.json.code === 'NOT_VERIFIED', 'another origin is rejected');

  const handleOpts = await call('POST', '/api/auth/passkeys/login/options', undefined, {});
  const wrongHandle = await call('POST', '/api/auth/passkeys/login/verify', undefined, {
    response: assertionResponse(phone, handleOpts.json.challenge, { userHandle: b64(isoUint8Array.fromUTF8String('pk_user_b')) }),
  });
  assert(wrongHandle.status === 401, 'a passkey cannot claim another account');

  // ── Isolation ──
  assert((await call('GET', '/api/auth/security', B)).json.passkeys.length === 0, 'B sees none of A’s passkeys');
  assert((await call('PATCH', `/api/auth/passkeys/${passkeyId}`, B, { name: 'Mine' })).status === 404, 'B cannot rename A’s passkey');
  assert((await call('DELETE', `/api/auth/passkeys/${passkeyId}`, B)).status === 404, 'B cannot remove A’s passkey');
  const sec = (await call('GET', '/api/auth/security', A)).json;
  assert(sec.passkeys.length === 1 && sec.passkeys[0].lastUsedAt, 'A sees their passkey with last used');
  assert(sec.recentSignIns.some((e: Json) => e.kind === 'sign_in' && e.method === 'passkey'), 'audit log has the passkey sign-in');
  assert(sec.recentSignIns.some((e: Json) => e.kind === 'passkey_added'), 'audit log has the passkey being added');
  assert((await call('GET', '/api/auth/security', B)).json.recentSignIns.length === 0, 'B’s audit log is their own');
  assert((await call('PATCH', `/api/auth/passkeys/${passkeyId}`, A, { name: 'Work laptop' })).json.name === 'Work laptop', 'rename');

  // ── Re-auth before adding a passkey on an older session ──
  const oldSession = await createSession('pk_user_a');
  run(db, `UPDATE sessions SET created_at = ? WHERE id = ?`, [new Date(Date.now() - 60 * 60 * 1000).toISOString(), oldSession.id]);
  const old = await call('POST', '/api/auth/passkeys/register/options', cookieOf(oldSession.rawToken), {});
  assert(old.status === 403 && old.json.code === 'REAUTH_REQUIRED', 'an hour-old session must confirm the password');

  // ── Revocation ──
  const removed = await call('DELETE', `/api/auth/passkeys/${passkeyId}`, A);
  assert(removed.status === 200 && removed.json.sessionsEnded === 1, 'removing the passkey ends the session it opened');
  assert((await call('GET', '/api/auth/me', passkeySessionCookie)).json.user == null, 'that session no longer works');
  assert((await call('GET', '/api/auth/me', A)).json.user?.id === 'pk_user_a', 'the session that removed it keeps working');
  const goneOpts = await call('POST', '/api/auth/passkeys/login/options', undefined, {});
  const gone = await call('POST', '/api/auth/passkeys/login/verify', undefined, { response: assertionResponse(phone, goneOpts.json.challenge) });
  assert(gone.status === 401 && gone.json.code === 'UNKNOWN_PASSKEY', 'a removed passkey cannot sign in');
  assert((await call('GET', '/api/auth/security', A)).json.recentSignIns.some((e: Json) => e.kind === 'passkey_removed'), 'audit log has the removal');

  // ── Rate limit ──
  resetLoginRateLimitForTest();
  let limited = false;
  for (let i = 0; i < 12; i += 1) {
    const r = await call('POST', '/api/auth/passkeys/login/verify', undefined, { response: { id: 'x', response: { clientDataJSON: 'bad' } } });
    if (r.status === 429) limited = true;
  }
  assert(limited, 'repeated failures are rate limited');
  assert((await call('POST', '/api/auth/passkeys/login/options', undefined, {})).status === 429, 'options are limited too');
  resetLoginRateLimitForTest();

  // Challenges left behind expire; none outlive their 5 minutes.
  const live = queryAll<{ expires_at: string }>(db, `SELECT expires_at FROM webauthn_challenges`);
  assert(live.every((r) => Date.parse(r.expires_at) - Date.now() <= 5 * 60 * 1000 + 1000), 'challenges expire within 5 minutes');

  console.log('passkey tests ok');
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  for (const suffix of ['', '.tmp', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
