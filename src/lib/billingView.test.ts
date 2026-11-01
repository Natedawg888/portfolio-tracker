/** Settings → Plan wording (KAN-52). Run: npm run test:billing */
import { formatNzd, priceFor, priceText, subscriptionLine, yearlySavingPct, type BillingPrice } from './billingView.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

const prices: BillingPrice[] = [
  { plan: 'plus', interval: 'month', amountCents: 999 },
  { plan: 'plus', interval: 'year', amountCents: 7999 },
  { plan: 'pro', interval: 'month', amountCents: 1999 },
  { plan: 'pro', interval: 'year', amountCents: 14999 },
];

eq(formatNzd(999), 'NZ$9.99', 'cents to dollars');
eq(formatNzd(14999), 'NZ$149.99', 'yearly Pro');
eq(priceText(priceFor(prices, 'plus', 'year')!), 'NZ$79.99 a year', 'price text');
eq(priceFor(prices, 'pro', 'month')?.amountCents, 1999, 'lookup');
eq(yearlySavingPct(prices, 'plus'), 33, 'Plus yearly saves 33%');
eq(yearlySavingPct(prices, 'pro'), 37, 'Pro yearly saves 37%');
eq(yearlySavingPct([{ plan: 'plus', interval: 'month', amountCents: 100 }, { plan: 'plus', interval: 'year', amountCents: 1200 }], 'plus'), null, 'no saving, no badge');

const base = { plan: 'plus' as const, interval: 'year' as const, status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: '2026-12-02T00:00:00.000Z' };
eq(subscriptionLine(base), 'Billed yearly. Renews on 2 December 2026.', 'active, NZ date');
eq(subscriptionLine({ ...base, interval: 'month', currentPeriodEnd: null }), 'Billed monthly.', 'no date');
eq(subscriptionLine({ ...base, cancelAtPeriodEnd: true }), 'Cancelled. Plus stays on until 2 December 2026, with no further charges.', 'cancelled');
eq(subscriptionLine({ ...base, plan: 'pro', status: 'past_due' }), 'Your last payment didn’t go through. Update your card in Manage billing to keep Pro.', 'past due');
eq(subscriptionLine({ ...base, status: 'trialing' }), 'Free trial until 2 December 2026. Billed yearly.', 'trial');

console.log('billingView tests passed');
