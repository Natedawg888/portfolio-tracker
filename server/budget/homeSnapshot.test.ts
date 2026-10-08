/**
 * Home month snapshot: income, spending, savings, savings rate.
 * Run: npm run test:home-snapshot
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-home-snapshot-${process.pid}-${Date.now()}.db`);
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

const { getDb, run } = await import('../db/index.ts');
const { seedCategoriesForUser, resolveCategoryId } = await import('../lib/categories.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { default: homeRouter } = await import('../routes/home.ts');
const { currentYearMonth, homeMonthSnapshot, savingsRateOf } = await import('./homeSnapshot.ts');

const userA = 'home_user_a';
const userB = 'home_user_b';
const now = '2026-10-05T00:00:00.000Z';

function cat(db: Awaited<ReturnType<typeof getDb>>, userId: string, slug: string): string {
  const id = resolveCategoryId(db, userId, slug);
  if (!id) throw new Error(`missing category ${slug} for ${userId}`);
  return id;
}

const db = await getDb();
const salaryA = (() => {
  seedCategoriesForUser(db, userA);
  seedCategoriesForUser(db, userB);
  return {
    aSalary: cat(db, userA, 'cat-income-salary'),
    aFood: cat(db, userA, 'cat-food'),
    aDebt: cat(db, userA, 'cat-debt'),
    aTransferOut: cat(db, userA, 'cat-transfer-out'),
    aTransferIn: cat(db, userA, 'cat-transfer-in'),
    bSalary: cat(db, userB, 'cat-income-salary'),
    bFood: cat(db, userB, 'cat-food'),
  };
})();

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

function txn(
  id: string,
  userId: string,
  accountId: string,
  date: string,
  amount: number,
  categoryId: string | null,
): void {
  run(
    db,
    `INSERT INTO transactions
       (id, user_id, account_id, date, description, amount, kind, category_id, currency, source, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      accountId,
      date,
      id,
      amount,
      amount < 0 ? 'debit' : 'credit',
      categoryId,
      'NZD',
      'manual',
      now,
    ],
  );
}

function income(
  id: string,
  userId: string,
  date: string,
  amount: number,
  categoryId: string | null,
  transactionId: string | null,
  dividendEventId: string | null = null,
): void {
  run(
    db,
    `INSERT INTO income_records
       (id, user_id, date, amount_nzd, kind, description, category_id, transaction_id, dividend_event_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, date, amount, 'cash', id, categoryId, transactionId, dividendEventId, now],
  );
}

txn('txn_pay', userA, 'acct_a', '2026-10-02', 2000, salaryA.aSalary);
income('inc_linked', userA, '2026-10-02', 2000, salaryA.aSalary, 'txn_pay');
txn('txn_extra', userA, 'acct_a', '2026-10-03', 1000, salaryA.aSalary);
income('inc_div', userA, '2026-10-04', 2000, salaryA.aSalary, null, 'div_not_read');
txn('txn_food', userA, 'acct_a', '2026-10-31', -1500, salaryA.aFood);
txn('txn_uncat', userA, 'acct_a', '2026-10-10', -200, null);
txn('txn_debt', userA, 'acct_a', '2026-10-11', -200, salaryA.aDebt);
txn('txn_xfer_out', userA, 'acct_a', '2026-10-12', -500, salaryA.aTransferOut);
txn('txn_xfer_in', userA, 'acct_a', '2026-10-12', 800, salaryA.aTransferIn);
txn('txn_sep', userA, 'acct_a', '2026-09-30', -100, salaryA.aFood);
txn('txn_nov', userA, 'acct_a', '2026-11-01', -2500, salaryA.aFood);
income('inc_nov', userA, '2026-11-02', 1000, salaryA.aSalary, null);
income('inc_tiny', userA, '2026-03-02', 0.004, salaryA.aSalary, null);

run(
  db,
  `INSERT INTO debt_people (id, user_id, name, kind, outstanding_nzd, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?)`,
  ['debt_a', userA, 'Card', 'corporation', 500, now, now],
);
run(
  db,
  `INSERT INTO debt_repayments (id, person_id, amount_nzd, date, transaction_id, created_at)
   VALUES (?,?,?,?,?,?)`,
  ['repay_linked', 'debt_a', 200, '2026-10-11', 'txn_debt', now],
);
run(
  db,
  `INSERT INTO debt_repayments (id, person_id, amount_nzd, date, transaction_id, created_at)
   VALUES (?,?,?,?,?,?)`,
  ['repay_open', 'debt_a', 100, '2026-10-20', null, now],
);

txn('txn_b_pay', userB, 'acct_b', '2026-10-08', -10, salaryA.bFood);
income('inc_b', userB, '2026-10-08', 9000, salaryA.bSalary, null);

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => {
  if (isPublicApiPath(req.path)) return next();
  return requireAuth(req, res, next);
});
app.use('/api/home', homeRouter);

const server: Server = await new Promise((resolve) => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
});
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

async function get(pathname: string, cookie?: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${pathname}`, { headers });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

const KEYS = [
  'currency',
  'expectedPay',
  'incomeNzd',
  'periodEnd',
  'periodStart',
  'savingsNzd',
  'savingsRate',
  'spendingNzd',
  'timezone',
  'yearMonth',
];

function assertShape(body: Record<string, unknown>, label: string): void {
  const keys = Object.keys(body).sort();
  assert(JSON.stringify(keys) === JSON.stringify([...KEYS].sort()), `${label}: unexpected fields ${keys.join(',')}`);
  for (const key of keys) {
    assert(!/score|health/i.test(key), `${label}: score field ${key}`);
  }
  assert(body.currency === 'NZD', `${label}: currency is NZD`);
  assert(body.timezone === 'Pacific/Auckland', `${label}: timezone is Pacific/Auckland`);
}

try {
  assert(currentYearMonth(new Date('2026-09-30T10:00:00Z')) === '2026-09', '30 Sep 23:00 NZDT is September');
  assert(currentYearMonth(new Date('2026-09-30T12:00:00Z')) === '2026-10', '1 Oct 01:00 NZDT is October');
  assert(savingsRateOf(3000, 5000) === 3000 / 5000, 'savings rate is a fraction of income');
  assert(savingsRateOf(-1500, 1000) === -1.5, 'a month spent above income keeps a negative fraction');
  assert(savingsRateOf(0, 0) == null, 'savings rate is blank when income is zero');
  assert(savingsRateOf(-40, -10) == null, 'savings rate is blank when income is negative');

  const october = homeMonthSnapshot(db, userA, '2026-10');
  assert(october != null, 'October snapshot exists');
  eq(october!.incomeNzd, 5000, 'October income is records plus the unlinked credit, once');
  eq(october!.spendingNzd, 2000, 'October spending is food, uncategorised, debt, and the open repayment');
  eq(october!.savingsNzd, 3000, 'October savings is income minus spending');
  eq(october!.savingsRate, 0.6, 'October savings rate is 3000/5000');
  assert(october!.yearMonth === '2026-10', 'October yearMonth');
  assert(october!.periodStart === '2026-10-01', 'October starts on the 1st');
  assert(october!.periodEnd === '2026-10-31', 'October ends on the 31st');
  assertShape(october as unknown as Record<string, unknown>, 'october');

  const september = homeMonthSnapshot(db, userA, '2026-09');
  assert(september != null, 'September snapshot exists');
  eq(september!.incomeNzd, 0, 'September has no income');
  eq(september!.spendingNzd, 100, 'September spending stays in September');
  eq(september!.savingsNzd, -100, 'September savings is negative');
  assert(september!.savingsRate == null, 'September savings rate is blank');

  const november = homeMonthSnapshot(db, userA, '2026-11');
  assert(november != null, 'November snapshot exists');
  eq(november!.incomeNzd, 1000, 'November income');
  eq(november!.spendingNzd, 2500, 'November spending');
  eq(november!.savingsNzd, -1500, 'November savings');
  eq(november!.savingsRate, -1.5, 'November savings rate is negative');

  const march = homeMonthSnapshot(db, userA, '2026-03');
  assert(march != null, 'March snapshot exists');
  eq(march!.incomeNzd, 0, 'sub-cent income rounds to zero NZD');
  assert(march!.savingsRate == null, 'rounded-away income does not invent a rate');

  const leap = homeMonthSnapshot(db, userA, '2024-02');
  assert(leap?.periodEnd === '2024-02-29', 'February 2024 ends on the 29th');
  const plainFeb = homeMonthSnapshot(db, userA, '2026-02');
  assert(plainFeb?.periodEnd === '2026-02-28', 'February 2026 ends on the 28th');
  assert(homeMonthSnapshot(db, userA, '2026-13') == null, 'month 13 is rejected');

  const other = homeMonthSnapshot(db, userB, '2026-10');
  eq(other?.incomeNzd, 9000, 'user B income stays on user B');
  eq(other?.spendingNzd, 10, 'user B spending stays on user B');
  eq(other?.savingsNzd, 8990, 'user B savings uses only their rows');

  const sessionA = await createSession(userA);
  const sessionB = await createSession(userB);
  const cookieA = `${SESSION_COOKIE}=${sessionA.rawToken}`;
  const cookieB = `${SESSION_COOKIE}=${sessionB.rawToken}`;

  const signedOut = await get('/api/home/snapshot');
  assert(signedOut.status === 401, 'signed-out request is 401');
  assert(signedOut.json.error === 'Authentication required', '401 error text');
  assert(signedOut.json.code === 'UNAUTHORIZED', '401 code');

  const bad = await get('/api/home/snapshot?month=2026-13', cookieA);
  assert(bad.status === 400, 'month 13 is 400');
  assert(bad.json.error === 'month must be YYYY-MM', '400 error text');
  const padded = await get('/api/home/snapshot?month=2026-1', cookieA);
  assert(padded.status === 400, 'unpadded month is 400');
  const fullDate = await get('/api/home/snapshot?month=2026-10-01', cookieA);
  assert(fullDate.status === 400, 'a full date is not a month');

  const httpOct = await get('/api/home/snapshot?month=2026-10', cookieA);
  assert(httpOct.status === 200, 'October request is 200');
  assertShape(httpOct.json, 'http october');
  eq(Number(httpOct.json.incomeNzd), 5000, 'HTTP income');
  eq(Number(httpOct.json.spendingNzd), 2000, 'HTTP spending');
  eq(Number(httpOct.json.savingsNzd), 3000, 'HTTP savings');
  eq(Number(httpOct.json.savingsRate), 0.6, 'HTTP savings rate fraction');

  const httpB = await get('/api/home/snapshot?month=2026-10', cookieB);
  assert(httpB.status === 200, 'user B request is 200');
  eq(Number(httpB.json.incomeNzd), 9000, 'HTTP user B does not see user A income');
  eq(Number(httpB.json.spendingNzd), 10, 'HTTP user B does not see user A spending');

  const open = await get('/api/home/snapshot', cookieA);
  assert(open.status === 200, 'omitted month is 200');
  assert(open.json.yearMonth === currentYearMonth(), 'omitted month is the Auckland month');
  if (open.json.yearMonth === '2026-10') {
    eq(Number(open.json.incomeNzd), 5000, 'live October uses the October rows');
  }

  console.log('home snapshot tests passed');
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
