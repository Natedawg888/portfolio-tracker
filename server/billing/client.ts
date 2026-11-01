/**
 * The Stripe API client (KAN-52), made lazily for the configured key. Tests swap in a fake
 * with setStripeClientForTests; nothing else in the app talks to Stripe directly.
 */
import Stripe from 'stripe';
import type { BillingConfig } from './config.ts';

let cached: { key: string; client: Stripe } | null = null;
let override: Stripe | null = null;

export function stripeClient(config: BillingConfig): Stripe {
  if (override) return override;
  if (cached?.key !== config.secretKey) {
    cached = { key: config.secretKey, client: new Stripe(config.secretKey, { maxNetworkRetries: 2, timeout: 20_000 }) };
  }
  return cached.client;
}

/** Tests only: route every Stripe call to `client` (null puts the real one back). */
export function setStripeClientForTests(client: Stripe | null): void {
  override = client;
}
