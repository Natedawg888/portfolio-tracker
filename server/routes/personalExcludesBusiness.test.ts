/**
 * Budget and Income leave out money tagged to a business (KAN-107).
 * Run: npm run test:budget
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-personal-business-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function eq(actual: number | null | undefined, expected: number, msg: string): void {
  if (actual == null || Math.abs(actual - expected) > 1e-6) {
    throw new Error(`FAIL: ${msg} (got ${actual}, expected ${expected})`);
  }
}

function sameIds(actual: string[], expected: string[], msg: string): void {
  const a = [...actual].sort();
  const e = [...expected].sort();
  if (JSON.stringify(a) !== JSON.stringify(e)) {
    throw new Error(`FAIL: ${msg} (got ${a.join(',')}, expected ${e.join(',')})`);
  }
}

const { getDb, run } = await import('../db/index.ts');
const { seedCategoriesForUser, resolveCategoryId } = await import('../lib/categories.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { default: accountsRouter } = await import('./accounts.ts');
const { default: incomeRouter } = await import('./income.ts');

const userA = 'biz_user_a';
const userB = 'biz_user_b';
const now = '2026-10-05T00:00:00.000Z';

const db = await getDb();
seedCategoriesForUser(db, userA);
seedCategoriesForUser(db, userB);

function cat(userId: string, slug: string): string {
  const id = resolveCategoryId(db, userId, slug);
  if (!id) throw new Error(`missing category ${slug} for ${userId}`);
  return id;
}

const aSalary = cat(userA, 'cat-income-salary');
const aFood = cat(userA, 'cat-food');
const bSalary = cat(userB, 'cat-income-salary');

for (const [id, email] of [[userA, 'a@example.com'], [userB, 'b@example.com']]) {
  run(
    db,
    `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`,
    [id, email, 'hash', now, now],
  );
}
for (const [id, userId] of [['acct_a', userA], ['acct_b', userB]]) {
  run(
    db,
    `INSERT INTO bank_accounts (id, user_id, name, institution, account_type, currency, balance, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, userId, 'Everyday', 'Kiwibank', 'cheque', 'NZD', 1000, now, now],
  );
}

function txn(
  id: string,
  userId: string,
  accountId: string,
  date: string,
  amount: number,
  categoryId: string | null,
  businessId: string | null = null,
): void {
  run(
    db,
    `INSERT INTO transactions
       (id, user_id, account_id, date, description, amount, kind, category_id, currency, source, created_at, business_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, accountId, date, id, amount, amount < 0 ? 'debit' : 'credit', categoryId, 'NZD', 'manual', now, businessId],
  );
}

function income(
  id: string,
  userId: string,
  date: string,
  amount: number,
  categoryId: string | null,
  transactionId: string | null,
  businessId: string | null = null,
): void {
  run(
    db,
    `INSERT INTO income_records
       (id, user_id, date, amount_nzd, kind, description, category_id, transaction_id, created_at, business_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, date, amount, 'cash', id, categoryId, transactionId, now, businessId],
  );
}

txn('txn_spend', userA, 'acct_a', '2026-10-03', -50, aFood);
txn('txn_biz_spend', userA, 'acct_a', '2026-10-04', -700, aFood, 'biz_a');
txn('txn_uncat', userA, 'acct_a', '2026-10-05', -20, null);
txn('txn_biz_uncat', userA, 'acct_a', '2026-10-06', -30, null, 'biz_a');
txn('txn_salary', userA, 'acct_a', '2026-10-07', 1000, aSalary);
txn('txn_biz_credit', userA, 'acct_a', '2026-10-08', 400, aSalary, 'biz_a');
income('inc_personal', userA, '2026-10-09', 2000, aSalary, null);
income('inc_biz', userA, '2026-10-10', 3000, aSalary, null, 'biz_a');
// An invoice payment matched to its bank deposit: the record is business, the deposit is not tagged.
txn('txn_invoice_deposit', userA, 'acct_a', '2026-10-11', 600, aSalary);
income('inc_invoice', userA, '2026-10-11', 600, aSalary, 'txn_invoice_deposit', 'biz_a');

txn('txn_b_uncat', userB, 'acct_b', '2026-10-05', -15, null);
txn('txn_b_salary', userB, 'acct_b', '2026-10-07', 500, bSalary);
income('inc_b', userB, '2026-10-09', 9000, bSalary, null);

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => {
  if (isPublicApiPath(req.path)) return next();
  return requireAuth(req, res, next);
});
app.use('/api/accounts', accountsRouter);
app.use('/api/income', incomeRouter);

const server: Server = await new Promise((resolve) => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function get<T>(pathname: string, cookie: string): Promise<T> {
  const res = await fetch(`${base}${pathname}`, { headers: { Accept: 'application/json', Cookie: cookie } });
  assert(res.status === 200, `${pathname} is 200 (got ${res.status})`);
  return (await res.json()) as T;
}

try {
  const cookieA = `${SESSION_COOKIE}=${(await createSession(userA)).rawToken}`;
  const cookieB = `${SESSION_COOKIE}=${(await createSession(userB)).rawToken}`;
  const personalTxns = ['txn_spend', 'txn_uncat', 'txn_salary', 'txn_invoice_deposit'];

  const ranged = await get<{ id: string }[]>('/api/accounts/transactions?from=2026-10-01&to=2026-10-31', cookieA);
  sameIds(ranged.map((t) => t.id), personalTxns, 'Budget transactions in a range leave out business-tagged ones');
  const open = await get<{ id: string }[]>('/api/accounts/transactions?from=2026-10-01', cookieA);
  sameIds(open.map((t) => t.id), personalTxns, 'Budget transactions with no end date leave out business-tagged ones');

  const suggestions = await get<{ transactionId: string }[]>(
    '/api/accounts/transactions/suggestions?from=2026-10-01&to=2026-10-31',
    cookieA,
  );
  sameIds(suggestions.map((s) => s.transactionId), ['txn_uncat'], 'triage suggests only untagged uncategorised transactions');

  const list = await get<{ id: string }[]>('/api/income?month=2026-10', cookieA);
  sameIds(
    list.map((r) => r.id),
    ['inc_personal', 'cat-income:txn_salary'],
    'Income list leaves out business records, business credits, and the invoice deposit',
  );

  const summary = await get<Record<string, number>>('/api/income/summary?month=2026-10', cookieA);
  eq(summary.recordsTotalNzd, 2000, 'summary records total leaves out business records');
  eq(summary.recordCount, 1, 'summary counts only the personal record');
  eq(summary.categoryCreditsExtraNzd, 1000, 'summary credits leave out the business credit and the invoice deposit');
  eq(summary.categoryCreditCount, 1, 'summary counts only the personal credit');
  eq(summary.actualNzd, 3000, 'summary received is personal money only');

  const listB = await get<{ id: string }[]>('/api/income?month=2026-10', cookieB);
  sameIds(listB.map((r) => r.id), ['inc_b', 'cat-income:txn_b_salary'], 'user B sees only their own income');
  const txnsB = await get<{ id: string }[]>('/api/accounts/transactions?from=2026-10-01&to=2026-10-31', cookieB);
  sameIds(txnsB.map((t) => t.id), ['txn_b_uncat', 'txn_b_salary'], 'user B sees only their own transactions');
  const summaryB = await get<Record<string, number>>('/api/income/summary?month=2026-10', cookieB);
  eq(summaryB.actualNzd, 9500, 'user B received is their own record and credit');

  console.log('personal excludes business tests passed');
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
