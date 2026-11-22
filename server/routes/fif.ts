/**
 * FIF income estimate for the signed-in user (KAN-92).
 * GET /api/fif/summary?taxYear=2026 — tax year by the year it starts (2026 = 2026/27).
 * Omitted: the current tax year. Built in server/fif/store.ts.
 * PUT /api/fif/classes/:holdingId { override: 'fif' | 'exempt' | null } — the user's classification.
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import { fifTaxYearForDate } from '../../src/lib/fifCalc.ts';
import { fifSummary, setFifClassOverride } from '../fif/store.ts';

const router = Router();

router.get('/summary', async (req, res) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  const raw = Array.isArray(req.query.taxYear) ? req.query.taxYear[0] : req.query.taxYear;
  const today = aucklandToday();
  let taxYearStart = fifTaxYearForDate(today);
  if (raw != null && raw !== '') {
    if (typeof raw !== 'string' || !/^\d{4}$/.test(raw.trim())) {
      res.status(400).json({ error: 'taxYear must be the four-digit year the tax year starts' });
      return;
    }
    taxYearStart = Number(raw.trim());
    if (taxYearStart < 2000 || taxYearStart > fifTaxYearForDate(today)) {
      res.status(400).json({ error: 'taxYear must be from 2000 to the current tax year' });
      return;
    }
  }
  const db = await getDb();
  res.json(fifSummary(db, userId, taxYearStart, today));
});

router.put('/classes/:holdingId', async (req, res) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  const r = setFifClassOverride(await getDb(), userId, req.params.holdingId, req.body);
  if (!r.ok) {
    res.status(r.status).json({ error: r.error });
    return;
  }
  res.json({ holdingId: r.holdingId, override: r.override });
});

export default router;
