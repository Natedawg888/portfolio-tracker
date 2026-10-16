/**
 * Bonds and term deposits for the signed-in user (KAN-80).
 *   GET    /                        holdings, totals, coupon calendar and alerts (Plus), TD accounts to link
 *   POST   /                        bond fields (see parseBond)
 *   PUT    /:id
 *   DELETE /:id                     also its coupon changes and Income rows; bank transactions stay
 *   PUT    /:id/coupons/:date       { skipped?, netAmount? }  Plus
 *   POST   /:id/repaid              { on? }  matured and paid back
 *   POST   /:id/rollover            new terms; closes this one as rolled
 */
import { Router, type Request, type Response } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { createBond, deleteBond, listBonds, markRepaid, rollOver, setCoupon, syncBondIncome, updateBond } from '../bonds/store.ts';

const router = Router();

router.use((req, res, next) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  (req as AuthedRequest & { scopeUserId: string }).scopeUserId = userId;
  next();
});

function uid(req: Request): string {
  return (req as AuthedRequest & { scopeUserId?: string }).scopeUserId || (req as AuthedRequest).user?.id || '';
}

function send<T>(res: Response, r: { ok: true; value: T } | { ok: false; status: number; error: string; code?: string }, created = false) {
  if (!r.ok) res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  else res.status(created ? 201 : 200).json(r.value);
}

router.get('/', async (req, res) => {
  const db = await getDb();
  syncBondIncome(db, uid(req));
  res.json(listBonds(db, uid(req)));
});
router.post('/', async (req, res) => send(res, await createBond(await getDb(), uid(req), req.body), true));
router.put('/:id', async (req, res) => send(res, await updateBond(await getDb(), uid(req), req.params.id, req.body)));
router.delete('/:id', async (req, res) => send(res, deleteBond(await getDb(), uid(req), req.params.id)));
router.put('/:id/coupons/:date', async (req, res) => send(res, setCoupon(await getDb(), uid(req), req.params.id, req.params.date, req.body)));
router.post('/:id/repaid', async (req, res) => send(res, markRepaid(await getDb(), uid(req), req.params.id, req.body)));
router.post('/:id/rollover', async (req, res) => send(res, await rollOver(await getDb(), uid(req), req.params.id, req.body), true));

export default router;
