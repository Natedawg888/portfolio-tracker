/**
 * GET /api/health-score — the signed-in user's financial health score (KAN-55).
 * 0–100 with a band, a one-line summary and the five checks behind it. Educational only.
 * Kept separate from /api/home/snapshot, which stays a plain income / spending summary.
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import { loadHealthScore } from '../health/load.ts';

const router = Router();

router.get('/', async (req, res) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  const db = await getDb();
  res.json(await loadHealthScore(db, userId, aucklandToday()));
});

export default router;
