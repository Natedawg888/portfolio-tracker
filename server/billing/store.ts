/**
 * Stripe customers and subscriptions as KoruLedger last saw them (KAN-52). The webhook writes
 * here; planOf (server/lib/entitlements.ts) reads the plan a paid subscription grants. Rows are
 * kept per mode (test/live) so switching keys never reuses a customer from the other mode.
 */
import type { Database } from 'sql.js';
import { queryAll, queryOne, run } from '../db/index.ts';
import type { BillingInterval, BillingPlan } from './catalog.ts';

/**
 * Stripe statuses that keep the plan. past_due stays on while Stripe retries the card (its
 * Smart Retries end in canceled or unpaid, which drop it).
 */
export const GRANTING_STATUSES = ['active', 'trialing', 'past_due'] as const;

export type SubscriptionRow = {
  stripe_subscription_id: string;
  user_id: string;
  stripe_customer_id: string;
  plan: BillingPlan;
  billing_interval: BillingInterval;
  status: string;
  cancel_at_period_end: number;
  current_period_end: string | null;
  livemode: number;
  updated_at: string;
};

const granting = `status IN (${GRANTING_STATUSES.map((s) => `'${s}'`).join(',')})`;

export function customerIdFor(db: Database, userId: string, live: boolean): string | null {
  const r = queryOne<{ stripe_customer_id: string }>(
    db,
    `SELECT stripe_customer_id FROM billing_customers WHERE user_id = ? AND livemode = ?`,
    [userId, live ? 1 : 0],
  );
  return r?.stripe_customer_id ?? null;
}

export function userIdForCustomer(db: Database, customerId: string): string | null {
  const r = queryOne<{ user_id: string }>(db, `SELECT user_id FROM billing_customers WHERE stripe_customer_id = ?`, [customerId]);
  return r?.user_id ?? null;
}

export function linkCustomer(db: Database, userId: string, customerId: string, live: boolean): void {
  run(
    db,
    `INSERT INTO billing_customers (user_id, livemode, stripe_customer_id, created_at) VALUES (?,?,?,?)
     ON CONFLICT(user_id, livemode) DO UPDATE SET stripe_customer_id = excluded.stripe_customer_id`,
    [userId, live ? 1 : 0, customerId, new Date().toISOString()],
  );
}

export type SubscriptionInput = {
  id: string;
  userId: string;
  customerId: string;
  plan: BillingPlan;
  interval: BillingInterval;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  live: boolean;
};

export function saveSubscription(db: Database, s: SubscriptionInput): void {
  run(
    db,
    `INSERT INTO billing_subscriptions
       (stripe_subscription_id, user_id, stripe_customer_id, plan, billing_interval, status,
        cancel_at_period_end, current_period_end, livemode, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(stripe_subscription_id) DO UPDATE SET
       user_id = excluded.user_id, stripe_customer_id = excluded.stripe_customer_id,
       plan = excluded.plan, billing_interval = excluded.billing_interval, status = excluded.status,
       cancel_at_period_end = excluded.cancel_at_period_end,
       current_period_end = excluded.current_period_end, livemode = excluded.livemode,
       updated_at = excluded.updated_at`,
    [
      s.id,
      s.userId,
      s.customerId,
      s.plan,
      s.interval,
      s.status,
      s.cancelAtPeriodEnd ? 1 : 0,
      s.currentPeriodEnd,
      s.live ? 1 : 0,
      new Date().toISOString(),
    ],
  );
}

/** Subscriptions that currently grant a plan (any mode), best plan first. */
export function grantingSubscriptions(db: Database, userId: string): SubscriptionRow[] {
  return queryAll<SubscriptionRow>(
    db,
    `SELECT * FROM billing_subscriptions WHERE user_id = ? AND ${granting}
     ORDER BY CASE plan WHEN 'pro' THEN 0 ELSE 1 END, updated_at DESC`,
    [userId],
  );
}

/** The plan a paid subscription gives this user: 'pro', 'plus' or null. */
export function subscribedPlanOf(db: Database, userId: string): BillingPlan | null {
  return grantingSubscriptions(db, userId)[0]?.plan ?? null;
}

export function deleteBillingRowsForUser(db: Database, userId: string): void {
  run(db, `DELETE FROM billing_subscriptions WHERE user_id = ?`, [userId]);
  run(db, `DELETE FROM billing_customers WHERE user_id = ?`, [userId]);
}
