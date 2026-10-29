/**
 * Accountant export (KAN-128): the CSV agrees with the P&L and the GST return, lists the
 * invoices issued in the period, carries no ids, neutralises formulas, and is gated like the
 * other reports. Run: npm run test:business
 *
 * Uses a throwaway sqlite file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-export-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
delete process.env.PUBLIC_URL;
delete process.env.RESEND_API_KEY;
delete process.env.PLAN_BUSINESS_EMAILS;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

const { getDb, run } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { aucklandToday } = await import('../debts/model.ts');
const { setPlan } = await import('../lib/entitlements.ts');
const { taxYearOf } = await import('../../src/lib/business.ts');
const { addDays } = await import('../../src/lib/nzTime.ts');
const { COLUMNS, fileSlug } = await import('./accountantExport.ts');
const { default: invoicesRouter } = await import('../routes/invoices.ts');
const { default: businessRouter } = await import('../routes/business.ts');

const now = new Date().toISOString();
const today = aucklandToday();
const year = taxYearOf(today);
const db = await getDb();
for (const [id, email] of [['exp_a', 'owner@example.com'], ['exp_b', 'b@example.com'], ['exp_free', 'f@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, created_at, updated_at) VALUES (?,?,?,?,?,?)`, [id, email, 'hash', 'X', now, now]);
}
setPlan(db, 'exp_a', 'business', 'test');
setPlan(db, 'exp_b', 'business', 'test');

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
async function csv(p: string, cookie: string): Promise<{ status: number; text: string; bom: boolean; disposition: string | null; type: string | null }> {
  const res = await fetch(`${base}${p}`, { headers: { Cookie: cookie } });
  // Read bytes: res.text() would drop the BOM this checks for.
  const bytes = new Uint8Array(await res.arrayBuffer());
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return { status: res.status, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes), bom, disposition: res.headers.get('content-disposition'), type: res.headers.get('content-type') };
}
/** Enough CSV parsing for these files: quoted cells, doubled quotes, CRLF rows. */
function parse(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const t = text.replace(/^\ufeff/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && t[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}
function addTxn(id: string, date: string, amount: number, description: string): void {
  run(db, `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, currency, created_at, source) VALUES (?,?,NULL,?,?,?,?, 'NZD', ?, 'akahu')`, [
    id,
    'exp_a',
    date,
    description,
    amount,
    amount < 0 ? 'debit' : 'credit',
    now,
  ]);
}

try {
  const A = `${SESSION_COOKIE}=${(await createSession('exp_a')).rawToken}`;
  const B = `${SESSION_COOKIE}=${(await createSession('exp_b')).rawToken}`;
  const F = `${SESSION_COOKIE}=${(await createSession('exp_free')).rawToken}`;
  const biz = (await call('POST', '/api/business', A, { name: 'Kōwhai Honey', type: 'sole_trader', gstRegistered: true, gstNumber: '123-456-789' })).json.id as string;
  const client = (await call('POST', '/api/invoices/clients', A, { businessId: biz, name: 'Hive & Co', email: 'orders@hiveco.nz' })).json.id as string;
  const tag = async (id: string) => assert((await call('POST', '/api/business/money/tag', A, { kind: 'transaction', id, businessId: biz })).status === 200, `tagged ${id}`);

  const inv = (await call('POST', '/api/invoices', A, { businessId: biz, clientId: client, clientName: 'Hive & Co', clientEmail: 'orders@hiveco.nz', issueDate: today, duePreset: 'days_14', gstMode: 'inclusive', lines: [{ description: 'Honey', quantity: 1, unit: 'each', rate: 1150 }] })).json;
  assert((await call('POST', `/api/invoices/${inv.id}/mark-sent`, A)).status === 200, 'invoice sent');
  assert((await call('POST', `/api/invoices/${inv.id}/payments`, A, { date: today, amountNzd: 1150, method: 'Bank transfer', addToIncome: true })).status === 201, 'invoice paid');
  await call('POST', '/api/invoices', A, { businessId: biz, clientId: client, clientName: 'Hive & Co', issueDate: today, duePreset: 'days_14', gstMode: 'inclusive', lines: [{ description: 'Draft', quantity: 1, unit: 'each', rate: 50 }] });
  addTxn('t_sale', today, 460, 'Gate sales');
  addTxn('t_jars', addDays(today, -1), -230, 'Jar supplier');
  addTxn('t_evil', addDays(today, -1), -10, '=HYPERLINK("http://example.com","x")');
  addTxn('t_old', `${year - 2}-06-01`, 999, 'Old');
  for (const id of ['t_sale', 't_jars', 't_evil', 't_old']) await tag(id);
  await call('PUT', `/api/business/${biz}/gst/items`, A, { kind: 'transaction', id: 't_jars', treatment: 'standard' });

  // The whole file for the tax year.
  const full = await csv(`/api/business/${biz}/export.csv?taxYear=${year}`, A);
  assert(full.status === 200 && /text\/csv/.test(full.type ?? ''), 'a CSV');
  assert(full.bom, 'UTF-8 BOM for Excel');
  const start = (await call('GET', `/api/business/${biz}/profit-loss?taxYear=${year}`, A)).json;
  assert(full.disposition === `attachment; filename="${fileSlug('Kōwhai Honey')}-${start.start}-to-${start.end}.csv"` && fileSlug('Kōwhai Honey') === 'kowhai-honey', `file name (${full.disposition})`);
  const rows = parse(full.text);
  const titleAt = (t: string) => rows.findIndex((r) => r[0] === t);
  assert(rows[0][0] === 'Business' && rows[0][1] === 'Kōwhai Honey', 'header names the business');
  for (const t of ['Profit and loss', 'Transactions', 'Invoices issued']) assert(titleAt(t) > 0, `section ${t}`);
  assert(rows.some((r) => r[0]?.startsWith('GST returns')), 'GST section for a registered business');

  // P&L totals equal the P&L.
  const total = (label: string) => Number(rows.find((r) => r[0] === 'Total' && r[1] === label)?.[4]);
  assert(near(total('Income'), start.incomeNzd) && near(total('Expenses'), start.expensesNzd) && near(total('Net profit'), start.netNzd), 'P&L totals match');

  // Transactions add up to the P&L and carry GST for a registered business.
  const ti = titleAt('Transactions');
  assert(JSON.stringify(rows[ti + 1]) === JSON.stringify([...COLUMNS.transactions, ...COLUMNS.transactionsGst]), 'transaction columns, with GST');
  const txRows: string[][] = [];
  for (let i = ti + 2; i < rows.length && rows[i].length > 1; i++) txRows.push(rows[i]);
  const sumCol = (c: number) => txRows.reduce((s, r) => s + (r[c] ? Number(r[c]) : 0), 0);
  assert(txRows.length === 4 && near(sumCol(4), start.incomeNzd) && near(sumCol(5), start.expensesNzd), `transactions add up (${txRows.length} rows)`);
  const jars = txRows.find((r) => r[1] === 'Jar supplier')!;
  assert(jars[6] === 'GST-inclusive 15%' && near(Number(jars[7]), 30), 'GST treatment and amount on a marked purchase');
  assert(txRows.find((r) => r[2] === 'Invoice payment')?.[1].startsWith('Invoice '), 'invoice payment row named by its invoice');
  assert(txRows.some((r) => r[1] === `'=HYPERLINK("http://example.com","x")`), 'a formula-looking description is neutralised');
  assert(!txRows.some((r) => r[1] === 'Old'), 'other years are left out');

  // Invoices issued in the period, drafts left out.
  const ii = titleAt('Invoices issued');
  const invRows = rows.slice(ii + 2).filter((r, k, all) => k < all.findIndex((x) => x.length <= 1) || all.findIndex((x) => x.length <= 1) < 0).filter((r) => r.length > 1 && r[0] !== 'GST returns');
  assert(JSON.stringify(rows[ii + 1]) === JSON.stringify([...COLUMNS.invoices]), 'invoice columns');
  assert(invRows.filter((r) => /^[A-Z]+-\d+/.test(r[0])).length === 1 && invRows[0][1] === 'paid' && near(Number(invRows[0][8]), 1150), 'one issued invoice, paid; the draft is left out');

  // The GST section's current period equals the GST page.
  const gstPage = (await call('GET', `/api/business/${biz}/gst`, A)).json;
  const gstRow = rows.find((r) => r[0] === gstPage.period.start && r[1] === gstPage.period.end)!;
  assert(gstRow && near(Number(gstRow[10]), gstPage.boxes.box15) && near(Number(gstRow[6]), gstPage.boxes.box10), 'GST row matches the GST return');

  // No ids or emails anywhere in the file.
  for (const secret of [biz, client, inv.id, 't_sale', 't_jars', 'exp_a', 'owner@example.com', 'hash']) {
    assert(!full.text.includes(secret), `no ${secret} in the export`);
  }

  // One section on its own; a custom period; refusals.
  const pnlOnly = parse((await csv(`/api/business/${biz}/export.csv?taxYear=${year}&section=pnl`, A)).text);
  assert(JSON.stringify(pnlOnly[0]) === JSON.stringify([...COLUMNS.pnl]), 'a single section starts at its header');
  const week = await csv(`/api/business/${biz}/export.csv?from=${addDays(today, -1)}&to=${today}&section=transactions`, A);
  assert(week.status === 200 && /-transactions\.csv"$/.test(week.disposition ?? '') && parse(week.text).length === 5, 'custom period, one section');
  assert((await csv(`/api/business/${biz}/export.csv?section=everything`, A)).status === 400, 'unknown section');
  assert((await csv(`/api/business/${biz}/export.csv?from=${today}`, A)).status === 400, 'half a period');
  const free = await call('GET', `/api/business/${biz}/export.csv`, F);
  assert(free.status === 402 && free.json.code === 'BUSINESS_PLAN_REQUIRED', 'Business plan only');
  assert((await csv(`/api/business/${biz}/export.csv`, B)).status === 404, "B can't export A's business");

  // A business that isn't GST registered: no GST columns or section.
  const hobby = (await call('POST', '/api/business', A, { name: 'Hobby', type: 'hobby' })).json.id as string;
  const hobbyRows = parse((await csv(`/api/business/${hobby}/export.csv`, A)).text);
  assert(!hobbyRows.some((r) => r[0]?.startsWith('GST returns')), 'no GST section when not registered');
  const hti = hobbyRows.findIndex((r) => r[0] === 'Transactions');
  assert(JSON.stringify(hobbyRows[hti + 1]) === JSON.stringify([...COLUMNS.transactions]), 'no GST columns when not registered');
  await call('POST', `/api/business/${hobby}/archive`, A);
  assert((await csv(`/api/business/${hobby}/export.csv`, A)).status === 409, 'archived: no export');

  console.log('accountant export: ok');
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  for (const suffix of ['', '.tmp', '-wal', '-shm']) {
    const f = `${dbPath}${suffix}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}
