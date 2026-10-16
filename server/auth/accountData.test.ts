/**
 * Settings → Account: confirmed email change, "Download a copy", and what account deletion
 * removes (child rows, household traces, the data-owner role).
 * Run: npm run test:account
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-account-data-'));
process.env.DATABASE_PATH = path.join(tmp, 'portfolio.db');
delete process.env.RESEND_API_KEY;
delete process.env.INVOICE_EMAIL_FROM;
process.env.PUBLIC_URL = 'https://app.example.test';

let passed = 0;
function check(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passed++;
}

const { getDb, queryAll, queryOne, run } = await import('../db/index.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { default: authRouter } = await import('../routes/auth.ts');
const { setEmailFetchForTest } = await import('../invoices/email.ts');
const { startEmailChange, confirmEmailChange } = await import('./emailChange.ts');

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/auth', authRouter);
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
  for (const c of res.headers.getSetCookie()) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    const v = kv.slice(i + 1);
    if (v && !/Max-Age=0/.test(c)) jar.set(kv.slice(0, i), v);
    else jar.delete(kv.slice(0, i));
  }
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

const PASS = 'Test-pass-12345';
async function register(email: string, firstName: string, lastName: string) {
  const jar: Jar = new Map();
  const r = await call(jar, 'POST', '/register', { email, password: PASS, firstName, lastName });
  check(r.status === 201, `register ${email} (${r.status})`);
  return { jar, id: (r.json!.user as { id: string }).id };
}

const db = await getDb();
const now = new Date().toISOString();
const a = await register('ana@example.com', 'Ana', 'Owner');
const b = await register('bee@example.com', 'Bee', 'Tester');
const c = await register('cal@example.com', 'Cal', 'Later');
check(queryOne<{ value: string }>(db, `SELECT value FROM meta WHERE key = 'data_owner_user_id'`)?.value === a.id, 'first account is the data owner');

// ---------------------------------------------------------------- email change
// Without email sending set up, the change applies at once and the user is told so.
let me = await call(a.jar, 'GET', '/me');
check((me.json!.user as { emailChangeConfirms: boolean }).emailChangeConfirms === false, 'no email sending → no confirmation step');
let r = await call(a.jar, 'POST', '/change-email', { email: 'ana2@example.com', currentPassword: PASS });
check(r.status === 200 && (r.json!.user as { email: string }).email === 'ana2@example.com', 'immediate change without email sending');

// With email sending set up, a link goes to the new address and a notice to the current one.
process.env.RESEND_API_KEY = 're_test';
process.env.INVOICE_EMAIL_FROM = 'hello@mail.example.test';
const sent: { to: string[]; text: string }[] = [];
setEmailFetchForTest(async (_url, init) => {
  const body = JSON.parse(String(init?.body ?? '{}')) as { to: string[]; text: string };
  sent.push({ to: body.to, text: body.text });
  return { ok: true, status: 200, json: async () => ({ id: `msg_${sent.length}` }) };
});

r = await call(a.jar, 'POST', '/change-email', { email: 'ana3@example.com', currentPassword: 'wrong-pass-1' });
check(r.status === 403 && sent.length === 0, 'wrong password: nothing sent');
r = await call(a.jar, 'POST', '/change-email', { email: 'bee@example.com', currentPassword: PASS });
check(r.status === 409 && sent.length === 0, 'address in use: nothing sent');
r = await call(a.jar, 'POST', '/change-email', { email: 'ana3@example.com', currentPassword: PASS });
check(r.status === 200 && r.json!.pendingEmail === 'ana3@example.com', 'change waits for confirmation');
check(String(r.json!.message).startsWith('Check ana3@example.com to confirm.'), 'message names the new address');
check(sent.length === 2 && sent[0].to[0] === 'ana3@example.com' && sent[1].to[0] === 'ana2@example.com', 'link to new address, notice to current one');
const token = /confirm-email#token=([A-Za-z0-9_-]+)/.exec(sent[0].text)?.[1] ?? '';
check(sent[0].text.includes('https://app.example.test/confirm-email#token='), 'link uses PUBLIC_URL and a fragment token');
check(!sent[1].text.includes(token), 'the notice to the old address has no link');
me = await call(a.jar, 'GET', '/me');
check((me.json!.user as { email: string; pendingEmail: string }).email === 'ana2@example.com', 'current email still works until confirmed');
check((me.json!.user as { pendingEmail: string }).pendingEmail === 'ana3@example.com', '/me shows the pending address');
r = await call(a.jar, 'POST', '/change-email', { email: 'ana4@example.com', currentPassword: PASS });
check(r.status === 429, 'a second link within a minute is refused');

const anon: Jar = new Map();
r = await call(anon, 'POST', '/confirm-email', { token: 'x'.repeat(43) });
check(r.status === 404, 'unknown link refused');
r = await call(anon, 'POST', '/confirm-email', { token });
check(r.status === 200 && r.json!.email === 'ana3@example.com', 'link confirms, even signed out');
r = await call(anon, 'POST', '/confirm-email', { token });
check(r.status === 404, 'a link works once');
me = await call(a.jar, 'GET', '/me');
check((me.json!.user as { email: string; pendingEmail: string | null }).email === 'ana3@example.com', 'email changed after confirming');
check((me.json!.user as { pendingEmail: string | null }).pendingEmail === null, 'nothing pending after confirming');

const expired = startEmailChange(db, a.id, 'ana5@example.com', new Date(Date.now() - 25 * 3600_000));
check(confirmEmailChange(db, expired.token).ok === false, 'expired link refused');
check(!queryOne(db, `SELECT 1 AS x FROM email_changes WHERE user_id = ?`, [a.id]), 'expired change cleared');

startEmailChange(db, a.id, 'ana6@example.com', new Date(Date.now() - 120_000));
r = await call(a.jar, 'POST', '/change-email/cancel');
check(r.status === 200 && !queryOne(db, `SELECT 1 AS x FROM email_changes WHERE user_id = ?`, [a.id]), 'cancel removes the pending change');

const raced = startEmailChange(db, c.id, 'bee@example.com');
check(confirmEmailChange(db, raced.token).ok === false, 'cannot confirm an address another account took meanwhile');

setEmailFetchForTest(null);
delete process.env.RESEND_API_KEY;
delete process.env.INVOICE_EMAIL_FROM;

// ---------------------------------------------------------------- fixtures for Bee
run(db, `INSERT INTO debt_people (id, user_id, name, created_at, updated_at) VALUES ('dp_b', ?, 'Brother', ?, ?)`, [b.id, now, now]);
run(db, `INSERT INTO debt_repayments (id, person_id, amount_nzd, date, notes, created_at) VALUES ('dr_b', 'dp_b', 50, '2026-10-01', 'for the car', ?)`, [now]);
run(db, `INSERT INTO kiwisaver_accounts (id, user_id, name, created_at, updated_at) VALUES ('ks_b', ?, 'Growth', ?, ?)`, [b.id, now, now]);
run(db, `INSERT INTO kiwisaver_balance_history (id, account_id, observed_at, balance_nzd) VALUES ('kh_b', 'ks_b', ?, 1234)`, [now]);
run(db, `INSERT INTO kiwisaver_activity (id, account_id, date, description, amount_nzd, created_at) VALUES ('ka_b', 'ks_b', '2026-10-01', 'Employer', 40, ?)`, [now]);
run(db, `INSERT INTO user_entitlements (user_id, plan, updated_at) VALUES (?, 'plus', ?)`, [b.id, now]);
startEmailChange(db, b.id, 'bee2@example.com');

// ---------------------------------------------------------------- export
const exp = await call(b.jar, 'GET', '/export');
check(exp.status === 200 && /attachment; filename="koruledger-account-\d{4}-\d{2}-\d{2}\.json"/.test(exp.headers.get('content-disposition') ?? ''), 'export downloads as a JSON file');
const data = exp.json as { profile: { email: string; pendingEmail: string }; data: Record<string, Record<string, unknown>[]> };
check(data.profile.email === 'bee@example.com' && data.profile.pendingEmail === 'bee2@example.com', 'export has the profile');
check(data.data.debt_repayments.length === 1 && data.data.debt_repayments[0].notes === 'for the car', 'export includes child rows');
check(data.data.kiwisaver_balance_history.length === 1 && data.data.kiwisaver_activity.length === 1, 'export includes KiwiSaver history');
check(!exp.text.includes('scrypt$') && !/"[a-z_]*(token|hash)"\s*:/.test(exp.text) && !exp.text.includes('"user_id"'), 'export has no secrets or user_id columns');
check(!exp.text.includes('ana3@example.com') && !exp.text.includes('Ana'), 'export has nobody else’s data');
check((await call(anon, 'GET', '/export')).status === 401, 'export needs a session');

// ---------------------------------------------------------------- household traces
run(db, `INSERT INTO households (id, name, owner_id, created_at, updated_at) VALUES ('hh1', 'Home', ?, ?, ?)`, [a.id, now, now]);
run(db, `INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES ('hh1', ?, 'owner', ?), ('hh1', ?, 'adult', ?)`, [a.id, now, b.id, now]);
run(db, `INSERT INTO household_activity (id, household_id, actor_id, actor_name, action, detail, created_at) VALUES
  ('ha1', 'hh1', ?, 'Bee Tester', 'shared an account', 'Bee secret savings', ?),
  ('ha2', 'hh1', ?, 'Ana Owner', 'made Bee Tester an adult', '', ?)`, [b.id, now, a.id, now]);
run(db, `INSERT INTO household_invites (id, household_id, email, role, token_hash, invited_by, created_at, expires_at) VALUES
  ('hi1', 'hh1', 'friend@example.com', 'adult', 'h1', ?, ?, ?)`, [b.id, now, now]);

// ---------------------------------------------------------------- delete Bee (a member)
r = await call(b.jar, 'POST', '/delete-account', { password: PASS, confirm: 'DELETE' });
check(r.status === 200, 'member deletes their account');
for (const [table, where, id] of [
  ['debt_repayments', 'id', 'dr_b'],
  ['kiwisaver_balance_history', 'id', 'kh_b'],
  ['kiwisaver_activity', 'id', 'ka_b'],
  ['user_entitlements', 'user_id', b.id],
  ['email_changes', 'user_id', b.id],
] as const) {
  check(!queryOne(db, `SELECT 1 AS x FROM ${table} WHERE ${where} = ?`, [id]), `deletion removes ${table}`);
}
const activity = queryAll<{ actor_name: string; action: string; detail: string }>(db, `SELECT actor_name, action, detail FROM household_activity WHERE household_id = 'hh1'`);
const activityText = JSON.stringify(activity);
check(!activityText.includes('Bee'), 'household history no longer names them or their items');
check(activity.some((x) => x.actor_name === 'Former member'), 'their entries show as Former member');
check(activity.some((x) => x.action === 'made a former member an adult'), 'other entries refer to a former member');
check(activity.some((x) => x.action === 'A member deleted their account and left'), 'leaving is logged without a name');
check(!queryOne(db, `SELECT 1 AS x FROM household_invites WHERE id = 'hi1'`), 'their unaccepted invites are removed');

// ---------------------------------------------------------------- delete Ana (the data owner)
run(db, `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gominingBtcUsd', '65000'), ('collectableTypes', '[{"name":"Ana cards"}]')`);
const ownerLogin: Jar = new Map();
check((await call(ownerLogin, 'POST', '/login', { email: 'ana3@example.com', password: PASS })).status === 200, 'owner signs in');
r = await call(ownerLogin, 'POST', '/delete-account', { password: PASS, confirm: 'DELETE' });
check(r.status === 200, 'owner deletes their account');
check(!queryOne(db, `SELECT 1 AS x FROM meta WHERE key = 'data_owner_user_id'`), 'owner role is cleared, not passed to the next account');
check(!queryOne(db, `SELECT 1 AS x FROM app_settings WHERE key LIKE 'gomining%' OR key = 'collectableTypes'`), "owner's legacy settings removed");
check(Boolean(queryOne(db, `SELECT 1 AS x FROM users WHERE id = ?`, [c.id])), 'other accounts untouched');

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`account data tests passed (${passed} checks)`);
