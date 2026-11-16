/**
 * business_manage: Free can read a business it already has, Plus can change it, and a member
 * follows the owner's plan. Run: npm run test:plans
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-manage-'));
process.env.DATABASE_PATH = path.join(dir, 'portfolio.db');
process.env.AUTH_ENCRYPTION_KEY = 'f'.repeat(64);
delete process.env.PLAN_PLUS_EMAILS;
delete process.env.PLAN_PRO_EMAILS;
delete process.env.PLAN_BUSINESS_EMAILS;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run } = await import('../db/index.ts');
const { setPlan } = await import('../lib/entitlements.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { default: businessRouter } = await import('../routes/business.ts');
const { default: settingsRouter } = await import('../routes/settings.ts');
const { ensureStarterBusiness } = await import('./starter.ts');
const { mergeRunsBusinessIntoPreferencesJson } = await import('../../src/lib/runsBusiness.ts');

const now = '2026-11-16T00:00:00.000Z';
const db = await getDb();
for (const [id, email] of [
  ['owner', 'owner@example.com'],
  ['acct', 'acct@example.com'],
  ['plus', 'plus@example.com'],
]) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, created_at, updated_at) VALUES (?,?,?,?,?,?)`, [id, email, 'hash', 'X', now, now]);
}
setPlan(db, 'plus', 'plus', 'test');
setPlan(db, 'owner', 'plus', 'test');
run(
  db,
  `INSERT INTO businesses (id, user_id, name, type, industry, nzbn, gst_registered, gst_number, email, address, phone, bank_account, invoice_prefix, clients_enabled, count_in_net_worth, is_default, created_at, updated_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ['biz_own', 'owner', 'Existing', 'sole_trader', '', '', 0, '', '', '', '', '', 'INV-', 1, 1, 1, now, now],
);
run(
  db,
  `INSERT INTO business_members (business_id, user_id, role, added_by, joined_at) VALUES (?,?,?,?,?)`,
  ['biz_own', 'acct', 'accountant', 'owner', now],
);

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/business', businessRouter);
app.use('/api/settings', settingsRouter);

let server: Server | null = null;
try {
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = async (id: string) => `${SESSION_COOKIE}=${(await createSession(id)).rawToken}`;
  const call = async (method: string, p: string, c: string, body?: unknown) => {
    const r = await fetch(`${base}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: c },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, json: text ? (JSON.parse(text) as Record<string, any>) : {} };
  };

  const owner = await cookie('owner');
  const acct = await cookie('acct');
  const plus = await cookie('plus');

  const listed = await call('GET', '/api/business', owner);
  assert(listed.status === 200 && listed.json.businesses?.some((b: { id: string }) => b.id === 'biz_own'), 'Plus owner still reads the business');
  const added = await call('POST', '/api/business/biz_own/assets', acct, { category: 'other', name: 'Ladder', quantity: 1 });
  assert(added.status === 201, `accountant follows the owner's Plus plan (${added.status} ${added.json.error ?? ''})`);

  setPlan(db, 'owner', 'free', 'test');
  const still = await call('GET', '/api/business', owner);
  assert(still.status === 200 && still.json.businesses?.length === 1, 'Free still reads the business it already has');
  const blocked = await call('POST', '/api/business', owner, { name: 'Another', type: 'sole_trader' });
  assert(blocked.status === 402 && blocked.json.code === 'BUSINESS_MANAGE_REQUIRED', 'Free cannot create a business');
  const memberBlocked = await call('POST', '/api/business/biz_own/stock', acct, { name: 'Jar' });
  assert(memberBlocked.status === 402 && memberBlocked.json.code === 'BUSINESS_MANAGE_REQUIRED', 'a member follows the owner, not their own plan');

  const opened = await call('POST', '/api/business', plus, { name: 'Plus Co', type: 'sole_trader' });
  assert(opened.status === 201 && opened.json.name === 'Plus Co', 'Plus can create a business');

  run(db, `UPDATE users SET preferences_json = ? WHERE id = ?`, [mergeRunsBusinessIntoPreferencesJson(null, true), 'plus']);
  setPlan(db, 'plus', 'plus', 'test');
  assert(ensureStarterBusiness(db, 'plus') === false, 'a tick does not add a second business');
  run(db, `DELETE FROM businesses WHERE user_id = ?`, ['plus']);
  assert(ensureStarterBusiness(db, 'plus') === true, 'a ticked Plus account with none gets My business');
  const starter = await call('GET', '/api/business', plus);
  assert(starter.json.businesses?.some((b: { name: string }) => b.name === 'My business'), 'the starter business is listed');
  run(db, `DELETE FROM businesses WHERE user_id = ?`, ['plus']);
  assert(ensureStarterBusiness(db, 'plus') === false, 'deleting every business does not create another starter');
  const gone = await call('GET', '/api/business', plus);
  assert((gone.json.businesses ?? []).length === 0, 'My business stays deleted');
  setPlan(db, 'plus', 'free', 'test');
  assert(ensureStarterBusiness(db, 'plus') === false, 'Free does not get a starter business');

  console.log('business manage: ok');
} finally {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
}
