/**
 * Per-user finance data scoping.
 * First registered user (data_owner_user_id) keeps existing/backfilled rows.
 * Later users start empty and only see rows with their user_id.
 */
import type { Database } from 'sql.js';
import type { Response } from 'express';
import { getDb, queryAll, queryOne, run } from '../db/index.ts';
import { deletePropertyPhoto } from './uploads.ts';
import type { AuthedRequest } from '../middleware/requireAuth.ts';

export const SCOPED_TABLES = [
  'holdings',
  'bank_accounts',
  'transactions',
  'kiwisaver_accounts',
  'debt_people',
  'income_records',
  'income_plans',
  'dividend_events',
  'dividend_forecast_reinvest',
  'budgets',
  'valuation_snapshots',
  'budget_categories',
  'payee_settings',
  'savings_goals',
  'donations',
  'wallets',
  'pay_sources',
] as const;

export type ScopedTable = (typeof SCOPED_TABLES)[number];

/** Session user id or null. */
export function sessionUserId(req: AuthedRequest): string | null {
  return req.user?.id ?? null;
}

/**
 * Require authenticated user id. Sends 401 and returns null when missing
 * (requireAuth usually already ran).
 */
export function requireUserId(req: AuthedRequest, res: Response): string | null {
  const id = sessionUserId(req);
  if (!id) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return null;
  }
  return id;
}

export function getDataOwnerUserId(db: Database): string | null {
  const row = queryOne<{ value: string }>(
    db,
    `SELECT value FROM meta WHERE key = 'data_owner_user_id'`,
  );
  const v = row?.value?.trim();
  return v || null;
}

export async function getDataOwnerUserIdAsync(): Promise<string | null> {
  const db = await getDb();
  return getDataOwnerUserId(db);
}

/** True when this local user owns the household / Personal App shared token. */
export function isDataOwner(db: Database, userId: string): boolean {
  const owner = getDataOwnerUserId(db);
  return Boolean(owner && owner === userId);
}

/**
 * Assign any unscoped finance rows to the data owner (first signup / migration).
 * Safe to call repeatedly.
 */
export function claimUnscopedRowsForOwner(db: Database, ownerUserId: string): void {
  for (const table of SCOPED_TABLES) {
    run(db, `UPDATE ${table} SET user_id = ? WHERE user_id IS NULL OR user_id = ''`, [
      ownerUserId,
    ]);
  }
}

/** SQL fragment helpers */
export function userFilter(column = 'user_id'): string {
  return `${column} = ?`;
}


/**
 * Delete this user's scoped finance rows only (never other users' data).
 * Child tables (debt_repayments, kiwisaver_balance_history, kiwisaver_activity)
 * cascade from parents when foreign_keys are on; we still delete in a safe order
 * and remove holding photo files under data/uploads/.
 *
 * Shared (not deleted here):
 *   app_settings, price_quotes, meta
 *   (data_owner_user_id is handled by the account-delete caller)
 * budget_categories are per-user and deleted with the account.
 */
export function deleteScopedDataForUser(
  db: Database,
  userId: string,
): { tables: Record<string, number>; photosRemoved: number } {
  const tables: Record<string, number> = {};

  const photoRows = queryAll<{ photo_path: string | null }>(
    db,
    `SELECT photo_path FROM holdings WHERE user_id = ? AND photo_path IS NOT NULL AND photo_path != ''`,
    [userId],
  );
  let photosRemoved = 0;
  for (const row of photoRows) {
    const p = row.photo_path;
    if (!p || String(p).startsWith('data:')) continue;
    deletePropertyPhoto(p);
    photosRemoved += 1;
  }

  // Dependents first, then parents. debt_people cascades repayments;
  // kiwisaver_accounts cascades history + activity.
  const deleteOrder: ScopedTable[] = [
    'income_records',
    'income_plans',
    'dividend_forecast_reinvest',
    'dividend_events',
    'payee_settings',
    'savings_goals',
    'donations',
    'pay_sources',
    'budgets',
    'debt_people',
    'transactions',
    'bank_accounts',
    'kiwisaver_accounts',
    'holdings',
    'valuation_snapshots',
    'budget_categories',
    'wallets',
  ];

  const seen = new Set<string>();
  for (const table of deleteOrder) {
    seen.add(table);
    const before = queryOne<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM ${table} WHERE user_id = ?`,
      [userId],
    );
    const n = Number(before?.c ?? 0);
    if (n > 0) {
      run(db, `DELETE FROM ${table} WHERE user_id = ?`, [userId]);
    }
    tables[table] = n;
  }

  for (const table of SCOPED_TABLES) {
    if (seen.has(table)) continue;
    const before = queryOne<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM ${table} WHERE user_id = ?`,
      [userId],
    );
    const n = Number(before?.c ?? 0);
    if (n > 0) run(db, `DELETE FROM ${table} WHERE user_id = ?`, [userId]);
    tables[table] = n;
  }

  return { tables, photosRemoved };
}
