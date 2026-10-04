/**
 * Payee settings for the signed-in user.
 * A category is accepted only when that user already has it.
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { listPayeeSettings, savePayeeSetting } from '../payees/store.ts';

const router = Router();

router.use((req, res, next) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  (req as AuthedRequest & { scopeUserId: string }).scopeUserId = userId;
  next();
});

function uid(req: AuthedRequest & { scopeUserId?: string }): string {
  return req.scopeUserId || req.user?.id || '';
}

router.get('/', async (req, res) => {
  const db = await getDb();
  res.json(listPayeeSettings(db, uid(req as AuthedRequest & { scopeUserId?: string })));
});

router.put('/', async (req, res) => {
  const db = await getDb();
  const body = req.body ?? {};
  const result = savePayeeSetting(
    db,
    uid(req as AuthedRequest & { scopeUserId?: string }),
    body.name,
    body.categoryId,
  );
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result.setting);
});

export default router;
