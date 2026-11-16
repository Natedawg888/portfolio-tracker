/**
 * Settings → Account → Business account, and the profile-menu row that opens it.
 * Pure, so it is tested without a browser: npm run test:linked-accounts.
 *
 * The signed-in account comes from GET /api/auth/me `activeAccount`. The list comes
 * from GET /api/account/links. Nothing here invents a link, a name, or a plan.
 */
import type { UsageMode } from './usageMode.ts';

export const MAX_LINKED_BUSINESS_ACCOUNTS = 5;

export const BUSINESS_ACCOUNT_SECTION_ID = 'business-account';
export const ACCOUNT_PLAN_SECTION_ID = 'account-plan';

/** Settings → Account, scrolled to the business-account card. */
export const BUSINESS_ACCOUNT_HREF = `/settings?tab=account#${BUSINESS_ACCOUNT_SECTION_ID}`;

/** Settings → Account → Plan (billing). */
export const SETTINGS_BILLING_HREF = `/settings?tab=account#${ACCOUNT_PLAN_SECTION_ID}`;

/**
 * After POST /api/account/switch the session cookie is a different user.
 * A full page load drops every user-scoped cache. "/" is the dashboard
 * (business-only accounts continue to their business home from there).
 */
export const DASHBOARD_AFTER_SWITCH = '/';

/** Checkout refused because a Personal account cannot buy Business on itself. */
export const BUSINESS_PLAN_REQUIRES_BUSINESS_ACCOUNT = 'BUSINESS_PLAN_REQUIRES_BUSINESS_ACCOUNT';

/** 402 from business reports when the account does not have the Business plan. */
export const BUSINESS_PLAN_REQUIRED_CODE = 'BUSINESS_PLAN_REQUIRED';

export const BUSINESS_PLAN_NEEDED_COPY = 'Business accounts need the Business plan.';

export const BUSINESS_ACCOUNT_EMPTY_COPY = 'Keep business money in its own account, linked to this one.';

/** Shown on the signup plan step, which cannot open Settings until setup is finished. */
export const ADD_BUSINESS_AFTER_SETUP = 'You can add a business account from Settings once setup is finished.';

export const ACCOUNT_LINK_ERROR_FALLBACK = 'That didn’t work. Try again.';

/** Calm inline copy for the account-link error codes. Unknown codes use the fallback. */
export const ACCOUNT_LINK_ERROR_COPY: Record<string, string> = {
  INVALID_BUSINESS_NAME: 'Enter a business name, up to 120 characters.',
  NOT_PERSONAL_ACCOUNT: 'Only a personal account can add a business account.',
  LINKED_BUSINESS_CANNOT_OWN: 'A linked business account can’t add another account.',
  LINK_LIMIT: 'You can link up to 5 business accounts.',
  INVALID_CREDENTIALS: 'That email and password didn’t match.',
  NOT_BUSINESS_ACCOUNT: 'That account isn’t a business account.',
  ALREADY_LINKED: 'That account is already linked.',
  TOO_MANY_ATTEMPTS: 'Too many tries. Wait a bit and try again.',
  TWO_FACTOR_REQUIRED: 'That account uses two-step sign-in, so it can’t be linked here yet.',
  MISSING_FIELDS: 'Enter the email and password.',
  CANNOT_LINK_SELF: 'That is this account.',
  ACCOUNT_PENDING_DELETION: 'That account is being deleted.',
  NOT_FOUND: 'That link is already gone.',
  NOT_LINK_OWNER: 'Only the personal account can unlink this.',
  LINKED_ACCOUNT_HAS_NO_LOGIN: 'This business account has no sign-in of its own yet, so it stays linked.',
  SAME_ACCOUNT: 'You’re already on this account.',
  SWITCH_NOT_ALLOWED: 'That account can’t be opened from here.',
  UNAUTHORIZED: 'Sign in again to do that.',
};

export type AccountLinkPartyView = {
  usageMode: UsageMode;
  isLinkedBusiness: boolean;
};

/** Owner card, the small "linked to" card, or nothing (a business-only account that is not linked). */
export type BusinessAccountSection = 'owner' | 'linked';

/**
 * Personal and Both can own links. A linked business cannot, and is shown the
 * way back to its owner instead. Business only, and not linked, owns nothing.
 */
export function businessAccountSection(active: AccountLinkPartyView | null | undefined): BusinessAccountSection | null {
  if (!active) return null;
  if (active.isLinkedBusiness) return 'linked';
  if (active.usageMode === 'business') return null;
  return 'owner';
}

export function canOwnAccountLinks(active: AccountLinkPartyView | null | undefined): boolean {
  return businessAccountSection(active) === 'owner';
}

/**
 * Profile menu row "Add business account".
 * Hidden once any business account is linked, while the list is still loading
 * (`linkedCount` null — we do not guess), and for accounts that cannot own links.
 */
export function showAddBusinessAccountRow(input: {
  active: AccountLinkPartyView | null | undefined;
  linkedCount: number | null;
}): boolean {
  if (!canOwnAccountLinks(input.active)) return false;
  return input.linkedCount === 0;
}

/** Create and "Link an existing one" stay available until the owner has 5. */
export function showCreateAndLink(linkedCount: number): boolean {
  return linkedCount < MAX_LINKED_BUSINESS_ACCOUNTS;
}

/** Unlink is offered only when the API says this owner may remove that link. */
export function showUnlink(account: { canUnlink: boolean }): boolean {
  return account.canUnlink === true;
}

/** Business name, then the person's name. Never an email (created accounts have a synthetic one). */
export function linkedAccountTitle(account: { businessName: string | null; displayName: string | null }): string {
  const business = account.businessName?.trim();
  if (business) return business;
  const display = account.displayName?.trim();
  if (display) return display;
  return 'Business account';
}

/** Line on the linked-business card. No display name is invented when the owner has not loaded. */
export function linkedOwnerLine(owner: { displayName: string | null } | null): string {
  if (!owner) return 'Linked business account';
  const name = owner.displayName?.trim();
  return name ? `Linked to ${name}` : 'Linked to your personal account';
}

export function readyCopy(name: string): string {
  return `${name} is ready.`;
}

export function unlinkConfirmCopy(name: string): string {
  return `Unlink ${name}? Both accounts stay. You just won’t switch between them here.`;
}

export function accountLinkErrorCopy(code: string | undefined): string {
  if (code && ACCOUNT_LINK_ERROR_COPY[code]) return ACCOUNT_LINK_ERROR_COPY[code];
  return ACCOUNT_LINK_ERROR_FALLBACK;
}

/** Plan checkout (or a Business choice on a Personal account) opens the business-account card, not an error. */
export function routesPersonalToBusinessAccount(code: string | undefined): boolean {
  return code === BUSINESS_PLAN_REQUIRES_BUSINESS_ACCOUNT;
}

export function personalChoosingBusiness(usage: UsageMode, plan: string): boolean {
  return usage === 'personal' && plan === 'business';
}

/**
 * Where a Personal account's Business choice goes.
 * Settings is behind finished setup, so the signup plan step stays put and explains that.
 */
export function personalBusinessCheckoutRoute(input: {
  usage: UsageMode;
  plan: string;
  onboardingComplete: boolean;
}): 'settings' | 'later' | null {
  if (!personalChoosingBusiness(input.usage, input.plan)) return null;
  return input.onboardingComplete ? 'settings' : 'later';
}

/** The one calm line when the API says the Business plan is required. Other codes are not this line. */
export function businessPlanNeededCopy(code: string | undefined): string | null {
  if (code === BUSINESS_PLAN_REQUIRED_CODE) return BUSINESS_PLAN_NEEDED_COPY;
  return null;
}
