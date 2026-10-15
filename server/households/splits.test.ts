/**
 * Household splits and settle-up API (KAN-77 phase 3): who can split what, the three split
 * methods, one split per transaction, editing and removing, payments, balances and suggested
 * payments, a member who leaves keeping their balance, and deleting the household.
 * Run: npm run test:household
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-hh-splits-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');
process.env.AUTH_ENCRYPTION_KEY = 'd'.repeat(64);
process.env.PLAN_PLUS_EMAILS = 'olive@example.com';
delete process.env.RESEND_API_KEY;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryAll } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { aucklandToday } = await import('../debts/model.ts');
const { default: householdRouter } = await import('../routes/household.ts');

const now = '2026-10-05T00:00:00.000Z';
const day = `${aucklandToday().slice(0, 7)}-03`;
const db = await getDb();
for (const [id, first] of [['olive', 'Olive'], ['adam', 'Adam'], ['vic', 'Vic'], ['sam', 'Sam']]) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, last_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, [id, `${id}@example.com`, 'h', first, 'Smith', now, now]);
}
for (const [id, user] of [['acct_o', 'olive'], ['acct_a', 'adam'], ['acct_private', 'adam'], ['acct_s', 'sam']]) {
  run(db, `INSERT INTO bank_accounts (id, user_id, name, account_type, currency, balance, created_at, updated_at) VALUES (?,?,?, 'cheque', 'NZD', 100, ?, ?)`, [id, user, id, now, now]);
}
const txn = (id: string, user: string, account: string, amount: number, desc: string) =>
  run(db, `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, currency, source, created_at) VALUES (?,?,?,?,?,?,?, 'NZD', 'manual', ?)`, [id, user, account, day, desc, amount, amount < 0 ? 'debit' : 'credit', now]);
txn('t_groceries', 'olive', 'acct_o', -84.2, 'Pak n Save');
txn('t_power', 'adam', 'acct_a', -186.4, 'Mercury');
txn('t_dinner', 'olive', 'acct_o', -60, 'Dinner');
txn('t_refund', 'olive', 'acct_o', 25, 'Refund');
txn('t_private', 'adam', 'acct_private', -50, 'Private');

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/household', householdRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/household`;
type Json = Record<string, any>;
async function call(method: string, p: string, cookie: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { Accept: 'application/json', Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}
const bal = (v: Json) => Object.fromEntries(v.balances.map((b: Json) => [b.memberId, b.netNzd]));

try {
  const C = Object.fromEntries(await Promise.all(['olive', 'adam', 'vic', 'sam'].map(async (u) => [u, `${SESSION_COOKIE}=${(await createSession(u)).rawToken}`])));
  await call('POST', '/', C.olive, { name: 'Home' });
  for (const [who, role] of [['adam', 'adult'], ['vic', 'viewer']]) {
    const inv = await call('POST', '/invites', C.olive, { email: `${who}@example.com`, role });
    await call('POST', '/invites/accept', C[who], { token: inv.json.invite.link.split('#token=')[1] });
  }
  for (const [who, acct] of [['olive', 'acct_o'], ['adam', 'acct_a']]) await call('PUT', '/shares', C[who], { kind: 'account', itemId: acct, shared: true });

  // Who can split what.
  const split = (who: string, transactionId: string, method: string, shares: Json[]) => call('POST', '/splits', C[who], { transactionId, method, shares });
  const two = [{ memberId: 'olive' }, { memberId: 'adam' }];
  assert((await split('vic', 't_groceries', 'equal', two)).status === 403, 'a viewer can’t split');
  assert((await split('sam', 't_groceries', 'equal', two)).status === 404, 'a stranger can’t split');
  assert((await split('adam', 't_private', 'equal', two)).status === 404, 'an unshared account’s spending can’t be split');
  assert((await split('olive', 't_refund', 'equal', two)).status === 404, 'money in can’t be split');
  assert((await split('olive', 't_groceries', 'equal', [{ memberId: 'olive' }, { memberId: 'sam' }])).status === 400, 'only household members');

  // 50/50: Adam owes Olive 42.10.
  let r = await split('adam', 't_groceries', 'equal', two);
  assert(r.status === 201, 'an adult splits Olive’s groceries 50/50');
  let s = r.json.splits[0];
  assert(s.payer === 'Olive Smith' && s.totalNzd === 84.2 && s.shares.map((x: Json) => x.amountNzd).join() === '42.1,42.1', '50/50 shares');
  assert(bal(r.json).olive === 42.1 && bal(r.json).adam === -42.1 && bal(r.json).vic === 0, 'Adam owes Olive $42.10');
  assert((await split('olive', 't_groceries', 'equal', two)).status === 409, 'one split per transaction');

  // By percent: Adam's power bill 60 / 30 / 10.
  r = await split('olive', 't_power', 'percent', [{ memberId: 'olive', value: 60 }, { memberId: 'adam', value: 30 }, { memberId: 'vic', value: 10 }]);
  assert(r.status === 201, 'split by percent');
  const power = r.json.splits.find((x: Json) => x.transactionId === 't_power');
  const share = (sp: Json, id: string) => sp.shares.find((x: Json) => x.memberId === id);
  assert(share(power, 'olive').amountNzd === 111.84 && share(power, 'adam').amountNzd === 55.92 && share(power, 'vic').amountNzd === 18.64 && share(power, 'olive').input === 60, 'percent shares, inputs kept');
  // Olive: +42.10 − 111.84 = −69.74; Adam: −42.10 + 111.84 + 18.64 = 88.38; Vic: −18.64.
  let b = bal(r.json);
  assert(b.olive === -69.74 && b.adam === 88.38 && b.vic === -18.64, `balances after two splits ${JSON.stringify(b)}`);
  assert(Math.round((b.olive + b.adam + b.vic) * 100) === 0, 'balances sum to zero');

  // By amount, with validation.
  assert((await split('olive', 't_dinner', 'amount', [{ memberId: 'olive', value: 50 }, { memberId: 'adam', value: 5 }])).status === 400, 'amounts must add up');
  r = await split('olive', 't_dinner', 'amount', [{ memberId: 'olive', value: 20 }, { memberId: 'adam', value: 40 }]);
  assert(r.status === 201 && bal(r.json).adam === 48.38 && bal(r.json).olive === -29.74, 'by amount: Adam owes 40 more');

  // Edit and remove.
  const dinner = r.json.splits.find((x: Json) => x.transactionId === 't_dinner');
  assert((await call('PUT', `/splits/${dinner.id}`, C.vic, { method: 'equal', shares: two })).status === 403, 'a viewer can’t change a split');
  r = await call('PUT', `/splits/${dinner.id}`, C.adam, { method: 'equal', shares: two });
  assert(r.status === 200 && bal(r.json).adam === 58.38, 'changed to 50/50');
  r = await call('DELETE', `/splits/${dinner.id}`, C.olive);
  assert(r.status === 200 && r.json.splits.length === 2 && bal(r.json).adam === 88.38, 'removed; balances back');

  // Suggested payments, then settle.
  const sug = r.json.suggestions.map((p: Json) => `${p.fromId}->${p.toId}:${p.amountNzd}`);
  assert(sug.join() === 'olive->adam:69.74,vic->adam:18.64', `suggested payments ${sug}`);
  assert((await call('POST', '/settlements', C.vic, { fromId: 'olive', toId: 'adam', amountNzd: 69.74 })).status === 403, 'a viewer can’t record a payment');
  assert((await call('POST', '/settlements', C.olive, { fromId: 'olive', toId: 'olive', amountNzd: 5 })).status === 400, 'not to yourself');
  assert((await call('POST', '/settlements', C.olive, { fromId: 'olive', toId: 'adam', amountNzd: 0 })).status === 400, 'amount checked');
  r = await call('POST', '/settlements', C.olive, { fromId: 'olive', toId: 'adam', amountNzd: 69.74, note: 'Bank transfer' });
  assert(r.status === 201 && bal(r.json).olive === 0 && bal(r.json).adam === 18.64, 'Olive settled');
  assert(r.json.suggestions.length === 1 && r.json.suggestions[0].fromId === 'vic', 'only Vic left to pay');

  // A member who leaves keeps their balance, flagged.
  await call('POST', '/leave', C.vic);
  r = await call('GET', '/splits', C.olive);
  const vicBal = r.json.balances.find((x: Json) => x.memberId === 'vic');
  assert(vicBal.netNzd === -18.64 && vicBal.left && vicBal.name === 'Vic Smith (left)', 'Vic’s balance is kept after leaving');
  r = await call('POST', '/settlements', C.adam, { fromId: 'vic', toId: 'adam', amountNzd: 18.64 });
  assert(r.status === 201 && r.json.suggestions.length === 0 && r.json.balances.every((x: Json) => x.netNzd === 0), 'and can still be settled; everyone is square');
  assert((await call('GET', '/splits', C.vic)).status === 404, 'Vic no longer sees the household’s splits');

  // The dashboard marks split transactions.
  const d = (await call('GET', '/dashboard', C.adam)).json;
  assert(d.transactions.find((t: Json) => t.id === 't_groceries').splitId && d.transactions.find((t: Json) => t.id === 't_dinner').splitId === null, 'dashboard shows which are split');
  const acts = (await call('GET', '/', C.olive)).json.household.activity.map((a: Json) => `${a.actorName}: ${a.action}`);
  assert(acts.includes('Adam Smith: split a transaction') && acts.includes('Olive Smith: recorded a payment'), 'activity log');

  // Deleting the household removes its splits and payments.
  await call('DELETE', '/', C.olive);
  assert(queryAll(db, `SELECT * FROM household_splits`).length === 0 && queryAll(db, `SELECT * FROM household_split_shares`).length === 0 && queryAll(db, `SELECT * FROM household_settlements`).length === 0, 'splits and payments go with the household');
  assert(queryAll(db, `SELECT id FROM transactions`).length === 5, 'transactions are untouched');
  console.log('household splits tests passed');
} finally {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
