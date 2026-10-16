/**
 * Payslips (KAN-78): a record of each payslip, a check against the PAYE calculator, year-to-date
 * totals per NZ tax year, and net pay into Income linked to the bank deposit.
 *
 * - Scoped to the user. Uploaded files live in uploads/payslips and go with the payslip or account.
 * - One payslip per pay period per pay source (saved pay source, or employer name).
 * - Plans: Free keeps up to FREE_PAYSLIPS_PER_YEAR per tax year, without the PAYE check or
 *   Income. Plus: unlimited, the check, and net pay into Income (so it can be linked to the
 *   bank deposit and not counted twice).
 * - Income mirror: an income_records row (payslip_id) in Salary, from the Budget start date,
 *   linked to a matching bank credit. Deleting a payslip removes that row only; the bank
 *   transaction is never touched.
 */
import type { Database } from 'sql.js';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { aucklandToday, roundMoney } from '../debts/model.ts';
import { isYmd } from '../../src/lib/invoiceCalc.ts';
import { PAY_TAX_YEAR_OPTIONS, taxYearForDate } from '../../src/lib/payeRates.ts';
import { checkPayslip, missingPeriods, type PayslipCheck, type PayslipFrequency } from '../../src/lib/payslipCheck.ts';
import { ensureCategory } from '../lib/categories.ts';
import { hasFeature } from '../lib/entitlements.ts';
import { linkMirroredIncomeToBankCredits } from '../lib/incomeBankLink.ts';
import { TXN_SYNC_FROM_DATE } from '../lib/syncFloor.ts';
import { deletePayslipFile, savePayslipFile } from '../lib/uploads.ts';

export const FREE_PAYSLIPS_PER_YEAR = 12;
const SALARY_CATEGORY = { slug: 'cat-income-salary', name: 'Salary', type: 'income', sortOrder: 1 } as const;
const FREQUENCIES: PayslipFrequency[] = ['weekly', 'fortnightly', 'four_weekly', 'monthly', 'other'];
const MAX = 10_000_000;

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code?: string };
const fail = (status: number, error: string, code?: string): { ok: false; status: number; error: string; code?: string } => ({ ok: false, status, error, code });

export type PayslipDraft = {
  paySourceId: string | null;
  employer: string;
  frequency: PayslipFrequency;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  taxCode: string;
  hours: number | null;
  hourlyRate: number | null;
  grossNzd: number;
  payeNzd: number;
  accNzd: number | null;
  kiwiSaverEmployeeNzd: number;
  kiwiSaverRatePct: number | null;
  kiwiSaverEmployerNzd: number;
  esctNzd: number;
  studentLoanNzd: number;
  otherDeductionsNzd: number;
  allowancesNzd: number;
  netNzd: number;
  addToIncome: boolean;
  notes: string;
};

type Row = {
  id: string;
  pay_source_id: string | null;
  employer: string;
  source_key: string;
  frequency: PayslipFrequency;
  period_start: string;
  period_end: string;
  pay_date: string;
  tax_code: string;
  hours: number | null;
  hourly_rate: number | null;
  gross_nzd: number;
  paye_nzd: number;
  acc_nzd: number | null;
  ks_employee_nzd: number;
  ks_rate_pct: number | null;
  ks_employer_nzd: number;
  esct_nzd: number;
  student_loan_nzd: number;
  other_deductions_nzd: number;
  allowances_nzd: number;
  net_nzd: number;
  add_to_income: number;
  file_path: string | null;
  notes: string;
  created_at: string;
};

export type Payslip = PayslipDraft & {
  id: string;
  /** Which saved employer it belongs to. */
  employerKey: string;
  taxYear: number;
  fileUrl: string | null;
  /** Net pay as calculated from the payslip's own lines, and whether it matches. */
  netCheck: { expected: number; matches: boolean };
  /** null on Free. */
  check: PayslipCheck | null;
  /** Income row and the bank deposit it's linked to (Plus, when added to Income). */
  income: { inIncome: boolean; bankMatch: { transactionId: string; date: string; description: string; amountNzd: number } | null; reason: string | null };
};

export type PayslipsView = {
  plan: { plus: boolean; freeLimit: number; usedThisYear: number };
  taxYear: number;
  years: { startYear: number; label: string }[];
  payslips: Payslip[];
  ytd: {
    count: number;
    grossNzd: number;
    taxNzd: number;
    accNzd: number;
    kiwiSaverNzd: number;
    studentLoanNzd: number;
    netNzd: number;
    bySource: { sourceKey: string; employer: string; count: number; grossNzd: number; netNzd: number; missing: { after: string; before: string }[] }[];
  };
  history: { payDate: string; employer: string; grossNzd: number; netNzd: number }[];
  paySources: { id: string; name: string }[];
  /**
   * Employers saved as payslips are added (one per pay source, or employer name), newest first,
   * with their latest payslip's details so the next one can start from them.
   */
  employers: SavedEmployer[];
  /** The employer the list is showing, or null for all. */
  employer: string | null;
};

export type SavedEmployer = {
  key: string;
  name: string;
  count: number;
  lastPayDate: string;
  usual: Pick<PayslipDraft, 'paySourceId' | 'frequency' | 'taxCode' | 'hours' | 'hourlyRate' | 'kiwiSaverRatePct' | 'accNzd'> & { accInPaye: boolean };
};

// ---------------------------------------------------------------- parsing

function money(o: Record<string, unknown>, key: string, label: string, opts: { required?: boolean; nullable?: boolean } = {}): number | null | string {
  const raw = o[key];
  if (raw === null || raw === undefined || raw === '') {
    if (opts.required) return `${label} is required`;
    return opts.nullable ? null : 0;
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return `${label} must be a number`;
  if (n < 0) return `${label} can’t be negative`;
  if (n > MAX) return `${label} is too large`;
  return roundMoney(n);
}

export function parsePayslip(db: Database, userId: string, raw: unknown): { ok: true; value: PayslipDraft } | { ok: false; error: string } {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'Enter the payslip' };
  const paySourceId = typeof o.paySourceId === 'string' && o.paySourceId ? o.paySourceId : null;
  let employer = typeof o.employer === 'string' ? o.employer.trim().slice(0, 120) : '';
  if (paySourceId) {
    const src = queryOne<{ name: string }>(db, `SELECT name FROM pay_sources WHERE id = ? AND user_id = ?`, [paySourceId, userId]);
    if (!src) return { ok: false, error: 'Pay source not found' };
    if (!employer) employer = src.name;
  }
  if (!employer) return { ok: false, error: 'Enter the employer or choose a pay source' };
  const frequency = o.frequency as PayslipFrequency;
  if (!FREQUENCIES.includes(frequency)) return { ok: false, error: 'Choose how often you’re paid' };
  const dates: Record<string, string> = {};
  for (const [k, label] of [['periodStart', 'Period start'], ['periodEnd', 'Period end'], ['payDate', 'Pay date']] as const) {
    if (!isYmd(o[k])) return { ok: false, error: `${label} must be a date` };
    dates[k] = o[k] as string;
  }
  if (dates.periodEnd < dates.periodStart) return { ok: false, error: 'The period ends before it starts' };
  const fields: [keyof PayslipDraft, string, { required?: boolean; nullable?: boolean }?][] = [
    ['grossNzd', 'Gross pay', { required: true }],
    ['netNzd', 'Net pay', { required: true }],
    ['payeNzd', 'PAYE'],
    ['accNzd', 'ACC levy', { nullable: true }],
    ['kiwiSaverEmployeeNzd', 'KiwiSaver (yours)'],
    ['kiwiSaverEmployerNzd', 'KiwiSaver (employer)'],
    ['esctNzd', 'ESCT'],
    ['studentLoanNzd', 'Student loan'],
    ['otherDeductionsNzd', 'Other deductions'],
    ['allowancesNzd', 'Allowances'],
    ['hours', 'Hours', { nullable: true }],
    ['hourlyRate', 'Hourly rate', { nullable: true }],
    ['kiwiSaverRatePct', 'KiwiSaver rate', { nullable: true }],
  ];
  const nums: Record<string, number | null> = {};
  for (const [k, label, opts] of fields) {
    const v = money(o, k, label, opts);
    if (typeof v === 'string') return { ok: false, error: v };
    nums[k] = v;
  }
  if (nums.kiwiSaverRatePct != null && nums.kiwiSaverRatePct > 100) return { ok: false, error: 'KiwiSaver rate must be 0 to 100' };
  if (nums.hours != null && nums.hours > 744) return { ok: false, error: 'Hours must be 744 or fewer' };
  return {
    ok: true,
    value: {
      paySourceId,
      employer,
      frequency,
      periodStart: dates.periodStart,
      periodEnd: dates.periodEnd,
      payDate: dates.payDate,
      taxCode: typeof o.taxCode === 'string' ? o.taxCode.trim().toUpperCase().slice(0, 12) : '',
      hours: nums.hours,
      hourlyRate: nums.hourlyRate,
      grossNzd: nums.grossNzd!,
      payeNzd: nums.payeNzd!,
      accNzd: nums.accNzd,
      kiwiSaverEmployeeNzd: nums.kiwiSaverEmployeeNzd!,
      kiwiSaverRatePct: nums.kiwiSaverRatePct || null,
      kiwiSaverEmployerNzd: nums.kiwiSaverEmployerNzd!,
      esctNzd: nums.esctNzd!,
      studentLoanNzd: nums.studentLoanNzd!,
      otherDeductionsNzd: nums.otherDeductionsNzd!,
      allowancesNzd: nums.allowancesNzd!,
      netNzd: nums.netNzd!,
      addToIncome: o.addToIncome !== false,
      notes: typeof o.notes === 'string' ? o.notes.trim().slice(0, 500) : '',
    },
  };
}

const sourceKey = (d: PayslipDraft) => d.paySourceId ?? `employer:${d.employer.toLowerCase()}`;

// ---------------------------------------------------------------- view

function present(db: Database, userId: string, r: Row, plus: boolean): Payslip {
  const draft: PayslipDraft = {
    paySourceId: r.pay_source_id,
    employer: r.employer,
    frequency: r.frequency,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    payDate: r.pay_date,
    taxCode: r.tax_code,
    hours: r.hours,
    hourlyRate: r.hourly_rate,
    grossNzd: Number(r.gross_nzd),
    payeNzd: Number(r.paye_nzd),
    accNzd: r.acc_nzd == null ? null : Number(r.acc_nzd),
    kiwiSaverEmployeeNzd: Number(r.ks_employee_nzd),
    kiwiSaverRatePct: r.ks_rate_pct,
    kiwiSaverEmployerNzd: Number(r.ks_employer_nzd),
    esctNzd: Number(r.esct_nzd),
    studentLoanNzd: Number(r.student_loan_nzd),
    otherDeductionsNzd: Number(r.other_deductions_nzd),
    allowancesNzd: Number(r.allowances_nzd),
    netNzd: Number(r.net_nzd),
    addToIncome: r.add_to_income === 1,
    notes: r.notes,
  };
  const expectedNet = roundMoney(
    draft.grossNzd + draft.allowancesNzd - draft.payeNzd - (draft.accNzd ?? 0) - draft.kiwiSaverEmployeeNzd - draft.studentLoanNzd - draft.otherDeductionsNzd,
  );
  const inc = queryOne<{ transaction_id: string | null }>(db, `SELECT transaction_id FROM income_records WHERE user_id = ? AND payslip_id = ?`, [userId, r.id]);
  const txn = inc?.transaction_id
    ? queryOne<{ id: string; date: string; description: string; amount: number }>(db, `SELECT id, date, description, amount FROM transactions WHERE id = ? AND user_id = ?`, [inc.transaction_id, userId])
    : null;
  let reason: string | null = null;
  if (!inc) {
    if (!plus) reason = 'Net pay goes into Income with KoruLedger Plus, linked to your bank deposit.';
    else if (!draft.addToIncome) reason = 'Not added to Income.';
    else if (draft.payDate < TXN_SYNC_FROM_DATE) reason = 'Paid before your budget starts, so it isn’t added to Income.';
  } else if (!txn) reason = 'No matching bank deposit yet (same amount, within 10 days).';
  return {
    ...draft,
    id: r.id,
    employerKey: r.source_key,
    taxYear: taxYearForDate(r.pay_date),
    fileUrl: r.file_path ? `/api/uploads/${r.file_path}` : null,
    netCheck: { expected: expectedNet, matches: Math.abs(expectedNet - draft.netNzd) < 0.015 },
    check: plus ? checkPayslip(draft) : null,
    income: {
      inIncome: !!inc,
      bankMatch: txn ? { transactionId: txn.id, date: txn.date, description: txn.description, amountNzd: roundMoney(Number(txn.amount)) } : null,
      reason,
    },
  };
}

function yearBounds(startYear: number) {
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

/** Employers from every payslip, newest first, each with its latest payslip's details. */
export function savedEmployers(db: Database, userId: string): SavedEmployer[] {
  const rows = queryAll<Row>(db, `SELECT * FROM payslips WHERE user_id = ? ORDER BY pay_date DESC, created_at DESC`, [userId]);
  const out = new Map<string, SavedEmployer>();
  for (const r of rows) {
    const e = out.get(r.source_key);
    if (e) {
      e.count += 1;
      continue;
    }
    out.set(r.source_key, {
      key: r.source_key,
      name: r.employer,
      count: 1,
      lastPayDate: r.pay_date,
      usual: {
        paySourceId: r.pay_source_id,
        frequency: r.frequency,
        taxCode: r.tax_code,
        hours: r.hours,
        hourlyRate: r.hourly_rate,
        kiwiSaverRatePct: r.ks_rate_pct,
        accNzd: null,
        accInPaye: r.acc_nzd == null,
      },
    });
  }
  return [...out.values()];
}

export function listPayslips(db: Database, userId: string, yearRaw?: unknown, employerRaw?: unknown): PayslipsView {
  const plus = hasFeature(db, userId, 'payslips');
  const current = taxYearForDate(aucklandToday());
  const n = Number(yearRaw);
  const taxYear = Number.isInteger(n) && n > 2000 && n < 2100 ? n : current;
  const { from, to } = yearBounds(taxYear);
  const employers = savedEmployers(db, userId);
  const employer = typeof employerRaw === 'string' && employers.some((e) => e.key === employerRaw) ? employerRaw : null;
  const rows = queryAll<Row>(
    db,
    `SELECT * FROM payslips WHERE user_id = ? AND pay_date >= ? AND pay_date <= ?${employer ? ' AND source_key = ?' : ''} ORDER BY pay_date DESC, created_at DESC`,
    [userId, from, to, ...(employer ? [employer] : [])],
  );
  const payslips = rows.map((r) => present(db, userId, r, plus));
  const sum = (f: (p: Payslip) => number) => roundMoney(payslips.reduce((s, p) => s + f(p), 0));
  const groups = new Map<string, Payslip[]>();
  for (const [i, p] of payslips.entries()) {
    const key = rows[i].source_key;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  // Years offered: those with rates, plus any year the user has payslips in.
  const yearsWithSlips = queryAll<{ d: string }>(db, `SELECT DISTINCT pay_date AS d FROM payslips WHERE user_id = ?`, [userId]).map((r) => taxYearForDate(r.d));
  const yearSet = new Set([current, taxYear, ...PAY_TAX_YEAR_OPTIONS.map((y) => y.startYear), ...yearsWithSlips]);
  const years = [...yearSet].sort((a, b) => b - a).map((y) => ({ startYear: y, label: `1 April ${y} – 31 March ${y + 1}` }));
  const usedThisYear = Number(queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM payslips WHERE user_id = ? AND pay_date >= ? AND pay_date <= ?`, [userId, yearBounds(current).from, yearBounds(current).to])?.c ?? 0);
  return {
    plan: { plus, freeLimit: FREE_PAYSLIPS_PER_YEAR, usedThisYear },
    taxYear,
    years,
    payslips,
    ytd: {
      count: payslips.length,
      grossNzd: sum((p) => p.grossNzd + p.allowancesNzd),
      taxNzd: sum((p) => p.payeNzd + (p.accNzd ?? 0)),
      accNzd: sum((p) => p.accNzd ?? 0),
      kiwiSaverNzd: sum((p) => p.kiwiSaverEmployeeNzd),
      studentLoanNzd: sum((p) => p.studentLoanNzd),
      netNzd: sum((p) => p.netNzd),
      bySource: [...groups.entries()].map(([key, list]) => {
        const freq = list[0].frequency;
        return {
          sourceKey: key,
          employer: list[0].employer,
          count: list.length,
          grossNzd: roundMoney(list.reduce((s, p) => s + p.grossNzd + p.allowancesNzd, 0)),
          netNzd: roundMoney(list.reduce((s, p) => s + p.netNzd, 0)),
          missing: list.every((p) => p.frequency === freq) ? missingPeriods(list.map((p) => p.payDate), freq) : [],
        };
      }),
    },
    history: [...payslips].reverse().map((p) => ({ payDate: p.payDate, employer: p.employer, grossNzd: p.grossNzd + p.allowancesNzd, netNzd: p.netNzd })),
    paySources: queryAll<{ id: string; name: string }>(db, `SELECT id, name FROM pay_sources WHERE user_id = ? ORDER BY name`, [userId]),
    employers,
    employer,
  };
}

export function getPayslip(db: Database, userId: string, id: string): Payslip | null {
  const r = queryOne<Row>(db, `SELECT * FROM payslips WHERE id = ? AND user_id = ?`, [id, userId]);
  return r ? present(db, userId, r, hasFeature(db, userId, 'payslips')) : null;
}

// ---------------------------------------------------------------- Income mirror

/** Make the payslip's Income row match it (add, update or remove), then link to the bank. */
export function syncIncome(db: Database, userId: string, id: string): void {
  const r = queryOne<Row>(db, `SELECT * FROM payslips WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!r) return;
  const wanted = hasFeature(db, userId, 'payslips') && r.add_to_income === 1 && r.pay_date >= TXN_SYNC_FROM_DATE && Number(r.net_nzd) > 0;
  const inc = queryOne<{ id: string; date: string; amount_nzd: number }>(db, `SELECT id, date, amount_nzd FROM income_records WHERE user_id = ? AND payslip_id = ?`, [userId, id]);
  if (!wanted) {
    if (inc) run(db, `DELETE FROM income_records WHERE id = ? AND user_id = ?`, [inc.id, userId]);
    return;
  }
  const amount = roundMoney(Number(r.net_nzd));
  const description = `Pay · ${r.employer}`.slice(0, 200);
  if (inc) {
    // A new date or amount may no longer match the deposit it was linked to.
    const moved = inc.date !== r.pay_date || Math.abs(Number(inc.amount_nzd) - amount) >= 0.005;
    run(db, `UPDATE income_records SET date=?, amount_nzd=?, description=?${moved ? ', transaction_id=NULL' : ''} WHERE id=? AND user_id=?`, [r.pay_date, amount, description, inc.id, userId]);
  } else {
    run(
      db,
      `INSERT INTO income_records (id, user_id, date, amount_nzd, kind, description, category_id, notes, created_at, payslip_id) VALUES (?,?,?,?, 'cash', ?, ?, ?, ?, ?)`,
      [newId('inc'), userId, r.pay_date, amount, description, ensureCategory(db, userId, SALARY_CATEGORY), 'Recorded on Payslips.', new Date().toISOString(), id],
    );
  }
  linkMirroredIncomeToBankCredits(db, userId);
}

// ---------------------------------------------------------------- writes

function duplicate(db: Database, userId: string, d: PayslipDraft, exceptId?: string): boolean {
  return !!queryOne(
    db,
    `SELECT 1 FROM payslips WHERE user_id = ? AND source_key = ? AND period_start = ? AND period_end = ?${exceptId ? ' AND id != ?' : ''}`,
    [userId, sourceKey(d), d.periodStart, d.periodEnd, ...(exceptId ? [exceptId] : [])],
  );
}

const COLS = `pay_source_id=?, employer=?, source_key=?, frequency=?, period_start=?, period_end=?, pay_date=?, tax_code=?, hours=?, hourly_rate=?,
  gross_nzd=?, paye_nzd=?, acc_nzd=?, ks_employee_nzd=?, ks_rate_pct=?, ks_employer_nzd=?, esct_nzd=?, student_loan_nzd=?,
  other_deductions_nzd=?, allowances_nzd=?, net_nzd=?, add_to_income=?, notes=?`;
const values = (d: PayslipDraft) => [
  d.paySourceId, d.employer, sourceKey(d), d.frequency, d.periodStart, d.periodEnd, d.payDate, d.taxCode, d.hours, d.hourlyRate,
  d.grossNzd, d.payeNzd, d.accNzd, d.kiwiSaverEmployeeNzd, d.kiwiSaverRatePct, d.kiwiSaverEmployerNzd, d.esctNzd, d.studentLoanNzd,
  d.otherDeductionsNzd, d.allowancesNzd, d.netNzd, d.addToIncome ? 1 : 0, d.notes,
];

export function createPayslip(db: Database, userId: string, body: unknown): Result<Payslip> {
  const p = parsePayslip(db, userId, body);
  if (!p.ok) return fail(400, p.error);
  const d = p.value;
  if (duplicate(db, userId, d)) return fail(409, `There’s already a payslip from ${d.employer} for that period`);
  if (!hasFeature(db, userId, 'payslips')) {
    const { from, to } = yearBounds(taxYearForDate(d.payDate));
    const used = Number(queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM payslips WHERE user_id = ? AND pay_date >= ? AND pay_date <= ?`, [userId, from, to])?.c ?? 0);
    if (used >= FREE_PAYSLIPS_PER_YEAR) return fail(402, `The free plan keeps ${FREE_PAYSLIPS_PER_YEAR} payslips a tax year. KoruLedger Plus keeps them all.`, 'PLAN_LIMIT');
  }
  const id = newId('psl');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO payslips (id, user_id, pay_source_id, employer, source_key, frequency, period_start, period_end, pay_date, tax_code, hours, hourly_rate,
       gross_nzd, paye_nzd, acc_nzd, ks_employee_nzd, ks_rate_pct, ks_employer_nzd, esct_nzd, student_loan_nzd, other_deductions_nzd, allowances_nzd,
       net_nzd, add_to_income, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, ...values(d), now, now],
  );
  syncIncome(db, userId, id);
  return { ok: true, value: getPayslip(db, userId, id)! };
}

export function updatePayslip(db: Database, userId: string, id: string, body: unknown): Result<Payslip> {
  if (!queryOne(db, `SELECT 1 FROM payslips WHERE id = ? AND user_id = ?`, [id, userId])) return fail(404, 'Payslip not found');
  const p = parsePayslip(db, userId, body);
  if (!p.ok) return fail(400, p.error);
  if (duplicate(db, userId, p.value, id)) return fail(409, `There’s already a payslip from ${p.value.employer} for that period`);
  run(db, `UPDATE payslips SET ${COLS}, updated_at=? WHERE id=? AND user_id=?`, [...values(p.value), new Date().toISOString(), id, userId]);
  syncIncome(db, userId, id);
  return { ok: true, value: getPayslip(db, userId, id)! };
}

/** Removes the payslip, its file and its Income row. The bank deposit stays. */
export function deletePayslip(db: Database, userId: string, id: string): boolean {
  const r = queryOne<{ file_path: string | null }>(db, `SELECT file_path FROM payslips WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!r) return false;
  run(db, `DELETE FROM income_records WHERE user_id = ? AND payslip_id = ?`, [userId, id]);
  deletePayslipFile(r.file_path);
  run(db, `DELETE FROM payslips WHERE id = ? AND user_id = ?`, [id, userId]);
  return true;
}

export function setPayslipFile(db: Database, userId: string, id: string, data: unknown): Result<Payslip> {
  if (!queryOne(db, `SELECT 1 FROM payslips WHERE id = ? AND user_id = ?`, [id, userId])) return fail(404, 'Payslip not found');
  if (typeof data !== 'string' || !data) return fail(400, 'Choose a file');
  let rel: string;
  try {
    rel = savePayslipFile(id, data);
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : 'Invalid file');
  }
  run(db, `UPDATE payslips SET file_path = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [rel, new Date().toISOString(), id, userId]);
  return { ok: true, value: getPayslip(db, userId, id)! };
}

export function clearPayslipFile(db: Database, userId: string, id: string): Result<Payslip> {
  const r = queryOne<{ file_path: string | null }>(db, `SELECT file_path FROM payslips WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!r) return fail(404, 'Payslip not found');
  deletePayslipFile(r.file_path);
  run(db, `UPDATE payslips SET file_path = NULL, updated_at = ? WHERE id = ? AND user_id = ?`, [new Date().toISOString(), id, userId]);
  return { ok: true, value: getPayslip(db, userId, id)! };
}
