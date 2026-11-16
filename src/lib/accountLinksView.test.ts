/**
 * Settings business-account card and the profile-menu row. Run: npm run test:linked-accounts
 */
import {
  ACCOUNT_LINK_ERROR_COPY,
  ACCOUNT_LINK_ERROR_FALLBACK,
  ADD_BUSINESS_AFTER_SETUP,
  BUSINESS_ACCOUNT_EMPTY_COPY,
  BUSINESS_ACCOUNT_HREF,
  BUSINESS_PLAN_NEEDED_COPY,
  DASHBOARD_AFTER_SWITCH,
  MAX_LINKED_BUSINESS_ACCOUNTS,
  SETTINGS_BILLING_HREF,
  accountLinkErrorCopy,
  businessAccountSection,
  businessPlanNeededCopy,
  canOwnAccountLinks,
  businessNameForAccount,
  linkedAccountTitle,
  linkedOwnerLine,
  otherAccountLine,
  readBusinessName,
  selfUnlinkName,
  personalBusinessCheckoutRoute,
  personalChoosingBusiness,
  resetSwitchOnMenuOpen,
  readyCopy,
  routesPersonalToBusinessAccount,
  showAddBusinessAccountMenuRow,
  showAddBusinessAccountRow,
  showAccountsGroup,
  showCreateAndLink,
  offerAccountSignIn,
  planRequiredHref,
  showBackToPersonal,
  showSelfUnlink,
  showUnlink,
  accountSwitchRowState,
  accountSwitchTarget,
  accountSwitcherRows,
  headerAccountContext,
  signOutMenuLabel,
  staySignedInAs,
  switchAccountErrorCopy,
  unlinkConfirmCopy,
  unlinkControlDisabled,
  visibleAccountEmail,
} from './accountLinksView.ts';
import type { AccountLinkParty, AccountLinksResponse, LinkedAccountSummary } from '../types/accountLinks.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  const left = JSON.stringify(a);
  const right = JSON.stringify(b);
  if (left !== right) throw new Error(`FAIL: ${msg}\n  got ${left}\n  expected ${right}`);
}

const personal = { usageMode: 'personal' as const, isLinkedBusiness: false };
const both = { usageMode: 'both' as const, isLinkedBusiness: false };
const business = { usageMode: 'business' as const, isLinkedBusiness: false };
const linked = { usageMode: 'business' as const, isLinkedBusiness: true };

eq(businessAccountSection(personal), 'owner', 'personal sees the owner card');
eq(businessAccountSection(both), 'owner', 'both sees the owner card');
eq(businessAccountSection(business), null, 'business only, not linked, sees no card');
eq(businessAccountSection(linked), 'linked', 'a linked business sees the way back');
eq(businessAccountSection({ usageMode: 'personal', isLinkedBusiness: true }), 'linked', 'the linked flag wins over usage');
eq(businessAccountSection(null), null, 'signed out sees nothing');
eq(canOwnAccountLinks(personal), true, 'personal can own links');
eq(canOwnAccountLinks(both), true, 'both can own links');
eq(canOwnAccountLinks(business), false, 'business only cannot own links');
eq(canOwnAccountLinks(linked), false, 'a linked business cannot own links');

eq(showAddBusinessAccountRow({ active: personal, linkedCount: 0 }), true, 'profile row when nothing is linked');
eq(showAddBusinessAccountRow({ active: both, linkedCount: 0 }), true, 'both also gets the row when nothing is linked');
eq(showAddBusinessAccountRow({ active: personal, linkedCount: 1 }), false, 'profile row hides once one is linked');
eq(showAddBusinessAccountRow({ active: personal, linkedCount: 5 }), false, 'profile row stays hidden at the cap');
eq(showAddBusinessAccountRow({ active: personal, linkedCount: null }), false, 'profile row waits until the list loads');
eq(showAddBusinessAccountRow({ active: linked, linkedCount: 0 }), false, 'linked business never gets the add row');
eq(showAddBusinessAccountRow({ active: business, linkedCount: 0 }), false, 'business only never gets the add row');
eq(showAddBusinessAccountRow({ active: null, linkedCount: 0 }), false, 'signed out never gets the add row');

eq(showCreateAndLink(0), true, 'no links yet: create and link');
eq(showCreateAndLink(4), true, 'under 5: create and link stay');
eq(showCreateAndLink(MAX_LINKED_BUSINESS_ACCOUNTS), false, 'at 5: create and link hide');
eq(showCreateAndLink(6), false, 'over the cap still hides create and link');

eq(showUnlink({ canUnlink: true }), true, 'unlink when the API allows it');
eq(showUnlink({ canUnlink: false }), false, 'no unlink when canUnlink is false');

eq(linkedAccountTitle({ businessName: 'Koru Honey', displayName: 'Pat Lee' }), 'Koru Honey', 'business name wins');
eq(linkedAccountTitle({ businessName: '  ', displayName: 'Pat Lee' }), 'Pat Lee', 'blank business name falls through');
eq(linkedAccountTitle({ businessName: null, displayName: 'Pat Lee' }), 'Pat Lee', 'display name when there is no business name');
eq(linkedAccountTitle({ businessName: null, displayName: null }), 'Business account', 'no name is not an email');

eq(linkedOwnerLine({ displayName: 'Pat Lee' }), 'Linked to Pat Lee', 'owner display name');
eq(linkedOwnerLine({ displayName: '  ' }), 'Linked to your personal account', 'blank owner name is not invented');
eq(linkedOwnerLine(null), 'Linked business account', 'owner not loaded yet');

eq(readyCopy('Koru Honey'), 'Koru Honey is ready.', 'ready line uses the business name');
eq(
  unlinkConfirmCopy('Koru Honey'),
  'Unlink Koru Honey? Both accounts stay. You just won’t switch between them here.',
  'unlink dialog copy',
);
eq(BUSINESS_ACCOUNT_EMPTY_COPY, 'Keep business money in its own account, linked to this one.', 'empty card body');

eq(accountLinkErrorCopy('INVALID_BUSINESS_NAME'), 'Enter a business name, up to 120 characters.', 'INVALID_BUSINESS_NAME');
eq(accountLinkErrorCopy('LINK_LIMIT'), 'You can link up to 5 business accounts.', 'LINK_LIMIT');
eq(accountLinkErrorCopy('INVALID_CREDENTIALS'), 'That email and password didn’t match.', 'INVALID_CREDENTIALS');
eq(accountLinkErrorCopy('NOT_BUSINESS_ACCOUNT'), 'That account isn’t a business account.', 'NOT_BUSINESS_ACCOUNT');
eq(accountLinkErrorCopy('ALREADY_LINKED'), 'That account is already linked.', 'ALREADY_LINKED');
eq(accountLinkErrorCopy('TOO_MANY_ATTEMPTS'), 'Too many tries. Wait a bit and try again.', 'TOO_MANY_ATTEMPTS');
eq(
  accountLinkErrorCopy('TWO_FACTOR_REQUIRED'),
  'That account uses two-step sign-in, so it can’t be linked here yet.',
  'TWO_FACTOR_REQUIRED',
);
eq(accountLinkErrorCopy('NOT_PERSONAL_ACCOUNT'), ACCOUNT_LINK_ERROR_COPY.NOT_PERSONAL_ACCOUNT, 'NOT_PERSONAL_ACCOUNT');
eq(accountLinkErrorCopy('LINKED_BUSINESS_CANNOT_OWN'), ACCOUNT_LINK_ERROR_COPY.LINKED_BUSINESS_CANNOT_OWN, 'LINKED_BUSINESS_CANNOT_OWN');
eq(accountLinkErrorCopy('LINKED_ACCOUNT_HAS_NO_LOGIN'), ACCOUNT_LINK_ERROR_COPY.LINKED_ACCOUNT_HAS_NO_LOGIN, 'no login stays linked');
eq(accountLinkErrorCopy('SWITCH_NOT_ALLOWED'), ACCOUNT_LINK_ERROR_COPY.SWITCH_NOT_ALLOWED, 'switch not allowed');
eq(accountLinkErrorCopy('SAME_ACCOUNT'), ACCOUNT_LINK_ERROR_COPY.SAME_ACCOUNT, 'same account');
eq(accountLinkErrorCopy('ACCOUNT_PENDING_DELETION'), ACCOUNT_LINK_ERROR_COPY.ACCOUNT_PENDING_DELETION, 'pending deletion');
eq(accountLinkErrorCopy(undefined), ACCOUNT_LINK_ERROR_FALLBACK, 'missing code is the fallback');
eq(accountLinkErrorCopy('BUSINESS_PLAN_REQUIRED'), ACCOUNT_LINK_ERROR_FALLBACK, 'a plan code is not an account-link error');
for (const line of Object.values(ACCOUNT_LINK_ERROR_COPY)) {
  eq(/password_hash|synthetic|koruledger\.invalid|user_id/i.test(line), false, `plain language: ${line}`);
}

eq(routesPersonalToBusinessAccount('BUSINESS_PLAN_REQUIRES_BUSINESS_ACCOUNT'), true, 'checkout 403 opens the section');
eq(routesPersonalToBusinessAccount('BUSINESS_PLAN_REQUIRED'), false, 'a missing plan is not the section route');
eq(routesPersonalToBusinessAccount(undefined), false, 'no code is not the section route');
eq(personalChoosingBusiness('personal', 'business'), true, 'personal choosing Business opens the section');
eq(personalChoosingBusiness('personal', 'plus'), false, 'plus stays on checkout');
eq(personalChoosingBusiness('both', 'business'), false, 'both may buy Business');
eq(personalChoosingBusiness('business', 'business'), false, 'a business account may buy Business');
eq(
  personalBusinessCheckoutRoute({ usage: 'personal', plan: 'business', onboardingComplete: true }),
  'settings',
  'finished setup goes to the settings section',
);
eq(
  personalBusinessCheckoutRoute({ usage: 'personal', plan: 'business', onboardingComplete: false }),
  'later',
  'signup cannot open Settings yet',
);
eq(personalBusinessCheckoutRoute({ usage: 'both', plan: 'business', onboardingComplete: true }), null, 'both checks out');
eq(ADD_BUSINESS_AFTER_SETUP.includes('Settings'), true, 'signup tells them where the section will be');

eq(businessPlanNeededCopy('BUSINESS_PLAN_REQUIRED'), BUSINESS_PLAN_NEEDED_COPY, 'plan required uses the calm line');
eq(BUSINESS_PLAN_NEEDED_COPY, 'Business accounts need the Business plan.', 'calm line wording');
eq(businessPlanNeededCopy('BUSINESS_PLAN_REQUIRES_BUSINESS_ACCOUNT'), null, 'the 403 is a route, not this line');
eq(businessPlanNeededCopy(undefined), null, 'no code, no line');

eq(BUSINESS_ACCOUNT_HREF, '/settings?tab=account#business-account', 'section anchor');
eq(SETTINGS_BILLING_HREF, '/settings?tab=account#account-plan', 'See Business opens billing');
eq(DASHBOARD_AFTER_SWITCH, '/', 'a switch reloads the dashboard');

eq(showBackToPersonal(null), false, 'no links yet: no Back to personal');
eq(showBackToPersonal({}), false, 'canSwitchToOwner missing hides Back to personal');
eq(showBackToPersonal({ canSwitchToOwner: false }), false, 'canSwitchToOwner false hides the button');
eq(showBackToPersonal({ canSwitchToOwner: true }), true, 'canSwitchToOwner true shows Back to personal');
eq(showBackToPersonal({ canSwitchToOwner: 'true' }), false, 'only a real boolean true counts');

eq(showSelfUnlink(null), false, 'no current account: no self unlink');
eq(showSelfUnlink({ canUnlink: false }), false, 'a created business cannot unlink itself');
eq(showSelfUnlink({ canUnlink: true }), true, 'a linked business with its own login can unlink itself');

eq(unlinkControlDisabled(false), false, 'unlink stays usable when nothing is switching');
eq(unlinkControlDisabled(true), true, 'unlink is disabled while a switch is running');

eq(accountLinkErrorCopy('NOT_LINK_OWNER'), 'Only the account that linked this business can unlink it.', 'NOT_LINK_OWNER');
eq(
  accountLinkErrorCopy('TWO_FACTOR_REQUIRED'),
  'That account uses two-step sign-in, so it can’t be linked here yet.',
  'linking keeps its two-step sentence',
);
eq(
  switchAccountErrorCopy('TWO_FACTOR_REQUIRED'),
  'That business account uses two-step sign-in. Sign in to it directly.',
  'switching has its own two-step sentence',
);
eq(switchAccountErrorCopy('SWITCH_NOT_ALLOWED'), 'That account can’t be opened from here.', 'switch not allowed uses the switch map');
eq(switchAccountErrorCopy('INVALID_CREDENTIALS'), 'That didn’t work. Try again.', 'a link error is not a switch sentence');

eq(visibleAccountEmail(null), null, 'null email is not shown');
eq(visibleAccountEmail(undefined), null, 'missing email is not shown');
eq(visibleAccountEmail('null'), null, 'the word null is not shown');
eq(visibleAccountEmail('  '), null, 'blank email is not shown');
eq(visibleAccountEmail('linked.abc@accounts.koruledger.invalid'), null, 'the synthetic address is not shown');
eq(visibleAccountEmail('pat@example.com'), 'pat@example.com', 'a real email is shown');

eq(offerAccountSignIn(null), false, 'no account: no sign-in actions');
eq(offerAccountSignIn({ hasOwnLogin: false }), false, 'a no-login business gets no email or sign-in actions');
eq(offerAccountSignIn({ hasOwnLogin: true }), true, 'an account that can sign in keeps email and password actions');
eq(offerAccountSignIn({}), false, 'a missing hasOwnLogin flag hides the actions');

eq(signOutMenuLabel(null, true), 'Sign out', 'sign out does not say null');
eq(signOutMenuLabel('linked.x@accounts.koruledger.invalid', true), 'Sign out', 'sign out does not name the synthetic address');
eq(signOutMenuLabel('pat@example.com', true), 'Sign out of pat@example.com', 'other accounts name the real email');
eq(signOutMenuLabel('pat@example.com', false), 'Sign out', 'one account just says sign out');
eq(signOutMenuLabel(null, true, 'Pat Ng'), 'Sign out of Pat Ng', 'a hidden email uses the display name');
eq(signOutMenuLabel(null, true, '  '), 'Sign out', 'a blank name stays Sign out');
eq(signOutMenuLabel(null, false, 'Pat Ng'), 'Sign out', 'one account stays Sign out even with a name');
eq(signOutMenuLabel('pat@example.com', true, 'Pat Ng'), 'Sign out of pat@example.com', 'a real email still wins over the name');

eq(staySignedInAs(null), null, 'signed out has no stay-signed-in clause');
eq(staySignedInAs({ email: null, displayName: 'Pat Ng' }), 'Pat Ng', 'null email uses the display name');
eq(staySignedInAs({ email: null, displayName: null, firstName: 'Pat', lastName: 'Ng' }), 'Pat Ng', 'null email can use the person’s name');
eq(staySignedInAs({ email: null, displayName: null, firstName: null, lastName: null }), null, 'no name drops the as-clause');
eq(staySignedInAs({ email: 'linked.a@accounts.koruledger.invalid', displayName: 'Pat Ng' }), 'Pat Ng', 'synthetic email uses the name');
eq(staySignedInAs({ email: 'pat@example.com', displayName: 'Pat Ng' }), 'pat@example.com', 'a real email is what you stay signed in as');

eq(otherAccountLine({ displayName: 'Pat Ng', businessName: 'Koru Honey', email: null }), { name: 'Pat Ng', email: null }, 'another account uses the display name and hides a null email');
eq(otherAccountLine({ displayName: '  ', businessName: 'Koru Honey', email: null }), { name: 'Koru Honey', email: null }, 'a blank name falls through to the business name');
eq(otherAccountLine({ displayName: null, businessName: null, email: null }), { name: 'Account', email: null }, 'no name and no email is not the word null');
eq(otherAccountLine({ displayName: null, businessName: null, email: 'null' }), { name: 'Account', email: null }, 'the word null is not an email');
eq(otherAccountLine({ displayName: null, businessName: null, email: '' }), { name: 'Account', email: null }, 'an empty email is not shown');
eq(
  otherAccountLine({ displayName: 'Pat Ng', email: 'pat@example.com' }),
  { name: 'Pat Ng', email: 'pat@example.com' },
  'a real email can sit under the name',
);
eq(
  otherAccountLine({ displayName: null, businessName: null, email: 'pat@example.com' }),
  { name: 'pat@example.com', email: null },
  'a real email is the name only when there is no other name',
);
eq(
  otherAccountLine({ displayName: null, businessName: 'Koru Honey', email: 'linked.a@accounts.koruledger.invalid' }),
  { name: 'Koru Honey', email: null },
  'a synthetic email is not shown beside the business',
);
eq(selfUnlinkName('Koru Honey'), 'Koru Honey', 'unlink names the business');
eq(selfUnlinkName('  '), 'this business account', 'a blank business name is not the person’s name');
eq(selfUnlinkName(null), 'this business account', 'unlink without a business name does not invent one');
eq(readBusinessName({ businessName: 'Koru Honey' }), 'Koru Honey', 'businessName is read when the payload has it');
eq(readBusinessName({ displayName: 'Pat Ng' }), null, 'displayName is not a business name');
eq(readBusinessName(null), null, 'a missing account has no business name');

eq(planRequiredHref(personal), BUSINESS_ACCOUNT_HREF, 'personal locked reports open the business-account card');
eq(planRequiredHref(null), BUSINESS_ACCOUNT_HREF, 'an unknown account is treated as personal');
eq(planRequiredHref(both), SETTINGS_BILLING_HREF, 'both can open the Business plan');
eq(planRequiredHref(business), SETTINGS_BILLING_HREF, 'a business account opens billing');
eq(planRequiredHref(linked), SETTINGS_BILLING_HREF, 'a linked business opens billing');

function party(id: string, displayName: string | null, usageMode: AccountLinkParty['usageMode'], isLinkedBusiness: boolean): AccountLinkParty {
  return { id, displayName, usageMode, plan: 'free', isLinkedBusiness, canUnlink: false };
}

function linkedItem(id: string, businessName: string | null, displayName: string | null): LinkedAccountSummary {
  return { id, displayName, businessName, plan: 'free', hasOwnLogin: false, canUnlink: false };
}

function linksOf(
  current: AccountLinkParty,
  owner: AccountLinkParty | null,
  linkedRows: LinkedAccountSummary[],
  canSwitchToOwner?: boolean,
): AccountLinksResponse {
  const links: AccountLinksResponse = { current, owner, linked: linkedRows };
  if (canSwitchToOwner !== undefined) (links as { canSwitchToOwner?: boolean }).canSwitchToOwner = canSwitchToOwner;
  return links;
}

const pat = party('pat', 'Pat Ng', 'personal', false);
const honey = party('honey', 'Pat Ng', 'business', true);
const honeyLinked = linkedItem('honey', 'Koru Honey', 'Pat Ng');
const hiveLinked = linkedItem('hive', 'Koru Hive', 'Pat Ng');
const ownerLinks = linksOf(pat, null, [honeyLinked, hiveLinked]);
const businessLinksHidden = linksOf(honey, pat, []);
const businessLinksAllowed = linksOf(honey, pat, [], true);
const unlinked = linksOf(pat, null, []);

eq(businessNameForAccount('honey', ownerLinks, null), 'Koru Honey', 'a linked row supplies the business name');
eq(businessNameForAccount('honey', businessLinksHidden, 'Koru Honey'), 'Koru Honey', 'the open business supplies its name');
eq(businessNameForAccount('pat', ownerLinks, 'Koru Honey'), null, 'the personal account is not given a business name');

eq(showAccountsGroup(null), false, 'no list yet: no Accounts group');
eq(showAccountsGroup(unlinked), false, 'an unlinked personal account has no Accounts group');
eq(showAccountsGroup(ownerLinks), true, 'an owner with a linked business sees the Accounts group');
eq(showAccountsGroup(businessLinksHidden), true, 'a linked business sees the Accounts group');
eq(
  showAddBusinessAccountMenuRow({ active: personal, linkedCount: 0, accountsGroup: true }),
  false,
  'the add row hides while the Accounts group is shown',
);
eq(
  showAddBusinessAccountMenuRow({ active: personal, linkedCount: 0, accountsGroup: false }),
  true,
  'the add row stays when nothing is linked',
);

eq(
  accountSwitcherRows(ownerLinks).map((row) => [row.id, row.pill, row.current, row.name]),
  [
    ['pat', 'personal', true, 'Pat Ng'],
    ['honey', 'business', false, 'Koru Honey'],
    ['hive', 'business', false, 'Koru Hive'],
  ],
  'owner sees personal first, then each business',
);
eq(
  accountSwitcherRows(businessLinksHidden).map((row) => [row.id, row.pill, row.current]),
  [['honey', 'business', true]],
  'missing canSwitchToOwner hides the Personal switch-back row',
);
eq(
  accountSwitcherRows(businessLinksAllowed).map((row) => [row.id, row.pill, row.current, row.name]),
  [
    ['pat', 'personal', false, 'Pat Ng'],
    ['honey', 'business', true, 'Pat Ng'],
  ],
  'canSwitchToOwner true shows the Personal row',
);
eq(
  accountSwitcherRows(linksOf(honey, pat, [], false)).some((row) => row.pill === 'personal'),
  false,
  'canSwitchToOwner false hides the Personal row',
);
eq(
  accountSwitcherRows(businessLinksAllowed, 'Koru Honey').find((row) => row.current)?.name,
  'Koru Honey',
  'the open business uses its business name when we have one',
);

const currentRow = { id: 'pat', current: true };
const otherRow = { id: 'honey', current: false };
eq(accountSwitchRowState(currentRow, { kind: 'idle' }), { ariaCurrent: true, disabled: false, statusText: 'Current', blocked: false }, 'the active row is current');
eq(accountSwitchRowState(otherRow, { kind: 'idle' }).ariaCurrent, false, 'an inactive row is not current');
eq(
  accountSwitchRowState(otherRow, { kind: 'switching', accountId: 'honey' }),
  { ariaCurrent: false, disabled: true, statusText: 'Switching…', blocked: false },
  'the row being opened says Switching and is disabled',
);
eq(
  accountSwitchRowState(currentRow, { kind: 'switching', accountId: 'honey' }).disabled,
  true,
  'every row is disabled while a switch is running',
);
eq(accountSwitchRowState({ id: 'hive', current: false }, { kind: 'switching', accountId: 'honey' }).blocked, true, 'the other rows are blocked');
eq(accountSwitchTarget(otherRow, { kind: 'idle' }), 'honey', 'an inactive row can be switched to');
eq(accountSwitchTarget(currentRow, { kind: 'idle' }), null, 'the current row does not switch');
eq(accountSwitchTarget(otherRow, { kind: 'switching', accountId: 'honey' }), null, 'a second switch waits');
eq(resetSwitchOnMenuOpen({ kind: 'failed', accountId: 'honey', message: 'x' }), true, 'reopening clears a failed switch');
eq(resetSwitchOnMenuOpen({ kind: 'switching', accountId: 'honey' }), false, 'reopening leaves an in-flight switch locked');
eq(resetSwitchOnMenuOpen({ kind: 'idle' }), false, 'an idle menu does not reset the lock');
const failed = accountSwitchRowState(otherRow, {
  kind: 'failed',
  accountId: 'honey',
  message: switchAccountErrorCopy('SWITCH_NOT_ALLOWED'),
});
eq(failed.disabled, false, 'a failed switch can be tried again');
eq(failed.statusText, 'That account can’t be opened from here.', 'SWITCH_NOT_ALLOWED stays inline on the row');
eq(
  accountSwitchRowState(otherRow, {
    kind: 'failed',
    accountId: 'honey',
    message: switchAccountErrorCopy('TWO_FACTOR_REQUIRED'),
  }).statusText,
  'That business account uses two-step sign-in. Sign in to it directly.',
  'two-step sign-in is explained on the row',
);
eq(
  accountSwitchRowState(otherRow, { kind: 'failed', accountId: 'honey', message: switchAccountErrorCopy(undefined) }).statusText,
  'That didn’t work. Try again.',
  'an unknown switch failure uses the switch fallback',
);

eq(headerAccountContext({ links: null, active: null }), null, 'signed out header is unchanged');
eq(
  headerAccountContext({ links: unlinked, active: { isLinkedBusiness: false, ownerId: null } }),
  null,
  'an unlinked account does not get a header pill',
);
eq(
  headerAccountContext({ links: ownerLinks, active: { isLinkedBusiness: false, ownerId: null } }),
  { name: 'Pat Ng', pill: 'personal' },
  'a linked owner’s header names the personal account',
);
eq(
  headerAccountContext({
    links: businessLinksAllowed,
    active: { isLinkedBusiness: true, ownerId: 'pat' },
    activeBusinessName: 'Koru Honey',
  }),
  { name: 'Koru Honey', pill: 'business' },
  'a linked business header names that business',
);
eq(
  headerAccountContext({ links: null, active: { isLinkedBusiness: true, ownerId: 'pat' } }),
  { name: 'Business account', pill: 'business' },
  'before the list returns, a linked business is not the person’s name',
);
eq(
  headerAccountContext({
    links: businessLinksAllowed,
    active: { isLinkedBusiness: true, ownerId: 'pat' },
    activeBusinessName: '  ',
  }),
  { name: 'Business account', pill: 'business' },
  'an empty business-name lookup falls back to Business account',
);
eq(
  headerAccountContext({
    links: businessLinksAllowed,
    active: { isLinkedBusiness: true, ownerId: 'pat' },
    activeBusinessName: null,
  }),
  { name: 'Business account', pill: 'business' },
  'a failed business-name lookup falls back to Business account',
);

console.log('accountLinksView tests passed');
