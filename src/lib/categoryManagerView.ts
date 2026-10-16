/**
 * Settings → Categories & assets: wording for the transaction categories card.
 */
import type { CategoryType } from './categoryTypes';

export const TYPE_EXPLAINER: Record<CategoryType, string> = {
  spending: 'Everyday costs. These count toward your budget and the spend charts.',
  income: 'Money you earn. Compared with your income plan on Budget.',
  transfer_out: 'Money moved to your own accounts or investments, not spending.',
  transfer_in: 'Money moved in from your own accounts or investments, not income.',
};

/**
 * Default categories the app looks up by slug. They can be renamed and recoloured, but not
 * deleted or moved to another type (the server refuses both). Text completes "Koru uses this for …".
 */
export const BUILT_IN_CATEGORIES: Record<string, string> = {
  'cat-income': 'general income and paid invoices',
  'cat-income-mining': 'mining and crypto income, and in Projections',
  'cat-income-dividends': 'dividends and interest from your holdings',
  'cat-debt': 'debt repayments',
  'cat-charity': 'donations and the donation tax credit',
  'cat-investments': 'money moved to investments, and in Projections',
  'cat-income-rental': 'rent from your properties on Rentals',
  'cat-rental': 'property costs on Rentals',
};

export function isBuiltInCategory(slug: string | null | undefined): boolean {
  return Boolean(slug && Object.hasOwn(BUILT_IN_CATEGORIES, slug));
}

export type UsageCounts = {
  transactions: number;
  incomeRecords: number;
  budgetPlans: number;
  incomePlans: number;
  payeeRules: number;
  recurring: number;
  shopping: number;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "12 transactions, 1 budget plan and 2 payee rules". Empty when nothing uses it. */
export function usageText(u: UsageCounts): string {
  const parts = [
    u.transactions ? plural(u.transactions, 'transaction', 'transactions') : '',
    u.incomeRecords ? plural(u.incomeRecords, 'income record', 'income records') : '',
    u.budgetPlans ? plural(u.budgetPlans, 'budget plan', 'budget plans') : '',
    u.incomePlans ? plural(u.incomePlans, 'income plan', 'income plans') : '',
    u.payeeRules ? plural(u.payeeRules, 'payee rule', 'payee rules') : '',
    u.recurring ? plural(u.recurring, 'bill or recurring item', 'bills or recurring items') : '',
    u.shopping ? plural(u.shopping, 'shopping list item', 'shopping list items') : '',
  ].filter(Boolean);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** "$500.61 in Oct" or "Not used in Oct". */
export function monthTotalText(amount: number | undefined, monthShort: string, money: (n: number) => string): string {
  return amount && amount > 0 ? `${money(amount)} in ${monthShort}` : `Not used in ${monthShort}`;
}
