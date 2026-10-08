/**
 * Bills and subscriptions API (KAN-26): detection from transactions, confirm / dismiss,
 * CRUD, next due, totals, and user isolation.
 * Run: npm run test:bills
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-recurring-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryOne } = await import('../db/index.ts');
const { deleteScopedDataForUser, SCOPED_TABLES } = await import('../lib/userScope.ts');
const { seedCategoriesForUser, resolveCategoryId } = await import('../lib/categories.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { aucklandToday } = await import('../debts/model.ts');
const { addCadence, merchantKey } = await import('../../src/lib/recurring.ts');
const { default: recurringRouter } = await import('../routes/recurring.ts');

const userA = 'rec_user_a';
const userB = 'rec_user_b';
const now = '2026-10-05T00:00:00.000Z';
const today = aucklandToday();
const db = await getDb();
assert(queryOne(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='recurring_items'`), 'schema creates recurring_items');
assert((SCOPED_TABLES as readonly string[]).includes('recurring_items'), 'recurring_items is user-scoped');
for (const [id, email] of [[userA, 'a@example.com'], [userB, 'b@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [id, email, 'hash', now, now]);
  seedCategoriesForUser(db, id);
}
const subsA = resolveCategoryId(db, userA, 'cat-subscriptions');
const invA = resolveCategoryId(db, userA, 'cat-investments');

let n = 0;
function txn(userId: string, date: string, amount: number, description: string, categoryId: string | null = null) {
  run(
    db,
    `INSERT INTO transactions (id, user_id, date, description, amount, kind, category_id, currency, source, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [`rt${++n}`, userId, date, description, amount, amount < 0 ? 'debit' : 'credit', categoryId, 'NZD', 'manual', now],
  );
}
// Four monthly Spotify payments ending last month; a monthly transfer to Sharesies (not a bill).
for (let i = 4; i >= 1; i -= 1) {
  const d = addCadence(today, 'monthly', -i);
  txn(userA, d, -14.99, 'SPOTIFY P1234ABCD', subsA);
  txn(userA, d, -500, 'Sharesies top-up', invA);
  txn(userB, d, -30, 'Disney Plus');
}

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/recurring', recurringRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
type Json = Record<string, any>;
async function call(method: string, p: string, cookie?: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}

try {
  assert((await call('GET', '/api/recurring')).status === 401, 'signed out is 401');
  const A = `${SESSION_COOKIE}=${(await createSession(userA)).rawToken}`;
  const B = `${SESSION_COOKIE}=${(await createSession(userB)).rawToken}`;

  const first = await call('GET', '/api/recurring', A);
  assert(first.status === 200 && first.json.items.length === 0, 'no saved items yet');
  const spotify = first.json.suggestions.find((s: Json) => s.merchantKey === merchantKey('SPOTIFY'));
  assert(spotify, 'Spotify suggested from transactions');
  assert(spotify.cadence === 'monthly' && spotify.kind === 'subscription' && spotify.amountNzd === 14.99, 'monthly subscription 14.99');
  assert(spotify.nextDue >= today, 'next due on or after today');
  assert(!first.json.suggestions.some((s: Json) => /sharesies/i.test(s.name)), 'transfers to Investments are not bills');
  assert(!first.json.suggestions.some((s: Json) => /disney/i.test(s.name)), 'other users’ payments are not suggested');

  // Confirm the suggestion.
  const confirmed = await call('POST', '/api/recurring', A, {
    name: 'Spotify', kind: 'subscription', amountNzd: 14.99, cadence: 'monthly', nextDue: spotify.nextDue,
    categoryId: subsA, merchantKey: spotify.merchantKey, source: 'detected',
  });
  assert(confirmed.status === 201 && confirmed.json.source === 'detected', 'suggestion confirmed');
  assert(confirmed.json.lastPaidDate === addCadence(today, 'monthly', -1) && confirmed.json.lastPaidNzd === 14.99, 'last paid from transactions');
  assert(confirmed.json.categoryName === 'Subscriptions', 'category name');
  const afterConfirm = await call('GET', '/api/recurring', A);
  assert(!afterConfirm.json.suggestions.some((s: Json) => s.merchantKey === spotify.merchantKey), 'confirmed payee no longer suggested');

  // Manual item with an old anchor date rolls forward; totals.
  const rent = await call('POST', '/api/recurring', A, { name: 'Rent', kind: 'bill', amountNzd: 600, cadence: 'weekly', nextDue: '2026-01-05' });
  assert(rent.status === 201 && rent.json.source === 'manual', 'manual item');
  assert(rent.json.nextDue >= today && rent.json.nextDue < addCadence(today, 'weekly'), 'weekly next due rolled to this week');
  const totals = (await call('GET', '/api/recurring', A)).json.totals;
  assert(Math.abs(totals.monthlyNzd - (14.99 + 600 * 52 / 12)) < 0.02, 'monthly total');
  assert(totals.activeCount === 2, 'two active');
  assert(totals.dueNext30DaysNzd >= 600 * 4 + 14.99, 'weekly rent counts every week in the next 30 days');
  assert(totals.dueNext30DaysNzd < 600 * 5 + 14.99 * 2, 'a monthly bill is counted once in 30 days, weekly at most five times');

  // Edit and pause.
  const paused = await call('PATCH', `/api/recurring/${rent.json.id}`, A, { status: 'paused', amountNzd: 650 });
  assert(paused.status === 200 && paused.json.status === 'paused' && paused.json.amountNzd === 650, 'edited and paused');
  assert((await call('GET', '/api/recurring', A)).json.totals.activeCount === 1, 'paused items leave the totals');

  // Validation.
  assert((await call('POST', '/api/recurring', A, { name: '', kind: 'bill', amountNzd: 1, cadence: 'monthly', nextDue: today })).status === 400, 'name required');
  assert((await call('POST', '/api/recurring', A, { name: 'x', kind: 'bill', amountNzd: 0, cadence: 'monthly', nextDue: today })).status === 400, 'amount > 0');
  assert((await call('POST', '/api/recurring', A, { name: 'x', kind: 'bill', amountNzd: 5, cadence: 'daily', nextDue: today })).status === 400, 'cadence checked');
  assert((await call('PATCH', `/api/recurring/${rent.json.id}`, A, { status: 'gone' })).status === 400, 'status checked');

  // Isolation.
  const listB = await call('GET', '/api/recurring', B);
  assert(listB.json.items.length === 0, 'user B sees no saved items of A');
  assert(listB.json.suggestions.some((s: Json) => /disney/i.test(s.name)), 'user B gets their own suggestion');
  assert((await call('PATCH', `/api/recurring/${rent.json.id}`, B, { name: 'Mine' })).status === 404, 'B cannot edit A');
  assert((await call('DELETE', `/api/recurring/${rent.json.id}`, B)).status === 404, 'B cannot delete A');
  const bOther = await call('POST', '/api/recurring', B, { name: 'X', kind: 'bill', amountNzd: 5, cadence: 'monthly', nextDue: today, categoryId: subsA });
  assert(bOther.json.categoryId === null, 'another user’s category is not attached');

  // Dismiss and restore.
  const disney = listB.json.suggestions.find((s: Json) => /disney/i.test(s.name));
  assert((await call('POST', '/api/recurring/dismiss', B, { merchantKey: disney.merchantKey })).status === 200, 'dismissed');
  const afterDismiss = await call('GET', '/api/recurring', B);
  assert(!afterDismiss.json.suggestions.some((s: Json) => /disney/i.test(s.name)) && afterDismiss.json.dismissedCount === 1, 'dismissed suggestion hidden');
  assert((await call('GET', '/api/recurring', A)).json.dismissedCount === 0, 'dismissals are per user');
  assert((await call('POST', '/api/recurring/dismissed/restore', B)).json.restored === 1, 'restored');
  assert((await call('GET', '/api/recurring', B)).json.suggestions.some((s: Json) => /disney/i.test(s.name)), 'suggestion back');
  assert((await call('POST', '/api/recurring/dismiss', B, {})).status === 400, 'dismiss needs a key');

  // Delete and account delete.
  assert((await call('DELETE', `/api/recurring/${rent.json.id}`, A)).status === 200, 'owner delete');
  const wiped = deleteScopedDataForUser(db, userA);
  assert(wiped.tables.recurring_items === 1, 'account delete removes saved items');
  assert((await call('GET', '/api/recurring', B)).json.items.length === 1, 'B untouched');

  console.log('recurring api tests ok');
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  for (const suffix of ['', '.tmp', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
