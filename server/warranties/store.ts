/**
 * Warranties for one user (KAN-61). Every query filters on user_id.
 *
 * - A warranty covers an item from starts_on to ends_on (last day of cover).
 * - It can link the purchase transaction; that transaction's receipt is shown from the
 *   transaction and never copied. The warranty can also keep its own receipt / warranty card.
 */
import type { Database } from 'sql.js';
import type { Warranty, WarrantyListResponse, WarrantyPurchase } from '../../src/types/index.ts';
import { EXPIRING_SOON_DAYS, daysLeft, warrantyStatus } from '../../src/lib/warranty.ts';
import { isYmd } from '../../src/lib/invoiceCalc.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { roundMoney } from '../debts/model.ts';
import { deleteWarrantyReceipt, photoUrlFromPath, saveWarrantyReceipt } from '../lib/uploads.ts';

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export type WarrantyDraft = {
  itemName: string;
  retailer: string;
  priceNzd: number | null;
  startsOn: string;
  endsOn: string;
  transactionId: string | null;
  notes: string;
};

/** Full body for create; `partial` allows any subset for edits. */
export function parseWarranty(raw: unknown, partial: boolean): Parsed<Partial<WarrantyDraft>> {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'Body is required' };
  const out: Partial<WarrantyDraft> = {};
  if (o.itemName !== undefined || !partial) {
    const name = typeof o.itemName === 'string' ? o.itemName.trim().replace(/\s+/g, ' ') : '';
    if (!name) return { ok: false, error: 'Item is required' };
    if (name.length > 80) return { ok: false, error: 'Item must be 80 characters or fewer' };
    out.itemName = name;
  }
  if (o.retailer !== undefined) {
    const r = typeof o.retailer === 'string' ? o.retailer.trim().replace(/\s+/g, ' ') : '';
    if (r.length > 80) return { ok: false, error: 'Store must be 80 characters or fewer' };
    out.retailer = r;
  } else if (!partial) out.retailer = '';
  if (o.priceNzd !== undefined) {
    if (o.priceNzd === null || o.priceNzd === '') out.priceNzd = null;
    else {
      const n = Number(o.priceNzd);
      if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return { ok: false, error: 'Price must be 0 or more' };
      out.priceNzd = roundMoney(n);
    }
  } else if (!partial) out.priceNzd = null;
  if (o.startsOn !== undefined || !partial) {
    if (!isYmd(o.startsOn)) return { ok: false, error: 'Start date must be YYYY-MM-DD' };
    out.startsOn = o.startsOn;
  }
  if (o.endsOn !== undefined || !partial) {
    if (!isYmd(o.endsOn)) return { ok: false, error: 'End date must be YYYY-MM-DD' };
    out.endsOn = o.endsOn;
  }
  if (o.transactionId !== undefined) {
    out.transactionId = typeof o.transactionId === 'string' && o.transactionId.trim() ? o.transactionId.trim() : null;
  } else if (!partial) out.transactionId = null;
  if (o.notes !== undefined) out.notes = typeof o.notes === 'string' ? o.notes.trim().slice(0, 500) : '';
  else if (!partial) out.notes = '';
  return { ok: true, value: out };
}

type Row = {
  id: string;
  item_name: string;
  retailer: string;
  price_nzd: number | null;
  starts_on: string;
  ends_on: string;
  transaction_id: string | null;
  receipt_path: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  t_id: string | null;
  t_date: string | null;
  t_description: string | null;
  t_merchant: string | null;
  t_amount: number | null;
  t_receipt_path: string | null;
};

const SELECT = `SELECT w.*, t.id AS t_id, t.date AS t_date, t.description AS t_description, t.merchant AS t_merchant,
    t.amount AS t_amount, t.receipt_path AS t_receipt_path
  FROM warranties w
  LEFT JOIN transactions t ON t.id = w.transaction_id AND t.user_id = w.user_id`;

function purchaseFrom(r: { id: string; date: string; description: string | null; merchant: string | null; amount: number; receipt_path: string | null }): WarrantyPurchase {
  return {
    id: r.id,
    date: r.date,
    description: (r.merchant || r.description || '').trim(),
    amountNzd: roundMoney(Math.abs(Number(r.amount))),
    receiptUrl: photoUrlFromPath(r.receipt_path?.trim() || null),
  };
}

function present(r: Row, today: string): Warranty {
  return {
    id: r.id,
    itemName: r.item_name,
    retailer: r.retailer ?? '',
    priceNzd: r.price_nzd == null ? null : roundMoney(Number(r.price_nzd)),
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    status: warrantyStatus(r.ends_on, today),
    daysLeft: daysLeft(r.ends_on, today),
    notes: r.notes ?? '',
    transactionId: r.t_id,
    purchase: r.t_id
      ? purchaseFrom({ id: r.t_id, date: r.t_date ?? '', description: r.t_description, merchant: r.t_merchant, amount: Number(r.t_amount ?? 0), receipt_path: r.t_receipt_path })
      : null,
    receiptUrl: photoUrlFromPath(r.receipt_path),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Covered first (soonest ending first), then expired (most recent first). */
function byExpiry(a: Warranty, b: Warranty): number {
  const ax = a.status === 'expired' ? 1 : 0;
  const bx = b.status === 'expired' ? 1 : 0;
  if (ax !== bx) return ax - bx;
  const c = ax ? b.endsOn.localeCompare(a.endsOn) : a.endsOn.localeCompare(b.endsOn);
  return c || a.itemName.localeCompare(b.itemName);
}

export function listWarranties(db: Database, userId: string, today: string): WarrantyListResponse {
  const items = queryAll<Row>(db, `${SELECT} WHERE w.user_id = ?`, [userId])
    .map((r) => present(r, today))
    .sort(byExpiry);
  return {
    today,
    items,
    expiringSoonDays: EXPIRING_SOON_DAYS,
    totals: {
      active: items.filter((i) => i.status === 'active').length,
      expiring: items.filter((i) => i.status === 'expiring').length,
      expired: items.filter((i) => i.status === 'expired').length,
    },
  };
}

export function getWarranty(db: Database, userId: string, id: string, today: string): Warranty | null {
  const r = queryOne<Row>(db, `${SELECT} WHERE w.id = ? AND w.user_id = ?`, [id, userId]);
  return r ? present(r, today) : null;
}

function ownsTransaction(db: Database, userId: string, id: string): boolean {
  return !!queryOne(db, `SELECT id FROM transactions WHERE id = ? AND user_id = ?`, [id, userId]);
}

function checkDraft(db: Database, userId: string, d: WarrantyDraft): string | null {
  if (d.endsOn < d.startsOn) return 'End date must be on or after the start date';
  if (d.transactionId && !ownsTransaction(db, userId, d.transactionId)) return 'Purchase must be one of your transactions';
  return null;
}

export function createWarranty(db: Database, userId: string, d: WarrantyDraft, today: string): Parsed<Warranty> {
  const err = checkDraft(db, userId, d);
  if (err) return { ok: false, error: err };
  const id = newId('war');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO warranties (id, user_id, item_name, retailer, price_nzd, starts_on, ends_on, transaction_id, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, d.itemName, d.retailer, d.priceNzd, d.startsOn, d.endsOn, d.transactionId, d.notes, now, now],
  );
  return { ok: true, value: getWarranty(db, userId, id, today)! };
}

type StoredRow = { item_name: string; retailer: string; price_nzd: number | null; starts_on: string; ends_on: string; transaction_id: string | null; notes: string };

/** null = not found. */
export function updateWarranty(db: Database, userId: string, id: string, patch: Partial<WarrantyDraft>, today: string): Parsed<Warranty> | null {
  const r = queryOne<StoredRow>(db, `SELECT * FROM warranties WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!r) return null;
  const next: WarrantyDraft = {
    itemName: patch.itemName ?? r.item_name,
    retailer: patch.retailer ?? r.retailer,
    priceNzd: patch.priceNzd !== undefined ? patch.priceNzd : r.price_nzd,
    startsOn: patch.startsOn ?? r.starts_on,
    endsOn: patch.endsOn ?? r.ends_on,
    transactionId: patch.transactionId !== undefined ? patch.transactionId : r.transaction_id,
    notes: patch.notes ?? r.notes,
  };
  // An existing link to a since-deleted transaction is left alone unless it is changed.
  const err = checkDraft(db, userId, patch.transactionId !== undefined ? next : { ...next, transactionId: null });
  if (err) return { ok: false, error: err };
  run(
    db,
    `UPDATE warranties SET item_name=?, retailer=?, price_nzd=?, starts_on=?, ends_on=?, transaction_id=?, notes=?, updated_at=?
     WHERE id=? AND user_id=?`,
    [next.itemName, next.retailer, next.priceNzd, next.startsOn, next.endsOn, next.transactionId, next.notes, new Date().toISOString(), id, userId],
  );
  return { ok: true, value: getWarranty(db, userId, id, today)! };
}

export function deleteWarranty(db: Database, userId: string, id: string): boolean {
  const r = queryOne<{ receipt_path: string | null }>(db, `SELECT receipt_path FROM warranties WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!r) return false;
  deleteWarrantyReceipt(r.receipt_path);
  run(db, `DELETE FROM warranties WHERE id = ? AND user_id = ?`, [id, userId]);
  return true;
}

/** Save or replace the warranty's own receipt. null = not found; throws on a bad file. */
export function setWarrantyReceipt(db: Database, userId: string, id: string, dataUrlOrBase64: string, today: string): Warranty | null {
  const r = queryOne<{ receipt_path: string | null }>(db, `SELECT receipt_path FROM warranties WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!r) return null;
  const rel = saveWarrantyReceipt(id, dataUrlOrBase64);
  if (r.receipt_path && r.receipt_path !== rel) deleteWarrantyReceipt(r.receipt_path);
  run(db, `UPDATE warranties SET receipt_path=?, updated_at=? WHERE id=? AND user_id=?`, [rel, new Date().toISOString(), id, userId]);
  return getWarranty(db, userId, id, today);
}

export function clearWarrantyReceipt(db: Database, userId: string, id: string, today: string): Warranty | null {
  const r = queryOne<{ receipt_path: string | null }>(db, `SELECT receipt_path FROM warranties WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!r) return null;
  deleteWarrantyReceipt(r.receipt_path);
  run(db, `UPDATE warranties SET receipt_path=NULL, updated_at=? WHERE id=? AND user_id=?`, [new Date().toISOString(), id, userId]);
  return getWarranty(db, userId, id, today);
}

/**
 * The user's purchases (money out) to link a warranty to, newest first.
 * `q` matches the description or merchant; empty = latest purchases.
 */
export function searchPurchases(db: Database, userId: string, q: string, limit = 25): WarrantyPurchase[] {
  const term = q.trim().slice(0, 80).toLowerCase();
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return queryAll<{ id: string; date: string; description: string | null; merchant: string | null; amount: number; receipt_path: string | null }>(
    db,
    `SELECT id, date, description, merchant, amount, receipt_path FROM transactions
     WHERE user_id = ? AND amount < 0
       AND (? = '' OR lower(coalesce(description, '')) LIKE ? ESCAPE '\\' OR lower(coalesce(merchant, '')) LIKE ? ESCAPE '\\')
     ORDER BY date DESC, created_at DESC
     LIMIT ?`,
    [userId, term, like, like, Math.max(1, Math.min(limit, 50))],
  ).map(purchaseFrom);
}
