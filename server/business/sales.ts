/**
 * Sales of stock for one of the user's businesses (KAN-120). A sale has lines of stock items
 * (quantity and the price charged), a date and optionally a client; its lines reduce on-hand
 * through server/business/stock.ts, which also gives each line its cost of goods sold.
 *
 * Income, counted once (businessMoney in store.ts):
 *   - a sale linked to one of the business's invoices counts through the invoice's payments,
 *     so it only moves stock;
 *   - any other sale is income on its date (payments basis: a sale is paid when it's made);
 *   - a bank deposit linked to a sale and tagged to the business isn't counted again.
 *
 * Receipt: upload a PDF or photo, or issue one. Issuing numbers it with the business's receipt
 * prefix (RCT-0001…) and snapshots the business and client; after that the sale can't be edited
 * (a receipt was given out), only deleted. A sale has one or the other, never both.
 *
 * Every query filters on user_id and business_id; another user's or business's id behaves like
 * a missing row. Archived items can't go on new lines (checkSaleItems).
 */
import type { Database } from 'sql.js';
import { isYmd } from '../../src/lib/invoiceCalc.ts';
import { roundMoney } from '../../src/lib/debtModel.ts';
import { roundQty } from '../../src/lib/business.ts';
import { checkSaleItems, type StockItem } from '../../src/lib/stock.ts';
import type { BusinessProfile, BusinessSale, BusinessSaleLine } from '../../src/types/index.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { deleteSaleReceiptFile, photoUrlFromPath, saveSaleReceiptFile } from '../lib/uploads.ts';
import { businessRow, profileFromBusiness } from './profile.ts';
import { saleLineCosts } from './stock.ts';

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

const MAX_MONEY = 100_000_000;
const MAX_QTY = 10_000_000;
export const MAX_SALE_LINES = 100;

// ---------------------------------------------------------------- parsing

function obj(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function idOrNull(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null;
}

export type SaleLineDraft = { itemId: string; quantity: number; unitPriceNzd: number | null };
export type SaleDraft = {
  date: string;
  clientId: string | null;
  invoiceId: string | null;
  transactionId: string | null;
  notes: string;
  lines: SaleLineDraft[];
};

/** unitPriceNzd may be left out: the item's sell price is used, and it's required if there isn't one. */
export function parseSale(raw: unknown, today: string): Parsed<SaleDraft> {
  const o = obj(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  const date = o.date == null || o.date === '' ? today : o.date;
  if (!isYmd(date)) return { ok: false, error: 'Date must be YYYY-MM-DD' };
  // A sale takes stock off the shelf today or earlier; future on-hand isn't a thing.
  if (date > today) return { ok: false, error: 'Date can’t be in the future' };
  const invoiceId = idOrNull(o, 'invoiceId');
  const transactionId = idOrNull(o, 'transactionId');
  if (invoiceId && transactionId) return { ok: false, error: 'Link the sale to an invoice or to a bank deposit, not both' };
  if (!Array.isArray(o.lines) || o.lines.length === 0) return { ok: false, error: 'Add at least one item' };
  if (o.lines.length > MAX_SALE_LINES) return { ok: false, error: `A sale can have up to ${MAX_SALE_LINES} lines` };
  const lines: SaleLineDraft[] = [];
  for (const [i, rawLine] of o.lines.entries()) {
    const l = obj(rawLine);
    const n = i + 1;
    if (!l) return { ok: false, error: `Line ${n} is invalid` };
    const itemId = idOrNull(l, 'itemId');
    if (!itemId) return { ok: false, error: `Line ${n}: pick an item` };
    const q = typeof l.quantity === 'number' ? l.quantity : Number(l.quantity);
    if (!Number.isFinite(q) || q <= 0) return { ok: false, error: `Line ${n}: quantity must be more than 0` };
    if (q > MAX_QTY) return { ok: false, error: `Line ${n}: quantity is too large` };
    let price: number | null = null;
    if (l.unitPriceNzd != null && l.unitPriceNzd !== '') {
      const p = typeof l.unitPriceNzd === 'number' ? l.unitPriceNzd : Number(l.unitPriceNzd);
      if (!Number.isFinite(p) || p < 0) return { ok: false, error: `Line ${n}: price must be 0 or more` };
      if (p > MAX_MONEY) return { ok: false, error: `Line ${n}: price is too large` };
      price = roundMoney(p);
    }
    lines.push({ itemId, quantity: roundQty(q), unitPriceNzd: price });
  }
  const notes = typeof o.notes === 'string' ? o.notes.replace(/\r\n?/g, '\n').trim().slice(0, 2000) : '';
  return { ok: true, value: { date, clientId: idOrNull(o, 'clientId'), invoiceId, transactionId, notes, lines } };
}

// ---------------------------------------------------------------- rows

type SaleRow = {
  id: string;
  user_id: string;
  business_id: string;
  date: string;
  client_id: string | null;
  invoice_id: string | null;
  transaction_id: string | null;
  notes: string;
  receipt_path: string | null;
  receipt_name: string;
  receipt_number: string | null;
  receipt_number_key: string | null;
  receipt_issued_at: string | null;
  receipt_snapshot_json: string | null;
  created_at: string;
  updated_at: string;
};
type LineRow = { id: string; sale_id: string; item_id: string; position: number; description: string; quantity: number; unit_price_nzd: number };
type ItemRow = { id: string; name: string; unit: string; sell_price_nzd: number | null; archived_at: string | null };

function saleRow(db: Database, userId: string, id: string): SaleRow | null {
  return queryOne<SaleRow>(db, `SELECT * FROM business_sales WHERE id = ? AND user_id = ?`, [id, userId]);
}

function itemsOf(db: Database, userId: string, businessId: string): Map<string, ItemRow> {
  return new Map(
    queryAll<ItemRow>(db, `SELECT id, name, unit, sell_price_nzd, archived_at FROM business_stock_items WHERE user_id = ? AND business_id = ?`, [userId, businessId]).map((r) => [r.id, r]),
  );
}

const asStockItem = (r: ItemRow) => ({ id: r.id, name: r.name, archivedAt: r.archived_at }) as unknown as StockItem;

function loadSales(db: Database, userId: string, businessId: string, opts: { id?: string; from?: string; to?: string } = {}): BusinessSale[] {
  const where = ['s.user_id = ?', 's.business_id = ?'];
  const params: unknown[] = [userId, businessId];
  for (const [cond, value] of [['s.id = ?', opts.id], ['s.date >= ?', opts.from], ['s.date <= ?', opts.to]] as const) {
    if (!value) continue;
    where.push(cond);
    params.push(value);
  }
  const sales = queryAll<SaleRow & { client_name: string | null; invoice_number: string | null }>(
    db,
    `SELECT s.*, c.name AS client_name, i.number AS invoice_number FROM business_sales s
     LEFT JOIN invoice_clients c ON c.id = s.client_id AND c.user_id = s.user_id
     LEFT JOIN invoices i ON i.id = s.invoice_id AND i.user_id = s.user_id
     WHERE ${where.join(' AND ')} ORDER BY s.date DESC, s.created_at DESC, s.id`,
    params,
  );
  if (!sales.length) return [];
  const ids = sales.map((s) => s.id);
  const lines = queryAll<LineRow>(
    db,
    `SELECT id, sale_id, item_id, position, description, quantity, unit_price_nzd FROM business_sale_lines
     WHERE user_id = ? AND business_id = ? AND sale_id IN (${ids.map(() => '?').join(',')}) ORDER BY position`,
    [userId, businessId, ...ids],
  );
  const items = itemsOf(db, userId, businessId);
  const costs = saleLineCosts(db, userId, businessId);
  const gst = Number(businessRow(db, userId, businessId)?.gst_registered) === 1;
  const linesOf = new Map<string, BusinessSaleLine[]>();
  for (const l of lines) {
    const cost = costs.get(l.id);
    const line: BusinessSaleLine = {
      id: l.id,
      itemId: l.item_id,
      description: l.description,
      quantity: Number(l.quantity),
      unit: items.get(l.item_id)?.unit ?? '',
      unitPriceNzd: Number(l.unit_price_nzd),
      totalNzd: roundMoney(Number(l.quantity) * Number(l.unit_price_nzd)),
      costNzd: cost == null ? null : roundMoney(cost),
    };
    linesOf.set(l.sale_id, [...(linesOf.get(l.sale_id) ?? []), line]);
  }
  return sales.map((s) => {
    const own = linesOf.get(s.id) ?? [];
    const total = roundMoney(own.reduce((t, l) => t + l.totalNzd, 0));
    const cost = own.some((l) => l.costNzd == null) ? null : roundMoney(own.reduce((t, l) => t + l.costNzd!, 0));
    return {
      id: s.id,
      businessId: s.business_id,
      date: s.date,
      clientId: s.client_id,
      clientName: s.client_name ?? null,
      invoiceId: s.invoice_id,
      invoiceNumber: s.invoice_number ?? null,
      transactionId: s.transaction_id,
      notes: s.notes ?? '',
      lines: own,
      totalNzd: total,
      gstNzd: gst ? roundMoney((total * 3) / 23) : null,
      costNzd: cost,
      grossProfitNzd: cost == null ? null : roundMoney(total - cost),
      countsAsIncome: !s.invoice_id,
      receipt: s.receipt_number
        ? { kind: 'issued' as const, number: s.receipt_number, issuedAt: s.receipt_issued_at!, pdfUrl: `/api/business/sales/${encodeURIComponent(s.id)}/receipt.pdf` }
        : s.receipt_path
          ? { kind: 'uploaded' as const, url: photoUrlFromPath(s.receipt_path)!, name: s.receipt_name || 'Receipt' }
          : null,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    };
  });
}

function saleView(db: Database, userId: string, r: Pick<SaleRow, 'id' | 'business_id'>): BusinessSale {
  return loadSales(db, userId, r.business_id, { id: r.id })[0];
}

// ---------------------------------------------------------------- reads

export function listSales(db: Database, userId: string, businessId: string, range: { from?: string; to?: string }): Result<BusinessSale[]> {
  if (!businessRow(db, userId, businessId)) return fail(404, 'Business not found');
  return { ok: true, value: loadSales(db, userId, businessId, range) };
}

/** Sales of the business dated in [start, end] that count as income (no invoice link). */
export function salesIncome(db: Database, userId: string, businessId: string, start: string, end: string): { id: string; date: string; description: string; amountNzd: number; transactionId: string | null }[] {
  const rows = queryAll<{ id: string; date: string; transaction_id: string | null; receipt_number: string | null; client_name: string | null; total: number | null }>(
    db,
    `SELECT s.id, s.date, s.transaction_id, s.receipt_number, c.name AS client_name,
            (SELECT SUM(l.quantity * l.unit_price_nzd) FROM business_sale_lines l WHERE l.sale_id = s.id AND l.user_id = s.user_id) AS total
     FROM business_sales s LEFT JOIN invoice_clients c ON c.id = s.client_id AND c.user_id = s.user_id
     WHERE s.user_id = ? AND s.business_id = ? AND s.invoice_id IS NULL AND s.date >= ? AND s.date <= ?
     ORDER BY s.date, s.id`,
    [userId, businessId, start, end],
  );
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    description: ['Sale', r.receipt_number, r.client_name].filter(Boolean).join(' · '),
    amountNzd: roundMoney(Number(r.total ?? 0)),
    transactionId: r.transaction_id,
  }));
}

/** Deposit ids linked to this business's income-counting sales (any date), so they count once. */
export function saleLinkedDeposits(db: Database, userId: string, businessId: string): Set<string> {
  return new Set(
    queryAll<{ t: string }>(
      db,
      `SELECT transaction_id AS t FROM business_sales WHERE user_id = ? AND business_id = ? AND invoice_id IS NULL AND transaction_id IS NOT NULL`,
      [userId, businessId],
    ).map((r) => r.t),
  );
}

// ---------------------------------------------------------------- writes

function checkRefs(db: Database, userId: string, businessId: string, d: SaleDraft, exceptSaleId: string | null): Result<true> {
  if (d.clientId && !queryOne(db, `SELECT id FROM invoice_clients WHERE id = ? AND user_id = ? AND business_id = ?`, [d.clientId, userId, businessId])) {
    return fail(404, 'Client not found');
  }
  if (d.invoiceId) {
    const inv = queryOne<{ status: string }>(db, `SELECT status FROM invoices WHERE id = ? AND user_id = ? AND business_id = ?`, [d.invoiceId, userId, businessId]);
    if (!inv) return fail(404, 'Invoice not found');
    if (inv.status === 'void') return fail(409, 'That invoice is void');
  }
  if (d.transactionId) {
    const t = queryOne<{ amount: number; kind: string }>(db, `SELECT amount, kind FROM transactions WHERE id = ? AND user_id = ?`, [d.transactionId, userId]);
    if (!t) return fail(404, 'Bank transaction not found');
    if (!(Number(t.amount) > 0) || t.kind === 'transfer') return fail(400, 'Link a deposit (money in), not a payment or transfer');
    const other = queryOne(db, `SELECT id FROM business_sales WHERE user_id = ? AND transaction_id = ? AND id IS NOT ?`, [userId, d.transactionId, exceptSaleId]);
    if (other) return fail(409, 'That deposit is already linked to another sale');
  }
  return { ok: true, value: true };
}

/** Resolves prices (item sell price when left out) and checks items. */
function resolveLines(
  db: Database,
  userId: string,
  businessId: string,
  d: SaleDraft,
  editing: { lines: { itemId: string }[] } | null,
): Result<{ itemId: string; description: string; quantity: number; unitPriceNzd: number }[]> {
  const items = itemsOf(db, userId, businessId);
  const check = checkSaleItems(d.lines, new Map([...items].map(([id, r]) => [id, asStockItem(r)])), editing);
  if (!check.ok) {
    if (check.missing.length) return fail(404, 'Stock item not found');
    return fail(409, `${check.archived.map((i) => i.name).join(', ')} ${check.archived.length === 1 ? 'is' : 'are'} archived. Restore it on the Stock page to sell it.`);
  }
  const out = [];
  for (const [i, l] of d.lines.entries()) {
    const item = items.get(l.itemId)!;
    const price = l.unitPriceNzd ?? (item.sell_price_nzd == null ? null : Number(item.sell_price_nzd));
    if (price == null) return fail(400, `Line ${i + 1}: ${item.name} has no sell price. Enter the price charged.`);
    out.push({ itemId: l.itemId, description: item.name, quantity: l.quantity, unitPriceNzd: price });
  }
  return { ok: true, value: out };
}

function writeLines(db: Database, userId: string, businessId: string, saleId: string, lines: { itemId: string; description: string; quantity: number; unitPriceNzd: number }[]) {
  run(db, `DELETE FROM business_sale_lines WHERE sale_id = ? AND user_id = ? AND business_id = ?`, [saleId, userId, businessId]);
  lines.forEach((l, i) => {
    run(
      db,
      `INSERT INTO business_sale_lines (id, user_id, business_id, sale_id, item_id, position, description, quantity, unit_price_nzd) VALUES (?,?,?,?,?,?,?,?,?)`,
      [newId('sline'), userId, businessId, saleId, l.itemId, i, l.description, l.quantity, l.unitPriceNzd],
    );
  });
}

export function createSale(db: Database, userId: string, businessId: string, d: SaleDraft): Result<BusinessSale> {
  if (!businessRow(db, userId, businessId)) return fail(404, 'Business not found');
  const refs = checkRefs(db, userId, businessId, d, null);
  if (!refs.ok) return refs;
  const lines = resolveLines(db, userId, businessId, d, null);
  if (!lines.ok) return lines;
  const id = newId('sale');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO business_sales (id, user_id, business_id, date, client_id, invoice_id, transaction_id, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, businessId, d.date, d.clientId, d.invoiceId, d.transactionId, d.notes, now, now],
  );
  writeLines(db, userId, businessId, id, lines.value);
  return { ok: true, value: saleView(db, userId, { id, business_id: businessId }) };
}

export function updateSale(db: Database, userId: string, id: string, d: SaleDraft): Result<BusinessSale> {
  const r = saleRow(db, userId, id);
  if (!r) return fail(404, 'Sale not found');
  if (r.receipt_number) return fail(409, `Receipt ${r.receipt_number} was issued for this sale, so it can’t be changed. Delete it and record the sale again if it was wrong.`);
  const refs = checkRefs(db, userId, r.business_id, d, id);
  if (!refs.ok) return refs;
  const kept = queryAll<{ item_id: string }>(db, `SELECT item_id FROM business_sale_lines WHERE sale_id = ? AND user_id = ?`, [id, userId]).map((l) => ({ itemId: l.item_id }));
  const lines = resolveLines(db, userId, r.business_id, d, { lines: kept });
  if (!lines.ok) return lines;
  run(
    db,
    `UPDATE business_sales SET date=?, client_id=?, invoice_id=?, transaction_id=?, notes=?, updated_at=? WHERE id=? AND user_id=? AND business_id=?`,
    [d.date, d.clientId, d.invoiceId, d.transactionId, d.notes, new Date().toISOString(), id, userId, r.business_id],
  );
  writeLines(db, userId, r.business_id, id, lines.value);
  return { ok: true, value: saleView(db, userId, r) };
}

/** Deletes the sale, its lines and any uploaded receipt; its stock goes back on hand. */
export function deleteSale(db: Database, userId: string, id: string): Result<{ id: string }> {
  const r = saleRow(db, userId, id);
  if (!r) return fail(404, 'Sale not found');
  deleteSaleReceiptFile(r.receipt_path);
  run(db, `DELETE FROM business_sale_lines WHERE sale_id = ? AND user_id = ? AND business_id = ?`, [id, userId, r.business_id]);
  run(db, `DELETE FROM business_sales WHERE id = ? AND user_id = ? AND business_id = ?`, [id, userId, r.business_id]);
  return { ok: true, value: { id } };
}

// ---------------------------------------------------------------- receipts

function fileName(raw: unknown): string {
  const last = typeof raw === 'string' ? raw.split(/[\\/]/).pop()! : '';
  const base = [...last].filter((c) => c >= ' ').join('').trim();
  return base.slice(0, 120) || 'Receipt';
}

/** Attach (or replace) an uploaded receipt, checked by its file signature. */
export function setSaleReceiptFile(db: Database, userId: string, id: string, data: unknown, name: unknown): Result<BusinessSale> {
  const r = saleRow(db, userId, id);
  if (!r) return fail(404, 'Sale not found');
  if (r.receipt_number) return fail(409, `Receipt ${r.receipt_number} was issued for this sale`);
  if (typeof data !== 'string' || !data) return fail(400, 'Choose a file');
  let rel: string;
  try {
    rel = saveSaleReceiptFile(id, data);
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : 'Invalid file');
  }
  run(db, `UPDATE business_sales SET receipt_path = ?, receipt_name = ?, updated_at = ? WHERE id = ? AND user_id = ? AND business_id = ?`, [
    rel, fileName(name), new Date().toISOString(), id, userId, r.business_id,
  ]);
  return { ok: true, value: saleView(db, userId, r) };
}

export function clearSaleReceiptFile(db: Database, userId: string, id: string): Result<BusinessSale> {
  const r = saleRow(db, userId, id);
  if (!r) return fail(404, 'Sale not found');
  deleteSaleReceiptFile(r.receipt_path);
  run(db, `UPDATE business_sales SET receipt_path = NULL, receipt_name = '', updated_at = ? WHERE id = ? AND user_id = ? AND business_id = ?`, [
    new Date().toISOString(), id, userId, r.business_id,
  ]);
  return { ok: true, value: saleView(db, userId, r) };
}

export type ReceiptSnapshot = { business: BusinessProfile; client: { name: string; email: string; address: string } | null };

/** The next receipt number for this prefix across the user's sales: RCT-0001, RCT-0002… */
function nextReceiptNumber(db: Database, userId: string, prefix: string): string {
  const used = queryAll<{ n: string }>(db, `SELECT receipt_number AS n FROM business_sales WHERE user_id = ? AND receipt_number IS NOT NULL`, [userId]);
  let max = 0;
  for (const { n } of used) {
    if (!n.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const tail = Number(n.slice(prefix.length));
    if (Number.isInteger(tail) && tail > max) max = tail;
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/** Numbers the sale's receipt and snapshots who it's from and to. Issuing twice is a no-op. */
export function issueReceipt(db: Database, userId: string, id: string): Result<BusinessSale> {
  const r = saleRow(db, userId, id);
  if (!r) return fail(404, 'Sale not found');
  if (r.receipt_number) return { ok: true, value: saleView(db, userId, r) };
  if (r.receipt_path) return fail(409, 'This sale has an uploaded receipt. Remove it to issue one instead.');
  const b = businessRow(db, userId, r.business_id);
  if (!b) return fail(404, 'Business not found');
  const client = r.client_id
    ? queryOne<{ name: string; email: string; address: string }>(db, `SELECT name, email, address FROM invoice_clients WHERE id = ? AND user_id = ?`, [r.client_id, userId])
    : null;
  const snapshot: ReceiptSnapshot = { business: profileFromBusiness(b), client: client ? { name: client.name, email: client.email ?? '', address: client.address ?? '' } : null };
  const prefix = queryOne<{ p: string | null }>(db, `SELECT receipt_prefix AS p FROM businesses WHERE id = ? AND user_id = ?`, [r.business_id, userId])?.p;
  const number = nextReceiptNumber(db, userId, (prefix ?? '').trim() || 'RCT-');
  const now = new Date().toISOString();
  run(
    db,
    `UPDATE business_sales SET receipt_number = ?, receipt_number_key = ?, receipt_issued_at = ?, receipt_snapshot_json = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND business_id = ?`,
    [number, number.toLowerCase(), now, JSON.stringify(snapshot), now, id, userId, r.business_id],
  );
  return { ok: true, value: saleView(db, userId, r) };
}

/** What the receipt PDF prints, or null when the sale has no issued receipt. */
export function receiptForPdf(db: Database, userId: string, id: string): { sale: BusinessSale; snapshot: ReceiptSnapshot } | null {
  const r = saleRow(db, userId, id);
  if (!r?.receipt_number || !r.receipt_snapshot_json) return null;
  let snapshot: ReceiptSnapshot;
  try {
    snapshot = JSON.parse(r.receipt_snapshot_json) as ReceiptSnapshot;
  } catch {
    return null;
  }
  return { sale: saleView(db, userId, r), snapshot };
}

/** Uploaded receipt paths of a business, or of all the user's sales, for deleting the files. */
export function saleReceiptPaths(db: Database, userId: string, businessId: string | null): string[] {
  return queryAll<{ p: string }>(
    db,
    `SELECT receipt_path AS p FROM business_sales WHERE user_id = ? AND (? IS NULL OR business_id = ?) AND receipt_path IS NOT NULL`,
    [userId, businessId, businessId],
  ).map((r) => r.p);
}
