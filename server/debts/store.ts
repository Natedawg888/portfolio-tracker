/**
 * Per-user debt rows. Interest settings and balances for one user are never
 * written onto another user's debts.
 */
import type { Database } from 'sql.js';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import {
  debtToIncomeRatio,
  monthBounds,
  payoffSentence,
  projectPayoff,
  rollScheduledInterest,
  roundMoney,
  type CreditorKind,
  type DebtInput,
  type DebtProductKind,
  type InterestPeriod,
} from './model.ts';

export type DebtRecord = {
  id: string;
  name: string;
  kind: CreditorKind;
  notes: string | null;
  outstandingNzd: number;
  createdAt: string;
  updatedAt: string;
  repaidTotalNzd: number;
  productKind: DebtProductKind | null;
  isLoan: boolean;
  interestPeriod: InterestPeriod | null;
  interestRatePercent: number | null;
  minimumPaymentNzd: number | null;
  actualPaymentNzd: number | null;
  remainingTermMonths: number | null;
  interestPaidNzd: number | null;
  interestChargedNzd: number;
  interestPostedThrough: string | null;
  debtToIncome: number | null;
  incomeMonth: string | null;
  recordedIncomeNzd: number | null;
  projectionText: string | null;
};

type StoredRow = {
  id: string;
  name: string;
  kind?: string | null;
  notes?: string | null;
  outstanding_nzd?: number | null;
  created_at: string;
  updated_at: string;
  repaid_total?: number | null;
  product_kind?: string | null;
  is_loan?: number | null;
  interest_period?: string | null;
  interest_rate_percent?: number | null;
  minimum_payment_nzd?: number | null;
  actual_payment_nzd?: number | null;
  remaining_term_months?: number | null;
  interest_paid_nzd?: number | null;
  interest_charged_nzd?: number | null;
  interest_posted_through?: string | null;
};

function numOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function periodOf(value: unknown): InterestPeriod | null {
  return value === 'month' || value === 'year' ? value : null;
}

function productOf(value: unknown): DebtProductKind | null {
  if (
    value === 'credit_card' ||
    value === 'personal_loan' ||
    value === 'student_loan' ||
    value === 'car_loan' ||
    value === 'mortgage' ||
    value === 'bnpl'
  ) {
    return value;
  }
  return null;
}

function creditorOf(value: unknown): CreditorKind {
  return value === 'corporation' ? 'corporation' : 'person';
}

export function recordedIncomeForMonth(
  db: Database,
  userId: string,
  asOf: string,
): { yearMonth: string | null; total: number | null } {
  const bounds = monthBounds(asOf);
  if (!bounds) return { yearMonth: null, total: null };
  const row = queryOne<{ total?: number; n?: number }>(
    db,
    `SELECT COALESCE(SUM(amount_nzd), 0) AS total, COUNT(*) AS n
     FROM income_records
     WHERE user_id = ? AND date >= ? AND date <= ?`,
    [userId, bounds.from, bounds.to],
  );
  const count = Number(row?.n ?? 0);
  if (count <= 0) return { yearMonth: bounds.yearMonth, total: null };
  const total = Number(row?.total ?? 0);
  if (!Number.isFinite(total) || total <= 0) return { yearMonth: bounds.yearMonth, total: null };
  return { yearMonth: bounds.yearMonth, total: roundMoney(total) };
}

function decorate(
  row: StoredRow,
  income: { yearMonth: string | null; total: number | null },
): DebtRecord {
  const interestPeriod = periodOf(row.interest_period);
  const interestRatePercent = numOrNull(row.interest_rate_percent);
  const actualPaymentNzd = numOrNull(row.actual_payment_nzd);
  const outstandingNzd = roundMoney(Number(row.outstanding_nzd ?? 0));
  const projection = projectPayoff({
    balance: outstandingNzd,
    annualRatePercent: interestRatePercent,
    actualPayment: actualPaymentNzd,
    interestPeriod,
  });
  return {
    id: row.id,
    name: row.name,
    kind: creditorOf(row.kind),
    notes: row.notes ?? null,
    outstandingNzd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    repaidTotalNzd: roundMoney(Number(row.repaid_total ?? 0)),
    productKind: productOf(row.product_kind),
    isLoan: Number(row.is_loan) === 1,
    interestPeriod,
    interestRatePercent,
    minimumPaymentNzd: numOrNull(row.minimum_payment_nzd),
    actualPaymentNzd,
    remainingTermMonths: numOrNull(row.remaining_term_months),
    interestPaidNzd: numOrNull(row.interest_paid_nzd),
    interestChargedNzd: roundMoney(Number(row.interest_charged_nzd ?? 0)),
    interestPostedThrough: row.interest_posted_through ?? null,
    debtToIncome: debtToIncomeRatio(actualPaymentNzd, income.total),
    incomeMonth: income.yearMonth,
    recordedIncomeNzd: income.total,
    projectionText: payoffSentence(projection),
  };
}

const SELECT_DEBT = `SELECT p.*,
       COALESCE((SELECT SUM(r.amount_nzd) FROM debt_repayments r WHERE r.person_id = p.id), 0) AS repaid_total
     FROM debt_people p`;

export function applyScheduledInterestForUser(db: Database, userId: string, asOf: string): void {
  const rows = queryAll<{
    id: string;
    outstanding_nzd?: number | null;
    interest_period?: string | null;
    interest_rate_percent?: number | null;
    interest_posted_through?: string | null;
    interest_charged_nzd?: number | null;
  }>(
    db,
    `SELECT id, outstanding_nzd, interest_period, interest_rate_percent,
            interest_posted_through, interest_charged_nzd
     FROM debt_people WHERE user_id = ?`,
    [userId],
  );
  const now = new Date().toISOString();
  for (const row of rows) {
    const balance = Number(row.outstanding_nzd ?? 0);
    const posted = row.interest_posted_through ?? null;
    const rolled = rollScheduledInterest({
      balance,
      annualRatePercent: numOrNull(row.interest_rate_percent),
      interestPeriod: periodOf(row.interest_period),
      postedThrough: posted,
      asOf,
    });
    const sameBalance = roundMoney(balance) === rolled.balance;
    const sameThrough = posted === rolled.postedThrough;
    if (sameBalance && sameThrough && rolled.interestAdded === 0) continue;
    const charged = roundMoney(Number(row.interest_charged_nzd ?? 0) + rolled.interestAdded);
    run(
      db,
      `UPDATE debt_people
       SET outstanding_nzd = ?, interest_charged_nzd = ?, interest_posted_through = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [rolled.balance, charged, rolled.postedThrough, now, row.id, userId],
    );
  }
}

function loadRow(db: Database, userId: string, id: string): StoredRow | null {
  return queryOne<StoredRow>(
    db,
    `${SELECT_DEBT} WHERE p.id = ? AND p.user_id = ?`,
    [id, userId],
  );
}

export function getDebtForUser(
  db: Database,
  userId: string,
  id: string,
  asOf: string,
): DebtRecord | null {
  applyScheduledInterestForUser(db, userId, asOf);
  const row = loadRow(db, userId, id);
  if (!row) return null;
  return decorate(row, recordedIncomeForMonth(db, userId, asOf));
}

export function listDebtsForUser(db: Database, userId: string, asOf: string): DebtRecord[] {
  applyScheduledInterestForUser(db, userId, asOf);
  const income = recordedIncomeForMonth(db, userId, asOf);
  const rows = queryAll<StoredRow>(
    db,
    `${SELECT_DEBT} WHERE p.user_id = ? ORDER BY p.outstanding_nzd DESC, p.name ASC`,
    [userId],
  );
  return rows.map((row) => decorate(row, income));
}

function insertDebt(db: Database, userId: string, input: DebtInput): string {
  const now = new Date().toISOString();
  const id = newId('debt');
  run(
    db,
    `INSERT INTO debt_people (
       id, user_id, name, kind, notes, outstanding_nzd, created_at, updated_at,
       product_kind, is_loan, interest_period, interest_rate_percent,
       minimum_payment_nzd, actual_payment_nzd, remaining_term_months,
       interest_paid_nzd, interest_posted_through, interest_charged_nzd
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      input.name,
      input.kind,
      input.notes,
      input.outstandingNzd,
      now,
      now,
      input.productKind,
      input.isLoan ? 1 : 0,
      input.interestPeriod,
      input.interestRatePercent,
      input.minimumPaymentNzd,
      input.actualPaymentNzd,
      input.remainingTermMonths,
      input.interestPaidNzd,
      null,
      0,
    ],
  );
  return id;
}

export function createDebt(
  db: Database,
  userId: string,
  input: DebtInput,
  asOf: string,
): DebtRecord {
  const id = insertDebt(db, userId, input);
  const saved = getDebtForUser(db, userId, id, asOf);
  if (!saved) throw new Error('Debt save did not return the new row');
  return saved;
}

export function updateDebt(
  db: Database,
  userId: string,
  id: string,
  patch: Partial<DebtInput>,
  asOf: string,
): DebtRecord | null {
  const existing = loadRow(db, userId, id);
  if (!existing) return null;
  const currentPeriod = periodOf(existing.interest_period);
  const next: DebtInput = {
    name: patch.name ?? existing.name,
    kind: patch.kind ?? creditorOf(existing.kind),
    notes: patch.notes !== undefined ? patch.notes : (existing.notes ?? null),
    outstandingNzd:
      patch.outstandingNzd !== undefined
        ? patch.outstandingNzd
        : roundMoney(Number(existing.outstanding_nzd ?? 0)),
    productKind: patch.productKind !== undefined ? patch.productKind : productOf(existing.product_kind),
    isLoan: patch.isLoan !== undefined ? patch.isLoan : Number(existing.is_loan) === 1,
    interestPeriod: patch.interestPeriod !== undefined ? patch.interestPeriod : currentPeriod,
    interestRatePercent:
      patch.interestRatePercent !== undefined
        ? patch.interestRatePercent
        : numOrNull(existing.interest_rate_percent),
    minimumPaymentNzd:
      patch.minimumPaymentNzd !== undefined
        ? patch.minimumPaymentNzd
        : numOrNull(existing.minimum_payment_nzd),
    actualPaymentNzd:
      patch.actualPaymentNzd !== undefined
        ? patch.actualPaymentNzd
        : numOrNull(existing.actual_payment_nzd),
    remainingTermMonths:
      patch.remainingTermMonths !== undefined
        ? patch.remainingTermMonths
        : numOrNull(existing.remaining_term_months),
    interestPaidNzd:
      patch.interestPaidNzd !== undefined
        ? patch.interestPaidNzd
        : numOrNull(existing.interest_paid_nzd),
  };
  const periodChanged = next.interestPeriod !== currentPeriod;
  const now = new Date().toISOString();
  run(
    db,
    `UPDATE debt_people
     SET name = ?, kind = ?, notes = ?, outstanding_nzd = ?, product_kind = ?, is_loan = ?,
         interest_period = ?, interest_rate_percent = ?, minimum_payment_nzd = ?,
         actual_payment_nzd = ?, remaining_term_months = ?, interest_paid_nzd = ?,
         interest_posted_through = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [
      next.name,
      next.kind,
      next.notes,
      next.outstandingNzd,
      next.productKind,
      next.isLoan ? 1 : 0,
      next.interestPeriod,
      next.interestRatePercent,
      next.minimumPaymentNzd,
      next.actualPaymentNzd,
      next.remainingTermMonths,
      next.interestPaidNzd,
      periodChanged ? null : (existing.interest_posted_through ?? null),
      now,
      id,
      userId,
    ],
  );
  return getDebtForUser(db, userId, id, asOf);
}
