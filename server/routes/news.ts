/**
 * Headlines for the signed-in user's holdings, plus world/politics.
 * Holdings are read with user_id = session user. Feeds are public RSS.
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb, queryAll } from '../db/index.ts';
import { logger } from '../lib/logger.ts';
import { loadNewsSections } from '../news/load.ts';
import { HOLDINGS_FOR_NEWS_SQL, normalizeHoldingRow, planNewsSections } from '../news/sections.ts';

const router = Router();

router.get('/', async (req, res) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  try {
    const db = await getDb();
    const raw = queryAll<Record<string, unknown>>(db, HOLDINGS_FOR_NEWS_SQL, [userId]);
    const plans = planNewsSections(raw.map(normalizeHoldingRow));
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const sections = await loadNewsSections(plans, { refresh });
    res.json({
      fetchedAt: new Date().toISOString(),
      sections,
    });
  } catch (err) {
    logger.error('news_failed', { err: String(err) });
    res.status(502).json({
      error: 'News feeds could not be loaded',
      code: 'NEWS_UNAVAILABLE',
    });
  }
});

export default router;
