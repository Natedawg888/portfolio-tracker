/**
 * Suppliers and bills API (KAN-107): a honey shop's jar supplier and courier. Bills carry an
 * uploaded PDF or photo checked by its signature, link to batches of the same business, and are
 * paid, unpaid or overdue by their dates; capitalised freight reaches average cost and expensed
 * freight doesn't; a supplier with bills can't be deleted; other users get 404; files go with
 * the bill, the business and the account. Bills don't count in the business's money yet.
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

const dbPath = path.join(os.tmpdir(), `pt-suppliers-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  const close = typeof actual === 'number' && typeof expected === 'number' && Math.abs(actual - expected) < 0.005;
  if (!close && actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

const { getDb, queryAll, run } = await import('../db/index.ts');
const { deleteScopedDataForUser } = await import('../lib/userScope.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { aucklandToday } = await import('../debts/model.ts');
const { uploadsGate, UPLOADS_DIR } = await import('../lib/uploads.ts');
const { billStatus } = await import('../../src/lib/suppliers.ts');
const { default: businessRouter } = await import('../routes/business.ts');

const userA = 'supplier_user_a';
const userB = 'supplier_user_b';
const now = '2026-10-05T00:00:00.000Z';
const today = aucklandToday();

const db = await getDb();
for (const [id, email] of [[userA, 'pa@example.com'], [userB, 'pb@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, created_at, updated_at) VALUES (?,?,?,?,?,?)`, [id, email, 'hash', 'x', now, now]);
}

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/business', businessRouter);
app.use('/api/uploads', uploadsGate());
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
  try {
    return { status: res.status, json: JSON.parse(text) as Json };
  } catch {
    return { status: res.status, json: {} };
  }
}

const fileOf = (url: string) => path.join(UPLOADS_DIR, url.replace('/api/uploads/', ''));
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(48, 1)]);
const html = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(64, ' '));
const dataUrl = (mime: string, b: Buffer) => `data:${mime};base64,${b.toString('base64')}`;

try {
  // ---------------------------------------------------------------- status is derived from the dates
  eq(billStatus(null, '2026-01-10', '2026-01-10'), 'unpaid', 'due today is unpaid, not overdue');
  eq(billStatus(null, '2026-01-09', '2026-01-10'), 'overdue', 'past due and unpaid is overdue');
  eq(billStatus('2026-01-20', '2026-01-09', '2026-01-30'), 'paid', 'paid late is paid');

  const A = `${SESSION_COOKIE}=${(await createSession(userA)).rawToken}`;
  const B = `${SESSION_COOKIE}=${(await createSession(userB)).rawToken}`;
  const shop = String((await call('POST', '/api/business', A, { name: 'Kōwhai Honey Shop' })).json.id);
  const market = String((await call('POST', '/api/business', A, { name: 'Saturday Market', type: 'hobby' })).json.id);

  // ---------------------------------------------------------------- suppliers
  const badSuppliers: [Json, RegExp][] = [
    [{ name: '' }, /Name is required/],
    [{ name: 'x', nzbn: '123' }, /NZBN must be 13 digits/],
    [{ name: 'x', gstNumber: '12-34' }, /GST number/],
  ];
  for (const [body, msg] of badSuppliers) {
    const r = await call('POST', `/api/business/${shop}/suppliers`, A, body);
    assert(r.status === 400 && msg.test(r.json.error), `supplier rejects ${JSON.stringify(body)}`);
  }
  const jars = await call('POST', `/api/business/${shop}/suppliers`, A, {
    name: 'Glass Jar Co', contactPerson: 'Aroha', email: 'orders@jars.example', phone: '09 555 0101', nzbn: '9429041234567', gstNumber: '123-456-789',
  });
  assert(jars.status === 201 && jars.json.nzbn === '9429041234567' && jars.json.gstNumber === '123-456-789', 'supplier created with NZBN and GST number');
  assert(jars.json.billCount === 0 && jars.json.unpaidNzd === 0, 'a new supplier has no bills');
  const jarsId = String(jars.json.id);
  const courier = String((await call('POST', `/api/business/${shop}/suppliers`, A, { name: 'Kiwi Couriers' })).json.id);
  const edited = await call('PUT', `/api/business/suppliers/${jarsId}`, A, { name: 'Glass Jar Company', nzbn: '9429041234567' });
  assert(edited.status === 200 && edited.json.name === 'Glass Jar Company' && edited.json.gstNumber === '', 'supplier edited');
  const marketSupplier = String((await call('POST', `/api/business/${market}/suppliers`, A, { name: 'Market Stall Hire' })).json.id);
  const listed = (await call('GET', `/api/business/${shop}/suppliers`, A)).json as Json[];
  assert(listed.map((s) => s.name).join() === 'Glass Jar Company,Kiwi Couriers', 'each business lists only its own suppliers, by name');

  // ---------------------------------------------------------------- bills
  const goods = { supplierId: jarsId, kind: 'stock', reference: 'INV-881', invoiceDate: '2026-01-05', dueDate: '2026-01-20', amountNzd: 230 };
  const badBills: [Json, RegExp][] = [
    [{ ...goods, supplierId: '' }, /Supplier is required/],
    [{ ...goods, kind: 'service' }, /stock or delivery/],
    [{ ...goods, invoiceDate: undefined }, /Invoice date is required/],
    [{ ...goods, dueDate: undefined }, /Due date is required/],
    [{ ...goods, dueDate: '2026-01-01' }, /before the invoice date/],
    [{ ...goods, amountNzd: undefined }, /Amount is required/],
    [{ ...goods, amountNzd: -5 }, /negative/],
    [{ ...goods, deliveryNzd: 300 }, /more than the bill/],
    [{ ...goods, deliveryTreatment: 'sometimes' }, /capitalise or expense/],
    [{ ...goods, paidOn: '20/01/2026' }, /YYYY-MM-DD/],
    [{ ...goods, transactionId: 'txn_x' }, /paid date/],
  ];
  for (const [body, msg] of badBills) {
    const r = await call('POST', `/api/business/${shop}/bills`, A, body);
    assert(r.status === 400 && msg.test(r.json.error), `bill rejects ${JSON.stringify(body)}`);
  }
  assert((await call('POST', `/api/business/${shop}/bills`, A, { ...goods, supplierId: marketSupplier })).status === 404, 'a supplier of another business can’t send this business a bill');

  const bill = await call('POST', `/api/business/${shop}/bills`, A, { ...goods, deliveryNzd: 30, deliveryTreatment: 'expense' });
  assert(bill.status === 201 && bill.json.supplierName === 'Glass Jar Company' && bill.json.kind === 'stock', 'goods bill created');
  eq(bill.json.deliveryNzd, 30, 'a goods bill keeps its freight line');
  eq(bill.json.status, today > '2026-01-20' ? 'overdue' : 'unpaid', 'an unpaid bill past its due date is overdue');
  assert(bill.json.file === null && bill.json.batchIds.length === 0, 'no file or batches yet');
  const billId = String(bill.json.id);

  const freight = await call('POST', `/api/business/${shop}/bills`, A, {
    supplierId: courier, kind: 'delivery', invoiceDate: '2026-01-05', dueDate: '2026-01-05', amountNzd: 40, deliveryNzd: 5,
  });
  assert(freight.status === 201 && freight.json.deliveryNzd === 40 && freight.json.deliveryTreatment === 'capitalise', 'a delivery bill is freight through and through, capitalised by default');
  const freightId = String(freight.json.id);

  run(db, `INSERT INTO transactions (id, user_id, date, amount, description, created_at) VALUES ('txn_jars', ?, '2026-01-19', -230, 'Glass Jar Co', ?)`, [userA, now]);
  run(db, `INSERT INTO transactions (id, user_id, date, amount, description, created_at) VALUES ('txn_b', ?, '2026-01-19', -230, 'B', ?)`, [userB, now]);
  assert((await call('PUT', `/api/business/bills/${billId}`, A, { ...goods, paidOn: '2026-01-19', transactionId: 'txn_b' })).status === 404, 'another user’s bank transaction can’t pay the bill');
  const paid = await call('PUT', `/api/business/bills/${billId}`, A, { ...goods, deliveryNzd: 30, deliveryTreatment: 'expense', paidOn: '2026-01-19', transactionId: 'txn_jars' });
  assert(paid.status === 200 && paid.json.status === 'paid' && paid.json.transactionId === 'txn_jars', 'marked paid with its bank payment');

  const suppliersNow = (await call('GET', `/api/business/${shop}/suppliers`, A)).json as Json[];
  const supplierNow = suppliersNow.find((s) => s.id === courier)!;
  assert(supplierNow.billCount === 1, 'supplier counts its bills');
  eq(supplierNow.unpaidNzd, 40, 'and totals what is unpaid');
  eq(suppliersNow.find((s) => s.id === jarsId)!.unpaidNzd, 0, 'a paid bill is not unpaid');
  const onlyJars = (await call('GET', `/api/business/${shop}/bills?supplierId=${jarsId}`, A)).json as Json[];
  assert(onlyJars.length === 1 && onlyJars[0].id === billId, 'bills filter by supplier');

  // ---------------------------------------------------------------- the file
  const up = await call('POST', `/api/business/bills/${billId}/file`, A, { fileBase64: dataUrl('application/pdf', pdf), fileName: 'C:\\scans\\INV-881.pdf' });
  assert(up.status === 200 && up.json.file.url === `/api/uploads/supplier-invoices/${billId}.pdf` && up.json.file.name === 'INV-881.pdf', 'PDF saved under supplier-invoices');
  const fileUrl = String(up.json.file.url);
  assert((await fetch(`${base}${fileUrl}`, { headers: { Cookie: A } })).status === 200, 'owner opens the bill');
  assert((await fetch(`${base}${fileUrl}`, { headers: { Cookie: B } })).status === 404, 'another user can’t');
  const fake = await call('POST', `/api/business/bills/${billId}/file`, A, { fileBase64: dataUrl('application/pdf', html) });
  assert(fake.status === 400 && /Invalid file/.test(fake.json.error), 'a file that isn’t a PDF or image is refused whatever it claims to be');
  assert(fs.existsSync(fileOf(fileUrl)), 'and the earlier file is kept');
  const photo = await call('POST', `/api/business/bills/${billId}/file`, A, { fileBase64: dataUrl('application/pdf', png) });
  assert(photo.status === 200 && photo.json.file.url.endsWith('.png') && !fs.existsSync(fileOf(fileUrl)), 'a photo replaces the PDF, typed by its bytes');
  const photoUrl = String(photo.json.file.url);
  const cleared = await call('DELETE', `/api/business/bills/${billId}/file`, A);
  assert(cleared.status === 200 && cleared.json.file === null && !fs.existsSync(fileOf(photoUrl)), 'file removed, from disk too');

  // ---------------------------------------------------------------- batches and capitalised freight
  const jar = String((await call('POST', `/api/business/${shop}/stock`, A, { name: 'Mānuka 500g', sellPriceNzd: 30 })).json.id);
  const wax = String((await call('POST', `/api/business/${shop}/stock`, A, { name: 'Beeswax', unit: 'kg' })).json.id);
  const jarBatch = String((await call('POST', `/api/business/stock/${jar}/batches`, A, { date: '2026-01-05', quantity: 10, unitCostNzd: 12 })).json.batches[0].id);
  const waxBatch = String((await call('POST', `/api/business/stock/${wax}/batches`, A, { date: '2026-01-05', quantity: 4, unitCostNzd: 10 })).json.batches[0].id);
  const marketItem = String((await call('POST', `/api/business/${market}/stock`, A, { name: 'Stall jar' })).json.id);
  const marketBatch = String((await call('POST', `/api/business/stock/${marketItem}/batches`, A, { quantity: 1, unitCostNzd: 1 })).json.batches[0].id);
  const stockOf = async (id: string) => ((await call('GET', `/api/business/${shop}/stock`, A)).json as Json[]).find((i) => i.id === id)!;
  eq((await stockOf(jar)).position.wacNzd, 12, 'before freight: the goods cost');

  assert((await call('POST', `/api/business/bills/${freightId}/batches`, A, { batchId: marketBatch })).status === 404, 'a batch of another business can’t be linked');
  assert((await call('POST', `/api/business/bills/${freightId}/batches`, A, {})).status === 400, 'batchId is required');
  await call('POST', `/api/business/bills/${freightId}/batches`, A, { batchId: jarBatch });
  const linked = await call('POST', `/api/business/bills/${freightId}/batches`, A, { batchId: waxBatch });
  assert(linked.status === 200 && linked.json.batchIds.length === 2, 'the courier’s bill covers both batches');
  assert((await call('POST', `/api/business/bills/${freightId}/batches`, A, { batchId: jarBatch })).json.batchIds.length === 2, 'linking twice changes nothing');
  // $40 split by goods value: jars $120 of $160 take $30, wax $40 takes $10.
  eq((await stockOf(jar)).position.wacNzd, 15, 'capitalised freight raises the jars’ average cost (120 + 30) / 10');
  eq((await stockOf(wax)).position.wacNzd, 12.5, 'and the wax’s (40 + 10) / 4');

  const freightBody = { supplierId: courier, kind: 'delivery', invoiceDate: '2026-01-05', dueDate: '2026-01-05', amountNzd: 40 };
  const expensed = await call('PUT', `/api/business/bills/${freightId}`, A, { ...freightBody, deliveryTreatment: 'expense' });
  assert(expensed.status === 200 && expensed.json.batchIds.length === 2, 'switched to expense, links kept');
  eq((await stockOf(jar)).position.wacNzd, 12, 'expensed freight leaves stock cost');
  await call('PUT', `/api/business/bills/${freightId}`, A, freightBody);
  eq((await stockOf(jar)).position.wacNzd, 15, 'and capitalising again puts it back');
  const unlinked = await call('DELETE', `/api/business/bills/${freightId}/batches/${waxBatch}`, A);
  assert(unlinked.status === 200 && unlinked.json.batchIds.join() === jarBatch, 'unlinked the wax');
  eq((await stockOf(jar)).position.wacNzd, 16, 'all the freight now lands on the jars (120 + 40) / 10');
  eq((await stockOf(wax)).position.wacNzd, 10, 'and none on the wax');

  // ---------------------------------------------------------------- bills are records, not money yet
  run(db, `UPDATE transactions SET business_id = ? WHERE id = 'txn_jars'`, [shop]);
  const card = ((await call('GET', '/api/business?taxYear=2026', A)).json.businesses as Json[]).find((b) => b.id === shop)!;
  eq(card.totals.expensesNzd, 230, 'the tagged bank payment counts once; the bill itself adds nothing yet');

  // ---------------------------------------------------------------- deleting
  const refused = await call('DELETE', `/api/business/suppliers/${jarsId}`, A);
  assert(refused.status === 409 && refused.json.error === 'Glass Jar Company has 1 bill. Delete it first.', 'a supplier with bills can’t be deleted');
  await call('POST', `/api/business/bills/${billId}/file`, A, { fileBase64: dataUrl('application/pdf', pdf) });
  const billFile = fileOf(`/api/uploads/supplier-invoices/${billId}.pdf`);
  assert((await call('DELETE', `/api/business/bills/${billId}`, A)).status === 200 && !fs.existsSync(billFile), 'bill deleted with its file');
  assert((await call('DELETE', `/api/business/suppliers/${jarsId}`, A)).status === 200, 'then the supplier can go');
  assert((await call('DELETE', `/api/business/bills/${freightId}`, A)).status === 200, 'freight bill deleted');
  assert(queryAll(db, `SELECT batch_id FROM business_supplier_invoice_batches WHERE invoice_id = ?`, [freightId]).length === 0, 'with its batch links');
  eq((await stockOf(jar)).position.wacNzd, 12, 'and its freight leaves stock cost');
  assert((await stockOf(jar)).batches.length === 1, 'the batches stay');

  // ---------------------------------------------------------------- other users
  const again = String((await call('POST', `/api/business/${shop}/bills`, A, { ...freightBody })).json.id);
  assert((await call('GET', `/api/business/${shop}/suppliers`, B)).status === 404, 'B can’t list A’s suppliers');
  assert((await call('POST', `/api/business/${shop}/suppliers`, B, { name: 'x' })).status === 404, 'B can’t add one');
  assert((await call('PUT', `/api/business/suppliers/${courier}`, B, { name: 'x' })).status === 404, 'B can’t edit one');
  assert((await call('DELETE', `/api/business/suppliers/${courier}`, B)).status === 404, 'B can’t delete one');
  assert((await call('GET', `/api/business/${shop}/bills`, B)).status === 404, 'B can’t list A’s bills');
  assert((await call('POST', `/api/business/${shop}/bills`, B, { ...freightBody })).status === 404, 'B can’t add one');
  assert((await call('PUT', `/api/business/bills/${again}`, B, { ...freightBody })).status === 404, 'B can’t edit one');
  assert((await call('DELETE', `/api/business/bills/${again}`, B)).status === 404, 'B can’t delete one');
  assert((await call('POST', `/api/business/bills/${again}/file`, B, { fileBase64: dataUrl('application/pdf', pdf) })).status === 404, 'B can’t attach a file');
  assert((await call('DELETE', `/api/business/bills/${again}/file`, B)).status === 404, 'B can’t remove one');
  assert((await call('POST', `/api/business/bills/${again}/batches`, B, { batchId: jarBatch })).status === 404, 'B can’t link a batch');
  assert((await call('DELETE', `/api/business/bills/${again}/batches/${jarBatch}`, B)).status === 404, 'B can’t unlink one');
  const bSupplier = String((await call('POST', '/api/business', B, { name: 'B shop' })).json.id);
  const bCourier = String((await call('POST', `/api/business/${bSupplier}/suppliers`, B, { name: 'B courier' })).json.id);
  assert((await call('PUT', `/api/business/bills/${again}`, A, { ...freightBody, supplierId: bCourier })).status === 404, 'A can’t file a bill under B’s supplier');
  assert((await call('GET', `/api/business/${shop}/bills`, A)).json.length === 1, 'none of that changed A’s bills');

  // ---------------------------------------------------------------- files go with the business and the account
  const marketBill = String((await call('POST', `/api/business/${market}/bills`, A, { ...freightBody, supplierId: marketSupplier })).json.id);
  await call('POST', `/api/business/bills/${marketBill}/file`, A, { fileBase64: dataUrl('image/png', png) });
  const marketFile = fileOf(`/api/uploads/supplier-invoices/${marketBill}.png`);
  assert(fs.existsSync(marketFile), 'market bill file saved');
  assert((await call('DELETE', `/api/business/${market}`, A)).status === 200, 'business deleted');
  assert(!fs.existsSync(marketFile), 'its bill files go with it');
  assert(queryAll(db, `SELECT id FROM business_suppliers WHERE business_id = ?`, [market]).length === 0, 'and its suppliers');

  await call('POST', `/api/business/bills/${again}/file`, A, { fileBase64: dataUrl('application/pdf', pdf) });
  const lastFile = fileOf(`/api/uploads/supplier-invoices/${again}.pdf`);
  const wiped = deleteScopedDataForUser(db, userA);
  assert(wiped.tables.business_suppliers === 1 && wiped.tables.business_supplier_invoices === 1, 'suppliers and bills removed with the account');
  assert(!fs.existsSync(lastFile), 'bill files removed with the account');
  assert((await call('GET', `/api/business/${bSupplier}/suppliers`, B)).json.length === 1, 'B keeps theirs');

  console.log('suppliers API tests passed');
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  for (const suffix of ['', '.tmp', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
