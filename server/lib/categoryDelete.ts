/**
 * Deleting a transaction category without losing anything that uses it. Everything tagged with
 * the category, and its budget and income plans, moves to another category of the same type the
 * same user owns. If the target already has a plan for one of the same periods the delete is
 * refused (nothing is merged or removed), so the user can pick another or change the plan first.
 * A category that nothing uses is deleted straight away.
 */
import type { Database } from 'sql.js';
import { queryAll, queryOne, run } from '../db/index.ts';
import { isBuiltInCategory } from '../../src/lib/categoryManagerView.ts';
import { normalizeCategoryType } from '../../src/lib/categoryTypes.ts';
import { rememberDeletedDefault } from './categories.ts';

export type CategoryUsage = {
  transactions: number;
  incomeRecords: number;
  budgetPlans: number;
  incomePlans: number;
  payeeRules: number;
  recurring: number;
  shopping: number;
  total: number;
};

/** Tables whose rows simply point at the category (no uniqueness to merge around). */
const TAGGED = ['transactions', 'income_records', 'payee_settings', 'recurring_items', 'shopping_lists', 'shopping_items'] as const;

function count(db: Database, table: string, userId: string, categoryId: string): number {
  return Number(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ? AND category_id = ?`, [userId, categoryId])?.n ?? 0);
}

export function categoryUsage(db: Database, userId: string, categoryId: string): CategoryUsage {
  const u = {
    transactions: count(db, 'transactions', userId, categoryId),
    incomeRecords: count(db, 'income_records', userId, categoryId),
    budgetPlans: count(db, 'budgets', userId, categoryId),
    incomePlans: count(db, 'income_plans', userId, categoryId),
    payeeRules: count(db, 'payee_settings', userId, categoryId),
    recurring: count(db, 'recurring_items', userId, categoryId),
    shopping: count(db, 'shopping_lists', userId, categoryId) + count(db, 'shopping_items', userId, categoryId),
  };
  return { ...u, total: Object.values(u).reduce((s, n) => s + n, 0) };
}

export type DeleteResult =
  | { ok: true; moved: CategoryUsage }
  | { ok: false; status: number; error: string; usage?: CategoryUsage; clashMonths?: string[] };

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Intl.DateTimeFormat('en-NZ', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
};

/** Months ("YYYY-MM") where both categories have a budget or income plan for the same period. */
export function planClashes(db: Database, userId: string, from: string, into: string): string[] {
  const budgets = queryAll<{ period_start: string }>(
    db,
    `SELECT a.period_start FROM budgets a JOIN budgets b
       ON b.user_id = a.user_id AND b.category_id = ? AND b.period_start = a.period_start AND b.period_end = a.period_end
     WHERE a.user_id = ? AND a.category_id = ?`,
    [into, userId, from],
  ).map((r) => String(r.period_start).slice(0, 7));
  const income = queryAll<{ year_month: string }>(
    db,
    `SELECT a.year_month FROM income_plans a JOIN income_plans b
       ON b.user_id = a.user_id AND b.category_id = ? AND b.year_month = a.year_month
     WHERE a.user_id = ? AND a.category_id = ?`,
    [into, userId, from],
  ).map((r) => String(r.year_month));
  return [...new Set([...budgets, ...income])].sort();
}

export function deleteCategory(db: Database, userId: string, id: string, moveTo: string | null): DeleteResult {
  const own = (cid: string) =>
    queryOne<{ id: string; name: string; slug: string | null; type: string | null; is_income: number | null }>(
      db,
      `SELECT id, name, slug, type, is_income FROM budget_categories WHERE id = ? AND user_id = ?`,
      [cid, userId],
    );
  const cat = own(id);
  if (!cat) return { ok: false, status: 404, error: 'Category not found' };
  if (isBuiltInCategory(cat.slug)) return { ok: false, status: 400, error: `“${cat.name}” is built in, so it can't be deleted` };
  const usage = categoryUsage(db, userId, id);
  if (usage.total > 0) {
    if (!moveTo) return { ok: false, status: 409, error: 'This category is in use. Choose a category to move its items to.', usage };
    const target = moveTo === id ? null : own(moveTo);
    if (!target) return { ok: false, status: 400, error: 'Choose another of your categories to move them to' };
    if (normalizeCategoryType(target.type, target.is_income) !== normalizeCategoryType(cat.type, cat.is_income)) {
      return { ok: false, status: 400, error: 'Choose a category of the same type to move them to' };
    }
    const clashMonths = planClashes(db, userId, id, moveTo);
    if (clashMonths.length) {
      return {
        ok: false,
        status: 409,
        error: `“${target.name}” already has a plan for ${clashMonths.map(monthLabel).join(', ')}. Choose another category, or change one of the plans on Budget first.`,
        usage,
        clashMonths,
      };
    }
    for (const t of TAGGED) run(db, `UPDATE ${t} SET category_id = ? WHERE category_id = ? AND user_id = ?`, [moveTo, id, userId]);
    run(db, `UPDATE budgets SET category_id = ? WHERE category_id = ? AND user_id = ?`, [moveTo, id, userId]);
    run(db, `UPDATE income_plans SET category_id = ?, updated_at = ? WHERE category_id = ? AND user_id = ?`, [moveTo, new Date().toISOString(), id, userId]);
  }
  run(db, `UPDATE budget_categories SET parent_id = NULL WHERE parent_id = ? AND user_id = ?`, [id, userId]);
  run(db, `DELETE FROM budget_categories WHERE id = ? AND user_id = ?`, [id, userId]);
  rememberDeletedDefault(db, userId, cat.slug);
  return { ok: true, moved: usage };
}
