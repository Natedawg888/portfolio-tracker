/** Settings → Plan wording (KAN-52). Run: npm run test:billing */
import { BILLING_TEST_NOTE, FREE_FEATURES, PLAN_FEATURES, PLUS_BUSINESS_MANAGEMENT_LINE, canCheckoutPlan, checkoutPendingText, formatNzd, offeredPaidPlans, offeredPlans, plusFeatureLines, priceFor, priceText, settingsCheckoutPlan, settingsPlanOffer, signupPlanOffer, subscriptionLine, yearlySavingPct, type BillingPrice } from './billingView.ts';

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
eq(offeredPaidPlans(true).join(), 'plus,business', 'Pro stays hidden while PRO_PLAN_FOR_SALE is off, even if the server flag is on');
eq(offeredPaidPlans(true, true).join(), 'plus,pro,business', 'Pro is offered only when the sale flag and the server flag are on');
eq(offeredPaidPlans(false, true).join(), 'plus,business', 'the sale flag does not override a server that has Pro off');
eq(offeredPaidPlans(false).includes('plus') && offeredPaidPlans(false).includes('business'), true, 'Plus and Business stay on sale');
eq(offeredPlans(false).join(), 'free,plus,business', 'signup offers Free, Plus and Business');
eq(offeredPlans(true).join(), 'free,plus,business', 'signup hides Pro until PRO_PLAN_FOR_SALE is on');
eq(offeredPlans(true, true).join(), 'free,plus,pro,business', 'signup offers Pro only when the sale flag is on');
eq(canCheckoutPlan('pro'), false, 'checkout is not sent plan pro while it is hidden');
eq(canCheckoutPlan('pro', true), true, 'flipping the sale flag allows pro checkout');
eq(canCheckoutPlan('plus') && canCheckoutPlan('business'), true, 'Plus and Business can still check out');

const personalFree = settingsPlanOffer({ usage: 'personal', plan: 'free', canChoosePlan: true, canOpenPortal: false });
eq(personalFree.cards.join(), 'plus', 'personal Settings offers Plus only');
eq(personalFree.cards.includes('business'), false, 'personal hides the Business plan');
eq(personalFree.cards.includes('pro'), false, 'Pro stays hidden for personal');
eq((personalFree.cards as readonly string[]).includes('free'), false, 'Free is the current plan, not a card');
eq(personalFree.showIntervalToggle, true, 'personal still chooses Monthly or Yearly for Plus');
eq(personalFree.portalAction, null, 'a free personal account has nothing to cancel');
eq(personalFree.plusLines.includes(PLUS_BUSINESS_MANAGEMENT_LINE), false, 'personal Plus drops the business management line');
eq(personalFree.plusLines.some((line) => line.includes('Full budgeting')), true, 'the other Plus lines stay');

const personalProLater = settingsPlanOffer({ usage: 'personal', plan: 'free', canChoosePlan: true, canOpenPortal: false, proForSale: true });
eq(personalProLater.cards.join(), 'plus,pro', 'personal shows Pro only after the sale flag is on');
eq(personalProLater.cards.includes('business'), false, 'personal still hides Business when Pro is on sale');

const personalPlus = settingsPlanOffer({ usage: 'personal', plan: 'plus', canChoosePlan: false, canOpenPortal: true });
eq(personalPlus.cards.join(), '', 'a personal Plus subscription does not list Business');
eq(personalPlus.showIntervalToggle, false, 'no Monthly/Yearly toggle without a plan to buy');
eq(personalPlus.portalAction, 'manage', 'a non-Business subscription keeps Manage billing');

const bothFree = settingsPlanOffer({ usage: 'both', plan: 'free', canChoosePlan: true, canOpenPortal: false });
eq(bothFree.cards.join(), 'plus,business', 'Both keeps Plus and Business');
eq(bothFree.cards.includes('pro'), false, 'Pro stays hidden for Both');
eq(bothFree.plusLines.includes(PLUS_BUSINESS_MANAGEMENT_LINE), true, 'Both keeps the Plus business line');

const businessOnly = settingsPlanOffer({ usage: 'business', plan: 'free', canChoosePlan: true, canOpenPortal: false });
eq(businessOnly.cards.join(), 'plus,business', 'Business only on a non-Business plan keeps Plus and Business');
eq(businessOnly.cards.includes('pro'), false, 'Pro stays hidden for Business only');

const onBusiness = settingsPlanOffer({ usage: 'both', plan: 'business', canChoosePlan: true, canOpenPortal: true });
eq(onBusiness.cards.join(), '', 'a Business plan offers no other plan');
eq(onBusiness.showIntervalToggle, false, 'a Business plan hides the Monthly/Yearly toggle');
eq(onBusiness.portalAction, 'cancel', 'a Business plan can only cancel');

const personalOnBusiness = settingsPlanOffer({ usage: 'personal', plan: 'business', canChoosePlan: true, canOpenPortal: false });
eq(personalOnBusiness.cards.join(), '', 'Business plan wins over a personal usage');
eq(personalOnBusiness.showIntervalToggle, false, 'personal on Business still has no interval toggle');
eq(personalOnBusiness.portalAction, 'cancel', 'personal on Business can only cancel');

eq(settingsCheckoutPlan('pro', 'personal'), null, 'personal never sends pro to checkout while it is hidden');
eq(settingsCheckoutPlan('pro', 'both', true), 'pro', 'pro checkout is allowed only when the sale flag is on');
eq(settingsCheckoutPlan('business', 'personal'), null, 'personal never sends business to checkout');
eq(settingsCheckoutPlan('business', 'business'), 'business', 'Business only can check out Business');
eq(settingsCheckoutPlan('business', 'both'), 'business', 'Both can check out Business');
eq(settingsCheckoutPlan('plus', 'personal'), 'plus', 'personal can check out Plus');
eq(FREE_FEATURES.length >= 3 && FREE_FEATURES.every((line) => !/NZ\$/.test(line)), true, 'Free has a short summary and no hardcoded price');
eq(FREE_FEATURES.some((line) => line.includes('PAYE') && line.includes('payslips')) && FREE_FEATURES.some((line) => line.includes('One budget')), true, 'Free copy matches the new limits');
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

// KAN-130: signup plan step by usage mode.
{
  const personal = signupPlanOffer('personal', true, true, true);
  eq(personal.paidPlans.join(), 'plus,pro', 'Personal signup: no Business card');
  eq(personal.plusLines.includes(PLUS_BUSINESS_MANAGEMENT_LINE), false, 'Personal signup: no business management line');
  eq(personal.plusLines.some((l) => l.includes('Clients, invoices and stock')), false, 'Personal signup: no runs-a-business line');
  eq(personal.showRunsBusiness, false, 'Personal signup: no I run a business tick');
  eq(signupPlanOffer('personal', false, false, false).paidPlans.join(), 'plus', 'Personal without Pro: Plus only');
  eq(signupPlanOffer('business', false, false, false).paidPlans.join(), 'plus,business', 'Business: Plus and Business');
  eq(signupPlanOffer('both', true, true, true).paidPlans.join(), 'plus,pro,business', 'Both: every plan');
  eq(signupPlanOffer('both', false, true).plusLines.some((l) => l.includes('Clients, invoices and stock')), true, 'Both: tick still adds the line');
}

console.log('billingView tests passed');
