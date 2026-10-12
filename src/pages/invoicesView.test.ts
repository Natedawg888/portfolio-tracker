/**
 * Invoices list view rules (phase 1), builder rules (phase 2), row menu / badges (phase 3),
 * and withholding prefill (phase 4).
 * Counts, profiles, tax-year start, and line inputs in these fixtures are the inputs.
 * Run: npm run test:invoices
 */
import { dueDateForPreset, invoiceTotals } from '../lib/invoiceCalc.ts';
import { defaultOutputPayPrefs, withholdingPct } from '../lib/outputPayPrefs.ts';
import { payTaxYearRates } from '../lib/payeRates.ts';
import type { BusinessDetails } from './invoicesView.ts';
import {
  BUSINESS_SETTINGS_HREF,
  DUE_TAP_PRESETS,
  INVOICE_TOTALS,
  businessComplete,
  businessPromptLead,
  editorDueDate,
  editorGstMode,
  editorInvoiceTotals,
  editorReceiveAmount,
  editorWithholdingPrefill,
  gstEditorControl,
  gstModeFromCheckbox,
  INVOICE_MISSING,
  invoiceActionBlock,
  invoiceBalanceAmount,
  invoiceDateCell,
  invoiceOverdue,
  invoiceRowActions,
  invoiceRowConfirm,
  invoiceRowMenuLabel,
  invoiceSetupSteps,
  invoiceStatusBadge,
  invoiceTextCell,
  invoiceTotalAmount,
  invoicesChrome,
  invoicesSubtitle,
  visibleInvoiceCount,
} from './invoicesView.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function details(partial: Partial<BusinessDetails> = {}): BusinessDetails {
  return {
    businessName: '',
    bankAccount: '',
    gstRegistered: false,
    gstNumber: '',
    ...partial,
  };
}

assert(BUSINESS_SETTINGS_HREF === '/settings?tab=business', 'business step links to Settings → Business');

// businessComplete
{
  assert(businessComplete(null) === false, 'no profile is not complete');
  assert(businessComplete(undefined) === false, 'a missing profile is not complete');
  assert(
    businessComplete(details({ businessName: 'Nathan', bankAccount: '' })) === false,
    'a prefilled name with an empty bank account is not complete',
  );
  assert(businessComplete(details({ businessName: 'Hana', bankAccount: '   ' })) === false, 'empty bank → false');
  assert(
    businessComplete(details({ businessName: 'Hana', bankAccount: '12-3456-7890123-00' })) === true,
    'name + bank → true',
  );
  assert(
    businessComplete(
      details({ businessName: 'Hana', bankAccount: '12-3456-7890123-00', gstRegistered: true, gstNumber: '' }),
    ) === false,
    'GST-registered with empty GST number → false',
  );
  assert(
    businessComplete(
      details({ businessName: 'Hana', bankAccount: '12-3456-7890123-00', gstRegistered: true, gstNumber: '   ' }),
    ) === false,
    'a blank GST number does not count',
  );
  assert(
    businessComplete(
      details({
        businessName: 'Hana',
        bankAccount: '12-3456-7890123-00',
        gstRegistered: true,
        gstNumber: '123-456-789',
      }),
    ) === true,
    'GST-registered with a number → true',
  );
  assert(
    businessPromptLead(details({ businessName: 'Nathan', bankAccount: '' })) === 'Add a bank account in',
    'the prompt names the missing bank account and does not repeat the saved name',
  );
  assert(businessPromptLead(null) === 'Add your business details in', 'no profile gets a prompt, not filler');
  assert(businessPromptLead(details({ businessName: 'Hana', bankAccount: '12-3456-7890123-00' })) === null, 'complete profile has no prompt');
}

// Zero invoices: hide totals, filters, and CSV. A client still ticks step 2 and keeps the clients row.
{
  const empty = invoicesChrome({ invoiceCount: 0, clientCount: 0, taxYearStart: '2026-04-01' });
  assert(empty.showTotals === false, 'zero invoices hides totals');
  assert(empty.showFilters === false, 'zero invoices hides filters');
  assert(empty.showCsv === false, 'zero invoices hides CSV');
  assert(empty.showClients === false, 'zero invoices and zero clients hides the clients row');
  assert(empty.showChecklist === true, 'zero invoices shows the checklist');
  assert(empty.subtitle === null, 'zero invoices has no subtitle, so the tax-year date is not shown');

  const withClient = invoicesChrome({ invoiceCount: 0, clientCount: 1, taxYearStart: '2026-04-01' });
  assert(withClient.showTotals === false, 'a client and no invoices still hides totals');
  assert(withClient.showFilters === false, 'a client and no invoices still hides filters');
  assert(withClient.showCsv === false, 'a client and no invoices still hides CSV');
  assert(withClient.showClients === true, 'a client and no invoices keeps the clients row');
  assert(withClient.showChecklist === true, 'a client and no invoices keeps the checklist');

  const steps = invoiceSetupSteps({ business: details({ businessName: 'Nathan', bankAccount: '' }), clientCount: 1 });
  assert(steps.length === 3, 'the checklist has three steps');
  assert(steps[1]?.id === 'client' && steps[1].title === 'Add a client', 'step 2 is add a client');
  assert(steps[1]?.done === true, 'a client and no invoices ticks step 2');
  assert(steps[0]?.done === false, 'empty bank leaves business details unticked');
  assert(steps[2]?.id === 'invoice' && steps[2].done === false, 'create the invoice stays open until an invoice exists');
  assert(
    invoiceSetupSteps({ business: null, clientCount: 0 })[1]?.done === false,
    'no clients leaves step 2 unticked',
  );
}

// One invoice: subtitle from the given count and taxYearStart. Totals, filters, and CSV appear.
{
  const one = invoicesChrome({ invoiceCount: 1, clientCount: 0, taxYearStart: '2026-04-01' });
  assert(one.subtitle === '1 invoice · tax year from 1 Apr 2026', 'one invoice shows the subtitle from the given count and taxYearStart');
  assert(one.showTotals === true, 'one invoice shows totals');
  assert(one.showFilters === true, 'one invoice shows filters');
  assert(one.showCsv === true, 'one invoice shows CSV');
  assert(one.showClients === true, 'invoices show the clients row even before a client is saved');
  assert(one.showChecklist === false, 'an invoice hides the checklist');
  assert(
    invoicesSubtitle(4, '2025-04-01') === '4 invoices · tax year from 1 Apr 2025',
    'the subtitle uses the returned tax-year start, not a fixed date',
  );
  assert(invoicesSubtitle(1, null) === '1 invoice', 'a missing taxYearStart is not formatted into a date');
  assert(invoicesSubtitle(2, '') === '2 invoices', 'a blank taxYearStart is not formatted into a date');
  assert(invoicesSubtitle(1, 'not-a-date') === '1 invoice · tax year from not-a-date', 'an unparseable date is left as returned');
}

assert(
  INVOICE_TOTALS.map((card) => card.label).join('|') === 'Awaiting payment|Overdue|Paid this month|Paid this tax year',
  'total labels',
);

// A filtered empty list is not "no invoices", including for the moment after filters are cleared.
{
  assert(
    visibleInvoiceCount({ filteredCount: 0, catalogCount: 3, filtersActive: true, responseCurrent: true }) === 3,
    'filters that match nothing keep the real invoice count',
  );
  assert(
    visibleInvoiceCount({ filteredCount: 0, catalogCount: 3, filtersActive: false, responseCurrent: false }) === 3,
    'a stale filtered list does not hide totals while the full list reloads',
  );
  assert(
    visibleInvoiceCount({ filteredCount: 0, catalogCount: 3, filtersActive: false, responseCurrent: true }) === 0,
    'a fresh unfiltered empty list is zero invoices',
  );
  assert(
    visibleInvoiceCount({ filteredCount: null, catalogCount: null, filtersActive: false, responseCurrent: false }) === null,
    'before any list response the count is unknown',
  );
}

// Phase 2: save / mark-as-sent stay disabled until there is a client and a subtotal above zero.
{
  assert(
    invoiceActionBlock({ clientName: '', subtotal: 180 }) === 'Add a client to save or mark as sent.',
    'no client disables save and mark as sent',
  );
  assert(
    invoiceActionBlock({ clientName: '   ', subtotal: 180 }) === 'Add a client to save or mark as sent.',
    'a blank client name counts as no client',
  );
  assert(
    invoiceActionBlock({ clientName: 'Mātai Orchards', subtotal: 0 }) === 'Add a line amount to save or mark as sent.',
    'subtotal 0 disables save and mark as sent',
  );
  assert(
    invoiceActionBlock({ clientName: '', subtotal: 0 }) === 'Add a client and a line amount to save or mark as sent.',
    'no client and subtotal 0 names both gaps',
  );
  assert(invoiceActionBlock({ clientName: 'Mātai Orchards', subtotal: 180 }) === null, 'a client and a subtotal above zero enables both');
}

// Phase 2: one-tap due presets resolve through dueDateForPreset. On receipt and 30 days stay valid off the row.
{
  const issue = '2026-10-08';
  const tapValues = DUE_TAP_PRESETS.map((p) => p.value).join('|');
  assert(tapValues === 'days_7|days_14|next_month_20|custom', 'one-tap due options');
  assert(!tapValues.includes('on_receipt') && !tapValues.includes('days_30'), 'on receipt and 30 days are off the one-tap row');
  assert(editorDueDate(issue, 'days_7') === dueDateForPreset(issue, 'days_7') && editorDueDate(issue, 'days_7') === '2026-10-15', '7 days');
  assert(editorDueDate(issue, 'days_14') === dueDateForPreset(issue, 'days_14') && editorDueDate(issue, 'days_14') === '2026-10-22', '14 days');
  assert(
    editorDueDate(issue, 'next_month_20') === dueDateForPreset(issue, 'next_month_20') && editorDueDate(issue, 'next_month_20') === '2026-11-20',
    '20th of next month',
  );
  assert(
    editorDueDate(issue, 'custom', '2026-11-01') === dueDateForPreset(issue, 'custom', '2026-11-01') && editorDueDate(issue, 'custom', '2026-11-01') === '2026-11-01',
    'custom date',
  );
  assert(dueDateForPreset(issue, 'on_receipt') === '2026-10-08', 'on receipt stays a valid preset');
  assert(dueDateForPreset(issue, 'days_30') === '2026-11-07', '30 days stays a valid preset');
}

// Phase 2: GST checkbox is hidden when registration is false or unknown. Inclusive drafts are not rewritten.
{
  assert(gstEditorControl({ gstRegistered: false, gstMode: 'exclusive', inclusiveDraft: false }).kind === 'hidden', 'GST checkbox hidden when not registered');
  assert(gstEditorControl({ gstRegistered: null, gstMode: 'exclusive', inclusiveDraft: false }).kind === 'hidden', 'GST checkbox hidden when the profile is unknown');
  assert(editorGstMode(null, 'exclusive') === 'none', 'an unknown profile does not default GST on');
  assert(editorGstMode(false, 'exclusive') === 'none', 'a non-registered business does not default GST on');
  const checked = gstEditorControl({ gstRegistered: true, gstMode: 'exclusive', inclusiveDraft: false });
  assert(checked.kind === 'checkbox' && checked.checked === true, 'registered and exclusive shows the checkbox on');
  const unchecked = gstEditorControl({ gstRegistered: true, gstMode: 'none', inclusiveDraft: false });
  assert(unchecked.kind === 'checkbox' && unchecked.checked === false, 'registered and none shows the checkbox off');
  assert(gstModeFromCheckbox(true) === 'exclusive' && gstModeFromCheckbox(false) === 'none', 'checkbox on is exclusive and off is none');
  const preserved = gstEditorControl({ gstRegistered: true, gstMode: 'inclusive', inclusiveDraft: true });
  assert(preserved.kind === 'preserved' && preserved.mode === 'inclusive', 'an inclusive draft keeps inclusive');
  assert(
    gstEditorControl({ gstRegistered: true, gstMode: 'inclusive', inclusiveDraft: false }).kind === 'preserved',
    'inclusive is not shown as the checkbox',
  );
  assert(editorGstMode(true, 'inclusive') === 'inclusive', 'a registered inclusive draft is not rewritten');
}

// Phase 2: line amount, subtotal, GST, and amount due are invoiceTotals for the given lines.
{
  const lines = [
    { quantity: 2, rate: 80 },
    { quantity: 1.5, rate: 40 },
  ];
  const calc = invoiceTotals(lines, 'exclusive', 10);
  const shown = editorInvoiceTotals(lines, 'exclusive', 10);
  assert(shown.lineTotals[0] === calc.lineTotals[0] && shown.lineTotals[0] === 160, 'first line amount');
  assert(shown.lineTotals[1] === calc.lineTotals[1] && shown.lineTotals[1] === 60, 'second line amount');
  assert(shown.subtotal === calc.subtotal && shown.subtotal === 220, 'subtotal');
  assert(shown.gst === calc.gst && shown.gst === 33, 'GST');
  assert(shown.amountDue === calc.amountDue && shown.amountDue === 231, 'amount due subtracts withholding');
}

// Phase 4: blank prefs do not invent a withholding rate. A named IR330C activity uses withholdingPct.
{
  const rates = payTaxYearRates();
  const blank = defaultOutputPayPrefs();
  const none = editorWithholdingPrefill(blank, rates);
  assert(none.on === false && none.ratePct === null, 'blank prefs -> no rate');
  assert(none.ratePct !== 20, 'blank prefs do not invent 20%');
  assert(editorWithholdingPrefill(null, rates).ratePct === null, 'missing prefs -> no rate');
  assert(editorWithholdingPrefill(undefined, rates).ratePct === null, 'undefined prefs -> no rate');
  assert(editorWithholdingPrefill({ ...blank, activity: '' }, rates).ratePct === null, 'an empty activity -> no rate');
  assert(editorWithholdingPrefill({ ...blank, activity: '   ' }, rates).ratePct === null, 'a blank activity -> no rate');
  assert(
    editorWithholdingPrefill({ ...blank, activity: '99' }, rates).ratePct === null,
    'an activity off the IR330C list does not invent 20%',
  );
  assert(
    editorWithholdingPrefill({ ...blank, activity: 'custom', customWtRate: '' }, rates).ratePct === null,
    'a custom rate left empty is not invented',
  );
  assert(
    editorWithholdingPrefill({ ...blank, activity: 'custom', customWtRate: '0' }, rates).ratePct === null,
    'a zero custom rate is not applied',
  );

  const fishing = { ...blank, activity: '12' };
  const fishingPrefill = editorWithholdingPrefill(fishing, rates);
  assert(fishingPrefill.on === true, 'a chosen IR330C activity turns the box on');
  assert(fishingPrefill.ratePct === withholdingPct(fishing, rates), 'the percent is withholdingPct for that activity');
  assert(fishingPrefill.ratePct === 20, 'activity 12 keeps its own 20% from the IR330C table');

  const orchards = { ...blank, contractRate: '45' };
  const orchardPrefill = editorWithholdingPrefill(orchards, rates);
  assert(orchardPrefill.on === true, 'activity 3 with a contract rate is a chosen schedular activity');
  assert(orchardPrefill.ratePct === withholdingPct(orchards, rates) && orchardPrefill.ratePct === 15, 'activity 3 is 15% from withholdingPct');

  const custom = { ...blank, activity: 'custom', customWtRate: '12.5' };
  assert(editorWithholdingPrefill(custom, rates).on === true, 'an entered custom rate turns the box on');
  assert(editorWithholdingPrefill(custom, rates).ratePct === withholdingPct(custom, rates), 'a custom rate is withholdingPct');
  assert(editorWithholdingPrefill(custom, rates).ratePct === 12.5, 'custom 12.5 is kept');
}

// Phase 4: You'll receive is amountDue from invoiceTotals, the figure that is stored.
{
  const lines = [{ quantity: 10, rate: 45 }];
  const totals = editorInvoiceTotals(lines, 'exclusive', 15);
  const stored = invoiceTotals(lines, 'exclusive', 15);
  assert(editorReceiveAmount(totals) === stored.amountDue, "You'll receive is invoiceTotals amountDue");
  assert(editorReceiveAmount(totals) === 450, 'withholding is already taken off the stored amount due');
  assert(editorReceiveAmount(totals) !== stored.total, 'the summary does not show the gross total');
  const noWt = editorInvoiceTotals(lines, 'none', null);
  assert(editorReceiveAmount(noWt) === noWt.amountDue && editorReceiveAmount(noWt) === noWt.total, 'with no withholding, you receive the total');
  assert(editorReceiveAmount(null) === null && editorReceiveAmount(undefined) === null, 'a missing total is not turned into a receive amount');
  assert(editorReceiveAmount({ amountDue: Number.NaN }) === null, 'a bad amount due is not shown as zero');
  assert(editorReceiveAmount({ amountDue: 0 }) === 0, 'a real zero is kept');
}

// Phase 3: status badges name every status. Colour is not the only signal: each has its own word and mark.
{
  const statuses = ['draft', 'sent', 'partly_paid', 'paid', 'overdue', 'void'] as const;
  const labels = statuses.map((status) => invoiceStatusBadge(status)?.label);
  assert(labels.join('|') === 'Draft|Sent|Partly paid|Paid|Overdue|Void', 'badge labels');
  const marks = statuses.map((status) => invoiceStatusBadge(status)?.mark);
  assert(new Set(marks).size === statuses.length && marks.every((mark) => typeof mark === 'string' && mark.length > 0), 'each status has its own mark');
  const cues = statuses.map((status) => invoiceStatusBadge(status)?.cue);
  assert(new Set(cues).size === statuses.length, 'each status has its own shape cue');
  assert(invoiceStatusBadge(null) === null, 'a missing status is not given a label');
  assert(invoiceStatusBadge(undefined) === null, 'an undefined status is not given a label');
  assert(invoiceStatusBadge('') === null, 'a blank status is not given a label');
  assert(invoiceStatusBadge('budget') === null, 'an unknown status is not invented');
  assert(statuses.every((status) => !/budget/i.test(invoiceStatusBadge(status)?.label ?? '')), 'badges do not say In Budget');
}

// Phase 3: Overdue means past the due date and not fully paid. Missing facts stay unknown.
{
  const base = { stored: 'sent' as const, amountDue: 500, paid: 0, dueDate: '2026-10-20', today: '2026-10-21' };
  assert(invoiceOverdue(base) === true, 'unpaid the day after the due date is overdue');
  assert(invoiceOverdue({ ...base, paid: 200 }) === true, 'partly paid and past the due date is overdue');
  assert(invoiceOverdue({ ...base, paid: 500 }) === false, 'fully paid is not overdue');
  assert(invoiceOverdue({ ...base, paid: 500, today: '2026-12-01' }) === false, 'paid late is not overdue');
  assert(invoiceOverdue({ ...base, today: '2026-10-20' }) === false, 'due today is not overdue');
  assert(invoiceOverdue({ ...base, today: '2026-10-19' }) === false, 'before the due date is not overdue');
  assert(invoiceOverdue({ ...base, stored: 'draft' }) === false, 'a draft is not overdue');
  assert(invoiceOverdue({ ...base, stored: 'void' }) === false, 'a void invoice is not overdue');
  assert(invoiceOverdue({ ...base, amountDue: 0, paid: 0 }) === false, 'nothing owed is not overdue');
  assert(invoiceOverdue({ ...base, dueDate: '' }) === null, 'a blank due date is not called overdue');
  assert(invoiceOverdue({ ...base, dueDate: null }) === null, 'a missing due date is not called overdue');
  assert(invoiceOverdue({ ...base, dueDate: '2026-02-31' }) === null, 'an impossible due date is not called overdue');
  assert(invoiceOverdue({ ...base, today: null }) === null, 'a missing today is not called overdue');
  assert(invoiceOverdue({ ...base, amountDue: null }) === null, 'a missing amount due is not called overdue');
  assert(invoiceOverdue({ ...base, paid: undefined }) === null, 'a missing paid amount is not called overdue');
  assert(invoiceOverdue({ ...base, stored: null }) === null, 'a missing stored status is not called overdue');
}

// Phase 3: empty cells are an em dash. A returned non-date is left as returned.
{
  assert(INVOICE_MISSING === '—', 'the missing mark is an em dash');
  assert(invoiceTextCell(null) === '—' && invoiceTextCell('   ') === '—' && invoiceTextCell('Mātai') === 'Mātai', 'blank text is an em dash');
  assert(invoiceDateCell(null) === '—' && invoiceDateCell('') === '—', 'a missing date is an em dash');
  assert(invoiceDateCell('2026-04-01') === '1 Apr 2026', 'a real date is formatted');
  assert(invoiceDateCell('not-a-date') === 'not-a-date', 'an unparseable date is left as returned');
  assert(invoiceTotalAmount(180) === 180 && invoiceTotalAmount(0) === 0, 'a returned total is kept, including zero');
  assert(invoiceTotalAmount(null) === null && invoiceTotalAmount(Number.NaN) === null, 'a missing total is not turned into zero');
  assert(invoiceBalanceAmount('draft', 10) === null && invoiceBalanceAmount('void', 0) === null, 'draft and void balances are not shown as money');
  assert(invoiceBalanceAmount('sent', 12.5) === 12.5 && invoiceBalanceAmount('paid', 0) === 0, 'a sent balance is the returned number');
  assert(invoiceBalanceAmount('overdue', 40) === 40 && invoiceBalanceAmount('partly_paid', 15) === 15, 'overdue and partly paid keep the balance');
  assert(invoiceBalanceAmount('nope', 5) === null && invoiceBalanceAmount('sent', Number.NaN) === null, 'an unknown status or a bad balance is not shown as money');
}

// Phase 3: row actions follow the invoice page. Mark paid is only while something is owed. No Budget action.
{
  const labels = (storedStatus: 'draft' | 'sent' | 'void' | null, balance: number | null, paid: number | null) =>
    invoiceRowActions({ storedStatus, balanceNzd: balance, paidNzd: paid }).map((action) => action.label).join('|');
  assert(labels('draft', 180, 0) === 'Open|Edit|Mark as sent|Download PDF|Duplicate|Delete draft', 'draft row actions');
  assert(labels('sent', 180, 0) === 'Open|Mark paid|Download PDF|Duplicate|Void', 'unpaid sent row can be marked paid or voided');
  assert(labels('sent', 40, 20) === 'Open|Mark paid|Download PDF|Duplicate', 'a partly paid row can be marked paid and cannot be voided');
  assert(labels('sent', 0, 180) === 'Open|Download PDF|Duplicate', 'a paid row has no mark paid and no void');
  assert(labels('void', 0, 0) === 'Open|Download PDF|Duplicate|Delete invoice', 'a void row can be deleted');
  assert(labels(null, 10, 0) === 'Open|Download PDF|Duplicate', 'an unknown stored status only offers open, PDF, and duplicate');
  assert(labels('sent', null, 0) === 'Open|Download PDF|Duplicate|Void', 'a missing balance does not offer Mark paid');
  assert(labels('sent', 10, null) === 'Open|Mark paid|Download PDF|Duplicate', 'a missing paid amount does not offer Void');
  const danger = invoiceRowActions({ storedStatus: 'draft', balanceNzd: 1, paidNzd: 0 }).filter((action) => action.danger).map((action) => action.label);
  assert(danger.join('|') === 'Delete draft', 'delete is the danger action on a draft');
  assert(
    invoiceRowActions({ storedStatus: 'sent', balanceNzd: 10, paidNzd: 0 }).every((action) => !/budget/i.test(action.label)),
    'row actions do not include an In Budget indicator',
  );
  assert(invoiceRowMenuLabel('INV-0004') === 'Actions for INV-0004', 'the menu button names the invoice');
  assert(invoiceRowMenuLabel('  ') === 'Actions for this invoice' && invoiceRowMenuLabel(null) === 'Actions for this invoice', 'a blank number is not invented');
  assert(
    invoiceRowConfirm('markSent', { number: 'INV-0004', storedStatus: 'draft' }) ===
      'Mark as sent without sending from here? You won’t be able to edit it after this.',
    'mark as sent uses the invoice page confirm',
  );
  assert(
    invoiceRowConfirm('void', { number: 'INV-0004', storedStatus: 'sent' }) ===
      'Void INV-0004? It stays in your records but no longer counts as owed.',
    'void uses the invoice page confirm',
  );
  assert(
    invoiceRowConfirm('delete', { number: 'INV-0004', storedStatus: 'draft' }) === 'Delete draft INV-0004? This can’t be undone.',
    'delete draft uses the invoice page confirm',
  );
  assert(
    invoiceRowConfirm('delete', { number: 'INV-0004', storedStatus: 'void' }) === 'Delete void invoice INV-0004? This can’t be undone.',
    'delete void uses the invoice page confirm',
  );
  assert(invoiceRowConfirm('void', { number: 'INV-0004', storedStatus: 'draft' }) === null, 'a draft is not voided from the row');
  assert(invoiceRowConfirm('delete', { number: 'INV-0004', storedStatus: 'sent' }) === null, 'a sent invoice is not deleted from the row');
  assert(invoiceRowConfirm('markSent', { number: 'INV-0004', storedStatus: 'sent' }) === null, 'a sent invoice is not marked sent again from the row');
  assert(
    invoiceRowConfirm('void', { number: '  ', storedStatus: 'sent' }) === 'Void this invoice? It stays in your records but no longer counts as owed.',
    'a blank number is not invented in the void confirm',
  );
}

console.log('invoices view: ok');
