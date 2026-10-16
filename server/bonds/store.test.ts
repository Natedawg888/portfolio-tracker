/**
 * Bonds and term deposits (KAN-80): add a TD and a govt bond, value and next coupon, validation,
 * a paid coupon in Income once (linked to the bank deposit), skipping and recording amounts,
 * Free vs Plus, a TD linked to a synced account not counted twice, net worth and exposure,
 * maturity alerts, repaid and rolled over, projection flows, isolation and account deletion.
 * Run: npm run test:bonds
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-bonds-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');
process.env.AUTH_ENCRYPTION_KEY = 'b'.repeat(64);
process.env.PLAN_PLUS_EMAILS = 'pam@example.com';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryAll, queryOne } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { computeNetWorth } = await import('../lib/netWorth.ts');
const { deleteScopedDataForUser } = await import('../lib/userScope.ts');
const { listBonds, syncBondIncome, bondProjectionFlows } = await import('./store.ts');
const { cycleMix } = await import('../../src/lib/cycleMix.ts');
const { default: bondsRouter } = await import('../routes/bonds.ts');

const now = '2026-10-05T00:00:00.000Z';
const db = await getDb();
for (const id of ['pam', 'fred']) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, last_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, [id, `${id}@example.com`, 'h', id, 'Test', now, now]);
}
const acct = (id: string, user: string, type: string, balance: number) =>
  run(db, `INSERT INTO bank_accounts (id, user_id, name, account_type, currency, balance, created_at, updated_at) VALUES (?,?,?,?, 'NZD', ?, ?, ?)`, [id, user, id, type, balance, now, now]);
acct('everyday', 'pam', 'cheque', 1000);
acct('asb_td', 'pam', 'term_deposit', 15000);
acct('fred_td', 'fred', 'term_deposit', 5000);
// The coupon lands a day after its date.
run(db, `INSERT INTO transactions (id, user_id, account_id, date, description, amount, kind, currency, source, created_at) VALUES ('t_coupon','pam','everyday','2026-11-16','NZDMO INTEREST',150.75,'credit','NZD','manual',?)`, [now]);

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/bonds', bondsRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/bonds`;
type Json = Record<string, any>;
async function call(method: string, p: string, cookie: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { Accept: 'application/json', Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}

const govt = {
  name: 'NZ Govt 4.5% 2029', kind: 'govt', faceValue: 10000, purchasePrice: 9800, purchaseDate: '2026-10-01', ratePct: 4.5,
  frequency: 'half_yearly', maturityDate: '2029-05-15', currency: 'NZD', code: 'nzgovdt529', rwtPct: 33, valueAmount: null, valueOn: null, linkedAccountId: null, notes: '',
};
const td = { ...govt, name: 'Kiwibank 6-month TD', kind: 'td', faceValue: 20000, purchasePrice: 20000, ratePct: 5, frequency: 'maturity', maturityDate: '2027-04-01', code: '', rwtPct: null };

try {
  const P = `${SESSION_COOKIE}=${(await createSession('pam')).rawToken}`;
  const F = `${SESSION_COOKIE}=${(await createSession('fred')).rawToken}`;

  // Validation.
  for (const [body, why] of [
    [{ ...govt, faceValue: -1 }, 'negative face value'],
    [{ ...govt, purchasePrice: -5 }, 'negative price'],
    [{ ...govt, maturityDate: '2026-09-01' }, 'maturity before purchase'],
    [{ ...govt, maturityDate: '2026-10-01' }, 'maturity on the purchase date'],
    [{ ...govt, rwtPct: 25 }, 'RWT must be an IRD rate'],
    [{ ...govt, kind: 'stock' }, 'kind checked'],
    [{ ...govt, linkedAccountId: 'asb_td' }, 'only a TD can be linked'],
    [{ ...td, linkedAccountId: 'fred_td' }, 'can’t link someone else’s account'],
    [{ ...td, linkedAccountId: 'everyday' }, 'only a term-deposit account'],
  ] as const) assert((await call('POST', '/', P, body)).status === 400, why);

  // A TD and a govt bond: value and next coupon.
  let r = await call('POST', '/', P, govt);
  assert(r.status === 201, `govt bond ${JSON.stringify(r.json)}`);
  r = await call('POST', '/', P, td);
  const g = r.json.bonds.find((b: Json) => b.kind === 'govt');
  const t = r.json.bonds.find((b: Json) => b.kind === 'td');
  assert(g.value === 9800 && g.valueSource === 'cost' && g.code === 'NZGOVDT529', 'bond at cost');
  assert(g.nextCoupon.date === '2026-11-15' && g.nextCoupon.net === 150.75, 'next coupon after RWT');
  assert(t.nextCoupon.date === '2027-04-01' && t.nextCoupon.net === 498.63, 'TD interest at maturity');
  assert(r.json.totals.valueNzd === 29800 && r.json.totals.bondsNzd === 9800 && r.json.totals.termDepositsNzd === 20000, 'totals');
  assert(r.json.plus && r.json.calendar.length >= 2 && r.json.calendar[0].date === '2026-11-15', 'Plus: calendar');

  // A recorded value replaces cost; never an estimate.
  r = await call('PUT', `/${g.id}`, P, { ...govt, valueAmount: 9950, valueOn: '2026-10-10' });
  assert(r.json.bonds.find((b: Json) => b.id === g.id).value === 9950, 'recorded value');

  // Net worth and exposure.
  let nw = await computeNetWorth(db, 'pam');
  assert(nw.bondsNzd === 29950 && nw.bondsTermDepositsNzd === 20000, `net worth bonds ${nw.bondsNzd}`);
  const mix = cycleMix(nw, () => true)!;
  assert(mix.covered.find((c) => c.id === 'bonds')?.valueNzd === 9950, 'bond in the cycle’s Bonds');
  assert(mix.covered.find((c) => c.id === 'cash')?.valueNzd === 1000 + 15000 + 20000, 'TD in Cash / term deposits');

  // A TD that is the synced ASB account isn't counted again.
  r = await call('POST', '/', P, { ...td, name: 'ASB TD', linkedAccountId: 'asb_td' });
  const linked = r.json.bonds.find((b: Json) => b.name === 'ASB TD');
  assert(linked.countedInCash && linked.linkedAccountName === 'asb_td', 'linked TD');
  assert((await computeNetWorth(db, 'pam')).bondsNzd === 29950, 'linked TD not added to net worth twice');

  // The paid coupon goes into Income once, linked to the deposit.
  syncBondIncome(db, 'pam', '2026-11-20');
  let inc = queryAll<{ amount_nzd: number; transaction_id: string | null; bond_coupon_ref: string }>(db, `SELECT amount_nzd, transaction_id, bond_coupon_ref FROM income_records WHERE user_id = 'pam' AND bond_coupon_ref IS NOT NULL`);
  assert(inc.length === 1 && inc[0].amount_nzd === 150.75 && inc[0].transaction_id === 't_coupon', `coupon in Income, linked ${JSON.stringify(inc)}`);
  syncBondIncome(db, 'pam', '2026-11-20');
  assert(queryAll(db, `SELECT 1 FROM income_records WHERE user_id = 'pam' AND bond_coupon_ref IS NOT NULL`).length === 1, 'not added twice');
  assert(!queryAll(db, `SELECT 1 FROM income_records WHERE bond_coupon_ref LIKE ?`, [`${t.id}:%`]).length, 'TD interest not due yet');

  // Recording a different amount, skipping and restoring.
  r = await call('PUT', `/${g.id}/coupons/2026-11-20`, P, { skipped: true });
  assert(r.status === 400, 'only real coupon dates');
  // Routes sync as of the real date; re-sync as of 20 Nov, after the coupon.
  await call('PUT', `/${g.id}/coupons/2026-11-15`, P, { netAmount: 150 });
  syncBondIncome(db, 'pam', '2026-11-20');
  inc = queryAll(db, `SELECT amount_nzd, transaction_id FROM income_records WHERE bond_coupon_ref = ?`, [`${g.id}:2026-11-15`]);
  assert(inc[0].amount_nzd === 150 && inc[0].transaction_id === null, 'recorded amount; no longer matches the deposit');
  await call('PUT', `/${g.id}/coupons/2026-11-15`, P, { skipped: true });
  syncBondIncome(db, 'pam', '2026-11-20');
  assert(!queryOne(db, `SELECT 1 FROM income_records WHERE bond_coupon_ref = ?`, [`${g.id}:2026-11-15`]), 'skipped: out of Income');
  await call('PUT', `/${g.id}/coupons/2026-11-15`, P, { skipped: false, netAmount: null });
  syncBondIncome(db, 'pam', '2026-11-20');
  inc = queryAll(db, `SELECT amount_nzd, transaction_id FROM income_records WHERE bond_coupon_ref = ?`, [`${g.id}:2026-11-15`]);
  assert(inc.length === 1 && inc[0].transaction_id === 't_coupon', 'restored and relinked');

  // Maturity alerts (Plus), repaid and rolled over.
  let v = listBonds(db, 'pam', '2027-03-10');
  assert(v.alerts!.some((a) => a.name === 'Kiwibank 6-month TD' && a.level === '30'), 'TD matures within 30 days');
  v = listBonds(db, 'pam', '2027-04-05');
  assert(v.alerts!.some((a) => a.name === 'Kiwibank 6-month TD' && a.level === 'matured'), 'matured, not closed');
  r = await call('POST', `/${t.id}/rollover`, P, { ...td, purchaseDate: '2027-04-01', maturityDate: '2027-10-01', ratePct: 4.6 });
  assert(r.status === 201 && r.json.bonds.find((b: Json) => b.id === t.id).status === 'rolled', 'rolled over');
  assert(r.json.bonds.some((b: Json) => b.rolledFromId === t.id && b.ratePct === 4.6 && b.status === 'active'), 'new term');
  assert((await call('POST', `/${t.id}/repaid`, P, {})).status === 409, 'already closed');
  r = await call('POST', `/${linked.id}/repaid`, P, { on: '2027-04-01' });
  assert(r.json.bonds.find((b: Json) => b.id === linked.id).status === 'repaid', 'repaid');

  // Projections (Plus): coupons and principal back in cash, value leaving at maturity.
  const flows = bondProjectionFlows(db, 'pam', '2026-10-16', 12)!;
  assert(flows.couponsNzd[0] === 150.75, `Nov coupon in month 1 (${flows.couponsNzd.slice(0, 3)})`);
  assert(flows.couponsNzd[6] === 150.75, 'May coupon in month 7');
  assert(flows.couponsNzd[5] === 498.63, `the rolled TD’s interest on 1 Apr 2027 (month 6): ${flows.couponsNzd[5]}`);
  assert(flows.principalNzd[11] === 20000 && flows.maturedValueNzd[11] === 20000, 'the new TD’s principal back in Oct 2027 (month 12)');
  assert(flows.couponsNzd[11] === 461.26, 'and its interest: 20,000 × 4.6% × 183 ÷ 365');
  assert(flows.principalNzd.slice(0, 11).every((n) => n === 0), 'no other principal in the year');

  // Free: bonds counted, no calendar, alerts or Income.
  r = await call('POST', '/', F, govt);
  assert(r.status === 201 && r.json.plus === false && r.json.calendar === null && r.json.alerts === null, 'free: no calendar or alerts');
  syncBondIncome(db, 'fred', '2026-11-20');
  assert(!queryAll(db, `SELECT 1 FROM income_records WHERE user_id = 'fred' AND bond_coupon_ref IS NOT NULL`).length, 'free: no Income');
  assert((await call('PUT', `/${r.json.bonds[0].id}/coupons/2026-11-15`, F, { skipped: true })).status === 402, 'free: calendar is Plus');
  assert(bondProjectionFlows(db, 'fred', '2026-10-16', 12) === null, 'free: no projection flows');
  assert((await computeNetWorth(db, 'fred')).bondsNzd === 9800, 'free: still in net worth');

  // Isolation.
  assert((await call('PUT', `/${g.id}`, F, govt)).status === 404, 'another user can’t edit');
  assert((await call('DELETE', `/${g.id}`, F)).status === 404, 'or delete');
  assert(!JSON.stringify((await call('GET', '/', F)).json).includes('Kiwibank'), 'or see');

  // Deleting a bond removes its Income rows; the bank deposit stays.
  await call('DELETE', `/${g.id}`, P);
  assert(!queryAll(db, `SELECT 1 FROM income_records WHERE bond_coupon_ref LIKE ?`, [`${g.id}:%`]).length, 'Income rows gone');
  assert(queryOne(db, `SELECT 1 FROM transactions WHERE id = 't_coupon'`), 'deposit stays');

  // Account deletion.
  deleteScopedDataForUser(db, 'pam');
  assert(!queryAll(db, `SELECT 1 FROM bonds WHERE user_id = 'pam'`).length && !queryAll(db, `SELECT 1 FROM bond_coupons WHERE user_id = 'pam'`).length, 'removed with the account');
  assert(queryAll(db, `SELECT 1 FROM bonds WHERE user_id = 'fred'`).length === 1, 'others keep theirs');
  nw = await computeNetWorth(db, 'pam');
  assert(nw.bondsNzd === null, 'no bonds line after deletion');
  console.log('bonds tests passed');
} finally {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
