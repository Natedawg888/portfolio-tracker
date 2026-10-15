/**
 * Vehicles for the signed-in user (KAN-65).
 *   GET    /        vehicles (value, loan, equity, cost to own), totals, loan accounts to link
 *   POST   /        vehicle fields (see parseVehicle)
 *   PUT    /:id     vehicle fields
 *   DELETE /:id     the vehicle only; a linked bank loan account is never touched
 */
import { Router, type Request, type Response } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { createVehicle, deleteVehicle, listVehicles, updateVehicle } from '../vehicles/store.ts';

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

function send<T>(res: Response, r: { ok: true; value: T } | { ok: false; status: number; error: string }, created = false) {
  if (!r.ok) res.status(r.status).json({ error: r.error });
  else res.status(created ? 201 : 200).json(r.value);
}

router.get('/', async (req, res) => {
  res.json(listVehicles(await getDb(), uid(req)));
});
router.post('/', async (req, res) => send(res, createVehicle(await getDb(), uid(req), req.body), true));
router.put('/:id', async (req, res) => send(res, updateVehicle(await getDb(), uid(req), req.params.id, req.body)));
router.delete('/:id', async (req, res) => {
  if (!deleteVehicle(await getDb(), uid(req), req.params.id)) res.status(404).json({ error: 'Vehicle not found' });
  else res.json({ ok: true });
});

export default router;
