/**
 * Savings goals for the signed-in user (NZD, Pacific/Auckland).
 * Stored: name, target, current amount, optional deadline.
 * Counted on read: remaining, percent complete, required weekly and monthly
 * saving, and estimated completion. Formulas: server/savings/model.ts.
 * A goal is not a bank balance and is not added to net worth.
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import { parseCreateSavingsGoal, parsePatchSavingsGoal } from '../savings/model.ts';
import {
  createSavingsGoal,
  goalAccountProblem,
  deleteSavingsGoal,
  getSavingsGoal,
  listSavingsGoals,
  updateSavingsGoal,
} from '../savings/store.ts';

const router = Router();

router.use((req, res, next) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  (req as AuthedRequest & { scopeUserId: string }).scopeUserId = userId;
  next();
});

function uid(req: { scopeUserId?: string; user?: { id?: string } | null }): string {
  return (req as AuthedRequest & { scopeUserId?: string }).scopeUserId
    || (req as AuthedRequest).user?.id
    || '';
}

router.get('/', async (req, res) => {
  const db = await getDb();
  res.json(listSavingsGoals(db, uid(req), aucklandToday()));
});

router.post('/', async (req, res) => {
  const parsed = parseCreateSavingsGoal(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const accountProblem = goalAccountProblem(db, uid(req), parsed.value.accountId);
  if (accountProblem) {
    res.status(400).json({ error: accountProblem });
    return;
  }
  const saved = createSavingsGoal(db, uid(req), parsed.value, aucklandToday());
  res.status(201).json(saved);
});

router.get('/:id', async (req, res) => {
  const db = await getDb();
  const goal = getSavingsGoal(db, uid(req), req.params.id, aucklandToday());
  if (!goal) {
    res.status(404).json({ error: 'Savings goal not found' });
    return;
  }
  res.json(goal);
});

router.patch('/:id', async (req, res) => {
  const parsed = parsePatchSavingsGoal(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const accountProblem = goalAccountProblem(db, uid(req), parsed.value.accountId);
  if (accountProblem) {
    res.status(400).json({ error: accountProblem });
    return;
  }
  const saved = updateSavingsGoal(db, uid(req), req.params.id, parsed.value, aucklandToday());
  if (!saved) {
    res.status(404).json({ error: 'Savings goal not found' });
    return;
  }
  res.json(saved);
});

router.delete('/:id', async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const removed = deleteSavingsGoal(db, uid(req), id);
  if (!removed) {
    res.status(404).json({ error: 'Savings goal not found' });
    return;
  }
  res.json({ ok: true, id });
});

export default router;
