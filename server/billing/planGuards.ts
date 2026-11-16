/**
 * Who may buy which plan (KAN-52, with the Personal / Business split from usage mode).
 *
 * usageMode lives on users.preferences_json (personal, business, or both). An account with
 * nothing saved is Personal. PR #190 hides Business on the Settings plan card for Personal
 * accounts, and still offers Plus for Personal, Business only, and Both. Pro is not hidden
 * by account type: it stays off for everyone until PRO_PLAN_ENABLED, and when that flag is
 * on every account type may check out Pro.
 */
import type { Database } from 'sql.js';
import { parseUsageMode, type UsageMode } from '../../src/lib/usageMode.ts';
import { queryOne } from '../db/index.ts';
import type { BillingInterval, BillingPlan } from './catalog.ts';
import { proPlanEnabled } from './proPlan.ts';

export type CheckoutBlock = { status: number; code: string; error: string };

export const PRO_CHECKOUT_ERROR = 'Pro is not available yet';
export const BUSINESS_ACCOUNT_CHECKOUT_ERROR = 'Business is for a business account. Personal accounts can choose Plus.';

/** The saved usage, or Personal when the account has never chosen one. */
export function usageModeFor(db: Database, userId: string): UsageMode {
  const row = queryOne<{ preferences_json: string | null }>(db, `SELECT preferences_json FROM users WHERE id = ?`, [userId]);
  return parseUsageMode(row?.preferences_json).mode;
}

/** Business and Both may buy the Business plan. Personal may not. */
export function accountMayBuyBusiness(usage: UsageMode): boolean {
  return usage === 'business' || usage === 'both';
}

/**
 * Pro checkout while PRO_PLAN_ENABLED is off. Checked before the interval is validated, so a
 * Pro request never falls through to "choose Plus or Business".
 */
export function proCheckoutBlock(plan: unknown): CheckoutBlock | null {
  if (plan === 'pro' && !proPlanEnabled()) {
    return { status: 400, code: 'PRO_UNAVAILABLE', error: PRO_CHECKOUT_ERROR };
  }
  return null;
}

/** Personal cannot start a Business subscription. Plus and Pro are not refused here. */
export function businessCheckoutBlock(plan: unknown, usage: UsageMode): CheckoutBlock | null {
  if (plan === 'business' && !accountMayBuyBusiness(usage)) {
    return { status: 403, code: 'BUSINESS_PLAN_REQUIRES_BUSINESS_ACCOUNT', error: BUSINESS_ACCOUNT_CHECKOUT_ERROR };
  }
  return null;
}

export type GrantedPrice = { plan: BillingPlan; interval: BillingInterval };

export type PriceChangeDecision =
  | { applyPrice: true }
  | { applyPrice: false; reason: 'business_price_change' | 'business_without_checkout' };

/**
 * Whether a sync may save the price Stripe currently shows.
 *
 * A Business subscription that moves to a different price keeps the price we already granted
 * (the portal for Business is cancel-only; a price change must not grant Plus, Pro, or the
 * other Business interval). A non-Business subscription that moves to a Business price is
 * granted only when the sync follows Checkout for an account that may buy Business.
 * The same price (a cancel, a card failure, a period rolling forward) is always applied.
 * A subscription we have never stored is not a move, so its first price is applied.
 */
export function priceChangeDecision(input: {
  previous: GrantedPrice | null;
  next: GrantedPrice;
  viaCheckout: boolean;
  usage: UsageMode;
}): PriceChangeDecision {
  const previous = input.previous;
  if (!previous) return { applyPrice: true };
  if (previous.plan === input.next.plan && previous.interval === input.next.interval) return { applyPrice: true };
  if (previous.plan === 'business') return { applyPrice: false, reason: 'business_price_change' };
  if (input.next.plan === 'business') {
    if (input.viaCheckout && accountMayBuyBusiness(input.usage)) return { applyPrice: true };
    return { applyPrice: false, reason: 'business_without_checkout' };
  }
  return { applyPrice: true };
}
