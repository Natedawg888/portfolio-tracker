/**
 * Passkey helpers in the browser (KAN-75). Run: npm run test:passkeys
 */
import { authEventText, hintName, parseDismissed, parseHint } from './passkeys.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}

eq(parseHint(JSON.stringify({ email: 'a@example.com', name: 'Alex' }))?.name, 'Alex', 'stored hint');
eq(parseHint('{"email":"a@example.com"}'), null, 'hint without a name is ignored');
eq(parseHint('not json'), null, 'broken hint is ignored');
eq(parseHint(null), null, 'no hint');
eq(hintName({ email: 'a@example.com', displayName: 'Alex', firstName: 'Alexandra' }), 'Alex', 'display name first');
eq(hintName({ email: 'a@example.com', displayName: null, firstName: 'Alexandra' }), 'Alexandra', 'then first name');
eq(hintName({ email: 'a@example.com', displayName: null, firstName: null }), 'a@example.com', 'then email');
eq(parseDismissed('["a@example.com", 3]').join(), 'a@example.com', 'dismissed list keeps strings only');
eq(parseDismissed('{}').length, 0, 'dismissed list must be an array');
eq(authEventText('sign_in', 'passkey'), 'Signed in with a passkey', 'passkey sign-in');
eq(authEventText('sign_in', 'two_factor'), 'Signed in with password and 2FA code', '2FA sign-in');
eq(authEventText('sign_in', 'mystery'), 'Signed in', 'unknown method');
eq(authEventText('passkey_removed', null), 'Passkey removed', 'removal');

console.log('passkey helper tests ok');
