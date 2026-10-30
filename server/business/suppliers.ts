/**
 * Suppliers and their bills for one of the user's businesses (KAN-107). A bill can carry an
 * uploaded PDF or photo and covers stock batches of the same business; capitalised freight on
 * a linked bill reaches average cost through server/business/stock.ts. Paid, unpaid and overdue
 * are derived. A bill is an expense on the date it's paid (payments basis, KAN-121): businessMoney
 * counts paidBills, and a bank payment linked to a bill isn't counted again.
 *
 * Every query filters on user_id and business_id; another user's or business's id behaves like
 * a missing row. A supplier with bills can't be deleted (409): the bills would lose who sent them.
 */
import type { Database } from 'sql.js';
import { isYmd } from '../../src/lib/invoiceCalc.ts';
import { roundMoney } from '../../src/lib/debtModel.ts';
import { billStatus, isBillKind, isDeliveryTreatment, type BillKind, type DeliveryTreatment, type Supplier, type SupplierBill } from '../../src/lib/suppliers.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { deleteSupplierInvoiceFile, photoUrlFromPath, saveSupplierInvoiceFile } from '../lib/uploads.ts';
import { businessRow } from './profile.ts';

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

const MAX_MONEY = 100_000_000;

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
function optionalMoney(raw: unknown, label: string): Parsed<number | null> {
  if (raw == null || raw === '') return { ok: true, value: null };
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number` };
  if (n < 0) return { ok: false, error: `${label} can't be negative` };
  if (n > MAX_MONEY) return { ok: false, error: `${label} is too large` };
  return { ok: true, value: roundMoney(n) };
}

function date(raw: unknown, label: string): Parsed<string | null> {
  if (raw == null || raw === '') return { ok: true, value: null };
  return isYmd(raw) ? { ok: true, value: raw } : { ok: false, error: `${label} must be YYYY-MM-DD` };
}

export type SupplierDraft = Pick<Supplier, 'name' | 'contactPerson' | 'email' | 'phone' | 'address' | 'nzbn' | 'gstNumber' | 'notes'>;

export function parseSupplier(raw: unknown): Parsed<SupplierDraft> {
  const o = obj(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  const name = text(o, 'name', 120);
  if (!name) return { ok: false, error: 'Name is required' };
  const nzbn = text(o, 'nzbn', 20).replace(/\s/g, '');
  if (nzbn && !/^\d{13}$/.test(nzbn)) return { ok: false, error: 'NZBN must be 13 digits' };
  const gstNumber = text(o, 'gstNumber', 20);
  if (gstNumber && !/^\d{2,3}-?\d{3}-?\d{3}$/.test(gstNumber)) return { ok: false, error: 'GST number must be 8 or 9 digits' };
  return {
    ok: true,
    value: {
      name,
      contactPerson: text(o, 'contactPerson', 120),
      email: text(o, 'email', 200),
      phone: text(o, 'phone', 40),
      address: longText(o, 'address', 300),
      nzbn,
      gstNumber,
      notes: longText(o, 'notes', 1000),
    },
  };
}

export type BillDraft = {
  supplierId: string;
  kind: BillKind;
  reference: string;
  invoiceDate: string;
  dueDate: string;
  amountNzd: number;
  deliveryNzd: number;
  deliveryTreatment: DeliveryTreatment;
  paidOn: string | null;
  transactionId: string | null;
  notes: string;
};

export function parseBill(raw: unknown): Parsed<BillDraft> {
  const o = obj(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  const supplierId = typeof o.supplierId === 'string' ? o.supplierId : '';
  if (!supplierId) return { ok: false, error: 'Supplier is required' };
  const kind = o.kind == null || o.kind === '' ? 'stock' : o.kind;
  if (!isBillKind(kind)) return { ok: false, error: 'Kind must be stock or delivery' };
  const invoiceDate = date(o.invoiceDate, 'Invoice date');
  if (!invoiceDate.ok) return invoiceDate;
  if (!invoiceDate.value) return { ok: false, error: 'Invoice date is required' };
  const dueDate = date(o.dueDate, 'Due date');
  if (!dueDate.ok) return dueDate;
  if (!dueDate.value) return { ok: false, error: 'Due date is required' };
  if (dueDate.value < invoiceDate.value) return { ok: false, error: 'Due date can’t be before the invoice date' };
  const amount = optionalMoney(o.amountNzd, 'Amount');
  if (!amount.ok) return amount;
  // Required, never defaulted: the amount comes from the bill.
  if (amount.value == null) return { ok: false, error: 'Amount is required' };
  const freight = optionalMoney(o.deliveryNzd, 'Delivery');
  if (!freight.ok) return freight;
  const deliveryNzd = kind === 'delivery' ? amount.value : (freight.value ?? 0);
  if (deliveryNzd > amount.value) return { ok: false, error: 'Delivery can’t be more than the bill’s amount' };
  const treatment = o.deliveryTreatment == null || o.deliveryTreatment === '' ? 'capitalise' : o.deliveryTreatment;
  if (!isDeliveryTreatment(treatment)) return { ok: false, error: 'Delivery treatment must be capitalise or expense' };
  const paidOn = date(o.paidOn, 'Paid date');
  if (!paidOn.ok) return paidOn;
  const transactionId = typeof o.transactionId === 'string' && o.transactionId ? o.transactionId : null;
  if (transactionId && !paidOn.value) return { ok: false, error: 'Add the paid date to link the bank payment' };
  return {
    ok: true,
    value: {
      supplierId,
      kind,
      reference: text(o, 'reference', 60),
      invoiceDate: invoiceDate.value,
      dueDate: dueDate.value,
      amountNzd: amount.value,
      deliveryNzd,
      deliveryTreatment: treatment,
      paidOn: paidOn.value,
      transactionId,
      notes: longText(o, 'notes', 1000),
    },
  };
}

// ---------------------------------------------------------------- rows

type SupplierRow = {
  id: string;
  business_id: string;
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  nzbn: string;
  gst_number: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

type BillRow = {
  id: string;
  business_id: string;
  supplier_id: string;
  kind: string;
  reference: string;
  invoice_date: string;
  due_date: string;
  amount_nzd: number;
  delivery_nzd: number;
  delivery_treatment: string;
  paid_on: string | null;
  transaction_id: string | null;
  file_path: string | null;
  file_name: string;
  file_at: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
};

function supplierRow(db: Database, userId: string, id: string): SupplierRow | null {
  return queryOne<SupplierRow>(db, `SELECT * FROM business_suppliers WHERE id = ? AND user_id = ?`, [id, userId]);
}

function billRow(db: Database, userId: string, id: string): BillRow | null {
  return queryOne<BillRow>(db, `SELECT * FROM business_supplier_invoices WHERE id = ? AND user_id = ?`, [id, userId]);
}

/** One business's bills, newest first, with supplier names and batch links in three queries. */
function loadBills(db: Database, userId: string, businessId: string, today: string, supplierId: string | null = null): SupplierBill[] {
  const scope = [userId, businessId];
  const rows = queryAll<BillRow>(
    db,
    `SELECT * FROM business_supplier_invoices WHERE user_id = ? AND business_id = ? AND (? IS NULL OR supplier_id = ?)
     ORDER BY invoice_date DESC, created_at DESC, id`,
    [...scope, supplierId, supplierId],
  );
  if (!rows.length) return [];
  const names = new Map(
    queryAll<{ id: string; name: string }>(db, `SELECT id, name FROM business_suppliers WHERE user_id = ? AND business_id = ?`, scope).map((r) => [r.id, r.name]),
  );
  const batches = new Map<string, string[]>();
  for (const l of queryAll<{ invoice_id: string; batch_id: string }>(
    db,
    `SELECT invoice_id, batch_id FROM business_supplier_invoice_batches WHERE user_id = ? AND business_id = ? ORDER BY batch_id`,
    scope,
  )) {
    batches.set(l.invoice_id, [...(batches.get(l.invoice_id) ?? []), l.batch_id]);
  }
  return rows.map((r) => ({
    id: r.id,
    businessId: r.business_id,
    supplierId: r.supplier_id,
    supplierName: names.get(r.supplier_id) ?? '',
    kind: r.kind === 'delivery' ? 'delivery' : 'stock',
    reference: r.reference ?? '',
    invoiceDate: r.invoice_date,
    dueDate: r.due_date,
    amountNzd: Number(r.amount_nzd),
    deliveryNzd: Number(r.delivery_nzd),
    deliveryTreatment: r.delivery_treatment === 'expense' ? 'expense' : 'capitalise',
    paidOn: r.paid_on,
    transactionId: r.transaction_id,
    status: billStatus(r.paid_on, r.due_date, today),
    notes: r.notes ?? '',
    file: r.file_path ? { url: photoUrlFromPath(r.file_path)!, name: r.file_name || 'Bill', uploadedAt: r.file_at } : null,
    batchIds: batches.get(r.id) ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

function billView(db: Database, userId: string, r: Pick<BillRow, 'id' | 'business_id'>, today: string): SupplierBill {
  return loadBills(db, userId, r.business_id, today).find((b) => b.id === r.id)!;
}

function presentSupplier(r: SupplierRow, bills: SupplierBill[]): Supplier {
  const own = bills.filter((b) => b.supplierId === r.id);
  return {
    id: r.id,
    businessId: r.business_id,
    name: r.name,
    contactPerson: r.contact_person ?? '',
    email: r.email ?? '',
    phone: r.phone ?? '',
    address: r.address ?? '',
    nzbn: r.nzbn ?? '',
    gstNumber: r.gst_number ?? '',
    notes: r.notes ?? '',
    billCount: own.length,
    unpaidNzd: roundMoney(own.filter((b) => b.status !== 'paid').reduce((s, b) => s + b.amountNzd, 0)),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function supplierView(db: Database, userId: string, r: SupplierRow, today: string): Supplier {
  return presentSupplier(r, loadBills(db, userId, r.business_id, today, r.id));
}

// ---------------------------------------------------------------- suppliers

export function listSuppliers(db: Database, userId: string, businessId: string, today: string): Result<Supplier[]> {
  if (!businessRow(db, userId, businessId)) return fail(404, 'Business not found');
  const bills = loadBills(db, userId, businessId, today);
  const rows = queryAll<SupplierRow>(
    db,
    `SELECT * FROM business_suppliers WHERE user_id = ? AND business_id = ? ORDER BY lower(name), created_at, id`,
    [userId, businessId],
  );
  return { ok: true, value: rows.map((r) => presentSupplier(r, bills)) };
}

export function createSupplier(db: Database, userId: string, businessId: string, d: SupplierDraft, today: string): Result<Supplier> {
  if (!businessRow(db, userId, businessId)) return fail(404, 'Business not found');
  const id = newId('supplier');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO business_suppliers (id, user_id, business_id, name, contact_person, email, phone, address, nzbn, gst_number, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, businessId, d.name, d.contactPerson, d.email, d.phone, d.address, d.nzbn, d.gstNumber, d.notes, now, now],
  );
  return { ok: true, value: supplierView(db, userId, supplierRow(db, userId, id)!, today) };
}

export function updateSupplier(db: Database, userId: string, id: string, d: SupplierDraft, today: string): Result<Supplier> {
  const r = supplierRow(db, userId, id);
  if (!r) return fail(404, 'Supplier not found');
  run(
    db,
    `UPDATE business_suppliers SET name=?, contact_person=?, email=?, phone=?, address=?, nzbn=?, gst_number=?, notes=?, updated_at=?
     WHERE id=? AND user_id=? AND business_id=?`,
    [d.name, d.contactPerson, d.email, d.phone, d.address, d.nzbn, d.gstNumber, d.notes, new Date().toISOString(), id, userId, r.business_id],
  );
  return { ok: true, value: supplierView(db, userId, supplierRow(db, userId, id)!, today) };
}

export function deleteSupplier(db: Database, userId: string, id: string): Result<{ id: string }> {
  const r = supplierRow(db, userId, id);
  if (!r) return fail(404, 'Supplier not found');
  const bills = Number(
    queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM business_supplier_invoices WHERE user_id = ? AND business_id = ? AND supplier_id = ?`, [
      userId, r.business_id, id,
    ])?.c ?? 0,
  );
  if (bills > 0) return fail(409, `${r.name} has ${bills} bill${bills === 1 ? '' : 's'}. Delete ${bills === 1 ? 'it' : 'them'} first.`);
  run(db, `DELETE FROM business_suppliers WHERE id = ? AND user_id = ? AND business_id = ?`, [id, userId, r.business_id]);
  return { ok: true, value: { id } };
}

// ---------------------------------------------------------------- bills

export function listBills(db: Database, userId: string, businessId: string, today: string, supplierId: string | null): Result<SupplierBill[]> {
  if (!businessRow(db, userId, businessId)) return fail(404, 'Business not found');
  return { ok: true, value: loadBills(db, userId, businessId, today, supplierId) };
}

/** The draft's supplier and bank payment must be the user's, the supplier in this business. */
function checkRefs(db: Database, userId: string, businessId: string, d: BillDraft, exceptId: string | null = null): Result<true> {
  const s = supplierRow(db, userId, d.supplierId);
  if (!s || s.business_id !== businessId) return fail(404, 'Supplier not found');
  if (d.transactionId) {
    const t = queryOne<{ amount: number; kind: string }>(db, `SELECT amount, kind FROM transactions WHERE id = ? AND user_id = ?`, [d.transactionId, userId]);
    if (!t) return fail(404, 'Bank transaction not found');
    if (!(Number(t.amount) < 0) || t.kind === 'transfer') return fail(400, 'Link a payment (money out), not a deposit or transfer');
    // One payment pays one bill or wage, so it's counted once (KAN-121).
    const other =
      queryOne(db, `SELECT id FROM business_supplier_invoices WHERE user_id = ? AND transaction_id = ? AND id IS NOT ?`, [userId, d.transactionId, exceptId]) ??
      queryOne(db, `SELECT id FROM business_wage_payments WHERE user_id = ? AND transaction_id = ?`, [userId, d.transactionId]);
    if (other) return fail(409, 'That payment is already linked to another bill or a wage');
  }
  return { ok: true, value: true };
}

/** Bills of the business paid in [start, end], for businessMoney and budget actuals (KAN-121). */
export function paidBills(
  db: Database,
  userId: string,
  businessId: string,
  start: string,
  end: string,
): { id: string; date: string; description: string; kind: BillKind; amountNzd: number; deliveryNzd: number; supplierHasGst: boolean }[] {
  return queryAll<{ id: string; paid_on: string; kind: string; reference: string; amount_nzd: number; delivery_nzd: number; supplier: string | null; gst: string | null }>(
    db,
    `SELECT b.id, b.paid_on, b.kind, b.reference, b.amount_nzd, b.delivery_nzd, s.name AS supplier, s.gst_number AS gst
     FROM business_supplier_invoices b LEFT JOIN business_suppliers s ON s.id = b.supplier_id AND s.user_id = b.user_id
     WHERE b.user_id = ? AND b.business_id = ? AND b.paid_on IS NOT NULL AND b.paid_on >= ? AND b.paid_on <= ? ORDER BY b.paid_on, b.id`,
    [userId, businessId, start, end],
  ).map((r) => ({
    id: r.id,
    date: r.paid_on,
    description: [r.kind === 'delivery' ? 'Delivery bill' : 'Bill', r.reference, r.supplier].filter(Boolean).join(' · '),
    kind: r.kind === 'delivery' ? 'delivery' : 'stock',
    amountNzd: roundMoney(Number(r.amount_nzd)),
    deliveryNzd: roundMoney(Number(r.delivery_nzd)),
    supplierHasGst: Boolean(r.gst?.trim()),
  }));
}

/** Bank payments linked to this business's paid bills (any date), so they count once. */
export function billLinkedPayments(db: Database, userId: string, businessId: string): Set<string> {
  return new Set(
    queryAll<{ t: string }>(db, `SELECT transaction_id AS t FROM business_supplier_invoices WHERE user_id = ? AND business_id = ? AND transaction_id IS NOT NULL`, [userId, businessId]).map(
      (r) => r.t,
    ),
  );
}

export function createBill(db: Database, userId: string, businessId: string, d: BillDraft, today: string): Result<SupplierBill> {
  if (!businessRow(db, userId, businessId)) return fail(404, 'Business not found');
  const refs = checkRefs(db, userId, businessId, d);
  if (!refs.ok) return refs;
  const id = newId('bill');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO business_supplier_invoices (id, user_id, business_id, supplier_id, kind, reference, invoice_date, due_date, amount_nzd,
       delivery_nzd, delivery_treatment, paid_on, transaction_id, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, userId, businessId, d.supplierId, d.kind, d.reference, d.invoiceDate, d.dueDate, d.amountNzd,
      d.deliveryNzd, d.deliveryTreatment, d.paidOn, d.transactionId, d.notes, now, now,
    ],
  );
  return { ok: true, value: billView(db, userId, { id, business_id: businessId }, today) };
}

export function updateBill(db: Database, userId: string, id: string, d: BillDraft, today: string): Result<SupplierBill> {
  const r = billRow(db, userId, id);
  if (!r) return fail(404, 'Bill not found');
  const refs = checkRefs(db, userId, r.business_id, d, id);
  if (!refs.ok) return refs;
  run(
    db,
    `UPDATE business_supplier_invoices SET supplier_id=?, kind=?, reference=?, invoice_date=?, due_date=?, amount_nzd=?, delivery_nzd=?,
       delivery_treatment=?, paid_on=?, transaction_id=?, notes=?, updated_at=?
     WHERE id=? AND user_id=? AND business_id=?`,
    [
      d.supplierId, d.kind, d.reference, d.invoiceDate, d.dueDate, d.amountNzd, d.deliveryNzd,
      d.deliveryTreatment, d.paidOn, d.transactionId, d.notes, new Date().toISOString(), id, userId, r.business_id,
    ],
  );
  return { ok: true, value: billView(db, userId, r, today) };
}

/** Deletes the bill, its file and its batch links; the batches stay. */
export function deleteBill(db: Database, userId: string, id: string): Result<{ id: string }> {
  const r = billRow(db, userId, id);
  if (!r) return fail(404, 'Bill not found');
  deleteSupplierInvoiceFile(r.file_path);
  run(db, `DELETE FROM business_supplier_invoice_batches WHERE invoice_id = ? AND user_id = ? AND business_id = ?`, [id, userId, r.business_id]);
  run(db, `DELETE FROM business_supplier_invoices WHERE id = ? AND user_id = ? AND business_id = ?`, [id, userId, r.business_id]);
  return { ok: true, value: { id } };
}

function fileName(raw: unknown): string {
  const last = typeof raw === 'string' ? raw.split(/[\\/]/).pop()! : '';
  const base = [...last].filter((c) => c >= ' ').join('').trim();
  return base.slice(0, 120) || 'Bill';
}

/** Attach (or replace) the bill's PDF or photo, checked by its file signature. */
export function setBillFile(db: Database, userId: string, id: string, data: unknown, name: unknown, today: string): Result<SupplierBill> {
  const r = billRow(db, userId, id);
  if (!r) return fail(404, 'Bill not found');
  if (typeof data !== 'string' || !data) return fail(400, 'Choose a file');
  let rel: string;
  try {
    rel = saveSupplierInvoiceFile(id, data);
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : 'Invalid file');
  }
  const now = new Date().toISOString();
  run(db, `UPDATE business_supplier_invoices SET file_path = ?, file_name = ?, file_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND business_id = ?`, [
    rel, fileName(name), now, now, id, userId, r.business_id,
  ]);
  return { ok: true, value: billView(db, userId, r, today) };
}

export function clearBillFile(db: Database, userId: string, id: string, today: string): Result<SupplierBill> {
  const r = billRow(db, userId, id);
  if (!r) return fail(404, 'Bill not found');
  deleteSupplierInvoiceFile(r.file_path);
  run(db, `UPDATE business_supplier_invoices SET file_path = NULL, file_name = '', file_at = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND business_id = ?`, [
    new Date().toISOString(), id, userId, r.business_id,
  ]);
  return { ok: true, value: billView(db, userId, r, today) };
}

/** Link a stock batch of the same business to the bill. Linking twice is a no-op. */
export function linkBillBatch(db: Database, userId: string, billId: string, batchId: string, today: string): Result<SupplierBill> {
  const r = billRow(db, userId, billId);
  if (!r) return fail(404, 'Bill not found');
  if (!queryOne(db, `SELECT id FROM business_stock_batches WHERE id = ? AND user_id = ? AND business_id = ?`, [batchId, userId, r.business_id])) {
    return fail(404, 'Batch not found');
  }
  run(db, `INSERT OR IGNORE INTO business_supplier_invoice_batches (user_id, business_id, invoice_id, batch_id) VALUES (?,?,?,?)`, [
    userId, r.business_id, billId, batchId,
  ]);
  return { ok: true, value: billView(db, userId, r, today) };
}

export function unlinkBillBatch(db: Database, userId: string, billId: string, batchId: string, today: string): Result<SupplierBill> {
  const r = billRow(db, userId, billId);
  if (!r) return fail(404, 'Bill not found');
  run(db, `DELETE FROM business_supplier_invoice_batches WHERE invoice_id = ? AND batch_id = ? AND user_id = ? AND business_id = ?`, [
    billId, batchId, userId, r.business_id,
  ]);
  return { ok: true, value: billView(db, userId, r, today) };
}

/** Bill file paths of a business, or of all the user's bills, for deleting the files. */
export function billFilePaths(db: Database, userId: string, businessId: string | null): string[] {
  return queryAll<{ p: string }>(
    db,
    `SELECT file_path AS p FROM business_supplier_invoices WHERE user_id = ? AND (? IS NULL OR business_id = ?) AND file_path IS NOT NULL`,
    [userId, businessId, businessId],
  ).map((r) => r.p);
}
