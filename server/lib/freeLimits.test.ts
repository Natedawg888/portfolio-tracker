/**
 * Free plan limits: one bank account, no new category budgets, no net worth, no CSV import.
 * Rows that already exist stay readable. Run: npm run test:plans
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-freelimits-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');
process.env.AUTH_ENCRYPTION_KEY = 'e'.repeat(64);
delete process.env.PLAN_PLUS_EMAILS;
delete process.env.PLAN_PRO_EMAILS;
delete process.env.PLAN_BUSINESS_EMAILS;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run } = await import('../db/index.ts');
const { setPlan } = await import('./entitlements.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser } = await import('../middleware/requireAuth.ts');
const { default: accountsRouter } = await import('../routes/accounts.ts');
const { default: budgetsRouter } = await import('../routes/budgets.ts');
const { default: summaryRouter } = await import('../routes/summary.ts');
const { default: settingsRouter } = await import('../routes/settings.ts');
const { parseRunsBusiness, mergeRunsBusinessIntoPreferencesJson } = await import('../../src/lib/runsBusiness.ts');

const now = '2026-11-16T00:00:00.000Z';
const db = await getDb();
for (const [id, email] of [
  ['free', 'free@example.com'],
  ['plus', 'plus@example.com'],
]) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, created_at, updated_at) VALUES (?,?,?,?,?,?)`, [id, email, 'hash', 'X', now, now]);
}
setPlan(db, 'plus', 'plus', 'test');
run(
  db,
  `INSERT INTO bank_accounts (id, user_id, name, institution, account_type, currency, balance, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ['acct_old', 'free', 'Everyday', '', 'cheque', 'NZD', 10, null, now, now],
);
run(db, `INSERT INTO budget_categories (id, user_id, slug, name, type, is_income, sort_order) VALUES ('cat','free','cat','Food','spending',0,1)`);
run(
  db,
  `INSERT INTO budgets (id, user_id, category_id, period_start, period_end, amount_nzd, notes) VALUES (?,?,?,?,?,?,?)`,
  ['bud_old', 'free', 'cat', '2026-11-01', '2026-11-30', 100, null],
);

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api/accounts', accountsRouter);
app.use('/api/budgets', budgetsRouter);
app.use('/api', summaryRouter);
app.use('/api/settings', settingsRouter);

let server: Server | null = null;
try {
  assert(parseRunsBusiness(null) === false, 'missing preferences are not a business');
  const saved = mergeRunsBusinessIntoPreferencesJson(JSON.stringify({ usageMode: 'personal', onboarding: { planStepDone: false } }), true);
  assert(parseRunsBusiness(saved) === true && JSON.parse(saved).usageMode === 'personal', 'the tick is saved beside other preferences');
  assert(parseRunsBusiness(mergeRunsBusinessIntoPreferencesJson(saved, false)) === false, 'unticking clears it');

  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = async (id: string) => `${SESSION_COOKIE}=${(await createSession(id)).rawToken}`;
  const call = async (method: string, p: string, c: string, body?: unknown) => {
    const r = await fetch(`${base}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: c },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  };

  const free = await cookie('free');
  const plus = await cookie('plus');
  const listed = await call('GET', '/api/accounts', free);
  assert(listed.status === 200 && Array.isArray(listed.json) && (listed.json as unknown[]).length === 1, 'the existing account is still listed');
  const second = await call('POST', '/api/accounts', free, { name: 'Savings' });
  assert(second.status === 402 && second.json.code === 'PLAN_LIMIT', 'a second account is refused on Free');
  assert((await call('POST', '/api/accounts', plus, { name: 'Savings' })).status === 201, 'Plus can add another account');

  const plans = await call('GET', '/api/budgets', free);
  assert(plans.status === 200 && Array.isArray(plans.json) && (plans.json as unknown[]).length === 1, 'the existing category budget is still listed');
  const created = await call('POST', '/api/budgets', free, { categoryId: 'cat', periodStart: '2026-12-01', periodEnd: '2026-12-31', amountNzd: 20 });
  assert(created.status === 402 && created.json.code === 'PLAN_LIMIT', 'a new category budget is refused on Free');
  const upsert = await call('PUT', '/api/budgets/plan', free, { categoryId: 'cat', yearMonth: '2026-12', amountNzd: 20 });
  assert(upsert.status === 402 && upsert.json.code === 'PLAN_LIMIT', 'a new month plan is refused on Free');
  assert((await call('GET', '/api/net-worth', free)).json.code === 'NET_WORTH_REQUIRED', 'Free net worth is locked');
  assert((await call('GET', '/api/net-worth', plus)).status === 200, 'Plus net worth loads');
  const csv = await call('POST', '/api/accounts/transactions/import-wallet-csv', free, { csvText: 'a,b', accountId: 'acct_old' });
  assert(csv.status === 402 && csv.json.code === 'PLAN_LIMIT', 'CSV import is refused on Free');

  const flag = await call('PUT', '/api/settings/runs-business', free, { runsBusiness: true });
  assert(flag.status === 200 && flag.json.runsBusiness === true && flag.json.businessCreated === false, 'Free can save the tick without opening a business');
  assert((await call('PUT', '/api/settings/runs-business', free, { runsBusiness: 'yes' })).status === 400, 'a non-boolean tick is refused');

  console.log('free limits: ok');
} finally {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  fs.rmSync(dataDir, { recursive: true, force: true });
}
