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
  linkedAccountTitle,
  linkedOwnerLine,
  personalBusinessCheckoutRoute,
  personalChoosingBusiness,
  readyCopy,
  routesPersonalToBusinessAccount,
  showAddBusinessAccountRow,
  showCreateAndLink,
  showUnlink,
  unlinkConfirmCopy,
} from './accountLinksView.ts';

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

console.log('accountLinksView tests passed');
