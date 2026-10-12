/**
 * Invoices list view rules (phase 1) and builder rules (phase 2).
 * Counts, profiles, tax-year start, and line inputs in these fixtures are the inputs.
 * Run: npm run test:invoices
 */
import { dueDateForPreset, invoiceTotals } from '../lib/invoiceCalc.ts';
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
  gstEditorControl,
  gstModeFromCheckbox,
  invoiceActionBlock,
  invoiceSetupSteps,
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

console.log('invoices view: ok');
