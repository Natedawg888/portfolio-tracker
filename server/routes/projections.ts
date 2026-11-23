/**
 * Forward net worth and savings for the signed-in user.
 * GET /api/projections
 *   ?months=12
 *   &savingWindowMonths=3
 *   &annualReturnPercent=5
 *   &monthlySavingNzd=500
 *   &returnShares=7&addShares=500 …  (per asset class: cash, shares, kiwiSaver, crypto,
 *                                     mining, metals, property, other)
 * GET / PUT /api/projections/assumptions   the user's saved per-class returns and additions
 *
 * Auth: same session cookie as the rest of /api (401 when signed out).
 * Amounts are NZD, rounded to cents. Dates are YYYY-MM-DD in Pacific/Auckland.
 * Formulas and assumption sources: server/projections/model.ts.
 */
import { difference, parseScenario, summarise } from '../projections/scenario.ts';
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import { parseProjectionQuery } from '../projections/params.ts';
import { loadUserProjection } from '../projections/load.ts';
import { loadSavedAssumptions, saveAssumptions } from '../projections/prefs.ts';

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
  const parsed = parseProjectionQuery(req.query as Record<string, unknown>);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const projection = await loadUserProjection(db, uid(req), parsed.value, aucklandToday());
  res.json(projection);
});

/**
 * Scenario tool (KAN-32): GET /api/projections/scenario?months=…&extraSaving=…&extraIncome=…&invest=…&mortgageRate=…
 * The user's projection as it is and with the changes, and the difference at the end.
 */
router.get('/scenario', async (req, res) => {
  const parsed = parseProjectionQuery(req.query as Record<string, unknown>);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const s = parseScenario(req.query as Record<string, unknown>);
  if (!s.ok) {
    res.status(400).json({ error: s.error });
    return;
  }
  const db = await getDb();
  const today = aucklandToday();
  const base = await loadUserProjection(db, uid(req), parsed.value, today);
  const changed = await loadUserProjection(db, uid(req), parsed.value, today, s.value);
  const baseline = summarise(base);
  const scenario = summarise(changed);
  const mortgages = base.debts.length && s.value.mortgageRateChangePct ? changed.debts.filter((d, i) => d.annualRatePercent !== base.debts[i]?.annualRatePercent).length : 0;
  res.json({
    months: base.horizonMonths,
    asOf: base.asOf,
    input: s.value,
    baseline,
    scenario,
    difference: difference(baseline, scenario),
    points: changed.points.map((p, i) => ({ date: p.date, baselineNzd: base.points[i]?.netWorthNzd ?? null, scenarioNzd: p.netWorthNzd })),
    notes: [
      ...(s.value.mortgageRateChangePct && !mortgages ? ['No mortgage with an interest rate in Debts, so the rate change has nothing to apply to.'] : []),
      'Uses your own projection: the same starting values, returns and saved payments. An illustration, not advice.',
    ],
  });
});

router.get('/assumptions', async (req, res) => {
  const db = await getDb();
  res.json(loadSavedAssumptions(db, uid(req)));
});

router.put('/assumptions', async (req, res) => {
  const db = await getDb();
  res.json(saveAssumptions(db, uid(req), req.body ?? {}));
});

export default router;
