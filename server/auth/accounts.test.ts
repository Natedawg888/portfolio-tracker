/**
 * Account switcher: several accounts signed in on one browser.
 * Run: npm run test:2fa
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-accounts-'));
process.env.DATABASE_PATH = path.join(tmp, 'portfolio.db');

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
async function call(jar: Jar, method: string, p: string, body?: unknown) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
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

const pw = 'Switch-accounts-1';
const me = async (jar: Jar) => (await call(jar, 'GET', '/me')).json.user?.email ?? null;
const accounts = async (jar: Jar) =>
  ((await call(jar, 'GET', '/accounts')).json.accounts as Array<{ userId: string; email: string; current: boolean }>);

try {
  const browser: Jar = new Map();
  // Register A, then B and C on the same browser (as "Add another account" would).
  const a = await call(browser, 'POST', '/register', { email: 'a@example.test', password: pw, firstName: 'Ana', lastName: 'A' });
  check(a.status === 201 && !browser.has('pt_accts'), 'first account: no remembered list');
  await call(browser, 'POST', '/register', { email: 'b@example.test', password: pw, firstName: 'Ben', lastName: 'B' });
  const add = await call(browser, 'POST', '/register', { email: 'c@example.test', password: pw, firstName: 'Cy', lastName: 'C' });
  check(await me(browser) === 'c@example.test', 'newest account is active');
  const acctCookie = add.setCookies.find((c) => c.startsWith('pt_accts='))!;
  check(acctCookie.includes('Path=/api/auth') && acctCookie.includes('HttpOnly'), 'remembered list is httpOnly + scoped to /api/auth');
  const list = await accounts(browser);
  check(list.map((x) => x.email).join() === 'c@example.test,b@example.test,a@example.test', `accounts: active first (${list.map((x) => x.email)})`);
  check(list.filter((x) => x.current).length === 1 && list[0].current, 'one current account');

  // Switch to A: A active, C goes back into the list.
  const aId = list.find((x) => x.email === 'a@example.test')!.userId;
  check((await call(browser, 'POST', '/accounts/switch', { userId: aId })).status === 200, 'switch ok');
  check(await me(browser) === 'a@example.test', 'switched to A');
  check((await accounts(browser)).map((x) => x.email).join() === 'a@example.test,c@example.test,b@example.test', 'previous active remembered');
  check((await call(browser, 'POST', '/accounts/switch', { userId: 'user_nope' })).status === 404, 'unknown account → 404');

  // Signing A in again on this browser replaces A's session, not duplicates it.
  const sessionsBefore = Number(queryOne<{ c: number }>(await getDb(), 'SELECT COUNT(*) AS c FROM sessions')?.c);
  await call(browser, 'POST', '/login', { email: 'a@example.test', password: pw });
  const sessionsAfter = Number(queryOne<{ c: number }>(await getDb(), 'SELECT COUNT(*) AS c FROM sessions')?.c);
  check(sessionsAfter === sessionsBefore, 'same-account sign-in replaces its old session');
  check((await accounts(browser)).length === 3, 'still three accounts');

  // A revoked remembered session disappears from the list and can't be switched to.
  const bId = (await accounts(browser)).find((x) => x.email === 'b@example.test')!.userId;
  const elsewhere: Jar = new Map();
  await call(elsewhere, 'POST', '/login', { email: 'b@example.test', password: pw });
  await call(elsewhere, 'POST', '/change-password', { currentPassword: pw, newPassword: 'Switch-accounts-2' });
  check((await call(browser, 'POST', '/accounts/switch', { userId: bId })).status === 404, 'revoked session can’t be switched to');
  check(!(await accounts(browser)).some((x) => x.email === 'b@example.test'), 'revoked account dropped from list');

  // Sign out of the active account → the next one takes over.
  const out = await call(browser, 'POST', '/logout');
  check(out.json.switchedToUserId && (await me(browser)) === 'c@example.test', 'sign out hands over to the next account');
  check((await accounts(browser)).length === 1, 'one account left');

  // Sign out of everything.
  await call(browser, 'POST', '/register', { email: 'd@example.test', password: pw, firstName: 'Di', lastName: 'D' });
  const all = await call(browser, 'POST', '/logout-all');
  check(all.json.signedOut === 2 && (await me(browser)) === null && !browser.has('pt_accts'), 'sign out of all accounts');
  const live = Number(
    queryOne<{ c: number }>(await getDb(), `SELECT COUNT(*) AS c FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email IN ('c@example.test','d@example.test')`)?.c,
  );
  check(live === 0, 'their sessions are gone server-side');
  check((await call(browser, 'POST', '/logout')).json.switchedToUserId === null, 'logout with nothing left is a no-op');
} finally {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`accounts: ${passed} checks passed`);
