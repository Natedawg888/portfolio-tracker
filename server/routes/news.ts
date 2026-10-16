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
  RENTALS_FOR_NEWS_SQL,
  VEHICLES_FOR_NEWS_SQL,
  extraNewsRows,
  normalizeHoldingRow,
  planNewsSections,
} from '../news/sections.ts';
import { readNewsState, saveNewsState } from '../news/state.ts';

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

function includeClosedQuery(raw: unknown, saved: boolean): boolean {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return saved;
}

router.get('/state', async (req, res) => {
  res.json(await readNewsState(uid(req)));
});

router.put('/state', async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ error: 'News settings must be an object' });
    return;
  }
  const saved = await saveNewsState(uid(req), body);
  if (!saved) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  res.json(saved);
});

router.get('/', async (req, res) => {
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  try {
    const db = await getDb();
    const prefs = await readNewsState(uid(req));
    const includeClosed = includeClosedQuery(req.query.includeClosed, prefs.includeClosedPositions);
    const rows = queryAll<Record<string, unknown>>(db, HOLDINGS_FOR_NEWS_SQL, [uid(req)]);
    // Vehicles and Rentals properties count too, so news isn't only for Portfolio holdings.
    const extra = extraNewsRows(
      queryAll<{ name: string | null; make: string | null; model: string | null }>(db, VEHICLES_FOR_NEWS_SQL, [uid(req)]),
      queryAll<{ name: string | null }>(db, RENTALS_FOR_NEWS_SQL, [uid(req)]),
    );
    const sections = await loadNewsSections(
      planNewsSections(
        [...rows.map((row) => normalizeHoldingRow(row)), ...extra],
        { includeClosed },
      ),
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
