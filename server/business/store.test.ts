/**
 * Business page API (KAN-84): a beekeeping business with 40 hives and a flock of sheep, two
 * clients, an invoice from Business → Invoices, its payment counted once as business income,
 * existing invoices moved onto a default business, user isolation, net worth and account delete.
 * Run: npm run test:business
 *
 * Uses a throwaway sqlite file. Sends no email and calls no bank.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-business-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
delete process.env.PUBLIC_URL;
delete process.env.RESEND_API_KEY;
for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function eq(actual: unknown, expected: number, msg: string): void {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > 0.005) {
    throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${expected})`);
  }
}

const { getDb, migrateBusinesses, queryAll, queryOne, run } = await import('../db/index.ts');
const { deleteScopedDataForUser, SCOPED_TABLES } = await import('../lib/userScope.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { aucklandToday } = await import('../debts/model.ts');
const { computeNetWorth } = await import('../lib/netWorth.ts');
const { linkMirroredIncomeToBankCredits } = await import('../lib/incomeBankLink.ts');
const { uploadsGate } = await import('../lib/uploads.ts');
const { taxYearOf } = await import('../../src/lib/business.ts');
const { default: invoicesRouter } = await import('../routes/invoices.ts');
const { default: businessRouter } = await import('../routes/business.ts');

const userA = 'biz_user_a';
const userB = 'biz_user_b';
const userC = 'biz_user_legacy';
const now = '2026-10-05T00:00:00.000Z';
const today = aucklandToday();

const db = await getDb();
for (const t of ['businesses', 'business_assets', 'business_asset_movements']) {
  assert(queryOne(db, `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [t]), `schema creates ${t}`);
  assert((SCOPED_TABLES as readonly string[]).includes(t), `${t} is user-scoped (export and delete)`);
}
for (const [id, email, first] of [[userA, 'a@example.com', 'Aroha'], [userB, 'b@example.com', 'Ben'], [userC, 'c@example.com', 'Cara']]) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, created_at, updated_at) VALUES (?,?,?,?,?,?)`, [id, email, 'hash', first, now, now]);
}

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/invoices', invoicesRouter);
app.use('/api/business', businessRouter);
app.use('/api/uploads', uploadsGate());
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

type Json = Record<string, any>;
async function call(method: string, p: string, cookie?: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: Json = {};
  try {
    json = JSON.parse(text) as Json;
  } catch {
    json = {};
  }
  return { status: res.status, json };
}

function addTxn(userId: string, id: string, date: string, amount: number, description: string): void {
  run(
    db,
    `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, currency, created_at, source)
     VALUES (?,?,NULL,?,?,?,?, 'NZD', ?, 'akahu')`,
    [id, userId, date, description, amount, amount < 0 ? 'debit' : 'credit', now],
  );
}

try {
  const A = `${SESSION_COOKIE}=${(await createSession(userA)).rawToken}`;
  const B = `${SESSION_COOKIE}=${(await createSession(userB)).rawToken}`;
  const C = `${SESSION_COOKIE}=${(await createSession(userC)).rawToken}`;

  assert((await call('GET', '/api/business')).status === 401, 'signed out is 401');
  const empty = await call('GET', '/api/business', A);
  assert(empty.status === 200 && empty.json.businesses.length === 0, 'a new user has no businesses, and reading makes none');
  eq(empty.json.taxYear, taxYearOf(today), 'current NZ tax year');

  // ---------------------------------------------------------------- business card
  assert((await call('POST', '/api/business', A, { name: '' })).status === 400, 'name required');
  assert((await call('POST', '/api/business', A, { name: 'x', type: 'trust' })).status === 400, 'type from the list');
  assert((await call('POST', '/api/business', A, { name: 'x', nzbn: '123' })).status === 400, 'NZBN is 13 digits');
  assert((await call('POST', '/api/business', A, { name: 'x', gstRegistered: true })).status === 400, 'GST number needed when registered');
  const created = await call('POST', '/api/business', A, {
    name: 'Kōwhai Honey', type: 'sole_trader', industry: 'Beekeeping', nzbn: '9429041234567', gstRegistered: true,
    gstNumber: '123-456-789', email: 'hello@kowhaihoney.nz', invoicePrefix: 'KH-', clientsEnabled: true, countInNetWorth: true,
  });
  assert(created.status === 201 && created.json.isDefault === true, 'first business is the default');
  const bizId = String(created.json.id);
  const second = await call('POST', '/api/business', A, { name: 'Weekend Mowing', type: 'hobby' });
  assert(second.status === 201 && second.json.isDefault === false, 'second business is not the default');

  // Logo: stored, served only to its owner.
  const png = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(60, 1)]).toString('base64')}`;
  const logo = await call('POST', `/api/business/${bizId}/logo`, A, { image: png });
  assert(logo.status === 200 && String(logo.json.logoUrl).startsWith('/api/uploads/business-logos/'), 'logo saved');
  const logoPath = String(logo.json.logoUrl);
  assert((await fetch(`${base}${logoPath}`, { headers: { Cookie: A } })).status === 200, 'owner sees the logo');
  assert((await fetch(`${base}${logoPath}`, { headers: { Cookie: B } })).status === 404, 'another user can’t open the logo');

  // ---------------------------------------------------------------- assets: 40 hives and a flock of sheep
  const negative = await call('POST', `/api/business/${bizId}/assets`, A, { category: 'beehives', name: 'Hives', quantity: -1 });
  assert(negative.status === 400 && /negative/.test(negative.json.error), 'negative quantity rejected');
  assert((await call('POST', `/api/business/${bizId}/assets`, A, { category: 'livestock', name: 'x', quantity: 1, valueNzd: -5 })).status === 400, 'negative value rejected');
  assert((await call('POST', `/api/business/${bizId}/assets`, A, { category: 'bees', name: 'x', quantity: 1 })).status === 400, 'category from the list');
  const hives = await call('POST', `/api/business/${bizId}/assets`, A, {
    category: 'beehives', name: 'Home apiary', quantity: 40, location: 'Back paddock', status: 'active',
    valueMode: 'per_unit', valueNzd: 350, valuedOn: '2026-09-01', costNzd: 12000,
  });
  assert(hives.status === 201 && hives.json.unit === 'hives', 'hives added with their default unit');
  eq(hives.json.currentValueNzd, 14000, '40 hives at $350 each');
  const sheep = await call('POST', `/api/business/${bizId}/assets`, A, {
    category: 'livestock', name: 'Flock', animalType: 'sheep', quantity: 120, tag: 'Mob A', valueMode: 'per_unit', valueNzd: 180,
  });
  assert(sheep.status === 201 && sheep.json.animalType === 'sheep' && sheep.json.unit === 'head', 'sheep added');
  assert(sheep.json.valuedOn === today, 'a value without a date is dated today');
  eq(sheep.json.currentValueNzd, 21600, '120 head at $180');
  const sheepId = String(sheep.json.id);

  const lambs = await call('POST', `/api/business/assets/${sheepId}/movements`, A, { kind: 'birth', quantity: 30, date: '2026-09-20' });
  eq(lambs.json.quantity, 150, 'births add to the flock');
  const deaths = await call('POST', `/api/business/assets/${sheepId}/movements`, A, { kind: 'death', quantity: 2, date: '2026-09-25' });
  eq(deaths.json.quantity, 148, 'deaths take away');
  const oversell = await call('POST', `/api/business/assets/${sheepId}/movements`, A, { kind: 'sale', quantity: 149 });
  assert(oversell.status === 400, 'a sale can’t take the flock below zero');
  assert((await call('POST', `/api/business/assets/${sheepId}/movements`, A, { kind: 'sale', quantity: 0 })).status === 400, 'zero movement rejected');
  const undo = await call('DELETE', `/api/business/movements/${deaths.json.movements[0].id}`, A);
  eq(undo.json.quantity, 150, 'removing a movement undoes it');
  eq(undo.json.currentValueNzd, 27000, 'per-head value follows the count');

  // ---------------------------------------------------------------- clients and an invoice
  const c1 = await call('POST', '/api/invoices/clients', A, {
    businessId: bizId, name: 'Hive & Co Grocers', contactPerson: 'Mere', email: 'orders@hiveco.nz', phone: '021 555 0101', notes: 'Pays on the 20th',
  });
  assert(c1.status === 201 && c1.json.businessId === bizId && c1.json.contactPerson === 'Mere', 'client 1 added to the business');
  const c2 = await call('POST', '/api/invoices/clients', A, { businessId: bizId, name: 'Farmers Market Trust', status: 'inactive' });
  assert(c2.status === 201 && c2.json.status === 'inactive', 'client 2 added, inactive');
  assert((await call('POST', '/api/invoices/clients', B, { businessId: bizId, name: 'Sneaky' })).status === 404, 'B can’t add a client to A’s business');
  const bizClients = await call('GET', `/api/invoices/clients?businessId=${bizId}`, A);
  assert(bizClients.json.length === 2, 'clients listed by business');

  const otherClient = await call('POST', '/api/invoices/clients', A, { businessId: second.json.id, name: 'Neighbour' });
  const wrongClient = await call('POST', '/api/invoices', A, { businessId: bizId, clientId: otherClient.json.id, clientName: 'Neighbour', lines: [] });
  assert(wrongClient.status === 400, 'an invoice can’t use another business’s client');

  const inv = await call('POST', '/api/invoices', A, {
    businessId: bizId, clientId: c1.json.id, clientName: 'Hive & Co Grocers', clientEmail: 'orders@hiveco.nz',
    issueDate: today, duePreset: 'days_14', gstMode: 'inclusive',
    lines: [{ description: 'Mānuka honey 500g', quantity: 50, unit: 'jar', rate: 23 }],
  });
  assert(inv.status === 201 && inv.json.businessId === bizId && inv.json.businessName === 'Kōwhai Honey', 'invoice made from the business');
  assert(inv.json.number === 'KH-0001', 'numbered with the business’s prefix');
  assert(inv.json.business.businessName === 'Kōwhai Honey' && inv.json.business.email === 'hello@kowhaihoney.nz', 'prints the business, email for Reply-To');
  eq(inv.json.totalNzd, 1150, 'invoice total');
  const sent = await call('POST', `/api/invoices/${inv.json.id}/mark-sent`, A);
  assert(sent.json.storedStatus === 'sent' && sent.json.title === 'Tax invoice', 'sent as a tax invoice');

  // Payment goes to Income and the bank deposit for it is tagged to the business too: counted once.
  const paid = await call('POST', `/api/invoices/${inv.json.id}/payments`, A, { date: today, amountNzd: 1150, method: 'Bank transfer', addToIncome: true });
  assert(paid.json.status === 'paid', 'paid');
  const incomeRow = queryOne<{ business_id: string }>(db, `SELECT business_id FROM income_records WHERE user_id = ? AND invoice_payment_id IS NOT NULL`, [userA]);
  assert(incomeRow?.business_id === bizId, 'the payment’s income row belongs to the business');
  addTxn(userA, 'txn_a_deposit', today, 1150, 'HIVE CO GROCERS');
  linkMirroredIncomeToBankCredits(db, userA);
  assert((await call('POST', '/api/business/money/tag', A, { kind: 'transaction', id: 'txn_a_deposit', businessId: bizId })).status === 200, 'deposit tagged');

  // Other business money: a tagged sale with no invoice, a tagged expense, and an untagged debit.
  addTxn(userA, 'txn_a_cash_sale', today, 60, 'Gate sales');
  addTxn(userA, 'txn_a_jars', today, -230.5, 'Jar supplier');
  addTxn(userA, 'txn_a_groceries', today, -80, 'Supermarket');
  await call('POST', '/api/business/money/tag', A, { kind: 'transaction', id: 'txn_a_cash_sale', businessId: bizId });
  await call('POST', '/api/business/money/tag', A, { kind: 'transaction', id: 'txn_a_jars', businessId: bizId });
  assert((await call('POST', '/api/business/money/tag', B, { kind: 'transaction', id: 'txn_a_groceries', businessId: null })).status === 404, 'B can’t tag A’s transaction');
  assert((await call('POST', '/api/business/money/tag', A, { kind: 'income', id: 'nope', businessId: bizId })).status === 404, 'unknown income row');

  const detail = await call('GET', `/api/business/${bizId}`, A);
  assert(detail.status === 200, 'business detail');
  eq(detail.json.totals.incomeNzd, 1210, 'payment once + gate sales (the deposit isn’t added again)');
  eq(detail.json.totals.expensesNzd, 230.5, 'tagged expense');
  eq(detail.json.totals.netNzd, 979.5, 'net');
  eq(detail.json.totals.assetsNzd, 41000, 'hives + flock');
  eq(detail.json.totals.gstCollectedEstimateNzd, 157.83, 'GST estimate is 3/23 of income');
  const deposit = detail.json.money.find((m: Json) => m.id === 'txn_a_deposit');
  assert(deposit?.countedVia === 'invoice', 'the deposit is shown as already counted through the invoice');
  assert(detail.json.clients.length === 2 && detail.json.invoices.length === 1, 'clients and invoices on the business');

  // Overview cards (Business pages redesign): what was recorded this tax year, counts only; totals unchanged.
  const yearCards = (await call('GET', '/api/business', A)).json.businesses as Json[];
  const hive = yearCards.find((c) => c.id === bizId)!;
  eq(hive.activity.invoices, 1, 'one invoice issued this tax year');
  eq(hive.activity.tagged, detail.json.money.length, 'tagged count matches the money list');
  eq(hive.totals.incomeNzd, 1210, 'card totals unchanged');
  const mowing = yearCards.find((c) => c.id === second.json.id)!;
  assert(mowing.activity.invoices === 0 && mowing.activity.tagged === 0, 'a business with nothing recorded');
  const candidates = await call('GET', '/api/business/money/candidates?q=super', A);
  assert(candidates.json.length === 1 && candidates.json[0].id === 'txn_a_groceries', 'untagged items can be searched to tag');

  // A payment not put in Income, plus its tagged deposit, is still counted once.
  const inv2 = await call('POST', '/api/invoices', A, {
    businessId: bizId, clientId: c1.json.id, clientName: 'Hive & Co Grocers', issueDate: today,
    lines: [{ description: 'Comb honey', quantity: 10, unit: 'box', rate: 15 }],
  });
  await call('POST', `/api/invoices/${inv2.json.id}/mark-sent`, A);
  await call('POST', `/api/invoices/${inv2.json.id}/payments`, A, { date: today, amountNzd: 150, addToIncome: false });
  addTxn(userA, 'txn_a_deposit2', today, 150, 'HIVE CO GROCERS');
  await call('POST', '/api/business/money/tag', A, { kind: 'transaction', id: 'txn_a_deposit2', businessId: bizId });
  const detail2 = await call('GET', `/api/business/${bizId}`, A);
  eq(detail2.json.totals.incomeNzd, 1360, 'second payment counted once');

  // Client view.
  const view = await call('GET', `/api/business/clients/${c1.json.id}`, A);
  assert(view.status === 200 && view.json.invoices.length === 2, 'client’s invoices');
  eq(view.json.billedNzd, 1300, 'total billed');
  eq(view.json.outstandingNzd, 0, 'nothing outstanding');
  assert(view.json.lastPayment?.date === today, 'last payment');
  assert((await call('GET', `/api/business/clients/${c1.json.id}`, B)).status === 404, 'B can’t open A’s client');

  // Business → Invoices, filtered to this business, totals for it only.
  const list = await call('GET', `/api/invoices?businessId=${bizId}`, A);
  assert(list.json.invoices.length === 2 && list.json.nextNumber === 'KH-0003', 'invoice list for the business');

  // Cards.
  const cards = await call('GET', '/api/business', A);
  const card = cards.json.businesses.find((b: Json) => b.id === bizId);
  assert(card.assetCount === 2 && card.clientCount === 2 && card.invoiceCount === 2, 'card counts');
  eq(card.totals.incomeNzd, 1360, 'card income');

  // Produce held: a Commodities holding (honey) linked to the business, valued once in net worth.
  const { createCommodity } = await import('../commodities/store.ts');
  const honey = createCommodity(db, userA, { name: 'Mānuka honey', preset: null, category: 'agriculture', quantity: 200, unit: 'kg', costNzd: null, priceNzd: 40, priceBasis: 'unit', valueOn: today, notes: '' });
  assert(honey.ok, 'commodity added');
  const honeyId = honey.ok ? honey.value.commodities[0].id : '';
  assert((await call('GET', '/api/business/produce/candidates', A)).json.some((c: Json) => c.id === honeyId), 'unlinked commodity offered');
  assert((await call('POST', '/api/business/produce/link', B, { commodityId: honeyId, businessId: null })).status === 404, 'B can’t link A’s commodity');
  assert((await call('POST', '/api/business/produce/link', A, { commodityId: honeyId, businessId: bizId })).status === 200, 'honey linked');
  const withProduce = await call('GET', `/api/business/${bizId}`, A);
  assert(withProduce.json.produce.length === 1 && withProduce.json.produce[0].valueNzd === 8000, 'produce shown with its Commodities value');
  eq(withProduce.json.totals.assetsNzd, 41000, 'produce isn’t added to the business’s own assets (no double count)');

  // ---------------------------------------------------------------- employees
  const empBody = {
    name: 'Mere Tane', role: 'Beekeeping hand', email: 'mere@example.nz', phone: '021 555 0199', bankAccount: '123456 7890123 00',
    payRateNzd: 28.5, payUnit: 'hour', payFrequency: 'fortnightly', payDate: '2026-01-02', startDate: '2025-11-01',
  };
  assert((await call('POST', `/api/business/${bizId}/employees`, A, { ...empBody, name: '' })).status === 400, 'employee name required');
  assert((await call('POST', `/api/business/${bizId}/employees`, A, { ...empBody, bankAccount: '12-345' })).status === 400, 'bank account must be 15 or 16 digits');
  assert((await call('POST', `/api/business/${bizId}/employees`, A, { ...empBody, payRateNzd: -1 })).status === 400, 'negative pay rate refused');
  assert((await call('POST', `/api/business/${bizId}/employees`, A, { ...empBody, payFrequency: 'daily' })).status === 400, 'pay frequency from the list');
  assert((await call('POST', `/api/business/${bizId}/employees`, A, { ...empBody, payDate: '2/1/2026' })).status === 400, 'pay date is YYYY-MM-DD');
  const emp = await call('POST', `/api/business/${bizId}/employees`, A, empBody);
  assert(emp.status === 201 && emp.json.bankAccount === '12-3456-7890123-00', 'employee added, bank account formatted');
  assert(emp.json.nextPayDate >= today && emp.json.payDate === '2026-01-02', 'next pay date rolls on from the date entered');
  assert((Date.parse(emp.json.nextPayDate) - Date.parse('2026-01-02')) % (14 * 86_400_000) === 0, 'fortnightly from the date entered');
  assert((await call('POST', `/api/business/${bizId}/employees`, B, empBody)).status === 404, 'B can’t add an employee to A’s business');
  assert((await call('PUT', `/api/business/employees/${emp.json.id}`, B, empBody)).status === 404, 'B can’t edit A’s employee');
  assert((await call('DELETE', `/api/business/employees/${emp.json.id}`, B)).status === 404, 'B can’t delete A’s employee');
  const left = await call('PUT', `/api/business/employees/${emp.json.id}`, A, { ...empBody, status: 'inactive', payRateNzd: 30 });
  assert(left.status === 200 && left.json.status === 'inactive' && left.json.payRateNzd === 30, 'employee updated');
  await call('POST', `/api/business/${bizId}/employees`, A, { name: 'Sam Rua', payRateNzd: 60000, payUnit: 'year', payFrequency: 'monthly', payDate: '2026-01-31' });
  const withStaff = await call('GET', `/api/business/${bizId}`, A);
  assert(withStaff.json.employees.length === 2 && withStaff.json.employees[0].name === 'Sam Rua', 'active employees listed first');
  const staffCard = (await call('GET', '/api/business', A)).json.businesses.find((x: Json) => x.id === bizId);
  assert(staffCard.employeeCount === 1, 'card counts active employees');
  const tmpBiz = await call('POST', '/api/business', A, { name: 'Temp', type: 'hobby' });
  await call('POST', `/api/business/${tmpBiz.json.id}/employees`, A, { name: 'Casual' });
  await call('DELETE', `/api/business/${tmpBiz.json.id}`, A);
  assert(!queryOne(db, `SELECT id FROM business_employees WHERE business_id = ?`, [tmpBiz.json.id]), 'employees go with their business');

  // ---------------------------------------------------------------- isolation
  assert((await call('GET', `/api/business/${bizId}`, B)).status === 404, 'B can’t read A’s business');
  assert((await call('PUT', `/api/business/${bizId}`, B, { name: 'Mine now' })).status === 404, 'B can’t edit it');
  assert((await call('DELETE', `/api/business/${bizId}`, B)).status === 404, 'B can’t delete it');
  assert((await call('POST', `/api/business/${bizId}/assets`, B, { category: 'other', name: 'x', quantity: 1 })).status === 404, 'B can’t add assets');
  assert((await call('PUT', `/api/business/assets/${sheepId}`, B, { category: 'livestock', name: 'x', quantity: 1 })).status === 404, 'B can’t edit assets');
  assert((await call('POST', `/api/business/assets/${sheepId}/movements`, B, { kind: 'sale', quantity: 1 })).status === 404, 'B can’t move stock');
  assert((await call('DELETE', `/api/business/assets/${sheepId}`, B)).status === 404, 'B can’t delete assets');
  assert(!JSON.stringify((await call('GET', '/api/business', B)).json).includes('Kōwhai'), 'B’s list has none of A’s');
  assert(!JSON.stringify((await call('GET', '/api/business/money/candidates', B)).json).includes('Supermarket'), 'B can’t see A’s transactions');

  // ---------------------------------------------------------------- net worth
  const nw = await computeNetWorth(db, userA);
  eq(nw.businessAssetsNzd, 41000, 'business assets in net worth');
  const off = await call('PUT', `/api/business/${bizId}`, A, { ...created.json, countInNetWorth: false });
  assert(off.status === 200 && off.json.countInNetWorth === false, 'net worth switch saved');
  assert((await computeNetWorth(db, userA)).businessAssetsNzd === null, 'left out when switched off');

  // Delete rules.
  assert((await call('DELETE', `/api/business/${bizId}`, A)).status === 409, 'a business with invoices can’t be deleted');
  assert((await call('DELETE', `/api/business/${second.json.id}`, A)).status === 200, 'an empty business can be deleted');
  assert(!queryOne(db, `SELECT id FROM invoice_clients WHERE id = ?`, [otherClient.json.id]), 'its clients went with it');

  // ---------------------------------------------------------------- existing invoices move onto a default business
  run(
    db,
    `INSERT INTO business_profiles (user_id, business_name, email, invoice_prefix, gst_registered, gst_number, updated_at) VALUES (?,?,?,?,?,?,?)`,
    [userC, 'Cara Contracting', 'cara@example.com', 'CC-', 0, '', now],
  );
  run(db, `INSERT INTO invoice_clients (id, user_id, name, created_at, updated_at) VALUES ('icl_legacy', ?, 'Old Client', ?, ?)`, [userC, now, now]);
  for (const [id, n] of [['inv_legacy_1', 'CC-0001'], ['inv_legacy_2', 'CC-0002']]) {
    run(
      db,
      `INSERT INTO invoices (id, user_id, number, number_key, status, client_id, client_name, issue_date, due_date, business_json, total_nzd, amount_due_nzd, created_at, updated_at)
       VALUES (?,?,?,?, 'sent', 'icl_legacy', 'Old Client', '2026-08-01', '2026-08-15', '{"businessName":"Cara Contracting"}', 100, 100, ?, ?)`,
      [id, userC, n, n.toLowerCase(), now, now],
    );
  }
  migrateBusinesses(db);
  migrateBusinesses(db); // runs on every start; a second run changes nothing
  const legacy = queryAll<{ id: string; name: string; is_default: number; invoice_prefix: string }>(db, `SELECT * FROM businesses WHERE user_id = ?`, [userC]);
  assert(legacy.length === 1 && legacy[0].name === 'Cara Contracting' && legacy[0].is_default === 1, 'default business made from the invoice details');
  assert(legacy[0].invoice_prefix === 'CC-', 'keeps the invoice prefix');
  const moved = queryAll<{ business_id: string }>(db, `SELECT business_id FROM invoices WHERE user_id = ?`, [userC]);
  assert(moved.length === 2 && moved.every((r) => r.business_id === legacy[0].id), 'both invoices attached, none lost');
  assert(queryOne<{ business_id: string }>(db, `SELECT business_id FROM invoice_clients WHERE id = 'icl_legacy'`)?.business_id === legacy[0].id, 'client attached');
  const cList = await call('GET', '/api/invoices', C);
  assert(cList.json.invoices.length === 2 && cList.json.invoices[0].businessName === 'Cara Contracting', 'they still list');
  const settings = await call('GET', '/api/invoices/business', C);
  assert(settings.json.businessName === 'Cara Contracting', 'Settings → Business shows the default business');
  await call('PUT', '/api/invoices/business', C, { ...settings.json, phone: '09 555 0000' });
  assert(queryOne<{ phone: string }>(db, `SELECT phone FROM businesses WHERE id = ?`, [legacy[0].id])?.phone === '09 555 0000', 'Settings → Business edits the default business');

  // A new user's first invoice makes their default business.
  const fresh = await call('POST', '/api/invoices', B, { clientName: 'Someone', lines: [{ description: 'Work', quantity: 1, rate: 10 }] });
  assert(fresh.status === 201 && fresh.json.businessId, 'first invoice gets a default business');
  assert((await call('GET', '/api/business', B)).json.businesses.length === 1, 'and it shows on Business');

  // ---------------------------------------------------------------- account delete
  const wiped = deleteScopedDataForUser(db, userA);
  assert(wiped.tables.businesses === 1 && wiped.tables.business_assets === 2 && wiped.tables.business_asset_movements === 1, 'business rows removed with the account');
  assert(wiped.tables.business_employees === 2, 'employees removed with the account');
  assert(queryAll(db, `SELECT id FROM invoice_clients WHERE user_id = ?`, [userA]).length === 0, 'clients removed');
  assert(queryAll(db, `SELECT id FROM businesses WHERE user_id = ?`, [userB]).length === 1, 'B untouched');
  assert(!fs.existsSync(path.join(path.dirname(dbPath), 'uploads', logoPath.replace('/api/uploads/', ''))), 'logo file removed');

  console.log('business tests passed');
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  for (const suffix of ['', '.tmp', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
