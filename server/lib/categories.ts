/**
 * Per-user budget categories.
 * Well-known slugs (cat-income, cat-debt, …) stay stable; row ids are unique per user.
 * Legacy data-owner rows keep original ids (slug === id); later users get `${slug}__${userId}`.
 */
import type { Database } from 'sql.js';
import { queryOne, run } from '../db/index.ts';
import { getDataOwnerUserId } from './userScope.ts';

export type SeedCategory = {
  slug: string;
  name: string;
  type: 'spending' | 'income' | 'transfer_out' | 'transfer_in';
  sortOrder: number;
};

/** Canonical seed list (slug === historical global id). */
export const DEFAULT_CATEGORY_SEEDS: SeedCategory[] = [
  { slug: 'cat-income', name: 'Income', type: 'income', sortOrder: 0 },
  { slug: 'cat-income-salary', name: 'Salary', type: 'income', sortOrder: 1 },
  { slug: 'cat-income-mining', name: 'Mining', type: 'income', sortOrder: 2 },
  { slug: 'cat-income-dividends', name: 'Dividends & interest', type: 'income', sortOrder: 3 },
  { slug: 'cat-income-other', name: 'Other income', type: 'income', sortOrder: 4 },
  { slug: 'cat-housing', name: 'Housing', type: 'spending', sortOrder: 10 },
  { slug: 'cat-food', name: 'Food & groceries', type: 'spending', sortOrder: 20 },
  { slug: 'cat-eating-out', name: 'Eating out', type: 'spending', sortOrder: 25 },
  { slug: 'cat-transport', name: 'Transport', type: 'spending', sortOrder: 30 },
  { slug: 'cat-utilities', name: 'Utilities', type: 'spending', sortOrder: 40 },
  { slug: 'cat-health', name: 'Health', type: 'spending', sortOrder: 50 },
  { slug: 'cat-entertainment', name: 'Entertainment', type: 'spending', sortOrder: 60 },
  { slug: 'cat-subscriptions', name: 'Subscriptions', type: 'spending', sortOrder: 70 },
  { slug: 'cat-investments', name: 'Investments', type: 'transfer_out', sortOrder: 80 },
  { slug: 'cat-debt', name: 'Debt', type: 'spending', sortOrder: 85 },
  { slug: 'cat-charity', name: 'Charity', type: 'spending', sortOrder: 87 },
  { slug: 'cat-other', name: 'Other', type: 'spending', sortOrder: 90 },
  { slug: 'cat-transfer-out', name: 'Transfer out', type: 'transfer_out', sortOrder: 95 },
  { slug: 'cat-transfer-in', name: 'Transfer in', type: 'transfer_in', sortOrder: 96 },
];

export const INCOME_SLUG = 'cat-income';
export const INCOME_MINING_SLUG = 'cat-income-mining';
export const INCOME_DIVIDENDS_SLUG = 'cat-income-dividends';
export const DEBT_SLUG = 'cat-debt';
export const CHARITY_SLUG = 'cat-charity';

/** Deterministic id for a user's seeded category (non-owner / fresh rows). */
export function categoryIdForUser(userId: string, slug: string): string {
  return `${slug}__${userId}`;
}

/**
 * Resolve the row id for a well-known slug belonging to this user.
 * Prefers slug match; falls back to legacy id === slug for the data owner.
 */
export function resolveCategoryId(
  db: Database,
  userId: string,
  slug: string,
): string | null {
  const bySlug = queryOne<{ id: string }>(
    db,
    `SELECT id FROM budget_categories WHERE user_id = ? AND slug = ? LIMIT 1`,
    [userId, slug],
  );
  if (bySlug?.id) return String(bySlug.id);

  const byId = queryOne<{ id: string }>(
    db,
    `SELECT id FROM budget_categories WHERE user_id = ? AND id = ? LIMIT 1`,
    [userId, slug],
  );
  if (byId?.id) return String(byId.id);

  return null;
}

/** Like resolveCategoryId but returns slug itself as last-resort soft fallback (never cross-user). */
export function resolveCategoryIdOrSlug(
  db: Database,
  userId: string,
  slug: string,
): string {
  return resolveCategoryId(db, userId, slug) ?? slug;
}

/**
 * Ensure this user has a full default category set.
 * - First/data-owner: claim any unscoped (NULL user_id) rows, set slug, fill missing seeds with legacy ids.
 * - Later users: insert `${slug}__${userId}` rows (idempotent).
 */
export function seedCategoriesForUser(db: Database, userId: string): void {
  const ownerId = getDataOwnerUserId(db);
  const isOwner = Boolean(ownerId && ownerId === userId);

  if (isOwner) {
    // Claim legacy global rows
    run(
      db,
      `UPDATE budget_categories
       SET user_id = ?, slug = COALESCE(NULLIF(slug, ''), id)
       WHERE user_id IS NULL OR user_id = ''`,
      [userId],
    );
    // Also ensure slug on already-owned rows
    run(
      db,
      `UPDATE budget_categories
       SET slug = COALESCE(NULLIF(slug, ''), id)
       WHERE user_id = ? AND (slug IS NULL OR slug = '')`,
      [userId],
    );
  }

  for (const seed of DEFAULT_CATEGORY_SEEDS) {
    const existing = resolveCategoryId(db, userId, seed.slug);
    if (existing) {
      // Keep type/name in sync for well-known seeds
      const isIncome = seed.type === 'income' ? 1 : 0;
      run(
        db,
        `UPDATE budget_categories
         SET name = ?, type = ?, is_income = ?, sort_order = ?, slug = ?
         WHERE id = ? AND user_id = ?`,
        [seed.name, seed.type, isIncome, seed.sortOrder, seed.slug, existing, userId],
      );
      continue;
    }
    const id = isOwner ? seed.slug : categoryIdForUser(userId, seed.slug);
    const isIncome = seed.type === 'income' ? 1 : 0;
    run(
      db,
      `INSERT OR IGNORE INTO budget_categories
         (id, user_id, slug, name, parent_id, colour, type, is_income, sort_order)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
      [id, userId, seed.slug, seed.name, seed.type, isIncome, seed.sortOrder],
    );
  }
}

/** True when a category id/slug refers to Debt for charting (legacy or per-user). */
export function isDebtCategoryRef(
  categoryId: string | null | undefined,
  debtCategoryId: string | null | undefined,
): boolean {
  if (!categoryId) return false;
  if (debtCategoryId && categoryId === debtCategoryId) return true;
  if (categoryId === DEBT_SLUG) return true;
  if (categoryId.startsWith(`${DEBT_SLUG}__`)) return true;
  return false;
}
