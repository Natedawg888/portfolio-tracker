/**
 * Shopping list page helpers (presentation only; no prices are made here).
 */
import type { ShoppingStore } from '../types';

export const CHAIN_LABELS: Record<ShoppingStore['chain'], string> = {
  woolworths: 'Woolworths',
  paknsave: "Pak'nSave",
  newworld: 'New World',
  freshchoice: 'FreshChoice',
  supervalue: 'SuperValue',
  foursquare: 'Four Square',
  warehouse: 'The Warehouse',
  costco: 'Costco',
};

/** Same key the server uses to match a branch: chain plus the tidied, lowercase branch. */
export function storeKey(s: ShoppingStore): string {
  return `${s.chain}|${s.branch.toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

/**
 * Branch name for display: words typed all in lowercase get a capital first letter
 * ("royal oak" → "Royal Oak"); anything with capitals already ("McLeod", "CBD") is kept.
 * What's stored is unchanged.
 */
export function displayBranch(branch: string): string {
  return branch
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function storeLabel(s: ShoppingStore): string {
  return `${CHAIN_LABELS[s.chain] ?? s.chain} ${displayBranch(s.branch)}`;
}

const STORE_PREF = (listId: string) => `koru.shopping.store.${listId}`;

/** The store chosen for a list, remembered in this browser only. */
export function readListStore(listId: string, stores: ShoppingStore[]): ShoppingStore | null {
  if (stores.length === 0) return null;
  try {
    const saved = localStorage.getItem(STORE_PREF(listId));
    const hit = saved ? stores.find((s) => storeKey(s) === saved) : undefined;
    if (hit) return hit;
  } catch {
    /* storage blocked */
  }
  return stores[0];
}

export function writeListStore(listId: string, store: ShoppingStore): void {
  try {
    localStorage.setItem(STORE_PREF(listId), storeKey(store));
  } catch {
    /* storage blocked: the choice lasts for this visit */
  }
}

export type BudgetBar = {
  /** Shares of the bar, 0–100. The scale is the plan, or spent + this list when that is bigger. */
  spentPct: number;
  listPct: number;
  /** Where the plan ends on the bar when the total runs past it (null when within the plan). */
  planMarkPct: number | null;
  /** What's left after this list; negative = over. */
  afterList: number;
  over: boolean;
  overBy: number;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Bar for one category: spent this month and this list against the month's plan. */
export function budgetBar(planned: number, spent: number, toBuy: number): BudgetBar {
  const s = Math.max(0, spent);
  const l = Math.max(0, toBuy);
  const p = Math.max(0, planned);
  const scale = Math.max(p, s + l) || 1;
  const remaining = p - s;
  const afterList = r2(remaining - l);
  const over = afterList < 0;
  return {
    spentPct: (s / scale) * 100,
    listPct: (l / scale) * 100,
    planMarkPct: s + l > p && p > 0 ? (p / scale) * 100 : null,
    afterList,
    over,
    overBy: over ? r2(-afterList) : 0,
  };
}

/** "today", "yesterday", "3 days ago" for a YYYY-MM-DD date. */
export function daysAgo(date: string, today: string): string {
  const d = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(d) || d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

/** Quantity for display: whole numbers as-is, otherwise up to two decimals. */
export function qtyText(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/\.?0+$/, '');
}

/** Next quantity for the − / + stepper: whole steps, never below 1. */
export function stepQty(q: number, dir: 1 | -1): number {
  const next = dir > 0 ? Math.floor(q) + 1 : Math.ceil(q) - 1;
  return Math.max(1, next);
}

type PricedStore = { total: number; pricedCount: number; items: Record<string, unknown | null> };

/**
 * The cheapest store, only when every store compared has prices for exactly the same items
 * (and at least one). Otherwise the totals cover different things, so none is picked.
 */
export function cheapestComparable<T extends PricedStore>(stores: T[]): { store: T | null; sameItems: boolean } {
  if (stores.length < 2) return { store: null, sameItems: false };
  const pattern = (s: PricedStore) =>
    Object.keys(s.items)
      .filter((id) => s.items[id] != null)
      .sort()
      .join('|');
  const first = pattern(stores[0]);
  const sameItems = stores.every((s) => pattern(s) === first);
  if (!sameItems || stores[0].pricedCount === 0) return { store: null, sameItems };
  const sorted = [...stores].sort((a, b) => a.total - b.total);
  // A tie isn't a recommendation.
  if (sorted[0].total === sorted[1].total) return { store: null, sameItems };
  return { store: sorted[0], sameItems };
}
