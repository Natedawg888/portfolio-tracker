/**
 * Pure view rules for the Invoices list (phase 1), the invoice builder (phase 2),
 * the list row menu and status badges (phase 3), and withholding prefill (phase 4).
 * Totals, counts, and tax-year start come from the list response.
 * Line amounts, GST, and amount due come from invoiceTotals. Due dates come from dueDateForPreset.
 * A withholding percent comes from withholdingPct only when the prefs name an IR330C activity.
 * Business completeness is derived from the profile; nothing is stored or invented.
 * A missing list value is an em dash. Status words come from the status the list returned.
 */
import {
  dueDateForPreset,
  invoiceStatus,
  invoiceTotals,
  isYmd,
  type DuePreset,
  type GstMode,
  type InvoiceLineInput,
  type InvoiceStatus,
  type InvoiceStoredStatus,
  type InvoiceTotals,
} from '../lib/invoiceCalc';
import { defaultOutputPayPrefs, withholdingPct, type OutputPayPrefs } from '../lib/outputPayPrefs';
import type { PayTaxYearRates } from '../lib/payeRates';
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

export type WithholdingPrefill = {
  /** Checkbox starts on only when a percent was taken from the prefs. */
  on: boolean;
  /** Percent for the existing withholdingRatePct. Null leaves the rate empty. */
  ratePct: number | null;
};

const WITHHOLDING_OFF: WithholdingPrefill = { on: false, ratePct: null };

/**
 * The PAYE form stores activity 3 so the dropdown has a selection. With no contract
 * rate, no volume, and no custom rate, that is still blank: it is not an activity
 * the user chose for an invoice.
 */
function untouchedSchedularDefault(prefs: OutputPayPrefs): boolean {
  const blank = defaultOutputPayPrefs();
  return (
    prefs.activity.trim() === blank.activity &&
    prefs.contractRate.trim() === '' &&
    prefs.contractVolume.trim() === '' &&
    prefs.customWtRate.trim() === ''
  );
}

/**
 * Starting "Client withholds tax" state for a new invoice.
 * The percent is withholdingPct only when the prefs name an IR330C schedular activity
 * for this tax year (a listed activity the user actually chose, or a custom rate they entered).
 * Blank prefs, a missing activity, the untouched form default, an activity that is not on
 * the IR330C list, and a custom rate left empty leave the box off and the rate empty.
 * Nothing here fills in another percent.
 */
export function editorWithholdingPrefill(
  prefs: OutputPayPrefs | null | undefined,
  rates: PayTaxYearRates,
): WithholdingPrefill {
  if (!prefs) return WITHHOLDING_OFF;
  const activity = typeof prefs.activity === 'string' ? prefs.activity.trim() : '';
  if (!activity) return WITHHOLDING_OFF;
  const named =
    activity === 'custom' || rates.schedularActivities.some((row) => String(row.number) === activity);
  if (!named) return WITHHOLDING_OFF;
  const normalized: OutputPayPrefs = {
    ...prefs,
    activity,
    customWtRate: typeof prefs.customWtRate === 'string' ? prefs.customWtRate.trim() : '',
  };
  if (activity !== 'custom' && untouchedSchedularDefault(normalized)) return WITHHOLDING_OFF;
  const ratePct = withholdingPct(normalized, rates);
  if (!(typeof ratePct === 'number' && Number.isFinite(ratePct) && ratePct > 0)) return WITHHOLDING_OFF;
  return { on: true, ratePct };
}

/**
 * You'll receive. This is amountDue from invoiceTotals: total minus withholding,
 * the figure the invoice stores. It is not worked out again here.
 * A missing or non-finite figure is null, so the summary does not invent one.
 */
export function editorReceiveAmount(totals: Pick<InvoiceTotals, 'amountDue'> | null | undefined): number | null {
  if (!totals) return null;
  const amount = totals.amountDue;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  return amount;
}

/** Shown wherever a list value is missing. Never a guessed number, date, name, or status. */
export const INVOICE_MISSING = '—';

function knownStored(status: InvoiceStoredStatus | null | undefined): status is InvoiceStoredStatus {
  return status === 'draft' || status === 'sent' || status === 'void';
}

function finiteNumber(n: number | null | undefined): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return n;
}

export type InvoiceStatusCue = 'dashed' | 'solid' | 'double' | 'check' | 'late' | 'strike';

export type InvoiceStatusBadgeModel = {
  status: InvoiceStatus;
  label: string;
  /**
   * Visible mark that is not a colour. The badge hides it from the accessible name;
   * the label is what a screen reader reads.
   */
  mark: string;
  cue: InvoiceStatusCue;
};

const STATUS_BADGES: Record<InvoiceStatus, Omit<InvoiceStatusBadgeModel, 'status'>> = {
  draft: { label: 'Draft', mark: '○', cue: 'dashed' },
  sent: { label: 'Sent', mark: '→', cue: 'solid' },
  partly_paid: { label: 'Partly paid', mark: '½', cue: 'double' },
  paid: { label: 'Paid', mark: '✓', cue: 'check' },
  overdue: { label: 'Overdue', mark: '!', cue: 'late' },
  void: { label: 'Void', mark: '×', cue: 'strike' },
};

function isListedStatus(status: string): status is InvoiceStatus {
  return (
    status === 'draft' ||
    status === 'sent' ||
    status === 'partly_paid' ||
    status === 'paid' ||
    status === 'overdue' ||
    status === 'void'
  );
}

/**
 * Badge for a status the list (or the invoice page) already returned.
 * Overdue on that status means the due date is before today and the invoice is not fully paid
 * (see invoiceOverdue). Unknown or missing is null, so the row shows — and does not guess.
 */
export function invoiceStatusBadge(status: string | null | undefined): InvoiceStatusBadgeModel | null {
  if (typeof status !== 'string' || !isListedStatus(status)) return null;
  return { status, ...STATUS_BADGES[status] };
}

/**
 * Overdue when the due date is before today and the invoice is not fully paid.
 * Due today is not overdue. A zero balance is paid, including when it was paid late.
 * Draft and void are never overdue. A missing date or amount is null, not a guess.
 */
export function invoiceOverdue(input: {
  stored: InvoiceStoredStatus | null | undefined;
  amountDue: number | null | undefined;
  paid: number | null | undefined;
  dueDate: string | null | undefined;
  today: string | null | undefined;
}): boolean | null {
  if (!knownStored(input.stored)) return null;
  const amountDue = finiteNumber(input.amountDue);
  const paid = finiteNumber(input.paid);
  if (amountDue == null || paid == null) return null;
  if (!isYmd(input.dueDate) || !isYmd(input.today)) return null;
  return invoiceStatus({ stored: input.stored, amountDue, paid, dueDate: input.dueDate, today: input.today }) === 'overdue';
}

/** Text cell. Blank or missing is an em dash, not a placeholder name. */
export function invoiceTextCell(value: string | null | undefined): string {
  if (typeof value !== 'string') return INVOICE_MISSING;
  const trimmed = value.trim();
  return trimmed ? trimmed : INVOICE_MISSING;
}

/** Date cell. A real YYYY-MM-DD is formatted. Anything else already returned is shown as returned. Blank is —. */
export function invoiceDateCell(ymd: string | null | undefined): string {
  if (typeof ymd !== 'string' || ymd.trim() === '') return INVOICE_MISSING;
  return formatInvoiceDate(ymd);
}

/** Total to format. Null when the list did not return a finite amount, so the cell shows —. */
export function invoiceTotalAmount(total: number | null | undefined): number | null {
  return finiteNumber(total);
}

/**
 * Balance to format. Draft and void show — (they are not an amount owed).
 * An unknown status or a missing balance is also —. A real zero on a sent invoice is zero.
 */
export function invoiceBalanceAmount(status: string | null | undefined, balance: number | null | undefined): number | null {
  const badge = invoiceStatusBadge(status);
  if (!badge || badge.status === 'draft' || badge.status === 'void') return null;
  return finiteNumber(balance);
}

export type InvoiceRowActionId = 'open' | 'edit' | 'markSent' | 'markPaid' | 'pdf' | 'duplicate' | 'void' | 'delete';

export type InvoiceRowAction = {
  id: InvoiceRowActionId;
  label: string;
  danger: boolean;
};

/**
 * Actions for one list row. Same gates as the invoice page:
 * edit and mark-as-sent are drafts, mark paid needs a sent invoice with a balance,
 * void needs a sent invoice with no payments, delete is drafts and void invoices.
 * No Budget action: nothing on the invoice links it to a budget line.
 */
export function invoiceRowActions(input: {
  storedStatus: InvoiceStoredStatus | null | undefined;
  balanceNzd: number | null | undefined;
  paidNzd: number | null | undefined;
}): InvoiceRowAction[] {
  const stored = knownStored(input.storedStatus) ? input.storedStatus : null;
  const balance = finiteNumber(input.balanceNzd);
  const paid = finiteNumber(input.paidNzd);
  const actions: InvoiceRowAction[] = [{ id: 'open', label: 'Open', danger: false }];
  if (stored === 'draft') {
    actions.push({ id: 'edit', label: 'Edit', danger: false });
    actions.push({ id: 'markSent', label: 'Mark as sent', danger: false });
  }
  if (stored === 'sent' && balance != null && balance > 0) {
    actions.push({ id: 'markPaid', label: 'Mark paid', danger: false });
  }
  actions.push({ id: 'pdf', label: 'Download PDF', danger: false });
  actions.push({ id: 'duplicate', label: 'Duplicate', danger: false });
  if (stored === 'sent' && paid != null && paid <= 0) {
    actions.push({ id: 'void', label: 'Void', danger: true });
  }
  if (stored === 'draft') actions.push({ id: 'delete', label: 'Delete draft', danger: true });
  if (stored === 'void') actions.push({ id: 'delete', label: 'Delete invoice', danger: true });
  return actions;
}

/** Accessible name for the ⋯ button. A blank number is not replaced with a made-up one. */
export function invoiceRowMenuLabel(number: string | null | undefined): string {
  const n = typeof number === 'string' ? number.trim() : '';
  return n ? `Actions for ${n}` : 'Actions for this invoice';
}

/**
 * Confirm copy for row actions that change the invoice. Wording matches the invoice page
 * when a number is present. Null when that action does not apply, so it is not run.
 */
export function invoiceRowConfirm(
  action: 'markSent' | 'void' | 'delete',
  input: { number: string | null | undefined; storedStatus: InvoiceStoredStatus | null | undefined },
): string | null {
  const number = typeof input.number === 'string' ? input.number.trim() : '';
  if (action === 'markSent') {
    if (input.storedStatus !== 'draft') return null;
    return 'Mark as sent without sending from here? You won’t be able to edit it after this.';
  }
  if (action === 'void') {
    if (input.storedStatus !== 'sent') return null;
    return number
      ? `Void ${number}? It stays in your records but no longer counts as owed.`
      : 'Void this invoice? It stays in your records but no longer counts as owed.';
  }
  if (input.storedStatus === 'draft') {
    return number ? `Delete draft ${number}? This can’t be undone.` : 'Delete this draft? This can’t be undone.';
  }
  if (input.storedStatus === 'void') {
    return number ? `Delete void invoice ${number}? This can’t be undone.` : 'Delete this void invoice? This can’t be undone.';
  }
  return null;
}
