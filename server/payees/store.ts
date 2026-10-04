/**
 * Payee settings for one user.
 * A payee is a name they already used: income description, transaction description
 * or merchant, or the company on a dividend they recorded.
 * The only setting stored is an existing budget category. No new categories are created.
 */
import type { Database } from 'sql.js';
import { newId, queryAll, queryOne, run } from '../db/index.ts';

export type PayeeSetting = {
  name: string;
  categoryId: string | null;
  categoryName: string | null;
};

type WriteResult =
  | { ok: true; setting: PayeeSetting }
  | { ok: false; status: number; error: string };

export function normalizePayeeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function payeeKey(name: string): string {
  return normalizePayeeName(name).toLowerCase();
}

type CategoryRow = { id: string; name: string; type?: string | null; is_income?: number | null };

function ownedCategory(db: Database, userId: string, categoryId: string): CategoryRow | null {
  const row = queryOne<CategoryRow>(
    db,
    `SELECT id, name, type, is_income FROM budget_categories WHERE id = ? AND user_id = ?`,
    [categoryId, userId],
  );
  return row?.id ? row : null;
}

export function categoryIsIncome(row: { type?: string | null; is_income?: number | null }): boolean {
  if (typeof row.type === 'string' && row.type.length > 0) return row.type === 'income';
  return Number(row.is_income) === 1;
}

/** Saved category id for this payee, when it still belongs to the user. */
export function categoryForPayee(db: Database, userId: string, name: string): string | null {
  const key = payeeKey(name);
  if (!key) return null;
  const row = queryOne<{ category_id?: string | null }>(
    db,
    `SELECT category_id FROM payee_settings WHERE user_id = ? AND name_key = ?`,
    [userId, key],
  );
  const categoryId = row?.category_id ? String(row.category_id) : '';
  if (!categoryId) return null;
  const owned = ownedCategory(db, userId, categoryId);
  return owned ? owned.id : null;
}

/** Income-category id saved for this payee, or null when the saved category is not income. */
export function incomeCategoryForPayee(db: Database, userId: string, name: string): string | null {
  const categoryId = categoryForPayee(db, userId, name);
  if (!categoryId) return null;
  const owned = ownedCategory(db, userId, categoryId);
  if (!owned || !categoryIsIncome(owned)) return null;
  return owned.id;
}

function usedPayeeNames(db: Database, userId: string): string[] {
  const rows = queryAll<{ name?: string | null }>(
    db,
    `SELECT description AS name FROM income_records
     WHERE user_id = ? AND description IS NOT NULL AND TRIM(description) != ''
     UNION ALL
     SELECT company_name AS name FROM dividend_events
     WHERE user_id = ? AND company_name IS NOT NULL AND TRIM(company_name) != ''
     UNION ALL
     SELECT description AS name FROM transactions
     WHERE user_id = ? AND description IS NOT NULL AND TRIM(description) != ''
     UNION ALL
     SELECT merchant AS name FROM transactions
     WHERE user_id = ? AND merchant IS NOT NULL AND TRIM(merchant) != ''`,
    [userId, userId, userId, userId],
  );
  return rows.map((row) => String(row.name ?? ''));
}

export function listPayeeSettings(db: Database, userId: string): PayeeSetting[] {
  const byKey = new Map<string, string>();
  for (const raw of usedPayeeNames(db, userId)) {
    const name = normalizePayeeName(raw);
    const key = payeeKey(name);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, name);
  }
  const saved = queryAll<{ name: string; name_key: string; category_id?: string | null }>(
    db,
    `SELECT name, name_key, category_id FROM payee_settings WHERE user_id = ?`,
    [userId],
  );
  for (const row of saved) {
    const key = String(row.name_key || payeeKey(row.name));
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, normalizePayeeName(String(row.name)));
  }
  const settings = saved.map((row) => ({
    key: String(row.name_key || payeeKey(row.name)),
    categoryId: row.category_id ? String(row.category_id) : null,
  }));
  const categoryByKey = new Map(settings.map((row) => [row.key, row.categoryId]));
  const out: PayeeSetting[] = [];
  for (const [key, name] of byKey) {
    const categoryId = categoryByKey.get(key) ?? null;
    const owned = categoryId ? ownedCategory(db, userId, categoryId) : null;
    out.push({
      name,
      categoryId: owned ? owned.id : null,
      categoryName: owned ? String(owned.name) : null,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'en-NZ'));
  return out;
}

export function savePayeeSetting(
  db: Database,
  userId: string,
  rawName: unknown,
  rawCategoryId: unknown,
): WriteResult {
  if (typeof rawName !== 'string') {
    return { ok: false, status: 400, error: 'Payee name is required.' };
  }
  const name = normalizePayeeName(rawName);
  const key = payeeKey(name);
  if (!key) return { ok: false, status: 400, error: 'Payee name is required.' };
  if (name.length > 200) {
    return { ok: false, status: 400, error: 'Payee name must be 200 characters or fewer.' };
  }
  let categoryId: string | null = null;
  if (rawCategoryId != null && rawCategoryId !== '') {
    if (typeof rawCategoryId !== 'string') {
      return { ok: false, status: 400, error: 'Category must be one you already have, or empty.' };
    }
    const owned = ownedCategory(db, userId, rawCategoryId.trim());
    if (!owned) {
      return { ok: false, status: 400, error: 'Category must be one you already have.' };
    }
    categoryId = owned.id;
  }
  const now = new Date().toISOString();
  const existing = queryOne<{ id: string }>(
    db,
    `SELECT id FROM payee_settings WHERE user_id = ? AND name_key = ?`,
    [userId, key],
  );
  if (existing) {
    run(
      db,
      `UPDATE payee_settings SET name = ?, category_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      [name, categoryId, now, existing.id, userId],
    );
  } else {
    run(
      db,
      `INSERT INTO payee_settings (id, user_id, name, name_key, category_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId('payee'), userId, name, key, categoryId, now, now],
    );
  }
  const setting = listPayeeSettings(db, userId).find((row) => payeeKey(row.name) === key);
  if (!setting) return { ok: false, status: 500, error: 'Payee settings were not saved.' };
  return { ok: true, setting };
}
