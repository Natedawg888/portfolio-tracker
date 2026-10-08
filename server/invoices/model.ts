/**
 * Validate invoice request bodies (KAN-71). Totals are never taken from the client;
 * the store recomputes them from the lines with src/lib/invoiceCalc.ts.
 */
import {
  DUE_PRESETS,
  isValidEmail,
  isYmd,
  type DuePreset,
  type GstMode,
  type InvoiceLineInput,
} from '../../src/lib/invoiceCalc.ts';
import type { BusinessProfile } from '../../src/types/index.ts';

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_LINES = 200;
export const MAX_RECIPIENTS = 10;
const MAX_MONEY = 100_000_000;

function obj(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function text(o: Record<string, unknown>, key: string, max: number): string {
  const v = o[key];
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** Multi-line text: keep line breaks, trim each end, cap length. */
function longText(o: Record<string, unknown>, key: string, max: number): string {
  const v = o[key];
  return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '';
}

function money(raw: unknown, label: string, allowNegative = false): Parsed<number> {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : 0;
  if (!Number.isFinite(n) || Math.abs(n) > MAX_MONEY || (!allowNegative && n < 0)) {
    return { ok: false, error: `${label} must be a number${allowNegative ? '' : ' of 0 or more'}` };
  }
  return { ok: true, value: n };
}

export function parseBusinessProfile(raw: unknown): Parsed<BusinessProfile> {
  const o = obj(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  const email = text(o, 'email', 254);
  if (email && !isValidEmail(email)) return { ok: false, error: 'Email address is not valid' };
  const gstRegistered = o.gstRegistered === true;
  const gstNumber = text(o, 'gstNumber', 20);
  if (gstRegistered && !/^\d{2,3}-?\d{3}-?\d{3}$/.test(gstNumber)) {
    return { ok: false, error: 'GST number must be 8 or 9 digits (e.g. 123-456-789)' };
  }
  const nzbn = text(o, 'nzbn', 20);
  if (nzbn && !/^\d{13}$/.test(nzbn)) return { ok: false, error: 'NZBN must be 13 digits' };
  const prefix = text(o, 'invoicePrefix', 12) || 'INV-';
  if (/\d$/.test(prefix)) return { ok: false, error: 'Invoice prefix cannot end in a digit' };
  return {
    ok: true,
    value: {
      businessName: text(o, 'businessName', 120),
      address: longText(o, 'address', 400),
      email,
      phone: text(o, 'phone', 40),
      bankAccount: text(o, 'bankAccount', 40),
      gstRegistered,
      gstNumber,
      nzbn,
      invoicePrefix: prefix,
    },
  };
}

export type ClientDraft = { name: string; email: string; address: string; reference: string };

export function parseClient(raw: unknown): Parsed<ClientDraft> {
  const o = obj(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  const name = text(o, 'name', 120);
  if (!name) return { ok: false, error: 'Client name is required' };
  const email = text(o, 'email', 254);
  if (email && !isValidEmail(email)) return { ok: false, error: 'Client email is not valid' };
  return {
    ok: true,
    value: { name, email, address: longText(o, 'address', 400), reference: text(o, 'reference', 80) },
  };
}

export type InvoiceDraft = {
  number: string | null;
  clientId: string | null;
  clientName: string;
  clientEmail: string;
  clientAddress: string;
  clientReference: string;
  issueDate: string;
  duePreset: DuePreset;
  dueDate: string | null;
  reference: string;
  gstMode: GstMode;
  withholdingRatePct: number | null;
  notes: string;
  paymentInstructions: string;
  lines: InvoiceLineInput[];
};

const PRESETS = new Set(DUE_PRESETS.map((p) => p.value));

export function parseInvoice(raw: unknown, today: string): Parsed<InvoiceDraft> {
  const o = obj(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  const number = text(o, 'number', 40) || null;
  if (number && /[\r\n\t]/.test(number)) return { ok: false, error: 'Invoice number has invalid characters' };
  const issueDate = o.issueDate == null || o.issueDate === '' ? today : o.issueDate;
  if (!isYmd(issueDate)) return { ok: false, error: 'Issue date must be YYYY-MM-DD' };
  const duePreset = (typeof o.duePreset === 'string' && PRESETS.has(o.duePreset as DuePreset)
    ? o.duePreset
    : 'days_14') as DuePreset;
  const dueDate = o.dueDate == null || o.dueDate === '' ? null : o.dueDate;
  if (dueDate != null && !isYmd(dueDate)) return { ok: false, error: 'Due date must be YYYY-MM-DD' };
  if (duePreset === 'custom' && dueDate != null && dueDate < issueDate) {
    return { ok: false, error: 'Due date cannot be before the issue date' };
  }
  const gstMode: GstMode = o.gstMode === 'exclusive' || o.gstMode === 'inclusive' ? o.gstMode : 'none';
  let withholdingRatePct: number | null = null;
  if (o.withholdingRatePct != null && o.withholdingRatePct !== '') {
    const w = Number(o.withholdingRatePct);
    if (!Number.isFinite(w) || w < 0 || w > 100) return { ok: false, error: 'Withholding rate must be 0–100%' };
    withholdingRatePct = w > 0 ? Math.round(w * 10) / 10 : null;
  }
  const clientEmail = text(o, 'clientEmail', 254);
  if (clientEmail && !isValidEmail(clientEmail)) return { ok: false, error: 'Client email is not valid' };

  const rawLines = Array.isArray(o.lines) ? o.lines : [];
  if (rawLines.length > MAX_LINES) return { ok: false, error: `An invoice can have at most ${MAX_LINES} lines` };
  const lines: InvoiceLineInput[] = [];
  for (const [i, rawLine] of rawLines.entries()) {
    const l = obj(rawLine);
    if (!l) return { ok: false, error: `Line ${i + 1} is not valid` };
    const quantity = money(l.quantity, `Line ${i + 1} quantity`, true);
    if (!quantity.ok) return quantity;
    const rate = money(l.rate, `Line ${i + 1} rate`, true);
    if (!rate.ok) return rate;
    const description = longText(l, 'description', 500);
    if (!description && quantity.value === 0 && rate.value === 0) continue; // blank row
    lines.push({ description, quantity: quantity.value, unit: text(l, 'unit', 40), rate: rate.value });
  }

  return {
    ok: true,
    value: {
      number,
      clientId: typeof o.clientId === 'string' && o.clientId.trim() ? o.clientId.trim() : null,
      clientName: text(o, 'clientName', 120),
      clientEmail,
      clientAddress: longText(o, 'clientAddress', 400),
      clientReference: text(o, 'clientReference', 80),
      issueDate,
      duePreset,
      dueDate,
      reference: text(o, 'reference', 80),
      gstMode,
      withholdingRatePct,
      notes: longText(o, 'notes', 2000),
      paymentInstructions: longText(o, 'paymentInstructions', 1000),
      lines,
    },
  };
}

export type PaymentDraft = { date: string; amountNzd: number; method: string; notes: string; addToIncome: boolean };

export function parsePayment(raw: unknown, today: string): Parsed<PaymentDraft> {
  const o = obj(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  const date = o.date == null || o.date === '' ? today : o.date;
  if (!isYmd(date)) return { ok: false, error: 'Payment date must be YYYY-MM-DD' };
  const amount = money(o.amountNzd, 'Amount');
  if (!amount.ok) return amount;
  if (!(amount.value > 0)) return { ok: false, error: 'Amount must be more than 0' };
  return {
    ok: true,
    value: {
      date,
      amountNzd: Math.round(amount.value * 100) / 100,
      method: text(o, 'method', 40),
      notes: text(o, 'notes', 200),
      addToIncome: o.addToIncome !== false,
    },
  };
}

export type SendDraft = { to: string[]; subject: string; message: string };

export function parseSend(raw: unknown): Parsed<SendDraft> {
  const o = obj(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  if (o.confirm !== true) return { ok: false, error: 'Preview the email and confirm before sending' };
  const list = Array.isArray(o.to) ? o.to : typeof o.to === 'string' ? o.to.split(/[,;\s]+/) : [];
  const to = [...new Set(list.map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : '')).filter(Boolean))];
  if (to.length === 0) return { ok: false, error: 'Add at least one recipient' };
  if (to.length > MAX_RECIPIENTS) return { ok: false, error: `At most ${MAX_RECIPIENTS} recipients per send` };
  const bad = to.find((e) => !isValidEmail(e));
  if (bad) return { ok: false, error: `${bad} is not a valid email address` };
  const subject = text(o, 'subject', 200).replace(/[\r\n]+/g, ' ');
  if (!subject) return { ok: false, error: 'Subject is required' };
  return { ok: true, value: { to, subject, message: longText(o, 'message', 5000) } };
}
