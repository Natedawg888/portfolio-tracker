/**
 * Headlines for the signed-in user's holdings.
 * Public Google News and BBC RSS only. No API key.
 * A failed feed stays empty; stories are never invented.
 */
import { Router } from 'express';
import type { NewsFeedResponse } from '../../src/types/index.ts';
import { getDb, queryAll } from '../db/index.ts';
import { requireUserId } from '../lib/userScope.ts';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { loadNewsSections } from '../news/load.ts';
import {
  HOLDINGS_FOR_NEWS_SQL,
  normalizeHoldingRow,
  planNewsSections,
} from '../news/sections.ts';

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
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  try {
    const db = await getDb();
    const rows = queryAll<Record<string, unknown>>(db, HOLDINGS_FOR_NEWS_SQL, [uid(req)]);
    const sections = await loadNewsSections(
      planNewsSections(rows.map((row) => normalizeHoldingRow(row))),
      { refresh },
    );
    const payload: NewsFeedResponse = {
      fetchedAt: new Date().toISOString(),
      sections,
    };
    res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'News feeds could not be loaded';
    res.status(502).json({ error: message });
  }
});

export default router;
