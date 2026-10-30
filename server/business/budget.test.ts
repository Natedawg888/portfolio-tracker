/**
 * Business budget, wages and paid bills (KAN-121): default categories; actuals from sales,
 * invoice payments, paid bills (stock less freight, delivery), wages and categorised bank
 * transactions, each counted once; gross and net profit; plans per month or year; category
 * rules; bills and wages in the totals, P&L and GST; isolation.
 * Run: npm run test:business
 *
 * Uses a throwaway sqlite file.
 */
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-budget-${process.pid}-${Date.now()}.db`);
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
const { setPlan } = await import('../lib/entitlements.ts');
const { taxYearOf, taxYearRange } = await import('../../src/lib/business.ts');
const { default: invoicesRouter } = await import('../routes/invoices.ts');
const { default: businessRouter } = await import('../routes/business.ts');

const now = new Date().toISOString();
const today = aucklandToday();
const year = taxYearOf(today);
const month = today.slice(0, 7);
const userA = 'budget_a';
const userB = 'budget_b';
const db = await getDb();
for (const [id, email] of [[userA, 'ba@example.com'], [userB, 'bb@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, created_at, updated_at) VALUES (?,?,?,?,?,?)`, [id, email, 'hash', 'X', now, now]);
}
setPlan(db, userA, 'business', 'test');

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
  return { status: res.status, json: text && (res.headers.get('content-type') ?? '').includes('json') ? (JSON.parse(text) as Json) : {} };
}
function addTxn(id: string, amount: number, description: string): void {
  run(db, `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, currency, created_at, source) VALUES (?,?,NULL,?,?,?,?, 'NZD', ?, 'akahu')`, [
    id, userA, today, description, amount, amount < 0 ? 'debit' : 'credit', now,
  ]);
}

try {
  const A = `${SESSION_COOKIE}=${(await createSession(userA)).rawToken}`;
  const B = `${SESSION_COOKIE}=${(await createSession(userB)).rawToken}`;
  const biz = (await call('POST', '/api/business', A, { name: 'Kōwhai Honey', type: 'sole_trader', gstRegistered: true, gstNumber: '123-456-789' })).json.id as string;
  const tag = async (id: string) => assert((await call('POST', '/api/business/money/tag', A, { kind: 'transaction', id, businessId: biz })).status === 200, `tag ${id}`);

  // Fresh budget: the default categories, nothing yet.
  const fresh = (await call('GET', `/api/business/${biz}/budget?taxYear=${year}`, A)).json;
  assert(fresh.income.map((c: Json) => c.name).join() === 'Sales,Other income', `income categories ${fresh.income.map((c: Json) => c.name)}`);
  assert(fresh.expenses.map((c: Json) => c.name).join() === 'Stock,Delivery,Wages,Rent,Marketing', 'expense categories');
  assert(fresh.months.length === 12 && fresh.months[0] === taxYearRange(year).start.slice(0, 7), 'twelve months from April');
  const cat = (name: string) => [...fresh.income, ...fresh.expenses].find((c: Json) => c.name === name).id as string;
  assert((await call('GET', `/api/business/${biz}/budget`, A)).json.expenses.length === 5, 'seeded once');

  // Stock and a cash sale: 10 jars at 23, cost 8 each.
  const jar = (await call('POST', `/api/business/${biz}/stock`, A, { name: 'Honey jar', sellPriceNzd: 23 })).json.id as string;
  await call('POST', `/api/business/stock/${jar}/batches`, A, { quantity: 50, unitCostNzd: 8 });
  assert((await call('POST', `/api/business/${biz}/sales`, A, { lines: [{ itemId: jar, quantity: 10 }] })).status === 201, 'sale');

  // An invoice paid: 115 (also Sales).
  const client = (await call('POST', '/api/invoices/clients', A, { businessId: biz, name: 'Hive & Co' })).json.id as string;
  const inv = (await call('POST', '/api/invoices', A, { businessId: biz, clientId: client, clientName: 'Hive & Co', issueDate: today, duePreset: 'days_14', gstMode: 'inclusive', lines: [{ description: 'Pollination', quantity: 1, unit: 'job', rate: 115 }] })).json;
  await call('POST', `/api/invoices/${inv.id}/mark-sent`, A);
  await call('POST', `/api/invoices/${inv.id}/payments`, A, { date: today, amountNzd: 115, method: 'Bank transfer', addToIncome: false });

  // Bills: a paid stock bill (500 incl. 50 freight) paid by a tagged bank payment; a paid
  // delivery bill (30); an unpaid bill (not counted).
  const gstSupplier = (await call('POST', `/api/business/${biz}/suppliers`, A, { name: 'Jar Co', gstNumber: '98-765-432' })).json.id as string;
  const plainSupplier = (await call('POST', `/api/business/${biz}/suppliers`, A, { name: 'Courier Bob' })).json.id as string;
  addTxn('pay_bill', -500, 'JAR CO');
  await tag('pay_bill');
  const bill = await call('POST', `/api/business/${biz}/bills`, A, { supplierId: gstSupplier, kind: 'stock', reference: 'J-1', invoiceDate: today, dueDate: today, amountNzd: 500, deliveryNzd: 50, paidOn: today, transactionId: 'pay_bill' });
  assert(bill.status === 201, `paid bill ${bill.status} ${JSON.stringify(bill.json)}`);
  await call('POST', `/api/business/${biz}/bills`, A, { supplierId: plainSupplier, kind: 'delivery', invoiceDate: today, dueDate: today, amountNzd: 30, deliveryNzd: 30, paidOn: today });
  await call('POST', `/api/business/${biz}/bills`, A, { supplierId: gstSupplier, kind: 'stock', invoiceDate: today, dueDate: today, amountNzd: 999 });

  // Wages: 1000 to an employee, paid by a tagged bank payment.
  const worker = (await call('POST', `/api/business/${biz}/employees`, A, { name: 'Aroha' })).json.id as string;
  addTxn('pay_wage', -1000, 'AROHA WAGES');
  await tag('pay_wage');
  const wage = await call('POST', `/api/business/${biz}/wages`, A, { employeeId: worker, amountNzd: 1000, transactionId: 'pay_wage' });
  assert(wage.status === 201 && wage.json.employeeName === 'Aroha', `wage ${wage.status} ${JSON.stringify(wage.json)}`);
  // One payment pays one thing; a deposit can't pay wages; the future isn't paid yet.
  assert((await call('POST', `/api/business/${biz}/wages`, A, { employeeName: 'Someone', amountNzd: 5, transactionId: 'pay_bill' })).status === 409, 'bill payment can’t also pay a wage');
  addTxn('dep_misc', 60, 'MARKET STALL');
  await tag('dep_misc');
  assert((await call('POST', `/api/business/${biz}/wages`, A, { employeeName: 'Someone', amountNzd: 5, transactionId: 'dep_misc' })).status === 400, 'a deposit can’t pay wages');
  assert((await call('POST', `/api/business/${biz}/wages`, A, { employeeName: 'Someone', amountNzd: 5, date: '2999-01-01' })).status === 400, 'future wages refused');
  assert((await call('POST', `/api/business/${biz}/wages`, A, { amountNzd: 5 })).status === 400, 'who was paid is required');

  // Bank money: rent 200 put in Rent, 40 left uncategorised.
  addTxn('pay_rent', -200, 'LANDLORD');
  addTxn('pay_misc', -40, 'HARDWARE');
  await tag('pay_rent');
  await tag('pay_misc');
  assert((await call('PUT', `/api/business/${biz}/money/category`, A, { transactionId: 'pay_rent', categoryId: cat('Rent') })).status === 200, 'rent categorised');
  addTxn('loose', -9, 'NOT TAGGED');
  assert((await call('PUT', `/api/business/${biz}/money/category`, A, { transactionId: 'loose', categoryId: cat('Rent') })).status === 404, 'only tagged transactions get a category');

  // The budget.
  const b = (await call('GET', `/api/business/${biz}/budget?taxYear=${year}`, A)).json;
  const actual = (name: string) => [...b.income, ...b.expenses].find((c: Json) => c.name === name).actualNzd;
  assert(near(actual('Sales'), 345), `sales 230 + invoice 115 → ${actual('Sales')}`);
  assert(near(actual('Other income'), 60), `other income ${actual('Other income')}`);
  assert(near(actual('Stock'), 450), `stock 500 − 50 freight → ${actual('Stock')}`);
  assert(near(actual('Delivery'), 80), `delivery 50 + 30 → ${actual('Delivery')}`);
  assert(near(actual('Wages'), 1000) && near(actual('Rent'), 200) && near(actual('Marketing'), 0), 'wages, rent, marketing');
  assert(near(b.uncategorised.expensesNzd, 40) && near(b.uncategorised.incomeNzd, 60), `uncategorised ${JSON.stringify(b.uncategorised)}`);
  const s = b.summary;
  assert(near(s.costOfGoodsSoldNzd, 80) && near(s.grossProfitNzd, 265), `gross 345 − 80 → ${s.grossProfitNzd}`);
  assert(near(s.operatingExpensesNzd, 1320) && near(s.stockPurchasesNzd, 450), `operating 80 + 1000 + 200 + 40 → ${s.operatingExpensesNzd}`);
  assert(near(s.netProfitNzd, -995), `net 265 + 60 − 1320 → ${s.netProfitNzd}`);
  assert(b.expenses.find((c: Json) => c.name === 'Wages').months.find((m: Json) => m.month === month).actualNzd === 1000, 'actual in its month');

  // Totals and the P&L count each dollar once: the linked payments aren't added again.
  const detail = (await call('GET', `/api/business/${biz}?taxYear=${year}`, A)).json;
  assert(near(detail.totals.expensesNzd, 1770), `expenses 500 + 30 + 1000 + 200 + 40 → ${detail.totals.expensesNzd}`);
  assert(near(detail.totals.incomeNzd, 405), `income 230 + 115 + 60 → ${detail.totals.incomeNzd}`);
  const kinds = (detail.records as Json[]).map((r) => r.kind).sort().join();
  assert(kinds === 'bill,bill,sale,wage', `detail records: sales, paid bills and wages → ${kinds}`);
  assert(near((detail.records as Json[]).reduce((t, r) => t + r.amountNzd, 0), 230 - 500 - 30 - 1000), 'records signed: money out negative');
  assert(detail.money.find((m: Json) => m.id === 'pay_bill').countedVia === 'bill', 'bill payment counted via the bill');
  assert(detail.money.find((m: Json) => m.id === 'pay_wage').countedVia === 'wage', 'wage payment counted via the wage');
  const pnl = (await call('GET', `/api/business/${biz}/profit-loss?taxYear=${year}`, A)).json;
  const pLine = (label: string) => pnl.expenses.find((l: Json) => l.label === label);
  assert(near(pLine('Stock purchases')?.amountNzd, 500) && near(pLine('Delivery')?.amountNzd, 30) && near(pLine('Wages')?.amountNzd, 1000), 'P&L bill and wage lines');
  assert(pLine('Rent')?.source === 'bank', 'P&L uses the business category name');
  assert(near(pnl.expensesNzd, 1770), 'P&L matches totals');
  const gst = (await call('GET', `/api/business/${biz}/gst?date=${today}`, A)).json;
  const gstBill = (id: string) => gst.items.find((i: Json) => i.kind === 'bill' && i.id === id);
  assert(gstBill(bill.json.id)?.treatment === 'standard' && gstBill(bill.json.id)?.side === 'purchase', 'bill from a GST-registered supplier is claimable');
  assert(gst.items.filter((i: Json) => i.kind === 'bill').some((i: Json) => i.treatment === 'exempt'), 'bill from a supplier without a GST number isn’t');
  assert(!gst.items.some((i: Json) => i.id === 'pay_bill' || i.id === 'pay_wage'), 'linked payments not on the GST return again');
  assert(!gst.items.some((i: Json) => i.id === wage.json.id), 'wages have no GST');

  // Plans: Rent per month; Marketing per year; wrong shapes refused; cadence change drops plans.
  const rentPlan = await call('PUT', `/api/business/budget/categories/${cat('Rent')}/plans`, A, { plans: [{ period: month, amountNzd: 250 }, { period: fresh.months[0], amountNzd: 250 }] });
  assert(rentPlan.status === 200, `rent plan ${rentPlan.status}`);
  assert((await call('PUT', `/api/business/budget/categories/${cat('Rent')}/plans`, A, { plans: [{ period: String(year), amountNzd: 1 }] })).status === 400, 'a month category takes months');
  assert((await call('PUT', `/api/business/budget/categories/${cat('Marketing')}`, A, { name: 'Marketing', kind: 'expense', planCadence: 'year' })).status === 200, 'Marketing per year');
  assert((await call('PUT', `/api/business/budget/categories/${cat('Marketing')}/plans`, A, { plans: [{ period: String(year), amountNzd: 600 }] })).status === 200, 'year plan');
  let planned = (await call('GET', `/api/business/${biz}/budget?taxYear=${year}`, A)).json;
  const rentLine = planned.expenses.find((c: Json) => c.name === 'Rent');
  assert(near(rentLine.plannedNzd, today.slice(0, 7) === fresh.months[0] ? 250 : 500) && rentLine.months.find((m: Json) => m.month === month).plannedNzd === 250, `rent planned ${rentLine.plannedNzd}`);
  assert(near(planned.expenses.find((c: Json) => c.name === 'Marketing').plannedNzd, 600), 'marketing planned for the year');
  await call('PUT', `/api/business/budget/categories/${cat('Rent')}/plans`, A, { plans: [{ period: month, amountNzd: null }] });
  await call('PUT', `/api/business/budget/categories/${cat('Marketing')}`, A, { name: 'Marketing', kind: 'expense', planCadence: 'month' });
  planned = (await call('GET', `/api/business/${biz}/budget?taxYear=${year}`, A)).json;
  assert(planned.expenses.find((c: Json) => c.name === 'Marketing').plannedNzd === null, 'cadence change drops plans');

  // Categories: add, no duplicate names, the automatic ones can't be deleted, deleting one uncategorises.
  const added = await call('POST', `/api/business/${biz}/budget/categories`, A, { name: 'Insurance', kind: 'expense' });
  assert(added.status === 201 && added.json.role === null, 'add a category');
  assert((await call('POST', `/api/business/${biz}/budget/categories`, A, { name: 'rent' })).status === 409, 'names are unique');
  assert((await call('DELETE', `/api/business/budget/categories/${cat('Wages')}`, A)).status === 409, 'automatic categories stay');
  assert((await call('DELETE', `/api/business/budget/categories/${cat('Rent')}`, A)).status === 200, 'delete Rent');
  assert(queryOne<{ c: string | null }>(db, `SELECT business_category_id AS c FROM transactions WHERE id = 'pay_rent'`)?.c === null, 'its transaction is uncategorised');
  const after = (await call('GET', `/api/business/${biz}/budget?taxYear=${year}`, A)).json;
  assert(near(after.uncategorised.expensesNzd, 240) && near(after.summary.operatingExpensesNzd, 1320), 'rent moves to uncategorised; operating unchanged');

  // Deleting the employee keeps the wage under their name.
  assert((await call('DELETE', `/api/business/employees/${worker}`, A)).status === 200, 'delete employee');
  const wages = (await call('GET', `/api/business/${biz}/wages`, A)).json as Json[];
  assert(wages.length === 1 && wages[0].employeeId === null && wages[0].employeeName === 'Aroha', 'wage kept with the name');

  // Isolation.
  assert((await call('GET', `/api/business/${biz}/budget`, B)).status === 404, 'B can’t read the budget');
  assert((await call('GET', `/api/business/${biz}/wages`, B)).status === 404, 'B can’t list wages');
  assert((await call('DELETE', `/api/business/wages/${wage.json.id}`, B)).status === 404, 'B can’t delete a wage');
  assert((await call('PUT', `/api/business/budget/categories/${cat('Sales')}`, B, { name: 'x' })).status === 404, 'B can’t rename a category');
  assert((await call('PUT', `/api/business/budget/categories/${cat('Sales')}/plans`, B, { plans: [{ period: month, amountNzd: 1 }] })).status === 404, 'B can’t plan');
  assert((await call('PUT', `/api/business/${biz}/money/category`, B, { transactionId: 'pay_misc', categoryId: null })).status === 404, 'B can’t categorise');

  console.log('business budget, wages and paid bills: ok');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
