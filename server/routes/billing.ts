/**
 * Billing (KAN-52): the account's plan and subscription, Stripe Checkout and the Customer
 * Portal. The webhook (billingWebhook) is mounted on its own in server/index.ts, before the
 * JSON body parser, because Stripe signs the raw body.
 */
import { Router, type Request, type Response } from 'express';
import Stripe from 'stripe';
import { getDb, queryOne } from '../db/index.ts';
import { planOf } from '../lib/entitlements.ts';
import { logger } from '../lib/logger.ts';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { CATALOG, isBillingInterval, isBillingPlan } from '../billing/catalog.ts';
import { billingConfig } from '../billing/config.ts';
import { BillingError, createCheckout, createPortal, handleBillingEvent } from '../billing/service.ts';
import { customerIdFor, grantingSubscriptions } from '../billing/store.ts';
import { shareBase } from './invoices.ts';

const router = Router();

function sendError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof BillingError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  logger.error('billing_stripe_error', { error: err instanceof Error ? err.message : String(err) });
  res.status(502).json({ error: fallback, code: 'STRIPE_ERROR' });
}

function unavailable(res: Response): void {
  res.status(503).json({ error: 'Paid plans aren’t available yet.', code: 'BILLING_UNAVAILABLE' });
}

router.get('/', async (req: AuthedRequest, res) => {
  const db = await getDb();
  const userId = req.user!.id;
  const cfg = billingConfig();
  const live = cfg.ok ? cfg.config.live : false;
  const sub = grantingSubscriptions(db, userId).find((s) => Boolean(s.livemode) === live) ?? null;
  res.json({
    available: cfg.ok,
    mode: cfg.ok ? (live ? 'live' : 'test') : null,
    plan: planOf(db, userId),
    subscription: sub
      ? {
          plan: sub.plan,
          interval: sub.billing_interval,
          status: sub.status,
          cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
          currentPeriodEnd: sub.current_period_end,
        }
      : null,
    canManage: cfg.ok && customerIdFor(db, userId, live) != null,
    prices: CATALOG.map((c) => ({ plan: c.plan, interval: c.interval, amountCents: c.amountCents })),
  });
});

router.post('/checkout', async (req: AuthedRequest, res) => {
  const cfg = billingConfig();
  if (!cfg.ok) return unavailable(res);
  const { plan, interval } = (req.body ?? {}) as { plan?: unknown; interval?: unknown };
  if (!isBillingPlan(plan) || !isBillingInterval(interval)) {
    res.status(400).json({ error: 'Choose Plus or Pro, monthly or yearly.', code: 'BAD_PLAN' });
    return;
  }
  const db = await getDb();
  const user = queryOne<{ id: string; email: string; first_name: string | null; last_name: string | null }>(
    db,
    `SELECT id, email, first_name, last_name FROM users WHERE id = ?`,
    [req.user!.id],
  );
  if (!user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  try {
    const url = await createCheckout(db, cfg.config, { id: user.id, email: user.email, name }, plan, interval, shareBase(req));
    res.json({ url });
  } catch (err) {
    sendError(res, err, 'Couldn’t open checkout. Try again in a minute.');
  }
});

router.post('/portal', async (req: AuthedRequest, res) => {
  const cfg = billingConfig();
  if (!cfg.ok) return unavailable(res);
  const db = await getDb();
  try {
    res.json({ url: await createPortal(db, cfg.config, req.user!.id, shareBase(req)) });
  } catch (err) {
    sendError(res, err, 'Couldn’t open billing. Try again in a minute.');
  }
});

/** POST /api/billing/webhook — needs express.raw() so the signature can be checked. */
export async function billingWebhook(req: Request, res: Response): Promise<void> {
  const cfg = billingConfig();
  if (!cfg.ok || !cfg.config.webhookSecret) {
    res.status(503).json({ error: 'Billing is not configured' });
    return;
  }
  const signature = req.get('stripe-signature');
  if (!signature || !Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: 'Missing signature' });
    return;
  }
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(req.body, signature, cfg.config.webhookSecret);
  } catch {
    logger.warn('billing_webhook_bad_signature', {});
    res.status(400).json({ error: 'Bad signature' });
    return;
  }
  // A live event with a test key (or the reverse) is never applied.
  if (event.livemode !== cfg.config.live) {
    logger.warn('billing_webhook_wrong_mode', { event: event.id, livemode: event.livemode });
    res.status(400).json({ error: 'Wrong mode' });
    return;
  }
  try {
    await handleBillingEvent(await getDb(), cfg.config, event);
    res.json({ received: true });
  } catch (err) {
    // 500 makes Stripe retry later.
    logger.error('billing_webhook_failed', { event: event.id, type: event.type, error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Webhook failed' });
  }
}

export default router;
