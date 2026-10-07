/**
 * Single sign-on (Google / Microsoft / Apple) against a mock OpenID provider that signs
 * real RS256 ID tokens: PKCE, state, nonce, issuer/audience/expiry checks, account
 * linking rules, 2FA after SSO, connect/disconnect, Apple's form_post and client secret.
 * Run: npm run test:2fa
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-sso-'));
process.env.DATABASE_PATH = path.join(tmp, 'portfolio.db');
process.env.GOOGLE_CLIENT_ID = 'google-client';
process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
process.env.MICROSOFT_CLIENT_ID = 'ms-client';
process.env.MICROSOFT_CLIENT_SECRET = 'ms-secret';
const appleKey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
process.env.APPLE_CLIENT_ID = 'nz.koruledger.web';
process.env.APPLE_TEAM_ID = 'TEAM123456';
process.env.APPLE_KEY_ID = 'KEY1234567';
process.env.APPLE_PRIVATE_KEY = (appleKey.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).replace(/\n/g, '\\n');

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
let passed = 0;
const check = (cond: unknown, msg: string) => {
  assert(cond, msg);
  passed++;
};

const { getDb, queryOne } = await import('../db/index.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { default: authRouter } = await import('../routes/auth.ts');
const { default: securityRouter } = await import('../routes/security.ts');
const { default: ssoRouter } = await import('../routes/sso.ts');
const { setSsoEndpointsForTest } = await import('./sso.ts');
const { verifyIdToken, clearJwksCacheForTest } = await import('./jwt.ts');
const { NO_PASSWORD } = await import('./users.ts');
const { hotp, totpStep, base32Decode } = await import('./totp.ts');

// --- mock OpenID provider ------------------------------------------------------------------
const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rogue = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key-1';
const ISSUER = 'https://idp.test';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(claims: Record<string, unknown>, key: KeyObject = signer.privateKey, kid = KID): string {
  const input = `${b64({ alg: 'RS256', kid, typ: 'JWT' })}.${b64(claims)}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
}

type Grant = { claims: Record<string, unknown>; key?: KeyObject };
let nextGrant: Grant | null = null;
const tokenRequests: URLSearchParams[] = [];
const challenges = new Map<string, string>(); // state → code_challenge seen at authorize

const idp: Server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/jwks') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: [{ ...signer.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }] }));
    return;
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const p = new URLSearchParams(body);
      tokenRequests.push(p);
      const grant = nextGrant;
      res.writeHead(grant ? 200 : 400, { 'Content-Type': 'application/json' });
      if (!grant) return res.end(JSON.stringify({ error: 'invalid_grant' }));
      const now = Math.floor(Date.now() / 1000);
      res.end(JSON.stringify({ id_token: idToken({ iat: now, exp: now + 600, ...grant.claims }, grant.key) }));
    });
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r));
const idpBase = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
for (const id of ['google', 'microsoft', 'apple'] as const) {
  setSsoEndpointsForTest(id, { authorizeUrl: `${idpBase}/authorize`, tokenUrl: `${idpBase}/token`, jwksUrl: `${idpBase}/jwks`, issuer: ISSUER });
}

// --- app -----------------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/auth', authRouter);
app.use('/api/auth', securityRouter);
app.use('/api/auth', ssoRouter);
const server: Server = await new Promise((r) => {
  const s = app.listen(0, '127.0.0.1', () => r(s));
});
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

type Jar = Map<string, string>;
async function call(jar: Jar, method: string, p: string, body?: unknown, form = false) {
  const res = await fetch(`${origin}${p}`, {
    method,
    redirect: 'manual',
    headers: {
      'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    },
    body: body === undefined ? undefined : form ? String(body) : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie()) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    const v = kv.slice(i + 1);
    if (v && !/Max-Age=0/.test(c)) jar.set(kv.slice(0, i), v);
    else jar.delete(kv.slice(0, i));
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json: json as Record<string, any> | null, location: res.headers.get('location') };
}

/** Run the whole browser round trip; `claims` is what the provider vouches for. */
async function ssoRoundTrip(jar: Jar, provider: string, claims: (nonce: string) => Record<string, unknown>, opts: { mode?: string; state?: string; key?: KeyObject; apple?: string } = {}) {
  const start = await call(jar, 'GET', `/api/auth/sso/${provider}/start?remember=1${opts.mode ? `&mode=${opts.mode}` : ''}`);
  const auth = new URL(start.location ?? 'http://none/');
  const state = auth.searchParams.get('state') ?? '';
  const nonce = auth.searchParams.get('nonce') ?? '';
  challenges.set(state, auth.searchParams.get('code_challenge') ?? '');
  nextGrant = { claims: claims(nonce), key: opts.key };
  if (provider === 'apple') {
    const form = new URLSearchParams({ code: 'apple-code', state: opts.state ?? state, ...(opts.apple ? { user: opts.apple } : {}) });
    const post = await call(new Map(), 'POST', `/api/auth/sso/apple/callback`, form.toString(), true);
    return { start, auth, post, cb: await call(jar, 'GET', new URL(post.location!, origin).pathname + new URL(post.location!, origin).search) };
  }
  const cb = await call(jar, 'GET', `/api/auth/sso/${provider}/callback?code=c-${state.slice(0, 6)}&state=${encodeURIComponent(opts.state ?? state)}`);
  return { start, auth, cb };
}
const g = (sub: string, email: string, extra: Record<string, unknown> = {}) => (nonce: string) => ({
  iss: ISSUER,
  aud: 'google-client',
  sub,
  email,
  email_verified: true,
  given_name: 'Gia',
  family_name: 'Google',
  nonce,
  ...extra,
});
const db = await getDb();
const me = async (jar: Jar) => (await call(jar, 'GET', '/api/auth/me')).json?.user?.email ?? null;

try {
  // Providers list = configured only.
  const providers = (await call(new Map(), 'GET', '/api/auth/sso/providers')).json!.providers.map((p: { id: string }) => p.id);
  check(providers.join() === 'google,apple,microsoft', `configured providers (${providers})`);

  // New user through Google: PKCE + state + nonce, account created without a password.
  const a: Jar = new Map();
  const first = await ssoRoundTrip(a, 'google', g('g-sub-1', 'new@example.test'));
  check(first.start.status === 302 && first.auth.origin === idpBase, 'start redirects to the provider');
  check(first.auth.searchParams.get('code_challenge_method') === 'S256' && first.auth.searchParams.get('redirect_uri') === 'http://127.0.0.1:3000/api/auth/sso/google/callback', 'PKCE + redirect URI');
  const tr = tokenRequests.at(-1)!;
  check(createHash('sha256').update(tr.get('code_verifier') ?? '').digest('base64url') === challenges.get(first.auth.searchParams.get('state')!), 'code_verifier matches challenge');
  check(tr.get('client_secret') === 'google-secret' && !first.start.location!.includes('google-secret'), 'secret only sent server-to-server');
  check(first.cb.status === 303 && first.cb.location === '/register' && a.has('pt_sid'), 'new account signed in, sent to onboarding');
  check(!a.has('pt_sso'), 'flow cookie cleared');
  const newUser = queryOne<{ id: string; password_hash: string; first_name: string }>(db, `SELECT id, password_hash, first_name FROM users WHERE email = 'new@example.test'`)!;
  check(newUser.password_hash === NO_PASSWORD && newUser.first_name === 'Gia', 'created without password, name from token');

  // Same Google account again → same user (by subject, even if the email changed).
  const a2: Jar = new Map();
  await ssoRoundTrip(a2, 'google', g('g-sub-1', 'renamed@example.test'));
  check(await me(a2) === 'new@example.test', 'returning provider account → same user');

  // Forged / mismatched flows are refused.
  const bad1 = await ssoRoundTrip(new Map(), 'google', g('g-x', 'x@example.test'), { state: 'not-the-state' });
  check(bad1.cb.location === '/login?sso_error=STATE_MISMATCH', 'state mismatch');
  const noCookie = await call(new Map(), 'GET', `/api/auth/sso/google/callback?code=x&state=y`);
  check(noCookie.location === '/login?sso_error=STATE_MISSING', 'callback without the browser cookie');
  for (const [name, claims, key] of [
    ['wrong nonce', (n: string) => ({ ...g('g-x', 'x@example.test')(n), nonce: 'other' }), undefined],
    ['wrong audience', (n: string) => ({ ...g('g-x', 'x@example.test')(n), aud: 'someone-else' }), undefined],
    ['wrong issuer', (n: string) => ({ ...g('g-x', 'x@example.test')(n), iss: 'https://evil.test' }), undefined],
    ['expired', (n: string) => ({ ...g('g-x', 'x@example.test')(n), exp: Math.floor(Date.now() / 1000) - 3600 }), undefined],
    ['forged signature', g('g-x', 'x@example.test'), rogue.privateKey],
  ] as const) {
    const r = await ssoRoundTrip(new Map(), 'google', claims, { key });
    check(r.cb.location === '/login?sso_error=TOKEN_INVALID', `rejected: ${name}`);
  }
  check(!queryOne(db, `SELECT id FROM users WHERE email = 'x@example.test'`), 'no account created from rejected tokens');
  const cancelled = await (async () => {
    const jar: Jar = new Map();
    const s = await call(jar, 'GET', '/api/auth/sso/google/start');
    const st = new URL(s.location!).searchParams.get('state')!;
    return call(jar, 'GET', `/api/auth/sso/google/callback?error=access_denied&state=${st}`);
  })();
  check(cancelled.location === '/login?sso_error=CANCELLED', 'user cancelled at provider');

  // Existing password account: unverified email can't take it over; verified links.
  const pw = 'Password-account-1';
  await call(new Map(), 'POST', '/api/auth/register', { email: 'owner@example.test', password: pw, firstName: 'Own', lastName: 'Er' });
  const unv = await ssoRoundTrip(new Map(), 'google', g('g-sub-2', 'owner@example.test', { email_verified: false }));
  check(unv.cb.location === '/login?sso_error=ACCOUNT_EXISTS', 'unverified email does not link');
  const ver: Jar = new Map();
  await ssoRoundTrip(ver, 'google', g('g-sub-2', 'owner@example.test'));
  check(await me(ver) === 'owner@example.test', 'verified email links to the existing account');

  // Microsoft: issuer must name the token's tenant; work emails need xms_edov to link.
  const tid = '11111111-2222-3333-4444-555555555555';
  setSsoEndpointsForTest('microsoft', { authorizeUrl: `${idpBase}/authorize`, tokenUrl: `${idpBase}/token`, jwksUrl: `${idpBase}/jwks` });
  const ms = (extra: Record<string, unknown>) => (nonce: string) => ({ iss: `https://login.microsoftonline.com/${tid}/v2.0`, tid, aud: 'ms-client', sub: 'ms-1', email: 'owner@example.test', name: 'Own Er', nonce, ...extra });
  check((await ssoRoundTrip(new Map(), 'microsoft', ms({}))).cb.location === '/login?sso_error=ACCOUNT_EXISTS', 'microsoft work email unverified → no link');
  check((await ssoRoundTrip(new Map(), 'microsoft', ms({ iss: 'https://login.microsoftonline.com/other/v2.0' }))).cb.location === '/login?sso_error=TOKEN_INVALID', 'microsoft issuer must match tid');
  const msJar: Jar = new Map();
  await ssoRoundTrip(msJar, 'microsoft', ms({ xms_edov: true }));
  check(await me(msJar) === 'owner@example.test', 'microsoft verified-domain email links');

  // 2FA still applies after SSO.
  const owner: Jar = new Map();
  await call(owner, 'POST', '/api/auth/login', { email: 'owner@example.test', password: pw });
  const setup = await call(owner, 'POST', '/api/auth/2fa/setup', { password: pw });
  const secret = base32Decode(setup.json!.secret)!;
  await call(owner, 'POST', '/api/auth/2fa/enable', { code: hotp(secret, totpStep()) });
  const sso2: Jar = new Map();
  const two = await ssoRoundTrip(sso2, 'google', g('g-sub-2', 'owner@example.test'));
  check(two.cb.location!.startsWith('/login#sso2fa=') && !sso2.has('pt_sid'), 'SSO with 2FA → code step, no session yet');
  const challenge = decodeURIComponent(two.cb.location!.split('#sso2fa=')[1]);
  const fin = await call(sso2, 'POST', '/api/auth/login/2fa', { challenge, code: hotp(secret, totpStep() + 1) });
  check(fin.status === 200 && await me(sso2) === 'owner@example.test', 'code completes SSO sign-in');

  // Connect from Settings (mode=link) + identity already used by someone else.
  const linker: Jar = new Map();
  await call(linker, 'POST', '/api/auth/register', { email: 'linker@example.test', password: pw, firstName: 'Lin', lastName: 'Ker' });
  const link = await ssoRoundTrip(linker, 'google', g('g-sub-3', 'personal@gmail.test'), { mode: 'link' });
  check(link.cb.location === '/settings?tab=security&sso_linked=google', 'link redirects back to Security');
  const sec = await call(linker, 'GET', '/api/auth/security');
  check(sec.json!.identities.length === 1 && sec.json!.identities[0].email === 'personal@gmail.test' && sec.json!.hasPassword === true, 'security lists connected provider');
  const taken = await ssoRoundTrip(linker, 'google', g('g-sub-1', 'new@example.test'), { mode: 'link' });
  check(taken.cb.location === '/settings?tab=security&sso_error=IDENTITY_IN_USE', 'cannot link a provider account owned by another user');
  check((await call(new Map(), 'GET', '/api/auth/sso/google/start?mode=link')).location === '/login?sso_error=SIGN_IN_FIRST', 'link needs a session');

  // Disconnect: an SSO-only account can't remove its last way in until it sets a password.
  const onlySso = (await call(a2, 'GET', '/api/auth/security')).json!;
  check(onlySso.hasPassword === false, 'SSO-only account has no password');
  check((await call(a2, 'DELETE', `/api/auth/identities/${onlySso.identities[0].id}`)).status === 409, 'last sign-in method protected');
  check((await call(a2, 'POST', '/api/auth/change-password', { newPassword: 'First-password-1' })).status === 200, 'SSO-only account sets a first password');
  check((await call(a2, 'DELETE', `/api/auth/identities/${onlySso.identities[0].id}`)).status === 200, 'then it can disconnect');
  check((await call(new Map(), 'POST', '/api/auth/login', { email: 'new@example.test', password: 'First-password-1' })).json!.user, 'and sign in with the password');

  // Apple: form_post → 303 GET; client secret is an ES256 JWT; name arrives outside the token.
  const appleJar: Jar = new Map();
  const ap = await ssoRoundTrip(
    appleJar,
    'apple',
    (nonce) => ({ iss: ISSUER, aud: 'nz.koruledger.web', sub: 'apple-1', email: 'relay@privaterelay.appleid.test', email_verified: 'true', nonce }),
    { apple: JSON.stringify({ name: { firstName: 'Ada', lastName: 'Apple' }, email: 'relay@privaterelay.appleid.test' }) },
  );
  check(ap.post!.status === 303 && ap.post!.location!.startsWith('/api/auth/sso/apple/callback?'), 'Apple POST re-issued as GET');
  check(ap.auth.searchParams.get('response_mode') === 'form_post' && !ap.auth.searchParams.has('code_challenge'), 'Apple uses form_post, no PKCE');
  check(ap.cb.location === '/register' && await me(appleJar) === 'relay@privaterelay.appleid.test', 'Apple sign-up');
  check(queryOne<{ first_name: string }>(db, `SELECT first_name FROM users WHERE email = 'relay@privaterelay.appleid.test'`)?.first_name === 'Ada', 'Apple name from first consent');
  const secretJwt = tokenRequests.at(-1)!.get('client_secret')!;
  const [h, pl, sg] = secretJwt.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(pl, 'base64url').toString());
  check(header.alg === 'ES256' && header.kid === 'KEY1234567' && payload.iss === 'TEAM123456' && payload.sub === 'nz.koruledger.web' && payload.aud === 'https://appleid.apple.com', 'Apple client secret claims');
  check(verify('sha256', Buffer.from(`${h}.${pl}`), { key: appleKey.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sg, 'base64url')), 'Apple client secret signature');

  // JWKS: unknown kid → one refetch, then reject.
  clearJwksCacheForTest();
  let fetches = 0;
  const fetcher = async () => {
    fetches++;
    return { keys: [{ ...signer.publicKey.export({ format: 'jwk' }), kid: KID }] };
  };
  const now = Math.floor(Date.now() / 1000);
  const base = { iss: ISSUER, aud: 'x', sub: 's', iat: now, exp: now + 60 };
  await verifyIdToken(idToken(base), { jwksUrl: 'mem://a', issuer: ISSUER, audience: 'x', fetcher });
  await verifyIdToken(idToken(base), { jwksUrl: 'mem://a', issuer: ISSUER, audience: 'x', fetcher });
  check(fetches === 1, 'signing keys cached');
  let unknownKid = false;
  try {
    await verifyIdToken(idToken(base, signer.privateKey, 'rotated'), { jwksUrl: 'mem://a', issuer: ISSUER, audience: 'x', fetcher });
  } catch {
    unknownKid = true;
  }
  check(unknownKid && fetches === 2, 'unknown key id refetches once then rejects');
} finally {
  server.close();
  idp.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`sso: ${passed} checks passed`);
