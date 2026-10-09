/**
 * Warranties API (KAN-61): CRUD, status and ordering, linking a purchase and its receipt,
 * the warranty's own receipt file, validation, and user isolation.
 * Run: npm run test:warranties
 *
 * Uses a throwaway data dir (sqlite file and uploads). Does not touch data/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-warranties-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryOne } = await import('../db/index.ts');
const { deleteScopedDataForUser, SCOPED_TABLES } = await import('../lib/userScope.ts');
const { UPLOADS_DIR, userOwnsUpload } = await import('../lib/uploads.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { aucklandToday } = await import('../debts/model.ts');
const { addCadence } = await import('../../src/lib/recurring.ts');
const { default: warrantiesRouter } = await import('../routes/warranties.ts');

const userA = 'war_user_a';
const userB = 'war_user_b';
const now = '2026-10-05T00:00:00.000Z';
const today = aucklandToday();
const db = await getDb();
assert(queryOne(db, `SELECT name FROM sqlite_master WHERE type='table' AND name='warranties'`), 'schema creates warranties');
assert((SCOPED_TABLES as readonly string[]).includes('warranties'), 'warranties are user-scoped');
for (const [id, email] of [[userA, 'a@example.com'], [userB, 'b@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [id, email, 'hash', now, now]);
}
function txn(id: string, userId: string, date: string, amount: number, description: string, receiptPath: string | null = null) {
  run(
    db,
    `INSERT INTO transactions (id, user_id, date, description, amount, kind, currency, source, created_at, receipt_path)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, date, description, amount, amount < 0 ? 'debit' : 'credit', 'NZD', 'manual', now, receiptPath],
  );
}
const bought = addCadence(today, 'monthly', -2);
txn('wt_tv', userA, bought, -1299, 'NOEL LEEMING 1234 AUCKLAND', 'receipts/wt_tv.png');
txn('wt_pay', userA, bought, 3000, 'Salary');
txn('wt_old', userA, '2024-03-02', -89.5, 'JB HI-FI Headphones');
txn('wt_b', userB, bought, -500, 'Harvey Norman');

// A tiny valid PNG (1×1) as a data URL.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/warranties', warrantiesRouter);
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
  assert((await call('GET', '/api/warranties')).status === 401, 'signed out is 401');
  const A = `${SESSION_COOKIE}=${(await createSession(userA)).rawToken}`;
  const B = `${SESSION_COOKIE}=${(await createSession(userB)).rawToken}`;

  const empty = await call('GET', '/api/warranties', A);
  assert(empty.status === 200 && empty.json.items.length === 0 && empty.json.expiringSoonDays === 60, 'empty list');

  // Purchases to link: money out only, newest first, searchable, own only.
  const purchases = (await call('GET', '/api/warranties/purchases', A)).json as Json[];
  assert(purchases.map((p) => p.id).join() === 'wt_tv,wt_old', 'purchases are the user’s money out, newest first');
  assert(purchases[0].amountNzd === 1299 && purchases[0].receiptUrl === '/api/uploads/receipts/wt_tv.png', 'amount and receipt');
  const found = (await call('GET', '/api/warranties/purchases?q=hi-fi', A)).json as Json[];
  assert(found.length === 1 && found[0].id === 'wt_old', 'search by description');
  assert(((await call('GET', '/api/warranties/purchases?q=%25', A)).json as Json[]).length === 0, 'wildcards are literal');
  assert(((await call('GET', '/api/warranties/purchases', B)).json as Json[]).every((p) => p.id === 'wt_b'), 'B sees only their purchases');

  // Linked to a purchase that has a receipt.
  const tvEnd = addCadence(today, 'yearly', 1);
  const tv = await call('POST', '/api/warranties', A, {
    itemName: '  Samsung   TV ', retailer: 'Noel Leeming', priceNzd: 1299, startsOn: bought, endsOn: tvEnd, transactionId: 'wt_tv',
  });
  assert(tv.status === 201, 'created');
  assert(tv.json.itemName === 'Samsung TV' && tv.json.status === 'active', 'name tidied, active');
  assert(tv.json.purchase?.id === 'wt_tv' && tv.json.purchase.receiptUrl === '/api/uploads/receipts/wt_tv.png', 'purchase receipt shown');
  assert(tv.json.receiptUrl === null, 'no own receipt yet');

  // Expiring soon and expired; not linked.
  const kettle = await call('POST', '/api/warranties', A, { itemName: 'Kettle', startsOn: '2025-01-01', endsOn: addCadence(today, 'monthly', 1) });
  assert(kettle.status === 201 && kettle.json.status === 'expiring' && kettle.json.purchase === null && kettle.json.priceNzd === null, 'expiring soon');
  const phones = await call('POST', '/api/warranties', A, { itemName: 'Headphones', startsOn: '2024-03-02', endsOn: '2025-03-01', transactionId: 'wt_old' });
  assert(phones.json.status === 'expired' && phones.json.daysLeft < 0, 'expired');
  const list = await call('GET', '/api/warranties', A);
  assert(list.json.items.map((i: Json) => i.itemName).join() === 'Kettle,Samsung TV,Headphones', 'soonest ending first, expired last');
  assert(list.json.totals.active === 1 && list.json.totals.expiring === 1 && list.json.totals.expired === 1, 'totals');

  // Validation.
  const bad = (body: Json) => call('POST', '/api/warranties', A, { itemName: 'X', startsOn: today, endsOn: today, ...body });
  assert((await bad({ itemName: '' })).status === 400, 'item required');
  assert((await bad({ endsOn: addCadence(today, 'monthly', -1) })).status === 400, 'end on or after start');
  assert((await bad({ startsOn: '2026-13-01' })).status === 400, 'start date checked');
  assert((await bad({ priceNzd: -1 })).status === 400, 'price 0 or more');
  assert((await bad({ transactionId: 'nope' })).status === 400, 'unknown transaction');
  assert((await call('POST', '/api/warranties', B, { itemName: 'X', startsOn: today, endsOn: today, transactionId: 'wt_tv' })).status === 400, 'B cannot link A’s purchase');

  // Edit: extend cover, unlink, end before start rejected.
  const extended = await call('PATCH', `/api/warranties/${kettle.json.id}`, A, { endsOn: addCadence(today, 'yearly', 2), notes: 'Extended' });
  assert(extended.status === 200 && extended.json.status === 'active' && extended.json.notes === 'Extended', 'extended');
  assert((await call('PATCH', `/api/warranties/${kettle.json.id}`, A, { endsOn: '2024-12-31' })).status === 400, 'patch keeps end after start');
  const unlinked = await call('PATCH', `/api/warranties/${tv.json.id}`, A, { transactionId: null });
  assert(unlinked.json.transactionId === null && unlinked.json.purchase === null, 'unlinked');
  assert((await call('PATCH', `/api/warranties/${tv.json.id}`, A, { transactionId: 'wt_tv' })).json.purchase?.id === 'wt_tv', 'linked again');

  // A deleted purchase drops the link without breaking edits.
  run(db, `DELETE FROM transactions WHERE id = 'wt_old'`);
  const orphan = await call('PATCH', `/api/warranties/${phones.json.id}`, A, { notes: 'Old pair' });
  assert(orphan.status === 200 && orphan.json.purchase === null, 'deleted purchase shows as not linked');

  // Own receipt: upload, owner can read it, others can't; replace; remove.
  const up = await call('POST', `/api/warranties/${tv.json.id}/receipt`, A, { receiptBase64: PNG });
  assert(up.status === 200 && /^\/api\/uploads\/warranties\/.+\.png$/.test(up.json.receiptUrl), 'receipt saved');
  const rel = up.json.receiptUrl.replace('/api/uploads/', '');
  assert(fs.existsSync(path.join(UPLOADS_DIR, rel)), 'file written under the data dir');
  assert(userOwnsUpload(db, userA, rel) && !userOwnsUpload(db, userB, rel), 'only the owner can open it');
  assert((await call('POST', `/api/warranties/${tv.json.id}/receipt`, A, { receiptBase64: 'data:text/plain;base64,aGVsbG8=' })).status === 400, 'bad file');
  assert((await call('POST', `/api/warranties/${tv.json.id}/receipt`, B, { receiptBase64: PNG })).status === 404, 'B cannot upload to A');
  const cleared = await call('DELETE', `/api/warranties/${tv.json.id}/receipt`, A);
  assert(cleared.status === 200 && cleared.json.receiptUrl === null && !fs.existsSync(path.join(UPLOADS_DIR, rel)), 'receipt removed');

  // Isolation.
  assert((await call('GET', '/api/warranties', B)).json.items.length === 0, 'B sees none of A’s warranties');
  assert((await call('PATCH', `/api/warranties/${tv.json.id}`, B, { itemName: 'Mine' })).status === 404, 'B cannot edit A');
  assert((await call('DELETE', `/api/warranties/${tv.json.id}`, B)).status === 404, 'B cannot delete A');
  assert((await call('POST', '/api/warranties', B, { itemName: 'Fridge', startsOn: today, endsOn: tvEnd, transactionId: 'wt_b' })).status === 201, 'B adds own');

  // Delete removes its file; account delete removes the rest.
  await call('POST', `/api/warranties/${kettle.json.id}/receipt`, A, { receiptBase64: PNG });
  const kettleFile = path.join(UPLOADS_DIR, (await call('GET', '/api/warranties', A)).json.items.find((i: Json) => i.id === kettle.json.id).receiptUrl.replace('/api/uploads/', ''));
  assert((await call('DELETE', `/api/warranties/${kettle.json.id}`, A)).status === 200 && !fs.existsSync(kettleFile), 'delete removes the receipt file');
  const phonesUp = await call('POST', `/api/warranties/${phones.json.id}/receipt`, A, { receiptBase64: PNG });
  const phonesFile = path.join(UPLOADS_DIR, phonesUp.json.receiptUrl.replace('/api/uploads/', ''));
  const wiped = deleteScopedDataForUser(db, userA);
  assert(wiped.tables.warranties === 2 && !fs.existsSync(phonesFile), 'account delete removes warranties and files');
  assert((await call('GET', '/api/warranties', B)).json.items.length === 1, 'B untouched');

  console.log('warranties api tests ok');
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  fs.rmSync(dataDir, { recursive: true, force: true });
}
