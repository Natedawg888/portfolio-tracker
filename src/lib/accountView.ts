/**
 * Settings → Account: wording and small rules shared by the account cards.
 * The Deleted / Kept lists must match what POST /api/auth/delete-account really does
 * (server/routes/auth.ts, server/lib/userScope.ts) — update both together.
 */

export const DELETE_WORD = 'DELETE';

/** The server trims the confirmation and wants DELETE in capitals. */
export function deleteConfirmed(typed: string): boolean {
  return typed.trim() === DELETE_WORD;
}

/** Sign-in providers the account is connected to, e.g. "Google" or "Google and Apple". */
export function providerList(labels: string[]): string {
  const unique = [...new Set(labels.filter(Boolean))];
  if (unique.length <= 1) return unique[0] ?? '';
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}

export const DELETED_ITEMS: readonly string[] = [
  'Your profile: name, email, photo, preferences and settings',
  'How you sign in: password, passkeys, Google, Apple or Microsoft connections, two-factor setup, trusted devices, signed-in sessions and sign-in history',
  'Your money: accounts, transactions and receipts, holdings and their photos, KiwiSaver, crypto, bonds, vehicles, rentals, budgets and categories, savings goals, income, payslips, invoices, warranties and shopping lists',
  'Your Akahu bank connection',
  'Supermarket prices you shared',
  'Your place in a household, what you shared with it, and your name in its history',
];

/** What stays after deletion. Only what truly remains; keep in step with the delete route. */
export const KEPT_ITEMS: readonly { text: string; link?: { href: string; label: string } }[] = [
  { text: 'Share prices, exchange rates and economic figures the app looked up. These are public and not linked to you.' },
  {
    text: 'If you share a household with others: splits and payments you were part of stay for them, since they affect what they owe. You show as “Former member”.',
  },
  { text: 'Your consent with Akahu itself. End it at', link: { href: 'https://my.akahu.nz', label: 'my.akahu.nz' } },
];
