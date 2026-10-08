/**
 * Invoice maths shared by the editor preview, the API and the PDF (KAN-71).
 * Money is NZD rounded to cents. GST rate comes from the tax-year config (payeRates.ts).
 *
 * GST modes:
 * - none:      not GST registered. Total = sum of lines.
 * - exclusive: line prices exclude GST. GST = 15% of the subtotal, added on top.
 * - inclusive: line prices include GST. GST = total × 15/115 (the GST fraction), backed out.
 * Withholding (schedular payments, KAN-70) is on the GST-exclusive subtotal and is
 * deducted from what the client pays you; the client pays it to IRD.
 */

import { UNIT_PRESETS } from './outputPayCalc';
import { payTaxYearRates } from './payeRates';

export type GstMode = 'none' | 'exclusive' | 'inclusive';

export type InvoiceLineInput = {
  description: string;
  quantity: number;
  unit: string;
  rate: number;
};

export type InvoiceTotals = {
  lineTotals: number[];
  /** GST-exclusive amount. */
  subtotal: number;
  gst: number;
  /** GST-inclusive amount. */
  total: number;
  withholdingRatePct: number;
  /** Withholding on the GST-exclusive subtotal. */
  withholding: number;
  /** What the client pays you: total − withholding. */
  amountDue: number;
};

export type DuePreset = 'on_receipt' | 'days_7' | 'days_14' | 'next_month_20' | 'days_30' | 'custom';

export const DUE_PRESETS: { value: DuePreset; label: string }[] = [
  { value: 'on_receipt', label: 'On receipt' },
  { value: 'days_7', label: '7 days' },
  { value: 'days_14', label: '14 days' },
  { value: 'next_month_20', label: '20th of next month' },
  { value: 'days_30', label: '30 days' },
  { value: 'custom', label: 'Pick a date' },
];

/** Stored status. Partly paid, paid and overdue are worked out from payments and dates. */
export type InvoiceStoredStatus = 'draft' | 'sent' | 'void';
export type InvoiceStatus = 'draft' | 'sent' | 'partly_paid' | 'paid' | 'overdue' | 'void';

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partly_paid: 'Partly paid',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
};

/** KAN-70 unit presets plus time-based units for hourly / day-rate work. */
export const INVOICE_UNIT_PRESETS = [
  { group: 'Time', units: ['hour', 'day'] },
  ...UNIT_PRESETS,
] as const;

export function roundCents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function finite(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

export function lineTotal(line: Pick<InvoiceLineInput, 'quantity' | 'rate'>): number {
  return roundCents(finite(line.quantity) * finite(line.rate));
}

export function invoiceTotals(
  lines: Pick<InvoiceLineInput, 'quantity' | 'rate'>[],
  gstMode: GstMode,
  withholdingRatePct: number | null = null,
  gstRate: number = payTaxYearRates().gstRate,
): InvoiceTotals {
  const lineTotals = lines.map(lineTotal);
  const sum = roundCents(lineTotals.reduce((s, n) => s + n, 0));
  let subtotal: number;
  let gst: number;
  let total: number;
  if (gstMode === 'exclusive') {
    subtotal = sum;
    gst = roundCents(sum * gstRate);
    total = roundCents(subtotal + gst);
  } else if (gstMode === 'inclusive') {
    total = sum;
    gst = roundCents((sum * gstRate) / (1 + gstRate));
    subtotal = roundCents(total - gst);
  } else {
    subtotal = sum;
    gst = 0;
    total = sum;
  }
  const wtPct = Math.min(100, Math.max(0, finite(withholdingRatePct)));
  const withholding = roundCents((subtotal * wtPct) / 100);
  return {
    lineTotals,
    subtotal,
    gst,
    total,
    withholdingRatePct: wtPct,
    withholding,
    amountDue: roundCents(total - withholding),
  };
}

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

export function isYmd(text: unknown): text is string {
  return typeof text === 'string' && parseYmd(text) != null;
}

function ymd(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const p = parseYmd(date);
  if (!p) return date;
  return ymd(new Date(Date.UTC(p.y, p.m - 1, p.d + days)));
}

/** Due date for a preset. Custom keeps the given date (or the issue date). */
export function dueDateForPreset(issueDate: string, preset: DuePreset, custom?: string | null): string {
  const p = parseYmd(issueDate);
  if (!p) return issueDate;
  switch (preset) {
    case 'on_receipt':
      return issueDate;
    case 'days_7':
      return addDays(issueDate, 7);
    case 'days_14':
      return addDays(issueDate, 14);
    case 'days_30':
      return addDays(issueDate, 30);
    case 'next_month_20':
      return ymd(new Date(Date.UTC(p.y, p.m, 20)));
    case 'custom':
      return custom && isYmd(custom) ? custom : issueDate;
  }
}

/** Status shown to the user. Overdue wins over partly paid once the due date has passed. */
export function invoiceStatus(input: {
  stored: InvoiceStoredStatus;
  amountDue: number;
  paid: number;
  dueDate: string;
  today: string;
}): InvoiceStatus {
  if (input.stored === 'void') return 'void';
  if (input.stored === 'draft') return 'draft';
  const balance = roundCents(input.amountDue - input.paid);
  if (balance <= 0) return 'paid';
  if (input.today > input.dueDate) return 'overdue';
  if (input.paid > 0) return 'partly_paid';
  return 'sent';
}

export const DEFAULT_INVOICE_PREFIX = 'INV-';

/**
 * Next number after the highest numeric suffix used with this prefix: INV-0007 → INV-0008.
 * Numbers that don't share the prefix (e.g. hand-typed "A12") are ignored, so the
 * sequence carries on from the user's own numbering.
 */
export function nextInvoiceNumber(existing: string[], prefix: string = DEFAULT_INVOICE_PREFIX): string {
  let max = 0;
  let width = 4;
  const lowerPrefix = prefix.toLowerCase();
  for (const raw of existing) {
    const n = raw.trim();
    if (!n.toLowerCase().startsWith(lowerPrefix)) continue;
    const rest = n.slice(prefix.length);
    if (!/^\d+$/.test(rest)) continue;
    const value = Number(rest);
    if (value > max) max = value;
    width = Math.max(width, rest.length);
  }
  return `${prefix}${String(max + 1).padStart(width, '0')}`;
}

/** Case- and space-insensitive key so "inv-1" and "INV-1 " count as the same number. */
export function invoiceNumberKey(number: string): string {
  return number.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Basic address check for invoice recipients (length-limited, one @, a dot in the domain). */
export function isValidEmail(text: string): boolean {
  const s = text.trim();
  if (s.length < 3 || s.length > 254) return false;
  return /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]{2,}$/.test(s);
}
