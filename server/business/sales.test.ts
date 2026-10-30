/**
 * Sales and receipts (KAN-120): a sale moves stock and carries its cost of goods sold; income is
 * counted once (a cash sale is income, an invoice-linked sale counts through the invoice, a
 * linked deposit isn't counted again) in the totals, P&L and GST return; archived items can't be
 * sold; receipts are uploaded or issued (numbered, PDF, then the sale is locked); isolation.
 * Run: npm run test:business
 *
 * Uses a throwaway sqlite file.
 */
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-sales-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
delete process.env.PUBLIC_URL;
delete process.env.RESEND_API_KEY;
delete process.env.PLAN_BUSINESS_EMAILS;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
const near = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) < 0.005;

const { getDb, run } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { aucklandToday } = await import('../debts/model.ts');
const { setPlan } = await import('../lib/entitlements.ts');
const { taxYearOf } = await import('../../src/lib/business.ts');
const { uploadsGate, UPLOADS_DIR } = await import('../lib/uploads.ts');
const { default: invoicesRouter } = await import('../routes/invoices.ts');
const { default: businessRouter } = await import('../routes/business.ts');

const now = new Date().toISOString();
const today = aucklandToday();
const year = taxYearOf(today);
const userA = 'sales_a';
const userB = 'sales_b';
const db = await getDb();
for (const [id, email] of [[userA, 'sa@example.com'], [userB, 'sb@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, created_at, updated_at) VALUES (?,?,?,?,?,?)`, [id, email, 'hash', 'X', now, now]);
}
setPlan(db, userA, 'business', 'test');

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/uploads', uploadsGate(), express.static(UPLOADS_DIR));
app.use('/api/invoices', invoicesRouter);
app.use('/api/business', businessRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

type Json = Record<string, any>;
async function call(method: string, p: string, cookie: string, body?: unknown): Promise<{ status: number; json: Json; headers: Headers; bytes: Buffer }> {
  const headers: Record<string, string> = { Accept: 'application/json', Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const bytes = Buffer.from(await res.arrayBuffer());
  let json: Json = {};
  if ((res.headers.get('content-type') ?? '').includes('json')) json = JSON.parse(bytes.toString('utf8')) as Json;
  return { status: res.status, json, headers: res.headers, bytes };
}

try {
  const A = `${SESSION_COOKIE}=${(await createSession(userA)).rawToken}`;
  const B = `${SESSION_COOKIE}=${(await createSession(userB)).rawToken}`;

  const biz = (await call('POST', '/api/business', A, { name: 'Kōwhai Honey', type: 'sole_trader', gstRegistered: true, gstNumber: '123-456-789' })).json.id as string;
  const client = (await call('POST', '/api/invoices/clients', A, { businessId: biz, name: 'Hive & Co', email: 'hive@example.com' })).json.id as string;
  const jar = (await call('POST', `/api/business/${biz}/stock`, A, { name: 'Honey jar', unit: 'each', sellPriceNzd: 23 })).json.id as string;
  const wax = (await call('POST', `/api/business/${biz}/stock`, A, { name: 'Beeswax', unit: 'kg' })).json.id as string;
  await call('POST', `/api/business/stock/${jar}/batches`, A, { quantity: 100, unitCostNzd: 8 });
  await call('POST', `/api/business/stock/${wax}/batches`, A, { quantity: 10, unitCostNzd: 12 });

  // A cash sale: price defaults to the item's sell price; stock goes down; cost and GST.
  const cash = await call('POST', `/api/business/${biz}/sales`, A, { date: today, clientId: client, lines: [{ itemId: jar, quantity: 10 }, { itemId: wax, quantity: 2, unitPriceNzd: 30 }] });
  assert(cash.status === 201, `cash sale ${cash.status} ${JSON.stringify(cash.json)}`);
  const s1 = cash.json;
  assert(near(s1.totalNzd, 290) && near(s1.costNzd, 104) && near(s1.grossProfitNzd, 186), `totals ${s1.totalNzd} ${s1.costNzd}`);
  assert(near(s1.gstNzd, 37.83), `gst 3/23 of 290 → ${s1.gstNzd}`);
  assert(s1.countsAsIncome && s1.clientName === 'Hive & Co' && s1.lines[0].description === 'Honey jar', 'sale view');
  const stock = (await call('GET', `/api/business/${biz}/stock`, A)).json as Json[];
  assert(stock.find((i) => i.id === jar).position.onHand === 90, 'jar on hand 100 − 10');

  // Missing price with no sell price, a future date, both links, no lines: refused.
  assert((await call('POST', `/api/business/${biz}/sales`, A, { lines: [{ itemId: wax, quantity: 1 }] })).status === 400, 'no price and no sell price');
  assert((await call('POST', `/api/business/${biz}/sales`, A, { date: '2999-01-01', lines: [{ itemId: jar, quantity: 1 }] })).status === 400, 'future date');
  assert((await call('POST', `/api/business/${biz}/sales`, A, { lines: [] })).status === 400, 'no lines');

  // A sale linked to an invoice moves stock but isn't income again.
  const inv = (await call('POST', '/api/invoices', A, { businessId: biz, clientId: client, clientName: 'Hive & Co', issueDate: today, duePreset: 'days_14', gstMode: 'inclusive', lines: [{ description: 'Honey', quantity: 5, unit: 'jar', rate: 23 }] })).json;
  await call('POST', `/api/invoices/${inv.id}/mark-sent`, A);
  await call('POST', `/api/invoices/${inv.id}/payments`, A, { date: today, amountNzd: 115, method: 'Bank transfer', addToIncome: false });
  const viaInvoice = await call('POST', `/api/business/${biz}/sales`, A, { date: today, invoiceId: inv.id, lines: [{ itemId: jar, quantity: 5 }] });
  assert(viaInvoice.status === 201 && viaInvoice.json.countsAsIncome === false && viaInvoice.json.invoiceNumber === inv.number, 'invoice-linked sale');

  // A sale linked to a tagged deposit: the deposit isn't counted again.
  run(db, `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, currency, created_at, source) VALUES ('dep_market', ?, NULL, ?, 'MARKET EFTPOS', 46, 'credit', 'NZD', ?, 'akahu')`, [userA, today, now]);
  await call('POST', '/api/business/money/tag', A, { kind: 'transaction', id: 'dep_market', businessId: biz });
  const viaDeposit = await call('POST', `/api/business/${biz}/sales`, A, { date: today, transactionId: 'dep_market', lines: [{ itemId: jar, quantity: 2 }] });
  assert(viaDeposit.status === 201, `deposit-linked sale ${viaDeposit.status}`);
  assert((await call('POST', `/api/business/${biz}/sales`, A, { transactionId: 'dep_market', lines: [{ itemId: jar, quantity: 1 }] })).status === 409, 'a deposit links to one sale');
  run(db, `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, currency, created_at, source) VALUES ('pay_out', ?, NULL, ?, 'SUPPLIER', -50, 'debit', 'NZD', ?, 'akahu')`, [userA, today, now]);
  assert((await call('POST', `/api/business/${biz}/sales`, A, { transactionId: 'pay_out', lines: [{ itemId: jar, quantity: 1 }] })).status === 400, 'only deposits link');

  // Income counted once: 290 cash + 115 invoice payment + 46 deposit-linked sale (deposit not again).
  const detail = (await call('GET', `/api/business/${biz}?taxYear=${year}`, A)).json;
  assert(near(detail.totals.incomeNzd, 451), `income 290 + 115 + 46 = 451, got ${detail.totals.incomeNzd}`);
  const dep = detail.money.find((m: Json) => m.id === 'dep_market');
  assert(dep.countedVia === 'sale', `deposit counted via the sale: ${dep.countedVia}`);
  const pnl = (await call('GET', `/api/business/${biz}/profit-loss?taxYear=${year}`, A)).json;
  const salesLine = pnl.income.find((l: Json) => l.source === 'sale');
  assert(salesLine && salesLine.label === 'Sales' && salesLine.count === 2 && near(salesLine.amountNzd, 336), `P&L sales line ${JSON.stringify(salesLine)}`);
  assert(near(pnl.incomeNzd, 451), 'P&L income matches totals');
  const gst = (await call('GET', `/api/business/${biz}/gst?date=${today}`, A)).json;
  const gstSales = gst.items.filter((i: Json) => i.kind === 'sale');
  assert(gstSales.length === 2 && gstSales.every((i: Json) => i.treatment === 'standard' && i.side === 'sale'), 'sales on the GST return');
  assert(!gst.items.some((i: Json) => i.id === 'dep_market'), 'the linked deposit isn’t on the GST return again');
  const csv = (await call('GET', `/api/business/${biz}/export.csv?taxYear=${year}&section=transactions`, A)).bytes.toString('utf8');
  assert(csv.includes(',Sale,Sales,'), 'export lists sales');

  // Archived items: no new sales; an existing line stays editable.
  await call('POST', `/api/business/stock/${wax}/archive`, A);
  assert((await call('POST', `/api/business/${biz}/sales`, A, { lines: [{ itemId: wax, quantity: 1, unitPriceNzd: 30 }] })).status === 409, 'archived item can’t be sold');
  const edited = await call('PUT', `/api/business/sales/${s1.id}`, A, { date: today, clientId: client, notes: 'Market day', lines: [{ itemId: jar, quantity: 12 }, { itemId: wax, quantity: 2, unitPriceNzd: 30 }] });
  assert(edited.status === 200 && near(edited.json.totalNzd, 336) && edited.json.notes === 'Market day', `edit keeps the archived line ${edited.status}`);

  // Uploaded receipt, then issuing is refused until it's removed.
  const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(40).fill(0)]).toString('base64')}`;
  const up = await call('POST', `/api/business/sales/${viaDeposit.json.id}/receipt-file`, A, { fileBase64: png, fileName: 'eftpos.png' });
  assert(up.status === 200 && up.json.receipt.kind === 'uploaded', `upload receipt ${up.status} ${JSON.stringify(up.json)}`);
  assert((await fetch(`${base}${up.json.receipt.url}`, { headers: { Cookie: A } })).status === 200, 'owner opens the receipt');
  assert((await fetch(`${base}${up.json.receipt.url}`, { headers: { Cookie: B } })).status === 404, 'another user can’t');
  assert((await call('POST', `/api/business/sales/${viaDeposit.json.id}/receipt`, A)).status === 409, 'issue refused while a file is attached');

  // Issued receipt: numbered, PDF, sale locked, numbers go up.
  const issued = await call('POST', `/api/business/sales/${s1.id}/receipt`, A);
  assert(issued.status === 200 && issued.json.receipt.kind === 'issued' && issued.json.receipt.number === 'RCT-0001', `issued ${JSON.stringify(issued.json.receipt)}`);
  assert((await call('POST', `/api/business/sales/${s1.id}/receipt`, A)).json.receipt.number === 'RCT-0001', 'issuing twice keeps the number');
  const second = await call('POST', `/api/business/sales/${viaInvoice.json.id}/receipt`, A);
  assert(second.json.receipt.number === 'RCT-0002', 'next number');
  const pdf = await call('GET', `/api/business/sales/${s1.id}/receipt.pdf`, A);
  assert(pdf.status === 200 && pdf.headers.get('content-type') === 'application/pdf' && pdf.bytes.subarray(0, 5).toString() === '%PDF-', 'receipt PDF');
  assert((await call('PUT', `/api/business/sales/${s1.id}`, A, { lines: [{ itemId: jar, quantity: 1 }] })).status === 409, 'issued sale is locked');
  assert((await call('POST', `/api/business/sales/${s1.id}/receipt-file`, A, { fileBase64: png })).status === 409, 'no upload over an issued receipt');

  // Isolation: B can't see, change, issue or download A's sales, or sell A's stock.
  assert((await call('GET', `/api/business/${biz}/sales`, B)).status === 404, 'B can’t list');
  assert((await call('PUT', `/api/business/sales/${viaDeposit.json.id}`, B, { lines: [{ itemId: jar, quantity: 1, unitPriceNzd: 1 }] })).status === 404, 'B can’t edit');
  assert((await call('DELETE', `/api/business/sales/${viaDeposit.json.id}`, B)).status === 404, 'B can’t delete');
  assert((await call('POST', `/api/business/sales/${viaDeposit.json.id}/receipt`, B)).status === 404, 'B can’t issue');
  assert((await call('GET', `/api/business/sales/${s1.id}/receipt.pdf`, B)).status === 404, 'B can’t download');
  const bBiz = (await call('POST', '/api/business', B, { name: 'B biz' })).json.id as string;
  assert((await call('POST', `/api/business/${bBiz}/sales`, B, { lines: [{ itemId: jar, quantity: 1, unitPriceNzd: 1 }] })).status === 404, 'B can’t sell A’s item');
  assert((await call('POST', `/api/business/${bBiz}/sales`, B, { transactionId: 'dep_market', lines: [] })).status === 400, 'B’s bad body is a 400 before any lookup');

  // Deleting a sale puts its stock back and removes its file.
  const listed = (await call('GET', `/api/business/${biz}/sales?from=${today}&to=${today}`, A)).json as Json[];
  assert(listed.length === 3, `three sales today, got ${listed.length}`);
  assert((await call('DELETE', `/api/business/sales/${viaDeposit.json.id}`, A)).status === 200, 'delete sale');
  const after = (await call('GET', `/api/business/${biz}/stock`, A)).json as Json[];
  assert(after.find((i) => i.id === jar).position.onHand === 83, `on hand 100 − 12 − 5 = 83, got ${after.find((i) => i.id === jar).position.onHand}`);
  assert((await fetch(`${base}${up.json.receipt.url}`, { headers: { Cookie: A } })).status === 404, 'its receipt file is gone');

  console.log('sales and receipts: ok');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
