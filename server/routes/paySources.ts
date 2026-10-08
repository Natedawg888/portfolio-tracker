/**
 * Saved pay sources for the signed-in user (KAN-70).
 * Body: { name, taxYear?, inputs } — inputs are the PAYE page's piece-rate, contract
 * (schedular) or share-of-catch fields. Weekly figures are recomputed on the server.
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { parsePaySourceBody } from '../paySources/model.ts';
import {
  createPaySource,
  deletePaySource,
  listPaySources,
  updatePaySource,
} from '../paySources/store.ts';

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
  res.json(listPaySources(db, uid(req)));
});

router.post('/', async (req, res) => {
  const parsed = parsePaySourceBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  res.status(201).json(createPaySource(db, uid(req), parsed.value));
});

router.put('/:id', async (req, res) => {
  const parsed = parsePaySourceBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const saved = updatePaySource(db, uid(req), req.params.id, parsed.value);
  if (!saved) {
    res.status(404).json({ error: 'Pay source not found' });
    return;
  }
  res.json(saved);
});

router.delete('/:id', async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  if (!deletePaySource(db, uid(req), id)) {
    res.status(404).json({ error: 'Pay source not found' });
    return;
  }
  res.json({ ok: true, id });
});

export default router;
