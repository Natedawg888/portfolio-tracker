/**
 * Pure view rules for the Invoices list (phase 1) and the invoice builder (phase 2).
 * Totals, counts, and tax-year start come from the list response.
 * Line amounts, GST, and amount due come from invoiceTotals. Due dates come from dueDateForPreset.
 * Business completeness is derived from the profile; nothing is stored or invented.
 */
import {
  dueDateForPreset,
  invoiceTotals,
  type DuePreset,
  type GstMode,
  type InvoiceLineInput,
  type InvoiceTotals,
} from '../lib/invoiceCalc';
import type { BusinessProfile } from '../types';

/** Settings → Business. Matches the tab read in Settings.tsx. */
export const BUSINESS_SETTINGS_HREF = '/settings?tab=business';

export type BusinessDetails = Pick<BusinessProfile, 'businessName' | 'bankAccount' | 'gstRegistered' | 'gstNumber'>;

/** Cards on the list, in order. Values are the list response totals; labels are the only words added here. */
export const INVOICE_TOTALS: Array<{
  id: 'outstanding' | 'overdue' | 'paidMonth' | 'paidTaxYear';
  label: string;
  field: 'outstandingNzd' | 'overdueNzd' | 'paidThisMonthNzd' | 'paidTaxYearNzd';
}> = [
  { id: 'outstanding', label: 'Awaiting payment', field: 'outstandingNzd' },
  { id: 'overdue', label: 'Overdue', field: 'overdueNzd' },
  { id: 'paidMonth', label: 'Paid this month', field: 'paidThisMonthNzd' },
  { id: 'paidTaxYear', label: 'Paid this tax year', field: 'paidTaxYearNzd' },
];

function filled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function countOf(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * Business details are complete when the profile has a name, a bank account,
 * and a GST number if the business is GST registered.
 * A prefilled name with an empty bank account is not complete. No profile is not complete.
 */
export function businessComplete(profile: BusinessDetails | null | undefined): boolean {
  if (!profile) return false;
  if (!filled(profile.businessName) || !filled(profile.bankAccount)) return false;
  if (profile.gstRegistered && !filled(profile.gstNumber)) return false;
  return true;
}

function joinMissing(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Words before the Settings → Business link when details are missing.
 * Names the gap only. Null when the profile is already complete.
 * Does not repeat a saved name or any other stored detail.
 */
export function businessPromptLead(profile: BusinessDetails | null | undefined): string | null {
  if (businessComplete(profile)) return null;
  if (!profile) return 'Add your business details in';
  const missing: string[] = [];
  if (!filled(profile.businessName)) missing.push('your name');
  if (!filled(profile.bankAccount)) missing.push('a bank account');
  if (profile.gstRegistered && !filled(profile.gstNumber)) missing.push('your GST number');
  if (missing.length === 0) return 'Add your business details in';
  return `Add ${joinMissing(missing)} in`;
}

/** Format a YYYY-MM-DD that was returned. Anything else is shown unchanged, not replaced. */
export function formatInvoiceDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(`${ymd}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return ymd;
  }
  return new Intl.DateTimeFormat('en-NZ', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** One line under the title once invoices exist. Null when there are none, so no date is invented. */
export function invoicesSubtitle(invoiceCount: number, taxYearStart: string | null | undefined): string | null {
  const count = countOf(invoiceCount);
  if (count <= 0) return null;
  const head = count === 1 ? '1 invoice' : `${count} invoices`;
  const start = typeof taxYearStart === 'string' ? taxYearStart.trim() : '';
  if (!start) return head;
  return `${head} · tax year from ${formatInvoiceDate(start)}`;
}

export type InvoicesChrome = {
  showTotals: boolean;
  showFilters: boolean;
  showCsv: boolean;
  showClients: boolean;
  showChecklist: boolean;
  subtitle: string | null;
};

/**
 * How many invoices the chrome should trust.
 * A filtered list can be empty while invoices still exist, and the previous
 * filtered payload is still on screen until the next response arrives.
 * Pass catalogCount from the last unfiltered response. Null until that exists.
 */
export function visibleInvoiceCount(input: {
  filteredCount: number | null;
  catalogCount: number | null;
  filtersActive: boolean;
  responseCurrent: boolean;
}): number | null {
  const catalog = input.catalogCount == null ? null : countOf(input.catalogCount);
  const filtered = input.filteredCount == null ? null : countOf(input.filteredCount);
  if (input.filtersActive) return catalog;
  if (!input.responseCurrent) return catalog ?? filtered;
  return filtered;
}

/** What the list page shows. Counts are the caller's; this does not look at filtered rows. */
export function invoicesChrome(input: {
  invoiceCount: number;
  clientCount: number;
  taxYearStart?: string | null;
}): InvoicesChrome {
  const invoices = countOf(input.invoiceCount);
  const clients = countOf(input.clientCount);
  const hasInvoices = invoices > 0;
  return {
    showTotals: hasInvoices,
    showFilters: hasInvoices,
    showCsv: hasInvoices,
    showClients: hasInvoices || clients > 0,
    showChecklist: !hasInvoices,
    subtitle: invoicesSubtitle(invoices, input.taxYearStart),
  };
}

export type InvoiceSetupStepId = 'business' | 'client' | 'invoice';

export type InvoiceSetupStep = {
  id: InvoiceSetupStepId;
  title: string;
  done: boolean;
  /** Lead-in before the Settings link. Only set on the business step while it is open. */
  promptLead: string | null;
};

/** Checklist shown only while there are no invoices. Step 3 stays open: an invoice would hide the list. */
export function invoiceSetupSteps(input: {
  business: BusinessDetails | null | undefined;
  clientCount: number;
}): InvoiceSetupStep[] {
  const businessDone = businessComplete(input.business);
  return [
    {
      id: 'business',
      title: 'Business details',
      done: businessDone,
      promptLead: businessDone ? null : businessPromptLead(input.business),
    },
    {
      id: 'client',
      title: 'Add a client',
      done: countOf(input.clientCount) > 0,
      promptLead: null,
    },
    {
      id: 'invoice',
      title: 'Create the invoice',
      done: false,
      promptLead: null,
    },
  ];
}

/**
 * One-tap due dates on the builder. On receipt and 30 days stay valid presets
 * (dueDateForPreset still resolves them) and are left off this row.
 */
export const DUE_TAP_PRESETS: Array<{ value: Extract<DuePreset, 'days_7' | 'days_14' | 'next_month_20' | 'custom'>; label: string }> = [
  { value: 'days_7', label: '7 days' },
  { value: 'days_14', label: '14 days' },
  { value: 'next_month_20', label: '20th of next month' },
  { value: 'custom', label: 'Custom' },
];

/** Due date shown in the builder. Custom uses the picked date; other presets ignore it. */
export function editorDueDate(issueDate: string, preset: DuePreset, custom?: string | null): string {
  return dueDateForPreset(issueDate, preset, custom);
}

/** Why Save draft and Mark as sent stay disabled. Null when a client and a positive subtotal are both present. */
export function invoiceActionBlock(input: { clientName: string; subtotal: number }): string | null {
  const hasClient = typeof input.clientName === 'string' && input.clientName.trim().length > 0;
  const hasAmount = typeof input.subtotal === 'number' && Number.isFinite(input.subtotal) && input.subtotal > 0;
  if (hasClient && hasAmount) return null;
  if (!hasClient && !hasAmount) return 'Add a client and a line amount to save or mark as sent.';
  if (!hasClient) return 'Add a client to save or mark as sent.';
  return 'Add a line amount to save or mark as sent.';
}

export type GstEditorControl =
  | { kind: 'hidden' }
  | { kind: 'checkbox'; checked: boolean }
  | { kind: 'preserved'; mode: GstMode };

/**
 * GST 15% checkbox. Hidden until the profile has loaded and only when the business is GST registered.
 * Checked maps to exclusive; unchecked maps to none. An inclusive draft keeps that choice so the
 * checkbox cannot rewrite it.
 */
export function gstEditorControl(input: {
  /** True, false, or null when the business profile has not loaded. */
  gstRegistered: boolean | null;
  gstMode: GstMode;
  inclusiveDraft: boolean;
}): GstEditorControl {
  if (input.gstRegistered !== true) return { kind: 'hidden' };
  if (input.inclusiveDraft || input.gstMode === 'inclusive') return { kind: 'preserved', mode: input.gstMode };
  return { kind: 'checkbox', checked: input.gstMode === 'exclusive' };
}

/** Checkbox on → prices exclude GST. Checkbox off → no GST. */
export function gstModeFromCheckbox(checked: boolean): GstMode {
  return checked ? 'exclusive' : 'none';
}

/**
 * GST mode the builder previews and saves.
 * Unknown and non-registered profiles stay on none, so GST is not defaulted on for them.
 * A registered business keeps exclusive, none, or an already-saved inclusive mode.
 */
export function editorGstMode(gstRegistered: boolean | null, gstMode: GstMode): GstMode {
  if (gstRegistered !== true) return 'none';
  return gstMode;
}

/** Line amount, subtotal, GST, and amount due. Amount due already subtracts withholding. */
export function editorInvoiceTotals(
  lines: Pick<InvoiceLineInput, 'quantity' | 'rate'>[],
  gstMode: GstMode,
  withholdingRatePct: number | null,
): InvoiceTotals {
  return invoiceTotals(lines, gstMode, withholdingRatePct);
}
