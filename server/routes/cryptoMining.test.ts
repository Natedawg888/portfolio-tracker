/**
 * Crypto mining (KAN-85): upgrading a database saved before the change (miners backfilled to
 * GoMining cloud, nothing lost, safe to run twice), adding a rig and another cloud provider,
 * changing a miner's type, GoMining-only marketplace refresh and Projections mining plan, net worth
 * unchanged, and isolation. Run: npm run test:crypto-mining
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import initSqlJs from 'sql.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-mining-'));
const dbPath = path.join(dataDir, 'portfolio.db');
process.env.DATABASE_PATH = dbPath;
process.env.AUTH_ENCRYPTION_KEY = 'd'.repeat(64);

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// A database from before KAN-85: today's schema without the two new holdings columns, with one
// GoMining miner and a net-worth snapshot already saved.
const now = '2026-10-05T00:00:00.000Z';
{
  const SQL = await initSqlJs();
  const old = new SQL.Database();
  const schema = fs
    .readFileSync(path.join(here, '../db/schema.sql'), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*mining_(type|provider)\s/.test(l))
    .join('\n');
  old.exec(schema);
  const cols = old.exec(`PRAGMA table_info(holdings)`)[0].values.map((r) => r[1]);
  assert(!cols.includes('mining_type'), 'the old schema really has no mining_type');
  for (const id of ['pam', 'fred']) {
    old.run(`INSERT INTO users (id, email, password_hash, first_name, last_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, [id, `${id}@example.com`, 'h', id, 'Test', now, now]);
  }
  old.run(
    `INSERT INTO holdings (id, user_id, asset_class, name, miner_name, hashrate_ths, energy_efficiency_wth, rarity, level, estimated_value_nzd, cost_basis_nzd, created_at, updated_at)
     VALUES ('hld_old','pam','gomining_miner','Miner #42','Miner #42', 20, 15, 'Rare', 3, 450, 400, ?, ?)`,
    [now, now],
  );
  fs.writeFileSync(dbPath, Buffer.from(old.export()));
  old.close();
}

const { getDb, run, queryOne, queryAll } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { computeNetWorth } = await import('../lib/netWorth.ts');
const { default: holdingsRouter } = await import('./holdings.ts');
const { default: projectionsRouter } = await import('./projections.ts');

const db = await getDb();
const legacy = queryOne<{ mining_type: string; mining_provider: string; hashrate_ths: number; estimated_value_nzd: number; rarity: string }>(db, `SELECT * FROM holdings WHERE id = 'hld_old'`);
assert(legacy?.mining_type === 'cloud' && legacy.mining_provider === 'gomining', `old miner backfilled to GoMining cloud ${JSON.stringify(legacy)}`);
assert(legacy.hashrate_ths === 20 && legacy.estimated_value_nzd === 450 && legacy.rarity === 'Rare', 'nothing else changed');

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/holdings', holdingsRouter);
app.use('/api/projections', projectionsRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
type Json = Record<string, any>;
async function call(method: string, p: string, cookie: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { Accept: 'application/json', Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}

try {
  const P = `${SESSION_COOKIE}=${(await createSession('pam')).rawToken}`;
  const F = `${SESSION_COOKIE}=${(await createSession('fred')).rawToken}`;

  // The legacy miner reads back as a GoMining cloud card.
  let list = await call('GET', '/holdings', P);
  const all = (Array.isArray(list.json) ? list.json : list.json.holdings) as Json[];
  const old = all.find((h) => h.id === 'hld_old')!;
  assert(old.miningType === 'cloud' && old.miningProvider === 'gomining', `API: legacy tag ${JSON.stringify(old)}`);

  // A rig of your own, and a miner from another cloud provider.
  const rig = await call('POST', '/holdings', P, { assetClass: 'gomining_miner', miningType: 'hardware', miningProvider: 'gomining', name: 'Garage S19', minerName: 'Garage S19', hashrateThs: 95, energyEfficiencyWth: 34, rarity: 'Epic', costBasisNzd: 3000, estimatedValueNzd: 1800 });
  assert(rig.status === 201 && rig.json.miningType === 'hardware' && rig.json.miningProvider === null, `rig ${JSON.stringify(rig.json)}`);
  const nh = await call('POST', '/holdings', P, { assetClass: 'gomining_miner', miningType: 'cloud', miningProvider: 'NiceHash', name: 'NH plan', minerName: 'NH plan', hashrateThs: 10, costBasisNzd: 250 });
  assert(nh.status === 201 && nh.json.miningType === 'cloud' && nh.json.miningProvider === 'NiceHash', 'another cloud provider');
  const dflt = await call('POST', '/holdings', P, { assetClass: 'gomining_miner', name: 'No tag sent', minerName: 'No tag sent', hashrateThs: 2 });
  assert(dflt.json.miningType === 'cloud' && dflt.json.miningProvider === 'gomining', 'no tag sent → GoMining cloud (as before)');
  assert((await call('POST', '/holdings', P, { assetClass: 'gomining_miner', miningType: 'asic', name: 'x', hashrateThs: 1 })).status === 400, 'unknown type rejected');

  // Change a miner's type; hardware drops the provider. Edits without a tag leave it alone.
  let up = await call('PATCH', `/holdings/${dflt.json.id}`, P, { miningType: 'hardware' });
  assert(up.status === 200 && up.json.miningType === 'hardware' && up.json.miningProvider === null, `to hardware ${JSON.stringify(up.json)}`);
  up = await call('PATCH', `/holdings/${dflt.json.id}`, P, { miningType: 'cloud', miningProvider: 'GoMining' });
  assert(up.json.miningType === 'cloud' && up.json.miningProvider === 'gomining', 'back to GoMining by label');
  up = await call('PATCH', `/holdings/${nh.json.id}`, P, { hashrateThs: 12 });
  assert(up.json.miningProvider === 'NiceHash' && up.json.hashrateThs === 12, 'spec edit keeps the tag');

  // Marketplace value is GoMining's: other miners are refused one, and the bulk refresh skips them.
  const r = await call('POST', `/holdings/${rig.json.id}/refresh-value`, P);
  assert(r.status === 400, 'no marketplace value for a rig');
  const before = queryOne<{ estimated_value_nzd: number }>(db, `SELECT estimated_value_nzd FROM holdings WHERE id = ?`, [rig.json.id]);
  const bulk = await call('POST', '/holdings/refresh-gomining-values', P);
  const touched = ((bulk.json.results ?? []) as Json[]).map((x) => x.holdingId);
  assert(!touched.includes(rig.json.id) && !touched.includes(nh.json.id), `bulk refresh skips non-GoMining ${JSON.stringify(touched)}`);
  assert(queryOne<{ estimated_value_nzd: number }>(db, `SELECT estimated_value_nzd FROM holdings WHERE id = ?`, [rig.json.id])?.estimated_value_nzd === before?.estimated_value_nzd, 'rig value untouched');

  // Net worth counts every miner the same way as before: recorded value, else cost. (Online, the
  // refresh above may have given the GoMining miners a marketplace value; the rig and NiceHash keep theirs.)
  const nw = await computeNetWorth(db, 'pam');
  const expected = queryAll<{ v: number }>(db, `SELECT COALESCE(estimated_value_nzd, cost_basis_nzd, 0) AS v FROM holdings WHERE user_id = 'pam' AND asset_class = 'gomining_miner'`).reduce((t, r) => t + Number(r.v), 0);
  assert(Math.abs((nw.gominingMinersNzd ?? 0) - expected) < 0.005, `mining in net worth ${nw.gominingMinersNzd} vs ${expected}`);
  const keep = queryAll<{ id: string; v: number }>(db, `SELECT id, COALESCE(estimated_value_nzd, cost_basis_nzd) AS v FROM holdings WHERE id IN (?, ?)`, [rig.json.id, nh.json.id]);
  assert(keep.find((k) => k.id === rig.json.id)?.v === 1800 && keep.find((k) => k.id === nh.json.id)?.v === 250, 'rig and NiceHash values are the user’s');

  // Projections mining plan uses GoMining's model: only GoMining miners' TH go in.
  const proj = await call('GET', '/projections?months=12', P);
  const inputs = proj.json.mining?.inputs;
  if (inputs) assert(inputs.th === 20 + 2, `plan TH from GoMining miners only (${inputs.th})`);
  else assert(proj.json.mining?.status !== 'no_miners', `GoMining miners found for the plan (${JSON.stringify(proj.json.mining)})`);
  run(db, `UPDATE holdings SET mining_type = 'hardware', mining_provider = NULL WHERE user_id = 'pam'`);
  const none = await call('GET', '/projections?months=12', P);
  assert(none.json.mining?.status === 'no_miners', 'rigs alone: no GoMining plan');

  // Isolation.
  assert((await call('PATCH', `/holdings/${nh.json.id}`, F, { miningType: 'hardware' })).status === 404, 'another user can’t retag');
  assert(!JSON.stringify((await call('GET', '/holdings', F)).json).includes('Garage S19'), 'or see');

  console.log('crypto mining tests passed');
} finally {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
