/**
 * Vehicles (KAN-65): add a vehicle, its value counts in net worth (or not), a loan entered on it
 * is taken off, a loan linked to a bank loan account isn't taken off twice, running costs and
 * cost to own add up, validation, isolation, and account deletion.
 * Run: npm run test:vehicles
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-vehicles-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');
process.env.AUTH_ENCRYPTION_KEY = 'b'.repeat(64);

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryAll, queryOne } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { computeNetWorth } = await import('../lib/netWorth.ts');
const { deleteScopedDataForUser } = await import('../lib/userScope.ts');
const { costToOwn, depreciatedValue, distancePerYear, IRD_CAR_DEPRECIATION } = await import('../../src/lib/vehicles.ts');
const { default: vehiclesRouter } = await import('../routes/vehicles.ts');

// Cost maths: $60 fuel a week, $90 insurance a month, $120 rego a year, $250 loan a fortnight.
const c = costToOwn(
  [
    { kind: 'fuel', amountNzd: 60, frequency: 'week' },
    { kind: 'insurance', amountNzd: 90, frequency: 'month' },
    { kind: 'registration', amountNzd: 120, frequency: 'year' },
  ],
  { amountNzd: 250, frequency: 'fortnight' },
);
assert(c.running.year === 4320 && c.running.month === 360 && c.loan.year === 6500 && c.total.year === 10820 && c.total.week === 208.08, `cost to own ${JSON.stringify(c)}`);

// Depreciation: $24,000 at 30% a year diminishing value over exactly 4 years (1,461 days) = 24,000 × 0.7⁴.
const dep = depreciatedValue(24000, '2021-01-01', 30, '2025-01-01');
assert(dep && dep.valueNzd === 5762.4 && dep.years === 4, `depreciation ${JSON.stringify(dep)}`);
assert(depreciatedValue(24000, '2025-01-01', 30, '2025-01-01')?.valueNzd === 24000, 'no time, no depreciation');
assert(depreciatedValue(24000, '2026-01-01', 30, '2025-01-01') === null, 'bought after the date: no estimate');
assert(depreciatedValue(0, '2021-01-01', 30, '2025-01-01') === null, 'no price: no estimate');
assert(IRD_CAR_DEPRECIATION.ratePct === 30, 'IRD car rate (s EE 25D)');
// Distance: 50,000 when bought, 98,000 four years later = 12,000 a year.
assert(distancePerYear(98000, '2025-01-01', 50000, '2021-01-01') === 12000, 'distance a year');
assert(distancePerYear(98000, '2021-02-01', 50000, '2021-01-01') === null, 'too soon to tell');
assert(distancePerYear(null, '2025-01-01', 50000, '2021-01-01') === null, 'no reading');

const now = '2026-10-05T00:00:00.000Z';
const db = await getDb();
for (const id of ['val', 'wes']) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, last_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, [id, `${id}@example.com`, 'h', id, 'Test', now, now]);
}
const acct = (id: string, user: string, type: string, balance: number) =>
  run(db, `INSERT INTO bank_accounts (id, user_id, name, account_type, currency, balance, created_at, updated_at) VALUES (?,?,?,?, 'NZD', ?, ?, ?)`, [id, user, id, type, balance, now, now]);
acct('everyday', 'val', 'cheque', 1000);
acct('carloan', 'val', 'loan', -8000);
acct('wes_loan', 'wes', 'loan', -500);

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/vehicles', vehiclesRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/vehicles`;
type Json = Record<string, any>;
async function call(method: string, p: string, cookie: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { Accept: 'application/json', Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}
const nw = async (u = 'val') => (await computeNetWorth(db, u)).totalKnownNzd;

const car = {
  name: 'The Corolla', kind: 'car', make: 'Toyota', model: 'Corolla', year: 2018, plate: 'abc123',
  purchaseDate: '2022-05-01', purchasePriceNzd: 24000, valueNzd: 20000, valuedOn: '2026-10-01', countInNetWorth: true,
  loan: { kind: 'manual', accountId: null, balanceNzd: 8000, lender: 'UDC', ratePct: 9.9, repaymentNzd: 250, repaymentFrequency: 'fortnight' },
  runningCosts: [
    { kind: 'fuel', amountNzd: 60, frequency: 'week' },
    { kind: 'insurance', amountNzd: 90, frequency: 'month' },
    { kind: 'registration', amountNzd: 120, frequency: 'year' },
    { kind: 'wof', amountNzd: 0, frequency: 'year' },
  ],
  notes: '',
};

try {
  const V = `${SESSION_COOKIE}=${(await createSession('val')).rawToken}`;
  const W = `${SESSION_COOKIE}=${(await createSession('wes')).rawToken}`;
  const base0 = await nw();
  assert(base0 === -7000, `before: $1,000 cash − $8,000 loan account (${base0})`);
  assert((await computeNetWorth(db, 'val')).vehiclesNzd === null, 'no vehicles: no vehicle line');

  // Validation.
  assert((await call('POST', '/', V, { ...car, name: '' })).status === 400, 'name required');
  assert((await call('POST', '/', V, { ...car, valueNzd: -1 })).status === 400, 'no negative value');
  assert((await call('POST', '/', V, { ...car, loan: { ...car.loan, balanceNzd: null } })).status === 400, 'a loan entered needs a balance');
  assert((await call('POST', '/', V, { ...car, loan: { kind: 'account', accountId: 'everyday' } })).status === 400, 'a linked loan must be a loan account');
  assert((await call('POST', '/', V, { ...car, loan: { kind: 'account', accountId: 'wes_loan' } })).status === 400, 'and yours');
  assert((await call('POST', '/', V, { ...car, year: 1700 })).status === 400, 'year checked');
  assert((await call('POST', '/', V, { ...car, runningCosts: [{ kind: 'jetpack', amountNzd: 1, frequency: 'week' }] })).status === 400, 'cost kind checked');

  // Add: value counts, the loan entered is taken off.
  let r = await call('POST', '/', V, car);
  assert(r.status === 201, `created ${JSON.stringify(r.json)}`);
  const v = r.json;
  assert(v.plate === 'ABC123' && v.equityNzd === 12000 && v.loanOwedNzd === 8000, 'equity = value − loan');
  assert(v.runningCosts.length === 3, 'zero-amount costs are dropped');
  assert(v.costToOwn.total.year === 10820 && v.costToOwn.running.month === 360, 'cost to own');
  assert((await nw()) === base0 + 12000, 'net worth up by the equity');
  const full = await computeNetWorth(db, 'val');
  assert(full.vehiclesNzd === 20000 && full.vehicleLoansNzd === 8000 && full.vehiclesEquityNzd === 12000, 'net worth vehicle lines');
  assert(full.breakdown.byClass.vehicles === 20000 && full.breakdown.holdings.some((h) => h.assetClass === 'vehicle' && h.valueNzd === 12000), 'history breakdown');

  // Odometer and depreciation.
  assert((await call('PUT', `/${v.id}`, V, { ...car, odometer: { reading: 50000, atPurchase: 60000 } })).status === 400, 'reading when bought can’t be more than now');
  assert((await call('PUT', `/${v.id}`, V, { ...car, depreciationPct: 120 })).status === 400, 'rate checked');
  r = await call('PUT', `/${v.id}`, V, { ...car, purchaseDate: '2021-01-01', odometer: { reading: 98000, unit: 'mi', readOn: '2025-01-01', atPurchase: 50000 }, depreciationPct: 30 });
  assert(r.status === 200 && r.json.odometer.unit === 'mi' && r.json.odometer.reading === 98000, 'odometer saved in miles');
  assert(r.json.distance.perYear === 12000 && r.json.distance.unit === 'mi', 'distance a year');
  assert(r.json.distance.runningCostPerUnit === 0.36, `running cost per mile: 4,320 ÷ 12,000 (${r.json.distance.runningCostPerUnit})`);
  assert(r.json.estimate.ratePct === 30 && r.json.estimate.valueNzd > 0 && r.json.estimate.valueNzd < 24000, 'estimate from price and age');
  assert(r.json.valueNzd === 20000, 'the estimate never replaces the recorded value');
  r = await call('PUT', `/${v.id}`, V, car);
  assert(r.json.estimate === null && r.json.distance === null && r.json.odometer.unit === 'km', 'all optional');

  // Not counted.
  await call('PUT', `/${v.id}`, V, { ...car, countInNetWorth: false });
  assert((await nw()) === base0, 'switched off: out of net worth');
  // Counted, no value yet: nothing to add.
  await call('PUT', `/${v.id}`, V, { ...car, valueNzd: null });
  assert((await nw()) === base0 && (await computeNetWorth(db, 'val')).vehiclesNzd === null, 'no value: nothing added, no loan taken');

  // Loan linked to the bank loan account: value added, loan not taken off a second time.
  r = await call('PUT', `/${v.id}`, V, { ...car, loan: { kind: 'account', accountId: 'carloan', repaymentNzd: 250, repaymentFrequency: 'fortnight' } });
  assert(r.status === 200 && r.json.loanOwedNzd === 8000 && r.json.loanAccountName === 'carloan' && r.json.equityNzd === 12000, 'linked loan shows the account balance');
  assert((await nw()) === base0 + 20000, 'linked loan isn’t counted twice');
  assert((await computeNetWorth(db, 'val')).vehicleLoansNzd === 0, 'vehicle loans line is 0 (the account holds it)');

  // Isolation.
  assert((await call('GET', '/', W)).json.vehicles.length === 0, 'Wes sees no vehicles');
  assert((await call('PUT', `/${v.id}`, W, car)).status === 404, 'Wes can’t edit');
  assert((await call('DELETE', `/${v.id}`, W)).status === 404, 'Wes can’t delete');
  assert((await nw('wes')) === -500, 'Wes’s net worth doesn’t include Val’s car');

  // Totals and listing.
  await call('POST', '/', V, { ...car, name: 'Bike', kind: 'motorbike', valueNzd: 3000, loan: { kind: 'none' }, runningCosts: [] });
  r = await call('GET', '/', V);
  assert(r.json.totals.count === 2 && r.json.totals.valueNzd === 23000 && r.json.totals.equityNzd === 15000, `totals ${JSON.stringify(r.json.totals)}`);
  assert(r.json.loanAccounts.length === 1 && r.json.loanAccounts[0].id === 'carloan', 'only your loan accounts offered');

  // Deleting a vehicle leaves the bank loan account.
  assert((await call('DELETE', `/${v.id}`, V)).status === 200, 'deleted');
  assert(queryOne(db, `SELECT 1 FROM bank_accounts WHERE id = 'carloan'`), 'the loan account stays');
  assert((await nw()) === base0 + 3000, 'only the bike left');

  // Account deletion.
  deleteScopedDataForUser(db, 'val');
  assert(queryAll(db, `SELECT * FROM vehicles WHERE user_id = 'val'`).length === 0, 'vehicles go with the account');
  console.log('vehicles tests passed');
} finally {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
