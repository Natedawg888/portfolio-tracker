/**
 * GST returns (KAN-127) through the API: the ticket's example, invoice payments (standard or
 * zero-rated), marking items, purchases claimed only when marked, transfers, count-once with
 * matched deposits, period settings, the Business plan gate, isolation and the migration.
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

const dbPath = path.join(os.tmpdir(), `pt-gst-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
delete process.env.PUBLIC_URL;
delete process.env.RESEND_API_KEY;
delete process.env.PLAN_BUSINESS_EMAILS;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
const near = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) < 0.005;

const { getDb, migrateGst, queryOne, run } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { aucklandToday } = await import('../debts/model.ts');
const { linkMirroredIncomeToBankCredits } = await import('../lib/incomeBankLink.ts');
const { setPlan } = await import('../lib/entitlements.ts');
const { periodContaining } = await import('../../src/lib/gst.ts');
const { default: invoicesRouter } = await import('../routes/invoices.ts');
const { default: businessRouter } = await import('../routes/business.ts');
const { default: initSqlJs } = await import('sql.js');

const now = new Date().toISOString();
const today = aucklandToday();
const db = await getDb();
for (const [id, email] of [['gst_a', 'a@example.com'], ['gst_b', 'b@example.com'], ['gst_free', 'f@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, created_at, updated_at) VALUES (?,?,?,?,?,?)`, [id, email, 'hash', 'X', now, now]);
}
setPlan(db, 'gst_a', 'business', 'test');
setPlan(db, 'gst_b', 'business', 'test');

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
function addTxn(id: string, amount: number, description: string, kind?: string): void {
  run(
    db,
    `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, currency, created_at, source) VALUES (?,?,NULL,?,?,?,?, 'NZD', ?, 'akahu')`,
    [id, 'gst_a', today, description, amount, kind ?? (amount < 0 ? 'debit' : 'credit'), now],
  );
}

try {
  const A = `${SESSION_COOKIE}=${(await createSession('gst_a')).rawToken}`;
  const B = `${SESSION_COOKIE}=${(await createSession('gst_b')).rawToken}`;
  const F = `${SESSION_COOKIE}=${(await createSession('gst_free')).rawToken}`;
  const newBiz = async (name: string) =>
    (await call('POST', '/api/business', A, { name, type: 'sole_trader', gstRegistered: true, gstNumber: '123-456-789' })).json.id as string;
  const tag = async (kind: 'transaction' | 'income', id: string, businessId: string) =>
    assert((await call('POST', '/api/business/money/tag', A, { kind, id, businessId })).status === 200, `tagged ${id}`);
  const mark = (businessId: string, kind: string, id: string, treatment: string | null, cookie = A) => call('PUT', `/api/business/${businessId}/gst/items`, cookie, { kind, id, treatment });

  // The ticket's example: $11,500 GST-inclusive sales and $2,300 GST-inclusive expenses.
  const ex = await newBiz('Example Ltd');
  addTxn('ex_sale', 11500, 'Sales');
  addTxn('ex_cost', -2300, 'Supplies');
  await tag('transaction', 'ex_sale', ex);
  await tag('transaction', 'ex_cost', ex);
  let r = (await call('GET', `/api/business/${ex}/gst`, A)).json;
  assert(r.registered === true && near(r.boxes.box10, 1500) && near(r.boxes.box14, 0), `before marking, the expense isn't claimed (${JSON.stringify(r.boxes)})`);
  assert((await mark(ex, 'transaction', 'ex_cost', 'standard')).status === 200, 'expense marked GST-inclusive');
  r = (await call('GET', `/api/business/${ex}/gst`, A)).json;
  assert(near(r.boxes.box5, 11500) && near(r.boxes.box8, 1500) && near(r.boxes.box11, 2300) && near(r.boxes.box12, 300) && near(r.boxes.box15, 1200), `$1,500 / $300 / $1,200 to pay (${JSON.stringify(r.boxes)})`);
  const period = periodContaining(today, { frequency: 'two_monthly', periodEndMonth: 3 });
  assert(r.period.start === period.start && r.period.end === period.end && /^\d{4}-\d{2}-(07|15|28)$/.test(r.dueDate), 'default two-monthly period and a due date');
  assert(r.items.find((i: Json) => i.id === 'ex_cost').marked === true && r.items.find((i: Json) => i.id === 'ex_sale').marked === false, 'marked vs default');

  // Invoices: one charging GST (standard), one without (zero-rated); a matched deposit counts once.
  const biz = await newBiz('Kōwhai Honey');
  const client = (await call('POST', '/api/invoices/clients', A, { businessId: biz, name: 'Hive & Co' })).json.id as string;
  const inv = async (gstMode: string, rate: number, addToIncome: boolean) => {
    const i = (await call('POST', '/api/invoices', A, { businessId: biz, clientId: client, clientName: 'Hive & Co', clientEmail: 'orders@hiveco.nz', issueDate: today, duePreset: 'days_14', gstMode, lines: [{ description: 'Honey', quantity: 1, unit: 'each', rate }] })).json;
    assert((await call('POST', `/api/invoices/${i.id}/mark-sent`, A)).status === 200, `invoice (${gstMode}) sent`);
    assert((await call('POST', `/api/invoices/${i.id}/payments`, A, { date: today, amountNzd: i.totalNzd, method: 'Bank transfer', addToIncome })).status === 201, `invoice (${gstMode}) paid`);
    return i;
  };
  const withGst = await inv('inclusive', 1150, true);
  assert(near(withGst.totalNzd, 1150) && withGst.gstNzd > 0, 'an invoice charging GST');
  const export_ = await inv('none', 400, false);
  addTxn('dep_gst_inv', 1150, 'HIVE CO');
  linkMirroredIncomeToBankCredits(db, 'gst_a');
  await tag('transaction', 'dep_gst_inv', biz);
  addTxn('dep_export', 400, 'EXPORT PAYMENT');
  await tag('transaction', 'dep_export', biz);
  // Other money: income marked no GST, an unmarked purchase, a transfer, a zero-rated deposit.
  run(db, `INSERT INTO income_records (id, user_id, date, amount_nzd, description, created_at) VALUES ('inc_interest', 'gst_a', ?, 20, 'Interest', ?)`, [today, now]);
  await tag('income', 'inc_interest', biz);
  assert((await mark(biz, 'income', 'inc_interest', 'exempt')).status === 200, 'interest marked no GST');
  addTxn('deb_unmarked', -100, 'Coffee');
  addTxn('deb_jars', -230, 'Jars');
  addTxn('xfer', -999, 'To savings', 'transfer');
  addTxn('dep_zero', 50, 'Overseas sale');
  for (const id of ['deb_unmarked', 'deb_jars', 'xfer', 'dep_zero']) await tag('transaction', id, biz);
  await mark(biz, 'transaction', 'deb_jars', 'standard');
  await mark(biz, 'transaction', 'dep_zero', 'zero');

  r = (await call('GET', `/api/business/${biz}/gst`, A)).json;
  const ids = r.items.map((i: Json) => i.id);
  assert(!ids.includes('dep_gst_inv') && !ids.includes('dep_export') && !ids.includes('xfer'), 'matched deposits and transfers are not items');
  const invItems = r.items.filter((i: Json) => i.kind === 'invoice_payment');
  assert(invItems.length === 2 && invItems.every((i: Json) => i.editable === false), 'invoice payments follow their invoice');
  assert(invItems.find((i: Json) => near(i.amountNzd, 1150)).treatment === 'standard' && invItems.find((i: Json) => near(i.amountNzd, 400)).treatment === 'zero', 'GST invoice standard, no-GST invoice zero-rated');
  assert(near(r.boxes.box5, 1150 + 400 + 50), `box 5: sales incl. zero-rated, not the exempt interest (${r.boxes.box5})`);
  assert(near(r.boxes.box6, 450) && near(r.boxes.box7, 1150) && near(r.boxes.box8, 150), `zero-rated in box 6; GST on 1150 is 150 (${JSON.stringify(r.boxes)})`);
  assert(near(r.boxes.box11, 230) && near(r.boxes.box12, 30) && near(r.boxes.box15, 120), `only the marked purchase is claimed (${JSON.stringify(r.boxes)})`);
  assert(near(r.items.find((i: Json) => i.id === 'deb_jars').gstNzd, 30) && r.items.find((i: Json) => i.id === 'deb_unmarked').gstNzd === 0, 'GST per item');

  // Back to the default; refusals.
  await mark(biz, 'transaction', 'deb_jars', null);
  assert(near((await call('GET', `/api/business/${biz}/gst`, A)).json.boxes.box11, 0), 'clearing a mark goes back to not claimed');
  const payIncome = queryOne<{ id: string }>(db, `SELECT id FROM income_records WHERE user_id = 'gst_a' AND invoice_payment_id IS NOT NULL`)!;
  assert((await mark(biz, 'income', payIncome.id, 'zero')).status === 404, "an invoice payment's income row can't be marked");
  assert((await mark(biz, 'transaction', 'ex_sale', 'zero')).status === 404, "another business's item can't be marked from here");
  assert((await mark(biz, 'transaction', 'deb_jars', 'reduced')).status === 400, 'unknown treatment refused');

  // Settings and periods.
  assert((await call('PUT', `/api/business/${biz}/gst/settings`, A, { frequency: 'weekly', periodEndMonth: 3 })).status === 400, 'bad frequency');
  assert((await call('PUT', `/api/business/${biz}/gst/settings`, A, { frequency: 'monthly', periodEndMonth: 13 })).status === 400, 'bad month');
  assert((await call('PUT', `/api/business/${biz}/gst/settings`, A, { frequency: 'monthly', periodEndMonth: 3 })).status === 200, 'monthly saved');
  r = (await call('GET', `/api/business/${biz}/gst`, A)).json;
  assert(r.settings.frequency === 'monthly' && r.period.start === `${today.slice(0, 7)}-01`, 'monthly period');
  const lastYear = (await call('GET', `/api/business/${biz}/gst?date=${Number(today.slice(0, 4)) - 1}-${today.slice(5)}`, A)).json;
  assert(lastYear.items.length === 0 && near(lastYear.boxes.box15, 0), 'a period with nothing is nil');

  // Not registered; plan gate; isolation; archive.
  const unreg = (await call('POST', '/api/business', A, { name: 'Hobby', type: 'hobby' })).json.id as string;
  assert((await call('GET', `/api/business/${unreg}/gst`, A)).json.registered === false, 'a business not registered for GST says so');
  const free = await call('GET', `/api/business/${biz}/gst`, F);
  assert(free.status === 402 && free.json.code === 'BUSINESS_PLAN_REQUIRED', 'Business plan only');
  assert((await call('PUT', `/api/business/${biz}/gst/settings`, F, { frequency: 'monthly', periodEndMonth: 3 })).status === 402, 'settings need the plan too');
  assert((await call('GET', `/api/business/${biz}/gst`, B)).status === 404, "B can't see A's GST");
  assert((await mark(biz, 'transaction', 'deb_jars', 'standard', B)).status === 404, "B can't mark A's items");
  await call('POST', `/api/business/${unreg}/archive`, A);
  assert((await call('GET', `/api/business/${unreg}/gst`, A)).status === 409, 'archived: no GST return');

  // Migration on an old database adds the columns once.
  const SQL = await initSqlJs();
  const old = new SQL.Database();
  old.run(`CREATE TABLE businesses (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, updated_at TEXT)`);
  old.run(`CREATE TABLE transactions (id TEXT PRIMARY KEY, user_id TEXT, amount REAL)`);
  old.run(`CREATE TABLE income_records (id TEXT PRIMARY KEY, user_id TEXT, amount_nzd REAL)`);
  migrateGst(old);
  migrateGst(old);
  const cols = (t: string) => old.exec(`PRAGMA table_info(${t})`)[0].values.map((v) => String(v[1]));
  assert(cols('businesses').includes('gst_frequency') && cols('businesses').includes('gst_period_end_month'), 'business GST columns');
  assert(cols('transactions').includes('gst_treatment') && cols('income_records').includes('gst_treatment'), 'item GST columns');
  old.close();
  void export_;

  console.log('gst returns: ok');
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  for (const suffix of ['', '.tmp', '-wal', '-shm']) {
    const f = `${dbPath}${suffix}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}
