/**
 * Savings goals (KAN-20): link a goal to its savings account (amount saved = that
 * account's balance), and edit deadline / notes.
 * Run: npm run test:savings-goals
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-goal-link-'));
process.env.DATABASE_PATH = path.join(tmp, 'portfolio.db');

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
let passed = 0;
const check = (cond: unknown, msg: string) => {
  assert(cond, msg);
  passed++;
};

const { getDb, run } = await import('../db/index.ts');
const { createSavingsGoal, getSavingsGoal, goalAccountProblem, listSavingsGoals, updateSavingsGoal } = await import('./store.ts');
const { parsePatchSavingsGoal, parseCreateSavingsGoal, MAX_NOTES_LENGTH } = await import('./model.ts');

const db = await getDb();
const now = new Date().toISOString();
const asOf = '2026-10-08';
const A = 'goal_user_a';
const B = 'goal_user_b';
function account(id: string, userId: string, balance: number, currency = 'NZD') {
  run(db, `INSERT INTO bank_accounts (id, user_id, name, institution, account_type, currency, balance, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`, [
    id, userId, `${id} Saver`, 'Kiwibank', 'savings', currency, balance, now, now,
  ]);
}
account('acc_a', A, 2500);
account('acc_a_usd', A, 900, 'USD');
account('acc_b', B, 99999);

try {
  // Linked on create: amount saved is the account balance, not the typed amount.
  const created = parseCreateSavingsGoal({ name: 'House deposit', targetNzd: 10000, currentAmountNzd: 100, accountId: 'acc_a' });
  assert(created.ok, 'create parses');
  if (!created.ok) throw new Error('unreachable');
  check(goalAccountProblem(db, A, 'acc_a') === null, 'own NZD account is fine');
  const goal = createSavingsGoal(db, A, created.value, asOf);
  check(goal.currentAmountNzd === 2500 && goal.amountSource === 'account', 'amount saved = account balance');
  check(goal.accountId === 'acc_a' && goal.accountName === 'acc_a Saver · Kiwibank', 'account named');
  check(goal.percentComplete === 25, 'progress uses the balance');

  // Balance moves (e.g. bank sync) → goal follows on next read.
  run(db, `UPDATE bank_accounts SET balance = 4000 WHERE id = 'acc_a'`);
  check(getSavingsGoal(db, A, goal.id, asOf)?.currentAmountNzd === 4000, 'follows the balance');

  // Refused links.
  check(goalAccountProblem(db, A, 'acc_b') === 'Unknown account', 'another user’s account refused');
  check(goalAccountProblem(db, A, 'acc_a_usd') === 'Link an NZD account', 'non-NZD account refused');

  // Edit deadline + notes; they persist.
  const patch = parsePatchSavingsGoal({ deadline: '2027-06-30', notes: '  Kiwibank Notice Saver  ' });
  assert(patch.ok, 'patch parses');
  if (!patch.ok) throw new Error('unreachable');
  updateSavingsGoal(db, A, goal.id, patch.value, asOf);
  const edited = getSavingsGoal(db, A, goal.id, asOf)!;
  check(edited.deadline === '2027-06-30' && edited.notes === 'Kiwibank Notice Saver', 'deadline + notes saved (trimmed)');
  check(edited.daysRemaining === 265 && edited.requiredMonthlySavingNzd != null, 'deadline drives the pace');
  check(edited.accountId === 'acc_a', 'link kept when editing other fields');
  const cleared = parsePatchSavingsGoal({ deadline: '', notes: '' });
  if (!cleared.ok) throw new Error('clear parses');
  const after = updateSavingsGoal(db, A, goal.id, cleared.value, asOf)!;
  check(after.deadline === null && after.notes === null && after.daysRemaining === null, 'deadline + notes cleared');
  check(!parsePatchSavingsGoal({ notes: 'x'.repeat(MAX_NOTES_LENGTH + 1) }).ok, 'over-long notes refused');
  check(!parsePatchSavingsGoal({ deadline: '2027-02-30' }).ok, 'impossible date refused');

  // Unlink → back to the typed amount kept underneath.
  const unlink = parsePatchSavingsGoal({ accountId: null });
  if (!unlink.ok) throw new Error('unlink parses');
  const manual = updateSavingsGoal(db, A, goal.id, unlink.value, asOf)!;
  check(manual.amountSource === 'manual' && manual.currentAmountNzd === 100 && manual.accountId === null, 'unlink returns to typed amount');

  // A linked account that disappears falls back to the typed amount instead of breaking.
  const relink = parsePatchSavingsGoal({ accountId: 'acc_a' });
  if (!relink.ok) throw new Error('relink parses');
  updateSavingsGoal(db, A, goal.id, relink.value, asOf);
  run(db, `DELETE FROM bank_accounts WHERE id = 'acc_a'`);
  const orphan = listSavingsGoals(db, A, asOf)[0];
  check(orphan.amountSource === 'manual' && orphan.currentAmountNzd === 100 && orphan.accountId === null, 'deleted account → typed amount');

  // User B never sees A's goal or account.
  check(listSavingsGoals(db, B, asOf).length === 0, 'goals stay per user');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`savings goal account link: ${passed} checks passed`);
