/**
 * Sales page helpers (KAN-123): the new-sale form's lines and totals, the save hint, the request
 * body, and short labels. Prices left blank use the item's sell price, as the server does
 * (server/business/sales.ts); an item with no sell price needs one typed in.
 */
import type { SaleWriteBody } from '../api/client.ts';
import type { BusinessSale } from '../types/index.ts';

export type SaleItemOption = { id: string; name: string; sellPriceNzd: number | null; archived: boolean };
export type SaleDraftLine = { itemId: string; quantity: string; price: string };
export type SaleDraft = { date: string; clientId: string; notes: string; lines: SaleDraftLine[] };

const num = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function blankLine(): SaleDraftLine {
  return { itemId: '', quantity: '1', price: '' };
}

/** Each line's price (typed, or the item's sell price) and total; null where it can't be worked out yet. */
export function draftLines(draft: SaleDraft, items: Map<string, SaleItemOption>) {
  return draft.lines.map((l) => {
    const qty = num(l.quantity);
    const typed = num(l.price);
    const item = items.get(l.itemId);
    const price = typed == null ? (item?.sellPriceNzd ?? null) : typed;
    const ok = qty != null && !Number.isNaN(qty) && qty > 0 && price != null && !Number.isNaN(price) && price >= 0;
    return { line: l, item, qty, price: price != null && !Number.isNaN(price) ? price : null, usesSellPrice: typed == null && price != null, totalNzd: ok ? round2(qty! * price!) : null };
  });
}

export function draftTotal(draft: SaleDraft, items: Map<string, SaleItemOption>): number {
  return round2(draftLines(draft, items).reduce((s, l) => s + (l.totalNzd ?? 0), 0));
}

/** Why the sale can't be saved yet; null when it can. */
export function saleHint(draft: SaleDraft, items: Map<string, SaleItemOption>, today: string): string | null {
  if (!draft.lines.length) return 'Add an item';
  if (!draft.date) return 'Pick the date of the sale';
  if (draft.date > today) return 'The date can’t be in the future';
  for (const [i, l] of draftLines(draft, items).entries()) {
    const n = i + 1;
    if (!l.item) return `Line ${n}: pick an item`;
    if (l.qty == null || Number.isNaN(l.qty) || l.qty <= 0) return `Line ${n}: enter a quantity`;
    if (l.price == null) return `Line ${n}: ${l.item.name} has no sell price, so enter the price charged`;
    if (l.price < 0) return `Line ${n}: the price can’t be negative`;
  }
  return null;
}

export function saleBody(draft: SaleDraft): SaleWriteBody {
  return {
    date: draft.date,
    clientId: draft.clientId || null,
    invoiceId: null,
    transactionId: null,
    notes: draft.notes.trim(),
    lines: draft.lines.map((l) => {
      const p = num(l.price);
      return { itemId: l.itemId, quantity: Number(l.quantity), unitPriceNzd: p == null || Number.isNaN(p) ? null : p };
    }),
  };
}

/** A saved sale back into the form, for editing. */
export function saleDraft(sale: BusinessSale | null, today: string): SaleDraft {
  if (!sale) return { date: today, clientId: '', notes: '', lines: [blankLine()] };
  return {
    date: sale.date,
    clientId: sale.clientId ?? '',
    notes: sale.notes,
    lines: sale.lines.map((l) => ({ itemId: l.itemId, quantity: String(l.quantity), price: String(l.unitPriceNzd) })),
  };
}

/** "Receipt RCT-0004", "Receipt uploaded", or "No receipt". */
export function receiptLabel(sale: BusinessSale): string {
  if (sale.receipt?.kind === 'issued') return `Receipt ${sale.receipt.number}`;
  if (sale.receipt?.kind === 'uploaded') return 'Receipt uploaded';
  return 'No receipt';
}

/** How the sale counts: on its own, or through its invoice or bank deposit. */
export function incomeNote(sale: BusinessSale): string {
  if (sale.invoiceId) return `Counted through invoice ${sale.invoiceNumber ?? ''}`.trim();
  if (sale.transactionId) return 'Paid into the bank (the deposit isn’t counted again)';
  return 'Counted as income on the day';
}

/** Items the form can offer: active ones, plus any already on the sale being edited. */
export function itemOptions(items: SaleItemOption[], editing: BusinessSale | null): SaleItemOption[] {
  const kept = new Set(editing?.lines.map((l) => l.itemId) ?? []);
  return items.filter((i) => !i.archived || kept.has(i.id)).sort((a, b) => a.name.localeCompare(b.name));
}
