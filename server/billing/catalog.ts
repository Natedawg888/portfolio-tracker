/**
 * What KoruLedger sells through Stripe (KAN-52). Prices are NZD and include GST. Stripe finds
 * each price by its lookup key, so `npm run stripe:setup` can replace a price (a new amount)
 * without a code change; the amounts here are what that script creates and what Settings shows.
 *
 * Business (KAN-125) isn't sold here yet: it stays an operator grant until it has a price.
 */
export const BILLING_PLANS = ['plus', 'pro'] as const;
export type BillingPlan = (typeof BILLING_PLANS)[number];

export const BILLING_INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const BILLING_CURRENCY = 'nzd';

export type CatalogPrice = {
  plan: BillingPlan;
  interval: BillingInterval;
  lookupKey: string;
  /** NZ cents, GST included. */
  amountCents: number;
};

export const CATALOG: readonly CatalogPrice[] = [
  { plan: 'plus', interval: 'month', lookupKey: 'koruledger_plus_monthly', amountCents: 999 },
  { plan: 'plus', interval: 'year', lookupKey: 'koruledger_plus_yearly', amountCents: 7999 },
  { plan: 'pro', interval: 'month', lookupKey: 'koruledger_pro_monthly', amountCents: 1999 },
  { plan: 'pro', interval: 'year', lookupKey: 'koruledger_pro_yearly', amountCents: 14999 },
];

export const PRODUCTS: Record<BillingPlan, { id: string; name: string }> = {
  plus: { id: 'koruledger_plus', name: 'KoruLedger Plus' },
  pro: { id: 'koruledger_pro', name: 'KoruLedger Pro' },
};

export function isBillingPlan(v: unknown): v is BillingPlan {
  return (BILLING_PLANS as readonly unknown[]).includes(v);
}

export function isBillingInterval(v: unknown): v is BillingInterval {
  return (BILLING_INTERVALS as readonly unknown[]).includes(v);
}

export function catalogPrice(plan: BillingPlan, interval: BillingInterval): CatalogPrice {
  const p = CATALOG.find((c) => c.plan === plan && c.interval === interval);
  if (!p) throw new Error(`No price for ${plan}/${interval}`);
  return p;
}

/** The catalog entry behind a Stripe price's lookup key, or null for a price we don't sell. */
export function catalogByLookupKey(lookupKey: string | null | undefined): CatalogPrice | null {
  if (!lookupKey) return null;
  return CATALOG.find((c) => c.lookupKey === lookupKey) ?? null;
}
