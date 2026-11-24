/**
 * Background jobs and per-user encryption (KAN-115, option A from KAN-106).
 *
 * With DATA_ENCRYPTION=1 a job only works on a user's data while that user has an unlocked
 * session. Users who are signed out (or locked) are skipped and caught up once they're back:
 *   - alerts are raised whenever the Alerts page loads, and the daily digest emails the next day;
 *   - overdue wallets stay due, so the scheduler syncs them within a minute of the user unlocking.
 * Akahu sync and dividend auto-add only ever run inside the user's own requests, so they already
 * follow this rule.
 *
 * The job runs in that user's crypto context with its own copy of the key (signing out zeroes the
 * session's key in place, which must not happen halfway through a job), and anything it saved in
 * plain into an encrypted column is encrypted straight after.
 *
 * With the flag off nothing is skipped, so behaviour is unchanged for everyone.
 *
 * Not gated: the invoice provider catch-up and the Stripe/Paddle webhooks work on business rows,
 * which stay plain until per-business keys (KAN-129 design) land; the linked-account deletion
 * sweep only deletes.
 */
import type { Database } from 'sql.js';
import { run } from '../db/index.ts';
import { sessionKeyStore } from './dataKey.ts';
import { encryptPendingForUser, encryptionEnabled, runWithCryptoContext } from './fieldCrypto.ts';

/** Who jobs may work for right now: null means everyone (encryption off). */
export function jobUserFilter(): Set<string> | null {
  return encryptionEnabled() ? sessionKeyStore.unlockedUserIds() : null;
}

export type JobRun<T> = { ran: true; value: T } | { ran: false };

/** Run one user's share of a job, or skip it when encryption is on and they aren't unlocked. */
export async function runAsUser<T>(db: Database, userId: string, fn: () => T | Promise<T>): Promise<JobRun<T>> {
  const live = sessionKeyStore.forUser(userId);
  if (encryptionEnabled() && !live) return { ran: false };
  const key = live ? Buffer.from(live) : null;
  try {
    const value = await runWithCryptoContext({ userId, key }, async () => await fn());
    if (key) {
      try {
        encryptPendingForUser(db, userId, key, run);
      } catch {
        /* the user's next change or sign-in tries again */
      }
    }
    return { ran: true, value };
  } finally {
    key?.fill(0);
  }
}
