/**
 * Transaction / budget category kinds.
 * Only `spending` counts toward Budget/Spending totals and spend-by-category charts.
 * Income feeds Income plans/received. Transfers move money between accounts/investments.
 */

export const CATEGORY_TYPES = ['spending', 'income', 'transfer_out', 'transfer_in'] as const;

export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const CATEGORY_TYPE_LABELS: Record<CategoryType, string> = {
  spending: 'Spending',
  income: 'Income',
  transfer_out: 'Transfer out',
  transfer_in: 'Transfer in',
};

export function isCategoryType(value: unknown): value is CategoryType {
  return typeof value === 'string' && (CATEGORY_TYPES as readonly string[]).includes(value);
}

/** Prefer explicit `type`; fall back to legacy isIncome boolean. */
export function normalizeCategoryType(
  type: unknown,
  isIncome?: boolean | number | null,
): CategoryType {
  if (isCategoryType(type)) return type;
  if (isIncome === true || isIncome === 1) return 'income';
  return 'spending';
}

export function categoryTypeIsIncome(type: CategoryType): boolean {
  return type === 'income';
}

/** True only for real expenses — excludes income and transfers. */
export function categoryTypeCountsAsSpend(type: CategoryType): boolean {
  return type === 'spending';
}

export function categoryTypeShortTag(type: CategoryType): string | null {
  switch (type) {
    case 'income':
      return 'income';
    case 'transfer_out':
      return 'transfer out';
    case 'transfer_in':
      return 'transfer in';
    default:
      return null;
  }
}

/**
 * True when a category's type contradicts the money's direction: money in under
 * Transfer out, or money out under Income / Transfer in. Money in under a spending
 * category is a refund and is not flagged.
 */
export function categoryDirectionMismatch(type: CategoryType, amount: number): boolean {
  if (!Number.isFinite(amount) || amount === 0) return false;
  if (amount > 0) return type === 'transfer_out';
  return type === 'income' || type === 'transfer_in';
}
