/**
 * Invoices list view rules (phase 1).
 * Counts, profiles, and tax-year start in these fixtures are the inputs.
 * Run: npm run test:invoices
 */
import type { BusinessDetails } from './invoicesView.ts';
import {
  BUSINESS_SETTINGS_HREF,
  INVOICE_TOTALS,
  businessComplete,
  businessPromptLead,
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

console.log('invoices view: ok');
