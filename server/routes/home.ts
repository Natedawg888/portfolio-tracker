/**
 * Home screen month snapshot.
 * GET /api/home/snapshot
 * GET /api/home/snapshot?month=YYYY-MM
 *
 * Auth: same session cookie as the rest of /api (401 when signed out).
 * Omitted month is the current Pacific/Auckland calendar month.
 * Amounts are NZD. savingsRate is a fraction of income (0.25 = 25%), or null
 * when income is zero or negative.
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { currentYearMonth, homeMonthSnapshot, parseYearMonth } from '../budget/homeSnapshot.ts';

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

router.get('/snapshot', async (req, res) => {
  const raw = req.query.month;
  const yearMonth = raw == null || raw === ''
    ? currentYearMonth()
    : parseYearMonth(raw);
  if (!yearMonth) {
    res.status(400).json({ error: 'month must be YYYY-MM' });
    return;
  }
  const db = await getDb();
  const snapshot = homeMonthSnapshot(db, uid(req), yearMonth);
  if (!snapshot) {
    res.status(400).json({ error: 'month must be YYYY-MM' });
    return;
  }
  res.json(snapshot);
});

export default router;
