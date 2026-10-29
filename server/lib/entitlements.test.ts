/**
 * Plans (KAN-125): the Business plan, what each plan unlocks, the route guard and GET /plan.
 * Run: npm run test:plans
 *
 * Uses a throwaway data dir. Does not touch data/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-plans-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');
process.env.AUTH_ENCRYPTION_KEY = 'c'.repeat(64);
process.env.PLAN_BUSINESS_EMAILS = ' Bea@Example.com ';
process.env.PLAN_PRO_EMAILS = 'pia@example.com';
process.env.PLAN_PLUS_EMAILS = 'pat@example.com';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run } = await import('../db/index.ts');
const { featuresOf, hasFeature, isPlan, planOf, setPlan, PLANS } = await import('./entitlements.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser } = await import('../middleware/requireAuth.ts');
const { requireFeature } = await import('../middleware/requireFeature.ts');
const { default: settingsRouter } = await import('../routes/settings.ts');

const now = '2026-10-23T00:00:00.000Z';
const db = await getDb();
for (const [id, email] of [
  ['fay', 'fay@example.com'],
  ['bea', 'bea@example.com'],
  ['bob', 'bob@example.com'],
  ['pia', 'pia@example.com'],
  ['pat', 'pat@example.com'],
]) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, created_at, updated_at) VALUES (?,?,?,?,?,?)`, [id, email, 'hash', 'X', now, now]);
}

let server: Server | null = null;
try {
  assert(PLANS.join() === 'free,plus,pro,business' && isPlan('business') && !isPlan('enterprise'), 'business is a plan');

  // Who is on what.
  assert(planOf(db, 'fay') === 'free', 'no grant is free');
  assert(planOf(db, 'bea') === 'business', 'PLAN_BUSINESS_EMAILS grants Business (trimmed, any case)');
  setPlan(db, 'bob', 'business', 'test');
  assert(planOf(db, 'bob') === 'business', 'plan:set grants Business');
  assert(planOf(db, 'pia') === 'pro' && planOf(db, 'pat') === 'plus', 'Pro and Plus unchanged');
  setPlan(db, 'pia', 'business', 'test');
  assert(planOf(db, 'pia') === 'business', 'a Business grant is not undone by the Pro list');
  setPlan(db, 'pia', 'free', 'test');
  assert(planOf(db, 'pia') === 'pro', 'dropping the grant falls back to the Pro list');

  // Business unlocks the business reports and nothing personal; no other plan gets them.
  assert(hasFeature(db, 'bea', 'business_reports') && hasFeature(db, 'bob', 'business_reports'), 'Business has business_reports');
  for (const id of ['fay', 'pia', 'pat']) assert(!hasFeature(db, id, 'business_reports'), `${id} has no business_reports`);
  for (const f of ['household', 'payslips', 'crypto_pro', 'bonds_plus', 'commodities_plus'] as const) {
    assert(!hasFeature(db, 'bea', f), `Business does not include ${f}`);
  }
  assert(hasFeature(db, 'pat', 'household') && hasFeature(db, 'pia', 'crypto_pro'), 'personal features unchanged');
  const feats = featuresOf(db, 'bea');
  assert(feats.business_reports === true && feats.household === false && Object.keys(feats).length === 6, 'featuresOf lists every feature');

  // The route guard and GET /plan.
  const app = express();
  app.use(express.json());
  app.use('/api', attachUser);
  app.get('/api/reports/pnl', requireFeature('business_reports'), (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/settings', settingsRouter);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = async (id: string) => `${SESSION_COOKIE}=${(await createSession(id)).rawToken}`;
  const get = async (p: string, c?: string) => {
    const r = await fetch(`${base}${p}`, { headers: c ? { Cookie: c } : {} });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  };

  const fay = await cookie('fay');
  const bea = await cookie('bea');
  assert((await get('/api/reports/pnl')).status === 401, 'signed out is 401');
  const locked = await get('/api/reports/pnl', fay);
  assert(locked.status === 402 && locked.json.code === 'BUSINESS_PLAN_REQUIRED', 'free is refused with BUSINESS_PLAN_REQUIRED');
  assert((await get('/api/reports/pnl', await cookie('pia'))).status === 402, 'Pro is refused too');
  assert((await get('/api/reports/pnl', bea)).status === 200, 'Business gets through');

  const fayPlan = await get('/api/settings/plan', fay);
  assert(fayPlan.json.plan === 'free' && (fayPlan.json.features as Record<string, boolean>).business_reports === false, 'GET /plan for free');
  const beaPlan = await get('/api/settings/plan', bea);
  assert(beaPlan.json.plan === 'business' && (beaPlan.json.features as Record<string, boolean>).business_reports === true, 'GET /plan for Business');
  assert((await get('/api/settings/plan')).status === 401, 'GET /plan signed out is 401');

  console.log('plans: ok');
} finally {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  fs.rmSync(dataDir, { recursive: true, force: true });
}
