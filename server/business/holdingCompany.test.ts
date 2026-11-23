/**
 * Holding company (KAN-134): assigning Portfolio holdings to a business, the asset-class summary
 * from real values, owner-only assigning, isolation, and the view helpers.
 * Run: node --import tsx server/business/holdingCompany.test.ts
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-holdco-'));
process.env.DATABASE_PATH = path.join(dir, 'portfolio.db');
process.env.NODE_ENV = 'test';

const { getDb, queryOne, run } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser } = await import('../middleware/requireAuth.ts');
const { default: businessRouter } = await import('../routes/business.ts');
const { assignHolding, businessAssetClasses, businessHoldingOptions, groupByAssetClass } = await import('./holdingCompany.ts');
const { setPlan } = await import('../lib/entitlements.ts');
const { isBusinessType, businessTypeLabel } = await import('../../src/lib/business.ts');
const { groupHoldingOptions, holdingClassCountText, holdingClassesTotal } = await import('../../src/lib/holdingCompanyView.ts');

const db = await getDb();
const now = new Date().toISOString();
const A = 'hc_user_a';
const B = 'hc_user_b';
for (const [id, email] of [[A, 'hc-a@example.com'], [B, 'hc-b@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [id, email, 'hash', now, now]);
}
function business(id: string, user: string, type: string): void {
  run(db, `INSERT INTO businesses (id, user_id, name, type, created_at, updated_at) VALUES (?,?,?,?,?,?)`, [id, user, id, type, now, now]);
}
function holding(id: string, user: string, assetClass: string, extra: Record<string, unknown> = {}): void {
  const cols = ['id', 'user_id', 'asset_class', 'name', 'created_at', 'updated_at', ...Object.keys(extra)];
  run(db, `INSERT INTO holdings (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, [id, user, assetClass, id, now, now, ...Object.values(extra)] as never[]);
}
const noWallets = async () => ({ ok: false as const, error: 'none', code: 'none', retryAfterSec: null });

eq(isBusinessType('holding_company'), true, 'holding_company is a business type');
eq(businessTypeLabel('holding_company'), 'Holding company', 'label');

business('biz_hold', A, 'holding_company');
business('biz_other', A, 'company');
business('biz_b', B, 'holding_company');
holding('h_house', A, 'real_estate', { property_value_nzd: 800_000, mortgage_outstanding_nzd: 300_000 });
holding('h_flat', A, 'real_estate', { property_value_nzd: 400_000 });
holding('h_art', A, 'art', { last_valuation_nzd: 12_000 });
holding('h_gem', A, 'stone');
holding('h_b', B, 'art', { last_valuation_nzd: 99_999 });

// Nothing assigned: empty.
let classes = await businessAssetClasses(db, A, 'biz_hold', noWallets);
eq(classes.ok && classes.value, [], 'nothing assigned yet');

// Assign.
for (const h of ['h_house', 'h_flat', 'h_art', 'h_gem']) eq(assignHolding(db, A, 'biz_hold', h, { assigned: true }).ok, true, `assign ${h}`);
classes = await businessAssetClasses(db, A, 'biz_hold', noWallets);
if (!classes.ok) throw new Error('classes');
eq(classes.value.map((c) => [c.key, c.count, c.valueNzd, c.unvalued]), [['real_estate', 2, 900_000, 0], ['art', 1, 12_000, 0], ['stone', 1, 0, 1]], 'by class: property net of mortgage, art, and a gem with no value');
eq(holdingClassesTotal(classes.value), 912_000, 'total');
eq(holdingClassCountText(classes.value[2]), '1 holding, 1 without a value yet', 'unvalued note');

// Options and moving between businesses.
let options = businessHoldingOptions(db, A, 'biz_other');
if (!options.ok) throw new Error('options');
eq(options.value.filter((o) => o.assignedElsewhere).length, 4, 'held by the holding company');
eq(options.value.some((o) => o.id === 'h_b'), false, "another user's holding isn't offered");
eq(groupHoldingOptions(options.value).map((g) => g.classLabel), ['Art', 'Property', 'Precious stones'], 'grouped by class');
eq(assignHolding(db, A, 'biz_other', 'h_art', { assigned: false }).ok && queryOne<{ business_id: string }>(db, `SELECT business_id FROM holdings WHERE id = 'h_art'`)?.business_id, 'biz_hold', "unticking on another business doesn't take it away");
eq(assignHolding(db, A, 'biz_hold', 'h_art', { assigned: false }).ok, true, 'unassign');
classes = await businessAssetClasses(db, A, 'biz_hold', noWallets);
eq(classes.ok && classes.value.map((c) => c.key), ['real_estate', 'stone'], 'art gone, empty class hidden');

// Isolation and validation.
eq(assignHolding(db, B, 'biz_hold', 'h_house', { assigned: false }), { ok: false, status: 404, error: 'Business not found' }, "B can't touch A's business");
eq(assignHolding(db, B, 'biz_b', 'h_house', { assigned: true }), { ok: false, status: 404, error: 'Holding not found' }, "B can't assign A's holding");
eq(assignHolding(db, A, 'biz_hold', 'h_house', { assigned: 'yes' }).ok, false, 'boolean required');
eq(groupByAssetClass([{ id: 'x', assetClass: 'business' }], new Map()), [], 'businesses are never a class of a holding company');

// HTTP, and deleting the business releases its holdings.
const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api/business', businessRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  setPlan(db, A, 'plus');
  setPlan(db, B, 'plus');
  const cookieA = `${SESSION_COOKIE}=${(await createSession(A)).rawToken}`;
  const cookieB = `${SESSION_COOKIE}=${(await createSession(B)).rawToken}`;
  const get = (p: string, cookie: string) => fetch(`${base}${p}`, { headers: { Cookie: cookie } });
  const put = (p: string, cookie: string, body: unknown) => fetch(`${base}${p}`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const r = await get('/api/business/biz_hold/asset-classes', cookieA);
  eq(r.status, 200, 'GET asset-classes 200');
  const rows = (await r.json()) as { key: string; valueNzd: number; count: number }[];
  eq(rows[0].key === 'real_estate' && rows[0].count === 2, true, 'HTTP rows');
  eq((await get('/api/business/biz_hold/asset-classes', cookieB)).status, 404, "B can't read A's holding company");
  eq((await get('/api/business/biz_hold/holdings', cookieA)).status, 200, 'GET holdings 200');
  eq((await put('/api/business/biz_hold/holdings/h_art', cookieA, { assigned: true })).status, 200, 'PUT assign 200');
  eq((await put('/api/business/biz_hold/holdings/h_art', cookieB, { assigned: false })).status, 404, "B can't unassign");
  eq((await fetch(`${base}/api/business/biz_hold/asset-classes`)).status, 401, 'signed out 401');

  const { deleteBusiness } = await import('./store.ts');
  deleteBusiness(db, A, 'biz_hold');
  eq(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM holdings WHERE user_id = ? AND business_id IS NOT NULL`, [A])?.n, 0, 'deleting the business releases its holdings');
  eq(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM holdings WHERE user_id = ?`, [A])?.n, 4, 'and keeps them');
  console.log('holding company tests passed');
} finally {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
