/**
 * Words and numbers for Settings → Account → Plan (KAN-52). Pure, so it's tested without a
 * browser: npm run test:billing.
 */
export type AccountPlan = 'free' | 'plus' | 'pro' | 'business';
export type PaidPlan = 'plus' | 'pro';
export type BillingInterval = 'month' | 'year';

export type BillingPrice = { plan: PaidPlan; interval: BillingInterval; amountCents: number };

export type BillingSubscription = {
  plan: PaidPlan;
  interval: BillingInterval;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
};

export const PLAN_LABELS: Record<AccountPlan, string> = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  business: 'Business',
};

/** What each paid plan adds (keep in step with server/lib/entitlements.ts). */
export const PLAN_FEATURES: Record<PaidPlan, readonly string[]> = {
  plus: ['Share with your household', 'Payslips and the PAYE check', 'Bonds: coupons, maturities and projections', 'Commodities in your asset mix'],
  pro: ['Everything in Plus', 'Advanced crypto: cost basis and gains, staking, DeFi and wallet import'],
};

export function formatNzd(cents: number): string {
  return `NZ$${(cents / 100).toFixed(2)}`;
}

export function priceFor(prices: readonly BillingPrice[], plan: PaidPlan, interval: BillingInterval): BillingPrice | null {
  return prices.find((p) => p.plan === plan && p.interval === interval) ?? null;
}

/** "NZ$9.99 a month" / "NZ$79.99 a year". */
export function priceText(p: BillingPrice): string {
  return `${formatNzd(p.amountCents)} a ${p.interval}`;
}

/** Whole percent saved by paying yearly instead of 12 months, or null when it isn't cheaper. */
export function yearlySavingPct(prices: readonly BillingPrice[], plan: PaidPlan): number | null {
  const m = priceFor(prices, plan, 'month');
  const y = priceFor(prices, plan, 'year');
  if (!m || !y || m.amountCents <= 0) return null;
  const pct = Math.floor((1 - y.amountCents / (m.amountCents * 12)) * 100);
  return pct > 0 ? pct : null;
}

function nzDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Pacific/Auckland' }).format(d);
}

/** One line about the subscription, e.g. "Billed yearly. Renews on 2 December 2026." */
export function subscriptionLine(sub: BillingSubscription): string {
  const label = PLAN_LABELS[sub.plan];
  if (sub.status === 'past_due') {
    return `Your last payment didn’t go through. Update your card in Manage billing to keep ${label}.`;
  }
  const billed = sub.interval === 'year' ? 'Billed yearly.' : 'Billed monthly.';
  const date = sub.currentPeriodEnd ? nzDate(sub.currentPeriodEnd) : '';
  if (sub.cancelAtPeriodEnd) {
    return date ? `Cancelled. ${label} stays on until ${date}, with no further charges.` : `Cancelled. No further charges.`;
  }
  if (sub.status === 'trialing') return date ? `Free trial until ${date}. ${billed}` : `Free trial. ${billed}`;
  return date ? `${billed} Renews on ${date}.` : billed;
}
