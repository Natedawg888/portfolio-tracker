/**
 * Dividend records for the signed-in user.
 * Recorded figures come from rows they entered.
 * A next payment is added only when Yahoo chart history already used for
 * equity prices has a real dividend for one of this user's stocks or ETFs.
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { isYmd, todayAucklandYmd } from '../dividends/model.ts';
import {
  dashboardForUser,
  deleteDividend,
  insertDividend,
  setDividendReinvest,
  setForecastReinvest,
  setForecastReinvestAll,
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
  res.json(await dashboardForUser(db, userId, year, today));
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

router.patch('/:id/reinvest', async (req, res) => {
  const userId = uid(req as AuthedRequest & { scopeUserId?: string });
  const reinvested = (req.body ?? {}).reinvested;
  if (reinvested !== true && reinvested !== false) {
    res.status(400).json({ error: 'reinvested must be true or false.' });
    return;
  }
  const db = await getDb();
  const result = await setDividendReinvest(db, userId, req.params.id, reinvested);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({
    event: result.event,
    detected: result.detected,
    ownedShares: result.ownedShares,
  });
});

router.put('/forecast-reinvest', async (req, res) => {
  const userId = uid(req as AuthedRequest & { scopeUserId?: string });
  const body = (req.body ?? {}) as { holdingId?: unknown; paymentDate?: unknown; reinvested?: unknown };
  const holdingId = typeof body.holdingId === 'string' ? body.holdingId.trim() : '';
  const paymentDate = typeof body.paymentDate === 'string' ? body.paymentDate.trim() : '';
  if (!holdingId) {
    res.status(400).json({ error: 'Choose one of your stock or ETF holdings.' });
    return;
  }
  if (!isYmd(paymentDate)) {
    res.status(400).json({ error: 'Payment date must be a real calendar date (YYYY-MM-DD).' });
    return;
  }
  if (body.reinvested !== true && body.reinvested !== false) {
    res.status(400).json({ error: 'reinvested must be true or false.' });
    return;
  }
  const db = await getDb();
  const result = await setForecastReinvest(db, userId, holdingId, paymentDate, body.reinvested);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({
    holdingId: result.holdingId,
    paymentDate: result.paymentDate,
    reinvested: result.reinvested,
    detected: result.detected,
    ownedShares: result.ownedShares,
  });
});

/** Body: { holdingId, reinvested } — reinvest every predicted payment of that holding. */
router.put('/forecast-reinvest-all', async (req, res) => {
  const userId = uid(req as AuthedRequest & { scopeUserId?: string });
  const body = (req.body ?? {}) as { holdingId?: unknown; reinvested?: unknown };
  const holdingId = typeof body.holdingId === 'string' ? body.holdingId.trim() : '';
  if (!holdingId) {
    res.status(400).json({ error: 'Choose one of your stock or ETF holdings.' });
    return;
  }
  if (body.reinvested !== true && body.reinvested !== false) {
    res.status(400).json({ error: 'reinvested must be true or false.' });
    return;
  }
  const db = await getDb();
  const result = setForecastReinvestAll(db, userId, holdingId, body.reinvested);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ holdingId, reinvested: body.reinvested });
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
