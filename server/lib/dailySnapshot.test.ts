/**
 * Daily net-worth snapshot: one 'auto' row per Auckland day, manual rows untouched.
 * Run: npm run test:dashboard
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `pt-daily-snapshot-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, queryAll, run } = await import('../db/index.ts');
const { dailySnapshotEnabled, recordDailySnapshot } = await import('./dailySnapshot.ts');
type NetWorthResult = import('./netWorth.ts').NetWorthResult;

const db = await getDb();
const user = 'snap_user';
const other = 'snap_other';

function nw(total: number, failedWallets = 0): NetWorthResult {
  return {
    totalKnownNzd: total,
    cryptoWalletsFailed: failedWallets,
    asOf: new Date().toISOString(),
    breakdown: { byClass: { total, kiwiSaver: 100 }, holdings: [] },
  } as unknown as NetWorthResult;
}

function rows(userId: string) {
  return queryAll<{ total_nzd: number; kind: string; taken_at: string }>(
    db,
    `SELECT total_nzd, kind, taken_at FROM valuation_snapshots WHERE user_id = ? ORDER BY taken_at ASC`,
    [userId],
  );
}

run(
  db,
  `INSERT INTO valuation_snapshots (id, user_id, taken_at, total_nzd, breakdown_json, notes)
   VALUES ('manual_1', ?, '2026-10-10T20:00:00.000Z', 999, '{}', 'year end')`,
  [user],
);
assert(rows(user)[0].kind === 'manual', 'existing rows default to manual');

// 11 Oct 09:00 NZDT is 10 Oct 20:00 UTC.
assert(recordDailySnapshot(db, user, nw(1000), new Date('2026-10-10T20:00:00Z')) === 'inserted', 'first load inserts');
assert(recordDailySnapshot(db, user, nw(1200), new Date('2026-10-11T10:00:00Z')) === 'updated', '11 Oct 23:00 NZDT is the same day');
let list = rows(user);
assert(list.length === 2, 'one manual row plus one auto row');
const auto = list.find((r) => r.kind === 'auto')!;
assert(auto.total_nzd === 1200, 'same-day load keeps the latest figure');
assert(list.find((r) => r.kind === 'manual')!.total_nzd === 999, 'manual snapshot untouched');

assert(recordDailySnapshot(db, user, nw(1300), new Date('2026-10-11T11:30:00Z')) === 'inserted', '12 Oct 00:30 NZDT is a new day');
assert(recordDailySnapshot(db, user, nw(50, 1), new Date('2026-10-11T12:00:00Z')) === 'skipped', 'a failed wallet is not recorded');
list = rows(user).filter((r) => r.kind === 'auto');
assert(list.length === 2, 'two days, two auto rows');
assert(list[1].total_nzd === 1300, 'skipped load leaves the day as it was');

assert(recordDailySnapshot(db, other, nw(5), new Date('2026-10-11T11:30:00Z')) === 'inserted', 'each user has their own day');
assert(rows(other).length === 1, 'other user has one row');

const optOut = 'snap_opt_out';
run(
  db,
  `INSERT INTO users (id, email, password_hash, preferences_json, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
  [optOut, 'opt-out@example.test', 'x', JSON.stringify({ valueSearch: { showCurrencyExchanger: false } }), 'now', 'now'],
);
assert(dailySnapshotEnabled(db, optOut), 'a user who never set the pref takes daily snapshots');
assert(dailySnapshotEnabled(db, 'no_such_user'), 'no saved prefs means on');
assert(recordDailySnapshot(db, optOut, nw(10), new Date('2026-10-10T20:00:00Z')) === 'inserted', 'on by default records');

run(db, `UPDATE users SET preferences_json = ? WHERE id = ?`, [
  JSON.stringify({ valueSearch: { showCurrencyExchanger: false }, snapshots: { dailySnapshot: false } }),
  optOut,
]);
const before = JSON.stringify(rows(optOut));
assert(!dailySnapshotEnabled(db, optOut), 'saved false turns it off');
assert(recordDailySnapshot(db, optOut, nw(20), new Date('2026-10-10T21:00:00Z')) === 'disabled', 'same day is not updated when off');
assert(recordDailySnapshot(db, optOut, nw(30), new Date('2026-10-12T21:00:00Z')) === 'disabled', 'a new day is not inserted when off');
assert(JSON.stringify(rows(optOut)) === before, 'turning it off leaves existing snapshots as they were');

console.log('daily snapshot tests passed');
