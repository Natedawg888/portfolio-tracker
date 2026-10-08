/**
 * "Reinvest every payment" for a holding: each predicted payment buys more of the same
 * holding, so later payments grow, and every row reports what reinvesting added.
 * Run: npm run test:dividends
 *
 * Uses a throwaway sqlite file and a fake published-dividend loader (no network).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-reinvest-all-'));
process.env.DATABASE_PATH = path.join(tmp, 'portfolio.db');

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
let passed = 0;
const check = (cond: unknown, msg: string) => {
  assert(cond, msg);
  passed++;
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

const { getDb, run } = await import('../db/index.ts');
const { dashboardForUser, setForecastReinvest, setForecastReinvestAll } = await import('./store.ts');
type Loader = import('./store.ts').PublishedDividendLoader;

const db = await getDb();
const now = new Date().toISOString();
const userA = 'ra_user_a';
const userB = 'ra_user_b';
// 100 shares at NZ$10 (saved quote); NZ$0.50 per share, quarterly.
run(db, `INSERT INTO holdings (id, user_id, asset_class, name, symbol, shares, cost_basis_nzd, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`, [
  'ra_h_a', userA, 'stock', 'Alpha ETF', 'ALFA', 100, 1000, now, now,
]);
run(db, `INSERT INTO holdings (id, user_id, asset_class, name, symbol, shares, cost_basis_nzd, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`, [
  'ra_h_b', userB, 'stock', 'Bravo ETF', 'BRAV', 10, 100, now, now,
]);
run(db, `INSERT INTO price_quotes (id, asset_key, currency, price, status, source, as_of) VALUES (?,?,?,?,?,?,?)`, [
  'q_alfa', 'STOCK:ALFA', 'NZD', 10, 'ok', 'test', now,
]);
const loader: Loader = async () => ({
  source: 'yahoo',
  currency: 'NZD',
  payments: [
    { date: '2026-02-13', amountPerShare: 0.5 },
    { date: '2026-05-14', amountPerShare: 0.5 },
    { date: '2026-08-14', amountPerShare: 0.5 },
  ],
});
const today = '2026-10-04';
const dash = () => dashboardForUser(db, userA, 2026, today, loader);

try {
  const off = await dash();
  const offRows = off.forecast.detected;
  check(offRows.length === 4, 'four quarterly payments in the next 12 months');
  check(offRows.every((r) => near(r.amount, 50) && r.reinvestExtraShares === 0 && r.reinvestExtraNzd === 0), 'off: flat $50 a payment, nothing extra');
  check(off.forecast.reinvestAllHoldingIds?.length === 0, 'off: no holding reinvests everything');

  check(setForecastReinvestAll(db, userA, 'ra_h_a', true).ok, 'switch on');
  const on = await dash();
  const rows = on.forecast.detected;
  check(on.forecast.reinvestAllHoldingIds?.join() === 'ra_h_a', 'dashboard lists the holding');
  check(rows.every((r) => r.reinvested && r.reinvestment.status === 'applied'), 'every payment reinvested');
  // $50 buys 5 shares at $10 → 105 shares → $52.50 buys 5.25 → 110.25 → $55.125 …
  check(near(rows[0].amount, 50) && near(rows[0].reinvestExtraShares, 0), 'first payment unchanged');
  check(near(rows[1].projectedShares, 105) && near(rows[1].amount, 52.5), 'second payment grows');
  check(near(rows[2].projectedShares, 110.25) && near(rows[2].amount, 55.125), 'third compounds');
  check(near(rows[3].projectedShares, 115.7625) && near(rows[3].amount, 57.88125), 'fourth compounds');
  check(near(rows[3].reinvestExtraShares, 15.7625) && near(rows[3].reinvestExtraNzd!, 7.88125), 'extra shares and NZD reported');
  check(rows.every((r) => r.ownedShares === 100), 'owned shares unchanged');

  // A row's own toggle can't switch one payment off while everything is reinvested.
  await setForecastReinvest(db, userA, 'ra_h_a', rows[1].paymentDate, false, today, loader);
  check((await dash()).forecast.detected.every((r) => r.reinvested), 'holding-wide setting wins over a row');

  // Switch off → back to per-payment choices (none here).
  check(setForecastReinvestAll(db, userA, 'ra_h_a', false).ok, 'switch off');
  const back = (await dash()).forecast.detected;
  check(back.every((r) => !r.reinvested && near(r.amount, 50)), 'off again: flat');

  // Another user's holding can't be switched.
  const cross = setForecastReinvestAll(db, userA, 'ra_h_b', true);
  check(!cross.ok && cross.status === 404, 'other user’s holding refused');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`reinvestAll: ${passed} checks passed`);
