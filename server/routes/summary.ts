/**
 * Net worth summary + valuation snapshot history for yearly reports.
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb, queryAll, queryOne, run, newId } from '../db/index.ts';
import { computeNetWorth } from '../lib/netWorth.ts';

const router = Router();

router.get('/net-worth', async (req: AuthedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const result = await computeNetWorth(undefined, userId);
  // Keep public shape stable (omit internal breakdown unless asked)
  const { breakdown: _b, ...publicShape } = result;
  res.json(publicShape);
});

router.get('/health', async (req, res) => {
  const db = await getDb();
  const meta = queryOne(db, `SELECT value FROM meta WHERE key='schema_version'`);
  res.json({ ok: true, schemaVersion: meta?.value ?? null, currency: 'NZD' });
});

function mapSnapshot(r: Record<string, unknown>) {
  let breakdown: unknown = {};
  try {
    breakdown = JSON.parse(String(r.breakdown_json ?? '{}'));
  } catch {
    breakdown = {};
  }
  return {
    id: r.id,
    takenAt: r.taken_at,
    totalNzd: Number(r.total_nzd),
    breakdown,
    notes: r.notes ?? null,
  };
}

/** List valuation snapshots. Optional ?year=2026 filters by Pacific/Auckland calendar year. */
router.get('/snapshots', async (req: AuthedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const db = await getDb();
  const yearRaw = typeof req.query.year === 'string' ? req.query.year : '';
  const year = /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null;

  const rows = queryAll(
    db,
    `SELECT * FROM valuation_snapshots WHERE user_id = ? ORDER BY taken_at ASC`,
    [userId],
  );

  const mapped = rows.map(mapSnapshot);
  if (year == null) {
    return res.json(mapped);
  }

  // Filter by Auckland calendar year of taken_at
  const filtered = mapped.filter((s) => {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Pacific/Auckland',
        year: 'numeric',
      }).formatToParts(new Date(String(s.takenAt)));
      const y = Number(parts.find((p) => p.type === 'year')?.value);
      return y === year;
    } catch {
      return false;
    }
  });
  res.json(filtered);
});

/** Take a point-in-time net-worth snapshot (real balances only). */
router.post('/snapshots', async (req: AuthedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const db = await getDb();
  const nw = await computeNetWorth(db, userId);
  const notes =
    typeof req.body?.notes === 'string' && req.body.notes.trim()
      ? req.body.notes.trim()
      : null;
  const id = newId('snap');
  const breakdown = {
    byClass: nw.breakdown.byClass,
    holdings: nw.breakdown.holdings,
    asOf: nw.asOf,
    quoteNote: nw.quoteNote,
    debtOutstandingNzd: nw.debtOutstandingNzd,
    debtPersonCount: nw.debtPersonCount,
    assetsKnownNzd: nw.assetsKnownNzd,
  };
  run(
    db,
    `INSERT INTO valuation_snapshots (id, user_id, taken_at, total_nzd, breakdown_json, notes)
     VALUES (?,?,?,?,?,?)`,
    [id, userId, nw.asOf, nw.totalKnownNzd, JSON.stringify(breakdown), notes],
  );
  const row = queryOne(db, 'SELECT * FROM valuation_snapshots WHERE id=? AND user_id=?', [id, userId])!;
  res.status(201).json(mapSnapshot(row));
});

export default router;
