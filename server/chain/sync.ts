/**
 * Wallet sync job (KAN-41): periodic per-wallet sync, manual "sync now",
 * per-network rate limiting and exponential backoff.
 *
 * A sync fetches balances through the chain service and records the outcome on
 * the wallet row — status (connected | syncing | error), status_message,
 * last_synced, next_sync_at, sync_failures. Balances themselves are never stored;
 * fresh ones are handed to the in-memory valuation cache.
 *
 * Env (all optional):
 *   WALLET_SYNC_DISABLED=1           don't start the scheduler
 *   WALLET_SYNC_INTERVAL_MIN=30      minutes between successful syncs
 *   WALLET_SYNC_MIN_GAP_MS=1500      min gap between provider calls per network
 */
import type { Database } from 'sql.js';
import { getDb, queryAll, queryOne, run } from '../db/index.ts';
import { logger } from '../lib/logger.ts';
import { WALLET_NETWORKS, type WalletNetwork } from '../lib/walletAddress.ts';
import { redactChainSecrets } from './config.ts';
import { fetchWalletBalances } from './service.ts';
import { ChainProviderError } from './types.ts';
import { primeBalanceCache } from './valuation.ts';

const TICK_MS = 60_000;
const TICK_BATCH = 10;
const BACKOFF_BASE_MS = 2 * 60_000;
const BACKOFF_MAX_MS = 6 * 60 * 60_000;
/** Unsupported / misconfigured networks: retry rarely (an adapter may land later). */
const PERMANENT_RETRY_MS = 6 * 60 * 60_000;
export const MANUAL_COOLDOWN_MS = 30_000;
/** A row left 'syncing' longer than this (crash / restart) is picked up again. */
const STUCK_SYNCING_MS = 10 * 60_000;

function intervalMs(): number {
  const min = Number(process.env.WALLET_SYNC_INTERVAL_MIN);
  return (Number.isFinite(min) && min >= 1 ? min : 30) * 60_000;
}
function minGapMs(): number {
  const ms = Number(process.env.WALLET_SYNC_MIN_GAP_MS);
  return Number.isFinite(ms) && ms >= 0 ? ms : 1500;
}

/** Exponential backoff with ±20% jitter, never shorter than the provider's Retry-After. */
export function backoffMs(failures: number, retryAfterSec: number | null = null, random = Math.random): number {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
  const jittered = Math.round(exp * (0.8 + random() * 0.4));
  return Math.max(Math.min(jittered, BACKOFF_MAX_MS), (retryAfterSec ?? 0) * 1000);
}

// --- per-network rate limiting -----------------------------------------------------

const networkLastCall = new Map<WalletNetwork, number>();
const networkBlockedUntil = new Map<WalletNetwork, number>();

/** Seconds until the network may be called again after a provider rate limit; 0 when clear. */
export function networkBlockedSec(network: WalletNetwork, now = Date.now()): number {
  const until = networkBlockedUntil.get(network) ?? 0;
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

async function paceNetwork(network: WalletNetwork): Promise<void> {
  const wait = (networkLastCall.get(network) ?? 0) + minGapMs() - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  networkLastCall.set(network, Date.now());
}

// --- one wallet ------------------------------------------------------------------

type WalletRow = {
  id: string;
  user_id: string;
  network: WalletNetwork;
  address: string;
  status: string;
  last_synced: string | null;
  sync_failures: number | null;
  updated_at: string;
};

export type SyncOutcome =
  | { ok: true; walletId: string }
  | {
      ok: false;
      walletId: string;
      code: string;
      message: string;
      retryAfterSec: number | null;
      /** True when nothing was attempted (rate-limit window, cooldown, gone). */
      deferred: boolean;
    };

const inflight = new Map<string, Promise<SyncOutcome>>();

function loadRow(db: Database, walletId: string, userId: string | null): WalletRow | null {
  return userId
    ? queryOne<WalletRow>(db, 'SELECT * FROM wallets WHERE id=? AND user_id=?', [walletId, userId])
    : queryOne<WalletRow>(db, 'SELECT * FROM wallets WHERE id=?', [walletId]);
}

/** Sync one wallet now. Concurrent calls for the same wallet share one run. */
export function syncWallet(walletId: string, userId: string | null = null): Promise<SyncOutcome> {
  const running = inflight.get(walletId);
  if (running) return running;
  const p = doSync(walletId, userId).finally(() => inflight.delete(walletId));
  inflight.set(walletId, p);
  return p;
}

async function doSync(walletId: string, userId: string | null): Promise<SyncOutcome> {
  const db = await getDb();
  const row = loadRow(db, walletId, userId);
  if (!row) {
    return { ok: false, walletId, code: 'not_found', message: 'Wallet not found', retryAfterSec: null, deferred: true };
  }
  const { network, address } = row;
  const label = WALLET_NETWORKS[network]?.label ?? network;

  const blocked = networkBlockedSec(network);
  if (blocked > 0) {
    // Provider asked us to back off: push this wallet past the window, don't count a failure.
    run(db, `UPDATE wallets SET next_sync_at=? WHERE id=?`, [new Date(Date.now() + blocked * 1000).toISOString(), walletId]);
    return {
      ok: false,
      walletId,
      code: 'rate_limited',
      message: `${label} provider is rate limited. Try again in ${blocked}s.`,
      retryAfterSec: blocked,
      deferred: true,
    };
  }

  const startedAt = Date.now();
  run(db, `UPDATE wallets SET status='syncing', updated_at=? WHERE id=?`, [new Date(startedAt).toISOString(), walletId]);
  // Results are only written if the wallet still has the same network + address
  // (it may have been edited or removed while the provider call was running).
  const sameWallet = `WHERE id=? AND network=? AND address=?`;

  try {
    await paceNetwork(network);
    const snap = await fetchWalletBalances({ network, address });
    const now = new Date();
    run(
      db,
      `UPDATE wallets SET status='connected', status_message=NULL, last_synced=?, sync_failures=0,
         next_sync_at=?, updated_at=? ${sameWallet}`,
      [snap.fetchedAt, new Date(now.getTime() + intervalMs()).toISOString(), now.toISOString(), walletId, network, address],
    );
    primeBalanceCache({ network, address }, snap.balances, snap.fetchedAt);
    logger.info('wallet_sync', { walletId, network, ok: true, ms: Date.now() - startedAt });
    return { ok: true, walletId };
  } catch (err) {
    const e =
      err instanceof ChainProviderError
        ? err
        : new ChainProviderError('upstream_error', network, `${label} sync failed unexpectedly.`);
    const failures = Number(row.sync_failures ?? 0) + 1;
    // Only "can't sync this network at all" waits long; provider errors back off normally.
    const permanent = e.code === 'unsupported_network' || e.code === 'not_configured';
    const delay = permanent ? PERMANENT_RETRY_MS : backoffMs(failures, e.retryAfterSec);
    if (e.code === 'rate_limited') {
      networkBlockedUntil.set(network, Date.now() + Math.max(delay, (e.retryAfterSec ?? 0) * 1000));
    }
    const now = new Date();
    const message = redactChainSecrets(e.message);
    run(
      db,
      `UPDATE wallets SET status='error', status_message=?, sync_failures=?, next_sync_at=?, updated_at=? ${sameWallet}`,
      [message, failures, new Date(now.getTime() + delay).toISOString(), now.toISOString(), walletId, network, address],
    );
    logger.warn('wallet_sync', {
      walletId,
      network,
      ok: false,
      code: e.code,
      failures,
      retryInSec: Math.round(delay / 1000),
      ms: Date.now() - startedAt,
      // Unexpected (non-provider) errors: keep a redacted hint for debugging.
      ...(err instanceof ChainProviderError ? {} : { err: redactChainSecrets(String(err)).slice(0, 200) }),
    });
    return {
      ok: false,
      walletId,
      code: e.code,
      message,
      retryAfterSec: e.retryAfterSec ?? Math.round(delay / 1000),
      deferred: false,
    };
  }
}

/** "Sync now": respects a short cooldown and any provider rate-limit window. */
export async function requestManualSync(walletId: string, userId: string): Promise<SyncOutcome> {
  const db = await getDb();
  const row = loadRow(db, walletId, userId);
  if (!row) {
    return { ok: false, walletId, code: 'not_found', message: 'Wallet not found', retryAfterSec: null, deferred: true };
  }
  if (inflight.has(walletId)) return syncWallet(walletId, userId); // join the running sync
  const since = row.last_synced ? Date.now() - Date.parse(row.last_synced) : Infinity;
  if (since < MANUAL_COOLDOWN_MS) {
    const wait = Math.ceil((MANUAL_COOLDOWN_MS - since) / 1000);
    return {
      ok: false,
      walletId,
      code: 'cooldown',
      message: `Synced moments ago. Try again in ${wait}s.`,
      retryAfterSec: wait,
      deferred: true,
    };
  }
  return syncWallet(walletId, userId);
}

// --- scheduler ---------------------------------------------------------------------

/** One scheduler pass: sync up to TICK_BATCH due wallets, one at a time. */
export async function runSyncTick(now = Date.now()): Promise<{ attempted: number; ok: number; failed: number; deferred: number }> {
  const db = await getDb();
  const due = queryAll<{ id: string }>(
    db,
    `SELECT id FROM wallets
     WHERE (next_sync_at IS NULL OR next_sync_at <= ?)
       AND (status != 'syncing' OR updated_at <= ?)
     ORDER BY COALESCE(next_sync_at, '') ASC, created_at ASC
     LIMIT ?`,
    [new Date(now).toISOString(), new Date(now - STUCK_SYNCING_MS).toISOString(), TICK_BATCH],
  );
  const counts = { attempted: due.length, ok: 0, failed: 0, deferred: 0 };
  for (const { id } of due) {
    const r = await syncWallet(id);
    if (r.ok) counts.ok++;
    else if (r.deferred) counts.deferred++;
    else counts.failed++;
  }
  return counts;
}

let timer: NodeJS.Timeout | null = null;
let ticking = false;

/** Start the background scheduler (idempotent). Returns a stop function. */
export function startWalletSyncScheduler(): () => void {
  if (process.env.WALLET_SYNC_DISABLED === '1' || timer) return stopWalletSyncScheduler;
  const tick = async () => {
    if (ticking) return; // never overlap passes
    ticking = true;
    try {
      const c = await runSyncTick();
      if (c.attempted > 0) logger.info('wallet_sync_tick', c);
    } catch (err) {
      logger.error('wallet_sync_tick_failed', { err: redactChainSecrets(String(err)).slice(0, 200) });
    } finally {
      ticking = false;
    }
  };
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  setTimeout(() => void tick(), 5_000).unref();
  return stopWalletSyncScheduler;
}

export function stopWalletSyncScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Tests only. */
export function resetSyncStateForTest(): void {
  networkLastCall.clear();
  networkBlockedUntil.clear();
  inflight.clear();
}
