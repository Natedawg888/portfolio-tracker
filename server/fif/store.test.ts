/**
 * FIF summary from stored holdings, snapshots and dividends (KAN-92), and the HTTP route.
 * Run: npm run test:fif
 *
 * Uses a throwaway sqlite file. Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-fif-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser } = await import('../middleware/requireAuth.ts');
const { aucklandToday } = await import('../debts/model.ts');
const { fifSummary, setFifClassOverride } = await import('./store.ts');
const { default: fifRouter } = await import('../routes/fif.ts');

const userA = 'fif_user_a';
const userB = 'fif_user_b';
const now = '2027-05-10T00:00:00.000Z';
const db = await getDb();
for (const [id, email] of [[userA, 'a@example.com'], [userB, 'b@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [id, email, 'hash', now, now]);
}

function holding(id: string, symbol: string, exchange: string, costNzd: number | null, acquiredAt: string | null, user = userA): void {
  run(
    db,
    `INSERT INTO holdings (id, user_id, asset_class, name, symbol, exchange, shares, cost_basis_nzd, acquired_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, user, 'stock', symbol, symbol, exchange, 100, costNzd, acquiredAt, now, now],
  );
}
function snapshot(id: string, takenAt: string, values: Record<string, number>, user = userA): void {
  const holdings = Object.entries(values).map(([hid, valueNzd]) => ({ id: hid, label: hid, assetClass: 'stock', valueNzd }));
  run(
    db,
    `INSERT INTO valuation_snapshots (id, user_id, taken_at, total_nzd, breakdown_json, notes, kind) VALUES (?,?,?,?,?,?,?)`,
    [id, user, takenAt, 0, JSON.stringify({ holdings }), null, 'auto'],
  );
}
function dividend(id: string, holdingId: string, date: string, gross: number, currency: string, fx: number | null): void {
  run(
    db,
    `INSERT INTO dividend_events (id, user_id, holding_id, company_name, shares_held, dividend_per_share, gross_dividend, net_dividend, payment_date, currency, fx_rate_to_nzd, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userA, holdingId, holdingId, 100, gross / 100, gross, gross, date, currency, fx, now, now],
  );
}

// Foreign: AAPL $40k held all along, MSFT $15k bought 1 September 2026 → $55k from then on.
// Not FIF: BHP on the ASX ($40k) and AIR on the NZX ($10k).
holding('h_aapl', 'AAPL', 'NASDAQ', 40_000, null);
holding('h_msft', 'MSFT', 'NASDAQ', 15_000, '2026-09-01');
holding('h_bhp', 'BHP', 'ASX', 40_000, null);
holding('h_air', 'AIR', 'NZX', 10_000, null);
holding('h_other', 'NVDA', 'NASDAQ', 900_000, null, userB);
// 1 April 2026 09:00 Auckland and 31 March 2027 11:00 Auckland.
snapshot('s_open', '2026-03-31T20:00:00.000Z', { h_aapl: 60_000, h_bhp: 45_000, h_air: 11_000 });
snapshot('s_close', '2027-03-30T22:00:00.000Z', { h_aapl: 62_000, h_msft: 14_000, h_bhp: 47_000 });
// A snapshot after 1 April isn't the opening value.
snapshot('s_late', '2026-04-03T00:00:00.000Z', { h_aapl: 99_999 });
dividend('d1', 'h_aapl', '2026-08-01', 100, 'USD', 1.7);
dividend('d2', 'h_msft', '2026-11-01', 50, 'USD', null);
dividend('d3', 'h_aapl', '2025-10-01', 50, 'NZD', null);

// 2026/27, after the year has ended.
const s = fifSummary(db, userA, 2026, '2027-05-10');
eq(s.start, '2026-04-01', 'year starts 1 April 2026');
eq(s.yearEnded, true, 'the year has ended');
eq(s.peakCostNzd, 55_000, 'peak cost is AAPL + MSFT; ASX and NZX are left out');
eq(s.peakCostDate, '2026-09-01', 'peak reached when MSFT was bought');
eq(s.applies, true, 'FIF applies for the whole year');
eq(s.openingSnapshotDate, '2026-04-01', 'opening snapshot is 1 April');
eq(s.closingSnapshotDate, '2027-03-31', 'closing snapshot is 31 March');
const aapl = s.holdings.find((h) => h.id === 'h_aapl');
const msft = s.holdings.find((h) => h.id === 'h_msft');
const bhp = s.holdings.find((h) => h.id === 'h_bhp');
eq(aapl?.openingValueNzd, 60_000, 'AAPL opening value from the 1 April snapshot');
eq(aapl?.dividendsNzd, 170, 'USD 100 at 1.7 is NZD 170');
eq(aapl?.fdrIncomeNzd, 3_000, 'AAPL FDR is 5% of $60,000');
eq(aapl?.cvIncomeNzd, 2_170, 'AAPL CV is 62,000 + 170 − 60,000');
eq(msft?.openingValueNzd, 0, 'MSFT bought in the year opens at 0');
eq(msft?.fdrIncomeNzd, 0, 'MSFT has no FDR income');
eq(msft?.cvIncomeNzd, -1_000, 'MSFT CV is 14,000 − 15,000 cost');
eq(bhp?.fifClass, 'asx_exempt', 'BHP is ASX-exempt');
eq(bhp?.fdrIncomeNzd, null, 'exempt holdings have no FIF income');
eq(s.fdrTotalNzd, 3_000, 'FDR total is $3,000');
eq(s.cvTotalNzd, 1_170, 'CV total is $1,170');
eq(s.method, 'cv', 'CV is lower, so it is used');
eq(s.fifIncomeNzd, 1_170, 'FIF income is $1,170');
eq(s.dividendsTaxableNzd, 0, 'dividends are inside FIF income');
assert(s.notes.some((n) => n.includes('no exchange rate')), 'the dividend without FX is called out');
assert(s.notes.some((n) => n.includes('sales aren’t recorded')), 'missing sales are called out');
eq(s.sourceLabel, 'IRD IR461 Guide to foreign investment funds', 'names the IRD source');

// Overrides: BHP counted as a FIF (no franking account) and MSFT marked not a FIF.
eq(setFifClassOverride(db, userA, 'h_bhp', { override: 'fif' }).ok, true, 'BHP override saved');
eq(setFifClassOverride(db, userA, 'h_msft', { override: 'exempt' }).ok, true, 'MSFT override saved');
let o = fifSummary(db, userA, 2026, '2027-05-10');
eq(o.holdings.find((h) => h.id === 'h_bhp')?.fifClass, 'fif', 'BHP now counts');
eq(o.holdings.find((h) => h.id === 'h_bhp')?.autoClass, 'asx_exempt', 'automatic class still shown');
eq(o.holdings.find((h) => h.id === 'h_msft')?.fifClass, 'user_exempt', 'MSFT left out');
eq(o.peakCostNzd, 80_000, 'peak cost is AAPL + BHP');
eq(setFifClassOverride(db, userA, 'h_bhp', { override: 'maybe' }).ok, false, 'bad value refused');
eq(setFifClassOverride(db, userB, 'h_bhp', { override: 'fif' }).ok, false, "another user's holding is not found");
eq(setFifClassOverride(db, userA, 'h_bhp', { override: null }).ok, true, 'BHP back to automatic');
eq(setFifClassOverride(db, userA, 'h_msft', { override: null }).ok, true, 'MSFT back to automatic');
o = fifSummary(db, userA, 2026, '2027-05-10');
eq(o.peakCostNzd, 55_000, 'back to AAPL + MSFT');
eq(o.holdings.find((h) => h.id === 'h_bhp')?.override, null, 'no override after clearing');

// 2025/26: only AAPL ($40k) existed — under the threshold, dividends taxed as received.
const prior = fifSummary(db, userA, 2025, '2027-05-10');
eq(prior.peakCostNzd, 40_000, 'MSFT bought after 2025/26 is left out');
eq(prior.applies, false, '$40,000 is under the threshold');
eq(prior.method, null, 'no FIF method applies');
eq(prior.dividendsTaxableNzd, 50, 'the 2025/26 dividend is taxable as received');
eq(prior.fifIncomeNzd, 0, 'no FIF income under the threshold');

// Current year: no closing value yet, so FDR only.
const current = fifSummary(db, userA, 2026, '2026-10-18');
eq(current.yearEnded, false, 'the year is still running');
eq(current.closingSnapshotDate, null, 'no closing snapshot before the year ends');
eq(current.cvTotalNzd, null, 'CV is unknown mid-year');
eq(current.method, 'fdr', 'FDR is used mid-year');
eq(current.fifIncomeNzd, 3_000, 'mid-year FIF income is FDR on the opening value');

// No opening snapshot: FDR can't see the opening values and says so.
const noSnap = fifSummary(db, userB, 2026, '2026-10-18');
eq(noSnap.openingSnapshotDate, null, 'user B has no snapshot');
eq(noSnap.holdings.length, 1, 'user B only sees their own holding');
eq(noSnap.holdings[0].fdrIncomeNzd, null, 'FDR is unknown without an opening value');
assert(noSnap.notes.some((n) => n.includes('no valuation snapshot')), 'the missing snapshot is called out');

// HTTP.
const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api/fif', fifRouter);
const server = await new Promise<Server>((resolve) => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  const session = await createSession(userA);
  const cookie = `${SESSION_COOKIE}=${session.rawToken}`;
  const ok = await fetch(`${base}/api/fif/summary?taxYear=2026`, { headers: { Cookie: cookie } });
  eq(ok.status, 200, 'summary is 200');
  const body = (await ok.json()) as { peakCostNzd?: number; applies?: boolean; fdrTotalNzd?: number };
  const expected = fifSummary(db, userA, 2026, aucklandToday());
  eq(body.peakCostNzd, expected.peakCostNzd, 'HTTP peak cost matches');
  eq(body.applies, expected.applies, 'HTTP threshold matches');
  eq(body.fdrTotalNzd, expected.fdrTotalNzd, 'HTTP FDR matches');
  eq((await fetch(`${base}/api/fif/summary?taxYear=26`, { headers: { Cookie: cookie } })).status, 400, 'a short taxYear is 400');
  eq((await fetch(`${base}/api/fif/summary?taxYear=2999`, { headers: { Cookie: cookie } })).status, 400, 'a future taxYear is 400');
  eq((await fetch(`${base}/api/fif/summary`)).status, 401, 'signed out is 401');
  const put = (id: string, override: unknown) =>
    fetch(`${base}/api/fif/classes/${id}`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ override }) });
  eq((await put('h_bhp', 'fif')).status, 200, 'PUT override is 200');
  eq((await put('h_other', 'fif')).status, 404, "PUT on another user's holding is 404");
  eq((await put('h_bhp', 'nope')).status, 400, 'PUT a bad value is 400');
  eq((await put('h_bhp', null)).status, 200, 'PUT null clears it');
  console.log('fif store tests passed');
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  for (const suffix of ['', '.tmp', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
