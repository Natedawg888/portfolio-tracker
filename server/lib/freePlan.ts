/**
 * Free-plan caps. Existing rows stay readable; only creating another one is refused.
 * Plus, Pro and Business have no cap. Net worth is not on Free at all.
 */
import type { Response } from 'express';
import type { Database } from 'sql.js';
import { queryOne } from '../db/index.ts';
import { planOf } from './entitlements.ts';

export const FREE_BANK_ACCOUNTS = 1;

export function isFreePlan(db: Database, userId: string): boolean {
  return planOf(db, userId) === 'free';
}

export function sendPlanLimit(res: Response, error: string): void {
  res.status(402).json({ code: 'PLAN_LIMIT', error });
}

export function freeBankAccountCount(db: Database, userId: string): number {
  return Number(queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM bank_accounts WHERE user_id = ?`, [userId])?.c ?? 0);
}
