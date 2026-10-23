/**
 * Profit & loss (KAN-126): a tax year matches businessTotals exactly, invoice payments aren't
 * counted twice with the deposits they match, lines by category, months, invoice figures, a
 * custom period, the Business plan gate, archived businesses and isolation.
 * Run: npm run test:business
 *
 * Uses a throwaway sqlite file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-pnl-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
delete process.env.PUBLIC_URL;
delete process.env.RESEND_API_KEY;
delete process.env.PLAN_BUSINESS_EMAILS;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
const near = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) < 0.005;

const { getDb, queryOne, run } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { aucklandToday } = await import('../debts/model.ts');
const { linkMirroredIncomeToBankCredits } = await import('../lib/incomeBankLink.ts');
const { setPlan } = await import('../lib/entitlements.ts');
const { taxYearOf, taxYearRange } = await import('../../src/lib/business.ts');
const { addDays } = await import('../../src/lib/nzTime.ts');
const { businessTotals } = await import('./store.ts');
const { businessRow } = await import('./profile.ts');
const { monthsBetween } = await import('./profitLoss.ts');
const { default: invoicesRouter } = await import('../routes/invoices.ts');
const { default: businessRouter } = await import('../routes/business.ts');

const now = new Date().toISOString();
const today = aucklandToday();
const year = taxYearOf(today);
const userA = 'pnl_a';
const userB = 'pnl_b';
const userFree = 'pnl_free';
const db = await getDb();
for (const [id, email] of [[userA, 'a@example.com'], [userB, 'b@example.com'], [userFree, 'f@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, created_at, updated_at) VALUES (?,?,?,?,?,?)`, [id, email, 'hash', 'X', now, now]);
}
setPlan(db, userA, 'business', 'test');
setPlan(db, userB, 'business', 'test');

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/invoices', invoicesRouter);
app.use('/api/business', businessRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

type Json = Record<string, any>;
async function call(method: string, p: string, cookie: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { Accept: 'application/json', Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Json) : {} };
}
function addTxn(userId: string, id: string, date: string, amount: number, description: string, kind?: string, extra: { category_id?: string; business_category_id?: string } = {}): void {
  run(
    db,
    `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, currency, created_at, source, category_id, business_category_id)
     VALUES (?,?,NULL,?,?,?,?, 'NZD', ?, 'akahu', ?, ?)`,
    [id, userId, date, description, amount, kind ?? (amount < 0 ? 'debit' : 'credit'), now, extra.category_id ?? null, extra.business_category_id ?? null],
  );
}

try {
  const A = `${SESSION_COOKIE}=${(await createSession(userA)).rawToken}`;
  const B = `${SESSION_COOKIE}=${(await createSession(userB)).rawToken}`;
  const F = `${SESSION_COOKIE}=${(await createSession(userFree)).rawToken}`;
  const tag = async (kind: 'transaction' | 'income', id: string, businessId: string) =>
    assert((await call('POST', '/api/business/money/tag', A, { kind, id, businessId })).status === 200, `tagged ${id}`);

  const biz = (await call('POST', '/api/business', A, { name: 'Kōwhai Honey', type: 'sole_trader' })).json.id as string;
  const client = (await call('POST', '/api/invoices/clients', A, { businessId: biz, name: 'Hive & Co' })).json.id as string;
  run(db, `INSERT INTO business_budget_categories (id, user_id, business_id, name, kind, role, created_at, updated_at) VALUES ('bc_stock', ?, ?, 'Stock', 'expense', 'stock', ?, ?)`, [userA, biz, now, now]);
  run(db, `INSERT INTO business_budget_categories (id, user_id, business_id, name, kind, role, created_at, updated_at) VALUES ('bc_gate', ?, ?, 'Gate sales', 'income', NULL, ?, ?)`, [userA, biz, now, now]);
  run(db, `INSERT INTO budget_categories (id, user_id, name, type) VALUES ('cat_fuel', ?, 'Fuel', 'spending')`, [userA]);
  run(db, `INSERT INTO budget_categories (id, user_id, name, type, is_income) VALUES ('cat_grants', ?, 'Grants', 'income', 1)`, [userA]);

  // 1. Invoice paid into Income, and the deposit for it tagged too: counted once, as the invoice.
  const inv1 = (await call('POST', '/api/invoices', A, { businessId: biz, clientId: client, clientName: 'Hive & Co', issueDate: today, duePreset: 'days_14', gstMode: 'inclusive', lines: [{ description: 'Honey', quantity: 50, unit: 'jar', rate: 23 }] })).json;
  await call('POST', `/api/invoices/${inv1.id}/mark-sent`, A);
  await call('POST', `/api/invoices/${inv1.id}/payments`, A, { date: today, amountNzd: 1150, method: 'Bank transfer', addToIncome: true });
  addTxn(userA, 'dep_inv1', today, 1150, 'HIVE CO');
  linkMirroredIncomeToBankCredits(db, userA);
  await tag('transaction', 'dep_inv1', biz);

  // 2. Invoice paid without an income row, and a tagged deposit that matches it: still once.
  const inv2 = (await call('POST', '/api/invoices', A, { businessId: biz, clientId: client, clientName: 'Hive & Co', issueDate: addDays(today, -5), duePreset: 'days_14', gstMode: 'inclusive', lines: [{ description: 'Wax', quantity: 1, unit: 'kg', rate: 200 }] })).json;
  await call('POST', `/api/invoices/${inv2.id}/mark-sent`, A);
  await call('POST', `/api/invoices/${inv2.id}/payments`, A, { date: addDays(today, -3), amountNzd: 200, method: 'Bank transfer', addToIncome: false });
  addTxn(userA, 'dep_inv2', addDays(today, -2), 200, 'HIVE CO WAX');
  await tag('transaction', 'dep_inv2', biz);

  // 3. Tagged income with no invoice, in an income category.
  run(db, `INSERT INTO income_records (id, user_id, date, amount_nzd, description, category_id, created_at) VALUES ('inc_grant', ?, ?, 500, 'Regional grant', 'cat_grants', ?)`, [userA, addDays(today, -10), now]);
  await tag('income', 'inc_grant', biz);

  // 4. Tagged deposits: one in a business category, one in none.
  addTxn(userA, 'dep_gate', addDays(today, -1), 60, 'Gate sales', undefined, { business_category_id: 'bc_gate' });
  addTxn(userA, 'dep_misc', addDays(today, -1), 15, 'Refund');
  await tag('transaction', 'dep_gate', biz);
  await tag('transaction', 'dep_misc', biz);
  // A business category is set after tagging (tagging onto a business clears one from elsewhere).
  run(db, `UPDATE transactions SET business_category_id = 'bc_gate' WHERE id = 'dep_gate'`);

  // 5. Expenses: business category, budget category, none; a transfer is neither.
  addTxn(userA, 'deb_jars', addDays(today, -4), -230.5, 'Jar supplier', undefined, { business_category_id: 'bc_stock', category_id: 'cat_fuel' });
  addTxn(userA, 'deb_fuel', addDays(today, -4), -40, 'Z Energy', undefined, { category_id: 'cat_fuel' });
  addTxn(userA, 'deb_misc', addDays(today, -4), -12, 'Something');
  addTxn(userA, 'xfer', addDays(today, -4), -500, 'To savings', 'transfer');
  for (const id of ['deb_jars', 'deb_fuel', 'deb_misc', 'xfer']) await tag('transaction', id, biz);
  run(db, `UPDATE transactions SET business_category_id = 'bc_stock' WHERE id = 'deb_jars'`);

  // 6. Last tax year, and an untagged debit: neither is in this year's P&L.
  addTxn(userA, 'old_sale', taxYearRange(year - 1).start, 999, 'Last year');
  await tag('transaction', 'old_sale', biz);
  addTxn(userA, 'groceries', today, -80, 'Supermarket');

  // 7. Overdue: sent 40 days ago, due in 14, unpaid.
  const inv3 = (await call('POST', '/api/invoices', A, { businessId: biz, clientId: client, clientName: 'Hive & Co', issueDate: addDays(today, -40), duePreset: 'days_14', gstMode: 'inclusive', lines: [{ description: 'Late', quantity: 1, unit: 'each', rate: 300 }] })).json;
  await call('POST', `/api/invoices/${inv3.id}/mark-sent`, A);

  // The P&L for the tax year.
  const pnl = await call('GET', `/api/business/${biz}/profit-loss?taxYear=${year}`, A);
  assert(pnl.status === 200, `P&L (${pnl.status} ${pnl.json.error ?? ''})`);
  const p = pnl.json;
  const totals = businessTotals(db, userA, businessRow(db, userA, biz)!, year, today);
  assert(near(p.incomeNzd, totals.incomeNzd) && near(p.expensesNzd, totals.expensesNzd) && near(p.netNzd, totals.netNzd), `matches businessTotals (${p.incomeNzd}/${totals.incomeNzd}, ${p.expensesNzd}/${totals.expensesNzd})`);
  assert(near(p.incomeNzd, 1150 + 200 + 500 + 60 + 15), `income counts each dollar once (got ${p.incomeNzd})`);
  assert(near(p.expensesNzd, 230.5 + 40 + 12), `expenses leave out the transfer and untagged money (got ${p.expensesNzd})`);
  const sumLines = (ls: Json[]) => ls.reduce((s: number, l: Json) => s + l.amountNzd, 0);
  assert(near(sumLines(p.income), p.incomeNzd) && near(sumLines(p.expenses), p.expensesNzd), 'lines add up to the totals');
  const line = (ls: Json[], label: string) => ls.find((l: Json) => l.label === label);
  assert(near(line(p.income, 'Invoice payments')?.amountNzd, 1350) && line(p.income, 'Invoice payments')?.count === 2 && line(p.income, 'Invoice payments')?.source === 'invoice', 'invoice payments line');
  assert(near(line(p.income, 'Grants')?.amountNzd, 500) && line(p.income, 'Grants')?.source === 'income', 'tagged income by its category');
  assert(near(line(p.income, 'Gate sales')?.amountNzd, 60) && near(line(p.income, 'Bank deposits')?.amountNzd, 15), 'deposits by business category, else Bank deposits');
  assert(near(line(p.expenses, 'Stock')?.amountNzd, 230.5), 'a business category wins over the budget category');
  assert(near(line(p.expenses, 'Fuel')?.amountNzd, 40) && near(line(p.expenses, 'Uncategorised')?.amountNzd, 12), 'budget category, else Uncategorised');
  assert(!p.income.some((l: Json) => /HIVE|1150/.test(l.label)) && !line(p.expenses, 'To savings'), 'no double-counted deposit, no transfer line');
  assert(p.taxYear === year && p.start === taxYearRange(year).start && p.end === taxYearRange(year).end, 'tax year period');
  assert(p.months.length === 12 && p.months[0].month === taxYearRange(year).start.slice(0, 7), 'twelve months from April');
  assert(near(p.months.reduce((s: number, m: Json) => s + m.incomeNzd, 0), p.incomeNzd) && near(p.months.reduce((s: number, m: Json) => s + m.expensesNzd, 0), p.expensesNzd), 'months add up to the totals');
  assert(near(p.invoices.paidNzd, 1350), 'paid in the period');
  assert(p.invoices.overdueCount === 1 && near(p.invoices.overdueNzd, 300) && p.invoices.outstandingCount === 1 && near(p.invoices.outstandingNzd, 300), 'overdue and outstanding');

  // The business page carries the same invoice figures, on every plan.
  const detail = await call('GET', `/api/business/${biz}?taxYear=${year}`, A);
  assert(detail.json.invoiceFigures.overdueCount === 1 && near(detail.json.invoiceFigures.paidNzd, 1350), 'invoice figures on the business page');

  // A custom period: just the last week.
  const week = (await call('GET', `/api/business/${biz}/profit-loss?from=${addDays(today, -6)}&to=${today}`, A)).json;
  assert(week.taxYear === null && near(week.incomeNzd, 1150 + 200 + 60 + 15) && near(week.expensesNzd, 282.5), `custom period (got ${week.incomeNzd}, ${week.expensesNzd})`);
  assert((await call('GET', `/api/business/${biz}/profit-loss?from=${today}&to=${addDays(today, -1)}`, A)).status === 400, 'to before from is refused');
  assert((await call('GET', `/api/business/${biz}/profit-loss?from=${today}`, A)).status === 400, 'a custom period needs both dates');
  assert((await call('GET', `/api/business/${biz}/profit-loss?from=2020-01-01&to=2026-01-01`, A)).status === 400, 'more than three years is refused');
  assert(monthsBetween('2026-11-15', '2027-02-01').join() === '2026-11,2026-12,2027-01,2027-02', 'months across a year end');

  // Plan gate, isolation, archive.
  const free = await call('GET', `/api/business/${biz}/profit-loss`, F);
  assert(free.status === 402 && free.json.code === 'BUSINESS_PLAN_REQUIRED', 'without the Business plan: 402');
  assert((await call('GET', `/api/business/${biz}/profit-loss`, B)).status === 404, "B can't see A's P&L");
  const second = (await call('POST', '/api/business', A, { name: 'Side gig', type: 'sole_trader' })).json.id as string;
  assert((await call('POST', `/api/business/${second}/archive`, A)).status === 200, 'second business archived');
  assert((await call('GET', `/api/business/${second}/profit-loss`, A)).status === 409, 'an archived business has no reports');
  await call('POST', `/api/business/${second}/restore`, A);
  assert((await call('GET', `/api/business/${second}/profit-loss`, A)).status === 200, 'restored, its reports are back');
  assert(queryOne(db, `SELECT 1 AS x FROM transactions WHERE id = 'groceries' AND business_id IS NULL`), 'untagged money stays untagged');

  console.log('profit & loss: ok');
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  for (const suffix of ['', '.tmp', '-wal', '-shm']) {
    const f = `${dbPath}${suffix}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}
