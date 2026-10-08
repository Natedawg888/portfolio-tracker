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

// Live GoMining and BTC feeds are stubbed: 60 sat/TH/day at BTC $100,000 (NZD 170,000), kWh $0.05.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('api.gomining.com')) {
    return new Response(JSON.stringify({ data: { totalIncomePerThToday: 0.06, btcCourseInUsd: 100000, c1ValuePerThPerWtToday: 0.0012, c2ValuePerThToday: 0.0089, id: 1, createdAt: '2026-10-08T00:00:00Z' } }), { status: 200 });
  }
  if (url.includes('coingecko')) {
    return new Response(JSON.stringify({ bitcoin: { usd: 100000, nzd: 170000 } }), { status: 200 });
  }
  return realFetch(input as Parameters<typeof fetch>[0], init);
}) as typeof fetch;

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

  // Per-class growth: money moved to the Investments category goes to shares, out of cash.
  type Cls = { key: string; startNzd: number; endNzd: number; annualReturnPercent: number; returnSource: string; monthlyAdditionNzd: number | null; additionSource: string };
  const invA = cat(userA, 'cat-investments');
  for (const [index, yearMonth] of windowMonths.entries()) {
    run(
      db,
      `INSERT INTO transactions
         (id, user_id, account_id, date, description, amount, kind, category_id, currency, source, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [`txn_inv_a_${index}`, userA, 'acct_a', `${yearMonth}-12`, 'Sharesies top-up', -500, 'debit', invA, 'NZD', 'manual', now],
    );
  }
  const byClass = (json: Record<string, unknown>) =>
    Object.fromEntries((json.assetClasses as Cls[]).map((c) => [c.key, c])) as Record<string, Cls>;
  const perClass = await call('/api/projections?months=1', cookieA);
  assert(perClass.status === 200, 'per-class projection is 200');
  const pc = byClass(perClass.json);
  assert(Object.keys(pc).join(',') === 'cash,shares,kiwiSaver,crypto,mining,metals,property,other', 'all classes listed in order');
  eq(pc.shares.startNzd, 5000, 'shares start at the holding value');
  eq(pc.kiwiSaver.startNzd, 4000, 'KiwiSaver starts at its balance');
  eq(pc.property.startNzd, 200000, 'property starts at its value');
  eq(pc.cash.startNzd, 10000, 'cash is bank balances (credit card stays a flat liability)');
  eq(pc.shares.monthlyAdditionNzd, 500, 'Investments transfers average 500 a month into shares');
  assert(pc.shares.additionSource === 'user_data', 'shares addition is from the user’s data');
  eq(pc.cash.monthlyAdditionNzd, 500, 'cash gets saving 1000 less the 500 invested');
  eq(pc.kiwiSaver.monthlyAdditionNzd, 150, 'KiwiSaver gets its observed contributions, not taken from cash');
  const pcPoints = perClass.json.points as Array<Point & { byClassNzd: Record<string, number> }>;
  const startSum = Object.values(pcPoints[0].byClassNzd).reduce((a, b) => a + b, 0);
  eq(startSum, pcPoints[0].compoundingAssetsNzd, 'classes add up to compounding assets');
  eq(pcPoints[1].compoundingAssetsNzd - pcPoints[0].compoundingAssetsNzd, 1150, 'at 0% the month adds saving + KiwiSaver, investing is not double counted');

  const shares12 = await call('/api/projections?months=1&returnShares=12&returnCrypto=-10', cookieA);
  const s12 = byClass(shares12.json);
  eq(s12.shares.annualReturnPercent, 12, 'shares use their own return');
  assert(s12.shares.returnSource === 'query', 'shares return labelled query');
  eq(s12.shares.endNzd, 5550, '5000 × 1.01 + 500');
  eq(s12.cash.annualReturnPercent, 0, 'cash keeps the 0% default');
  assert((await call('/api/projections?returnShares=80', cookieA)).status === 400, 'class return out of range is 400');
  assert((await call('/api/projections?addCrypto=abc', cookieA)).status === 400, 'class addition must be a number');

  const withDefault = byClass((await call('/api/projections?months=1&annualReturnPercent=6&returnShares=12', cookieA)).json);
  eq(withDefault.property.annualReturnPercent, 6, 'classes without their own return use the default');
  eq(withDefault.shares.annualReturnPercent, 12, 'a class return beats the default');

  const added = byClass((await call('/api/projections?months=1&addCrypto=200&addShares=300', cookieA)).json);
  eq(added.crypto.monthlyAdditionNzd, 200, 'crypto monthly addition from the scenario');
  eq(added.shares.monthlyAdditionNzd, 300, 'shares addition overridden');
  eq(added.cash.monthlyAdditionNzd, 500, 'cash = saving 1000 − 300 shares − 200 crypto');

  // Saved per-user defaults.
  const put = await fetch(`${base}/api/projections/assumptions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookieA },
    body: JSON.stringify({ returns: { shares: 7, crypto: 15, bogus: 3, metals: 999 }, contributions: { mining: 50 } }),
  });
  const savedBody = (await put.json()) as { returns: Record<string, number>; contributions: Record<string, number> };
  assert(put.status === 200 && savedBody.returns.shares === 7 && savedBody.returns.crypto === 15, 'saved returns');
  assert(!('bogus' in savedBody.returns) && !('metals' in savedBody.returns), 'unknown classes and out-of-range values dropped');
  const usesSaved = byClass((await call('/api/projections?months=1', cookieA)).json);
  eq(usesSaved.shares.annualReturnPercent, 7, 'saved shares return used');
  assert(usesSaved.shares.returnSource === 'saved', 'labelled saved');
  eq(usesSaved.mining.monthlyAdditionNzd, 50, 'saved mining addition used');
  eq(usesSaved.cash.monthlyAdditionNzd, 500, 'mining rewards are not taken out of cash');
  const queryWins = byClass((await call('/api/projections?months=1&returnShares=2', cookieA)).json);
  eq(queryWins.shares.annualReturnPercent, 2, 'scenario beats saved');
  const savedB = await call('/api/projections/assumptions', cookieB);
  assert(JSON.stringify(savedB.json) === JSON.stringify({ returns: {}, contributions: {}, mining: {} }), 'saved assumptions are per user');
  const bClasses = byClass((await call('/api/projections?months=1', cookieB)).json);
  eq(bClasses.shares.annualReturnPercent, 0, 'user B does not get user A’s saved return');

  // GoMining: rewards from the live model; adding TH or better W/TH raises them.
  const { calcPerThSatDay, PERIOD_DAYS } = await import('../../src/lib/gominingEarnings.ts');
  const putJson = (pathname: string, body: unknown) =>
    fetch(`${base}${pathname}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookieA }, body: JSON.stringify(body) });
  await putJson('/api/projections/assumptions', {});
  type Mining = { status: string; reason: string | null; projection: { start: { monthlyNetNzd: number; th: number }; totals: { endTh: number; increaseNzd: number; rewardNzd: number; spendNzd: number }; months: Array<{ rewardNzd: number }> } | null; inputs: { recordedMiningIncomeMonthlyNzd: number } | null };
  const noMiners = (await call('/api/projections?months=12', cookieA)).json.mining as Mining;
  assert(noMiners.status === 'no_miners', 'no miners → no mining projection');
  run(
    db,
    `INSERT INTO holdings (id, user_id, asset_class, name, hashrate_ths, energy_efficiency_wth, estimated_value_nzd, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    ['hold_miner_a', userA, 'gomining_miner', 'Miner', 100, 20, 3000, now, now],
  );
  const perThSat = calcPerThSatDay({ energyEfficiencyWth: 20, discountPct: 0, btcUsd: 100000, kWhCostUsd: 0.05, poolIncomeBtcPerTh: 0.0000006, goBtcPaySatPerTh: 0 }).netSat ?? 0;
  const expectedMonthlyNzd = ((perThSat * 100 * PERIOD_DAYS.month) / 1e8) * 170000;
  const mined = await call('/api/projections?months=12', cookieA);
  const m1 = mined.json.mining as Mining;
  assert(m1.status === 'ok', `mining projected (${m1.reason})`);
  eq(Math.round(m1.projection!.start.monthlyNetNzd * 100) / 100, Math.round(expectedMonthlyNzd * 100) / 100, 'monthly reward = GoMining formula × TH × days × BTC/NZD');
  const mc = byClass(mined.json);
  eq(mc.mining.startNzd, 3000, 'miner value is the mining class');
  eq(Math.round((mc.crypto.monthlyAdditionNzd ?? 0) * 100) / 100, Math.round(expectedMonthlyNzd * 100) / 100, 'rewards kept as BTC go to crypto (no price change)');
  eq(mc.cash.monthlyAdditionNzd, 500, 'cash unchanged when rewards are kept as BTC');

  const addTh = await call('/api/projections?months=12&miningAddTh=10&miningThPrice=30', cookieA);
  const ma = addTh.json.mining as Mining;
  eq(ma.projection!.totals.endTh, 220, '10 TH added each month for a year');
  assert(ma.projection!.totals.increaseNzd > 0, 'adding TH increases rewards');
  const ac = byClass(addTh.json);
  eq(ac.mining.monthlyAdditionNzd, 300, 'TH bought (10 × $30) adds to miner value');
  eq(ac.cash.monthlyAdditionNzd, 200, 'and is paid from cash (500 − 300)');

  const upgrade = await call('/api/projections?months=12&miningUpgradeWth=15', cookieA);
  const mu = upgrade.json.mining as Mining;
  assert(mu.projection!.totals.increaseNzd > 0, 'better W/TH increases rewards');
  assert(mu.projection!.months[0].rewardNzd > m1.projection!.months[0].rewardNzd, 'from the first month');

  const reinvest = await call('/api/projections?months=12&miningRewardsTo=reinvest&miningThPrice=30', cookieA);
  const mr = reinvest.json.mining as Mining;
  assert(mr.projection!.totals.endTh > 100, 'reinvested rewards buy TH');
  const rc = byClass(reinvest.json);
  assert(rc.crypto.monthlyAdditionNzd == null, 'reinvested rewards do not go to crypto');
  assert((rc.mining.monthlyAdditionNzd ?? 0) > 0, 'they add to miner value');

  const toCash = byClass((await call('/api/projections?months=12&miningRewardsTo=cash', cookieA)).json);
  assert((toCash.cash.monthlyAdditionNzd ?? 0) > 500, 'rewards sold to cash add to cash');

  assert((await call('/api/projections?miningRewardsTo=moon', cookieA)).status === 400, 'bad rewards target is 400');
  assert((await call('/api/projections?miningUpgradeWth=0', cookieA)).status === 400, 'W/TH out of range is 400');

  // Mining income already recorded in the budget comes off cash (no double count).
  const miningCat = cat(userA, 'cat-income-mining');
  for (const [index, yearMonth] of windowMonths.entries()) {
    run(
      db,
      `INSERT INTO income_records (id, user_id, date, amount_nzd, kind, description, category_id, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [`inc_mine_a_${index}`, userA, `${yearMonth}-15`, 90, 'cash', 'GoMining', miningCat, now],
    );
  }
  const recorded = await call('/api/projections?months=12', cookieA);
  const rec = recorded.json.mining as Mining;
  eq(rec.inputs!.recordedMiningIncomeMonthlyNzd, 90, 'recorded mining income averages 90 a month');
  const recClasses = byClass(recorded.json);
  eq(recClasses.cash.monthlyAdditionNzd, 500, 'saving rose by 90 (1090 − 500 invested) and the 90 is taken back off cash');

  const savedPlan = await putJson('/api/projections/assumptions', { mining: { addThPerMonth: 5, thPriceNzd: 30, rewardsTo: 'reinvest' } });
  assert(savedPlan.status === 200, 'mining plan saved');
  const usesPlan = (await call('/api/projections?months=12', cookieA)).json.mining as Mining & { plan: { rewardsTo: string; addThPerMonth?: number } };
  assert(usesPlan.plan.rewardsTo === 'reinvest' && usesPlan.plan.addThPerMonth === 5, 'saved plan applies');
  const planB = (await call('/api/projections?months=12', cookieB)).json.mining as Mining;
  assert(planB.status === 'no_miners', 'user B has no miners and no plan');

  console.log('projection api tests ok');
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
