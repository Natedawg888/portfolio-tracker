/**
 * Projection API: auth, user isolation, formulas, debts, and missing cashflow.
 * Run: npm run test:projections
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-projections-${process.pid}-${Date.now()}.db`);
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
const { aucklandToday } = await import('../debts/model.ts');
const { completeMonthsBefore } = await import('./model.ts');
const { METAL_KINDS, metalAssetKey } = await import('../quotes/metals.ts');
const { default: projectionsRouter } = await import('../routes/projections.ts');

const userA = 'proj_user_a';
const userB = 'proj_user_b';
const userC = 'proj_user_c';
const now = '2026-10-05T00:00:00.000Z';
const asOf = aucklandToday();
const windowMonths = completeMonthsBefore(asOf, 3);

const db = await getDb();
seedCategoriesForUser(db, userA);
seedCategoriesForUser(db, userB);

function cat(userId: string, slug: string): string {
  const id = resolveCategoryId(db, userId, slug);
  if (!id) throw new Error(`missing category ${slug} for ${userId}`);
  return id;
}

const salaryA = cat(userA, 'cat-income-salary');
const foodA = cat(userA, 'cat-food');
const salaryB = cat(userB, 'cat-income-salary');

function user(id: string, email: string, preferences: string | null): void {
  run(
    db,
    `INSERT INTO users (id, email, password_hash, preferences_json, created_at, updated_at)
     VALUES (?,?,?,?,?,?)`,
    [id, email, 'hash', preferences, now, now],
  );
}

user(userA, 'a@example.com', JSON.stringify({ kiwiSaverEmployeeRatePct: 10 }));
user(userB, 'b@example.com', null);
user(userC, 'c@example.com', JSON.stringify({ kiwiSaverEmployeeRatePct: 8 }));

function account(
  id: string,
  userId: string,
  name: string,
  accountType: string,
  balance: number,
): void {
  run(
    db,
    `INSERT INTO bank_accounts
       (id, user_id, name, institution, account_type, currency, balance, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [id, userId, name, 'Kiwibank', accountType, 'NZD', balance, now, now],
  );
}

account('acct_a', userA, 'Everyday', 'cheque', 10000);
account('acct_a_card', userA, 'Card', 'credit', -200);
account('acct_b', userB, 'Everyday', 'cheque', 999999);
account('acct_c', userC, 'Everyday', 'cheque', 250);

run(
  db,
  `INSERT INTO holdings
     (id, user_id, asset_class, name, cost_basis_nzd, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?)`,
  ['hold_stock_a', userA, 'stock', 'Example', 5000, now, now],
);
run(
  db,
  `INSERT INTO holdings
     (id, user_id, asset_class, name, property_value_nzd, mortgage_outstanding_nzd, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?,?)`,
  ['hold_house_a', userA, 'real_estate', 'House', 200000, 80000, now, now],
);
run(
  db,
  `INSERT INTO kiwisaver_accounts
     (id, user_id, name, provider, balance_nzd, fund_mix_json, connection_status, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?,?,?)`,
  ['ks_a', userA, 'KiwiSaver', 'manual', 4000, '[]', 'manual', now, now],
);
run(
  db,
  `INSERT INTO kiwisaver_accounts
     (id, user_id, name, provider, balance_nzd, fund_mix_json, connection_status, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?,?,?)`,
  ['ks_b', userB, 'KiwiSaver', 'manual', 1, '[]', 'manual', now, now],
);

for (const [index, yearMonth] of windowMonths.entries()) {
  const day = `${yearMonth}-10`;
  run(
    db,
    `INSERT INTO income_records
       (id, user_id, date, amount_nzd, kind, description, category_id, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [`inc_a_${index}`, userA, day, 3000, 'cash', 'pay', salaryA, now],
  );
  run(
    db,
    `INSERT INTO transactions
       (id, user_id, account_id, date, description, amount, kind, category_id, currency, source, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [`txn_a_${index}`, userA, 'acct_a', day, 'food', -2000, 'debit', foodA, 'NZD', 'manual', now],
  );
  run(
    db,
    `INSERT INTO income_records
       (id, user_id, date, amount_nzd, kind, description, category_id, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [`inc_b_${index}`, userB, day, 50000, 'cash', 'pay', salaryB, now],
  );
  run(
    db,
    `INSERT INTO kiwisaver_activity
       (id, account_id, date, description, amount_nzd, source, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [`ksact_a_${index}`, 'ks_a', day, 'contribution', 150, 'manual', now],
  );
}
run(
  db,
  `INSERT INTO kiwisaver_activity
     (id, account_id, date, description, amount_nzd, source, created_at)
   VALUES (?,?,?,?,?,?,?)`,
  ['ksact_b', 'ks_b', `${windowMonths[0]}-10`, 'contribution', 9999, 'manual', now],
);

run(
  db,
  `INSERT INTO debt_people (
     id, user_id, name, kind, outstanding_nzd, created_at, updated_at,
     interest_period, interest_rate_percent, actual_payment_nzd, interest_posted_through, interest_charged_nzd
   ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ['debt_a_loan', userA, 'Loan', 'corporation', 1200, now, now, 'month', 12, 200, asOf, 0],
);
run(
  db,
  `INSERT INTO debt_people (
     id, user_id, name, kind, outstanding_nzd, created_at, updated_at, interest_charged_nzd
   ) VALUES (?,?,?,?,?,?,?,?)`,
  ['debt_a_hold', userA, 'Family', 'person', 80, now, now, 0],
);
run(
  db,
  `INSERT INTO debt_people (
     id, user_id, name, kind, outstanding_nzd, created_at, updated_at, interest_charged_nzd
   ) VALUES (?,?,?,?,?,?,?,?)`,
  ['debt_b', userB, 'Secret', 'person', 50, now, now, 0],
);

const quotedAt = new Date().toISOString();
for (const metal of METAL_KINDS) {
  run(
    db,
    `INSERT INTO price_quotes (id, asset_key, currency, price, status, source, as_of)
     VALUES (?,?,?,?,?,?,?)`,
    [`quote_${metal}`, metalAssetKey(metal), 'NZD', 1, 'ok', 'test', quotedAt],
  );
}

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => {
  if (isPublicApiPath(req.path)) return next();
  return requireAuth(req, res, next);
});
app.use('/api/projections', projectionsRouter);

const server: Server = await new Promise((resolve) => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
});
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

async function call(
  pathname: string,
  cookie?: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${pathname}`, { headers });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

type Point = {
  date: string;
  monthIndex: number;
  netWorthNzd: number;
  compoundingAssetsNzd: number;
  savingsAddedNzd: number | null;
  kiwiSaverContributionsAddedNzd: number | null;
  debtOutstandingNzd: number;
  bankLiabilitiesNzd: number;
  propertyMortgageNzd: number;
};

type DebtPath = {
  id: string;
  name: string;
  startingBalanceNzd: number;
  endingBalanceNzd: number;
  stepped: boolean;
  paysDown: boolean | null;
};

try {
  const sessionA = await createSession(userA);
  const sessionB = await createSession(userB);
  const sessionC = await createSession(userC);
  const cookieA = `${SESSION_COOKIE}=${sessionA.rawToken}`;
  const cookieB = `${SESSION_COOKIE}=${sessionB.rawToken}`;
  const cookieC = `${SESSION_COOKIE}=${sessionC.rawToken}`;

  const signedOut = await call('/api/projections');
  assert(signedOut.status === 401, 'signed-out request is 401');
  assert(signedOut.json.error === 'Authentication required', '401 error text');
  assert(signedOut.json.code === 'UNAUTHORIZED', '401 code');

  const badMonths = await call('/api/projections?months=0', cookieA);
  assert(badMonths.status === 400, 'months below 1 is 400');
  const hugeMonths = await call('/api/projections?months=361', cookieA);
  assert(hugeMonths.status === 400, 'months above 360 is 400');
  const badReturn = await call('/api/projections?annualReturnPercent=80', cookieA);
  assert(badReturn.status === 400, 'an annual return outside -50 to 50 is 400');

  const projected = await call('/api/projections?months=2&annualReturnPercent=0', cookieA);
  assert(projected.status === 200, 'signed-in projection is 200');
  const body = projected.json;
  assert(body.currency === 'NZD', 'response currency is NZD');
  assert(body.timezone === 'Pacific/Auckland', 'response timezone is Pacific/Auckland');
  assert(body.asOf === asOf, 'asOf is the Auckland date');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(String(body.asOf)), 'asOf is YYYY-MM-DD');
  const points = body.points as Point[];
  assert(Array.isArray(points) && points.length === 3, 'two months produce three points');
  for (const point of points) {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(point.date), 'point dates are YYYY-MM-DD');
  }

  const assumptions = body.assumptions as {
    annualReturnPercent: { value: number; source: string };
    monthlySavingNzd: {
      value: number | null;
      source: string;
      observedMonthlyNzd: number | null;
      incomeNzd: number | null;
      spendingNzd: number | null;
    };
    inflationPercent: { value: number | null; source: string };
    kiwiSaverContributionMonthlyNzd: { value: number | null; source: string; reason: string | null };
    dividends: { value: number | null };
    savingsGoals: { value: number | null };
  };
  eq(assumptions.annualReturnPercent.value, 0, 'the supplied return is 0');
  assert(assumptions.annualReturnPercent.source === 'query', 'a supplied return is labelled query');
  eq(assumptions.monthlySavingNzd.value, 1000, 'observed saving is 1000 a month');
  assert(assumptions.monthlySavingNzd.source === 'user_data', 'observed saving is labelled user data');
  eq(assumptions.monthlySavingNzd.observedMonthlyNzd, 1000, 'observed and applied saving match when no override is set');
  eq(assumptions.monthlySavingNzd.incomeNzd, 9000, 'window income is this user only');
  eq(assumptions.monthlySavingNzd.spendingNzd, 6000, 'window spending is this user only');
  eq(assumptions.kiwiSaverContributionMonthlyNzd.value, 150, 'KiwiSaver contributions average to 150');
  assert(
    assumptions.kiwiSaverContributionMonthlyNzd.source === 'user_data',
    'KiwiSaver contribution source is user data',
  );
  assert(
    assumptions.kiwiSaverContributionMonthlyNzd.reason == null
      || !assumptions.kiwiSaverContributionMonthlyNzd.reason.includes('10'),
    'the stored employee percent is not turned into the contribution',
  );
  assert(assumptions.inflationPercent.value == null, 'inflation is null');
  assert(assumptions.inflationPercent.source === 'default', 'inflation source is default');
  assert(assumptions.dividends.value == null, 'no separate dividend amount is added');
  assert(assumptions.savingsGoals.value == null, 'savings goals are not an input amount');

  const starting = body.starting as { netWorthNzd: number; compoundingAssetsNzd: number; kiwiSaverNzd: number | null };
  eq(starting.compoundingAssetsNzd, 219000, 'compounding assets are cash, stock cost, property, and KiwiSaver');
  eq(starting.kiwiSaverNzd, 4000, 'KiwiSaver balance comes from this user');
  eq(starting.netWorthNzd, 137520, 'starting net worth subtracts the card, debts, and mortgage');
  eq(points[0].netWorthNzd, 137520, 'month 0 matches the starting net worth');
  eq(points[1].compoundingAssetsNzd, 220150, 'month 1 adds saving and the KiwiSaver contribution');
  eq(points[1].debtOutstandingNzd, 1092, 'month 1 debt is the stepped loan plus the held balance');
  eq(points[1].netWorthNzd, 138858, 'month 1 net worth follows the formula');
  eq(points[1].savingsAddedNzd, 1000, 'one month of saving is added');
  eq(points[1].kiwiSaverContributionsAddedNzd, 150, 'one month of KiwiSaver contribution is added');
  eq(points[1].bankLiabilitiesNzd, -200, 'the card balance stays at the recorded amount');
  eq(points[1].propertyMortgageNzd, 80000, 'the mortgage stays at the recorded amount');
  eq(points[2].compoundingAssetsNzd, 221300, 'month 2 adds saving and the contribution again');
  eq(points[2].debtOutstandingNzd, 902.12, 'month 2 loan interest is 10.12');
  eq(points[2].netWorthNzd, 140197.88, 'month 2 net worth follows the formula');

  const debts = body.debts as DebtPath[];
  assert(debts.length === 2, 'only this user\'s debts are listed');
  assert(debts.every((debt) => debt.name !== 'Secret'), 'the other user\'s debt is absent');
  const loan = debts.find((debt) => debt.id === 'debt_a_loan');
  const family = debts.find((debt) => debt.id === 'debt_a_hold');
  assert(loan != null && family != null, 'both of this user\'s debts are present');
  eq(loan.endingBalanceNzd, 822.12, 'the loan balance follows interest then payment');
  assert(loan.stepped === true && loan.paysDown === true, 'the loan is stepped and pays down');
  eq(family.endingBalanceNzd, 80, 'a debt with no payment is held');
  assert(family.stepped === false, 'a debt with no payment is not stepped');

  const text = JSON.stringify(body).toLowerCase();
  assert(!/\b(buy|sell|recommend)\b/.test(text), 'the response does not use buy, sell, or recommend');

  const other = await call('/api/projections?months=1&annualReturnPercent=0', cookieB);
  assert(other.status === 200, 'the other user can read their own projection');
  const otherStart = other.json.starting as { netWorthNzd: number };
  const otherDebts = other.json.debts as DebtPath[];
  const otherSaving = (other.json.assumptions as { monthlySavingNzd: { value: number | null } }).monthlySavingNzd;
  eq(otherStart.netWorthNzd, 999950, 'the other user\'s net worth is their cash, KiwiSaver, and debt');
  eq(otherSaving.value, 50000, 'the other user\'s saving rate is their own income');
  assert(otherDebts.length === 1 && otherDebts[0].name === 'Secret', 'the other user sees only their debt');
  assert(
    !JSON.stringify(other.json).includes('Family') && !JSON.stringify(other.json).includes('debt_a_loan'),
    'the other user does not receive this user\'s debts',
  );

  const empty = await call('/api/projections?months=2', cookieC);
  assert(empty.status === 200, 'a user with no cashflow still gets a projection');
  const emptySaving = (empty.json.assumptions as {
    monthlySavingNzd: { value: number | null; source: string; reason: string | null };
    annualReturnPercent: { value: number; source: string };
    kiwiSaverContributionMonthlyNzd: { value: number | null; reason: string | null };
  });
  assert(emptySaving.monthlySavingNzd.value == null, 'missing cashflow leaves the saving amount null');
  assert(emptySaving.monthlySavingNzd.source === 'user_data', 'the missing saving amount is labelled user data');
  assert(
    emptySaving.monthlySavingNzd.reason != null && emptySaving.monthlySavingNzd.reason.includes(asOf),
    'the missing saving amount includes a reason',
  );
  assert(emptySaving.annualReturnPercent.value === 0, 'an omitted return stays at the labelled default');
  assert(emptySaving.annualReturnPercent.source === 'default', 'the omitted return source is default');
  assert(emptySaving.kiwiSaverContributionMonthlyNzd.value == null, 'an employee percent does not become a contribution');
  assert(empty.json.savings && (empty.json.savings as { points: unknown }).points == null, 'the saving series is null');
  const emptyPoints = empty.json.points as Point[];
  assert(emptyPoints.length === 3, 'the default-return series still has a point per month');
  for (const point of emptyPoints) {
    eq(point.netWorthNzd, 250, 'no saving is invented onto the cash balance');
  }

  const overridden = await call(
    '/api/projections?months=1&monthlySavingNzd=10&annualReturnPercent=12',
    cookieC,
  );
  assert(overridden.status === 200, 'an explicit saving amount is accepted');
  const overriddenPoints = overridden.json.points as Point[];
  const overriddenSaving = (overridden.json.assumptions as {
    monthlySavingNzd: { value: number | null; source: string; observedMonthlyNzd: number | null };
  }).monthlySavingNzd;
  eq(overriddenSaving.value, 10, 'the query saving amount is the one applied');
  assert(overriddenSaving.source === 'query', 'the explicit saving amount is labelled query');
  assert(overriddenSaving.observedMonthlyNzd == null, 'the observed amount stays null beside the override');
  eq(overriddenPoints[1].compoundingAssetsNzd, 262.5, '12% monthly compound then the explicit saving');
  eq(overriddenPoints[1].netWorthNzd, 262.5, 'net worth matches the compounded cash');

  console.log('projection api tests ok');
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
