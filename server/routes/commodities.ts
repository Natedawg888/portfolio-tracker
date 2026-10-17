/**
 * Commodities for the signed-in user (KAN-81).
 *   GET    /       holdings, figures and totals
 *   POST   /       commodity fields (see parseCommodity)
 *   PUT    /:id
 *   DELETE /:id
 */
import { Router, type Request, type Response } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { createCommodity, deleteCommodity, listCommodities, updateCommodity } from '../commodities/store.ts';

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

router.get('/', async (req, res) => res.json(listCommodities(await getDb(), uid(req))));
router.post('/', async (req, res) => send(res, createCommodity(await getDb(), uid(req), req.body), true));
router.put('/:id', async (req, res) => send(res, updateCommodity(await getDb(), uid(req), req.params.id, req.body)));
router.delete('/:id', async (req, res) => send(res, deleteCommodity(await getDb(), uid(req), req.params.id)));

export default router;
