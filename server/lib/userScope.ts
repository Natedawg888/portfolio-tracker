/**
 * Per-user finance data scoping.
 * First registered user (data_owner_user_id) keeps existing/backfilled rows.
 * Later users start empty and only see rows with their user_id.
 */
import type { Database } from 'sql.js';
import type { Response } from 'express';
import { getDb, queryAll, queryOne, run } from '../db/index.ts';
import {
  deleteBusinessLogo,
  deleteCharityReceipt,
  deleteEmployeeContract,
  deletePayslipFile,
  deletePropertyPhoto,
  deleteStockPhoto,
  deleteWarrantyReceipt,
} from './uploads.ts';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { priceContributor } from '../shopping/prices.ts';
import { removeUserFromHouseholds } from '../households/store.ts';
import { BUSINESS_STOCK_TABLES } from '../business/stockTables.ts';
import { stockPhotoPaths } from '../business/stock.ts';

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
  'business_profiles',
  'businesses',
  'business_assets',
  'business_asset_movements',
  'business_employees',
  ...BUSINESS_STOCK_TABLES,
  'business_meetings',
  'business_meeting_reminders',
  'invoice_clients',
  'invoices',
  'invoice_lines',
  'invoice_payments',
  'invoice_sends',
  'recurring_items',
  'recurring_dismissed',
  'warranties',
  'rental_properties',
  'rental_entries',
  'rental_rooms',
  'rental_tenancies',
  'shopping_lists',
  'shopping_items',
  'shopping_prefs',
  'payslips',
  'vehicles',
  'crypto_txns',
  'crypto_import_refs',
  'crypto_settings',
  'defi_positions',
  'bonds',
  'bond_coupons',
  'commodities',
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
 * Child tables (debt_repayments, kiwisaver_balance_history, kiwisaver_activity) are
 * deleted explicitly (foreign_keys is off, so ON DELETE CASCADE never fires), then
 * parents in a safe order; holding photo and receipt files under data/uploads/ go too.
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

  // Warranty receipt files (KAN-61).
  for (const row of queryAll<{ p: string | null }>(
    db,
    `SELECT receipt_path AS p FROM warranties WHERE user_id = ? AND receipt_path IS NOT NULL`,
    [userId],
  )) {
    deleteWarrantyReceipt(row.p);
  }

  // Business logos (KAN-84).
  for (const row of queryAll<{ p: string | null }>(db, `SELECT logo_path AS p FROM businesses WHERE user_id = ? AND logo_path IS NOT NULL`, [userId])) {
    deleteBusinessLogo(row.p);
  }

  // Employee contracts.
  for (const row of queryAll<{ p: string | null }>(db, `SELECT contract_path AS p FROM business_employees WHERE user_id = ? AND contract_path IS NOT NULL`, [userId])) {
    deleteEmployeeContract(row.p);
  }

  // Stock item photos (KAN-107).
  for (const p of stockPhotoPaths(db, userId, null)) deleteStockPhoto(p);

  // Uploaded payslips (KAN-78).
  for (const row of queryAll<{ p: string | null }>(db, `SELECT file_path AS p FROM payslips WHERE user_id = ? AND file_path IS NOT NULL`, [userId])) {
    deletePayslipFile(row.p);
  }

  // Receipt files attached to transactions (e.g. donation receipts for IR526).
  for (const row of queryAll<{ p: string | null }>(
    db,
    `SELECT receipt_path AS p FROM transactions WHERE user_id = ? AND receipt_path IS NOT NULL`,
    [userId],
  )) {
    deleteCharityReceipt(row.p);
  }

  // Dependents first, then parents. debt_people cascades repayments;
  // kiwisaver_accounts cascades history + activity.
  const deleteOrder: ScopedTable[] = [
    'commodities',
    'bond_coupons',
    'bonds',
    'crypto_txns',
    'crypto_import_refs',
    'crypto_settings',
    'defi_positions',
    'vehicles',
    'payslips',
    'shopping_items',
    'shopping_lists',
    'shopping_prefs',
    'rental_tenancies',
    'rental_rooms',
    'rental_entries',
    'rental_properties',
    'warranties',
    'recurring_dismissed',
    'recurring_items',
    'invoice_sends',
    'invoice_payments',
    'invoice_lines',
    'invoices',
    'invoice_clients',
    'business_asset_movements',
    'business_assets',
    'business_employees',
    ...BUSINESS_STOCK_TABLES,
    'business_meeting_reminders',
    'business_meetings',
    'businesses',
    'business_profiles',
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

  // Child rows without a user_id. SQLite only cascades with PRAGMA foreign_keys on, which this
  // database doesn't use, so remove them explicitly before their parents.
  run(db, `DELETE FROM debt_repayments WHERE person_id IN (SELECT id FROM debt_people WHERE user_id = ?)`, [userId]);
  run(db, `DELETE FROM kiwisaver_activity WHERE account_id IN (SELECT id FROM kiwisaver_accounts WHERE user_id = ?)`, [userId]);
  run(db, `DELETE FROM kiwisaver_balance_history WHERE account_id IN (SELECT id FROM kiwisaver_accounts WHERE user_id = ?)`, [userId]);

  // Household (KAN-77): leave it, or hand an owned household on (or delete it).
  removeUserFromHouseholds(db, userId);

  // Supermarket prices this person shared (KAN-74): the shared table holds a pseudonym, not the id.
  run(db, `DELETE FROM price_observations WHERE contributor = ?`, [priceContributor(userId)]);

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
