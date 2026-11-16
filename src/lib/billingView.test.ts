/** Settings → Plan wording (KAN-52). Run: npm run test:billing */
import { BILLING_TEST_NOTE, FREE_FEATURES, PLAN_FEATURES, checkoutPendingText, formatNzd, offeredPaidPlans, offeredPlans, plusFeatureLines, priceFor, priceText, subscriptionLine, yearlySavingPct, type BillingPrice } from './billingView.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

const prices: BillingPrice[] = [
  { plan: 'plus', interval: 'month', amountCents: 999 },
  { plan: 'plus', interval: 'year', amountCents: 7999 },
  { plan: 'pro', interval: 'month', amountCents: 1999 },
  { plan: 'pro', interval: 'year', amountCents: 14999 },
  { plan: 'business', interval: 'month', amountCents: 2999 },
  { plan: 'business', interval: 'year', amountCents: 24999 },
];

eq(formatNzd(999), 'NZ$9.99', 'cents to dollars');
eq(formatNzd(14999), 'NZ$149.99', 'yearly Pro');
eq(formatNzd(2999), 'NZ$29.99', 'monthly Business');
eq(formatNzd(24999), 'NZ$249.99', 'yearly Business');
eq(priceText(priceFor(prices, 'plus', 'year')!), 'NZ$79.99 a year', 'price text');
eq(priceText(priceFor(prices, 'business', 'month')!), 'NZ$29.99 a month', 'business monthly price text');
eq(priceText(priceFor(prices, 'business', 'year')!), 'NZ$249.99 a year', 'business yearly price text');
eq(priceFor(prices, 'pro', 'month')?.amountCents, 1999, 'lookup');
eq(yearlySavingPct(prices, 'plus'), 33, 'Plus yearly saves 33%');
eq(yearlySavingPct(prices, 'pro'), 37, 'Pro yearly saves 37%');
eq(yearlySavingPct(prices, 'business'), 30, 'Business yearly saves 30%');
eq(yearlySavingPct([{ plan: 'plus', interval: 'month', amountCents: 100 }, { plan: 'plus', interval: 'year', amountCents: 1200 }], 'plus'), null, 'no saving, no badge');
eq(offeredPaidPlans(false).join(), 'plus,business', 'Pro is hidden unless the flag is on');
eq(offeredPaidPlans(true).join(), 'plus,pro,business', 'PRO_PLAN_ENABLED offers Pro again');
eq(offeredPaidPlans(false).includes('plus') && offeredPaidPlans(false).includes('business'), true, 'Plus and Business stay on sale');
eq(offeredPlans(false).join(), 'free,plus,business', 'signup offers Free, Plus and Business');
eq(offeredPlans(true).join(), 'free,plus,pro,business', 'signup offers Pro only when the flag is on');
eq(FREE_FEATURES.length >= 3 && FREE_FEATURES.every((line) => !/NZ\$/.test(line)), true, 'Free has a short summary and no hardcoded price');
eq(FREE_FEATURES.some((line) => line.includes('PAYE')) && FREE_FEATURES.some((line) => line.includes('One budget')), true, 'Free copy matches the new limits');
eq(PLAN_FEATURES.plus.some((line) => line.includes('Net worth')) && PLAN_FEATURES.plus.some((line) => line.includes('Business management')), true, 'Plus copy includes net worth and business management');
eq(PLAN_FEATURES.pro.some((line) => line.includes('AI assistant')) && PLAN_FEATURES.pro.some((line) => line.includes('Akahu')), true, 'Pro copy includes the assistant and Akahu');
eq(PLAN_FEATURES.business.some((line) => line.includes('clients, invoices and stock')) && PLAN_FEATURES.business.some((line) => line.includes('GST return')), true, 'Business copy is management plus reports');
eq(plusFeatureLines(true).some((line) => line.includes('Clients, invoices and stock')), true, 'ticking I run a business adds the Plus management line');
eq(plusFeatureLines(false).some((line) => line.includes('Clients, invoices and stock')), false, 'the extra line stays off until the box is ticked');
eq(BILLING_TEST_NOTE.includes('no real charges') && BILLING_TEST_NOTE.includes('4242'), true, 'test-mode note matches Settings');
eq(checkoutPendingText(null), 'Confirming your payment… Your plan will update in a moment.', 'pending until the webhook');
eq(checkoutPendingText('free'), 'Confirming your payment… Your plan will update in a moment.', 'still free means still confirming');
eq(checkoutPendingText('plus'), 'You’re on Plus.', 'Plus has landed');
eq(checkoutPendingText('business'), 'You’re on Business.', 'Business has landed');

const base = { plan: 'plus' as const, interval: 'year' as const, status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: '2026-12-02T00:00:00.000Z' };
eq(subscriptionLine(base), 'Billed yearly. Renews on 2 December 2026.', 'active, NZ date');
eq(subscriptionLine({ ...base, interval: 'month', currentPeriodEnd: null }), 'Billed monthly.', 'no date');
eq(subscriptionLine({ ...base, cancelAtPeriodEnd: true }), 'Cancelled. Plus stays on until 2 December 2026, with no further charges.', 'cancelled');
eq(subscriptionLine({ ...base, plan: 'pro', status: 'past_due' }), 'Your last payment didn’t go through. Update your card in Manage billing to keep Pro.', 'past due');
eq(subscriptionLine({ ...base, plan: 'business', interval: 'month' }), 'Billed monthly. Renews on 2 December 2026.', 'business subscription line');
eq(subscriptionLine({ ...base, status: 'trialing' }), 'Free trial until 2 December 2026. Billed yearly.', 'trial');

console.log('billingView tests passed');
