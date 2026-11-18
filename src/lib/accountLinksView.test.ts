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
  offerAccountSignIn,
  planRequiredHref,
  showBackToPersonal,
  showSelfUnlink,
  showUnlink,
  signOutMenuLabel,
  switchAccountErrorCopy,
  unlinkConfirmCopy,
  unlinkControlDisabled,
  visibleAccountEmail,
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

eq(planRequiredHref(personal), BUSINESS_ACCOUNT_HREF, 'personal locked reports open the business-account card');
eq(planRequiredHref(null), BUSINESS_ACCOUNT_HREF, 'an unknown account is treated as personal');
eq(planRequiredHref(both), SETTINGS_BILLING_HREF, 'both can open the Business plan');
eq(planRequiredHref(business), SETTINGS_BILLING_HREF, 'a business account opens billing');
eq(planRequiredHref(linked), SETTINGS_BILLING_HREF, 'a linked business opens billing');

console.log('accountLinksView tests passed');
