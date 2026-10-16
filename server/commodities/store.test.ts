/**
 * Commodities (KAN-81): add from the picklist and free text, validation, value and return, a blank
 * cost as $0, no price → dash and not counted, stale values, net worth and holdings, Free vs Plus in
 * the cycle mix, isolation and account deletion. Run: npm run test:commodities
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-commodities-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');
process.env.AUTH_ENCRYPTION_KEY = 'c'.repeat(64);
process.env.PLAN_PLUS_EMAILS = 'pam@example.com';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryAll } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { computeNetWorth } = await import('../lib/netWorth.ts');
const { deleteScopedDataForUser } = await import('../lib/userScope.ts');
const { aucklandToday } = await import('../debts/model.ts');
const { listCommodities } = await import('./store.ts');
const { cycleMix } = await import('../../src/lib/cycleMix.ts');
const { default: commoditiesRouter } = await import('../routes/commodities.ts');

const now = '2026-10-05T00:00:00.000Z';
const db = await getDb();
for (const id of ['pam', 'fred']) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, last_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, [id, `${id}@example.com`, 'h', id, 'Test', now, now]);
}

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/commodities', commoditiesRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/commodities`;
type Json = Record<string, any>;
async function call(method: string, p: string, cookie: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { Accept: 'application/json', Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}

const today = aucklandToday();
const daysAgo = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

const copper = { name: '', preset: 'copper_bright', category: 'industrial_metals', quantity: 250, unit: 'kg', costNzd: 2500, priceNzd: 12.4, priceBasis: 'unit', valueOn: daysAgo(3), notes: 'Yard quote' };
const honey = { name: '', preset: 'manuka_honey', category: 'agriculture', quantity: 300, unit: 'kg', costNzd: null, priceNzd: 9000, priceBasis: 'total', valueOn: daysAgo(45), notes: '' };
const logs = { name: 'Pine logs', preset: null, category: 'other', quantity: 12, unit: 't', costNzd: 1500, priceNzd: null, priceBasis: 'unit', valueOn: null, notes: '' };

try {
  const P = `${SESSION_COOKIE}=${(await createSession('pam')).rawToken}`;
  const F = `${SESSION_COOKIE}=${(await createSession('fred')).rawToken}`;

  // Validation.
  for (const [body, why] of [
    [{ ...copper, quantity: 0 }, 'quantity must be more than 0'],
    [{ ...copper, quantity: -3 }, 'negative quantity'],
    [{ ...copper, costNzd: -1 }, 'negative cost'],
    [{ ...copper, priceNzd: -1 }, 'negative price'],
    [{ ...copper, category: 'metals' }, 'category checked'],
    [{ ...copper, unit: 'furlong' }, 'unit checked'],
    [{ ...copper, preset: 'gold' }, 'unknown preset (gold is in Metals)'],
    [{ ...logs, name: '' }, 'free text needs a name'],
    [{ ...copper, valueOn: null }, 'a price needs its date'],
    [{ ...copper, valueOn: daysAgo(-2) }, 'no future price dates'],
  ] as const) assert((await call('POST', '/', P, body)).status === 400, why);

  // Picklist item: name from the preset, value = quantity × price, return on cost.
  let r = await call('POST', '/', P, copper);
  assert(r.status === 201, `copper ${JSON.stringify(r.json)}`);
  const cu = r.json.commodities[0];
  assert(cu.name === 'Bright copper' && cu.preset === 'copper_bright', 'name from the picklist');
  assert(cu.valueNzd === 3100 && cu.returnNzd === 600 && cu.returnPct === 24 && cu.stale === false && cu.ageDays === 3, `copper figures ${JSON.stringify(cu)}`);

  // A total value, blank cost ($0), 45 days old → stale.
  r = await call('POST', '/', P, honey);
  const h = r.json.commodities.find((c: Json) => c.preset === 'manuka_honey');
  assert(h.valueNzd === 9000 && h.unitPriceNzd === 30 && h.returnNzd === 9000 && h.costNzd === null, 'total value, blank cost as $0');
  assert(h.stale === true && h.ageDays === 45, 'old price flagged');

  // Free text with no price: a dash, not counted, cost not netted into the return.
  r = await call('POST', '/', P, logs);
  const l = r.json.commodities.find((c: Json) => c.name === 'Pine logs');
  assert(l.valueNzd === null && l.returnNzd === null && l.stale === false, 'no price → no value');
  assert(r.json.totals.valueNzd === 12100 && r.json.totals.costNzd === 2500 && r.json.totals.returnNzd === 9600, `totals ${JSON.stringify(r.json.totals)}`);
  assert(r.json.totals.unvalued === 1 && r.json.totals.stale === 1, 'unvalued and stale counts');
  assert(r.json.plus === true, 'Pam is on Plus');

  // Updating the price clears the stale flag; the date goes with it.
  r = await call('PUT', `/${h.id}`, P, { ...honey, priceNzd: 30, priceBasis: 'unit', valueOn: today });
  const h2 = r.json.commodities.find((c: Json) => c.id === h.id);
  assert(h2.valueNzd === 9000 && h2.stale === false, 'refreshed price');
  r = await call('PUT', `/${l.id}`, P, { ...logs, valueOn: today });
  assert(r.json.commodities.find((c: Json) => c.id === l.id).valueOn === null, 'no price, no price date');

  // Net worth: only valued holdings; each is a holding point for the asset mix.
  let nw = await computeNetWorth(db, 'pam');
  assert(nw.commoditiesNzd === 12100, `net worth commodities ${nw.commoditiesNzd}`);
  assert(nw.breakdown.byClass.commodities === 12100, 'in byClass for History');
  assert(nw.breakdown.holdings.filter((p) => p.assetClass === 'commodity').length === 2, 'two valued holdings');
  assert(nw.commoditiesExposure === true, 'Plus: exposure on');
  let mix = cycleMix(nw, () => true)!;
  assert(mix.covered.find((c) => c.id === 'commodities')?.valueNzd === 12100, 'Plus: in the cycle’s Commodities');
  assert(cycleMix(nw, (p) => p !== 'commodities')?.covered.find((c) => c.id === 'commodities') == null, 'hidden class left out');

  // Free: add and value, counted in net worth, but not in the cycle mix.
  r = await call('POST', '/', F, copper);
  assert(r.status === 201 && r.json.plus === false, 'free can add');
  nw = await computeNetWorth(db, 'fred');
  assert(nw.commoditiesNzd === 3100 && nw.commoditiesExposure === false, 'free: in net worth, no exposure');
  mix = cycleMix(nw, () => true)!;
  assert(mix == null || !mix.covered.some((c) => c.id === 'commodities'), 'free: not in the cycle mix');

  // Isolation.
  assert((await call('PUT', `/${cu.id}`, F, copper)).status === 404, 'another user can’t edit');
  assert((await call('DELETE', `/${cu.id}`, F)).status === 404, 'or delete');
  assert(!JSON.stringify((await call('GET', '/', F)).json).includes('Pine logs'), 'or see');
  assert(listCommodities(db, 'fred').commodities.length === 1, 'Fred sees only his');

  // Delete one.
  r = await call('DELETE', `/${l.id}`, P);
  assert(r.status === 200 && r.json.commodities.length === 2, 'deleted');

  // Account deletion.
  deleteScopedDataForUser(db, 'pam');
  assert(!queryAll(db, `SELECT 1 FROM commodities WHERE user_id = 'pam'`).length, 'removed with the account');
  assert(queryAll(db, `SELECT 1 FROM commodities WHERE user_id = 'fred'`).length === 1, 'others keep theirs');
  nw = await computeNetWorth(db, 'pam');
  assert(nw.commoditiesNzd === null, 'no commodities line after deletion');
  console.log('commodities store tests passed');
} finally {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
