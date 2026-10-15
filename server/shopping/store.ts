/**
 * Shopping lists and crowdsourced prices (KAN-74). Lists, items and settings are per user;
 * every query on them filters on user_id. Shared prices live in price_observations with a
 * pseudonymous contributor (see prices.ts) and are only written when the user opted in.
 *
 * Budget comparison: for each budget category on the list (the item's, else the list's),
 * what is still to buy against what is left this month: the category's plans for the month
 * minus its spending (outflows in that category this Pacific/Auckland month).
 */
import type { Database } from 'sql.js';
import type {
  ShoppingBudgetLine,
  ShoppingCompareResponse,
  ShoppingItem,
  ShoppingListDetail,
  ShoppingListSummary,
  ShoppingPrefs,
} from '../../src/types/index.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { roundMoney } from '../debts/model.ts';
import {
  DAILY_CONTRIBUTION_LIMIT,
  MAX_PRICE_NZD,
  WINDOW_OPTIONS,
  compareStores,
  isChain,
  normaliseName,
  priceContributor,
  tidyText,
  type ChainId,
  type PriceCell,
  type StoreRef,
} from './prices.ts';

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

// ---------------------------------------------------------------- parsing

function obj(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

export type ItemDraft = { name: string; quantity: number; estPriceNzd: number | null; categoryId: string | null; ticked: boolean; productKey: string | null };

export function parseItem(raw: unknown, partial: boolean): { ok: true; value: Partial<ItemDraft> } | { ok: false; error: string } {
  const o = obj(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  const out: Partial<ItemDraft> = {};
  if (o.name !== undefined || !partial) {
    const name = typeof o.name === 'string' ? tidyText(o.name, 200) : '';
    if (!name) return { ok: false, error: 'Item name is required' };
    if (name.length > 80) return { ok: false, error: 'Item name must be 80 characters or fewer' };
    out.name = name;
  }
  if (o.quantity !== undefined) {
    const q = Number(o.quantity);
    if (!Number.isFinite(q) || q <= 0 || q > 1000) return { ok: false, error: 'Quantity must be more than 0 and at most 1000' };
    out.quantity = Math.round(q * 1000) / 1000;
  } else if (!partial) out.quantity = 1;
  if (o.estPriceNzd !== undefined) {
    if (o.estPriceNzd === null || o.estPriceNzd === '') out.estPriceNzd = null;
    else {
      const p = Number(o.estPriceNzd);
      if (!Number.isFinite(p) || p < 0 || p > MAX_PRICE_NZD) return { ok: false, error: `Price must be between 0 and ${MAX_PRICE_NZD}` };
      out.estPriceNzd = roundMoney(p);
    }
  } else if (!partial) out.estPriceNzd = null;
  if (o.categoryId !== undefined) out.categoryId = typeof o.categoryId === 'string' && o.categoryId ? o.categoryId : null;
  else if (!partial) out.categoryId = null;
  if (o.ticked !== undefined) out.ticked = o.ticked === true;
  if (o.productKey !== undefined) {
    out.productKey = typeof o.productKey === 'string' && o.productKey.trim() ? normaliseName(o.productKey).slice(0, 80) || null : null;
  }
  return { ok: true, value: out };
}

function parseListName(raw: unknown): string | null {
  const name = typeof raw === 'string' ? tidyText(raw, 200) : '';
  return name && name.length <= 60 ? name : null;
}

function ownsCategory(db: Database, userId: string, id: string | null | undefined): boolean {
  return !id || !!queryOne(db, `SELECT id FROM budget_categories WHERE id = ? AND user_id = ?`, [id, userId]);
}

// ---------------------------------------------------------------- lists

type ItemRow = {
  id: string;
  list_id: string;
  name: string;
  quantity: number;
  est_price_nzd: number | null;
  category_id: string | null;
  ticked: number;
  product_key: string | null;
  sort_order: number;
};

function presentItem(r: ItemRow): ShoppingItem {
  const price = r.est_price_nzd == null ? null : Number(r.est_price_nzd);
  return {
    id: r.id,
    name: r.name,
    quantity: Number(r.quantity),
    estPriceNzd: price,
    lineTotalNzd: price == null ? null : roundMoney(price * Number(r.quantity)),
    categoryId: r.category_id,
    ticked: Boolean(r.ticked),
    productKey: r.product_key ?? normaliseName(r.name),
    matchCorrected: r.product_key != null,
  };
}

function itemsOf(db: Database, userId: string, listId: string): ItemRow[] {
  return queryAll<ItemRow>(
    db,
    `SELECT * FROM shopping_items WHERE list_id = ? AND user_id = ? ORDER BY ticked, sort_order, created_at`,
    [listId, userId],
  );
}

type ListRow = { id: string; name: string; category_id: string | null; created_at: string; updated_at: string };

function listRow(db: Database, userId: string, id: string): ListRow | null {
  return queryOne<ListRow>(db, `SELECT * FROM shopping_lists WHERE id = ? AND user_id = ?`, [id, userId]) ?? null;
}

function touch(db: Database, userId: string, listId: string): void {
  run(db, `UPDATE shopping_lists SET updated_at = ? WHERE id = ? AND user_id = ?`, [new Date().toISOString(), listId, userId]);
}

export function listLists(db: Database, userId: string): ShoppingListSummary[] {
  return queryAll<ListRow>(db, `SELECT * FROM shopping_lists WHERE user_id = ? ORDER BY updated_at DESC`, [userId]).map((l) => {
    const items = itemsOf(db, userId, l.id).map(presentItem);
    return {
      id: l.id,
      name: l.name,
      categoryId: l.category_id,
      itemCount: items.length,
      tickedCount: items.filter((i) => i.ticked).length,
      estimatedTotalNzd: roundMoney(items.reduce((s, i) => s + (i.lineTotalNzd ?? 0), 0)),
      updatedAt: l.updated_at,
    };
  });
}

function monthBoundsOf(today: string): { start: string; end: string } {
  const [y, m] = today.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${today.slice(0, 7)}-01`, end: `${today.slice(0, 7)}-${String(last).padStart(2, '0')}` };
}

function budgetLines(db: Database, userId: string, items: ShoppingItem[], listCategory: string | null, today: string): ShoppingBudgetLine[] {
  const { start, end } = monthBoundsOf(today);
  const toBuy = new Map<string, number>();
  for (const it of items) {
    const cat = it.categoryId ?? listCategory;
    if (!cat) continue;
    toBuy.set(cat, (toBuy.get(cat) ?? 0) + (it.ticked ? 0 : (it.lineTotalNzd ?? 0)));
  }
  return [...toBuy.entries()].map(([categoryId, amount]) => {
    const cat = queryOne<{ name: string }>(db, `SELECT name FROM budget_categories WHERE id = ? AND user_id = ?`, [categoryId, userId]);
    const plan = queryOne<{ total: number | null; n: number }>(
      db,
      `SELECT SUM(amount_nzd) AS total, COUNT(*) AS n FROM budgets
       WHERE user_id = ? AND category_id = ? AND period_start <= ? AND period_end >= ?`,
      [userId, categoryId, end, start],
    );
    const spent = queryOne<{ total: number | null }>(
      db,
      `SELECT SUM(-amount) AS total FROM transactions
       WHERE user_id = ? AND category_id = ? AND amount < 0 AND date >= ? AND date <= ?`,
      [userId, categoryId, start, end],
    );
    const planned = plan && plan.n > 0 ? roundMoney(Number(plan.total ?? 0)) : null;
    const spentNzd = roundMoney(Number(spent?.total ?? 0));
    return {
      categoryId,
      categoryName: cat?.name ?? 'Category',
      toBuyNzd: roundMoney(amount),
      plannedNzd: planned,
      spentNzd,
      remainingNzd: planned == null ? null : roundMoney(planned - spentNzd),
    };
  });
}

export function getList(db: Database, userId: string, id: string, today: string): ShoppingListDetail | null {
  const l = listRow(db, userId, id);
  if (!l) return null;
  const items = itemsOf(db, userId, id).map(presentItem);
  return {
    id: l.id,
    name: l.name,
    categoryId: l.category_id,
    updatedAt: l.updated_at,
    items,
    totals: {
      estimatedNzd: roundMoney(items.reduce((s, i) => s + (i.lineTotalNzd ?? 0), 0)),
      toBuyNzd: roundMoney(items.filter((i) => !i.ticked).reduce((s, i) => s + (i.lineTotalNzd ?? 0), 0)),
      unpricedCount: items.filter((i) => i.estPriceNzd == null).length,
    },
    budget: budgetLines(db, userId, items, l.category_id, today),
  };
}

export function createList(db: Database, userId: string, body: unknown, today: string): Result<ShoppingListDetail> {
  const o = obj(body) ?? {};
  const name = parseListName(o.name);
  if (!name) return fail(400, 'List name is required (up to 60 characters)');
  const categoryId = typeof o.categoryId === 'string' && o.categoryId ? o.categoryId : null;
  if (!ownsCategory(db, userId, categoryId)) return fail(400, 'Unknown budget category');
  const id = newId('shl');
  const now = new Date().toISOString();
  run(db, `INSERT INTO shopping_lists (id, user_id, name, category_id, created_at, updated_at) VALUES (?,?,?,?,?,?)`, [id, userId, name, categoryId, now, now]);
  return { ok: true, value: getList(db, userId, id, today)! };
}

export function updateList(db: Database, userId: string, id: string, body: unknown, today: string): Result<ShoppingListDetail> {
  const l = listRow(db, userId, id);
  if (!l) return fail(404, 'List not found');
  const o = obj(body) ?? {};
  let name = l.name;
  if (o.name !== undefined) {
    const n = parseListName(o.name);
    if (!n) return fail(400, 'List name is required (up to 60 characters)');
    name = n;
  }
  let categoryId = l.category_id;
  if (o.categoryId !== undefined) {
    categoryId = typeof o.categoryId === 'string' && o.categoryId ? o.categoryId : null;
    if (!ownsCategory(db, userId, categoryId)) return fail(400, 'Unknown budget category');
  }
  run(db, `UPDATE shopping_lists SET name = ?, category_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [name, categoryId, new Date().toISOString(), id, userId]);
  return { ok: true, value: getList(db, userId, id, today)! };
}

export function deleteList(db: Database, userId: string, id: string): boolean {
  if (!listRow(db, userId, id)) return false;
  run(db, `DELETE FROM shopping_items WHERE list_id = ? AND user_id = ?`, [id, userId]);
  run(db, `DELETE FROM shopping_lists WHERE id = ? AND user_id = ?`, [id, userId]);
  return true;
}

/** Untick every item, e.g. to reuse a weekly list. */
export function resetList(db: Database, userId: string, id: string, today: string): ShoppingListDetail | null {
  if (!listRow(db, userId, id)) return null;
  run(db, `UPDATE shopping_items SET ticked = 0 WHERE list_id = ? AND user_id = ?`, [id, userId]);
  touch(db, userId, id);
  return getList(db, userId, id, today);
}

// ---------------------------------------------------------------- items

export function addItem(db: Database, userId: string, listId: string, d: ItemDraft, today: string): Result<ShoppingListDetail> {
  if (!listRow(db, userId, listId)) return fail(404, 'List not found');
  if (!ownsCategory(db, userId, d.categoryId)) return fail(400, 'Unknown budget category');
  const next = queryOne<{ n: number | null }>(db, `SELECT MAX(sort_order) AS n FROM shopping_items WHERE list_id = ? AND user_id = ?`, [listId, userId]);
  run(
    db,
    `INSERT INTO shopping_items (id, user_id, list_id, name, quantity, est_price_nzd, category_id, ticked, product_key, sort_order, created_at)
     VALUES (?,?,?,?,?,?,?,0,?,?,?)`,
    [newId('shi'), userId, listId, d.name, d.quantity, d.estPriceNzd, d.categoryId, d.productKey ?? null, Number(next?.n ?? 0) + 1, new Date().toISOString()],
  );
  touch(db, userId, listId);
  return { ok: true, value: getList(db, userId, listId, today)! };
}

export function updateItem(db: Database, userId: string, itemId: string, patch: Partial<ItemDraft>, today: string): Result<ShoppingListDetail> {
  const r = queryOne<ItemRow>(db, `SELECT * FROM shopping_items WHERE id = ? AND user_id = ?`, [itemId, userId]);
  if (!r) return fail(404, 'Item not found');
  if (patch.categoryId !== undefined && !ownsCategory(db, userId, patch.categoryId)) return fail(400, 'Unknown budget category');
  run(
    db,
    `UPDATE shopping_items SET name = ?, quantity = ?, est_price_nzd = ?, category_id = ?, ticked = ?, product_key = ? WHERE id = ? AND user_id = ?`,
    [
      patch.name ?? r.name,
      patch.quantity ?? r.quantity,
      patch.estPriceNzd !== undefined ? patch.estPriceNzd : r.est_price_nzd,
      patch.categoryId !== undefined ? patch.categoryId : r.category_id,
      patch.ticked !== undefined ? (patch.ticked ? 1 : 0) : r.ticked,
      patch.productKey !== undefined ? patch.productKey : r.product_key,
      itemId,
      userId,
    ],
  );
  touch(db, userId, r.list_id);
  return { ok: true, value: getList(db, userId, r.list_id, today)! };
}

export function deleteItem(db: Database, userId: string, itemId: string, today: string): ShoppingListDetail | null {
  const r = queryOne<{ list_id: string }>(db, `SELECT list_id FROM shopping_items WHERE id = ? AND user_id = ?`, [itemId, userId]);
  if (!r) return null;
  run(db, `DELETE FROM shopping_items WHERE id = ? AND user_id = ?`, [itemId, userId]);
  touch(db, userId, r.list_id);
  return getList(db, userId, r.list_id, today);
}

// ---------------------------------------------------------------- settings

type PrefsRow = { contribute_prices: number; stores_json: string; window_days: number };

function parseStores(raw: unknown): StoreRef[] | null {
  if (!Array.isArray(raw) || raw.length > 10) return null;
  const out: StoreRef[] = [];
  const seen = new Set<string>();
  for (const s of raw) {
    const o = obj(s);
    if (!o || !isChain(o.chain)) return null;
    const branch = typeof o.branch === 'string' ? tidyText(o.branch, 200) : '';
    if (!branch || branch.length > 60) return null;
    const key = `${o.chain}|${normaliseName(branch)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ chain: o.chain, branch });
  }
  return out;
}

export function getPrefs(db: Database, userId: string): ShoppingPrefs {
  const r = queryOne<PrefsRow>(db, `SELECT * FROM shopping_prefs WHERE user_id = ?`, [userId]);
  let stores: StoreRef[] = [];
  try {
    stores = r ? (parseStores(JSON.parse(r.stores_json)) ?? []) : [];
  } catch {
    stores = [];
  }
  return {
    contributePrices: Boolean(r?.contribute_prices),
    stores,
    windowDays: r && (WINDOW_OPTIONS as readonly number[]).includes(r.window_days) ? r.window_days : 60,
  };
}

export function updatePrefs(db: Database, userId: string, body: unknown): Result<ShoppingPrefs> {
  const o = obj(body);
  if (!o) return fail(400, 'Body is required');
  const cur = getPrefs(db, userId);
  let stores = cur.stores;
  if (o.stores !== undefined) {
    const parsed = parseStores(o.stores);
    if (!parsed) return fail(400, 'Stores must be up to 10, each a supermarket chain and a branch name');
    stores = parsed;
  }
  let windowDays = cur.windowDays;
  if (o.windowDays !== undefined) {
    if (!(WINDOW_OPTIONS as readonly number[]).includes(Number(o.windowDays))) return fail(400, `Price window must be one of ${WINDOW_OPTIONS.join(', ')} days`);
    windowDays = Number(o.windowDays);
  }
  const contribute = o.contributePrices !== undefined ? o.contributePrices === true : cur.contributePrices;
  run(
    db,
    `INSERT INTO shopping_prefs (user_id, contribute_prices, stores_json, window_days, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET contribute_prices = excluded.contribute_prices, stores_json = excluded.stores_json,
       window_days = excluded.window_days, updated_at = excluded.updated_at`,
    [userId, contribute ? 1 : 0, JSON.stringify(stores), windowDays, new Date().toISOString()],
  );
  return { ok: true, value: getPrefs(db, userId) };
}

// ---------------------------------------------------------------- recording prices

/**
 * Prices paid at one store. Each becomes the item's own price; when the user has opted in,
 * it is also shared (pseudonymously), up to the daily limit.
 */
export function recordPrices(
  db: Database,
  userId: string,
  listId: string,
  body: unknown,
  today: string,
): Result<{ list: ShoppingListDetail; shared: number; notShared: number }> {
  if (!listRow(db, userId, listId)) return fail(404, 'List not found');
  const o = obj(body);
  if (!o || !isChain(o.chain)) return fail(400, 'Choose a supermarket');
  const branch = typeof o.branch === 'string' ? tidyText(o.branch, 200) : '';
  if (!branch || branch.length > 60) return fail(400, 'Branch name is required (up to 60 characters)');
  if (!Array.isArray(o.prices) || o.prices.length === 0 || o.prices.length > 200) return fail(400, 'Add at least one price');
  const entries: { itemId: string; price: number }[] = [];
  for (const p of o.prices) {
    const e = obj(p);
    const price = Number(e?.priceNzd);
    if (!e || typeof e.itemId !== 'string' || !Number.isFinite(price) || price <= 0 || price > MAX_PRICE_NZD) {
      return fail(400, `Each price must be more than 0 and at most ${MAX_PRICE_NZD}`);
    }
    entries.push({ itemId: e.itemId, price: roundMoney(price) });
  }
  const items = new Map(itemsOf(db, userId, listId).map((r) => [r.id, r]));
  if (entries.some((e) => !items.has(e.itemId))) return fail(400, 'Prices must be for items on this list');

  const share = getPrefs(db, userId).contributePrices;
  const contributor = priceContributor(userId);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const used = Number(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM price_observations WHERE contributor = ? AND created_at >= ?`, [contributor, since])?.n ?? 0);
  let room = share ? Math.max(0, DAILY_CONTRIBUTION_LIMIT - used) : 0;
  let shared = 0;
  const now = new Date().toISOString();
  for (const e of entries) {
    const item = items.get(e.itemId)!;
    run(db, `UPDATE shopping_items SET est_price_nzd = ? WHERE id = ? AND user_id = ?`, [e.price, e.itemId, userId]);
    if (room > 0) {
      run(
        db,
        `INSERT INTO price_observations (id, product_key, product_name, chain, branch_key, branch_name, price_nzd, observed_on, contributor, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [newId('pob'), item.product_key ?? normaliseName(item.name), item.name, o.chain, normaliseName(branch), branch, e.price, today, contributor, now],
      );
      room -= 1;
      shared += 1;
    }
  }
  touch(db, userId, listId);
  return { ok: true, value: { list: getList(db, userId, listId, today)!, shared, notShared: share ? entries.length - shared : 0 } };
}

export function removeMyPrices(db: Database, userId: string): number {
  const contributor = priceContributor(userId);
  const n = Number(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM price_observations WHERE contributor = ?`, [contributor])?.n ?? 0);
  run(db, `DELETE FROM price_observations WHERE contributor = ?`, [contributor]);
  return n;
}

export function mySharedCount(db: Database, userId: string): number {
  return Number(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM price_observations WHERE contributor = ?`, [priceContributor(userId)])?.n ?? 0);
}

// ---------------------------------------------------------------- comparison

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function compareList(db: Database, userId: string, listId: string, today: string): Result<ShoppingCompareResponse> {
  if (!listRow(db, userId, listId)) return fail(404, 'List not found');
  const prefs = getPrefs(db, userId);
  const items = itemsOf(db, userId, listId).map(presentItem);
  const from = shiftDays(today, -prefs.windowDays);
  const cells = new Map<string, PriceCell>();
  const keys = [...new Set(items.map((i) => i.productKey))];
  for (const key of keys) {
    for (const s of prefs.stores) {
      const rows = queryAll<{ price_nzd: number; observed_on: string }>(
        db,
        `SELECT price_nzd, observed_on FROM price_observations
         WHERE product_key = ? AND chain = ? AND branch_key = ? AND observed_on >= ? AND observed_on <= ?`,
        [key, s.chain, normaliseName(s.branch), from, today],
      );
      if (rows.length === 0) continue;
      cells.set(`${key}@${s.chain}|${normaliseName(s.branch)}`, {
        values: rows.map((r) => Number(r.price_nzd)),
        latest: rows.reduce((m, r) => (r.observed_on > m ? r.observed_on : m), rows[0].observed_on),
      });
    }
  }
  const result = compareStores(
    items.map((i) => ({ id: i.id, productKey: i.productKey, quantity: i.quantity })),
    prefs.stores,
    cells,
  );
  return { ok: true, value: { ...result, windowDays: prefs.windowDays, from, to: today } };
}

// ---------------------------------------------------------------- matching help

/**
 * Shared product names for correcting a match. Only names recorded by at least two
 * different people are offered, so a name one person typed is never shown to others.
 */
export function searchProducts(db: Database, q: string): { key: string; name: string }[] {
  const term = normaliseName(q).slice(0, 60);
  if (term.length < 2) return [];
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return queryAll<{ key: string; name: string }>(
    db,
    `SELECT product_key AS key, MIN(product_name) AS name FROM price_observations
     WHERE product_key LIKE ? ESCAPE '\\'
     GROUP BY product_key HAVING COUNT(DISTINCT contributor) >= 2
     ORDER BY COUNT(*) DESC LIMIT 15`,
    [like],
  );
}

/** Branch names already used for a chain, so people pick the same spelling. */
export function searchBranches(db: Database, chain: ChainId, q: string): string[] {
  const term = normaliseName(q).slice(0, 60);
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return queryAll<{ name: string }>(
    db,
    `SELECT MIN(branch_name) AS name FROM price_observations WHERE chain = ? AND branch_key LIKE ? ESCAPE '\\'
     GROUP BY branch_key ORDER BY COUNT(*) DESC LIMIT 10`,
    [chain, like],
  ).map((r) => r.name);
}
