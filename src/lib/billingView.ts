/**
 * Words and numbers for Settings → Account → Plan (KAN-52). Pure, so it's tested without a
 * browser: npm run test:billing.
 */
import type { UsageMode } from './usageMode.ts';

export type AccountPlan = 'free' | 'plus' | 'pro' | 'business';
export type PaidPlan = 'plus' | 'pro' | 'business';
export type BillingInterval = 'month' | 'year';

/**
 * Pro is not on sale. This is the one switch that lists Pro and allows checkout of plan 'pro'.
 * Leave it false until Pro is ready; checkout must not be sent 'pro' while it is false.
 */
export const PRO_PLAN_FOR_SALE = false;

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

/** Shown in Settings and during signup whenever Stripe is in test mode. */
export const BILLING_TEST_NOTE = 'Test mode: no real charges. Use Stripe’s test card 4242 4242 4242 4242.';

/**
 * Paid plans offered for sale. Pro is omitted unless the server says PRO_PLAN_ENABLED
 * and PRO_PLAN_FOR_SALE is on. Free stays a plan (the label above); it is not a Stripe product.
 */
export function offeredPaidPlans(proPlanEnabled: boolean, proForSale: boolean = PRO_PLAN_FOR_SALE): PaidPlan[] {
  return proPlanEnabled && proForSale ? ['plus', 'pro', 'business'] : ['plus', 'business'];
}

/** Free, then the paid plans currently for sale. Signup shows this list. */
export function offeredPlans(proPlanEnabled: boolean, proForSale: boolean = PRO_PLAN_FOR_SALE): AccountPlan[] {
  return ['free', ...offeredPaidPlans(proPlanEnabled, proForSale)];
}

/** True when checkout may be opened for this plan. Pro follows PRO_PLAN_FOR_SALE. */
export function canCheckoutPlan(plan: PaidPlan, proForSale: boolean = PRO_PLAN_FOR_SALE): boolean {
  if (plan === 'pro') return proForSale;
  return plan === 'plus' || plan === 'business';
}

/**
 * What Free includes. Paid plans say what they add (PLAN_FEATURES), in the same short style.
 * Free is one budget of money in and out, one bank or cash account, and no net worth.
 * Savings goals, receipts and payslips are not capped. Plus adds the PAYE check and net pay into Income.
 */
export const FREE_FEATURES: readonly string[] = [
  'PAYE, salary tools and payslips',
  'One budget: money in and money out',
  'One bank or cash account',
  'Savings goals and receipts, with no limit',
];

/** Plus line dropped on the Settings plan card when the account is Personal. */
export const PLUS_BUSINESS_MANAGEMENT_LINE = 'Business management if you run a business';

/** What each paid plan adds (keep in step with server/lib/entitlements.ts). */
export const PLAN_FEATURES: Record<PaidPlan, readonly string[]> = {
  plus: [
    'Full budgeting, bills and subscriptions',
    'Dividends, projections, donations and news',
    'Net worth, household, payslip PAYE check and Income, bonds and commodities',
    'CSV import and public crypto wallets',
    PLUS_BUSINESS_MANAGEMENT_LINE,
  ],
  pro: [
    'Everything in Plus',
    'Advanced crypto: cost basis, staking, DeFi and wallet import',
    'AI assistant',
    'Akahu bank connect (coming later)',
  ],
  business: [
    'Business management: clients, invoices and stock',
    'Profit & loss for a tax year or any period',
    'GST return to copy into myIR',
    'An export for your accountant',
    'Access for your accountant',
  ],
};

/** Extra Plus line on the signup plan step when "I run a business" is ticked. */
export const PLUS_RUNS_BUSINESS_LINE = 'Clients, invoices and stock for your business';

export function plusFeatureLines(runsBusiness: boolean): readonly string[] {
  return runsBusiness ? [...PLAN_FEATURES.plus, PLUS_RUNS_BUSINESS_LINE] : PLAN_FEATURES.plus;
}

/** Settings → Plan: Personal does not get the business-management Plus line. */
export function plusLinesForUsage(usage: UsageMode): readonly string[] {
  if (usage === 'personal') return PLAN_FEATURES.plus.filter((line) => line !== PLUS_BUSINESS_MANAGEMENT_LINE);
  return PLAN_FEATURES.plus;
}

/**
 * Signup → Choose your plan by usage mode (KAN-130). Personal sees Free and Plus (and Pro when
 * on sale), no Business card, no business Plus lines and no "I run a business" tick.
 * Business and Both see every plan.
 */
export function signupPlanOffer(
  usage: UsageMode,
  proPlanEnabled: boolean,
  runsBusiness: boolean,
  proForSale: boolean = PRO_PLAN_FOR_SALE,
): { paidPlans: PaidPlan[]; plusLines: readonly string[]; showRunsBusiness: boolean } {
  const all = offeredPaidPlans(proPlanEnabled, proForSale);
  if (usage === 'personal') {
    return { paidPlans: all.filter((p) => p !== 'business'), plusLines: plusLinesForUsage('personal'), showRunsBusiness: false };
  }
  return { paidPlans: all, plusLines: plusFeatureLines(runsBusiness), showRunsBusiness: true };
}

export type SettingsPortalAction = 'manage' | 'cancel';

/**
 * What Settings → Plan may show. Free is the heading ("You're on Free"), not a card.
 * A Business subscription cannot change plan: no other cards, no Monthly/Yearly toggle,
 * and the portal is cancel only. Personal is not offered Business. Pro follows the sale flag.
 */
export type SettingsPlanOffer = {
  cards: readonly PaidPlan[];
  showIntervalToggle: boolean;
  portalAction: SettingsPortalAction | null;
  plusLines: readonly string[];
};

export function settingsPlanOffer(input: {
  usage: UsageMode;
  plan: AccountPlan;
  /** Stripe can sell a plan (billing is open and there is no subscription yet). */
  canChoosePlan: boolean;
  /** The account can open the billing portal (a subscription, or a Stripe customer). */
  canOpenPortal: boolean;
  /** Defaults to PRO_PLAN_FOR_SALE. Tests pass true to describe Pro once it is on sale. */
  proForSale?: boolean;
}): SettingsPlanOffer {
  const proForSale = input.proForSale ?? PRO_PLAN_FOR_SALE;
  const plusLines = plusLinesForUsage(input.usage);
  if (input.plan === 'business') {
    return { cards: [], showIntervalToggle: false, portalAction: 'cancel', plusLines };
  }
  const cards: PaidPlan[] = [];
  if (input.canChoosePlan) {
    cards.push('plus');
    if (proForSale) cards.push('pro');
    if (input.usage !== 'personal') cards.push('business');
  }
  return {
    cards,
    showIntervalToggle: cards.length > 0,
    portalAction: input.canOpenPortal ? 'manage' : null,
    plusLines,
  };
}

/**
 * The plan Settings may send to checkout, or null when it must not.
 * Pro is sent only when it is on sale. Personal never checks out Business.
 */
export function settingsCheckoutPlan(plan: PaidPlan, usage: UsageMode, proForSale: boolean = PRO_PLAN_FOR_SALE): PaidPlan | null {
  if (!canCheckoutPlan(plan, proForSale)) return null;
  if (usage === 'personal' && plan === 'business') return null;
  return plan;
}

/** After Checkout, until the webhook has changed the plan. */
export function checkoutPendingText(plan: AccountPlan | null): string {
  if (plan && plan !== 'free') return `You’re on ${PLAN_LABELS[plan]}.`;
  return 'Confirming your payment… Your plan will update in a moment.';
}

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
