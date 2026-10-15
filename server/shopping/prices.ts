/**
 * Crowdsourced supermarket prices (KAN-74). Only prices KoruLedger users record and
 * choose to share: no scraping, no third-party feeds, nothing estimated.
 *
 * - Item names are matched by a normalised key (lowercase, punctuation and repeated
 *   spaces removed), or by the product the user picked when correcting a match.
 * - A store is a chain plus a branch name, matched by a normalised branch key.
 * - A price at a store is the median of the observations in the recent window. With three
 *   or more, observations under half or over double the median are dropped first.
 * - Contributors are a keyed pseudonym, never a user id, and are never returned.
 */
import { pseudonym } from '../auth/secretBox.ts';

export const CHAINS = [
  { id: 'woolworths', label: 'Woolworths' },
  { id: 'paknsave', label: "Pak'nSave" },
  { id: 'newworld', label: 'New World' },
  { id: 'freshchoice', label: 'FreshChoice' },
  { id: 'supervalue', label: 'SuperValue' },
  { id: 'foursquare', label: 'Four Square' },
  { id: 'warehouse', label: 'The Warehouse' },
  { id: 'costco', label: 'Costco' },
] as const;
export type ChainId = (typeof CHAINS)[number]['id'];

export const WINDOW_OPTIONS = [30, 60, 90] as const;
export const DAILY_CONTRIBUTION_LIMIT = 150;
export const MAX_PRICE_NZD = 1000;

export function isChain(v: unknown): v is ChainId {
  return CHAINS.some((c) => c.id === v);
}

export function chainLabel(id: string): string {
  return CHAINS.find((c) => c.id === id)?.label ?? id;
}

/** "Anchor Blue Milk, 2L!" → "anchor blue milk 2l". */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tidyText(text: string, max: number): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, max);
}

export function storeKey(chain: string, branch: string): string {
  return `${chain}|${normaliseName(branch)}`;
}

export function priceContributor(userId: string): string {
  return pseudonym('price-contributor', userId);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median after dropping outliers (under half / over double the median, with 3+ prices). */
export function robustPrice(values: number[]): number | null {
  if (values.length === 0) return null;
  if (values.length < 3) return median(values);
  const m = median(values);
  const kept = values.filter((v) => v >= m / 2 && v <= m * 2);
  return median(kept.length ? kept : values);
}

export type StoreRef = { chain: ChainId; branch: string };
export type CompareItem = { id: string; productKey: string; quantity: number };
/** Prices known for one product at one store: values in the window and the latest date. */
export type PriceCell = { values: number[]; latest: string };

export type StoreComparison = {
  chain: ChainId;
  chainLabel: string;
  branch: string;
  total: number;
  pricedCount: number;
  items: Record<string, { unitPrice: number; lineTotal: number; observedOn: string } | null>;
};

export type ComparisonResult = {
  itemCount: number;
  stores: StoreComparison[];
  /** Cheapest among the stores with the most items priced; null when nothing is priced. */
  cheapest: { chain: ChainId; branch: string } | null;
  /** Buy each item where it is cheapest. */
  split: { total: number; pricedCount: number; savingVsCheapest: number | null } | null;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Pure: per-store totals from known prices. `cells` is keyed by `${productKey}@${storeKey}`. */
export function compareStores(items: CompareItem[], stores: StoreRef[], cells: Map<string, PriceCell>): ComparisonResult {
  const out: StoreComparison[] = stores.map((s) => {
    let total = 0;
    let pricedCount = 0;
    const byItem: StoreComparison['items'] = {};
    for (const it of items) {
      const cell = cells.get(`${it.productKey}@${storeKey(s.chain, s.branch)}`);
      const unit = cell ? robustPrice(cell.values) : null;
      if (unit == null || !cell) {
        byItem[it.id] = null;
        continue;
      }
      const line = unit * it.quantity;
      total += line;
      pricedCount += 1;
      byItem[it.id] = { unitPrice: round2(unit), lineTotal: round2(line), observedOn: cell.latest };
    }
    return { chain: s.chain, chainLabel: chainLabel(s.chain), branch: s.branch, total: round2(total), pricedCount, items: byItem };
  });

  const best = Math.max(0, ...out.map((s) => s.pricedCount));
  const contenders = out.filter((s) => best > 0 && s.pricedCount === best).sort((a, b) => a.total - b.total);
  const cheapest = contenders[0] ? { chain: contenders[0].chain, branch: contenders[0].branch } : null;

  // Split shop: each item at its cheapest known store.
  let splitTotal = 0;
  let splitCount = 0;
  let splitOnCheapestItems = 0;
  for (const it of items) {
    const prices = out.map((s) => s.items[it.id]?.lineTotal).filter((v): v is number => v != null);
    if (prices.length === 0) continue;
    const min = Math.min(...prices);
    splitTotal += min;
    splitCount += 1;
    if (contenders[0]?.items[it.id]) splitOnCheapestItems += min;
  }
  const split =
    splitCount > 0
      ? {
          total: round2(splitTotal),
          pricedCount: splitCount,
          // Saving on the items the cheapest store has prices for, so like is compared with like.
          savingVsCheapest: contenders[0] ? round2(contenders[0].total - splitOnCheapestItems) : null,
        }
      : null;

  return { itemCount: items.length, stores: out, cheapest, split };
}
