/**
 * KiwiSaver balance history is recorded points only.
 * Valuation snapshots are not backfilled, so a stale class total cannot
 * cover or sit beside a real Akahu / manual / CSV point.
 * Run: npm run test:kiwisaver
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-ks-history-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { default: kiwisaverRouter } = await import('../routes/kiwisaver.ts');

const userA = 'ks_hist_a';
const userB = 'ks_hist_b';
const now = '2026-10-12T00:00:00.000Z';
const db = await getDb();
for (const [id, email] of [
  [userA, 'ks-hist-a@example.test'],
  [userB, 'ks-hist-b@example.test'],
]) {
  run(
    db,
    `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`,
    [id, email, 'hash', now, now],
  );
}

run(
  db,
  `INSERT INTO kiwisaver_accounts
     (id, user_id, name, provider, balance_nzd, returns_nzd, fund_mix_json, connection_status, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ['ks_a', userA, 'Sharesies KiwiSaver', 'sharesies', 29628.83, 4000, '[]', 'akahu', now, now],
);
run(
  db,
  `INSERT INTO kiwisaver_balance_history
     (id, account_id, observed_at, balance_nzd, returns_nzd, source)
   VALUES (?,?,?,?,?,?)`,
  ['ksh_10', 'ks_a', '2026-10-10', 29600, 3900, 'akahu'],
);
// Auckland day of the snapshot below. The snapshot's UTC date is 11 Oct, so the
// old merge kept both and the stale $29,730 sat beside this real point.
run(
  db,
  `INSERT INTO kiwisaver_balance_history
     (id, account_id, observed_at, balance_nzd, returns_nzd, source)
   VALUES (?,?,?,?,?,?)`,
  ['ksh_12', 'ks_a', '2026-10-12', 29628.83, 4000, 'akahu'],
);
run(
  db,
  `INSERT INTO valuation_snapshots (id, user_id, taken_at, total_nzd, breakdown_json, notes, kind)
   VALUES (?,?,?,?,?,?,?)`,
  [
    'snap_stale',
    userA,
    '2026-10-11T20:00:00.000Z',
    80000,
    JSON.stringify({ byClass: { kiwiSaver: 29730 } }),
    'stale class total',
    'auto',
  ],
);
run(
  db,
  `INSERT INTO valuation_snapshots (id, user_id, taken_at, total_nzd, breakdown_json, notes, kind)
   VALUES (?,?,?,?,?,?,?)`,
  [
    'snap_gap',
    userA,
    '2026-10-09T20:00:00.000Z',
    79000,
    JSON.stringify({ byClass: { kiwiSaver: 29000 } }),
    'day with no KiwiSaver sync',
    'auto',
  ],
);
run(
  db,
  `INSERT INTO kiwisaver_accounts
     (id, user_id, name, provider, balance_nzd, fund_mix_json, connection_status, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?,?,?)`,
  ['ks_b', userB, 'Other KiwiSaver', 'sharesies', 1, '[]', 'akahu', now, now],
);
run(
  db,
  `INSERT INTO valuation_snapshots (id, user_id, taken_at, total_nzd, breakdown_json, notes, kind)
   VALUES (?,?,?,?,?,?,?)`,
  ['snap_b', userB, '2026-10-12T00:00:00.000Z', 5, JSON.stringify({ byClass: { kiwiSaver: 5 } }), null, 'auto'],
);

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/kiwisaver', kiwisaverRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

type HistoryBody = {
  status?: string;
  points?: { at: string; balanceNzd: number; source: string }[];
};

async function getHistory(cookie: string | undefined, accountId?: string): Promise<{ status: number; json: HistoryBody }> {
  const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
  const res = await fetch(`${base}/api/kiwisaver/history${query}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as HistoryBody };
}

try {
  assert((await getHistory(undefined, 'ks_a')).status === 401, 'signed out is 401');

  const cookieA = `${SESSION_COOKIE}=${(await createSession(userA)).rawToken}`;
  const cookieB = `${SESSION_COOKIE}=${(await createSession(userB)).rawToken}`;

  const history = await getHistory(cookieA, 'ks_a');
  assert(history.status === 200, 'signed in is 200');
  const points = history.json.points ?? [];
  assert(points.length === 2, `only the two recorded rows (got ${points.length})`);
  assert(
    points.map((p) => `${p.at}:${p.balanceNzd}:${p.source}`).join('|') ===
      '2026-10-10:29600:akahu|2026-10-12:29628.83:akahu',
    'points are the Akahu rows, in order, with the exact balances',
  );
  assert(
    points.every((p) => p.source !== 'valuation_snapshot'),
    'no valuation_snapshot source',
  );
  assert(
    !points.some((p) => p.balanceNzd === 29730 || p.balanceNzd === 29000),
    'stale snapshot totals are not history points',
  );
  assert(
    !points.some((p) => p.at.slice(0, 10) === '2026-10-09' || p.at.slice(0, 10) === '2026-10-11'),
    'days with no sync are absent, including the snapshot UTC date',
  );

  const other = await getHistory(cookieB, 'ks_b');
  assert(other.status === 200, 'user B can read their own history');
  assert((other.json.points ?? []).length === 0, 'a snapshot-only account has no balance history');
  assert(
    !(other.json.points ?? []).some((p) => p.balanceNzd === 29628.83),
    'user B does not see user A’s points',
  );

  console.log('kiwisaver history tests passed');
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  for (const suffix of ['', '.tmp', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
