/**
 * The starter budget categories every account is given at signup (server/lib/categories.ts seeds
 * them). Slugs are stable keys; some are looked up by the app (see BUILT_IN_CATEGORIES).
 */
export type SeedCategory = {
  slug: string;
  name: string;
  type: 'spending' | 'income' | 'transfer_out' | 'transfer_in';
  sortOrder: number;
};

/** Canonical seed list (slug === historical global id). */
export const DEFAULT_CATEGORY_SEEDS: SeedCategory[] = [
  { slug: 'cat-income', name: 'Income', type: 'income', sortOrder: 0 },
  { slug: 'cat-income-salary', name: 'Salary', type: 'income', sortOrder: 1 },
  { slug: 'cat-income-mining', name: 'Mining', type: 'income', sortOrder: 2 },
  { slug: 'cat-income-dividends', name: 'Dividends & interest', type: 'income', sortOrder: 3 },
  { slug: 'cat-income-other', name: 'Other income', type: 'income', sortOrder: 4 },
  { slug: 'cat-housing', name: 'Housing', type: 'spending', sortOrder: 10 },
  { slug: 'cat-food', name: 'Food & groceries', type: 'spending', sortOrder: 20 },
  { slug: 'cat-eating-out', name: 'Eating out', type: 'spending', sortOrder: 25 },
  { slug: 'cat-transport', name: 'Transport', type: 'spending', sortOrder: 30 },
  { slug: 'cat-utilities', name: 'Utilities', type: 'spending', sortOrder: 40 },
  { slug: 'cat-health', name: 'Health', type: 'spending', sortOrder: 50 },
  { slug: 'cat-entertainment', name: 'Entertainment', type: 'spending', sortOrder: 60 },
  { slug: 'cat-subscriptions', name: 'Subscriptions', type: 'spending', sortOrder: 70 },
  { slug: 'cat-investments', name: 'Investments', type: 'transfer_out', sortOrder: 80 },
  { slug: 'cat-debt', name: 'Debt', type: 'spending', sortOrder: 85 },
  { slug: 'cat-charity', name: 'Charity', type: 'spending', sortOrder: 87 },
  { slug: 'cat-other', name: 'Other', type: 'spending', sortOrder: 90 },
  { slug: 'cat-transfer-out', name: 'Transfer out', type: 'transfer_out', sortOrder: 95 },
  { slug: 'cat-transfer-in', name: 'Transfer in', type: 'transfer_in', sortOrder: 96 },
];
