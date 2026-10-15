/**
 * Income rows that mirror money recorded elsewhere in the app — invoice payments
 * (KAN-71), rental income (KAN-66) and payslip net pay (KAN-78) — are linked to the bank deposit for the same
 * money, so the deposit (bank sync or import) isn't counted as income a second time.
 */
import type { Database } from 'sql.js';
import { queryAll, run } from '../db/index.ts';

const BANK_MATCH_DAYS = 10;

function dayDiff(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

function shift(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * A deposit matches when it is a credit of the same amount within 10 days and isn't
 * already linked to any income row. The closest date wins. Returns how many were linked.
 */
export function linkMirroredIncomeToBankCredits(db: Database, userId: string): number {
  const open = queryAll<{ id: string; date: string; amount_nzd: number }>(
    db,
    `SELECT id, date, amount_nzd FROM income_records
     WHERE user_id = ? AND (invoice_payment_id IS NOT NULL OR rental_entry_id IS NOT NULL OR payslip_id IS NOT NULL) AND transaction_id IS NULL
     ORDER BY date, id`,
    [userId],
  );
  let linked = 0;
  for (const rec of open) {
    const candidates = queryAll<{ id: string; date: string }>(
      db,
      `SELECT t.id, t.date FROM transactions t
       WHERE t.user_id = ? AND t.amount > 0 AND ABS(t.amount - ?) < 0.005
         AND t.date >= ? AND t.date <= ?
         AND NOT EXISTS (SELECT 1 FROM income_records r WHERE r.user_id = t.user_id AND r.transaction_id = t.id)`,
      [userId, rec.amount_nzd, shift(rec.date, -BANK_MATCH_DAYS), shift(rec.date, BANK_MATCH_DAYS)],
    );
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => dayDiff(a.date, rec.date) - dayDiff(b.date, rec.date) || a.id.localeCompare(b.id));
    run(db, `UPDATE income_records SET transaction_id = ? WHERE id = ? AND user_id = ?`, [candidates[0].id, rec.id, userId]);
    linked += 1;
  }
  return linked;
}
