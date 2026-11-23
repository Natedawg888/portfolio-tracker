/**
 * Holding company card helpers (KAN-134). Rows come from GET /api/business/:id/asset-classes.
 */
import type { BusinessAssetClassRow, BusinessHoldingOption } from '../types';

export function holdingClassesTotal(rows: readonly BusinessAssetClassRow[]): number {
  return Math.round(rows.reduce((s, r) => s + r.valueNzd, 0) * 100) / 100;
}

/** "3 holdings" or "2 holdings, 1 without a value yet". */
export function holdingClassCountText(r: BusinessAssetClassRow): string {
  const n = `${r.count} ${r.count === 1 ? 'holding' : 'holdings'}`;
  return r.unvalued > 0 ? `${n}, ${r.unvalued} without a value yet` : n;
}

/** Holdings grouped by class for the assign dialog, in the order the server sent them. */
export function groupHoldingOptions(options: readonly BusinessHoldingOption[]): { classLabel: string; items: BusinessHoldingOption[] }[] {
  const groups: { classLabel: string; items: BusinessHoldingOption[] }[] = [];
  for (const o of options) {
    const g = groups.find((x) => x.classLabel === o.classLabel);
    if (g) g.items.push(o);
    else groups.push({ classLabel: o.classLabel, items: [o] });
  }
  return groups;
}

export const HOLDING_COMPANY_EMPTY = 'Nothing assigned yet. Assign the shares, property, crypto or other holdings this company owns from your Portfolio.';
export const HOLDING_COMPANY_NET_WORTH_NOTE = 'Already in your net worth under Portfolio, so not added again.';
