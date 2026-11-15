/**
 * Billing actions (KAN-52): Checkout to start a subscription, the Customer Portal to change or
 * cancel it, syncing a subscription from Stripe, and cancelling on account deletion.
 *
 * Stripe is the source of truth. A webhook only says "this subscription changed"; we fetch the
 * subscription itself before saving it, so events that arrive late or out of order can't roll
 * a plan back.
 */
import type Stripe from 'stripe';
import type { Database } from 'sql.js';
import { queryOne } from '../db/index.ts';
import { logger } from '../lib/logger.ts';
import { catalogByLookupKey, catalogPrice, type BillingInterval, type BillingPlan, type CatalogPrice } from './catalog.ts';
import { stripeClient } from './client.ts';
import type { BillingConfig } from './config.ts';
import {
  customerIdFor,
  grantingSubscriptions,
  linkCustomer,
  saveSubscription,
  userIdForCustomer,
} from './store.ts';

export class BillingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v : v.id;
}

/** The plan and interval a Stripe subscription is for: its best item we sell, or null. */
export function catalogForSubscription(sub: Stripe.Subscription): CatalogPrice | null {
  const known = sub.items.data
    .map((item) => catalogByLookupKey(item.price.lookup_key))
    .filter((c): c is CatalogPrice => c != null);
  return known.find((c) => c.plan === 'pro') ?? known[0] ?? null;
}

/** When the current paid period ends (Stripe keeps it on each item since API 2025-03-31). */
export function periodEndOf(sub: Stripe.Subscription): string | null {
  const ends = sub.items.data.map((i) => i.current_period_end).filter((n) => typeof n === 'number' && n > 0);
  return ends.length ? new Date(Math.max(...ends) * 1000).toISOString() : null;
}

function userExists(db: Database, userId: string): boolean {
  return queryOne(db, `SELECT id FROM users WHERE id = ?`, [userId]) != null;
}

/**
 * Fetch a subscription from Stripe and save it against its user. Returns false when it can't
 * be tied to an account or isn't for anything we sell (logged, not retried).
 */
export async function syncSubscription(db: Database, config: BillingConfig, subscriptionId: string): Promise<boolean> {
  const sub = await stripeClient(config).subscriptions.retrieve(subscriptionId);
  const customerId = idOf(sub.customer);
  if (!customerId) return false;
  const metaUser = sub.metadata?.user_id?.trim() || null;
  const userId = metaUser && userExists(db, metaUser) ? metaUser : userIdForCustomer(db, customerId);
  if (!userId) {
    logger.warn('billing_subscription_no_user', { subscription: sub.id, customer: customerId });
    return false;
  }
  const entry = catalogForSubscription(sub);
  if (!entry) {
    logger.warn('billing_subscription_unknown_price', { subscription: sub.id });
    return false;
  }
  if (!userIdForCustomer(db, customerId)) linkCustomer(db, userId, customerId, sub.livemode);
  saveSubscription(db, {
    id: sub.id,
    userId,
    customerId,
    plan: entry.plan,
    interval: entry.interval,
    status: sub.status,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end || sub.cancel_at),
    currentPeriodEnd: periodEndOf(sub),
    live: sub.livemode,
  });
  logger.info('billing_subscription_synced', { subscription: sub.id, user: userId, plan: entry.plan, status: sub.status });
  return true;
}

/** Handle one verified webhook event. Throws to make Stripe retry (e.g. Stripe unreachable). */
export async function handleBillingEvent(db: Database, config: BillingConfig, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object;
      if (session.mode !== 'subscription') return;
      const customerId = idOf(session.customer);
      const userId = session.client_reference_id?.trim() || null;
      if (customerId && userId && userExists(db, userId) && !userIdForCustomer(db, customerId)) {
        linkCustomer(db, userId, customerId, event.livemode);
      }
      const subId = idOf(session.subscription);
      if (subId) await syncSubscription(db, config, subId);
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      await syncSubscription(db, config, event.data.object.id);
      return;
    default:
      return;
  }
}

async function ensureCustomer(db: Database, config: BillingConfig, user: { id: string; email: string; name?: string }): Promise<string> {
  const existing = customerIdFor(db, user.id, config.live);
  if (existing) return existing;
  const customer = await stripeClient(config).customers.create({
    email: user.email,
    name: user.name || undefined,
    metadata: { user_id: user.id },
  });
  linkCustomer(db, user.id, customer.id, config.live);
  return customer.id;
}

export async function createCheckout(
  db: Database,
  config: BillingConfig,
  user: { id: string; email: string; name?: string },
  plan: BillingPlan,
  interval: BillingInterval,
  baseUrl: string,
): Promise<string> {
  if (grantingSubscriptions(db, user.id).some((s) => Boolean(s.livemode) === config.live)) {
    throw new BillingError(409, 'ALREADY_SUBSCRIBED', 'You already have a subscription. Use Manage billing to change or cancel it.');
  }
  const stripe = stripeClient(config);
  const entry = catalogPrice(plan, interval);
  const prices = await stripe.prices.list({ lookup_keys: [entry.lookupKey], active: true, limit: 1 });
  const price = prices.data[0];
  if (!price) {
    logger.error('billing_price_missing', { lookupKey: entry.lookupKey });
    throw new BillingError(503, 'PRICE_MISSING', 'That plan isn’t available to buy right now.');
  }
  const customerId = await ensureCustomer(db, config, user);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price: price.id, quantity: 1, ...(config.gstTaxRateId ? { tax_rates: [config.gstTaxRateId] } : {}) }],
    subscription_data: { metadata: { user_id: user.id } },
    customer_update: { name: 'auto', address: 'auto' },
    success_url: `${baseUrl}/settings?tab=account&billing=success`,
    cancel_url: `${baseUrl}/settings?tab=account&billing=cancelled`,
  });
  if (!session.url) throw new BillingError(502, 'CHECKOUT_FAILED', 'Stripe didn’t return a checkout page.');
  return session.url;
}

export async function createPortal(db: Database, config: BillingConfig, userId: string, baseUrl: string): Promise<string> {
  const customerId = customerIdFor(db, userId, config.live);
  if (!customerId) throw new BillingError(404, 'NO_CUSTOMER', 'There’s no billing account to manage yet.');
  const session = await stripeClient(config).billingPortal.sessions.create({
    customer: customerId,
    return_url: `${baseUrl}/settings?tab=account`,
    ...(config.portalConfigId ? { configuration: config.portalConfigId } : {}),
  });
  return session.url;
}

/**
 * Cancel every subscription still charging this user, before their account is deleted. Throws
 * BillingError when one can't be cancelled, so the account isn't deleted while still billed.
 */
export async function cancelSubscriptionsForDeletion(db: Database, config: BillingConfig | null, userId: string): Promise<number> {
  const subs = grantingSubscriptions(db, userId);
  if (subs.length === 0) return 0;
  const usable = config ? subs.filter((s) => Boolean(s.livemode) === config.live) : [];
  if (!config || usable.length !== subs.length) {
    logger.error('billing_cancel_on_delete_unavailable', { user: userId, subscriptions: subs.length });
    throw new BillingError(
      503,
      'SUBSCRIPTION_ACTIVE',
      'Your subscription couldn’t be cancelled automatically. Cancel it in Manage billing, or email koruledger@gmail.com, then delete your account.',
    );
  }
  const stripe = stripeClient(config!);
  for (const s of usable) {
    try {
      await stripe.subscriptions.cancel(s.stripe_subscription_id);
    } catch (err) {
      logger.error('billing_cancel_on_delete_failed', { user: userId, subscription: s.stripe_subscription_id, error: String(err) });
      throw new BillingError(
        502,
        'SUBSCRIPTION_CANCEL_FAILED',
        'Your subscription couldn’t be cancelled just now, so your account wasn’t deleted. Try again in a minute.',
      );
    }
  }
  return usable.length;
}
