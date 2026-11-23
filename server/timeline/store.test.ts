/**
 * Financial timeline (KAN-62): bank, crypto (ledger, and wallet history when present), dividends
 * and net-worth milestones; type and date filters; isolation; HTTP. Plus the page helpers.
 * Run: npm run test:timeline
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-timeline-'));
process.env.DATABASE_PATH = path.join(dir, 'portfolio.db');
process.env.NODE_ENV = 'test';

const { getDb, run } = await import('../db/index.ts');
const { milestoneLevels, netWorthMilestones, parseTimelineQuery, timelineEvents } = await import('./store.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser } = await import('../middleware/requireAuth.ts');
const { default: timelineRouter } = await import('../routes/timeline.ts');
const { groupByDay, timelineRange } = await import('../../src/lib/timelineView.ts');

// Milestone levels and first-reach dates.
eq(milestoneLevels(35_000), [10_000, 20_000, 30_000], 'every $10k to $100k');
eq(milestoneLevels(260_000).slice(-3), [150_000, 200_000, 250_000], 'then every $50k');
eq(netWorthMilestones([{ date: '2026-01-01', totalNzd: 12_000 }, { date: '2026-02-01', totalNzd: 9_000 }, { date: '2026-03-01', totalNzd: 21_000 }]), [{ date: '2026-01-01', level: 10_000 }, { date: '2026-03-01', level: 20_000 }], 'a dip and recovery counts each level once');

const db = await getDb();
const now = new Date().toISOString();
for (const [id, email] of [['ta', 'ta@example.com'], ['tb', 'tb@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [id, email, 'h', now, now]);
}
run(db, `INSERT INTO bank_accounts (id, user_id, name, account_type, balance, currency, created_at, updated_at) VALUES ('acc1','ta','Everyday','checking',0,'NZD',?,?)`, [now, now]);
run(db, `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, created_at, merchant, source) VALUES ('t1','ta','acc1','2026-10-05','COUNTDOWN',-82.5,'debit',?, 'Countdown','manual')`, [now]);
run(db, `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, created_at, source) VALUES ('t2','ta','acc1','2026-10-06','Salary',4200,'credit',?,'manual')`, [now]);
run(db, `INSERT INTO transactions (id, user_id, date, description, amount, kind, created_at, source) VALUES ('tb1','tb','2026-10-05','Other user',-1,'debit',?,'manual')`, [now]);
run(db, `INSERT INTO crypto_txns (id, user_id, date, kind, asset, amount, nzd_value, created_at, updated_at) VALUES ('c1','ta','2026-10-04','buy','BTC',0.01,1500,?,?)`, [now, now]);
run(db, `INSERT INTO dividend_events (id, user_id, company_name, symbol, shares_held, dividend_per_share, gross_dividend, net_dividend, payment_date, currency, fx_rate_to_nzd, created_at, updated_at) VALUES ('d1','ta','Apple','AAPL',10,0.25,2.5,2.5,'2026-10-03','USD',1.7,?,?)`, [now, now]);
run(db, `INSERT INTO valuation_snapshots (id, user_id, taken_at, total_nzd, kind) VALUES ('s1','ta','2026-09-30T22:00:00.000Z',9500,'auto')`, []);
run(db, `INSERT INTO valuation_snapshots (id, user_id, taken_at, total_nzd, kind) VALUES ('s2','ta','2026-10-01T22:00:00.000Z',10200,'auto')`, []);

const q = (over: Partial<{ from: string; to: string; types: ('bank' | 'crypto' | 'dividend' | 'milestone')[] }> = {}) => ({ from: '2026-10-01', to: '2026-10-31', types: ['bank', 'crypto', 'dividend', 'milestone'] as ('bank' | 'crypto' | 'dividend' | 'milestone')[], limit: 500, ...over });
let ev = timelineEvents(db, 'ta', q());
eq(ev.map((e) => e.id), ['bank:t2', 'bank:t1', 'ledger:c1', 'dividend:d1', 'milestone:10000'], 'every type, newest first');
eq(ev.find((e) => e.id === 'bank:t1')?.title, 'Countdown', 'merchant as the title');
eq(ev.find((e) => e.id === 'bank:t1')?.direction, 'out', 'spend is out');
eq(ev.find((e) => e.id === 'dividend:d1')?.amountNzd, 4.25, 'USD dividend in NZD at its rate');
eq(ev.find((e) => e.id === 'milestone:10000')?.date, '2026-10-02', 'milestone on the Auckland day it was reached');
eq(ev.some((e) => e.id === 'bank:tb1'), false, "another user's transaction never shows");
eq(timelineEvents(db, 'ta', q({ types: ['crypto'] })).map((e) => e.id), ['ledger:c1'], 'type filter');
eq(timelineEvents(db, 'ta', q({ from: '2026-10-05', to: '2026-10-05' })).map((e) => e.id), ['bank:t1'], 'date filter');

// Wallet history (KAN-43) is used when its table exists; spam stays out.
run(db, `CREATE TABLE IF NOT EXISTS wallet_txns (id TEXT PRIMARY KEY, user_id TEXT, wallet_id TEXT, network TEXT, hash TEXT, asset_key TEXT, ts TEXT, status TEXT, kind TEXT, direction TEXT, symbol TEXT, contract TEXT, amount_raw TEXT, decimals INTEGER, fee_raw TEXT, counterparty TEXT, hidden INTEGER, created_at TEXT, updated_at TEXT)`, []);
run(db, `INSERT INTO wallet_txns VALUES ('w1','ta','wal','ethereum','0xa','eth','2026-10-07T01:00:00.000Z','confirmed','received','in','ETH',NULL,'500000000000000000',18,NULL,NULL,0,?,?)`, [now, now]);
run(db, `INSERT INTO wallet_txns VALUES ('w2','ta','wal','ethereum','0xb','spam','2026-10-07T01:00:00.000Z','confirmed','received','in','SPAM',NULL,'1',0,NULL,NULL,1,?,?)`, [now, now]);
ev = timelineEvents(db, 'ta', q({ types: ['crypto'] }));
eq(ev.map((e) => e.id), ['wallet:w1', 'ledger:c1'], 'wallet history in, spam out');
eq(ev[0].title, 'Received: 0.5 ETH', 'wallet title');

// Query parsing.
eq(parseTimelineQuery({}, '2026-11-23').ok && (parseTimelineQuery({}, '2026-11-23') as { value: { from: string } }).value.from, '2026-08-25', 'default: last 90 days');
eq(parseTimelineQuery({ types: 'bank,nope' }, '2026-11-23').ok, false, 'unknown type refused');
eq(parseTimelineQuery({ from: '2026-12-01', to: '2026-11-01' }, '2026-11-23').ok, false, 'from after to refused');

// Page helpers.
eq(timelineRange('30d', new Date('2026-11-23T01:00:00Z')), { from: '2026-10-24', to: '2026-11-23' }, '30 days');
eq(groupByDay(timelineEvents(db, 'ta', q())).map((d) => d.date).slice(0, 2), ['2026-10-07', '2026-10-06'], 'grouped by day, newest first');

// HTTP.
const app = express();
app.use('/api', attachUser);
app.use('/api/timeline', timelineRouter);
const server: Server = await new Promise((r) => {
  const s = app.listen(0, '127.0.0.1', () => r(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  const cookie = `${SESSION_COOKIE}=${(await createSession('ta')).rawToken}`;
  const r = await fetch(`${base}/api/timeline?from=2026-10-01&to=2026-10-31&types=bank`, { headers: { Cookie: cookie } });
  eq(r.status, 200, 'GET 200');
  eq(((await r.json()) as { id: string }[]).map((e) => e.id), ['bank:t2', 'bank:t1'], 'HTTP filter');
  eq((await fetch(`${base}/api/timeline?types=bad`, { headers: { Cookie: cookie } })).status, 400, 'bad type 400');
  eq((await fetch(`${base}/api/timeline`)).status, 401, 'signed out 401');
  console.log('timeline tests passed');
} finally {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
