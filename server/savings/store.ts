/**
 * Per-user savings goals. One user's target, balance, and deadline are never
 * written onto another user's rows. Progress figures are counted on read.
 * A goal linked to one of the user's NZD bank accounts reads "amount saved" from that
 * account's current balance (kept fresh by bank sync); otherwise it's the typed amount.
 */
import type { Database } from 'sql.js';
import type { SavingsGoal } from '../../src/types/index.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { isIsoDate, roundMoney } from '../debts/model.ts';
import { savingsGoalProgress, type SavingsGoalInput } from './model.ts';
import { coerceAkahuBalance } from '../akahu/sync.ts';

type StoredRow = {
  id: string;
  name: string;
  notes?: string | null;
  target_nzd?: number | null;
  current_amount_nzd?: number | null;
  deadline?: string | null;
  account_id?: string | null;
  created_at: string;
  updated_at: string;
  /** Joined from bank_accounts (same user) when the goal is linked. */
  acct_name?: string | null;
  acct_institution?: string | null;
  acct_balance?: unknown;
  acct_currency?: string | null;
};

const SELECT_GOALS = `SELECT g.*, a.name AS acct_name, a.institution AS acct_institution,
         a.balance AS acct_balance, a.currency AS acct_currency
  FROM savings_goals g
  LEFT JOIN bank_accounts a ON a.id = g.account_id AND a.user_id = g.user_id`;

function linkedBalance(row: StoredRow): number | null {
  if (!row.account_id || row.acct_name == null) return null;
  if ((row.acct_currency ?? 'NZD').toUpperCase() !== 'NZD') return null;
  const n = coerceAkahuBalance(row.acct_balance) ?? Number(row.acct_balance);
  return Number.isFinite(n) ? roundMoney(Math.max(0, n)) : null;
}

function present(row: StoredRow, asOf: string): SavingsGoal {
  const targetNzd = roundMoney(Number(row.target_nzd ?? 0));
  const fromAccount = linkedBalance(row);
  const currentAmountNzd = fromAccount ?? roundMoney(Number(row.current_amount_nzd ?? 0));
  const deadline = row.deadline && isIsoDate(String(row.deadline)) ? String(row.deadline) : null;
  const progress = savingsGoalProgress({ targetNzd, currentAmountNzd, deadline, asOf });
  return {
    id: row.id,
    name: row.name,
    notes: row.notes ?? null,
    targetNzd,
    currentAmountNzd,
    deadline,
    // A link to an account that was removed (or isn't NZD) falls back to the typed amount.
    accountId: fromAccount != null ? String(row.account_id) : null,
    accountName:
      fromAccount != null
        ? [row.acct_name, row.acct_institution].filter((p) => p && String(p).trim()).join(' · ')
        : null,
    amountSource: fromAccount != null ? 'account' : 'manual',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...progress,
  };
}

function loadRow(db: Database, userId: string, id: string): StoredRow | null {
  return queryOne<StoredRow>(
    db,
    `${SELECT_GOALS} WHERE g.id = ? AND g.user_id = ?`,
    [id, userId],
  );
}

export function listSavingsGoals(db: Database, userId: string, asOf: string): SavingsGoal[] {
  const rows = queryAll<StoredRow>(
    db,
    `${SELECT_GOALS}
     WHERE g.user_id = ?
     ORDER BY CASE WHEN g.deadline IS NULL OR g.deadline = '' THEN 1 ELSE 0 END,
              g.deadline ASC,
              g.name COLLATE NOCASE ASC,
              g.id ASC`,
    [userId],
  );
  return rows.map((row) => present(row, asOf));
}

export function getSavingsGoal(
  db: Database,
  userId: string,
  id: string,
  asOf: string,
): SavingsGoal | null {
  const row = loadRow(db, userId, id);
  return row ? present(row, asOf) : null;
}

/** Error text when accountId isn't one of this user's NZD bank accounts; null when fine. */
export function goalAccountProblem(db: Database, userId: string, accountId: string | null | undefined): string | null {
  if (!accountId) return null;
  const row = queryOne<{ currency?: string | null }>(
    db,
    `SELECT currency FROM bank_accounts WHERE id = ? AND user_id = ?`,
    [accountId, userId],
  );
  if (!row) return 'Unknown account';
  if ((row.currency ?? 'NZD').toUpperCase() !== 'NZD') return 'Link an NZD account';
  return null;
}

export function createSavingsGoal(
  db: Database,
  userId: string,
  input: SavingsGoalInput,
  asOf: string,
): SavingsGoal {
  const id = newId('sgoal');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO savings_goals (
       id, user_id, name, notes, target_nzd, current_amount_nzd, deadline, account_id, created_at, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      input.name,
      input.notes,
      input.targetNzd,
      input.currentAmountNzd,
      input.deadline,
      input.accountId ?? null,
      now,
      now,
    ],
  );
  return getSavingsGoal(db, userId, id, asOf)!;
}

export function updateSavingsGoal(
  db: Database,
  userId: string,
  id: string,
  patch: Partial<SavingsGoalInput>,
  asOf: string,
): SavingsGoal | null {
  const existing = loadRow(db, userId, id);
  if (!existing) return null;
  const current = present(existing, asOf);
  const storedManual = roundMoney(Number(existing.current_amount_nzd ?? 0));
  const next: SavingsGoalInput = {
    name: patch.name ?? current.name,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
    targetNzd: patch.targetNzd !== undefined ? patch.targetNzd : current.targetNzd,
    // Keep the typed amount underneath a link, so unlinking returns to it.
    currentAmountNzd: patch.currentAmountNzd !== undefined ? patch.currentAmountNzd : storedManual,
    deadline: patch.deadline !== undefined ? patch.deadline : current.deadline,
    accountId: patch.accountId !== undefined ? patch.accountId : (existing.account_id ?? null),
  };
  const now = new Date().toISOString();
  run(
    db,
    `UPDATE savings_goals
     SET name = ?, notes = ?, target_nzd = ?, current_amount_nzd = ?, deadline = ?, account_id = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [next.name, next.notes, next.targetNzd, next.currentAmountNzd, next.deadline, next.accountId, now, id, userId],
  );
  return getSavingsGoal(db, userId, id, asOf);
}

export function deleteSavingsGoal(db: Database, userId: string, id: string): boolean {
  const existing = loadRow(db, userId, id);
  if (!existing) return false;
  run(db, `DELETE FROM savings_goals WHERE id = ? AND user_id = ?`, [id, userId]);
  return true;
}
