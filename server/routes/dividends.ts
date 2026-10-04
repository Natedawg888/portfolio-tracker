/**
 * Dividend records for the signed-in user.
 * Figures are calculated from rows they entered. No market forecast is fetched.
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { todayAucklandYmd } from '../dividends/model.ts';
import {
  dashboardForUser,
  deleteDividend,
  insertDividend,
  updateDividend,
  type DividendWriteBody,
} from '../dividends/store.ts';

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

function parseYear(value: unknown, today: string): number | null {
  if (value == null || value === '') return Number(today.slice(0, 4));
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1980 || year > 2100) return null;
  return year;
}

router.get('/', async (req, res) => {
  const userId = uid(req as AuthedRequest & { scopeUserId?: string });
  const today = todayAucklandYmd();
  const year = parseYear(req.query.year, today);
  if (year == null) {
    res.status(400).json({ error: 'Year must be a whole number from 1980 to 2100.' });
    return;
  }
  const db = await getDb();
  res.json(dashboardForUser(db, userId, year, today));
});

router.post('/', async (req, res) => {
  const userId = uid(req as AuthedRequest & { scopeUserId?: string });
  const db = await getDb();
  const result = insertDividend(db, userId, (req.body ?? {}) as DividendWriteBody);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(201).json(result.event);
});

router.patch('/:id', async (req, res) => {
  const userId = uid(req as AuthedRequest & { scopeUserId?: string });
  const db = await getDb();
  const result = updateDividend(db, userId, req.params.id, (req.body ?? {}) as DividendWriteBody);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result.event);
});

router.delete('/:id', async (req, res) => {
  const userId = uid(req as AuthedRequest & { scopeUserId?: string });
  const db = await getDb();
  const removed = deleteDividend(db, userId, req.params.id);
  if (!removed) {
    res.status(404).json({ error: 'Dividend not found.' });
    return;
  }
  res.json({ ok: true, id: req.params.id });
});

export default router;
