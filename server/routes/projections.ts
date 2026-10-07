/**
 * Forward net worth and savings for the signed-in user.
 * GET /api/projections
 *   ?months=12
 *   &savingWindowMonths=3
 *   &annualReturnPercent=5
 *   &monthlySavingNzd=500
 *
 * Auth: same session cookie as the rest of /api (401 when signed out).
 * Amounts are NZD, rounded to cents. Dates are YYYY-MM-DD in Pacific/Auckland.
 * Formulas and assumption sources: server/projections/model.ts.
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import { parseProjectionQuery } from '../projections/params.ts';
import { loadUserProjection } from '../projections/load.ts';

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
  const parsed = parseProjectionQuery(req.query as Record<string, unknown>);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const projection = await loadUserProjection(db, uid(req), parsed.value, aucklandToday());
  res.json(projection);
});

export default router;
