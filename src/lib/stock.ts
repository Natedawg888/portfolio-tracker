/**
 * Business stock (KAN-107): landed cost, on-hand and weighted average cost, derived from the
 * records on every read and never stored. Pure: no db, no clock. The server store loads one
 * business's rows, parses them into these types and calls replayStock once per item.
 *
 * Dates are 'YYYY-MM-DD' and compare as strings. Money is NZD.
 */
import { roundMoney } from './debtModel.ts';
import { roundQty } from './business.ts';

export type Ymd = string;

export const STOCK_UNITS = ['each', 'kg', 'L'] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];
export const isStockUnit = (v: unknown): v is StockUnit => (STOCK_UNITS as readonly unknown[]).includes(v);

export interface StockItem {
  id: string;
  businessId: string;
  name: string;
  sku: string;
  unit: StockUnit;
  /** Per unit, as entered. null = not set, so margin is unknown (never guessed). */
  sellPriceNzd: number | null;
  /** null = no reorder level, so the bar is never amber or red. */
  reorderLevel: number | null;
  photoUrl: string | null;
  notes: string;
  /** Archived: off the chart and out of new sales; still in history and business value. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StockBatch {
  id: string;
  itemId: string;
  date: Ymd;
  quantity: number;
  /** Per unit, before delivery. Landed cost adds capitalised freight (landedCosts). */
  unitCostNzd: number;
  notes: string;
  createdAt: string;
}

/** Damage removes a quantity. A recount sets on-hand to what was counted at the end of that day. */
export type StockAdjustment = { id: string; itemId: string; date: Ymd; reason: string; createdAt: string } & (
  | { kind: 'damage'; quantityLost: number }
  | { kind: 'recount'; countedQuantity: number }
);

/** A sale line with its sale's date and createdAt, which order it among the item's events. */
export interface StockSaleLine {
  id: string;
  saleId: string;
  itemId: string;
  quantity: number;
  unitPriceNzd: number;
  date: Ymd;
  createdAt: string;
}

/** The parts of a supplier bill that bear on stock cost. */
export interface SupplierInvoiceCost {
  id: string;
  kind: 'stock' | 'delivery';
  amountNzd: number;
  deliveryNzd: number;
  deliveryTreatment: 'capitalise' | 'expense';
  batchIds: string[];
}

/** Freight part of a bill: all of a delivery bill, the freight line of a goods bill. */
export function deliveryPart(inv: SupplierInvoiceCost): number {
  return inv.kind === 'delivery' ? inv.amountNzd : inv.deliveryNzd;
}

/**
 * Freight that goes into stock cost. Capitalised freight with no linked batches has nowhere to
 * go, so it is 0 here and the money ledger counts it as an expense instead.
 */
export function capitalisedDelivery(inv: SupplierInvoiceCost): number {
  return inv.deliveryTreatment === 'capitalise' && inv.batchIds.length > 0 ? deliveryPart(inv) : 0;
}

/**
 * Landed cost per batch: quantity × unit cost plus its share of each capitalised freight amount
 * that covers it. Freight is split across its batches by goods value, since kg and each don't
 * add; if every covered batch has goods value 0, it is split equally.
 */
export function landedCosts(batches: StockBatch[], invoices: SupplierInvoiceCost[]): Map<string, number> {
  const goods = new Map(batches.map((b) => [b.id, b.quantity * b.unitCostNzd]));
  const landed = new Map(goods);
  for (const inv of invoices) {
    const freight = capitalisedDelivery(inv);
    const covered = [...new Set(inv.batchIds)].filter((id) => goods.has(id));
    if (!freight || !covered.length) continue;
    const value = covered.reduce((s, id) => s + goods.get(id)!, 0);
    for (const id of covered) {
      const share = value > 0 ? goods.get(id)! / value : 1 / covered.length;
      landed.set(id, landed.get(id)! + freight * share);
    }
  }
  return landed;
}

export interface ItemHistory {
  batches: StockBatch[];
  /** From landedCosts, keyed by batch id. */
  landed: Map<string, number>;
  adjustments: StockAdjustment[];
  saleLines: StockSaleLine[];
}

export interface StockLedger {
  /** Batches in − sold − damaged, reset by recounts. Negative = oversold (allowed, flagged). */
  onHand: number;
  /** Moving weighted average landed cost per unit. null = no batch yet. */
  wacNzd: number | null;
  /** Cost of each sale line at the WAC when it sold. null = no batch before it. */
  lineCost: Map<string, number | null>;
  /** Cost of stock lost (+) or found (−) by each adjustment, at the WAC then. */
  adjustmentCost: Map<string, number | null>;
  /** When the current oversold run began; null when on-hand is 0 or more. */
  oversoldSince: Ymd | null;
}

type StockEvent =
  | { rank: 0; kind: 'batch'; date: Ymd; createdAt: string; id: string; quantity: number; landedNzd: number }
  | { rank: 1; kind: 'sale'; date: Ymd; createdAt: string; id: string; quantity: number }
  | { rank: 1; kind: 'damage'; date: Ymd; createdAt: string; id: string; quantity: number }
  | { rank: 2; kind: 'recount'; date: Ymd; createdAt: string; id: string; counted: number };

function events(h: ItemHistory): StockEvent[] {
  const list: StockEvent[] = [
    ...h.batches.map((b): StockEvent => ({ rank: 0, kind: 'batch', date: b.date, createdAt: b.createdAt, id: b.id, quantity: b.quantity, landedNzd: h.landed.get(b.id) ?? b.quantity * b.unitCostNzd })),
    ...h.saleLines.map((l): StockEvent => ({ rank: 1, kind: 'sale', date: l.date, createdAt: l.createdAt, id: l.id, quantity: l.quantity })),
    ...h.adjustments.map((a): StockEvent =>
      a.kind === 'damage'
        ? { rank: 1, kind: 'damage', date: a.date, createdAt: a.createdAt, id: a.id, quantity: a.quantityLost }
        : { rank: 2, kind: 'recount', date: a.date, createdAt: a.createdAt, id: a.id, counted: a.countedQuantity },
    ),
  ];
  // A recount is the end-of-day count, so it comes after that day's batches, sales and damage.
  return list.sort(
    (a, b) => a.date.localeCompare(b.date) || a.rank - b.rank || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/**
 * Replays one item's events in order: date, then batch < sale = damage < recount, then
 * createdAt, then id.
 *   batch:   if on-hand <= 0 or no WAC yet, WAC := landed unit cost (an oversold item restarts
 *            from this batch); else WAC := (onHand·WAC + landed) / (onHand + q). onHand += q.
 *   sale:    cost := q·WAC; onHand −= q.
 *   damage:  cost := q·WAC; onHand −= q.
 *   recount: cost := (onHand − counted)·WAC; onHand := counted.
 */
export function replayStock(h: ItemHistory): StockLedger {
  let onHand = 0;
  let wac: number | null = null;
  let oversoldSince: Ymd | null = null;
  const lineCost = new Map<string, number | null>();
  const adjustmentCost = new Map<string, number | null>();
  const costOf = (q: number) => (wac == null ? (q === 0 ? 0 : null) : q * wac);
  for (const e of events(h)) {
    if (e.kind === 'batch') {
      const unit = e.landedNzd / e.quantity;
      wac = onHand <= 0 || wac == null ? unit : (onHand * wac + e.landedNzd) / (onHand + e.quantity);
      onHand = roundQty(onHand + e.quantity);
    } else if (e.kind === 'sale') {
      lineCost.set(e.id, costOf(e.quantity));
      onHand = roundQty(onHand - e.quantity);
    } else if (e.kind === 'damage') {
      adjustmentCost.set(e.id, costOf(e.quantity));
      onHand = roundQty(onHand - e.quantity);
    } else {
      adjustmentCost.set(e.id, costOf(roundQty(onHand - e.counted)));
      onHand = e.counted;
    }
    if (onHand >= 0) oversoldSince = null;
    else oversoldSince ??= e.date;
  }
  return { onHand, wacNzd: wac, lineCost, adjustmentCost, oversoldSince };
}

export type StockLevel = 'ok' | 'low' | 'out' | 'oversold' | 'untracked';

export interface StockPosition {
  onHand: number;
  /** Per unit, to 4 decimal places (a unit can cost a fraction of a cent). */
  wacNzd: number | null;
  /** max(onHand, 0) × WAC. What businessValue adds: cost, never sell price. */
  valueNzd: number | null;
  sellPriceNzd: number | null;
  /** max(onHand, 0) × sell price. */
  sellValueNzd: number | null;
  marginPerUnitNzd: number | null;
  marginTotalNzd: number | null;
  /**
   * oversold: on-hand below 0, flagged with or without a reorder level. untracked: no reorder
   * level. out: 0 (red). low: at or below the reorder level (amber). ok: above it.
   */
  level: StockLevel;
  oversoldSince: Ymd | null;
}

const perUnit = (n: number) => Math.round(n * 10_000) / 10_000;

function level(onHand: number, reorderLevel: number | null): StockLevel {
  if (onHand < 0) return 'oversold';
  if (reorderLevel == null) return 'untracked';
  if (onHand === 0) return 'out';
  return onHand <= reorderLevel ? 'low' : 'ok';
}

export function stockPosition(item: StockItem, ledger: StockLedger): StockPosition {
  const held = Math.max(ledger.onHand, 0);
  const { wacNzd: wac } = ledger;
  const sell = item.sellPriceNzd;
  const margin = sell != null && wac != null ? sell - wac : null;
  return {
    onHand: ledger.onHand,
    wacNzd: wac == null ? null : perUnit(wac),
    valueNzd: wac == null ? null : roundMoney(held * wac),
    sellPriceNzd: sell,
    sellValueNzd: sell == null ? null : roundMoney(held * sell),
    marginPerUnitNzd: margin == null ? null : perUnit(margin),
    marginTotalNzd: margin == null ? null : roundMoney(held * margin),
    level: level(ledger.onHand, item.reorderLevel),
    oversoldSince: ledger.oversoldSince,
  };
}

/** Archive rule: an archived item is off the chart. Restoring puts it back with its history. */
export function onChart(item: StockItem): boolean {
  return item.archivedAt == null;
}

/**
 * Archive rule for sales. A new line can't use an archived item. A sale being edited may keep a
 * line for an item that was archived after it was made (the line is history), but can't add one.
 */
export function checkSaleItems(
  lines: { itemId: string }[],
  items: Map<string, StockItem>,
  editing: { lines: { itemId: string }[] } | null,
): { ok: true } | { ok: false; archived: StockItem[]; missing: string[] } {
  const kept = new Set(editing?.lines.map((l) => l.itemId) ?? []);
  const archived = new Map<string, StockItem>();
  const missing = new Set<string>();
  for (const { itemId } of lines) {
    const item = items.get(itemId);
    if (!item) missing.add(itemId);
    else if (!onChart(item) && !kept.has(itemId)) archived.set(itemId, item);
  }
  return archived.size || missing.size ? { ok: false, archived: [...archived.values()], missing: [...missing] } : { ok: true };
}

/** One item as the Stock API returns it. */
export interface StockItemView extends StockItem {
  position: StockPosition;
  onChart: boolean;
  /** Newest first, with each batch's landed cost (goods plus capitalised freight). */
  batches: (StockBatch & { landedNzd: number })[];
  adjustments: StockAdjustment[];
}
