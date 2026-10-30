/**
 * Business budget (KAN-121): each business has its own categories, separate from the personal
 * budget, with planned amounts per month or per tax year, and actuals filled in automatically.
 *
 * Categories: a business starts with Sales, Other income, Stock, Delivery, Wages, Rent and
 * Marketing (seeded on first read). The first five have a role, which is where automatic actuals
 * land; they can be renamed and re-planned but not deleted. Others can be added and deleted;
 * deleting one takes its bank transactions back to uncategorised.
 *
 * Actuals come from businessMoney, so they match the P&L and count each dollar once:
 *   sales         recorded sales (not invoice-linked) and invoice payments
 *   other_income  tagged income rows, and tagged deposits not put in a category
 *   stock         paid stock bills, less their freight
 *   delivery      freight on paid stock bills, and paid delivery bills
 *   wages         wages paid
 *   any category  tagged bank transactions put in it (business_category_id)
 * Tagged payments not put in a category are "uncategorised" and still count as expenses.
 *
 * Plans: period is 'YYYY-MM' for a month-planned category, or the year a tax year ends ('2027'
 * = Apr 2026 to Mar 2027) for a year-planned one. Changing a category's cadence drops its plans.
 */
import type { Database } from 'sql.js';
import { roundMoney } from '../../src/lib/debtModel.ts';
import { taxYearOf, taxYearRange } from '../../src/lib/business.ts';
import type { BusinessBudgetCategory, BusinessBudgetLine, BusinessBudgetView } from '../../src/types/index.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { businessRow } from './profile.ts';
import { monthsBetween } from './profitLoss.ts';
import { saleLineCosts } from './stock.ts';
import { businessMoney, taxYears } from './store.ts';

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

type Role = NonNullable<BusinessBudgetCategory['role']>;
const MAX_MONEY = 100_000_000;
export const MAX_CATEGORIES = 60;

export const DEFAULT_CATEGORIES: { name: string; kind: 'income' | 'expense'; role: Role | null }[] = [
  { name: 'Sales', kind: 'income', role: 'sales' },
  { name: 'Other income', kind: 'income', role: 'other_income' },
  { name: 'Stock', kind: 'expense', role: 'stock' },
  { name: 'Delivery', kind: 'expense', role: 'delivery' },
  { name: 'Wages', kind: 'expense', role: 'wages' },
  { name: 'Rent', kind: 'expense', role: null },
  { name: 'Marketing', kind: 'expense', role: null },
];

type CategoryRow = { id: string; business_id: string; name: string; kind: 'income' | 'expense'; role: Role | null; plan_cadence: 'month' | 'year'; sort_order: number };

const present = (r: CategoryRow): BusinessBudgetCategory => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  role: r.role ?? null,
  planCadence: r.plan_cadence === 'year' ? 'year' : 'month',
  sortOrder: Number(r.sort_order),
});

function categoryRow(db: Database, userId: string, id: string): CategoryRow | null {
  return queryOne<CategoryRow>(db, `SELECT * FROM business_budget_categories WHERE id = ? AND user_id = ?`, [id, userId]);
}

/** The business's categories, adding the defaults (and any missing role category) first. */
export function ensureCategories(db: Database, userId: string, businessId: string): BusinessBudgetCategory[] {
  const existing = queryAll<CategoryRow>(db, `SELECT * FROM business_budget_categories WHERE user_id = ? AND business_id = ? ORDER BY sort_order, created_at, id`, [userId, businessId]);
  const fresh = existing.length === 0;
  const roles = new Set(existing.map((r) => r.role).filter(Boolean));
  const now = new Date().toISOString();
  let order = existing.reduce((m, r) => Math.max(m, Number(r.sort_order)), -1) + 1;
  let added = false;
  for (const d of DEFAULT_CATEGORIES) {
    if (!fresh && (!d.role || roles.has(d.role))) continue;
    added = true;
    run(
      db,
      `INSERT INTO business_budget_categories (id, user_id, business_id, name, kind, role, plan_cadence, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,'month',?,?,?)`,
      [newId('bcat'), userId, businessId, d.name, d.kind, d.role, order++, now, now],
    );
  }
  if (!added) return existing.map(present);
  return queryAll<CategoryRow>(db, `SELECT * FROM business_budget_categories WHERE user_id = ? AND business_id = ? ORDER BY sort_order, created_at, id`, [userId, businessId]).map(present);
}

// ---------------------------------------------------------------- categories

export type CategoryDraft = { name: string; kind: 'income' | 'expense'; planCadence: 'month' | 'year' };

export function parseCategory(raw: unknown): Parsed<CategoryDraft> {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'Body is required' };
  const name = typeof o.name === 'string' ? o.name.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
  if (!name) return { ok: false, error: 'Name is required' };
  const kind = o.kind === 'income' ? 'income' : o.kind === 'expense' || o.kind == null ? 'expense' : null;
  if (!kind) return { ok: false, error: 'kind must be income or expense' };
  const planCadence = o.planCadence === 'year' ? 'year' : o.planCadence === 'month' || o.planCadence == null ? 'month' : null;
  if (!planCadence) return { ok: false, error: 'planCadence must be month or year' };
  return { ok: true, value: { name, kind, planCadence } };
}

function nameTaken(db: Database, userId: string, businessId: string, name: string, exceptId: string | null): boolean {
  return Boolean(queryOne(db, `SELECT 1 FROM business_budget_categories WHERE user_id = ? AND business_id = ? AND lower(name) = lower(?) AND id IS NOT ?`, [userId, businessId, name, exceptId]));
}

export function createCategory(db: Database, userId: string, businessId: string, d: CategoryDraft): Result<BusinessBudgetCategory> {
  if (!businessRow(db, userId, businessId)) return fail(404, 'Business not found');
  const cats = ensureCategories(db, userId, businessId);
  if (cats.length >= MAX_CATEGORIES) return fail(409, `A business budget can have up to ${MAX_CATEGORIES} categories`);
  if (nameTaken(db, userId, businessId, d.name, null)) return fail(409, `There's already a category called ${d.name}`);
  const id = newId('bcat');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO business_budget_categories (id, user_id, business_id, name, kind, role, plan_cadence, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,NULL,?,?,?,?)`,
    [id, userId, businessId, d.name, d.kind, d.planCadence, cats.reduce((m, c) => Math.max(m, c.sortOrder), -1) + 1, now, now],
  );
  return { ok: true, value: present(categoryRow(db, userId, id)!) };
}

/** Rename or re-plan a category. A role category keeps its kind; changing cadence drops its plans. */
export function updateCategory(db: Database, userId: string, id: string, d: CategoryDraft): Result<BusinessBudgetCategory> {
  const r = categoryRow(db, userId, id);
  if (!r) return fail(404, 'Category not found');
  if (nameTaken(db, userId, r.business_id, d.name, id)) return fail(409, `There's already a category called ${d.name}`);
  const kind = r.role ? r.kind : d.kind;
  if (d.planCadence !== r.plan_cadence) run(db, `DELETE FROM business_budget_plans WHERE category_id = ? AND user_id = ?`, [id, userId]);
  run(db, `UPDATE business_budget_categories SET name = ?, kind = ?, plan_cadence = ?, updated_at = ? WHERE id = ? AND user_id = ? AND business_id = ?`, [
    d.name, kind, d.planCadence, new Date().toISOString(), id, userId, r.business_id,
  ]);
  return { ok: true, value: present(categoryRow(db, userId, id)!) };
}

export function deleteCategory(db: Database, userId: string, id: string): Result<{ id: string }> {
  const r = categoryRow(db, userId, id);
  if (!r) return fail(404, 'Category not found');
  if (r.role) return fail(409, `${r.name} fills in automatically, so it can't be deleted. Rename it instead.`);
  run(db, `UPDATE transactions SET business_category_id = NULL WHERE user_id = ? AND business_category_id = ?`, [userId, id]);
  run(db, `DELETE FROM business_budget_plans WHERE category_id = ? AND user_id = ?`, [id, userId]);
  run(db, `DELETE FROM business_budget_categories WHERE id = ? AND user_id = ? AND business_id = ?`, [id, userId, r.business_id]);
  return { ok: true, value: { id } };
}

// ---------------------------------------------------------------- plans

/** { plans: [{ period, amountNzd }] }; amountNzd null (or blank) clears that period. */
export function setPlans(db: Database, userId: string, categoryId: string, raw: unknown): Result<BusinessBudgetCategory> {
  const r = categoryRow(db, userId, categoryId);
  if (!r) return fail(404, 'Category not found');
  const list = (raw as { plans?: unknown } | null)?.plans;
  if (!Array.isArray(list) || list.length === 0 || list.length > 24) return fail(400, 'Send plans: [{ period, amountNzd }] (1 to 24)');
  const want = r.plan_cadence === 'year' ? /^\d{4}$/ : /^\d{4}-(0[1-9]|1[0-2])$/;
  const parsed: { period: string; amount: number | null }[] = [];
  for (const p of list) {
    const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
    const period = typeof o.period === 'string' ? o.period : '';
    if (!want.test(period)) {
      return fail(400, r.plan_cadence === 'year' ? 'This category is planned per tax year: period is the year it ends, e.g. 2027' : 'This category is planned per month: period is YYYY-MM');
    }
    if (o.amountNzd == null || o.amountNzd === '') {
      parsed.push({ period, amount: null });
      continue;
    }
    const n = typeof o.amountNzd === 'number' ? o.amountNzd : Number(o.amountNzd);
    if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY) return fail(400, 'Amounts must be from 0 up');
    parsed.push({ period, amount: roundMoney(n) });
  }
  const now = new Date().toISOString();
  for (const p of parsed) {
    if (p.amount == null) {
      run(db, `DELETE FROM business_budget_plans WHERE category_id = ? AND period = ? AND user_id = ?`, [categoryId, p.period, userId]);
      continue;
    }
    const existing = queryOne<{ id: string }>(db, `SELECT id FROM business_budget_plans WHERE category_id = ? AND period = ? AND user_id = ?`, [categoryId, p.period, userId]);
    if (existing) run(db, `UPDATE business_budget_plans SET amount_nzd = ?, updated_at = ? WHERE id = ?`, [p.amount, now, existing.id]);
    else {
      run(db, `INSERT INTO business_budget_plans (id, user_id, business_id, category_id, period, amount_nzd, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`, [
        newId('bplan'), userId, r.business_id, categoryId, p.period, p.amount, now, now,
      ]);
    }
  }
  return { ok: true, value: present(r) };
}

/** Put a transaction tagged to this business in one of its categories, or take it out (null). */
export function setTransactionCategory(db: Database, userId: string, businessId: string, transactionId: string, categoryId: string | null): Result<true> {
  if (!businessRow(db, userId, businessId)) return fail(404, 'Business not found');
  if (!queryOne(db, `SELECT id FROM transactions WHERE id = ? AND user_id = ? AND business_id = ?`, [transactionId, userId, businessId])) {
    return fail(404, 'Tag the transaction to this business first');
  }
  if (categoryId && !queryOne(db, `SELECT id FROM business_budget_categories WHERE id = ? AND user_id = ? AND business_id = ?`, [categoryId, userId, businessId])) {
    return fail(404, 'Category not found');
  }
  run(db, `UPDATE transactions SET business_category_id = ? WHERE id = ? AND user_id = ? AND business_id = ?`, [categoryId, transactionId, userId, businessId]);
  return { ok: true, value: true };
}

// ---------------------------------------------------------------- the budget

export function budgetView(db: Database, userId: string, businessId: string, taxYear: number | null, today: string): Result<BusinessBudgetView> {
  if (!businessRow(db, userId, businessId)) return fail(404, 'Business not found');
  const year = taxYear ?? taxYearOf(today);
  const { start, end } = taxYearRange(year);
  const months = monthsBetween(start, end);
  const cats = ensureCategories(db, userId, businessId);
  const byRole = new Map(cats.filter((c) => c.role).map((c) => [c.role!, c.id]));
  const actual = new Map<string, Map<string, number>>(cats.map((c) => [c.id, new Map()]));
  const add = (categoryId: string | undefined, date: string, amount: number) => {
    const m = categoryId ? actual.get(categoryId) : undefined;
    if (!m || !amount) return;
    m.set(date.slice(0, 7), (m.get(date.slice(0, 7)) ?? 0) + amount);
  };

  const money = businessMoney(db, userId, businessId, start, end);
  for (const s of money.sales) add(byRole.get('sales'), s.date, s.amountNzd);
  for (const p of money.payments) add(byRole.get('sales'), p.date, p.amountNzd);
  for (const b of money.bills) {
    const freight = b.kind === 'delivery' ? b.amountNzd : b.deliveryNzd;
    add(byRole.get('delivery'), b.date, freight);
    add(byRole.get('stock'), b.date, roundMoney(b.amountNzd - freight));
  }
  for (const w of money.wages) add(byRole.get('wages'), w.date, w.amountNzd);

  const txnCat = new Map(
    queryAll<{ id: string; c: string | null }>(db, `SELECT id, business_category_id AS c FROM transactions WHERE user_id = ? AND business_id = ? AND date >= ? AND date <= ?`, [userId, businessId, start, end]).map(
      (r) => [r.id, r.c],
    ),
  );
  const kindOf = new Map(cats.map((c) => [c.id, c.kind]));
  let uncatIn = 0;
  let uncatOut = 0;
  for (const item of money.items) {
    if (item.countedVia || !item.amountNzd) continue;
    if (item.kind === 'income') {
      add(byRole.get('other_income'), item.date, item.amountNzd);
      continue;
    }
    const cat = txnCat.get(item.id) ?? null;
    if (cat && kindOf.has(cat)) {
      // An income category counts money in; an expense category counts money out (a refund lowers it).
      add(cat, item.date, kindOf.get(cat) === 'income' ? item.amountNzd : -item.amountNzd);
    } else if (item.amountNzd > 0) {
      add(byRole.get('other_income'), item.date, item.amountNzd);
      uncatIn += item.amountNzd;
    } else {
      uncatOut += -item.amountNzd;
    }
  }

  const plans = queryAll<{ category_id: string; period: string; amount_nzd: number }>(
    db,
    `SELECT category_id, period, amount_nzd FROM business_budget_plans WHERE user_id = ? AND business_id = ? AND (period = ? OR (period >= ? AND period <= ?))`,
    [userId, businessId, String(year), months[0], months[months.length - 1]],
  );
  const planOf = new Map<string, Map<string, number>>();
  for (const p of plans) {
    const m = planOf.get(p.category_id) ?? new Map<string, number>();
    m.set(p.period, Number(p.amount_nzd));
    planOf.set(p.category_id, m);
  }

  const lines: BusinessBudgetLine[] = cats.map((c) => {
    const a = actual.get(c.id)!;
    const p = planOf.get(c.id);
    const monthly = months.map((m) => ({ month: m, plannedNzd: c.planCadence === 'month' && p?.has(m) ? roundMoney(p.get(m)!) : null, actualNzd: roundMoney(a.get(m) ?? 0) }));
    const planned =
      c.planCadence === 'year'
        ? p?.has(String(year)) ? roundMoney(p.get(String(year))!) : null
        : monthly.some((m) => m.plannedNzd != null) ? roundMoney(monthly.reduce((s, m) => s + (m.plannedNzd ?? 0), 0)) : null;
    return { ...c, plannedNzd: planned, actualNzd: roundMoney(monthly.reduce((s, m) => s + m.actualNzd, 0)), months: monthly };
  });
  const income = lines.filter((l) => l.kind === 'income');
  const expenses = lines.filter((l) => l.kind === 'expense');

  // Cost of goods sold: every sale in the year (invoice-linked ones too: their income is in Sales).
  const costs = saleLineCosts(db, userId, businessId);
  const soldLines = queryAll<{ id: string }>(
    db,
    `SELECT l.id FROM business_sale_lines l JOIN business_sales s ON s.id = l.sale_id AND s.user_id = l.user_id
     WHERE l.user_id = ? AND l.business_id = ? AND s.date >= ? AND s.date <= ?`,
    [userId, businessId, start, end],
  );
  const cogs = soldLines.some((l) => costs.get(l.id) == null) ? null : roundMoney(soldLines.reduce((s, l) => s + (costs.get(l.id) ?? 0), 0));

  const salesNzd = income.find((l) => l.role === 'sales')?.actualNzd ?? 0;
  const otherIncome = roundMoney(income.filter((l) => l.role !== 'sales').reduce((s, l) => s + l.actualNzd, 0));
  const stockPurchases = expenses.find((l) => l.role === 'stock')?.actualNzd ?? 0;
  const operating = roundMoney(expenses.filter((l) => l.role !== 'stock').reduce((s, l) => s + l.actualNzd, 0) + uncatOut);
  const gross = cogs == null ? null : roundMoney(salesNzd - cogs);
  const sumPlan = (ls: BusinessBudgetLine[]) => roundMoney(ls.reduce((s, l) => s + (l.plannedNzd ?? 0), 0));

  return {
    ok: true,
    value: {
      businessId,
      taxYear: year,
      taxYears: taxYears(db, userId, today),
      months,
      income,
      expenses,
      uncategorised: { incomeNzd: roundMoney(uncatIn), expensesNzd: roundMoney(uncatOut) },
      summary: {
        salesNzd,
        costOfGoodsSoldNzd: cogs,
        grossProfitNzd: gross,
        otherIncomeNzd: otherIncome,
        operatingExpensesNzd: operating,
        stockPurchasesNzd: stockPurchases,
        netProfitNzd: gross == null ? null : roundMoney(gross + otherIncome - operating),
        plannedIncomeNzd: sumPlan(income),
        plannedExpensesNzd: sumPlan(expenses),
      },
    },
  };
}
