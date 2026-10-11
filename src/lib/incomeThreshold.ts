/**
 * Below this much income in a month, ratios over income (savings rate on the
 * Dashboard, debt-to-income on Debts) swing to meaningless figures like −1,400%,
 * so they show an em dash instead.
 */
export const MIN_INCOME_FOR_RATIOS_NZD = 100;

export function incomeTooLowForRatios(incomeNzd: number | null | undefined): boolean {
  return incomeNzd == null || !Number.isFinite(incomeNzd) || incomeNzd < MIN_INCOME_FOR_RATIOS_NZD;
}
