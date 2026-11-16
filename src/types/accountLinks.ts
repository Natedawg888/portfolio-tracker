/**
 * Linked business accounts.
 *
 * A Personal account (usageMode personal or both; unset counts as personal) cannot
 * buy the Business plan on itself. It can create or link a separate business user.
 * That user has its own books, plan, and Stripe customer. Switching replaces the
 * session cookie. After a switch, reload every user-scoped screen — the previous
 * account's figures are no longer the signed-in user.
 *
 * Created business users have no mailbox. users.email is NOT NULL UNIQUE, so the
 * server stores a synthetic address at accounts.koruledger.invalid (the .invalid
 * TLD is reserved and cannot receive mail). That address never leaves the server:
 * /api/auth/me, switch, and the account download return email: null. password_hash
 * is the sentinel !linked-no-login until that account sets its own password.
 * It is reached only by switching. activeAccount.hasOwnLogin is false until then.
 */
import type { UsageMode } from '../lib/usageMode';

export type AccountPlan = 'free' | 'plus' | 'pro' | 'business';

/** Which account the session is acting as. On GET /api/auth/me and on the user object. */
export type ActiveAccount = {
  id: string;
  usageMode: UsageMode;
  /** True when this user is a business account attached to a personal owner. */
  isLinkedBusiness: boolean;
  /** Password, passkey, or single sign-on. False for a created account that is only reached by switching. */
  hasOwnLogin: boolean;
  /** The personal owner's id when isLinkedBusiness, otherwise null. */
  ownerId: string | null;
};

/**
 * The signed-in account, or the personal owner shown from a linked business.
 * canUnlink on current is true only when this session is a linked business that
 * has its own login, so it may DELETE /api/account/links/:itsOwnId.
 */
export type AccountLinkParty = {
  id: string;
  displayName: string | null;
  usageMode: UsageMode;
  plan: AccountPlan;
  isLinkedBusiness: boolean;
  canUnlink: boolean;
};

/**
 * One business account attached to the personal owner.
 * canUnlink is true only when the signed-in user is that owner and the business
 * account has its own login (password, passkey, or single sign-on).
 */
export type LinkedAccountSummary = {
  id: string;
  displayName: string | null;
  /** Default business name, or null when that user has not added one. */
  businessName: string | null;
  plan: AccountPlan;
  hasOwnLogin: boolean;
  canUnlink: boolean;
};

export type AccountLinksResponse = {
  current: AccountLinkParty;
  /** Set when the signed-in user is a linked business, so the client can switch back. */
  owner: AccountLinkParty | null;
  /** Business accounts this signed-in user owns. Empty from a linked business. */
  linked: LinkedAccountSummary[];
};

export type CreateLinkedBusinessRequest = { businessName: string };

export type CreateLinkedBusinessResponse = {
  account: LinkedAccountSummary;
  links: AccountLinksResponse;
};

export type LinkExistingBusinessRequest = { email: string; password: string };

export type LinkExistingBusinessResponse = { links: AccountLinksResponse };

export type UnlinkAccountResponse = { ok: true; links: AccountLinksResponse };

export type SwitchAccountRequest = { accountId: string };

/**
 * The session cookie is now the target account. `user` is the same shape as
 * GET /api/auth/me. Reload user-scoped data (accounts, holdings, budgets,
 * invoices, businesses, and anything else loaded for the previous user).
 * A full page load is the safe choice.
 */
export type SwitchAccountResponse<User extends { id: string; activeAccount: ActiveAccount } = { id: string; activeAccount: ActiveAccount }> = {
  ok: true;
  user: User;
  activeAccount: ActiveAccount;
};

export type AccountLinkErrorCode =
  | 'UNAUTHORIZED'
  | 'MISSING_FIELDS'
  | 'INVALID_BUSINESS_NAME'
  | 'NOT_PERSONAL_ACCOUNT'
  | 'LINKED_BUSINESS_CANNOT_OWN'
  | 'LINK_LIMIT'
  | 'INVALID_CREDENTIALS'
  | 'TOO_MANY_ATTEMPTS'
  | 'NOT_BUSINESS_ACCOUNT'
  | 'ALREADY_LINKED'
  | 'CANNOT_LINK_SELF'
  | 'TWO_FACTOR_REQUIRED'
  | 'ACCOUNT_PENDING_DELETION'
  | 'NOT_FOUND'
  | 'NOT_LINK_OWNER'
  | 'LINKED_ACCOUNT_HAS_NO_LOGIN'
  | 'SWITCH_NOT_ALLOWED'
  | 'SAME_ACCOUNT';
