/**
 * Rental properties and their income / expenses for one user (KAN-66). Every query
 * filters on user_id.
 *
 * Money views: an entry with add_to_money, dated on or after the day Budget and Income
 * start (TXN_SYNC_FROM_DATE), is mirrored so those pages count the net rental figures:
 *   - income  → an income_records row (rental_entry_id) in "Rental income", linked to
 *               the matching bank deposit when there is one so it isn't counted twice
 *   - expense → a manual spending transaction (transaction_id) in "Rental property"
 * Editing an entry updates its mirror; deleting the entry or its property removes it.
 */
import type { Database } from 'sql.js';
import type { RentalEntry, RentalListResponse, RentalProperty } from '../../src/types/index.ts';
import { isRentalCategory, rentalCategoryLabel, type RentalCategory, type RentalEntryKind } from '../../src/lib/rental.ts';
import { isYmd } from '../../src/lib/invoiceCalc.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { roundMoney } from '../debts/model.ts';
import { RENTAL_EXPENSES_SLUG, RENTAL_INCOME_SLUG, ensureCategory } from '../lib/categories.ts';
import { linkMirroredIncomeToBankCredits } from '../lib/incomeBankLink.ts';
import { TXN_SYNC_FROM_DATE } from '../akahu/syncTransactions.ts';

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export type PropertyDraft = { name: string; address: string; notes: string };

export type EntryDraft = {
  propertyId: string;
  date: string;
  kind: RentalEntryKind;
  category: RentalCategory;
  amountNzd: number;
  description: string;
  addToMoney: boolean;
};

function body(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
}

export function parseProperty(raw: unknown, partial: boolean): Parsed<Partial<PropertyDraft>> {
  const o = body(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  const out: Partial<PropertyDraft> = {};
  if (o.name !== undefined || !partial) {
    const name = text(o.name);
    if (!name) return { ok: false, error: 'Property name is required' };
    if (name.length > 80) return { ok: false, error: 'Property name must be 80 characters or fewer' };
    out.name = name;
  }
  if (o.address !== undefined || !partial) {
    const address = text(o.address);
    if (address.length > 200) return { ok: false, error: 'Address must be 200 characters or fewer' };
    out.address = address;
  }
  if (o.notes !== undefined || !partial) out.notes = typeof o.notes === 'string' ? o.notes.trim().slice(0, 500) : '';
  return { ok: true, value: out };
}

/** Field checks only; the kind / category pairing and property ownership are checked on save. */
export function parseEntry(raw: unknown, partial: boolean): Parsed<Partial<EntryDraft>> {
  const o = body(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  const out: Partial<EntryDraft> = {};
  if (o.propertyId !== undefined || !partial) {
    const id = text(o.propertyId);
    if (!id) return { ok: false, error: 'Property is required' };
    out.propertyId = id;
  }
  if (o.kind !== undefined || !partial) {
    if (o.kind !== 'income' && o.kind !== 'expense') return { ok: false, error: 'Kind must be income or expense' };
    out.kind = o.kind;
  }
  if (o.category !== undefined || !partial) {
    if (typeof o.category !== 'string' || !o.category) return { ok: false, error: 'Category is required' };
    out.category = o.category as RentalCategory;
  }
  if (o.date !== undefined || !partial) {
    if (!isYmd(o.date)) return { ok: false, error: 'Date must be YYYY-MM-DD' };
    out.date = o.date;
  }
  if (o.amountNzd !== undefined || !partial) {
    const n = Number(o.amountNzd);
    if (o.amountNzd === null || o.amountNzd === '' || !Number.isFinite(n) || n <= 0 || n > 10_000_000) {
      return { ok: false, error: 'Amount must be more than 0' };
    }
    out.amountNzd = roundMoney(n);
  }
  if (o.description !== undefined || !partial) {
    const d = text(o.description);
    if (d.length > 120) return { ok: false, error: 'Description must be 120 characters or fewer' };
    out.description = d;
  }
  if (o.addToMoney !== undefined) out.addToMoney = o.addToMoney !== false;
  else if (!partial) out.addToMoney = true;
  return { ok: true, value: out };
}

type PropertyRow = { id: string; name: string; address: string; notes: string; created_at: string; updated_at: string };

type EntryRow = {
  id: string;
  property_id: string;
  date: string;
  kind: RentalEntryKind;
  category: RentalCategory;
  amount_nzd: number;
  description: string;
  add_to_money: number;
  transaction_id: string | null;
  created_at: string;
  updated_at: string;
  income_mirror: string | null;
  txn_mirror: string | null;
};

const ENTRY_SELECT = `SELECT e.*,
    (SELECT r.id FROM income_records r WHERE r.user_id = e.user_id AND r.rental_entry_id = e.id LIMIT 1) AS income_mirror,
    t.id AS txn_mirror
  FROM rental_entries e
  LEFT JOIN transactions t ON t.id = e.transaction_id AND t.user_id = e.user_id`;

function presentProperty(r: PropertyRow): RentalProperty {
  return { id: r.id, name: r.name, address: r.address ?? '', notes: r.notes ?? '', createdAt: r.created_at, updatedAt: r.updated_at };
}

function presentEntry(r: EntryRow): RentalEntry {
  return {
    id: r.id,
    propertyId: r.property_id,
    date: r.date,
    kind: r.kind,
    category: r.category,
    amountNzd: roundMoney(Number(r.amount_nzd)),
    description: r.description ?? '',
    addToMoney: Boolean(r.add_to_money),
    inMoneyViews: Boolean(r.kind === 'income' ? r.income_mirror : r.txn_mirror),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listRentals(db: Database, userId: string, today: string): RentalListResponse {
  const properties = queryAll<PropertyRow>(
    db,
    `SELECT * FROM rental_properties WHERE user_id = ? ORDER BY lower(name), created_at`,
    [userId],
  ).map(presentProperty);
  const entries = queryAll<EntryRow>(
    db,
    `${ENTRY_SELECT} WHERE e.user_id = ? ORDER BY e.date DESC, e.created_at DESC`,
    [userId],
  ).map(presentEntry);
  return { today, moneyViewsFrom: TXN_SYNC_FROM_DATE, properties, entries };
}

function propertyRow(db: Database, userId: string, id: string): PropertyRow | null {
  return queryOne<PropertyRow>(db, `SELECT * FROM rental_properties WHERE id = ? AND user_id = ?`, [id, userId]) ?? null;
}

export function getEntry(db: Database, userId: string, id: string): RentalEntry | null {
  const r = queryOne<EntryRow>(db, `${ENTRY_SELECT} WHERE e.id = ? AND e.user_id = ?`, [id, userId]);
  return r ? presentEntry(r) : null;
}

// ---------------------------------------------------------------- properties

export function createProperty(db: Database, userId: string, d: PropertyDraft): RentalProperty {
  const id = newId('rprop');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO rental_properties (id, user_id, name, address, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    [id, userId, d.name, d.address, d.notes, now, now],
  );
  return presentProperty(propertyRow(db, userId, id)!);
}

/** null = not found. */
export function updateProperty(db: Database, userId: string, id: string, patch: Partial<PropertyDraft>): RentalProperty | null {
  const r = propertyRow(db, userId, id);
  if (!r) return null;
  const name = patch.name ?? r.name;
  run(
    db,
    `UPDATE rental_properties SET name=?, address=?, notes=?, updated_at=? WHERE id=? AND user_id=?`,
    [name, patch.address ?? r.address, patch.notes ?? r.notes, new Date().toISOString(), id, userId],
  );
  // Mirrored rows carry the property name in their description.
  if (name !== r.name) {
    for (const e of queryAll<{ id: string }>(db, `SELECT id FROM rental_entries WHERE property_id = ? AND user_id = ?`, [id, userId])) {
      syncMirror(db, userId, e.id);
    }
  }
  return presentProperty(propertyRow(db, userId, id)!);
}

/** Deletes the property, its entries and their Budget / Income rows. */
export function deleteProperty(db: Database, userId: string, id: string): boolean {
  if (!propertyRow(db, userId, id)) return false;
  for (const e of queryAll<{ id: string }>(db, `SELECT id FROM rental_entries WHERE property_id = ? AND user_id = ?`, [id, userId])) {
    deleteEntry(db, userId, e.id);
  }
  run(db, `DELETE FROM rental_properties WHERE id = ? AND user_id = ?`, [id, userId]);
  return true;
}

// ---------------------------------------------------------------- entries

function checkEntry(db: Database, userId: string, d: EntryDraft): string | null {
  if (!propertyRow(db, userId, d.propertyId)) return 'Property not found';
  if (!isRentalCategory(d.kind, d.category)) return `That category isn't used for ${d.kind === 'income' ? 'income' : 'expenses'}`;
  return null;
}

export function createEntry(db: Database, userId: string, d: EntryDraft): Parsed<RentalEntry> {
  const err = checkEntry(db, userId, d);
  if (err) return { ok: false, error: err };
  const id = newId('rent');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO rental_entries (id, user_id, property_id, date, kind, category, amount_nzd, description, add_to_money, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, d.propertyId, d.date, d.kind, d.category, d.amountNzd, d.description, d.addToMoney ? 1 : 0, now, now],
  );
  syncMirror(db, userId, id);
  return { ok: true, value: getEntry(db, userId, id)! };
}

/** null = not found. */
export function updateEntry(db: Database, userId: string, id: string, patch: Partial<EntryDraft>): Parsed<RentalEntry> | null {
  const r = queryOne<EntryRow>(db, `SELECT * FROM rental_entries WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!r) return null;
  const kind = patch.kind ?? r.kind;
  const next: EntryDraft = {
    propertyId: patch.propertyId ?? r.property_id,
    date: patch.date ?? r.date,
    kind,
    // Switching kind without a category falls back to that kind's first category.
    category: patch.category ?? (kind === r.kind ? r.category : (kind === 'income' ? 'rent' : 'other_expense')),
    amountNzd: patch.amountNzd ?? Number(r.amount_nzd),
    description: patch.description ?? r.description,
    addToMoney: patch.addToMoney ?? Boolean(r.add_to_money),
  };
  const err = checkEntry(db, userId, next);
  if (err) return { ok: false, error: err };
  run(
    db,
    `UPDATE rental_entries SET property_id=?, date=?, kind=?, category=?, amount_nzd=?, description=?, add_to_money=?, updated_at=?
     WHERE id=? AND user_id=?`,
    [next.propertyId, next.date, next.kind, next.category, next.amountNzd, next.description, next.addToMoney ? 1 : 0, new Date().toISOString(), id, userId],
  );
  syncMirror(db, userId, id);
  return { ok: true, value: getEntry(db, userId, id)! };
}

export function deleteEntry(db: Database, userId: string, id: string): boolean {
  const r = queryOne<{ transaction_id: string | null }>(db, `SELECT transaction_id FROM rental_entries WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!r) return false;
  removeIncomeMirror(db, userId, id);
  removeTxnMirror(db, userId, r.transaction_id);
  run(db, `DELETE FROM rental_entries WHERE id = ? AND user_id = ?`, [id, userId]);
  return true;
}

// ---------------------------------------------------------------- Budget / Income mirror

function removeIncomeMirror(db: Database, userId: string, entryId: string): void {
  run(db, `DELETE FROM income_records WHERE user_id = ? AND rental_entry_id = ?`, [userId, entryId]);
}

function removeTxnMirror(db: Database, userId: string, txnId: string | null): void {
  if (txnId) run(db, `DELETE FROM transactions WHERE id = ? AND user_id = ?`, [txnId, userId]);
}

function mirrorDescription(e: { kind: RentalEntryKind; category: string; description: string }, propertyName: string): string {
  const what = e.description || rentalCategoryLabel(e.category);
  return `${what} · ${propertyName}`.slice(0, 200);
}

/** Make the entry's Budget / Income row match the entry (add, update or remove it). */
export function syncMirror(db: Database, userId: string, entryId: string): void {
  const e = queryOne<EntryRow & { property_name: string }>(
    db,
    `SELECT e.*, p.name AS property_name FROM rental_entries e
     JOIN rental_properties p ON p.id = e.property_id AND p.user_id = e.user_id
     WHERE e.id = ? AND e.user_id = ?`,
    [entryId, userId],
  );
  if (!e) return;
  const wanted = Boolean(e.add_to_money) && e.date >= TXN_SYNC_FROM_DATE;
  const description = mirrorDescription(e, e.property_name);
  const amount = roundMoney(Number(e.amount_nzd));
  const now = new Date().toISOString();

  // Only one side is ever mirrored; drop the other (kind may have changed).
  if (!wanted || e.kind !== 'income') removeIncomeMirror(db, userId, e.id);
  if (!wanted || e.kind !== 'expense') {
    removeTxnMirror(db, userId, e.transaction_id);
    if (e.transaction_id) run(db, `UPDATE rental_entries SET transaction_id = NULL WHERE id = ? AND user_id = ?`, [e.id, userId]);
  }
  if (!wanted) return;

  if (e.kind === 'income') {
    const inc = queryOne<{ id: string; date: string; amount_nzd: number }>(
      db,
      `SELECT id, date, amount_nzd FROM income_records WHERE user_id = ? AND rental_entry_id = ?`,
      [userId, e.id],
    );
    if (inc) {
      // A new date or amount may no longer match the deposit it was linked to.
      const moved = inc.date !== e.date || Math.abs(Number(inc.amount_nzd) - amount) >= 0.005;
      run(
        db,
        `UPDATE income_records SET date=?, amount_nzd=?, description=?${moved ? ', transaction_id=NULL' : ''} WHERE id=? AND user_id=?`,
        [e.date, amount, description, inc.id, userId],
      );
    } else {
      const categoryId = ensureCategory(db, userId, { slug: RENTAL_INCOME_SLUG, name: 'Rental income', type: 'income', sortOrder: 5 });
      run(
        db,
        `INSERT INTO income_records (id, user_id, date, amount_nzd, kind, description, category_id, notes, created_at, rental_entry_id)
         VALUES (?,?,?,?, 'cash', ?, ?, ?, ?, ?)`,
        [newId('inc'), userId, e.date, amount, description, categoryId, 'Recorded on Rentals.', now, e.id],
      );
    }
    linkMirroredIncomeToBankCredits(db, userId);
    return;
  }

  const txn = e.transaction_id
    ? queryOne<{ id: string }>(db, `SELECT id FROM transactions WHERE id = ? AND user_id = ?`, [e.transaction_id, userId])
    : null;
  if (txn) {
    run(db, `UPDATE transactions SET date=?, amount=?, description=?, merchant=? WHERE id=? AND user_id=?`, [
      e.date, -amount, description, e.property_name, txn.id, userId,
    ]);
    return;
  }
  const categoryId = ensureCategory(db, userId, { slug: RENTAL_EXPENSES_SLUG, name: 'Rental property', type: 'spending', sortOrder: 88 });
  const txnId = newId('txn');
  run(
    db,
    `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, category_id, currency, created_at, card_name, merchant, source)
     VALUES (?,?,NULL,?,?,?, 'debit', ?, 'NZD', ?, 'Rental', ?, 'manual')`,
    [txnId, userId, e.date, description, -amount, categoryId, now, e.property_name],
  );
  run(db, `UPDATE rental_entries SET transaction_id = ? WHERE id = ? AND user_id = ?`, [txnId, e.id, userId]);
}
