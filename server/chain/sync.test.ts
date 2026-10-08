/**
 * Wallet sync job: status transitions, last_synced, backoff, per-network rate-limit
 * windows, scheduler selection, concurrency, and the "sync now" HTTP route.
 * Uses a throwaway sqlite file and fake chain providers — no network.
 * Run: npm run test:chain
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-walletsync-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
process.env.WALLET_SYNC_MIN_GAP_MS = '0';
process.env.CHAIN_BITCOIN_RPC_URL = 'https://btc.example.test/v1/supersecretpathkey123456';

const { getDb, queryOne, run } = await import('../db/index.ts');
const { registerChainProvider, resetChainProvidersForTest } = await import('./registry.ts');
const { ChainProviderError } = await import('./types.ts');
const { NETWORK_CHAIN_INFO } = await import('./networks.ts');
const sync = await import('./sync.ts');
const { valueWallet, clearWalletBalanceCache } = await import('./valuation.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth } = await import('../middleware/requireAuth.ts');

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
let passed = 0;
const check = (cond: unknown, msg: string) => {
  assert(cond, msg);
  passed++;
};

// --- backoff ----------------------------------------------------------------------
const MIN = 60_000;
check(sync.backoffMs(1, null, () => 0.5) === 2 * MIN, 'first failure: 2 min');
check(sync.backoffMs(4, null, () => 0.5) === 16 * MIN, 'doubles per failure');
check(sync.backoffMs(50, null, () => 1) === 6 * 60 * MIN, 'capped at 6 h');
check(sync.backoffMs(1, 900, () => 0.5) === 900_000, 'honours Retry-After when longer');
const lo = sync.backoffMs(3, null, () => 0);
const hi = sync.backoffMs(3, null, () => 0.9999);
check(lo === 6.4 * MIN && hi > 9.5 * MIN && hi <= 9.6 * MIN, `±20% jitter (${lo}..${hi})`);

// --- fixtures -------------------------------------------------------------------------
const db = await getDb();
const now = new Date().toISOString();
for (const u of ['sync_user_a', 'sync_user_b']) {
  run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [u, `${u}@x.test`, 'hash', now, now]);
}
function addWallet(id: string, network: string, address: string, user = 'sync_user_a') {
  run(
    db,
    `INSERT INTO wallets (id, user_id, name, network, address, status, created_at, updated_at)
     VALUES (?,?,?,?,?,'connected',?,?)`,
    [id, user, id, network, address, now, now],
  );
}
type Row = { status: string; status_message: string | null; last_synced: string | null; next_sync_at: string | null; sync_failures: number };
const row = (id: string) => queryOne<Row>(db, 'SELECT * FROM wallets WHERE id=?', [id])!;
const cols = queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM pragma_table_info('wallets') WHERE name IN ('next_sync_at','sync_failures')`);
check(cols?.c === 2, 'schema has next_sync_at + sync_failures');

const BTC = NETWORK_CHAIN_INFO.bitcoin.nativeAsset;
const calls: string[] = [];
let ethBehaviour: 'rate_limit' | 'ok' = 'rate_limit';
let gate: Promise<void> | null = null;
let failCount = 0;

resetChainProvidersForTest();
registerChainProvider({
  id: 'fake',
  label: 'Fake',
  supports: (n) => n === 'bitcoin' || n === 'ethereum',
  async getBalances(ctx, address) {
    calls.push(`${ctx.network}:${address}`);
    if (gate) await gate;
    if (address === 'flaky') {
      failCount++;
      throw new ChainProviderError('timeout', 'bitcoin', 'Bitcoin provider timed out');
    }
    if (address === 'leaky') throw new Error(`GET ${ctx.endpoint.url}/address failed`);
    if (ctx.network === 'ethereum' && ethBehaviour === 'rate_limit') {
      throw new ChainProviderError('rate_limited', 'ethereum', 'Ethereum provider rate limit reached', 120);
    }
    return [{ asset: ctx.network === 'bitcoin' ? BTC : NETWORK_CHAIN_INFO.ethereum.nativeAsset, amountRaw: '150000000' }];
  },
  async getTransactions() {
    return { transactions: [], nextCursor: null };
  },
});

try {
  // --- success ------------------------------------------------------------------------
  addWallet('w_btc', 'bitcoin', 'addr1');
  const t0 = Date.now();
  const okRes = await sync.syncWallet('w_btc');
  const a = row('w_btc');
  check(okRes.ok && a.status === 'connected' && a.status_message === null, 'success → connected');
  check(a.last_synced && Date.parse(a.last_synced) >= t0, 'last_synced updated on success');
  const nextIn = Date.parse(a.next_sync_at!) - Date.now();
  check(nextIn > 29 * MIN && nextIn <= 30 * MIN, 'next sync scheduled one interval later');
  check(a.sync_failures === 0, 'failures reset');
  clearWalletBalanceCache();
  await sync.syncWallet('w_btc');
  const before = calls.length;
  const v = await valueWallet({ network: 'bitcoin', address: 'addr1' }, async () => ({
    assetKey: 'CRYPTO:BTC', currency: 'NZD', price: 100_000, status: 'ok', source: 'coingecko', asOf: new Date().toISOString(), message: null,
  }));
  check(v.ok && v.totalNzd === 150_000 && calls.length === before, 'sync primes valuation cache (no refetch)');

  // --- rate limit: error + network window, other wallets deferred --------------------
  addWallet('w_eth1', 'ethereum', '0xaaa');
  addWallet('w_eth2', 'ethereum', '0xbbb');
  const rl = await sync.syncWallet('w_eth1');
  const e1 = row('w_eth1');
  check(!rl.ok && !rl.deferred && rl.code === 'rate_limited', 'rate limit reported');
  check(e1.status === 'error' && e1.status_message === 'Ethereum provider rate limit reached', 'status error with message');
  check(e1.sync_failures === 1 && Date.parse(e1.next_sync_at!) - Date.now() >= 119_000, 'backoff ≥ Retry-After');
  check(sync.networkBlockedSec('ethereum') >= 119, 'network window opened');
  const callsBefore = calls.length;
  const deferred = await sync.syncWallet('w_eth2');
  check(!deferred.ok && deferred.deferred && calls.length === callsBefore, 'same-network wallet deferred without a provider call');
  check(row('w_eth2').sync_failures === 0 && row('w_eth2').status === 'connected', 'deferral is not a failure');
  check(Date.parse(row('w_eth2').next_sync_at!) > Date.now(), 'deferred wallet pushed past the window');

  // --- unsupported network: error, retried rarely ----------------------------------
  addWallet('w_sol', 'solana', 'So11111111111111111111111111111111111111112');
  await sync.syncWallet('w_sol');
  const s = row('w_sol');
  check(s.status === 'error' && s.status_message === 'Solana wallets cannot be synced yet', 'unsupported → error with message');
  check(Date.parse(s.next_sync_at!) - Date.now() > 5.9 * 60 * MIN, 'unsupported retried after ~6 h');

  // --- repeated transient failures grow the backoff ----------------------------------
  addWallet('w_flaky', 'bitcoin', 'flaky');
  const gaps: number[] = [];
  for (let i = 0; i < 3; i++) {
    await sync.syncWallet('w_flaky');
    gaps.push(Date.parse(row('w_flaky').next_sync_at!) - Date.now());
  }
  check(row('w_flaky').sync_failures === 3 && failCount === 3, 'failures counted');
  check(gaps[0] < gaps[1] && gaps[1] < gaps[2], `backoff grows (${gaps.map((g) => Math.round(g / 1000)).join('s, ')}s)`);

  // --- unexpected errors never leak endpoint secrets ---------------------------------
  addWallet('w_leaky', 'bitcoin', 'leaky');
  await sync.syncWallet('w_leaky');
  const lk = row('w_leaky');
  check(Date.parse(lk.next_sync_at!) - Date.now() < 3 * MIN, 'provider error backs off normally (not 6 h)');
  check(lk.status === 'error' && !String(lk.status_message).includes('supersecret') && !String(lk.status_message).includes('example.test'), 'stored message has no endpoint/key');

  // --- concurrency: one provider call for simultaneous syncs -------------------------
  addWallet('w_conc', 'bitcoin', 'conc');
  let release!: () => void;
  gate = new Promise((r) => (release = r));
  const c0 = calls.length;
  const p1 = sync.syncWallet('w_conc');
  const p2 = sync.syncWallet('w_conc');
  await new Promise((r) => setTimeout(r, 20));
  check(row('w_conc').status === 'syncing', 'status is syncing while running');
  release();
  gate = null;
  await Promise.all([p1, p2]);
  check(calls.length === c0 + 1, 'concurrent syncs share one provider call');

  // --- edited mid-sync: stale result is not written ----------------------------------
  addWallet('w_edit', 'bitcoin', 'old-address');
  gate = new Promise((r) => (release = r));
  const pe = sync.syncWallet('w_edit');
  await new Promise((r) => setTimeout(r, 20));
  run(db, `UPDATE wallets SET address='new-address', status='connected', last_synced=NULL WHERE id='w_edit'`);
  release();
  gate = null;
  await pe;
  check(row('w_edit').last_synced === null, 'result for the old address discarded');

  // --- scheduler pass ------------------------------------------------------------------
  run(db, `UPDATE wallets SET next_sync_at=? WHERE id NOT IN ('w_btc')`, [new Date(Date.now() + 60 * MIN).toISOString()]);
  run(db, `UPDATE wallets SET next_sync_at=? WHERE id='w_btc'`, [new Date(Date.now() - 1000).toISOString()]);
  addWallet('w_new', 'bitcoin', 'fresh'); // next_sync_at NULL → due
  addWallet('w_stuck', 'bitcoin', 'stuck');
  run(db, `UPDATE wallets SET status='syncing', updated_at=?, next_sync_at=NULL WHERE id='w_stuck'`, [new Date(Date.now() - 11 * MIN).toISOString()]);
  addWallet('w_busy', 'bitcoin', 'busy');
  run(db, `UPDATE wallets SET status='syncing', updated_at=?, next_sync_at=NULL WHERE id='w_busy'`, [new Date().toISOString()]);
  const c1 = calls.length;
  const tick = await sync.runSyncTick();
  const synced = calls.slice(c1).sort().join();
  check(tick.attempted === 3 && tick.ok === 3, `tick syncs due wallets only (${JSON.stringify(tick)})`);
  check(synced === 'bitcoin:addr1,bitcoin:fresh,bitcoin:stuck', `due + new + stuck, not busy/not-due (${synced})`);
  check(row('w_busy').status === 'syncing', 'recently-started sync left alone');

  // --- scheduler start/stop ------------------------------------------------------------
  process.env.WALLET_SYNC_DISABLED = '1';
  const stop = sync.startWalletSyncScheduler();
  stop();
  delete process.env.WALLET_SYNC_DISABLED;
  const stop2 = sync.startWalletSyncScheduler();
  check(sync.startWalletSyncScheduler() === sync.stopWalletSyncScheduler, 'scheduler start is idempotent');
  stop2();
  passed++;

  // --- "sync now" route ----------------------------------------------------------------
  const { default: walletsRouter } = await import('../routes/wallets.ts');
  const app = express();
  app.use(express.json());
  app.use('/api', attachUser);
  app.use('/api', requireAuth);
  app.use('/api/wallets', walletsRouter);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/wallets`;
  const cookieA = `${SESSION_COOKIE}=${(await createSession('sync_user_a')).rawToken}`;
  const cookieB = `${SESSION_COOKIE}=${(await createSession('sync_user_b')).rawToken}`;
  const post = (p: string, cookie: string) => fetch(`${base}${p}`, { method: 'POST', headers: { Cookie: cookie } });
  try {
    addWallet('w_manual', 'bitcoin', 'manual');
    const r1 = await post('/w_manual/sync', cookieA);
    const j1 = (await r1.json()) as { synced: boolean; wallet: { status: string; lastSynced: string | null } };
    check(r1.status === 200 && j1.synced && j1.wallet.status === 'connected' && j1.wallet.lastSynced, 'sync now → 200 connected');
    const r2 = await post('/w_manual/sync', cookieA);
    const j2 = (await r2.json()) as { code: string; retryAfterSec: number };
    check(r2.status === 429 && j2.code === 'SYNC_COOLDOWN' && r2.headers.get('retry-after') === String(j2.retryAfterSec), 'cooldown → 429 with Retry-After');
    check((await post('/w_manual/sync', cookieB)).status === 404, 'other user → 404');
    const r3 = await post('/w_eth2/sync', cookieA);
    check(r3.status === 429 && ((await r3.json()) as { code: string }).code === 'RATE_LIMITED', 'provider window → 429 RATE_LIMITED');
    const r4 = await post('/w_sol/sync', cookieA);
    const j4 = (await r4.json()) as { synced: boolean; wallet: { status: string; statusMessage: string } };
    check(r4.status === 200 && !j4.synced && j4.wallet.status === 'error' && /cannot be synced yet/.test(j4.wallet.statusMessage), 'failed sync → 200 with error status');

    // Create triggers a background first sync.
    const created = await fetch(base, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
      body: JSON.stringify({ network: 'bitcoin', address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' }),
    });
    const w = (await created.json()) as { id: string };
    for (let i = 0; i < 50 && !row(w.id).last_synced; i++) await new Promise((r) => setTimeout(r, 20));
    check(row(w.id).last_synced && row(w.id).status === 'connected', 'new wallet synced in the background');
  } finally {
    server.close();
  }
} finally {
  sync.stopWalletSyncScheduler();
  resetChainProvidersForTest();
  for (const suffix of ['', '.tmp']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

console.log(`sync: ${passed} checks passed`);
process.exit(0);
