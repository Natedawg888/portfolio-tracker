/**
 * Per-user budget categories.
 * Well-known slugs (cat-income, cat-debt, …) stay stable; row ids are unique per user.
 * Legacy data-owner rows keep original ids (slug === id); later users get `${slug}__${userId}`.
 */
import type { Database } from 'sql.js';
import { queryOne, run } from '../db/index.ts';
import { getDataOwnerUserId } from './userScope.ts';
import { isBuiltInCategory } from '../../src/lib/categoryManagerView.ts';

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
/** Rental income / expenses (KAN-66). Added the first time a user records rental money, not seeded for everyone. */
export const RENTAL_INCOME_SLUG = 'cat-income-rental';
export const RENTAL_EXPENSES_SLUG = 'cat-rental';

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

/**
 * This user's category for a well-known slug that is not in the default seeds,
 * created on first use. A user who renames it keeps their name.
 */
export function ensureCategory(
  db: Database,
  userId: string,
  seed: { slug: string; name: string; type: 'income' | 'spending'; sortOrder: number },
): string {
  const existing = resolveCategoryId(db, userId, seed.slug);
  if (existing) return existing;
  const id = categoryIdForUser(userId, seed.slug);
  run(
    db,
    `INSERT OR IGNORE INTO budget_categories
       (id, user_id, slug, name, parent_id, colour, type, is_income, sort_order)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
    [id, userId, seed.slug, seed.name, seed.type, seed.type === 'income' ? 1 : 0, seed.sortOrder],
  );
  return id;
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

  const deleted = deletedDefaultSlugs(db, userId);
  for (const seed of DEFAULT_CATEGORY_SEEDS) {
    const existing = resolveCategoryId(db, userId, seed.slug);
    if (existing) {
      // The user's name (and type, for categories the app doesn't look up by slug) stands.
      if (isBuiltInCategory(seed.slug)) {
        run(
          db,
          `UPDATE budget_categories SET type = ?, is_income = ?, sort_order = ?, slug = ? WHERE id = ? AND user_id = ?`,
          [seed.type, seed.type === 'income' ? 1 : 0, seed.sortOrder, seed.slug, existing, userId],
        );
      } else {
        run(db, `UPDATE budget_categories SET sort_order = ?, slug = ? WHERE id = ? AND user_id = ?`, [
          seed.sortOrder,
          seed.slug,
          existing,
          userId,
        ]);
      }
      continue;
    }
    // A default the user deleted stays deleted.
    if (deleted.has(seed.slug)) continue;
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

function readPrefs(db: Database, userId: string): Record<string, unknown> {
  const row = queryOne<{ preferences_json: string | null }>(db, `SELECT preferences_json FROM users WHERE id = ?`, [userId]);
  try {
    const parsed = JSON.parse(row?.preferences_json ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Default category slugs this user deleted (users.preferences_json.deletedCategorySlugs). */
export function deletedDefaultSlugs(db: Database, userId: string): Set<string> {
  const list = readPrefs(db, userId).deletedCategorySlugs;
  return new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []);
}

/** Remember a deleted default so seeding doesn't add it back. Other slugs are ignored. */
export function rememberDeletedDefault(db: Database, userId: string, slug: string | null | undefined): void {
  if (!slug || !DEFAULT_CATEGORY_SEEDS.some((seed) => seed.slug === slug)) return;
  const prefs = readPrefs(db, userId);
  const next = deletedDefaultSlugs(db, userId);
  if (next.has(slug)) return;
  next.add(slug);
  prefs.deletedCategorySlugs = [...next];
  run(db, `UPDATE users SET preferences_json = ?, updated_at = ? WHERE id = ?`, [JSON.stringify(prefs), new Date().toISOString(), userId]);
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
