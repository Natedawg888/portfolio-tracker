/**
 * Switcher rows and the header pill, rendered to static markup.
 * Run: npm run test:account-switcher
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { accountSwitchErrorId } from '../lib/accountLinksView.ts';
import { AccountSwitchRow } from './AccountSwitchRow.tsx';
import { HeaderAccountLine } from './HeaderAccountLine.tsx';
import { accountLinksForUser, shouldFetchAccountLinks } from '../lib/useAccountLinks.ts';
import type { AccountLinksResponse } from '../types/accountLinks.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const current = renderToStaticMarkup(
  createElement(AccountSwitchRow, {
    id: 'pat',
    name: 'Pat Ng',
    pill: 'personal',
    current: true,
    disabled: false,
    blocked: false,
    statusText: 'Current',
    onClick: () => {},
  }),
);
assert(current.includes('role="menuitem"'), 'a switcher row is a menu item');
assert(current.includes('aria-current="true"'), 'the active row is aria-current');
assert(current.includes('account-type-pill--personal'), 'the active row shows the Personal pill');
assert(current.includes('>Personal<'), 'the pill reads Personal');
assert(current.includes('>Current<'), 'the active row says Current');
assert(!current.includes('role="alert"'), 'the current row has no alert');
assert(!current.includes('aria-describedby'), 'a row without an error is not described by one');

const errorId = accountSwitchErrorId('honey');
const failed = renderToStaticMarkup(
  createElement(AccountSwitchRow, {
    id: 'honey',
    name: 'Koru Honey',
    pill: 'business',
    current: false,
    disabled: false,
    blocked: false,
    statusText: 'That business account uses two-step sign-in. Sign in to it directly.',
    onClick: () => {},
  }),
);
assert(failed.includes('role="menuitem"'), 'a failed row is still a menu item');
assert(!failed.includes('aria-current'), 'a failed row is not the current account');
assert(failed.includes(`aria-describedby="${errorId}"`), 'the row points at its error');
assert(failed.includes(`id="${errorId}"`), 'the error has the id the row describes');
assert(failed.includes('account-type-pill--business'), 'the business row shows the Business pill');
assert(!failed.includes('role="alert"'), 'the error is not a nested alert');
assert(!failed.includes('>null<'), 'a row does not render the word null');

const switching = renderToStaticMarkup(
  createElement(AccountSwitchRow, {
    id: 'hive',
    name: 'Koru Hive',
    pill: 'business',
    current: false,
    disabled: true,
    blocked: false,
    statusText: 'Switching…',
    onClick: () => {},
  }),
);
assert(switching.includes('disabled'), 'a row in flight is disabled');
assert(switching.includes('Switching…'), 'the chosen row says Switching');
assert(!switching.includes('role="alert"'), 'Switching is not an alert');

const header = renderToStaticMarkup(createElement(HeaderAccountLine, { name: 'Koru Honey', pill: 'business' }));
assert(header.includes('account-context-name'), 'a known account name is in the header');
assert(header.includes('Koru Honey'), 'the header names the business');
assert(header.includes('account-type-pill--business'), 'the header shows the Business pill');
assert(header.includes('>Business<'), 'the header pill reads Business');
assert(header.includes('NZD'), 'the header keeps NZD');
assert(header.includes('Pacific/Auckland'), 'the header keeps the timezone');

const pending = renderToStaticMarkup(createElement(HeaderAccountLine, { name: null, pill: 'business' }));
assert(!pending.includes('account-context-name'), 'a name is not rendered until it is known');
assert(!pending.includes('Pat Ng'), 'the person’s name is not used while the list is loading');
assert(pending.includes('account-type-pill--business'), 'the Business pill can show before the name');
assert(pending.includes('NZD'), 'the neutral subtitle keeps NZD');

const personal = renderToStaticMarkup(createElement(HeaderAccountLine, { name: 'Pat Ng', pill: 'personal' }));
assert(personal.includes('account-type-pill--personal'), 'a personal account shows the Personal pill');
assert(personal.includes('>Personal<'), 'the header pill reads Personal');

const emptyLinks: AccountLinksResponse = {
  current: { id: 'pat', displayName: 'Pat Ng', usageMode: 'personal', plan: 'free', isLinkedBusiness: false, canUnlink: false },
  owner: null,
  linked: [],
  canSwitchToOwner: false,
};
const otherUser = {
  ...emptyLinks,
  current: { ...emptyLinks.current, id: 'someone-else' },
};
assert(shouldFetchAccountLinks({ userId: 'pat', emptyForUserId: null, force: false }) === true, 'the first check fetches');
assert(shouldFetchAccountLinks({ userId: 'pat', emptyForUserId: 'pat', force: false }) === false, 'a user with no links is not fetched again');
assert(shouldFetchAccountLinks({ userId: 'pat', emptyForUserId: 'pat', force: true }) === true, 'create, link, unlink, or switch fetches again');
assert(shouldFetchAccountLinks({ userId: undefined, emptyForUserId: null, force: false }) === false, 'signed out does not fetch');
assert(accountLinksForUser(emptyLinks, 'pat')?.current.id === 'pat', 'links for this user are kept');
assert(accountLinksForUser(otherUser, 'pat') === null, 'links for another user are dropped');
assert(accountLinksForUser(emptyLinks, undefined) === null, 'signed out drops cached links');

console.log('account switcher component tests passed');
