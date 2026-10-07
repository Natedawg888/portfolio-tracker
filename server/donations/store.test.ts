/**
 * Donations stay on the user who recorded them, stay off receipt files, and
 * the HTTP API matches the tax-year totals. Run: npm run test:donations
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-donations-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function eq(actual: number | null | undefined, expected: number, msg: string): void {
  if (actual == null || Math.abs(actual - expected) > 1e-9) {
    throw new Error(`FAIL: ${msg} (got ${actual}, expected ${expected})`);
  }
}

const { getDb, queryAll, queryOne, run } = await import('../db/index.ts');
const { claimUnscopedRowsForOwner, deleteScopedDataForUser } = await import('../lib/userScope.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { aucklandToday } = await import('../debts/model.ts');
const { donationSummary } = await import('./model.ts');
const { RECEIPT_LINK_ERROR } = await import('./store.ts');
const {
  createDonation,
  deleteDonation,
  getDonation,
  listDonations,
  summarizeDonations,
  updateDonation,
} = await import('./store.ts');
const { default: donationsRouter } = await import('../routes/donations.ts');

const userA = 'donations_user_a';
const userB = 'donations_user_b';
const now = '2026-10-05T00:00:00.000Z';
const asOf = '2026-10-05';

const db = await getDb();
const table = queryOne<{ name?: string }>(
  db,
  `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'donations'`,
);
assert(table?.name === 'donations', 'schema creates donations');
const trigger = queryOne<{ name?: string }>(
  db,
  `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'donations_clear_receipt_link'`,
);
assert(trigger?.name === 'donations_clear_receipt_link', 'deleting a transaction clears the receipt link');

const donationCols = new Set(
  queryAll<{ name: string }>(db, `PRAGMA table_info(donations)`).map((col) => col.name),
);
assert(!donationCols.has('receipt_path'), 'donations do not store a receipt file path');

run(
  db,
  `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`,
  [userA, 'a@example.com', 'hash', now, now],
);
run(
  db,
  `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`,
  [userB, 'b@example.com', 'hash', now, now],
);
run(
  db,
  `INSERT INTO bank_accounts (id, user_id, name, institution, account_type, currency, balance, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?,?,?)`,
  ['acct_a', userA, 'Everyday', 'Kiwibank', 'cheque', 'NZD', 1000, now, now],
);
run(
  db,
  `INSERT INTO bank_accounts (id, user_id, name, institution, account_type, currency, balance, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?,?,?)`,
  ['acct_b', userB, 'Everyday', 'Kiwibank', 'cheque', 'NZD', 50, now, now],
);

function txn(id: string, userId: string, accountId: string, receiptPath: string | null): void {
  run(
    db,
    `INSERT INTO transactions
       (id, user_id, account_id, date, description, amount, kind, currency, source, created_at, receipt_path)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, accountId, '2026-06-01', id, -25, 'debit', 'NZD', 'manual', now, receiptPath],
  );
}

txn('txn_a_receipt', userA, 'acct_a', 'receipts/txn_a_receipt.pdf');
txn('txn_a_plain', userA, 'acct_a', null);
txn('txn_b_receipt', userB, 'acct_b', 'receipts/txn_b_receipt.pdf');

const gift = createDonation(db, userA, {
  date: '2026-06-15',
  recipient: 'City Mission',
  amountNzd: 10,
  notes: 'winter appeal',
  evidenceUrl: 'https://example.org/city-mission',
  receiptTransactionId: 'txn_a_receipt',
});
assert(gift.ok, 'owner can record a donation');
if (!gift.ok) throw new Error('unreachable');
assert(gift.donation.id.startsWith('don_'), 'ids use the don prefix');
eq(gift.donation.amountNzd, 10, 'stored amount');
assert(gift.donation.taxYear === 2027, '15 June 2026 is the 2027 tax year');
assert(gift.donation.receiptTransactionId === 'txn_a_receipt', 'optional receipt link is stored');
assert(gift.donation.receiptPath === 'receipts/txn_a_receipt.pdf', 'receipt path is read from the transaction');
assert(gift.donation.receiptUrl === '/api/uploads/receipts/txn_a_receipt.pdf', 'receipt URL uses the uploads path');
const receiptAfterLink = queryOne<{ receipt_path?: string | null; amount?: number }>(
  db,
  `SELECT receipt_path, amount FROM transactions WHERE id = ?`,
  ['txn_a_receipt'],
);
assert(receiptAfterLink?.receipt_path === 'receipts/txn_a_receipt.pdf', 'linking does not change the receipt file');
eq(Number(receiptAfterLink?.amount), -25, 'linking does not change the transaction amount');

const txnCount = queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM transactions`);
assert(Number(txnCount?.c) === 3, 'recording a donation does not create a transaction');

assert(getDonation(db, userB, gift.donation.id) == null, 'user B cannot read user A');
const hiddenLink = createDonation(db, userA, {
  date: '2026-06-16',
  recipient: 'Nope',
  amountNzd: 5,
  notes: null,
  evidenceUrl: null,
  receiptTransactionId: 'txn_b_receipt',
});
assert(!hiddenLink.ok && hiddenLink.error === RECEIPT_LINK_ERROR, 'another user’s receipt cannot be linked');
const plainLink = createDonation(db, userA, {
  date: '2026-06-16',
  recipient: 'Nope',
  amountNzd: 5,
  notes: null,
  evidenceUrl: null,
  receiptTransactionId: 'txn_a_plain',
});
assert(!plainLink.ok, 'a transaction without a receipt cannot be linked');
assert(listDonations(db, userA, null).every((row) => row.recipient !== 'Nope'), 'rejected links are not stored');

const earlier = createDonation(db, userA, {
  date: '2026-03-31',
  recipient: 'Red Cross',
  amountNzd: 100,
  notes: null,
  evidenceUrl: null,
  receiptTransactionId: null,
});
assert(earlier.ok && earlier.donation.taxYear === 2026, '31 March stays in the previous tax year');
const small = createDonation(db, userA, {
  date: '2026-08-01',
  recipient: 'School fair',
  amountNzd: 4.99,
  notes: null,
  evidenceUrl: null,
  receiptTransactionId: null,
});
assert(small.ok, 'a gift under $5 is still recorded');

const order = listDonations(db, userA, null).map((row) => row.date);
assert(
  JSON.stringify(order) === JSON.stringify(['2026-08-01', '2026-06-15', '2026-03-31']),
  `newest date first (got ${order.join(', ')})`,
);
assert(listDonations(db, userA, 2027).every((row) => row.taxYear === 2027), 'taxYear filter keeps that year');
assert(listDonations(db, userA, 2026).length === 1, 'the March gift is the only 2026 row');

const totals = summarizeDonations(db, userA, asOf, null);
const expected = donationSummary(
  [
    { date: '2026-06-15', amountNzd: 10 },
    { date: '2026-03-31', amountNzd: 100 },
    { date: '2026-08-01', amountNzd: 4.99 },
  ],
  asOf,
  null,
);
eq(totals.selected.totalAmountNzd, expected.selected.totalAmountNzd, 'store summary matches the formula');
eq(totals.selected.eligibleAmountNzd, 10, '4.99 is outside the credit estimate');
eq(totals.selected.estimatedTaxCreditNzd, expected.selected.estimatedTaxCreditNzd, 'store credit matches the formula');

const cleared = updateDonation(db, userA, gift.donation.id, {
  receiptTransactionId: null,
  notes: null,
  amountNzd: 5,
});
assert(cleared?.ok && cleared.donation.receiptTransactionId == null, 'the receipt link can be cleared');
assert(cleared.donation.receiptPath == null, 'clearing the link drops the receipt path');
eq(cleared.donation.amountNzd, 5, 'amount can be updated');
assert(
  queryOne<{ receipt_path?: string | null }>(
    db,
    `SELECT receipt_path FROM transactions WHERE id = ?`,
    ['txn_a_receipt'],
  )?.receipt_path === 'receipts/txn_a_receipt.pdf',
  'clearing the link leaves the receipt file',
);

const relinked = updateDonation(db, userA, gift.donation.id, { receiptTransactionId: 'txn_a_receipt' });
assert(relinked?.ok && relinked.donation.receiptPath === 'receipts/txn_a_receipt.pdf', 'the link can be set again');
run(db, `DELETE FROM transactions WHERE id = ? AND user_id = ?`, ['txn_a_receipt', userA]);
const afterTxnDelete = getDonation(db, userA, gift.donation.id);
assert(afterTxnDelete != null, 'deleting the transaction keeps the donation');
assert(afterTxnDelete.receiptTransactionId == null, 'deleting the transaction clears the optional link');
assert(afterTxnDelete.recipient === 'City Mission', 'the donation itself is unchanged');

assert(deleteDonation(db, userB, gift.donation.id) === false, 'user B cannot delete user A');
assert(deleteDonation(db, userA, small.ok ? small.donation.id : '') === true, 'owner can delete');
assert(getDonation(db, userA, small.ok ? small.donation.id : '') == null, 'deleted donation is gone');
assert(
  queryOne<{ id?: string }>(db, `SELECT id FROM transactions WHERE id = ?`, ['txn_a_plain'])?.id === 'txn_a_plain',
  'deleting a donation does not delete transactions',
);

run(
  db,
  `INSERT INTO donations (
     id, user_id, date, recipient, amount_nzd, notes, evidence_url, receipt_transaction_id, created_at, updated_at
   ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ['don_unscoped', null, '2026-05-01', 'Legacy', 20, null, null, null, now, now],
);
claimUnscopedRowsForOwner(db, userA);
assert(getDonation(db, userA, 'don_unscoped')?.recipient === 'Legacy', 'unscoped donations are claimed by the data owner');
assert(getDonation(db, userB, 'don_unscoped') == null, 'the other user does not receive the claim');

const removed = deleteScopedDataForUser(db, userA);
assert((removed.tables.donations ?? 0) >= 1, 'account delete counts donations');
assert(listDonations(db, userA, null).length === 0, 'account delete removes that user’s donations');
const keptReceipt = queryOne<{ id?: string }>(
  db,
  `SELECT id FROM transactions WHERE id = ?`,
  ['txn_b_receipt'],
);
assert(keptReceipt?.id === 'txn_b_receipt', 'account delete leaves the other user’s receipt');

const fresh = createDonation(db, userA, {
  date: '2026-06-15',
  recipient: 'City Mission',
  amountNzd: 10,
  notes: null,
  evidenceUrl: null,
  receiptTransactionId: null,
});
assert(fresh.ok, 'user A can record again after account delete');
if (!fresh.ok) throw new Error('unreachable');
run(
  db,
  `INSERT INTO bank_accounts (id, user_id, name, institution, account_type, currency, balance, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?,?,?)`,
  ['acct_a', userA, 'Everyday', 'Kiwibank', 'cheque', 'NZD', 1000, now, now],
);
txn('txn_a_plain', userA, 'acct_a', null);

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => {
  if (isPublicApiPath(req.path)) return next();
  return requireAuth(req, res, next);
});
app.use('/api/donations', donationsRouter);

const server: Server = await new Promise((resolve) => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
});
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

async function call(
  method: string,
  pathname: string,
  cookie?: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as unknown;
  return { status: res.status, json };
}

const KEYS = [
  'amountNzd',
  'createdAt',
  'currency',
  'date',
  'evidenceUrl',
  'id',
  'notes',
  'receiptPath',
  'receiptTransactionId',
  'receiptUrl',
  'recipient',
  'taxYear',
  'taxYearEnd',
  'taxYearStart',
  'timezone',
  'updatedAt',
];

function assertShape(body: Record<string, unknown>, label: string): void {
  const keys = Object.keys(body).sort();
  assert(JSON.stringify(keys) === JSON.stringify([...KEYS].sort()), `${label}: unexpected fields ${keys.join(',')}`);
  assert(body.currency === 'NZD', `${label}: currency is NZD`);
  assert(body.timezone === 'Pacific/Auckland', `${label}: timezone is Pacific/Auckland`);
}

try {
  const sessionA = await createSession(userA);
  const sessionB = await createSession(userB);
  const cookieA = `${SESSION_COOKIE}=${sessionA.rawToken}`;
  const cookieB = `${SESSION_COOKIE}=${sessionB.rawToken}`;
  const today = aucklandToday();

  const signedOut = await call('GET', '/api/donations');
  const signedOutBody = signedOut.json as { error?: string; code?: string };
  assert(signedOut.status === 401, 'signed-out list is 401');
  assert(signedOutBody.error === 'Authentication required', '401 error text');
  assert(signedOutBody.code === 'UNAUTHORIZED', '401 code');
  const signedOutSummary = await call('GET', '/api/donations/summary');
  assert(signedOutSummary.status === 401, 'signed-out summary is 401');

  const listed = await call('GET', '/api/donations', cookieA);
  assert(listed.status === 200, 'list is 200');
  const rows = listed.json as Array<Record<string, unknown>>;
  assert(Array.isArray(rows) && rows.length === 1, 'user A has the donation recreated after account delete');
  assertShape(rows[0], 'list item');
  assert(rows[0].id === fresh.donation.id, 'list returns the saved id');

  const otherList = await call('GET', '/api/donations', cookieB);
  const otherRows = otherList.json as unknown[];
  assert(otherList.status === 200 && otherRows.length === 0, 'user B has no donations');

  const hidden = await call('GET', `/api/donations/${encodeURIComponent(fresh.donation.id)}`, cookieB);
  const hiddenBody = hidden.json as { error?: string };
  assert(hidden.status === 404 && hiddenBody.error === 'Donation not found', 'cross-user read is not found');

  const missing = await call('POST', '/api/donations', cookieA, { recipient: 'Nope' });
  assert(missing.status === 400, 'missing date is 400');
  assert((missing.json as { error?: string }).error === 'date is required', 'missing date error');

  const txnsBefore = Number(
    queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM transactions`)?.c ?? 0,
  );
  const badReceipt = await call('POST', '/api/donations', cookieA, {
    date: '2026-07-01',
    recipient: 'Nope',
    amountNzd: 8,
    receiptTransactionId: 'txn_b_receipt',
  });
  assert(badReceipt.status === 400, 'another user’s receipt is 400');
  assert((badReceipt.json as { error?: string }).error === RECEIPT_LINK_ERROR, 'receipt link error');
  const txnsAfter = Number(
    queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM transactions`)?.c ?? 0,
  );
  assert(txnsAfter === txnsBefore, 'a rejected donation does not add a transaction');

  const created = await call('POST', '/api/donations', cookieA, {
    date: '2026-04-01',
    recipient: 'Red Cross',
    amountNzd: 5,
    notes: 'appeal',
    evidenceUrl: 'https://example.org/red-cross',
    receiptTransactionId: 'txn_a_plain',
  });
  assert(created.status === 400, 'a transaction without a receipt is 400');

  const createdOk = await call('POST', '/api/donations', cookieA, {
    date: '2026-04-01',
    recipient: 'Red Cross',
    amountNzd: 5,
    notes: 'appeal',
    evidenceUrl: 'https://example.org/red-cross',
  });
  assert(createdOk.status === 201, 'create is 201');
  const createdBody = createdOk.json as Record<string, unknown>;
  assertShape(createdBody, 'created');
  assert(createdBody.taxYear === 2027, '1 April 2026 is tax year 2027');
  assert(createdBody.taxYearStart === '2026-04-01', 'tax year start is 1 April');
  assert(createdBody.taxYearEnd === '2027-03-31', 'tax year end is 31 March');
  assert(createdBody.receiptTransactionId == null, 'receipt link is optional');
  assert(createdBody.receiptPath == null && createdBody.receiptUrl == null, 'no receipt fields without a link');

  const id = String(createdBody.id);
  const got = await call('GET', `/api/donations/${encodeURIComponent(id)}`, cookieA);
  assert(got.status === 200 && (got.json as { recipient?: string }).recipient === 'Red Cross', 'owner can read one donation');

  const updated = await call('PATCH', `/api/donations/${encodeURIComponent(id)}`, cookieA, {
    amountNzd: 4.99,
    notes: '',
    evidenceUrl: null,
  });
  assert(updated.status === 200, 'patch is 200');
  eq(Number((updated.json as { amountNzd?: number }).amountNzd), 4.99, 'patched amount');
  assert((updated.json as { notes?: string | null }).notes == null, 'notes can be cleared');

  const stolen = await call('PATCH', `/api/donations/${encodeURIComponent(id)}`, cookieB, { recipient: 'Stolen' });
  assert(stolen.status === 404, 'user B cannot patch user A');

  const summary = await call('GET', '/api/donations/summary', cookieA);
  assert(summary.status === 200, 'summary is 200');
  const summaryBody = summary.json as {
    asOf?: string;
    currentTaxYear?: number;
    estimateLabel?: string;
    incomeCapApplied?: boolean;
    selected?: { totalAmountNzd?: number; eligibleAmountNzd?: number; estimatedTaxCreditNzd?: number };
  };
  assert(summaryBody.asOf === today, 'summary asOf is Auckland today');
  assert(summaryBody.estimateLabel === 'estimate', 'HTTP summary labels the credit an estimate');
  assert(summaryBody.incomeCapApplied === false, 'HTTP summary does not apply the income cap');
  const live = listDonations(db, userA, null).map((row) => ({ date: row.date, amountNzd: row.amountNzd }));
  const liveSummary = donationSummary(live, today, null);
  eq(summaryBody.selected?.totalAmountNzd, liveSummary.selected.totalAmountNzd, 'HTTP total matches the formula');
  eq(summaryBody.selected?.eligibleAmountNzd, liveSummary.selected.eligibleAmountNzd, 'HTTP eligible amount matches');
  eq(
    summaryBody.selected?.estimatedTaxCreditNzd,
    liveSummary.selected.estimatedTaxCreditNzd,
    'HTTP credit matches the formula',
  );
  assert(summaryBody.currentTaxYear === liveSummary.currentTaxYear, 'HTTP current tax year matches');

  const yearList = await call('GET', '/api/donations?taxYear=2026', cookieA);
  const yearRows = yearList.json as unknown[];
  assert(yearList.status === 200 && yearRows.length === 0, '2026 filter excludes the April and June gifts');
  const badYear = await call('GET', '/api/donations/summary?taxYear=27', cookieA);
  assert(badYear.status === 400, 'a short taxYear is 400');

  const removedHttp = await call('DELETE', `/api/donations/${encodeURIComponent(id)}`, cookieB);
  assert(removedHttp.status === 404, 'user B cannot delete user A');
  const still = await call('GET', `/api/donations/${encodeURIComponent(id)}`, cookieA);
  assert(still.status === 200, 'rejected delete leaves the donation');

  const gone = await call('DELETE', `/api/donations/${encodeURIComponent(id)}`, cookieA);
  const goneBody = gone.json as { ok?: boolean; id?: string };
  assert(gone.status === 200 && goneBody.ok === true && goneBody.id === id, 'owner delete returns ok');
  const after = await call('GET', `/api/donations/${encodeURIComponent(id)}`, cookieA);
  assert(after.status === 404, 'deleted donation is not found');

  console.log('donation store tests passed');
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
