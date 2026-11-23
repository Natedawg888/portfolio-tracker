/**
 * Financial timeline (KAN-62). GET /api/timeline?from=YYYY-MM-DD&to=YYYY-MM-DD&types=bank,crypto,dividend,milestone&limit=500
 * Defaults: the last 90 days, every type. Built in server/timeline/store.ts.
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import { parseTimelineQuery, timelineEvents } from '../timeline/store.ts';

const router = Router();

router.get('/', async (req, res) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  const q = parseTimelineQuery(req.query as Record<string, unknown>, aucklandToday());
  if (!q.ok) {
    res.status(400).json({ error: q.error });
    return;
  }
  res.json(timelineEvents(await getDb(), userId, q.value));
});

export default router;
