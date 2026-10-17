/**
 * Employees of one of the user's businesses: contact details, the bank account they're paid
 * into, pay rate and when they're paid, and their employment contract (a stored file). Every
 * query filters on user_id; another user's id behaves like a missing row. Records only: the app
 * doesn't pay anyone or work out PAYE.
 */
import type { Database } from 'sql.js';
import type { BusinessEmployee } from '../../src/types/index.ts';
import { isPayFrequency, isPayUnit, nextPayDate, type PayFrequency, type PayUnit } from '../../src/lib/employees.ts';
import { formatBankAccount } from '../../src/lib/businessForm.ts';
import { isValidEmail, isYmd } from '../../src/lib/invoiceCalc.ts';
import { roundMoney } from '../../src/lib/debtModel.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { deleteEmployeeContract, saveEmployeeContract } from '../lib/uploads.ts';
import { businessRow } from './profile.ts';

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

export type EmployeeDraft = {
  name: string;
  role: string;
  email: string;
  phone: string;
  address: string;
  bankAccount: string;
  payRateNzd: number | null;
  payUnit: PayUnit;
  payFrequency: PayFrequency;
  payDate: string | null;
  startDate: string | null;
  status: 'active' | 'inactive';
  notes: string;
};

function text(o: Record<string, unknown>, key: string, max: number): string {
  const v = o[key];
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function longText(o: Record<string, unknown>, key: string, max: number): string {
  const v = o[key];
  return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '';
}

function optionalDate(raw: unknown, label: string): Parsed<string | null> {
  if (raw == null || raw === '') return { ok: true, value: null };
  return isYmd(raw) ? { ok: true, value: raw } : { ok: false, error: `${label} must be YYYY-MM-DD` };
}

export function parseEmployee(raw: unknown): Parsed<EmployeeDraft> {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'Body is required' };
  const name = text(o, 'name', 120);
  if (!name) return { ok: false, error: 'Name is required' };
  const email = text(o, 'email', 254);
  if (email && !isValidEmail(email)) return { ok: false, error: 'Email address is not valid' };
  const bankRaw = text(o, 'bankAccount', 40);
  const bankDigits = bankRaw.replace(/\D/g, '');
  if (bankRaw && (!/^[\d\s-]+$/.test(bankRaw) || (bankDigits.length !== 15 && bankDigits.length !== 16))) {
    return { ok: false, error: 'Bank account must be an NZ account number with 15 or 16 digits, e.g. 12-3456-7890123-00' };
  }
  let payRateNzd: number | null = null;
  if (o.payRateNzd != null && o.payRateNzd !== '') {
    const n = Number(o.payRateNzd);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return { ok: false, error: 'Pay rate must be a number of 0 or more' };
    payRateNzd = roundMoney(n);
  }
  const payUnit = o.payUnit ?? 'hour';
  if (!isPayUnit(payUnit)) return { ok: false, error: 'Pay rate must be per hour, day, week, fortnight, month or year' };
  const payFrequency = o.payFrequency ?? 'fortnightly';
  if (!isPayFrequency(payFrequency)) return { ok: false, error: 'Pay frequency must be weekly, fortnightly, every four weeks or monthly' };
  const payDate = optionalDate(o.payDate, 'Pay date');
  if (!payDate.ok) return payDate;
  const startDate = optionalDate(o.startDate, 'Start date');
  if (!startDate.ok) return startDate;
  return {
    ok: true,
    value: {
      name,
      role: text(o, 'role', 80),
      email,
      phone: text(o, 'phone', 40),
      address: longText(o, 'address', 400),
      bankAccount: bankRaw ? formatBankAccount(bankRaw) : '',
      payRateNzd,
      payUnit,
      payFrequency,
      payDate: payDate.value,
      startDate: startDate.value,
      status: o.status === 'inactive' ? 'inactive' : 'active',
      notes: longText(o, 'notes', 1000),
    },
  };
}

type Row = {
  id: string;
  business_id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  address: string;
  bank_account: string;
  pay_rate_nzd: number | null;
  pay_unit: string;
  pay_frequency: string;
  next_pay_date: string | null;
  start_date: string | null;
  status: string;
  notes: string;
  contract_path: string | null;
  contract_name: string | null;
  contract_at: string | null;
  created_at: string;
  updated_at: string;
};

function present(r: Row, today: string): BusinessEmployee {
  const payFrequency = (isPayFrequency(r.pay_frequency) ? r.pay_frequency : 'fortnightly') as PayFrequency;
  return {
    id: r.id,
    businessId: r.business_id,
    name: r.name,
    role: r.role ?? '',
    email: r.email ?? '',
    phone: r.phone ?? '',
    address: r.address ?? '',
    bankAccount: r.bank_account ?? '',
    payRateNzd: r.pay_rate_nzd == null ? null : roundMoney(Number(r.pay_rate_nzd)),
    payUnit: (isPayUnit(r.pay_unit) ? r.pay_unit : 'hour') as PayUnit,
    payFrequency,
    payDate: r.next_pay_date,
    nextPayDate: nextPayDate(r.next_pay_date, payFrequency, today),
    startDate: r.start_date,
    status: r.status === 'inactive' ? 'inactive' : 'active',
    notes: r.notes ?? '',
    contract: r.contract_path
      ? { url: `/api/uploads/${r.contract_path}`, name: r.contract_name || 'Contract', uploadedAt: r.contract_at ?? r.updated_at }
      : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Active first, then by name. */
export function listEmployees(db: Database, userId: string, businessId: string, today: string): BusinessEmployee[] {
  return queryAll<Row>(
    db,
    `SELECT * FROM business_employees WHERE user_id = ? AND business_id = ? ORDER BY status = 'inactive', lower(name), created_at`,
    [userId, businessId],
  ).map((r) => present(r, today));
}

function row(db: Database, userId: string, id: string): Row | null {
  return queryOne<Row>(db, `SELECT * FROM business_employees WHERE id = ? AND user_id = ?`, [id, userId]);
}

const COLS = `name=?, role=?, email=?, phone=?, address=?, bank_account=?, pay_rate_nzd=?, pay_unit=?, pay_frequency=?, next_pay_date=?, start_date=?, status=?, notes=?`;
const values = (d: EmployeeDraft) => [
  d.name, d.role, d.email, d.phone, d.address, d.bankAccount, d.payRateNzd, d.payUnit, d.payFrequency, d.payDate, d.startDate, d.status, d.notes,
];

export function createEmployee(db: Database, userId: string, businessId: string, d: EmployeeDraft, today: string): Result<BusinessEmployee> {
  if (!businessRow(db, userId, businessId)) return fail(404, 'Business not found');
  const id = newId('bemp');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO business_employees (id, user_id, business_id, name, role, email, phone, address, bank_account, pay_rate_nzd, pay_unit,
       pay_frequency, next_pay_date, start_date, status, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, businessId, ...values(d), now, now],
  );
  return { ok: true, value: present(row(db, userId, id)!, today) };
}

export function updateEmployee(db: Database, userId: string, id: string, d: EmployeeDraft, today: string): Result<BusinessEmployee> {
  if (!row(db, userId, id)) return fail(404, 'Employee not found');
  run(db, `UPDATE business_employees SET ${COLS}, updated_at=? WHERE id=? AND user_id=?`, [...values(d), new Date().toISOString(), id, userId]);
  return { ok: true, value: present(row(db, userId, id)!, today) };
}

export function deleteEmployee(db: Database, userId: string, id: string): boolean {
  const r = row(db, userId, id);
  if (!r) return false;
  deleteEmployeeContract(r.contract_path);
  run(db, `DELETE FROM business_employees WHERE id = ? AND user_id = ?`, [id, userId]);
  return true;
}

/** A display name for the stored file: the uploaded name without any folder, or "Contract". */
function contractName(raw: unknown): string {
  const last = typeof raw === 'string' ? raw.split(/[\\/]/).pop()! : '';
  const base = [...last].filter((c) => c >= ' ').join('').trim();
  return base.slice(0, 120) || 'Contract';
}

/** Save (or replace) the employee's contract: a PDF, Word document or photo, up to 8 MB. */
export function setEmployeeContract(db: Database, userId: string, id: string, data: unknown, fileName: unknown, today: string): Result<BusinessEmployee> {
  if (!row(db, userId, id)) return fail(404, 'Employee not found');
  if (typeof data !== 'string' || !data) return fail(400, 'Choose a file');
  let rel: string;
  try {
    rel = saveEmployeeContract(id, data);
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : 'Invalid file');
  }
  const now = new Date().toISOString();
  run(db, `UPDATE business_employees SET contract_path = ?, contract_name = ?, contract_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [
    rel, contractName(fileName), now, now, id, userId,
  ]);
  return { ok: true, value: present(row(db, userId, id)!, today) };
}

export function clearEmployeeContract(db: Database, userId: string, id: string, today: string): Result<BusinessEmployee> {
  const r = row(db, userId, id);
  if (!r) return fail(404, 'Employee not found');
  deleteEmployeeContract(r.contract_path);
  run(db, `UPDATE business_employees SET contract_path = NULL, contract_name = '', contract_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?`, [
    new Date().toISOString(), id, userId,
  ]);
  return { ok: true, value: present(row(db, userId, id)!, today) };
}

export function activeEmployeeCount(db: Database, userId: string, businessId: string): number {
  return Number(
    queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM business_employees WHERE user_id = ? AND business_id = ? AND status = 'active'`, [userId, businessId])?.c ?? 0,
  );
}
