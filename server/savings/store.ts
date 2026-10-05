/**
 * Per-user savings goals. One user's target, balance, and deadline are never
 * written onto another user's rows. Progress figures are counted on read.
 */
import type { Database } from 'sql.js';
import type { SavingsGoal } from '../../src/types/index.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { isIsoDate, roundMoney } from '../debts/model.ts';
import { savingsGoalProgress, type SavingsGoalInput } from './model.ts';

type StoredRow = {
  id: string;
  name: string;
  notes?: string | null;
  target_nzd?: number | null;
  current_amount_nzd?: number | null;
  deadline?: string | null;
  created_at: string;
  updated_at: string;
};

function present(row: StoredRow, asOf: string): SavingsGoal {
  const targetNzd = roundMoney(Number(row.target_nzd ?? 0));
  const currentAmountNzd = roundMoney(Number(row.current_amount_nzd ?? 0));
  const deadline = row.deadline && isIsoDate(String(row.deadline)) ? String(row.deadline) : null;
  const progress = savingsGoalProgress({ targetNzd, currentAmountNzd, deadline, asOf });
  return {
    id: row.id,
    name: row.name,
    notes: row.notes ?? null,
    targetNzd,
    currentAmountNzd,
    deadline,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...progress,
  };
}

function loadRow(db: Database, userId: string, id: string): StoredRow | null {
  return queryOne<StoredRow>(
    db,
    `SELECT * FROM savings_goals WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
}

export function listSavingsGoals(db: Database, userId: string, asOf: string): SavingsGoal[] {
  const rows = queryAll<StoredRow>(
    db,
    `SELECT * FROM savings_goals
     WHERE user_id = ?
     ORDER BY CASE WHEN deadline IS NULL OR deadline = '' THEN 1 ELSE 0 END,
              deadline ASC,
              name COLLATE NOCASE ASC,
              id ASC`,
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
       id, user_id, name, notes, target_nzd, current_amount_nzd, deadline, created_at, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      input.name,
      input.notes,
      input.targetNzd,
      input.currentAmountNzd,
      input.deadline,
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
  const next: SavingsGoalInput = {
    name: patch.name ?? current.name,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
    targetNzd: patch.targetNzd !== undefined ? patch.targetNzd : current.targetNzd,
    currentAmountNzd:
      patch.currentAmountNzd !== undefined ? patch.currentAmountNzd : current.currentAmountNzd,
    deadline: patch.deadline !== undefined ? patch.deadline : current.deadline,
  };
  const now = new Date().toISOString();
  run(
    db,
    `UPDATE savings_goals
     SET name = ?, notes = ?, target_nzd = ?, current_amount_nzd = ?, deadline = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [next.name, next.notes, next.targetNzd, next.currentAmountNzd, next.deadline, now, id, userId],
  );
  return getSavingsGoal(db, userId, id, asOf);
}

export function deleteSavingsGoal(db: Database, userId: string, id: string): boolean {
  const existing = loadRow(db, userId, id);
  if (!existing) return false;
  run(db, `DELETE FROM savings_goals WHERE id = ? AND user_id = ?`, [id, userId]);
  return true;
}
