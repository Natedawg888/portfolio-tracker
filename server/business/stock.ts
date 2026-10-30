/**
 * Stock for one of the user's businesses (KAN-107): items, purchase batches and adjustments.
 * On-hand, average cost and margin are derived on every read (src/lib/stock.ts), from one
 * business's rows loaded in a fixed number of queries. Every query filters on user_id and
 * business_id; another user's or business's id behaves like a missing row.
 *
 * Items are never deleted here: archiving hides one from the chart and new sales and keeps its
 * history. An archived item takes no new batches (restore it first); adjustments and edits to
 * its past batches are still allowed, so its last stock can be written off.
 */
import type { Database } from 'sql.js';
import { roundQty } from '../../src/lib/business.ts';
import { isYmd } from '../../src/lib/invoiceCalc.ts';
import {
  isStockUnit,
  landedCosts,
  onChart,
  replayStock,
  stockPosition,
  type StockAdjustment,
  type StockBatch,
  type StockItem,
  type StockItemView,
  type StockSaleLine,
  type StockUnit,
  type SupplierInvoiceCost,
} from '../../src/lib/stock.ts';
import { roundMoney } from '../../src/lib/debtModel.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { deleteStockPhoto, photoUrlFromPath, saveStockPhoto } from '../lib/uploads.ts';
import { businessRow } from './profile.ts';

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

const MAX_MONEY = 100_000_000;
const MAX_QTY = 10_000_000;

// ---------------------------------------------------------------- parsing

function obj(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function text(o: Record<string, unknown>, key: string, max: number): string {
  const v = o[key];
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function longText(o: Record<string, unknown>, key: string, max: number): string {
  const v = o[key];
  return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '';
}

/** Blank → null. Otherwise a number from 0 up. */
function optionalNumber(raw: unknown, label: string, max: number): Parsed<number | null> {
  if (raw == null || raw === '') return { ok: true, value: null };
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number` };
  if (n < 0) return { ok: false, error: `${label} can't be negative` };
  if (n > max) return { ok: false, error: `${label} is too large` };
  return { ok: true, value: n };
}

function pastDate(raw: unknown, today: string): Parsed<string> {
  const date = raw == null || raw === '' ? today : raw;
  if (!isYmd(date)) return { ok: false, error: 'Date must be YYYY-MM-DD' };
  // On-hand is a figure for today, so stock can't arrive or be counted in the future.
  if (date > today) return { ok: false, error: 'Date can’t be in the future' };
  return { ok: true, value: date };
}

export type StockItemDraft = { name: string; sku: string; unit: StockUnit; sellPriceNzd: number | null; reorderLevel: number | null; notes: string };

export function parseStockItem(raw: unknown): Parsed<StockItemDraft> {
  const o = obj(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  const name = text(o, 'name', 120);
  if (!name) return { ok: false, error: 'Name is required' };
  const unit = o.unit == null || o.unit === '' ? 'each' : o.unit;
  if (!isStockUnit(unit)) return { ok: false, error: 'Unit must be each, kg or L' };
  const sell = optionalNumber(o.sellPriceNzd, 'Sell price', MAX_MONEY);
  if (!sell.ok) return sell;
  const reorder = optionalNumber(o.reorderLevel, 'Reorder level', MAX_QTY);
  if (!reorder.ok) return reorder;
  return {
    ok: true,
    value: {
      name,
      sku: text(o, 'sku', 40),
      unit,
      sellPriceNzd: sell.value == null ? null : roundMoney(sell.value),
      reorderLevel: reorder.value == null ? null : roundQty(reorder.value),
      notes: longText(o, 'notes', 1000),
    },
  };
}

export type StockBatchDraft = { date: string; quantity: number; unitCostNzd: number; notes: string };

export function parseStockBatch(raw: unknown, today: string): Parsed<StockBatchDraft> {
  const o = obj(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  const date = pastDate(o.date, today);
  if (!date.ok) return date;
  const qty = optionalNumber(o.quantity, 'Quantity', MAX_QTY);
  if (!qty.ok) return qty;
  const quantity = roundQty(qty.value ?? 0);
  if (quantity <= 0) return { ok: false, error: 'Quantity must be more than 0' };
  const cost = optionalNumber(o.unitCostNzd, 'Unit cost', MAX_MONEY);
  if (!cost.ok) return cost;
  // Required, never defaulted: a batch with a made-up cost would skew every later average.
  if (cost.value == null) return { ok: false, error: 'Unit cost is required (0 for stock that was free)' };
  return { ok: true, value: { date: date.value, quantity, unitCostNzd: cost.value, notes: text(o, 'notes', 200) } };
}

export type StockAdjustmentDraft = { date: string; reason: string } & ({ kind: 'damage'; quantityLost: number } | { kind: 'recount'; countedQuantity: number });

export function parseStockAdjustment(raw: unknown, today: string): Parsed<StockAdjustmentDraft> {
  const o = obj(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  if (o.kind !== 'damage' && o.kind !== 'recount') return { ok: false, error: 'Kind must be damage or recount' };
  const date = pastDate(o.date, today);
  if (!date.ok) return date;
  const reason = text(o, 'reason', 200);
  if (!reason) return { ok: false, error: 'Reason is required' };
  if (o.kind === 'damage') {
    const lost = optionalNumber(o.quantityLost, 'Quantity lost', MAX_QTY);
    if (!lost.ok) return lost;
    const quantityLost = roundQty(lost.value ?? 0);
    if (quantityLost <= 0) return { ok: false, error: 'Quantity lost must be more than 0' };
    return { ok: true, value: { kind: 'damage', date: date.value, reason, quantityLost } };
  }
  const counted = optionalNumber(o.countedQuantity, 'Counted quantity', MAX_QTY);
  if (!counted.ok) return counted;
  if (counted.value == null) return { ok: false, error: 'Counted quantity is required' };
  return { ok: true, value: { kind: 'recount', date: date.value, reason, countedQuantity: roundQty(counted.value) } };
}

// ---------------------------------------------------------------- rows

type ItemRow = {
  id: string;
  business_id: string;
  name: string;
  sku: string;
  unit: string;
  sell_price_nzd: number | null;
  reorder_level: number | null;
  photo_path: string | null;
  notes: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};
type BatchRow = { id: string; item_id: string; date: string; quantity: number; unit_cost_nzd: number; notes: string; created_at: string };
type AdjustmentRow = {
  id: string;
  item_id: string;
  date: string;
  kind: string;
  quantity_lost: number | null;
  counted_quantity: number | null;
  reason: string;
  created_at: string;
};
type SaleLineRow = { id: string; sale_id: string; item_id: string; quantity: number; unit_price_nzd: number; date: string; created_at: string };
type InvoiceRow = { id: string; kind: string; amount_nzd: number; delivery_nzd: number; delivery_treatment: string };

const presentItem = (r: ItemRow): StockItem => ({
  id: r.id,
  businessId: r.business_id,
  name: r.name,
  sku: r.sku ?? '',
  unit: isStockUnit(r.unit) ? r.unit : 'each',
  sellPriceNzd: r.sell_price_nzd == null ? null : Number(r.sell_price_nzd),
  reorderLevel: r.reorder_level == null ? null : Number(r.reorder_level),
  photoUrl: photoUrlFromPath(r.photo_path),
  notes: r.notes ?? '',
  archivedAt: r.archived_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const presentBatch = (r: BatchRow): StockBatch => ({
  id: r.id,
  itemId: r.item_id,
  date: r.date,
  quantity: Number(r.quantity),
  unitCostNzd: Number(r.unit_cost_nzd),
  notes: r.notes ?? '',
  createdAt: r.created_at,
});

const presentAdjustment = (r: AdjustmentRow): StockAdjustment => {
  const base = { id: r.id, itemId: r.item_id, date: r.date, reason: r.reason, createdAt: r.created_at };
  return r.kind === 'damage' ? { ...base, kind: 'damage', quantityLost: Number(r.quantity_lost) } : { ...base, kind: 'recount', countedQuantity: Number(r.counted_quantity) };
};

function groupBy<T extends { itemId: string }>(list: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of list) out.set(x.itemId, [...(out.get(x.itemId) ?? []), x]);
  return out;
}

const newestFirst = <T extends { date: string; createdAt: string }>(a: T, b: T) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

/**
 * Every item of the business with its derived position, in six queries however many items there
 * are. Freight is allocated across the whole business at once because one bill can cover batches
 * of several items.
 */
function loadStock(db: Database, userId: string, businessId: string): StockItemView[] {
  return replayBusiness(db, userId, businessId).views;
}

/**
 * Cost of goods sold for each sale line of the business, at the average cost when it sold
 * (KAN-120). null when the item had no batch before the sale.
 */
export function saleLineCosts(db: Database, userId: string, businessId: string): Map<string, number | null> {
  return replayBusiness(db, userId, businessId).lineCost;
}

function replayBusiness(db: Database, userId: string, businessId: string): { views: StockItemView[]; lineCost: Map<string, number | null> } {
  const scope = [userId, businessId];
  const items = queryAll<ItemRow>(db, `SELECT * FROM business_stock_items WHERE user_id = ? AND business_id = ? ORDER BY lower(name), created_at, id`, scope).map(presentItem);
  if (!items.length) return { views: [], lineCost: new Map() };
  const batches = queryAll<BatchRow>(db, `SELECT * FROM business_stock_batches WHERE user_id = ? AND business_id = ?`, scope).map(presentBatch);
  const adjustments = queryAll<AdjustmentRow>(db, `SELECT * FROM business_stock_adjustments WHERE user_id = ? AND business_id = ?`, scope).map(presentAdjustment);
  const saleLines = queryAll<SaleLineRow>(
    db,
    `SELECT l.id, l.sale_id, l.item_id, l.quantity, l.unit_price_nzd, s.date, s.created_at FROM business_sale_lines l
     JOIN business_sales s ON s.id = l.sale_id AND s.user_id = l.user_id AND s.business_id = l.business_id
     WHERE l.user_id = ? AND l.business_id = ?`,
    scope,
  ).map((r): StockSaleLine => ({
    id: r.id, saleId: r.sale_id, itemId: r.item_id, quantity: Number(r.quantity), unitPriceNzd: Number(r.unit_price_nzd), date: r.date, createdAt: r.created_at,
  }));
  const links = new Map<string, string[]>();
  for (const l of queryAll<{ invoice_id: string; batch_id: string }>(
    db,
    `SELECT invoice_id, batch_id FROM business_supplier_invoice_batches WHERE user_id = ? AND business_id = ?`,
    scope,
  )) {
    links.set(l.invoice_id, [...(links.get(l.invoice_id) ?? []), l.batch_id]);
  }
  const invoices = queryAll<InvoiceRow>(
    db,
    `SELECT id, kind, amount_nzd, delivery_nzd, delivery_treatment FROM business_supplier_invoices
     WHERE user_id = ? AND business_id = ? AND delivery_treatment = 'capitalise' AND delivery_nzd > 0`,
    scope,
  ).map((r): SupplierInvoiceCost => ({
    id: r.id,
    kind: r.kind === 'delivery' ? 'delivery' : 'stock',
    amountNzd: Number(r.amount_nzd),
    deliveryNzd: Number(r.delivery_nzd),
    deliveryTreatment: 'capitalise',
    batchIds: links.get(r.id) ?? [],
  }));

  const landed = landedCosts(batches, invoices);
  const batchesOf = groupBy(batches);
  const adjustmentsOf = groupBy(adjustments);
  const linesOf = groupBy(saleLines);
  const lineCost = new Map<string, number | null>();
  const views = items.map((item) => {
    const own = batchesOf.get(item.id) ?? [];
    const adj = adjustmentsOf.get(item.id) ?? [];
    const ledger = replayStock({ batches: own, landed, adjustments: adj, saleLines: linesOf.get(item.id) ?? [] });
    for (const [id, cost] of ledger.lineCost) lineCost.set(id, cost);
    return {
      ...item,
      position: stockPosition(item, ledger),
      onChart: onChart(item),
      batches: own.map((b) => ({ ...b, landedNzd: roundMoney(landed.get(b.id)!) })).sort(newestFirst),
      adjustments: [...adj].sort(newestFirst),
    };
  });
  return { views, lineCost };
}

function itemRow(db: Database, userId: string, id: string): ItemRow | null {
  return queryOne<ItemRow>(db, `SELECT * FROM business_stock_items WHERE id = ? AND user_id = ?`, [id, userId]);
}

function itemView(db: Database, userId: string, r: Pick<ItemRow, 'id' | 'business_id'>): StockItemView {
  return loadStock(db, userId, r.business_id).find((i) => i.id === r.id)!;
}

// ---------------------------------------------------------------- reads

export function listStock(db: Database, userId: string, businessId: string, opts: { includeArchived: boolean }): Result<StockItemView[]> {
  if (!businessRow(db, userId, businessId)) return fail(404, 'Business not found');
  const items = loadStock(db, userId, businessId);
  return { ok: true, value: opts.includeArchived ? items : items.filter((i) => i.onChart) };
}

/**
 * Stock on hand at cost: max(on-hand, 0) × average cost per item, archived items included (an
 * archived item is hidden, not written off). null when no item has a cost yet. Stock items are
 * their own table, so this never overlaps the business_assets total.
 */
export function stockValue(db: Database, userId: string, businessId: string): number | null {
  const valued = loadStock(db, userId, businessId).filter((i) => i.position.valueNzd != null);
  return valued.length ? roundMoney(valued.reduce((s, i) => s + i.position.valueNzd!, 0)) : null;
}

// ---------------------------------------------------------------- items

function skuTaken(db: Database, userId: string, businessId: string, sku: string, exceptId: string | null): string | null {
  if (!sku) return null;
  const hit = queryOne<{ name: string }>(
    db,
    `SELECT name FROM business_stock_items WHERE user_id = ? AND business_id = ? AND lower(sku) = lower(?) AND id IS NOT ?`,
    [userId, businessId, sku, exceptId],
  );
  return hit ? `SKU ${sku} is already used by ${hit.name}` : null;
}

export function createItem(db: Database, userId: string, businessId: string, d: StockItemDraft): Result<StockItemView> {
  if (!businessRow(db, userId, businessId)) return fail(404, 'Business not found');
  const taken = skuTaken(db, userId, businessId, d.sku, null);
  if (taken) return fail(409, taken);
  const id = newId('stock');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO business_stock_items (id, user_id, business_id, name, sku, unit, sell_price_nzd, reorder_level, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, businessId, d.name, d.sku, d.unit, d.sellPriceNzd, d.reorderLevel, d.notes, now, now],
  );
  return { ok: true, value: itemView(db, userId, { id, business_id: businessId }) };
}

export function updateItem(db: Database, userId: string, id: string, d: StockItemDraft): Result<StockItemView> {
  const r = itemRow(db, userId, id);
  if (!r) return fail(404, 'Stock item not found');
  const taken = skuTaken(db, userId, r.business_id, d.sku, id);
  if (taken) return fail(409, taken);
  run(
    db,
    `UPDATE business_stock_items SET name=?, sku=?, unit=?, sell_price_nzd=?, reorder_level=?, notes=?, updated_at=?
     WHERE id=? AND user_id=? AND business_id=?`,
    [d.name, d.sku, d.unit, d.sellPriceNzd, d.reorderLevel, d.notes, new Date().toISOString(), id, userId, r.business_id],
  );
  return { ok: true, value: itemView(db, userId, r) };
}

/** Archive or restore. Repeating either is a no-op that keeps the first archive time. */
export function setItemArchived(db: Database, userId: string, id: string, archived: boolean): Result<StockItemView> {
  const r = itemRow(db, userId, id);
  if (!r) return fail(404, 'Stock item not found');
  if (archived !== (r.archived_at != null)) {
    const now = new Date().toISOString();
    run(db, `UPDATE business_stock_items SET archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND business_id = ?`, [
      archived ? now : null, now, id, userId, r.business_id,
    ]);
  }
  return { ok: true, value: itemView(db, userId, r) };
}

export function setItemPhoto(db: Database, userId: string, id: string, image: string): Result<StockItemView> {
  const r = itemRow(db, userId, id);
  if (!r) return fail(404, 'Stock item not found');
  let rel: string;
  try {
    rel = saveStockPhoto(id, image);
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : 'Invalid image');
  }
  run(db, `UPDATE business_stock_items SET photo_path = ?, updated_at = ? WHERE id = ? AND user_id = ? AND business_id = ?`, [
    rel, new Date().toISOString(), id, userId, r.business_id,
  ]);
  return { ok: true, value: itemView(db, userId, r) };
}

export function removeItemPhoto(db: Database, userId: string, id: string): Result<StockItemView> {
  const r = itemRow(db, userId, id);
  if (!r) return fail(404, 'Stock item not found');
  deleteStockPhoto(r.photo_path);
  run(db, `UPDATE business_stock_items SET photo_path = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND business_id = ?`, [
    new Date().toISOString(), id, userId, r.business_id,
  ]);
  return { ok: true, value: itemView(db, userId, r) };
}

/** Photo paths of a business's items, or of all the user's items, for deleting the files. */
export function stockPhotoPaths(db: Database, userId: string, businessId: string | null): string[] {
  return queryAll<{ p: string }>(
    db,
    `SELECT photo_path AS p FROM business_stock_items WHERE user_id = ? AND (? IS NULL OR business_id = ?) AND photo_path IS NOT NULL`,
    [userId, businessId, businessId],
  ).map((r) => r.p);
}

// ---------------------------------------------------------------- batches

export function addBatch(db: Database, userId: string, itemId: string, d: StockBatchDraft): Result<StockItemView> {
  const r = itemRow(db, userId, itemId);
  if (!r) return fail(404, 'Stock item not found');
  if (r.archived_at) return fail(409, `${r.name} is archived. Restore it to add stock.`);
  run(
    db,
    `INSERT INTO business_stock_batches (id, user_id, business_id, item_id, date, quantity, unit_cost_nzd, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    [newId('sbatch'), userId, r.business_id, itemId, d.date, d.quantity, d.unitCostNzd, d.notes, new Date().toISOString()],
  );
  return { ok: true, value: itemView(db, userId, r) };
}

function batchItem(db: Database, userId: string, batchId: string): ItemRow | null {
  const b = queryOne<{ item_id: string; business_id: string }>(db, `SELECT item_id, business_id FROM business_stock_batches WHERE id = ? AND user_id = ?`, [batchId, userId]);
  const r = b && itemRow(db, userId, b.item_id);
  return r && r.business_id === b.business_id ? r : null;
}

export function updateBatch(db: Database, userId: string, batchId: string, d: StockBatchDraft): Result<StockItemView> {
  const r = batchItem(db, userId, batchId);
  if (!r) return fail(404, 'Batch not found');
  run(db, `UPDATE business_stock_batches SET date=?, quantity=?, unit_cost_nzd=?, notes=? WHERE id=? AND user_id=? AND business_id=?`, [
    d.date, d.quantity, d.unitCostNzd, d.notes, batchId, userId, r.business_id,
  ]);
  return { ok: true, value: itemView(db, userId, r) };
}

/** Deleting a batch also drops its links to supplier bills; the bills stay. */
export function deleteBatch(db: Database, userId: string, batchId: string): Result<StockItemView> {
  const r = batchItem(db, userId, batchId);
  if (!r) return fail(404, 'Batch not found');
  run(db, `DELETE FROM business_supplier_invoice_batches WHERE batch_id = ? AND user_id = ? AND business_id = ?`, [batchId, userId, r.business_id]);
  run(db, `DELETE FROM business_stock_batches WHERE id = ? AND user_id = ? AND business_id = ?`, [batchId, userId, r.business_id]);
  return { ok: true, value: itemView(db, userId, r) };
}

// ---------------------------------------------------------------- adjustments

export function addAdjustment(db: Database, userId: string, itemId: string, d: StockAdjustmentDraft): Result<StockItemView> {
  const r = itemRow(db, userId, itemId);
  if (!r) return fail(404, 'Stock item not found');
  run(
    db,
    `INSERT INTO business_stock_adjustments (id, user_id, business_id, item_id, date, kind, quantity_lost, counted_quantity, reason, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      newId('sadj'), userId, r.business_id, itemId, d.date, d.kind,
      d.kind === 'damage' ? d.quantityLost : null, d.kind === 'recount' ? d.countedQuantity : null, d.reason, new Date().toISOString(),
    ],
  );
  return { ok: true, value: itemView(db, userId, r) };
}

export function deleteAdjustment(db: Database, userId: string, id: string): Result<StockItemView> {
  const a = queryOne<{ item_id: string; business_id: string }>(db, `SELECT item_id, business_id FROM business_stock_adjustments WHERE id = ? AND user_id = ?`, [id, userId]);
  const r = a && itemRow(db, userId, a.item_id);
  if (!a || !r || r.business_id !== a.business_id) return fail(404, 'Adjustment not found');
  run(db, `DELETE FROM business_stock_adjustments WHERE id = ? AND user_id = ? AND business_id = ?`, [id, userId, r.business_id]);
  return { ok: true, value: itemView(db, userId, r) };
}
