/**
 * Checkout return paths: only a short allowlist of in-app paths, otherwise Settings.
 * Run: npm run test:billing
 */
import { billingResultUrl, billingReturnPath } from './billingReturn.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

eq(billingReturnPath(undefined), '/settings', 'missing return stays on Settings');
eq(billingReturnPath(''), '/settings', 'empty return stays on Settings');
eq(billingReturnPath('   '), '/settings', 'blank return stays on Settings');
eq(billingReturnPath('/register'), '/register', 'onboarding may return to register');
eq(billingReturnPath('/register/'), '/register', 'a trailing slash is the same path');
eq(billingReturnPath('/register?billing=success'), '/register', 'a query on the request is ignored');
eq(billingReturnPath('/settings'), '/settings', 'settings is allowed');
eq(billingReturnPath('/settings?tab=account&next=https://evil.test'), '/settings', 'extra query keys are dropped');
eq(billingReturnPath('/'), '/', 'the dashboard is allowed');
eq(billingReturnPath('/business'), '/business', 'business setup is allowed');
eq(billingReturnPath('/business/'), '/business', 'business trailing slash');

eq(billingReturnPath('https://evil.test/register'), '/settings', 'an absolute URL is refused');
eq(billingReturnPath('http://evil.test/register'), '/settings', 'http absolute URL is refused');
eq(billingReturnPath('//evil.test/register'), '/settings', 'a protocol-relative URL is refused');
eq(billingReturnPath('///evil.test'), '/settings', 'a triple slash is refused');
eq(billingReturnPath('/\\evil.test'), '/settings', 'a backslash is refused');
eq(billingReturnPath('/register\\@evil.test'), '/settings', 'a backslash later in the path is refused');
eq(billingReturnPath('/register\nSet-Cookie:x'), '/settings', 'a newline is refused');
eq(billingReturnPath('/register%00'), '/settings', 'a null byte is refused');
eq(billingReturnPath('register'), '/settings', 'a path without a leading slash is refused');
eq(billingReturnPath('/register/extra'), '/settings', 'a longer path is not the register page');
eq(billingReturnPath('/settings/account'), '/settings', 'settings has no extra segment');
eq(billingReturnPath('/business/invoices'), '/settings', 'a business subpage is not the setup return');
eq(billingReturnPath('/login'), '/settings', 'unlisted pages are refused');
eq(billingReturnPath('/../register'), '/register', 'parent segments resolve, then the allowlist still applies');
eq(billingReturnPath('/%2e%2e/register'), '/register', 'encoded parent segments resolve onto the allowlist');
eq(billingReturnPath('/register/../../login'), '/settings', 'resolving off the allowlist is refused');
eq(billingReturnPath('/%2f%2fevil.test'), '/settings', 'an encoded protocol-relative path is refused');
eq(billingReturnPath('/register@evil.test'), '/settings', 'a userinfo trick is refused');
eq(billingReturnPath('/Register'), '/settings', 'the allowlist is case-sensitive');
eq(billingReturnPath(`/${'a'.repeat(300)}`), '/settings', 'a very long value is refused');
eq(billingReturnPath(12), '/settings', 'a non-string is refused');

const base = 'https://app.example.test/';
eq(billingResultUrl(base, undefined, 'success'), 'https://app.example.test/settings?tab=account&billing=success', 'default success URL');
eq(billingResultUrl(base, undefined, 'cancelled'), 'https://app.example.test/settings?tab=account&billing=cancelled', 'default cancel URL');
eq(billingResultUrl(base, '/register', 'success'), 'https://app.example.test/register?billing=success', 'onboarding success');
eq(billingResultUrl(base, '/register', 'cancelled'), 'https://app.example.test/register?billing=cancelled', 'onboarding cancel');
eq(billingResultUrl(base, 'https://evil.test', 'success'), 'https://app.example.test/settings?tab=account&billing=success', 'evil return falls back');
eq(billingResultUrl(base, '/business', 'success'), 'https://app.example.test/business?setup=1&billing=success', 'business setup keeps its flag');
eq(billingResultUrl(base, '/', 'cancelled'), 'https://app.example.test/?billing=cancelled', 'dashboard cancel');
eq(billingResultUrl('https://app.example.test', '/register', 'success'), 'https://app.example.test/register?billing=success', 'base without a trailing slash');

console.log('billingReturn tests passed');
