/**
 * Shopping lists and crowdsourced prices (KAN-74): CRUD, totals, budget comparison,
 * validation, user isolation, opt-in price sharing, the cheapest-store comparison,
 * outliers, product matching, privacy of contributors, and account delete.
 * Run: npm run test:shopping
 *
 * Uses a throwaway data dir. Does not touch data/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-shopping-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');
process.env.AUTH_ENCRYPTION_KEY = 'a'.repeat(64);

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
function near(a: number, b: number, msg: string): void {
  if (Math.abs(a - b) > 0.005) throw new Error(`FAIL: ${msg} (got ${a}, expected ${b})`);
}

const { getDb, run, queryAll, queryOne } = await import('../db/index.ts');
const { deleteScopedDataForUser, SCOPED_TABLES } = await import('../lib/userScope.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { aucklandToday } = await import('../debts/model.ts');
const { robustPrice, normaliseName, DAILY_CONTRIBUTION_LIMIT } = await import('./prices.ts');
const { default: shoppingRouter } = await import('../routes/shopping.ts');

const now = '2026-10-05T00:00:00.000Z';
const today = aucklandToday();
const db = await getDb();
for (const t of ['shopping_lists', 'shopping_items', 'shopping_prefs']) {
  assert(queryOne(db, `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [t]), `schema creates ${t}`);
  assert((SCOPED_TABLES as readonly string[]).includes(t), `${t} is user-scoped`);
}
const cols = queryAll<{ name: string }>(db, `PRAGMA table_info(price_observations)`).map((c) => c.name);
assert(!cols.includes('user_id'), 'the shared price table has no user_id column');

const users = ['shop_a', 'shop_b', 'shop_c'];
for (const id of users) run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [id, `${id}@example.com`, 'h', now, now]);
run(db, `INSERT INTO budget_categories (id, user_id, slug, name, type, is_income, sort_order) VALUES ('cat_food_a','shop_a','x','Food','spending',0,1)`);
run(db, `INSERT INTO budget_categories (id, user_id, slug, name, type, is_income, sort_order) VALUES ('cat_food_b','shop_b','y','Food','spending',0,1)`);

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/shopping', shoppingRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/shopping`;
type Json = Record<string, any>;
async function call(method: string, p: string, cookie?: string, body?: unknown): Promise<{ status: number; json: Json; text: string }> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

try {
  // Pure helpers.
  assert(normaliseName('  Anchor Blue Milk, 2L! ') === 'anchor blue milk 2l', 'normalise');
  assert(robustPrice([]) === null && robustPrice([4]) === 4 && robustPrice([4, 6]) === 5, 'median');
  assert(robustPrice([4, 4.2, 4.4, 40]) === 4.2, 'an outlier is dropped');

  assert((await call('GET', '/lists')).status === 401, 'signed out is 401');
  const [A, B, C] = await Promise.all(users.map(async (u) => `${SESSION_COOKIE}=${(await createSession(u)).rawToken}`));

  // Lists: create, validate, rename, isolation.
  assert((await call('POST', '/lists', A, { name: ' ' })).status === 400, 'list name required');
  assert((await call('POST', '/lists', A, { name: 'x', categoryId: 'cat_food_b' })).status === 400, 'cannot link another user’s category');
  const created = await call('POST', '/lists', A, { name: '  Weekly   groceries ', categoryId: 'cat_food_a' });
  assert(created.status === 201 && created.json.name === 'Weekly groceries', 'list created, name tidied');
  const lid = created.json.id as string;
  assert((await call('GET', `/lists/${lid}`, B)).status === 404, 'B cannot open A’s list');
  assert((await call('PATCH', `/lists/${lid}`, B, { name: 'Mine' })).status === 404, 'B cannot rename it');
  assert((await call('GET', '/lists', B)).json.length === 0, 'B sees no lists');

  // Items: validation, totals.
  const add = (body: Json, cookie = A, id = lid) => call('POST', `/lists/${id}/items`, cookie, body);
  assert((await add({ name: '' })).status === 400, 'item name required');
  assert((await add({ name: 'x', quantity: 0 })).status === 400, 'quantity must be positive');
  assert((await add({ name: 'x', estPriceNzd: -1 })).status === 400, 'price not negative');
  assert((await add({ name: 'x' }, B)).status === 404, 'B cannot add to A’s list');
  await add({ name: 'Anchor Blue Milk 2L', quantity: 2, estPriceNzd: 4.5 });
  await add({ name: 'Bread', estPriceNzd: 3.2 });
  let list = (await add({ name: 'Bananas', quantity: 1.2 })).json;
  assert(list.items.length === 3, 'three items');
  near(list.totals.estimatedNzd, 12.2, 'estimated total = 2 × 4.50 + 3.20');
  assert(list.totals.unpricedCount === 1, 'one item without a price');

  // Budget comparison: plan 300 this month, 120 spent in the category.
  const month = today.slice(0, 7);
  run(db, `INSERT INTO budgets (id, user_id, category_id, period_start, period_end, amount_nzd) VALUES ('b1','shop_a','cat_food_a',?,?,300)`, [`${month}-01`, `${month}-28`]);
  run(db, `INSERT INTO transactions (id, user_id, date, description, amount, kind, category_id, currency, source, created_at) VALUES ('t1','shop_a',?,'Groceries',-120,'debit','cat_food_a','NZD','manual',?)`, [`${month}-02`, now]);
  list = (await call('GET', `/lists/${lid}`, A)).json;
  const line = list.budget[0];
  assert(list.budget.length === 1 && line.categoryName === 'Food', 'budget line for the list category');
  near(line.plannedNzd, 300, 'planned');
  near(line.spentNzd, 120, 'spent');
  near(line.remainingNzd, 180, 'remaining');
  near(line.toBuyNzd, 12.2, 'still to buy');

  // Tick, reset, edit, delete.
  const bread = list.items.find((i: Json) => i.name === 'Bread');
  list = (await call('PATCH', `/items/${bread.id}`, A, { ticked: true })).json;
  near(list.totals.toBuyNzd, 9, 'ticked items are not still to buy');
  assert((await call('PATCH', `/items/${bread.id}`, B, { ticked: false })).status === 404, 'B cannot tick A’s item');
  list = (await call('POST', `/lists/${lid}/reset`, A)).json;
  assert(list.items.every((i: Json) => !i.ticked), 'reset unticks everything');
  const bananas = list.items.find((i: Json) => i.name === 'Bananas');
  list = (await call('DELETE', `/items/${bananas.id}`, A)).json;
  assert(list.items.length === 2, 'item deleted');

  // Saved and unchanged when opened again.
  const again = (await call('GET', `/lists/${lid}`, A)).json;
  assert(JSON.stringify(again.items) === JSON.stringify(list.items), 'list comes back unchanged');

  // Prefs: validation and defaults.
  let prefs = (await call('GET', '/prefs', A)).json;
  assert(prefs.contributePrices === false && prefs.windowDays === 60 && prefs.stores.length === 0, 'sharing is off by default');
  assert((await call('PUT', '/prefs', A, { windowDays: 45 })).status === 400, 'window must be 30 / 60 / 90');
  assert((await call('PUT', '/prefs', A, { stores: [{ chain: 'aldi', branch: 'x' }] })).status === 400, 'unknown chain rejected');

  // Prices without opting in update the item but share nothing.
  const milkA = list.items.find((i: Json) => i.name.startsWith('Anchor'));
  const breadA = list.items.find((i: Json) => i.name === 'Bread');
  let rec = await call('POST', `/lists/${lid}/prices`, A, { chain: 'paknsave', branch: 'Royal Oak', prices: [{ itemId: milkA.id, priceNzd: 4.29 }] });
  assert(rec.status === 200 && rec.json.shared === 0, 'nothing shared without opting in');
  assert(rec.json.list.items.find((i: Json) => i.id === milkA.id).estPriceNzd === 4.29, 'the item takes the price paid');
  assert(Number(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM price_observations`)?.n) === 0, 'no shared rows');
  assert((await call('POST', `/lists/${lid}/prices`, A, { chain: 'paknsave', branch: 'Royal Oak', prices: [{ itemId: milkA.id, priceNzd: 0 }] })).status === 400, 'price must be positive');
  assert((await call('POST', `/lists/${lid}/prices`, B, { chain: 'paknsave', branch: 'Royal Oak', prices: [{ itemId: milkA.id, priceNzd: 1 }] })).status === 404, 'B cannot price A’s list');

  // Done-when: A shares at Pak'nSave, B at Woolworths; C compares.
  await call('PUT', '/prefs', A, { contributePrices: true });
  rec = await call('POST', `/lists/${lid}/prices`, A, { chain: 'paknsave', branch: 'Royal Oak', prices: [{ itemId: milkA.id, priceNzd: 4.29 }, { itemId: breadA.id, priceNzd: 2.99 }] });
  assert(rec.json.shared === 2, 'A shared two prices');
  await call('PUT', '/prefs', B, { contributePrices: true });
  const lb = (await call('POST', '/lists', B, { name: 'Shop' })).json.id;
  await add({ name: 'anchor blue milk 2l' }, B, lb);
  const blist = (await add({ name: 'BREAD' }, B, lb)).json;
  rec = await call('POST', `/lists/${lb}/prices`, B, {
    chain: 'woolworths', branch: 'Greenlane',
    prices: blist.items.map((i: Json) => ({ itemId: i.id, priceNzd: i.name === 'BREAD' ? 3.5 : 4.6 })),
  });
  assert(rec.json.shared === 2, 'B shared two prices');

  const lc = (await call('POST', '/lists', C, { name: 'C list' })).json.id;
  await add({ name: 'Anchor blue milk 2L', quantity: 2 }, C, lc);
  await add({ name: 'Bread' }, C, lc);
  await add({ name: 'Dragon fruit' }, C, lc);
  await call('PUT', '/prefs', C, { stores: [{ chain: 'woolworths', branch: 'greenlane' }, { chain: 'paknsave', branch: ' Royal  Oak ' }, { chain: 'newworld', branch: 'Remuera' }] });
  const cmp = await call('GET', `/lists/${lc}/compare`, C);
  assert(cmp.status === 200 && cmp.json.itemCount === 3, 'compare runs');
  const pak = cmp.json.stores.find((s: Json) => s.chain === 'paknsave');
  const ww = cmp.json.stores.find((s: Json) => s.chain === 'woolworths');
  const nw = cmp.json.stores.find((s: Json) => s.chain === 'newworld');
  near(pak.total, 2 * 4.29 + 2.99, "Pak'nSave total (A's prices)");
  near(ww.total, 2 * 4.6 + 3.5, 'Woolworths total (B’s prices)');
  assert(pak.pricedCount === 2 && ww.pricedCount === 2 && nw.pricedCount === 0, 'coverage per store');
  assert(Object.values(nw.items).every((v) => v === null), 'unknown prices are null, never guessed');
  assert(Object.values(pak.items).some((v) => v === null), 'dragon fruit has no price anywhere');
  assert(cmp.json.cheapest.chain === 'paknsave', "Pak'nSave is cheapest");
  assert(Object.values(pak.items).filter(Boolean).every((v: any) => v.observedOn === today), 'each price carries its date');
  near(cmp.json.split.total, 2 * 4.29 + 2.99, 'split shop is all at the cheapest here');
  assert(!/shop_a|shop_b|contributor/.test(cmp.text), 'no contributor or user id in the response');

  // Outliers: a wildly wrong price doesn't move the median much.
  for (const p of [4.3, 4.31, 43]) {
    run(db, `INSERT INTO price_observations (id, product_key, product_name, chain, branch_key, branch_name, price_nzd, observed_on, contributor, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [`o${p}`, 'anchor blue milk 2l', 'x', 'paknsave', 'royal oak', 'Royal Oak', p, today, `other${p}`, now]);
  }
  const cmp2 = (await call('GET', `/lists/${lc}/compare`, C)).json;
  near(cmp2.stores.find((s: Json) => s.chain === 'paknsave').items[Object.keys(pak.items)[0]].unitPrice, 4.3, 'outlier dropped, median 4.30');
  // Old prices are outside the window.
  run(db, `UPDATE price_observations SET observed_on = '2020-01-01' WHERE chain = 'woolworths'`);
  assert((await call('GET', `/lists/${lc}/compare`, C)).json.stores.find((s: Json) => s.chain === 'woolworths').pricedCount === 0, 'stale prices ignored');

  // Matching: products need two contributors before they are offered to others.
  const found = (await call('GET', '/products?q=milk', C)).json;
  assert(found.some((p: Json) => p.key === 'anchor blue milk 2l'), 'milk (shared by several) is offered');
  run(db, `INSERT INTO price_observations (id, product_key, product_name, chain, branch_key, branch_name, price_nzd, observed_on, contributor, created_at) VALUES ('solo','janes birthday cake','Jane''s birthday cake','paknsave','royal oak','Royal Oak',30,?,'solo',?)`, [today, now]);
  assert((await call('GET', '/products?q=birthday', C)).json.length === 0, 'a name only one person used is never offered');
  const dragon = (await call('GET', `/lists/${lc}`, C)).json.items.find((i: Json) => i.name === 'Dragon fruit');
  const fixed = await call('PATCH', `/items/${dragon.id}`, C, { productKey: 'Bread' });
  assert(fixed.json.items.find((i: Json) => i.id === dragon.id).matchCorrected, 'match corrected');
  assert((await call('GET', '/branches?chain=paknsave&q=royal', C)).json[0] === 'Royal Oak', 'branch suggestions');

  // Rate limit.
  const cnt = () => Number(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM price_observations WHERE contributor = (SELECT contributor FROM price_observations WHERE branch_key = 'greenlane' LIMIT 1)`)?.n);
  const bContribBefore = cnt();
  const many = Array.from({ length: DAILY_CONTRIBUTION_LIMIT + 5 }, () => ({ itemId: blist.items[0].id, priceNzd: 4.6 }));
  rec = await call('POST', `/lists/${lb}/prices`, B, { chain: 'woolworths', branch: 'Greenlane', prices: many.slice(0, 200) });
  assert(rec.json.shared === DAILY_CONTRIBUTION_LIMIT - 2 && rec.json.notShared > 0, 'daily limit applied');
  assert(cnt() === bContribBefore + DAILY_CONTRIBUTION_LIMIT - 2, 'only up to the limit stored');

  // Removing my prices and account delete.
  const removed = await call('DELETE', '/prices/mine', B);
  assert(removed.json.removed === DAILY_CONTRIBUTION_LIMIT, 'B removes their own shared prices');
  const aBefore = Number(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM price_observations WHERE branch_key = 'royal oak' AND contributor NOT LIKE 'other%' AND contributor != 'solo'`)?.n);
  assert(aBefore === 2, 'A still has two shared prices');
  deleteScopedDataForUser(db, 'shop_a');
  assert(Number(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM price_observations WHERE branch_key = 'royal oak' AND contributor NOT LIKE 'other%' AND contributor != 'solo'`)?.n) === 0, 'account delete removes their shared prices');
  for (const t of ['shopping_lists', 'shopping_items', 'shopping_prefs']) {
    assert(queryAll(db, `SELECT * FROM ${t} WHERE user_id = 'shop_a'`).length === 0, `${t} deleted with the account`);
  }
  assert((await call('GET', '/lists', C)).json.length === 1, 'other users untouched');

  // List delete.
  assert((await call('DELETE', `/lists/${lc}`, C)).status === 200, 'list deleted');
  assert(queryAll(db, `SELECT id FROM shopping_items WHERE list_id = ?`, [lc]).length === 0, 'its items too');
  console.log('shopping lists tests passed');
} finally {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
