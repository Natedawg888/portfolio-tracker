/**
 * Phone drawer switches and the profile sheet close control.
 * Run: npm run test:account-switcher
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DrawerPreferenceToggles, DrawerSignOutButton, ProfileSheet } from './phoneChrome.tsx';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function switchCount(markup: string): number {
  return markup.split('role="switch"').length - 1;
}

const hidden = renderToStaticMarkup(
  createElement(DrawerPreferenceToggles, {
    moneyHidden: true,
    dark: false,
    onToggleMoney: () => {},
    onToggleTheme: () => {},
  }),
);
assert(hidden.includes('>Hide amounts<'), 'the drawer labels Hide amounts');
assert(hidden.includes('>Dark theme<'), 'the drawer labels Dark theme');
assert(switchCount(hidden) === 2, 'the drawer has a switch for amounts and a switch for theme');
assert(hidden.includes('aria-checked="true"'), 'Hide amounts is checked when amounts are hidden');
assert(hidden.includes('aria-checked="false"'), 'Dark theme is unchecked while the theme is light');
assert(hidden.indexOf('Hide amounts') < hidden.indexOf('Dark theme'), 'Hide amounts is the first switch');

const shown = renderToStaticMarkup(
  createElement(DrawerPreferenceToggles, {
    moneyHidden: false,
    dark: true,
    onToggleMoney: () => {},
    onToggleTheme: () => {},
  }),
);
assert(shown.includes('aria-checked="false"'), 'Hide amounts is unchecked when amounts are visible');
assert(shown.includes('aria-checked="true"'), 'Dark theme is checked while the theme is dark');

const sheet = renderToStaticMarkup(
  createElement(ProfileSheet, { onClose: () => {} }, 'Settings'),
);
assert(sheet.includes('>Close<'), 'the profile sheet has a Close control');
assert(sheet.includes('role="dialog"'), 'the profile sheet is a dialog');
assert(sheet.includes('aria-modal="true"'), 'the profile sheet is modal');
assert(sheet.includes('>Settings<'), 'the profile sheet keeps its menu items');

const namedSignOut = renderToStaticMarkup(
  createElement(DrawerSignOutButton, {
    email: 'pat@example.com',
    hasOtherAccounts: true,
    displayName: 'Pat Ng',
    signingOut: false,
    onClick: () => {},
  }),
);
assert(namedSignOut.includes('>Sign out of pat@example.com<'), 'another remembered account names who is signing out');
assert(!namedSignOut.includes('>Sign out<'), 'the named row is not the plain Sign out label');

const plainSignOut = renderToStaticMarkup(
  createElement(DrawerSignOutButton, {
    email: 'pat@example.com',
    hasOtherAccounts: false,
    displayName: 'Pat Ng',
    signingOut: false,
    onClick: () => {},
  }),
);
assert(plainSignOut.includes('>Sign out<'), 'one remembered account stays Sign out');
assert(!plainSignOut.includes('Sign out of'), 'one account does not name an address');

const hiddenEmail = renderToStaticMarkup(
  createElement(DrawerSignOutButton, {
    email: 'linked.x@accounts.koruledger.invalid',
    hasOtherAccounts: true,
    displayName: 'Pat Ng',
    signingOut: false,
    onClick: () => {},
  }),
);
assert(hiddenEmail.includes('>Sign out of Pat Ng<'), 'a hidden email uses the display name, as in the profile menu');

console.log('phone chrome component tests passed');
