/**
 * Stock API (KAN-107): a honey shop's jars and beeswax. Batches and adjustments give on-hand,
 * average cost and margin; a sale past what's on hand is flagged, not blocked; archive hides an
 * item and restore brings it back with its history; SKUs are unique per business; photos are
 * signature-checked; stock at cost reaches the business's value; other users get 404.
 * Run: npm run test:business
 *
 * Uses a throwaway sqlite file. Sales are inserted directly (the sales API comes later).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-stock-${process.pid}-${Date.now()}.db`);
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
const { businessAssetTotals } = await import('./store.ts');
const { default: businessRouter } = await import('../routes/business.ts');

const userA = 'stock_user_a';
const userB = 'stock_user_b';
const now = '2026-10-05T00:00:00.000Z';
const today = aucklandToday();

const db = await getDb();
for (const [id, email] of [[userA, 'sa@example.com'], [userB, 'sb@example.com']]) {
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

let saleSeq = 0;
/** A sale of one line, as the sales API will store it. */
function sell(businessId: string, itemId: string, date: string, quantity: number): void {
  const saleId = `sale_${++saleSeq}`;
  const created = new Date(Date.now() + saleSeq * 1000).toISOString();
  run(db, `INSERT INTO business_sales (id, user_id, business_id, date, created_at, updated_at) VALUES (?,?,?,?,?,?)`, [saleId, userA, businessId, date, created, created]);
  run(
    db,
    `INSERT INTO business_sale_lines (id, user_id, business_id, sale_id, item_id, position, description, quantity, unit_price_nzd) VALUES (?,?,?,?,?,0,'',?,30)`,
    [`line_${saleSeq}`, userA, businessId, saleId, itemId, quantity],
  );
}

const fileOf = (url: string) => path.join(UPLOADS_DIR, url.replace('/api/uploads/', ''));

try {
  const A = `${SESSION_COOKIE}=${(await createSession(userA)).rawToken}`;
  const B = `${SESSION_COOKIE}=${(await createSession(userB)).rawToken}`;
  const shop = String((await call('POST', '/api/business', A, { name: 'Kōwhai Honey Shop' })).json.id);
  const market = String((await call('POST', '/api/business', A, { name: 'Saturday Market', type: 'hobby' })).json.id);
  const stockOf = async (biz: string, archived = false) => (await call('GET', `/api/business/${biz}/stock${archived ? '?includeArchived=1' : ''}`, A)).json as Json[];
  const find = async (id: string) => (await stockOf(shop, true)).find((i) => i.id === id)!;

  // ---------------------------------------------------------------- items
  assert((await stockOf(shop)).length === 0, 'a new business has no stock');
  const bad: [Json, RegExp][] = [
    [{ name: '' }, /Name is required/],
    [{ name: 'x', unit: 'g' }, /each, kg or L/],
    [{ name: 'x', sellPriceNzd: -1 }, /negative/],
    [{ name: 'x', reorderLevel: -1 }, /negative/],
  ];
  for (const [body, msg] of bad) {
    const r = await call('POST', `/api/business/${shop}/stock`, A, body);
    assert(r.status === 400 && msg.test(r.json.error), `rejects ${JSON.stringify(body)}`);
  }
  const jar = await call('POST', `/api/business/${shop}/stock`, A, { name: 'Mānuka 500g', sku: 'MAN-500', sellPriceNzd: 30, reorderLevel: 5 });
  assert(jar.status === 201 && jar.json.unit === 'each' && jar.json.position.onHand === 0, 'item created, on-hand 0, unit each');
  eq(jar.json.position.wacNzd, null, 'no batch: no cost, none invented');
  eq(jar.json.position.marginPerUnitNzd, null, 'no batch: no margin');
  const jarId = String(jar.json.id);

  const clash = await call('POST', `/api/business/${shop}/stock`, A, { name: 'Other', sku: 'man-500' });
  assert(clash.status === 409 && clash.json.error === 'SKU man-500 is already used by Mānuka 500g', 'SKU unique per business, ignoring case');
  assert((await call('POST', `/api/business/${market}/stock`, A, { name: 'Market jar', sku: 'MAN-500' })).status === 201, 'the same SKU in another business is fine');
  const wax = await call('POST', `/api/business/${shop}/stock`, A, { name: 'Beeswax block', sku: 'WAX', unit: 'kg' });
  const waxId = String(wax.json.id);
  assert((await call('PUT', `/api/business/stock/${waxId}`, A, { name: 'Beeswax block', sku: 'Man-500', unit: 'kg' })).status === 409, 'an edit can’t take another item’s SKU');
  assert((await call('PUT', `/api/business/stock/${jarId}`, A, { name: 'Mānuka 500g', sku: 'MAN-500', sellPriceNzd: 30, reorderLevel: 5 })).status === 200, 'an item keeps its own SKU on edit');

  // ---------------------------------------------------------------- batches, average cost and margin
  const badBatches: [Json, RegExp][] = [
    [{ quantity: 0, unitCostNzd: 1 }, /more than 0/],
    [{ quantity: 1, unitCostNzd: -1 }, /negative/],
    [{ quantity: 1 }, /Unit cost is required/],
    [{ quantity: 1, unitCostNzd: 1, date: '05/01/2026' }, /YYYY-MM-DD/],
    [{ quantity: 1, unitCostNzd: 1, date: '2999-01-01' }, /future/],
  ];
  for (const [body, msg] of badBatches) {
    const r = await call('POST', `/api/business/stock/${jarId}/batches`, A, body);
    assert(r.status === 400 && msg.test(r.json.error), `batch rejects ${JSON.stringify(body)}`);
  }
  await call('POST', `/api/business/stock/${jarId}/batches`, A, { date: '2026-01-05', quantity: 10, unitCostNzd: 12 });
  const second = await call('POST', `/api/business/stock/${jarId}/batches`, A, { date: '2026-02-05', quantity: 10, unitCostNzd: 18 });
  assert(second.status === 201, 'batch added');
  let p = second.json.position;
  eq(p.onHand, 20, 'on-hand is the batches in');
  eq(p.wacNzd, 15, 'average cost across batches');
  eq(p.valueNzd, 300, 'value at cost');
  eq(p.marginPerUnitNzd, 15, 'margin per unit');
  eq(p.marginTotalNzd, 300, 'margin in total');
  eq(p.level, 'ok', 'above the reorder level');
  eq(second.json.batches[0].date, '2026-02-05', 'batches newest first');

  // ---------------------------------------------------------------- adjustments
  assert((await call('POST', `/api/business/stock/${jarId}/adjustments`, A, { kind: 'damage', quantityLost: 2 })).status === 400, 'a reason is required');
  assert((await call('POST', `/api/business/stock/${jarId}/adjustments`, A, { kind: 'damage', quantityLost: 0, reason: 'x' })).status === 400, 'damage loses more than 0');
  assert((await call('POST', `/api/business/stock/${jarId}/adjustments`, A, { kind: 'recount', countedQuantity: -1, reason: 'x' })).status === 400, 'a count can’t be negative');
  assert((await call('POST', `/api/business/stock/${jarId}/adjustments`, A, { kind: 'theft', reason: 'x' })).status === 400, 'kind is damage or recount');
  const dropped = await call('POST', `/api/business/stock/${jarId}/adjustments`, A, { kind: 'damage', quantityLost: 2, reason: 'Dropped a box', date: '2026-03-01' });
  assert(dropped.status === 201, 'damage recorded');
  eq(dropped.json.position.onHand, 18, 'damage takes stock off');
  const counted = await call('POST', `/api/business/stock/${jarId}/adjustments`, A, { kind: 'recount', countedQuantity: 17, reason: 'Stocktake', date: '2026-03-31' });
  eq(counted.json.position.onHand, 17, 'a recount sets on-hand to what was counted');
  eq(counted.json.position.wacNzd, 15, 'adjustments leave the average cost alone');
  const recountId = String(counted.json.adjustments.find((a: Json) => a.kind === 'recount').id);

  sell(shop, jarId, '2026-03-15', 3);
  eq((await find(jarId)).position.onHand, 17, 'a sale back-dated before the stocktake doesn’t change on-hand after it');
  sell(shop, jarId, '2026-04-02', 13);
  p = (await find(jarId)).position;
  eq(p.onHand, 4, 'a sale after the stocktake takes stock off');
  eq(p.level, 'low', 'at or below the reorder level is low');

  const shopValue = 4 * 15;
  eq((await call('GET', `/api/business/${shop}`, A)).json.totals.assetsNzd, shopValue, 'stock at cost is the business’s value');

  // ---------------------------------------------------------------- overselling: flagged, never blocked
  sell(shop, jarId, '2026-04-10', 6);
  p = (await find(jarId)).position;
  eq(p.onHand, -2, 'on-hand goes negative');
  eq(p.level, 'oversold', 'and is flagged');
  eq(p.oversoldSince, '2026-04-10', 'from the day of the sale');
  eq(p.valueNzd, 0, 'oversold stock is worth 0, not negative');
  const restock = await call('POST', `/api/business/stock/${jarId}/batches`, A, { date: '2026-04-12', quantity: 10, unitCostNzd: 20 });
  eq(restock.json.position.onHand, 8, 'a batch after overselling fills the hole first');
  eq(restock.json.position.wacNzd, 20, 'and the average restarts from that batch');
  const restockId = String(restock.json.batches[0].id);
  const edited = await call('PUT', `/api/business/stock/batches/${restockId}`, A, { date: '2026-04-12', quantity: 10, unitCostNzd: 22 });
  eq(edited.json.position.wacNzd, 22, 'editing a batch re-derives the cost');
  const removed = await call('DELETE', `/api/business/stock/batches/${restockId}`, A);
  eq(removed.json.position.onHand, -2, 'deleting a batch takes its stock back off');
  await call('POST', `/api/business/stock/${jarId}/batches`, A, { date: '2026-04-12', quantity: 10, unitCostNzd: 20 });
  const unCounted = await call('DELETE', `/api/business/stock/adjustments/${recountId}`, A);
  eq(unCounted.json.position.onHand, 6, 'deleting the stocktake re-derives on-hand from the records');

  // ---------------------------------------------------------------- freight on a supplier bill
  const firstBatch = String((await find(jarId)).batches.find((b: Json) => b.date === '2026-01-05').id);
  run(
    db,
    `INSERT INTO business_supplier_invoices (id, user_id, business_id, supplier_id, kind, invoice_date, due_date, amount_nzd, delivery_nzd, delivery_treatment, created_at, updated_at)
     VALUES ('freight_1', ?, ?, 'sup', 'delivery', '2026-01-05', '2026-01-20', 10, 10, 'capitalise', ?, ?)`,
    [userA, shop, now, now],
  );
  run(db, `INSERT INTO business_supplier_invoice_batches (user_id, business_id, invoice_id, batch_id) VALUES (?,?,?,?)`, [userA, shop, 'freight_1', firstBatch]);
  const landed = (await find(jarId)).batches.find((b: Json) => b.id === firstBatch);
  eq(landed.landedNzd, 130, 'capitalised freight lands on the batch it covers');
  run(db, `UPDATE business_supplier_invoices SET delivery_treatment = 'expense' WHERE id = 'freight_1'`);
  eq((await find(jarId)).batches.find((b: Json) => b.id === firstBatch).landedNzd, 120, 'expensed freight stays out of stock cost');

  // ---------------------------------------------------------------- archive and restore
  await call('POST', `/api/business/stock/${waxId}/batches`, A, { date: '2026-05-01', quantity: 2.5, unitCostNzd: 20 });
  const archived = await call('POST', `/api/business/stock/${waxId}/archive`, A);
  assert(archived.status === 200 && archived.json.archivedAt && archived.json.onChart === false, 'archived');
  assert(!(await stockOf(shop)).some((i) => i.id === waxId), 'an archived item is off the default list (the chart)');
  const kept = (await stockOf(shop, true)).find((i) => i.id === waxId);
  assert(kept && kept.batches.length === 1 && kept.position.onHand === 2.5, 'still listed with includeArchived, history intact');
  const again = await call('POST', `/api/business/stock/${waxId}/archive`, A);
  eq(again.json.archivedAt, archived.json.archivedAt, 'archiving twice keeps the first archive time');
  const refused = await call('POST', `/api/business/stock/${waxId}/batches`, A, { quantity: 1, unitCostNzd: 1 });
  assert(refused.status === 409 && /Restore it/.test(refused.json.error), 'an archived item takes no new stock');
  const writeOff = await call('POST', `/api/business/stock/${waxId}/adjustments`, A, { kind: 'damage', quantityLost: 0.5, reason: 'Melted' });
  assert(writeOff.status === 201, 'but its stock can still be written off');
  const jarValue = 6 * 20;
  const waxValue = 2 * 20;
  eq((await call('GET', `/api/business/${shop}`, A)).json.totals.assetsNzd, jarValue + waxValue, 'archived stock still counts at cost');
  const net = businessAssetTotals(db, userA, today);
  eq(net?.perBusiness.find((b) => b.id === shop)?.valueNzd, jarValue + waxValue, 'and reaches net worth');
  assert((await call('DELETE', `/api/business/stock/${waxId}`, A)).status === 404, 'there is no item delete; archive is the delete');
  const restored = await call('POST', `/api/business/stock/${waxId}/restore`, A);
  assert(restored.status === 200 && restored.json.archivedAt === null && restored.json.onChart === true, 'restored');
  assert((await call('POST', `/api/business/stock/${waxId}/restore`, A)).status === 200, 'restoring twice is fine');
  const back = (await stockOf(shop)).find((i) => i.id === waxId);
  assert(back && back.batches.length === 1 && back.adjustments.length === 1, 'back on the list with its batch and write-off');

  // ---------------------------------------------------------------- photo
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(48, 1)]);
  const photo = await call('POST', `/api/business/stock/${jarId}/photo`, A, { image: `data:image/png;base64,${png.toString('base64')}` });
  assert(photo.status === 200 && photo.json.photoUrl === `/api/uploads/stock-photos/${jarId}.png`, 'photo saved under stock-photos');
  const photoUrl = String(photo.json.photoUrl);
  assert((await fetch(`${base}${photoUrl}`, { headers: { Cookie: A } })).status === 200, 'owner sees the photo');
  assert((await fetch(`${base}${photoUrl}`, { headers: { Cookie: B } })).status === 404, 'another user can’t open it');
  const html = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(64, ' '));
  const fake = await call('POST', `/api/business/stock/${jarId}/photo`, A, { image: `data:image/png;base64,${html.toString('base64')}` });
  assert(fake.status === 400 && /Invalid image/.test(fake.json.error), 'a file that isn’t an image is refused whatever it claims to be');
  assert(fs.existsSync(fileOf(photoUrl)), 'and the earlier photo is kept');
  const cleared = await call('DELETE', `/api/business/stock/${jarId}/photo`, A);
  assert(cleared.status === 200 && cleared.json.photoUrl === null && !fs.existsSync(fileOf(photoUrl)), 'photo removed, file and all');

  // ---------------------------------------------------------------- other users and other businesses
  const marketItems = await stockOf(market);
  assert(marketItems.length === 1 && marketItems[0].name === 'Market jar', 'each business lists only its own stock');
  assert((await call('GET', `/api/business/${shop}/stock`, B)).status === 404, 'B can’t list A’s stock');
  assert((await call('POST', `/api/business/${shop}/stock`, B, { name: 'x' })).status === 404, 'B can’t add to A’s business');
  assert((await call('PUT', `/api/business/stock/${jarId}`, B, { name: 'x' })).status === 404, 'B can’t edit A’s item');
  assert((await call('POST', `/api/business/stock/${jarId}/archive`, B)).status === 404, 'B can’t archive it');
  assert((await call('POST', `/api/business/stock/${jarId}/restore`, B)).status === 404, 'B can’t restore it');
  assert((await call('POST', `/api/business/stock/${jarId}/photo`, B, { image: `data:image/png;base64,${png.toString('base64')}` })).status === 404, 'B can’t set its photo');
  assert((await call('DELETE', `/api/business/stock/${jarId}/photo`, B)).status === 404, 'B can’t remove its photo');
  assert((await call('POST', `/api/business/stock/${jarId}/batches`, B, { quantity: 1, unitCostNzd: 1 })).status === 404, 'B can’t add a batch');
  assert((await call('PUT', `/api/business/stock/batches/${firstBatch}`, B, { quantity: 1, unitCostNzd: 1 })).status === 404, 'B can’t edit a batch');
  assert((await call('DELETE', `/api/business/stock/batches/${firstBatch}`, B)).status === 404, 'B can’t delete a batch');
  assert((await call('POST', `/api/business/stock/${jarId}/adjustments`, B, { kind: 'damage', quantityLost: 1, reason: 'x' })).status === 404, 'B can’t adjust');
  const damageId = String((await find(jarId)).adjustments[0].id);
  assert((await call('DELETE', `/api/business/stock/adjustments/${damageId}`, B)).status === 404, 'B can’t delete an adjustment');
  eq((await find(jarId)).position.onHand, 6, 'none of that changed A’s stock');

  // A row filed under another business doesn't count for, or act through, this item.
  run(db, `INSERT INTO business_stock_batches (id, user_id, business_id, item_id, date, quantity, unit_cost_nzd, created_at) VALUES ('stray', ?, ?, ?, '2026-01-01', 99, 1, ?)`, [userA, market, jarId, now]);
  eq((await find(jarId)).position.onHand, 6, 'a batch of another business is ignored');
  assert((await call('PUT', `/api/business/stock/batches/stray`, A, { quantity: 1, unitCostNzd: 1 })).status === 404, 'and can’t be edited through this item');
  run(db, `DELETE FROM business_stock_batches WHERE id = 'stray'`);

  // ---------------------------------------------------------------- deletion takes the photo files
  const marketJar = String(marketItems[0].id);
  const marketPhoto = String((await call('POST', `/api/business/stock/${marketJar}/photo`, A, { image: png.toString('base64') })).json.photoUrl);
  assert(fs.existsSync(fileOf(marketPhoto)), 'raw base64 photo saved');
  assert((await call('DELETE', `/api/business/${market}`, A)).status === 200, 'business deleted');
  assert(!fs.existsSync(fileOf(marketPhoto)), 'its stock photos go with it');
  assert(queryAll(db, `SELECT id FROM business_stock_items WHERE business_id = ?`, [market]).length === 0, 'and its stock rows');

  const lastPhoto = String((await call('POST', `/api/business/stock/${waxId}/photo`, A, { image: `data:image/png;base64,${png.toString('base64')}` })).json.photoUrl);
  const wiped = deleteScopedDataForUser(db, userA);
  assert(wiped.tables.business_stock_items === 2 && wiped.tables.business_stock_batches === 4, 'stock rows removed with the account');
  assert(!fs.existsSync(fileOf(lastPhoto)), 'stock photos removed with the account');

  console.log('stock API tests passed');
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  for (const suffix of ['', '.tmp', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
