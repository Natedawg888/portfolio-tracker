/**
 * Mirror a paid dividend into that user's Budgeting income.
 * NZD amount uses the same rule as dividend totals: net cash times the FX rate they recorded.
 * Foreign payments with no rate are left out. Imputation credits are not cash.
 * One income row per dividend id, for this user only.
 */
import type { Database } from 'sql.js';
import { newId, queryOne, run } from '../db/index.ts';
import { INCOME_DIVIDENDS_SLUG, resolveCategoryIdOrSlug, seedCategoriesForUser } from '../lib/categories.ts';
import { incomeCategoryForPayee } from '../payees/store.ts';
import { netInNzd, todayAucklandYmd, type DividendRecord } from './model.ts';

export const DIVIDEND_INCOME_NOTE =
  'Personal record of a dividend you entered. Totals use your amounts and the FX rates you record. Not financial advice.';

export function removeDividendIncome(db: Database, userId: string, dividendId: string): void {
  if (!userId || !dividendId) return;
  run(
    db,
    `DELETE FROM income_records WHERE user_id = ? AND dividend_event_id = ?`,
    [userId, dividendId],
  );
}

function incomeCategoryId(db: Database, userId: string, payee: string): string {
  seedCategoriesForUser(db, userId);
  const saved = payee ? incomeCategoryForPayee(db, userId, payee) : null;
  if (saved) return saved;
  return resolveCategoryIdOrSlug(db, userId, INCOME_DIVIDENDS_SLUG);
}

/**
 * Create, update, or remove the income row that matches this dividend.
 * Reinvestment is recorded on the dividend and does not change the net used by dividend totals.
 */
export function syncDividendIncome(db: Database, userId: string, event: DividendRecord): void {
  const today = todayAucklandYmd();
  const netNzd = netInNzd(event.netDividend, event.fxRateToNzd);
  const paid = event.paymentDate <= today;
  if (!paid || netNzd == null || !(netNzd > 0)) {
    removeDividendIncome(db, userId, event.id);
    return;
  }
  const payee = event.companyName.trim() || (event.symbol ?? '').trim();
  const categoryId = incomeCategoryId(db, userId, payee);
  const now = new Date().toISOString();
  const existing = queryOne<{ id: string }>(
    db,
    `SELECT id FROM income_records WHERE user_id = ? AND dividend_event_id = ?`,
    [userId, event.id],
  );
  if (existing) {
    run(
      db,
      `UPDATE income_records
       SET date = ?, amount_nzd = ?, kind = 'cash', description = ?, category_id = ?, notes = ?,
           account_id = NULL, transaction_id = NULL, crypto_asset = NULL, crypto_amount = NULL, holding_id = NULL
       WHERE id = ? AND user_id = ? AND dividend_event_id = ?`,
      [event.paymentDate, netNzd, payee, categoryId, DIVIDEND_INCOME_NOTE, existing.id, userId, event.id],
    );
    return;
  }
  run(
    db,
    `INSERT INTO income_records (
       id, user_id, date, amount_nzd, kind, description, account_id, category_id,
       crypto_asset, crypto_amount, holding_id, transaction_id, notes, created_at, dividend_event_id
     ) VALUES (?, ?, ?, ?, 'cash', ?, NULL, ?, NULL, NULL, NULL, NULL, ?, ?, ?)`,
    [newId('inc'), userId, event.paymentDate, netNzd, payee, categoryId, DIVIDEND_INCOME_NOTE, now, event.id],
  );
}
