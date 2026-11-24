/**
 * Budget plan totals, added up here instead of with SUM() in SQL: a plan's amount_nzd is encrypted
 * while its category isn't shared with the household (KAN-112), and SQLite would add the
 * ciphertext as 0. Rows read through queryAll come back decrypted for their owner; an amount this
 * request can't open reads as null and is left out, like a missing plan.
 */
import type { Database } from 'sql.js';
import { queryAll } from '../db/index.ts';

export type PlanTotal = { total: number; n: number };

export function sumPlanAmounts(rows: readonly { amount_nzd: unknown }[]): PlanTotal {
  let total = 0;
  let n = 0;
  for (const r of rows) {
    if (r.amount_nzd == null || r.amount_nzd === '') continue;
    const v = Number(r.amount_nzd);
    if (!Number.isFinite(v)) continue;
    total += v;
    n++;
  }
  return { total, n };
}

/** Plans for one category that overlap [start, end] (same rule as Budget). */
export function planTotalOverlapping(db: Database, userId: string, categoryId: string, start: string, end: string): PlanTotal {
  return sumPlanAmounts(
    queryAll<{ amount_nzd: unknown }>(
      db,
      `SELECT amount_nzd FROM budgets WHERE user_id = ? AND category_id = ? AND period_start <= ? AND period_end >= ?`,
      [userId, categoryId, end, start],
    ),
  );
}

/** Plans starting in month YYYY-MM, per category. */
export function planTotalsForMonth(db: Database, userId: string, month: string): Map<string, PlanTotal> {
  const by = new Map<string, { amount_nzd: unknown }[]>();
  for (const r of queryAll<{ category_id: string; amount_nzd: unknown }>(db, `SELECT category_id, amount_nzd FROM budgets WHERE user_id = ? AND substr(period_start, 1, 7) = ?`, [userId, month])) {
    const list = by.get(r.category_id) ?? [];
    list.push(r);
    by.set(r.category_id, list);
  }
  return new Map([...by].map(([id, rows]) => [id, sumPlanAmounts(rows)]));
}
