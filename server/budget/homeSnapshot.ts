/**
 * Home-screen month: income, spending, savings, and savings rate.
 *
 * Income matches Budget received (income_records plus unlinked income-category
 * credits). Spending matches Budget spend (spending-category outflows, including
 * uncategorised debits, plus debt repayments that are not already a counted
 * debt transaction). Transfers are neither income nor spending.
 *
 * Savings is income minus spending. savingsRate is that remainder divided by
 * income — a fraction, same kind of ratio as debt-to-income (0.25 means 25%).
 * The rate is null when income is zero or negative.
 *
 * expectedPay is the monthly take-home from saved pay sources (KAN-70). It is shown
 * beside received income and never added to it.
 *
 * Month bounds are Pacific/Auckland calendar dates. dividend_events is not read;
 * a mirrored dividend already sits on income_records when one was recorded.
 */
import type { Database } from 'sql.js';
import type { HomeMonthSnapshot } from '../../src/types/index.ts';
import { categoryTypeCountsAsSpend, normalizeCategoryType } from '../../src/lib/categoryTypes.ts';
import { DEBT_SLUG, isDebtCategoryRef, resolveCategoryId } from '../lib/categories.ts';
import { queryAll, queryOne } from '../db/index.ts';
import { aucklandToday, monthBounds, roundMoney } from '../debts/model.ts';
import { paySourcesExpected } from '../paySources/store.ts';

export function currentYearMonth(now: Date = new Date()): string {
  return aucklandToday(now).slice(0, 7);
}

/** YYYY-MM, or null when the text is not a real calendar month. */
export function parseYearMonth(input: unknown): string | null {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}$/.test(input)) return null;
  const month = Number(input.slice(5, 7));
  if (month < 1 || month > 12) return null;
  return monthBounds(`${input}-01`)?.yearMonth ?? null;
}

function linkedIncomeTransactionIds(db: Database, userId: string): Set<string> {
  const rows = queryAll<{ transaction_id?: string | null }>(
    db,
    `SELECT transaction_id FROM income_records
     WHERE user_id = ? AND transaction_id IS NOT NULL`,
    [userId],
  );
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.transaction_id) ids.add(String(row.transaction_id));
  }
  return ids;
}

/** Received NZD for the month. Linked Add-income credits are not added twice. */
function receivedIncomeNzd(
  db: Database,
  userId: string,
  from: string,
  to: string,
): number {
  const records = queryOne<{ total?: number }>(
    db,
    `SELECT COALESCE(SUM(amount_nzd), 0) AS total
     FROM income_records
     WHERE user_id = ? AND date >= ? AND date <= ?`,
    [userId, from, to],
  );
  let total = Number(records?.total ?? 0);
  if (!Number.isFinite(total)) total = 0;

  const linked = linkedIncomeTransactionIds(db, userId);
  const credits = queryAll<{ id?: string; amount?: number }>(
    db,
    `SELECT t.id, t.amount
     FROM transactions t
     INNER JOIN budget_categories c ON c.id = t.category_id AND c.user_id = t.user_id
       AND (c.type = 'income' OR (c.type IS NULL AND c.is_income = 1))
     WHERE t.user_id = ? AND t.date >= ? AND t.date <= ? AND t.amount > 0`,
    [userId, from, to],
  );
  for (const credit of credits) {
    const id = credit.id ? String(credit.id) : '';
    if (id && linked.has(id)) continue;
    const amount = Number(credit.amount);
    if (Number.isFinite(amount) && amount > 0) total += amount;
  }
  return roundMoney(total);
}

/** Spending NZD for the month. Income and transfer categories are excluded. */
function spentNzd(db: Database, userId: string, from: string, to: string): number {
  const debtCategoryId = resolveCategoryId(db, userId, DEBT_SLUG);
  const txns = queryAll<{
    id?: string;
    amount?: number;
    category_id?: string | null;
    type?: string | null;
    is_income?: number | null;
  }>(
    db,
    `SELECT t.id, t.amount, t.category_id, c.type AS type, c.is_income AS is_income
     FROM transactions t
     LEFT JOIN budget_categories c
       ON c.id = t.category_id AND c.user_id = t.user_id
     WHERE t.user_id = ? AND t.date >= ? AND t.date <= ?`,
    [userId, from, to],
  );

  let total = 0;
  const debtTxnIds = new Set<string>();
  for (const txn of txns) {
    const amount = Number(txn.amount);
    if (!Number.isFinite(amount) || amount >= 0) continue;
    const categoryId = txn.category_id ? String(txn.category_id) : null;
    if (categoryId) {
      const type = normalizeCategoryType(txn.type, txn.is_income ?? null);
      if (!categoryTypeCountsAsSpend(type)) continue;
    }
    total += Math.abs(amount);
    if (isDebtCategoryRef(categoryId, debtCategoryId) && txn.id) {
      debtTxnIds.add(String(txn.id));
    }
  }

  const repayments = queryAll<{ amount_nzd?: number; transaction_id?: string | null }>(
    db,
    `SELECT r.amount_nzd, r.transaction_id
     FROM debt_repayments r
     INNER JOIN debt_people p ON p.id = r.person_id
     WHERE p.user_id = ? AND r.date >= ? AND r.date <= ?`,
    [userId, from, to],
  );
  for (const repayment of repayments) {
    const txnId = repayment.transaction_id ? String(repayment.transaction_id) : '';
    if (txnId && debtTxnIds.has(txnId)) continue;
    const amount = Number(repayment.amount_nzd);
    if (Number.isFinite(amount) && amount > 0) total += amount;
  }
  return roundMoney(total);
}

/** Fraction of income, or null when income is not a positive amount. */
export function savingsRateOf(savingsNzd: number, incomeNzd: number): number | null {
  if (!Number.isFinite(incomeNzd) || incomeNzd <= 0) return null;
  if (!Number.isFinite(savingsNzd)) return null;
  return savingsNzd / incomeNzd;
}

export function homeMonthSnapshot(
  db: Database,
  userId: string,
  yearMonth: string,
): HomeMonthSnapshot | null {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) return null;
  const bounds = monthBounds(`${parsed}-01`);
  if (!bounds) return null;

  const incomeNzd = receivedIncomeNzd(db, userId, bounds.from, bounds.to);
  const spendingNzd = spentNzd(db, userId, bounds.from, bounds.to);
  const savingsNzd = roundMoney(incomeNzd - spendingNzd);
  return {
    yearMonth: bounds.yearMonth,
    periodStart: bounds.from,
    periodEnd: bounds.to,
    currency: 'NZD',
    timezone: 'Pacific/Auckland',
    incomeNzd,
    spendingNzd,
    savingsNzd,
    savingsRate: savingsRateOf(savingsNzd, incomeNzd),
    expectedPay: paySourcesExpected(db, userId),
  };
}
