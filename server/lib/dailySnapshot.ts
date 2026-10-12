/**
 * Daily net-worth snapshot for the Dashboard sparkline.
 *
 * GET /net-worth calls this after computing the figures it returns, so a snapshot
 * is saved on dashboard load and after each sync refresh. One 'auto' row per
 * Pacific/Auckland day: the first load inserts it, later loads update it to the
 * latest figures. Manual snapshots (POST /snapshots) are never touched.
 *
 * Nothing is estimated. If a wallet could not be valued the total is short by an
 * unknown amount, so that load is skipped and the day keeps its last full reading.
 *
 * Users can turn this off (preferences_json.snapshots.dailySnapshot). Off only
 * stops new rows; existing snapshots are left as they are.
 */
import type { Database } from 'sql.js';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import type { NetWorthResult } from './netWorth.ts';
import { normalizeSnapshotPrefs } from '../../src/lib/snapshotPrefs.ts';

/** Same breakdown shape POST /snapshots stores, so History reads both alike. */
export function snapshotBreakdown(nw: NetWorthResult) {
  return {
    byClass: nw.breakdown.byClass,
    holdings: nw.breakdown.holdings,
    asOf: nw.asOf,
    quoteNote: nw.quoteNote,
    debtOutstandingNzd: nw.debtOutstandingNzd,
    debtPersonCount: nw.debtPersonCount,
    assetsKnownNzd: nw.assetsKnownNzd,
  };
}

export type DailySnapshotResult = 'inserted' | 'updated' | 'skipped' | 'disabled';

export function dailySnapshotEnabled(db: Database, userId: string): boolean {
  const row = queryOne<{ preferences_json: string | null }>(
    db,
    `SELECT preferences_json FROM users WHERE id = ?`,
    [userId],
  );
  try {
    const prefs = JSON.parse(row?.preferences_json ?? '{}') as { snapshots?: unknown } | null;
    return normalizeSnapshotPrefs(prefs?.snapshots).dailySnapshot;
  } catch {
    return normalizeSnapshotPrefs(null).dailySnapshot;
  }
}

export function recordDailySnapshot(
  db: Database,
  userId: string,
  nw: NetWorthResult,
  now: Date = new Date(),
): DailySnapshotResult {
  if (!dailySnapshotEnabled(db, userId)) return 'disabled';
  if ((nw.cryptoWalletsFailed ?? 0) > 0 || !Number.isFinite(nw.totalKnownNzd)) return 'skipped';

  const today = aucklandToday(now);
  // An Auckland day spans at most ~14h either side of its UTC date; 2 days back is plenty.
  const since = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const recent = queryAll<{ id: string; taken_at: string }>(
    db,
    `SELECT id, taken_at FROM valuation_snapshots
     WHERE user_id = ? AND kind = 'auto' AND taken_at >= ?
     ORDER BY taken_at DESC`,
    [userId, since],
  );
  const todays = recent.find((r) => aucklandToday(new Date(r.taken_at)) === today);
  const breakdown = JSON.stringify(snapshotBreakdown(nw));
  const takenAt = now.toISOString();

  if (todays) {
    run(
      db,
      `UPDATE valuation_snapshots SET taken_at = ?, total_nzd = ?, breakdown_json = ?
       WHERE id = ? AND user_id = ?`,
      [takenAt, nw.totalKnownNzd, breakdown, todays.id, userId],
    );
    return 'updated';
  }
  run(
    db,
    `INSERT INTO valuation_snapshots (id, user_id, taken_at, total_nzd, breakdown_json, notes, kind)
     VALUES (?,?,?,?,?,?, 'auto')`,
    [newId('snap'), userId, takenAt, nw.totalKnownNzd, breakdown, null],
  );
  return 'inserted';
}
