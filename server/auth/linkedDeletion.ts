/**
 * Created business accounts (no login of their own) marked when their personal
 * owner is deleted. Accounts that can sign in are only detached and are not
 * handled here.
 *
 * After the personal account is gone, cancel any subscription this billing
 * config can reach (test mode unless STRIPE_LIVE_ENABLED is on). A failure is
 * logged and retried by the sweep. The user is purged only once no granting
 * subscription remains, so a live subscription is left alone while this process
 * is on a test key.
 */
import type { Database } from 'sql.js';
import { billingConfig } from '../billing/config.ts';
import { stripeClient } from '../billing/client.ts';
import { deleteBillingRowsForUser, grantingSubscriptions } from '../billing/store.ts';
import { getDb, queryAll, run } from '../db/index.ts';
import { logger } from '../lib/logger.ts';
import { deleteScopedDataForUser, getDataOwnerUserId } from '../lib/userScope.ts';
import { deleteAvatarFile } from '../lib/uploads.ts';
import { destroySessionsForUser } from './sessions.ts';

export const LINKED_DELETION_SWEEP_MS = 15 * 60 * 1000;

type PendingRow = { id: string; preferences_json: string | null; avatar_url: string | null };

export function listOwnerDeletionPending(db: Database): PendingRow[] {
  const rows = queryAll<PendingRow>(
    db,
    `SELECT id, preferences_json, avatar_url FROM users WHERE preferences_json LIKE '%"owner_account_deleted"%'`,
  );
  return rows.filter((row) => {
    try {
      const parsed = JSON.parse(row.preferences_json || '{}') as { pendingDeletion?: { reason?: string } };
      return parsed.pendingDeletion?.reason === 'owner_account_deleted';
    } catch {
      return false;
    }
  });
}

/**
 * Cancel granting subscriptions whose livemode matches the current billing
 * config. Other-mode rows are left in place. Never throws.
 */
export async function cancelMarkedSubscriptionBestEffort(db: Database, userId: string): Promise<{ cancelled: string[]; failed: string[] }> {
  const cancelled: string[] = [];
  const failed: string[] = [];
  const subs = grantingSubscriptions(db, userId);
  if (subs.length === 0) return { cancelled, failed };
  const cfg = billingConfig();
  if (!cfg.ok) {
    logger.error('linked_deletion_cancel_unavailable', { user: userId, subscriptions: subs.length, reason: cfg.reason });
    return { cancelled, failed: subs.map((s) => s.stripe_subscription_id) };
  }
  const stripe = stripeClient(cfg.config);
  for (const sub of subs) {
    if (Boolean(sub.livemode) !== cfg.config.live) {
      logger.warn('linked_deletion_skip_other_mode', {
        user: userId,
        subscription: sub.stripe_subscription_id,
        livemode: Boolean(sub.livemode),
        configLive: cfg.config.live,
      });
      continue;
    }
    try {
      await stripe.subscriptions.cancel(sub.stripe_subscription_id);
      run(db, `UPDATE billing_subscriptions SET status = 'canceled', updated_at = ? WHERE stripe_subscription_id = ? AND user_id = ?`, [
        new Date().toISOString(),
        sub.stripe_subscription_id,
        userId,
      ]);
      cancelled.push(sub.stripe_subscription_id);
    } catch (err) {
      logger.error('linked_deletion_cancel_failed', {
        user: userId,
        subscription: sub.stripe_subscription_id,
        error: err instanceof Error ? err.message : String(err),
      });
      failed.push(sub.stripe_subscription_id);
    }
  }
  return { cancelled, failed };
}

/** Remove a marked business user and their books. Caller has already decided no granting subscription remains. */
export function purgeMarkedLinkedUser(db: Database, userId: string): void {
  const row = queryAll<{ avatar_url: string | null }>(db, `SELECT avatar_url FROM users WHERE id = ?`, [userId])[0];
  if (!row) return;
  deleteScopedDataForUser(db, userId);
  run(db, `DELETE FROM akahu_connections WHERE user_id = ?`, [userId]);
  if (row.avatar_url && !row.avatar_url.startsWith('data:')) deleteAvatarFile(row.avatar_url);
  destroySessionsForUser(db, userId);
  for (const table of [
    'user_backup_codes',
    'trusted_devices',
    'login_challenges',
    'user_identities',
    'user_passkeys',
    'webauthn_challenges',
    'auth_events',
    'user_entitlements',
    'email_changes',
  ]) {
    run(db, `DELETE FROM ${table} WHERE user_id = ?`, [userId]);
  }
  deleteBillingRowsForUser(db, userId);
  run(db, `DELETE FROM account_links WHERE owner_user_id = ? OR linked_user_id = ?`, [userId, userId]);
  if (getDataOwnerUserId(db) === userId) {
    run(db, `DELETE FROM meta WHERE key = 'data_owner_user_id'`);
    run(db, `DELETE FROM meta WHERE key = 'data_claimed_at'`);
    run(db, `DELETE FROM app_settings WHERE key LIKE 'gomining%' OR key = 'collectableTypes'`);
  }
  run(db, `DELETE FROM users WHERE id = ?`, [userId]);
}

export type SettleResult = { purged: string[]; waiting: string[] };

/** Retry cancels, then purge anyone who no longer has a granting subscription. */
export async function settleMarkedLinkedAccounts(db: Database): Promise<SettleResult> {
  const purged: string[] = [];
  const waiting: string[] = [];
  for (const row of listOwnerDeletionPending(db)) {
    try {
      await cancelMarkedSubscriptionBestEffort(db, row.id);
      if (grantingSubscriptions(db, row.id).length > 0) {
        waiting.push(row.id);
        continue;
      }
      purgeMarkedLinkedUser(db, row.id);
      purged.push(row.id);
    } catch (err) {
      logger.error('linked_deletion_purge_failed', { user: row.id, error: err instanceof Error ? err.message : String(err) });
      waiting.push(row.id);
    }
  }
  return { purged, waiting };
}

/** Startup and interval. Failures are logged; they never stop the server. */
export function startLinkedDeletionSweep(): () => void {
  const tick = () => {
    getDb()
      .then((db) => settleMarkedLinkedAccounts(db))
      .catch((err) => logger.error('linked_deletion_sweep_failed', { error: err instanceof Error ? err.message : String(err) }));
  };
  tick();
  const timer = setInterval(tick, LINKED_DELETION_SWEEP_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
