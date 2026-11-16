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
import { deleteBillingRowsForUser } from '../billing/store.ts';
import { getDb, queryAll, run } from '../db/index.ts';
import { logger } from '../lib/logger.ts';
import { deleteScopedDataForUser, getDataOwnerUserId } from '../lib/userScope.ts';
import { deleteAvatarFile } from '../lib/uploads.ts';
import { destroySessionsForUser } from './sessions.ts';

export const LINKED_DELETION_SWEEP_MS = 15 * 60 * 1000;

/** Stripe statuses that are not finished. Canceled and incomplete_expired are terminal. */
export const NON_TERMINAL_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'] as const;

const nonTerminalList = NON_TERMINAL_SUBSCRIPTION_STATUSES.map((s) => `'${s}'`).join(',');

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

type SubRef = { stripe_subscription_id: string; livemode: number; status: string };

function nonTerminalSubscriptions(db: Database, userId: string): SubRef[] {
  return queryAll<SubRef>(
    db,
    `SELECT stripe_subscription_id, livemode, status FROM billing_subscriptions
     WHERE user_id = ? AND status IN (${nonTerminalList})`,
    [userId],
  );
}

function stripeErrorCode(err: unknown): string {
  if (!err || typeof err !== 'object' || !('code' in err)) return '';
  const code = (err as { code?: unknown }).code;
  return code == null ? '' : String(code);
}

/**
 * Cancel failed. Ask Stripe what the subscription is now. canceled and
 * incomplete_expired are finished. resource_missing on the retrieve, or on the
 * cancel error, means it is already gone. The error wording is not used.
 */
async function subscriptionCancelFinished(
  stripe: ReturnType<typeof stripeClient>,
  subscriptionId: string,
  cancelErr: unknown,
): Promise<boolean> {
  try {
    const remote = await stripe.subscriptions.retrieve(subscriptionId);
    return remote.status === 'canceled' || remote.status === 'incomplete_expired';
  } catch (retrieveErr) {
    return stripeErrorCode(retrieveErr) === 'resource_missing' || stripeErrorCode(cancelErr) === 'resource_missing';
  }
}

function markSubscriptionCanceled(db: Database, userId: string, subscriptionId: string): void {
  run(db, `UPDATE billing_subscriptions SET status = 'canceled', updated_at = ? WHERE stripe_subscription_id = ? AND user_id = ?`, [
    new Date().toISOString(),
    subscriptionId,
    userId,
  ]);
}

/**
 * Cancel non-terminal subscriptions whose livemode matches the current billing
 * config (active, trialing, past_due, unpaid, incomplete, paused). Other-mode
 * rows are left in place. A cancel error is followed by a retrieve: canceled,
 * incomplete_expired, or resource_missing counts as success. Never throws.
 */
export async function cancelMarkedSubscriptionBestEffort(db: Database, userId: string): Promise<{ cancelled: string[]; failed: string[] }> {
  const cancelled: string[] = [];
  const failed: string[] = [];
  const subs = nonTerminalSubscriptions(db, userId);
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
      markSubscriptionCanceled(db, userId, sub.stripe_subscription_id);
      cancelled.push(sub.stripe_subscription_id);
    } catch (err) {
      if (await subscriptionCancelFinished(stripe, sub.stripe_subscription_id, err)) {
        markSubscriptionCanceled(db, userId, sub.stripe_subscription_id);
        cancelled.push(sub.stripe_subscription_id);
        continue;
      }
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

/**
 * Retry cancels, then purge a marked user once no non-terminal subscription
 * remains in any mode. `onlyUserIds` limits the pass to those accounts
 * (the personal deletion that just marked them).
 */
export async function settleMarkedLinkedAccounts(db: Database, onlyUserIds?: readonly string[]): Promise<SettleResult> {
  const purged: string[] = [];
  const waiting: string[] = [];
  const only = onlyUserIds ? new Set(onlyUserIds) : null;
  for (const row of listOwnerDeletionPending(db)) {
    if (only && !only.has(row.id)) continue;
    try {
      await cancelMarkedSubscriptionBestEffort(db, row.id);
      if (nonTerminalSubscriptions(db, row.id).length > 0) {
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
