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
import { billingResultUrl } from '../../src/lib/billingReturn.ts';
import { publicEmail } from '../auth/syntheticEmail.ts';
import { ensureStarterBusiness } from '../business/starter.ts';
import { queryOne } from '../db/index.ts';
import { logger } from '../lib/logger.ts';
import { BILLING_PLANS, catalogByLookupKey, catalogPrice, type BillingInterval, type BillingPlan, type CatalogPrice } from './catalog.ts';
import { stripeClient } from './client.ts';
import type { BillingConfig } from './config.ts';
import { businessCheckoutBlock, priceChangeDecision, proCheckoutBlock, usageModeFor, type GrantedPrice } from './planGuards.ts';
import { proPlanEnabled } from './proPlan.ts';
import {
  businessCancelOnlyPortalConfigId,
  knownBusinessPriceIds,
  personalPortalConfigId,
  portalHoldsPro,
  priceIsBusiness,
  rowsForPortal,
} from './portalConfig.ts';
import {
  billingAlertExists,
  customerIdFor,
  grantingSubscriptions,
  linkCustomer,
  recordBillingAlert,
  saveSubscription,
  subscriptionById,
  subscriptionsForUser,
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
  return known.reduce<CatalogPrice | null>((best, c) => {
    if (!best || BILLING_PLANS.indexOf(c.plan) > BILLING_PLANS.indexOf(best.plan)) return c;
    return best;
  }, null);
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
 *
 * `viaCheckout` is set for Checkout completion. Moving onto a Business price is granted only
 * then, and only for an account that may buy Business. Moving a Business subscription onto
 * any other price is kept at the granted price. Moving onto Pro while PRO_PLAN_ENABLED is off
 * is kept unless this customer already held Pro or this sync is Checkout completion.
 * An ignored price is put back on the subscription in Stripe (no proration) and recorded in
 * billing_alerts. The same webhook event does not revert twice. A canceled or incomplete_expired
 * subscription cannot be updated, and a failed revert is recorded on the alert: either way the
 * subscription status is still saved, so a cancel drops the paid plan. Pending prorations for
 * that rejected change are removed only after the revert succeeds.
 */
export async function syncSubscription(
  db: Database,
  config: BillingConfig,
  subscriptionId: string,
  options: { viaCheckout?: boolean; eventId?: string; eventCreated?: number } = {},
): Promise<boolean> {
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
  const stored = subscriptionById(db, sub.id);
  const previous = stored ? { plan: stored.plan, interval: stored.billing_interval } : null;
  const decision = priceChangeDecision({
    previous,
    next: { plan: entry.plan, interval: entry.interval },
    viaCheckout: options.viaCheckout === true,
    usage: usageModeFor(db, userId),
  });
  const plan = decision.applyPrice || !previous ? entry.plan : previous.plan;
  const interval = decision.applyPrice || !previous ? entry.interval : previous.interval;
  if (!decision.applyPrice && previous) {
    await revertIgnoredPrice(
      db,
      config,
      sub,
      userId,
      previous,
      entry,
      decision.reason,
      options.eventId,
      typeof options.eventCreated === 'number' ? options.eventCreated : null,
    );
  }
  if (!userIdForCustomer(db, customerId)) linkCustomer(db, userId, customerId, sub.livemode);
  saveSubscription(db, {
    id: sub.id,
    userId,
    customerId,
    plan,
    interval,
    status: sub.status,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end || sub.cancel_at),
    currentPeriodEnd: periodEndOf(sub),
    live: sub.livemode,
  });
  logger.info('billing_subscription_synced', { subscription: sub.id, user: userId, plan, status: sub.status });
  if (sub.status === 'active' || sub.status === 'trialing') ensureStarterBusiness(db, userId);
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
      if (subId) await syncSubscription(db, config, subId, { viaCheckout: true, eventId: event.id, eventCreated: eventCreatedSeconds(event) });
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      await syncSubscription(db, config, event.data.object.id, { eventId: event.id, eventCreated: eventCreatedSeconds(event) });
      return;
    default:
      return;
  }
}

async function ensureCustomer(db: Database, config: BillingConfig, user: { id: string; email: string; name?: string }): Promise<string> {
  const existing = customerIdFor(db, user.id, config.live);
  if (existing) return existing;
  const email = publicEmail(user.email);
  const customer = await stripeClient(config).customers.create({
    ...(email ? { email } : {}),
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
  returnTo?: unknown,
): Promise<string> {
  const proBlocked = proCheckoutBlock(plan);
  if (proBlocked) throw new BillingError(proBlocked.status, proBlocked.code, proBlocked.error);
  const businessBlocked = businessCheckoutBlock(plan, usageModeFor(db, user.id));
  if (businessBlocked) throw new BillingError(businessBlocked.status, businessBlocked.code, businessBlocked.error);
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
    success_url: billingResultUrl(baseUrl, returnTo, 'success'),
    cancel_url: billingResultUrl(baseUrl, returnTo, 'cancelled'),
  });
  if (!session.url) throw new BillingError(502, 'CHECKOUT_FAILED', 'Stripe didn’t return a checkout page.');
  return session.url;
}

export async function createPortal(db: Database, config: BillingConfig, userId: string, baseUrl: string): Promise<string> {
  const customerId = customerIdFor(db, userId, config.live);
  if (!customerId) throw new BillingError(404, 'NO_CUSTOMER', 'There’s no billing account to manage yet.');
  const stripe = stripeClient(config);
  const rows = subscriptionsForUser(db, userId, config.live);
  const considered = rowsForPortal(rows);
  // A stored Business row is enough, at any open status (unpaid and incomplete included).
  // Otherwise read the Stripe price: a refused change can still sit on a Business price id
  // or lookup key (koruledger_business_monthly / koruledger_business_yearly).
  let businessPrice = false;
  if (!considered.some((row) => row.plan === 'business') && considered.length > 0) {
    let businessPriceIds: ReadonlySet<string> | null = null;
    for (const row of considered) {
      const remote = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
      for (const item of remote.items.data) {
        const price = item.price;
        const ref =
          typeof price === 'string'
            ? { id: price, lookup_key: null, metadata: null }
            : { id: price.id, lookup_key: price.lookup_key, metadata: price.metadata };
        if (priceIsBusiness(ref, new Set())) {
          businessPrice = true;
          break;
        }
        if (!ref.lookup_key && ref.id) {
          businessPriceIds = businessPriceIds ?? (await knownBusinessPriceIds(stripe));
          if (priceIsBusiness(ref, businessPriceIds)) {
            businessPrice = true;
            break;
          }
        }
      }
      if (businessPrice) break;
    }
  }
  const business = considered.some((row) => row.plan === 'business') || businessPrice;
  const configuration = business
    ? await businessCancelOnlyPortalConfigId(stripe, config.portalBusinessConfigId)
    : await personalPortalConfigId(stripe, config.portalPersonalConfigId, {
        proEnabled: proPlanEnabled(),
        holdsPro: portalHoldsPro(rows),
      });
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${baseUrl}/settings?tab=account`,
    configuration,
  });
  return session.url;
}

function priceIdOf(price: Stripe.SubscriptionItem['price'] | string | null | undefined): string | null {
  if (!price) return null;
  return typeof price === 'string' ? price : price.id;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Stripe rejects subscription updates once the subscription is over. */
function subscriptionIsClosed(status: string): boolean {
  return status === 'canceled' || status === 'incomplete_expired';
}

/** invoiceItems.list pages at most 100 (Stripe API 2026-10-28.endive, stripe-node 23). */
const INVOICE_ITEM_PAGE = 100;

/**
 * A pending proration counts as this rejected change when its period start or
 * creation time is within two minutes of the webhook. That covers Stripe
 * stamping the invoice item slightly before or after the event.
 */
export const PRORATION_MATCH_WINDOW_SEC = 120;

/** Unix seconds. Amounts and quantities must not be read as timestamps. */
const UNIX_STAMP_MIN = 1_000_000_000;
const UNIX_STAMP_MAX = 4_000_000_000;

function eventCreatedSeconds(event: Stripe.Event): number | undefined {
  return typeof event.created === 'number' ? event.created : undefined;
}

function unixStamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < UNIX_STAMP_MIN || value > UNIX_STAMP_MAX) return null;
  return value;
}

function idString(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

/**
 * Subscription that owns the invoice item. API 2026-10-28.endive puts it on
 * parent.subscription_details.subscription (a string, or an expanded id).
 * Older invoice items used a top-level subscription field. Null when neither
 * is a non-empty id.
 */
function prorationSubscriptionId(item: Stripe.InvoiceItem): string | null {
  const fromParent = idString(item.parent?.subscription_details?.subscription);
  if (fromParent) return fromParent;
  return idString((item as { subscription?: unknown }).subscription);
}

/**
 * Stamps that can place the proration on the rejected change. Creation time
 * is InvoiceItem.date on this API version; a legacy created number is used
 * only when date is not a unix time. period.end is the billing-period end,
 * not the moment of the change, so it is not a stamp.
 */
function prorationStamps(item: Stripe.InvoiceItem): number[] {
  const created = unixStamp(item.date) ?? unixStamp((item as { created?: unknown }).created);
  const periodStart = unixStamp(item.period?.start);
  return [created, periodStart].filter((stamp): stamp is number => stamp != null);
}

/**
 * Pending-proration cleanup rule.
 *
 * Runs only after the granted price is restored. A closed subscription, a
 * failed revert, or a duplicate event does not delete invoice items.
 *
 * invoiceItems.list on API 2026-10-28.endive takes customer, pending, created,
 * and cursor paging. It does not take subscription (Stripe returns 400). The
 * customer's pending items are listed 100 at a time with starting_after until
 * has_more is false, then filtered here. Every page is read before any delete,
 * so the cursor still exists.
 *
 * An item is deleted only when all of these hold:
 * 1. proration is true.
 * 2. The owner is exactly this subscription id. The owner is
 *    parent.subscription_details.subscription, otherwise the legacy
 *    subscription field. A null, missing, or other owner is skipped.
 * 3. period.start or the creation time falls in the change window.
 *
 * The change is the webhook update. previous_attributes is the subscription
 * before that update; the time of the change is event.created. The window is
 * event.created ± PRORATION_MATCH_WINDOW_SEC, so a stamp at or after the
 * change still matches when Stripe wrote the invoice item a few seconds
 * early, and a stamp later than the window is a later change. Timestamps
 * inside previous_attributes (for example the previous current_period_start)
 * are the old billing period and do not widen the window. With no
 * event.created, the window is unknown and nothing is deleted.
 */
function prorationInChangeWindow(item: Stripe.InvoiceItem, eventCreated: number): boolean {
  const earliest = eventCreated - PRORATION_MATCH_WINDOW_SEC;
  const latest = eventCreated + PRORATION_MATCH_WINDOW_SEC;
  return prorationStamps(item).some((stamp) => stamp >= earliest && stamp <= latest);
}

async function removePendingProrations(stripe: Stripe, sub: Stripe.Subscription, eventCreated: number | null): Promise<string> {
  const customer = idOf(sub.customer);
  if (!customer || eventCreated == null) return '';
  const pending: Stripe.InvoiceItem[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const listed = await stripe.invoiceItems.list({
      customer,
      pending: true,
      limit: INVOICE_ITEM_PAGE,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    pending.push(...listed.data);
    if (!listed.has_more) break;
    const lastId = listed.data[listed.data.length - 1]?.id;
    if (!lastId || lastId === startingAfter) break;
    startingAfter = lastId;
  }
  const removed: string[] = [];
  const failed: string[] = [];
  for (const item of pending) {
    if (!item.proration) continue;
    if (prorationSubscriptionId(item) !== sub.id) continue;
    if (!prorationInChangeWindow(item, eventCreated)) continue;
    try {
      await stripe.invoiceItems.del(item.id);
      removed.push(item.id);
    } catch (err) {
      failed.push(`${item.id}: ${errorText(err)}`);
    }
  }
  const parts: string[] = [];
  if (removed.length) parts.push(`removed pending prorations: ${removed.join(', ')}`);
  if (failed.length) parts.push(`pending prorations not removed: ${failed.join('; ')}`);
  return parts.join('; ');
}

async function revertStripePrice(stripe: Stripe, sub: Stripe.Subscription, entitled: GrantedPrice, rejected: CatalogPrice): Promise<void> {
  const entitledPrice = catalogPrice(entitled.plan, entitled.interval);
  const listed = await stripe.prices.list({ lookup_keys: [entitledPrice.lookupKey], active: true, limit: 1 });
  const priceId = listed.data[0]?.id;
  if (!priceId) throw new Error(`Missing Stripe price for ${entitledPrice.lookupKey}`);
  const item =
    sub.items.data.find((candidate) => {
      const key = typeof candidate.price === 'string' ? null : candidate.price.lookup_key;
      const entry = catalogByLookupKey(key);
      return entry?.plan === rejected.plan && entry.interval === rejected.interval;
    }) ??
    sub.items.data.find((candidate) => {
      const key = typeof candidate.price === 'string' ? null : candidate.price.lookup_key;
      return catalogByLookupKey(key) != null;
    }) ??
    sub.items.data[0];
  if (!item?.id) throw new Error(`Subscription ${sub.id} has no item to revert`);
  if (priceIdOf(item.price) !== priceId) {
    await stripe.subscriptions.update(sub.id, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: 'none',
    });
  }
}

/**
 * Put the subscription item back on the price we still grant. proration_behavior none, so
 * Stripe does not bill for the switch we are undoing. The same event id is stored once:
 * a retry sees the alert and does not update Stripe again.
 *
 * Never throws. A closed subscription is not updated. Any other Stripe error is stored on the
 * alert so the caller can still save the subscription status.
 */
async function revertIgnoredPrice(
  db: Database,
  config: BillingConfig,
  sub: Stripe.Subscription,
  userId: string,
  entitled: GrantedPrice,
  rejected: CatalogPrice,
  reason: string,
  eventId: string | undefined,
  eventCreated: number | null,
): Promise<void> {
  const id = eventId?.trim() || `local:${sub.id}:${entitled.plan}/${entitled.interval}:${rejected.plan}/${rejected.interval}`;
  const base = {
    subscription: sub.id,
    user: userId,
    reason,
    from: `${entitled.plan}/${entitled.interval}`,
    to: `${rejected.plan}/${rejected.interval}`,
  };
  if (billingAlertExists(db, id, sub.id)) {
    logger.info('billing_plan_change_ignored', { ...base, duplicate: true });
    return;
  }
  const stripe = stripeClient(config);
  const closed = subscriptionIsClosed(sub.status);
  let error = '';
  let reverted = false;
  const notes: string[] = [];
  if (closed) {
    notes.push(`Stripe price left unchanged; a ${sub.status} subscription cannot be updated`);
  } else {
    try {
      await revertStripePrice(stripe, sub, entitled, rejected);
      reverted = true;
    } catch (err) {
      error = errorText(err);
      logger.error('billing_plan_change_revert_failed', { ...base, error });
    }
  }
  if (reverted) {
    try {
      const cleaned = await removePendingProrations(stripe, sub, eventCreated);
      if (cleaned) notes.push(cleaned);
    } catch (err) {
      const note = `pending prorations not removed: ${errorText(err)}`;
      notes.push(note);
      logger.warn('billing_proration_cleanup_failed', { ...base, error: errorText(err) });
    }
  }
  const alert = recordBillingAlert(db, {
    eventId: id,
    subscriptionId: sub.id,
    userId,
    reason,
    fromPlan: entitled.plan,
    fromInterval: entitled.interval,
    toPlan: rejected.plan,
    toInterval: rejected.interval,
    error,
    detail: notes.join('; '),
  });
  logger.warn('billing_plan_change_ignored', { ...base, alert, reverted: !closed && !error, error: error || undefined });
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
