/**
 * Settings → Account → Business account, and the profile-menu row that opens it.
 * Pure, so it is tested without a browser: npm run test:linked-accounts.
 *
 * The signed-in account comes from GET /api/auth/me `activeAccount`. The list comes
 * from GET /api/account/links. Nothing here invents a link, a name, or a plan.
 */
import type { AccountLinksResponse } from '../types/accountLinks.ts';
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
  NOT_LINK_OWNER: 'Only the account that linked this business can unlink it.',
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

/** Unlink is offered only when the API says this session may remove that link. */
export function showUnlink(account: { canUnlink: boolean }): boolean {
  return account.canUnlink === true;
}

/**
 * A linked business with its own login can unlink itself.
 * `current.canUnlink` is that flag on GET /api/account/links.
 */
export function showSelfUnlink(current: { canUnlink?: boolean } | null | undefined): boolean {
  return current?.canUnlink === true;
}

/** The Unlink control stays visible but does nothing while a switch is in flight. */
export function unlinkControlDisabled(switching: boolean): boolean {
  return switching;
}

/**
 * Back to personal only works from a session the owner opened.
 * TODO: canSwitchToOwner — session-aware flag on GET /api/account/links, not in AccountLinksResponse yet.
 * Hide the button when the field is missing or false.
 */
export function showBackToPersonal(links: object | null | undefined): boolean {
  if (!links) return false;
  return (links as { canSwitchToOwner?: unknown }).canSwitchToOwner === true;
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

/**
 * Switch has its own sentences. Linking keeps TWO_FACTOR_REQUIRED as
 * "that account can't be linked here yet".
 */
export const SWITCH_ACCOUNT_ERROR_COPY: Record<string, string> = {
  TWO_FACTOR_REQUIRED: 'That business account uses two-step sign-in. Sign in to it directly.',
  SAME_ACCOUNT: 'You’re already on this account.',
  SWITCH_NOT_ALLOWED: 'That account can’t be opened from here.',
  ACCOUNT_PENDING_DELETION: 'That account is being deleted.',
  MISSING_FIELDS: 'Choose an account to switch to.',
  UNAUTHORIZED: 'Sign in again to do that.',
  NOT_FOUND: 'That account is no longer there.',
};

export function switchAccountErrorCopy(code: string | undefined): string {
  if (code && SWITCH_ACCOUNT_ERROR_COPY[code]) return SWITCH_ACCOUNT_ERROR_COPY[code];
  return ACCOUNT_LINK_ERROR_FALLBACK;
}

const SYNTHETIC_EMAIL_HOST = '@accounts.koruledger.invalid';

/** What to show for /api/auth/me email. Null, the word "null", and the synthetic address stay off screen. */
export function visibleAccountEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') return null;
  if (trimmed.toLowerCase().endsWith(SYNTHETIC_EMAIL_HOST)) return null;
  return trimmed;
}

/** Email and password actions. A created business has hasOwnLogin false until it can sign in alone. */
export function offerAccountSignIn(active: { hasOwnLogin?: boolean } | null | undefined): boolean {
  return active?.hasOwnLogin === true;
}

/**
 * Another account signed in on this browser.
 * Name is the person's name, then the business name. A blank or null email is never shown.
 */
export function otherAccountLine(account: {
  displayName?: string | null;
  businessName?: string | null;
  email?: string | null;
}): { name: string; email: string | null } {
  const email = visibleAccountEmail(account.email);
  const display = account.displayName?.trim() || '';
  const business = account.businessName?.trim() || '';
  const name = display || business || email || 'Account';
  return { name, email: email && email !== name ? email : null };
}

/** Business name for a user id, from the links list or the open business. Never invented. */
export function businessNameForAccount(
  accountId: string,
  links: { current: { id: string; isLinkedBusiness: boolean }; linked: readonly { id: string; businessName: string | null }[] } | null | undefined,
  activeBusinessName?: string | null,
): string | null {
  const listed = links?.linked.find((item) => item.id === accountId)?.businessName?.trim();
  if (listed) return listed;
  if (links?.current.isLinkedBusiness && links.current.id === accountId) {
    const active = activeBusinessName?.trim();
    if (active) return active;
  }
  return null;
}

/**
 * Unlink confirm title. Uses the business name when we have one.
 * The person's display name is not the business, so it is not used here.
 */
export function selfUnlinkName(businessName: string | null | undefined): string {
  const name = businessName?.trim();
  return name || 'this business account';
}

/** businessName on a payload that may not have the field yet. */
export function readBusinessName(source: object | null | undefined): string | null {
  if (!source || !('businessName' in source)) return null;
  const value = (source as { businessName?: unknown }).businessName;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function signOutMenuLabel(
  email: string | null | undefined,
  hasOtherAccounts: boolean,
  displayName?: string | null,
): string {
  const shown = visibleAccountEmail(email);
  if (hasOtherAccounts && shown) return `Sign out of ${shown}`;
  const name = displayName?.trim();
  if (hasOtherAccounts && name) return `Sign out of ${name}`;
  return 'Sign out';
}

/**
 * Add-another-account line. A real email is named. A hidden email uses the
 * person's name. With neither, the "as …" clause is left off.
 */
export function staySignedInAs(user: {
  email?: string | null;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
} | null | undefined): string | null {
  if (!user) return null;
  const email = visibleAccountEmail(user.email);
  if (email) return email;
  const display = user.displayName?.trim();
  if (display) return display;
  const composed = [user.firstName, user.lastName].map((part) => (part || '').trim()).filter(Boolean).join(' ');
  return composed || null;
}

/** Header subtitle currency and zone. Unlinked accounts do not show this line. */
export const HEADER_ACCOUNT_CURRENCY = 'NZD';
export const HEADER_ACCOUNT_TIMEZONE = 'Pacific/Auckland';

export function showAccountsGroup(links: { owner: unknown; linked: readonly unknown[] } | null | undefined): boolean {
  if (!links) return false;
  return links.linked.length > 0 || links.owner != null;
}

/**
 * "Add business account" stays hidden once the Accounts group is on screen.
 * The group itself only appears when a link exists, which already hides the row.
 */
export function showAddBusinessAccountMenuRow(input: {
  active: AccountLinkPartyView | null | undefined;
  linkedCount: number | null;
  accountsGroup: boolean;
}): boolean {
  if (input.accountsGroup) return false;
  return showAddBusinessAccountRow(input);
}

export type AccountSwitcherRow = {
  id: string;
  name: string;
  pill: 'personal' | 'business';
  current: boolean;
};

function personalAccountName(displayName: string | null | undefined): string {
  const name = displayName?.trim();
  return name || 'Personal account';
}

/**
 * Personal account first, then each linked business.
 * The Personal row that switches back to the owner follows showBackToPersonal
 * (canSwitchToOwner). Missing or false hides that row. The account you are
 * already on stays visible.
 */
export function accountSwitcherRows(
  links: AccountLinksResponse,
  activeBusinessName?: string | null,
): AccountSwitcherRow[] {
  const rows: AccountSwitcherRow[] = [];
  const current = links.current;
  const owner = links.owner;
  const personal = owner ?? (current.isLinkedBusiness ? null : current);
  const switchingToOwner = Boolean(owner && owner.id !== current.id);
  if (personal && (!switchingToOwner || showBackToPersonal(links))) {
    rows.push({
      id: personal.id,
      name: personalAccountName(personal.displayName),
      pill: 'personal',
      current: personal.id === current.id,
    });
  }
  if (current.isLinkedBusiness) {
    rows.push({
      id: current.id,
      name: linkedAccountTitle({
        businessName: activeBusinessName ?? null,
        displayName: current.displayName,
      }),
      pill: 'business',
      current: true,
    });
  }
  for (const item of links.linked) {
    if (rows.some((row) => row.id === item.id)) continue;
    rows.push({
      id: item.id,
      name: linkedAccountTitle(item),
      pill: 'business',
      current: item.id === current.id,
    });
  }
  return rows;
}

export type AccountSwitchPhase =
  | { kind: 'idle' }
  | { kind: 'switching'; accountId: string }
  | { kind: 'failed'; accountId: string; message: string };

export function accountSwitchRowState(
  row: { id: string; current: boolean },
  phase: AccountSwitchPhase,
): { ariaCurrent: boolean; disabled: boolean; statusText: string | null; blocked: boolean } {
  if (phase.kind === 'switching' && phase.accountId === row.id) {
    return { ariaCurrent: false, disabled: true, statusText: 'Switching…', blocked: false };
  }
  if (row.current) {
    return { ariaCurrent: true, disabled: phase.kind === 'switching', statusText: 'Current', blocked: false };
  }
  if (phase.kind === 'switching') {
    return { ariaCurrent: false, disabled: true, statusText: null, blocked: true };
  }
  if (phase.kind === 'failed' && phase.accountId === row.id) {
    return { ariaCurrent: false, disabled: false, statusText: phase.message, blocked: false };
  }
  return { ariaCurrent: false, disabled: false, statusText: null, blocked: false };
}

/** Id shared by a switcher row and the error it describes. */
export function accountSwitchErrorId(accountId: string): string {
  return `account-switch-error-${accountId}`;
}

/** Only an inactive row, and only while nothing is already switching. */
export function accountSwitchTarget(row: { id: string; current: boolean }, phase: AccountSwitchPhase): string | null {
  if (row.current || phase.kind === 'switching') return null;
  return row.id;
}

/**
 * Header line for a linked account. Unlinked accounts get null so the header stays as it is.
 * `name` is null until the list (and, for a business, its business name) is known.
 * The person's display name is not used as a stand-in, so the header does not flash it.
 */
export function headerAccountContext(input: {
  links: AccountLinksResponse | null;
  active: { isLinkedBusiness: boolean; ownerId: string | null } | null | undefined;
  activeBusinessName?: string | null;
}): { name: string | null; pill: 'personal' | 'business' } | null {
  if (input.links && showAccountsGroup(input.links)) {
    const current = accountSwitcherRows(input.links, input.activeBusinessName).find((row) => row.current);
    if (current) {
      if (current.pill === 'business' && !input.activeBusinessName?.trim()) {
        return { name: null, pill: 'business' };
      }
      return { name: current.name, pill: current.pill };
    }
  }
  if (input.active?.isLinkedBusiness && input.active.ownerId) {
    return { name: null, pill: 'business' };
  }
  return null;
}

/**
 * Locked GST and P&L. A Personal account has no Business plan to buy, so the link
 * opens the business-account card. Business and Both can open billing.
 */
export function planRequiredHref(active: { usageMode: UsageMode; isLinkedBusiness: boolean } | null | undefined): string {
  if (active && active.usageMode !== 'personal') return SETTINGS_BILLING_HREF;
  return BUSINESS_ACCOUNT_HREF;
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
