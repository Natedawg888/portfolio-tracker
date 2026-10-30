/**
 * Wages a business has paid (KAN-121): the gross amount, the date it was paid, and optionally
 * the employee and the bank payment it went out as. Records only; nothing is paid from the app.
 *
 * Wages are an expense on the date paid (payments basis, like everything in businessMoney). A
 * bank payment linked to a wage isn't counted again. employee_name keeps a wage readable after
 * the employee is deleted (deleteEmployee sets employee_id to NULL).
 *
 * Every query filters on user_id and business_id; another user's or business's id behaves like
 * a missing row.
 */
import type { Database } from 'sql.js';
import { isYmd } from '../../src/lib/invoiceCalc.ts';
import { roundMoney } from '../../src/lib/debtModel.ts';
import type { BusinessWagePayment } from '../../src/types/index.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { businessRow } from './profile.ts';

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

const MAX_MONEY = 100_000_000;

export type WageDraft = { employeeId: string | null; employeeName: string; date: string; amountNzd: number; transactionId: string | null; notes: string };

export function parseWage(raw: unknown, today: string): Parsed<WageDraft> {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'Body is required' };
  const date = o.date == null || o.date === '' ? today : o.date;
  if (!isYmd(date)) return { ok: false, error: 'Date must be YYYY-MM-DD' };
  if (date > today) return { ok: false, error: 'Record wages once they’re paid (the date can’t be in the future)' };
  const amount = typeof o.amountNzd === 'number' ? o.amountNzd : Number(o.amountNzd);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Amount must be more than 0' };
  if (amount > MAX_MONEY) return { ok: false, error: 'Amount is too large' };
  const id = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string).trim().slice(0, 80) : null);
  const employeeName = typeof o.employeeName === 'string' ? o.employeeName.trim().replace(/\s+/g, ' ').slice(0, 120) : '';
  const employeeId = id('employeeId');
  if (!employeeId && !employeeName) return { ok: false, error: 'Pick an employee or enter who was paid' };
  const notes = typeof o.notes === 'string' ? o.notes.replace(/\r\n?/g, '\n').trim().slice(0, 1000) : '';
  return { ok: true, value: { employeeId, employeeName, date, amountNzd: roundMoney(amount), transactionId: id('transactionId'), notes } };
}

type WageRow = { id: string; business_id: string; employee_id: string | null; employee_name: string; date: string; amount_nzd: number; transaction_id: string | null; notes: string; created_at: string };

const present = (r: WageRow): BusinessWagePayment => ({
  id: r.id,
  businessId: r.business_id,
  employeeId: r.employee_id,
  employeeName: r.employee_name,
  date: r.date,
  amountNzd: roundMoney(Number(r.amount_nzd)),
  transactionId: r.transaction_id,
  notes: r.notes ?? '',
  createdAt: r.created_at,
});

function wageRow(db: Database, userId: string, id: string): WageRow | null {
  return queryOne<WageRow>(db, `SELECT * FROM business_wage_payments WHERE id = ? AND user_id = ?`, [id, userId]);
}

/** Wages of the business paid in [start, end], newest first. */
export function listWages(db: Database, userId: string, businessId: string, start = '0000-01-01', end = '9999-12-31'): BusinessWagePayment[] {
  return queryAll<WageRow>(
    db,
    `SELECT * FROM business_wage_payments WHERE user_id = ? AND business_id = ? AND date >= ? AND date <= ? ORDER BY date DESC, created_at DESC, id`,
    [userId, businessId, start, end],
  ).map(present);
}

/** Bank payments linked to this business's wages (any date), so they count once. */
export function wageLinkedPayments(db: Database, userId: string, businessId: string): Set<string> {
  return new Set(
    queryAll<{ t: string }>(db, `SELECT transaction_id AS t FROM business_wage_payments WHERE user_id = ? AND business_id = ? AND transaction_id IS NOT NULL`, [userId, businessId]).map(
      (r) => r.t,
    ),
  );
}

function resolve(db: Database, userId: string, businessId: string, d: WageDraft, exceptId: string | null): Result<{ employeeName: string }> {
  let employeeName = d.employeeName;
  if (d.employeeId) {
    const e = queryOne<{ name: string }>(db, `SELECT name FROM business_employees WHERE id = ? AND user_id = ? AND business_id = ?`, [d.employeeId, userId, businessId]);
    if (!e) return fail(404, 'Employee not found');
    employeeName = e.name;
  }
  if (d.transactionId) {
    const t = queryOne<{ amount: number; kind: string }>(db, `SELECT amount, kind FROM transactions WHERE id = ? AND user_id = ?`, [d.transactionId, userId]);
    if (!t) return fail(404, 'Bank transaction not found');
    if (!(Number(t.amount) < 0) || t.kind === 'transfer') return fail(400, 'Link a payment (money out), not a deposit or transfer');
    const other =
      queryOne(db, `SELECT id FROM business_wage_payments WHERE user_id = ? AND transaction_id = ? AND id IS NOT ?`, [userId, d.transactionId, exceptId]) ??
      queryOne(db, `SELECT id FROM business_supplier_invoices WHERE user_id = ? AND transaction_id = ?`, [userId, d.transactionId]);
    if (other) return fail(409, 'That payment is already linked to another wage or a bill');
  }
  return { ok: true, value: { employeeName } };
}

export function createWage(db: Database, userId: string, businessId: string, d: WageDraft): Result<BusinessWagePayment> {
  if (!businessRow(db, userId, businessId)) return fail(404, 'Business not found');
  const r = resolve(db, userId, businessId, d, null);
  if (!r.ok) return r;
  const id = newId('wage');
  run(
    db,
    `INSERT INTO business_wage_payments (id, user_id, business_id, employee_id, employee_name, date, amount_nzd, transaction_id, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, businessId, d.employeeId, r.value.employeeName, d.date, d.amountNzd, d.transactionId, d.notes, new Date().toISOString()],
  );
  return { ok: true, value: present(wageRow(db, userId, id)!) };
}

export function updateWage(db: Database, userId: string, id: string, d: WageDraft): Result<BusinessWagePayment> {
  const w = wageRow(db, userId, id);
  if (!w) return fail(404, 'Wage payment not found');
  const r = resolve(db, userId, w.business_id, d, id);
  if (!r.ok) return r;
  run(
    db,
    `UPDATE business_wage_payments SET employee_id=?, employee_name=?, date=?, amount_nzd=?, transaction_id=?, notes=? WHERE id=? AND user_id=? AND business_id=?`,
    [d.employeeId, r.value.employeeName, d.date, d.amountNzd, d.transactionId, d.notes, id, userId, w.business_id],
  );
  return { ok: true, value: present(wageRow(db, userId, id)!) };
}

export function deleteWage(db: Database, userId: string, id: string): Result<{ id: string }> {
  const w = wageRow(db, userId, id);
  if (!w) return fail(404, 'Wage payment not found');
  run(db, `DELETE FROM business_wage_payments WHERE id = ? AND user_id = ? AND business_id = ?`, [id, userId, w.business_id]);
  return { ok: true, value: { id } };
}
