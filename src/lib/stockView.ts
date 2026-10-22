/**
 * Business Stock page (KAN-119): search, sort and page the stock chart, bar lengths and
 * colours, and the stock take (count every item, see the differences, save them as recounts).
 * Pure: no React, no fetch.
 */
import { roundQty } from './business.ts';
import type { StockItemView, StockLevel, StockUnit } from './stock.ts';

export const STOCK_PAGE_SIZE = 8;

export const STOCK_SORTS = [
  { value: 'level', label: 'Needs reordering first' },
  { value: 'name', label: 'Name' },
  { value: 'onHand', label: 'Most on hand' },
  { value: 'value', label: 'Highest value' },
] as const;
export type StockSort = (typeof STOCK_SORTS)[number]['value'];

const LEVEL_ORDER: Record<StockLevel, number> = { oversold: 0, out: 1, low: 2, ok: 3, untracked: 4 };

export function levelLabel(level: StockLevel): string {
  switch (level) {
    case 'oversold':
      return 'Oversold';
    case 'out':
      return 'Out of stock';
    case 'low':
      return 'Low: reorder';
    case 'ok':
      return 'In stock';
    case 'untracked':
      return 'No reorder level';
  }
}

export function formatQty(q: number, unit: StockUnit): string {
  const n = new Intl.NumberFormat('en-NZ', { maximumFractionDigits: 3 }).format(q);
  return unit === 'each' ? n : `${n} ${unit}`;
}

export function filterSortStock(items: StockItemView[], query: string, sort: StockSort): StockItemView[] {
  const q = query.trim().toLowerCase();
  const found = q ? items.filter((i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)) : items;
  const byName = (a: StockItemView, b: StockItemView) => a.name.localeCompare(b.name, 'en-NZ', { sensitivity: 'base' });
  return [...found].sort((a, b) => {
    switch (sort) {
      case 'level':
        return LEVEL_ORDER[a.position.level] - LEVEL_ORDER[b.position.level] || byName(a, b);
      case 'onHand':
        return b.position.onHand - a.position.onHand || byName(a, b);
      case 'value':
        return (b.position.valueNzd ?? -1) - (a.position.valueNzd ?? -1) || byName(a, b);
      default:
        return byName(a, b);
    }
  });
}

export function pageCount(total: number, size = STOCK_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

export function pageOf<T>(list: T[], page: number, size = STOCK_PAGE_SIZE): T[] {
  const p = Math.min(Math.max(0, page), pageCount(list.length, size) - 1);
  return list.slice(p * size, p * size + size);
}

/**
 * Bar length as a percentage of the page's scale: the largest on-hand or reorder level on the
 * page, so a low item's bar sits visibly short of its reorder mark. Oversold and empty are 0.
 */
export function barScale(items: StockItemView[]): number {
  return Math.max(0, ...items.map((i) => Math.max(i.position.onHand, i.reorderLevel ?? 0)));
}

export function barPercent(value: number, scale: number): number {
  if (scale <= 0 || value <= 0) return 0;
  return Math.min(100, Math.round((value / scale) * 1000) / 10);
}

export type StockTakeRow = {
  item: StockItemView;
  expected: number;
  /** null: not counted yet, so it isn't saved. */
  counted: number | null;
  /** counted − expected; negative is missing stock. null when not counted. */
  difference: number | null;
  /** Cost of the difference at the average cost; negative is a loss. */
  differenceNzd: number | null;
};

/** Typed counts: blank is "not counted"; anything that isn't a number of 0 or more is invalid. */
export function parseCount(raw: string): number | null | 'invalid' {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 'invalid';
  return roundQty(n);
}

export function stockTakeRows(items: StockItemView[], counts: Record<string, string>): StockTakeRow[] {
  return items.map((item) => {
    const expected = item.position.onHand;
    const parsed = parseCount(counts[item.id] ?? '');
    const counted = typeof parsed === 'number' ? parsed : null;
    const difference = counted == null ? null : roundQty(counted - expected);
    const wac = item.position.wacNzd;
    return {
      item,
      expected,
      counted,
      difference,
      differenceNzd: difference == null || wac == null ? null : Math.round(difference * wac * 100) / 100,
    };
  });
}

export type StockTakeSummary = {
  counted: number;
  total: number;
  /** Counted items whose count differs from on-hand. */
  changed: number;
  invalid: string[];
  /** Net cost of all differences; negative is a loss. null when no counted item has a cost. */
  netNzd: number | null;
};

export function stockTakeSummary(rows: StockTakeRow[], counts: Record<string, string>): StockTakeSummary {
  let netNzd: number | null = null;
  for (const r of rows) if (r.differenceNzd != null) netNzd = (netNzd ?? 0) + r.differenceNzd;
  return {
    counted: rows.filter((r) => r.counted != null).length,
    total: rows.length,
    changed: rows.filter((r) => r.difference != null && r.difference !== 0).length,
    invalid: rows.filter((r) => parseCount(counts[r.item.id] ?? '') === 'invalid').map((r) => r.item.name),
    netNzd: netNzd == null ? null : Math.round(netNzd * 100) / 100,
  };
}

/** Item history for the item dialog, newest first: batches in, damage and recounts. */
export type StockHistoryEntry =
  | { kind: 'batch'; id: string; date: string; createdAt: string; quantity: number; unitCostNzd: number; landedNzd: number; notes: string }
  | { kind: 'damage'; id: string; date: string; createdAt: string; quantity: number; reason: string }
  | { kind: 'recount'; id: string; date: string; createdAt: string; counted: number; reason: string };

export function stockHistory(item: StockItemView): StockHistoryEntry[] {
  const list: StockHistoryEntry[] = [
    ...item.batches.map((b): StockHistoryEntry => ({ kind: 'batch', id: b.id, date: b.date, createdAt: b.createdAt, quantity: b.quantity, unitCostNzd: b.unitCostNzd, landedNzd: b.landedNzd, notes: b.notes })),
    ...item.adjustments.map((a): StockHistoryEntry =>
      a.kind === 'damage'
        ? { kind: 'damage', id: a.id, date: a.date, createdAt: a.createdAt, quantity: a.quantityLost, reason: a.reason }
        : { kind: 'recount', id: a.id, date: a.date, createdAt: a.createdAt, counted: a.countedQuantity, reason: a.reason },
    ),
  ];
  return list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}
