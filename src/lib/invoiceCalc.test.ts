/**
 * Invoice maths (KAN-71). Run: npm run test:invoices
 */
import {
  dueDateForPreset,
  invoiceStatus,
  invoiceTotals,
  isValidEmail,
  nextInvoiceNumber,
  invoiceNumberKey,
} from './invoiceCalc.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function eq(actual: number, expected: number, msg: string): void {
  if (Math.abs(actual - expected) > 0.0001) throw new Error(`FAIL: ${msg} (got ${actual}, expected ${expected})`);
}

// Not GST registered.
{
  const t = invoiceTotals([{ quantity: 3, rate: 33.333 }, { quantity: 1.5, rate: 40 }], 'none');
  eq(t.lineTotals[0], 100, 'line total rounds to cents (99.999 → 100.00)');
  eq(t.subtotal, 160, 'subtotal');
  eq(t.gst, 0, 'no GST');
  eq(t.total, 160, 'total');
  eq(t.amountDue, 160, 'amount due');
}

// GST exclusive: 15% on top, rounded once on the subtotal.
{
  const t = invoiceTotals([{ quantity: 1, rate: 99.99 }, { quantity: 2, rate: 0.01 }], 'exclusive');
  eq(t.subtotal, 100.01, 'exclusive subtotal');
  eq(t.gst, 15, 'GST 15% of 100.01 = 15.0015 → 15.00');
  eq(t.total, 115.01, 'exclusive total');
}

// GST inclusive: 3/23 of the total backed out.
{
  const t = invoiceTotals([{ quantity: 1, rate: 115 }], 'inclusive');
  eq(t.gst, 15, 'GST in $115 is $15');
  eq(t.subtotal, 100, 'excl. GST');
  eq(t.total, 115, 'total unchanged');
  const odd = invoiceTotals([{ quantity: 1, rate: 100 }], 'inclusive');
  eq(odd.gst, 13.04, 'GST in $100 = 13.0434… → 13.04');
  eq(odd.subtotal, 86.96, 'subtotal + GST = total');
  eq(odd.subtotal + odd.gst, odd.total, 'inclusive parts add up');
}

// Withholding on the GST-exclusive subtotal.
{
  const t = invoiceTotals([{ quantity: 20, rate: 45 }], 'exclusive', 15);
  eq(t.subtotal, 900, 'subtotal');
  eq(t.gst, 135, 'GST');
  eq(t.total, 1035, 'total');
  eq(t.withholding, 135, '15% withholding on $900, not on $1,035');
  eq(t.amountDue, 900, 'client pays total − withholding');
  const none = invoiceTotals([{ quantity: 10, rate: 50 }], 'none', 20);
  eq(none.withholding, 100, '20% of $500');
  eq(none.amountDue, 400, 'due after withholding');
  eq(invoiceTotals([{ quantity: 1, rate: 10 }], 'none', 150).withholdingRatePct, 100, 'withholding capped at 100%');
}

// Due date presets.
{
  assert(dueDateForPreset('2026-10-08', 'on_receipt') === '2026-10-08', 'on receipt');
  assert(dueDateForPreset('2026-10-08', 'days_7') === '2026-10-15', '7 days');
  assert(dueDateForPreset('2026-10-25', 'days_14') === '2026-11-08', '14 days across month end');
  assert(dueDateForPreset('2026-12-10', 'next_month_20') === '2027-01-20', '20th of next month across year end');
  assert(dueDateForPreset('2026-01-31', 'days_30') === '2026-03-02', '30 days');
  assert(dueDateForPreset('2026-10-08', 'custom', '2026-11-01') === '2026-11-01', 'custom date');
  assert(dueDateForPreset('2026-10-08', 'custom', 'nope') === '2026-10-08', 'bad custom falls back to issue date');
}

// Status transitions.
{
  const base = { amountDue: 500, dueDate: '2026-10-20', today: '2026-10-10' };
  assert(invoiceStatus({ ...base, stored: 'draft', paid: 0 }) === 'draft', 'draft');
  assert(invoiceStatus({ ...base, stored: 'sent', paid: 0 }) === 'sent', 'sent');
  assert(invoiceStatus({ ...base, stored: 'sent', paid: 200 }) === 'partly_paid', 'partly paid');
  assert(invoiceStatus({ ...base, stored: 'sent', paid: 500 }) === 'paid', 'paid');
  assert(invoiceStatus({ ...base, stored: 'sent', paid: 0, today: '2026-10-20' }) === 'sent', 'due today is not overdue');
  assert(invoiceStatus({ ...base, stored: 'sent', paid: 0, today: '2026-10-21' }) === 'overdue', 'overdue the day after');
  assert(invoiceStatus({ ...base, stored: 'sent', paid: 200, today: '2026-10-21' }) === 'overdue', 'part paid and late is overdue');
  assert(invoiceStatus({ ...base, stored: 'sent', paid: 500, today: '2026-12-01' }) === 'paid', 'paid late stays paid');
  assert(invoiceStatus({ ...base, stored: 'void', paid: 0, today: '2026-12-01' }) === 'void', 'void');
}

// Numbering.
{
  assert(nextInvoiceNumber([]) === 'INV-0001', 'first number');
  assert(nextInvoiceNumber(['INV-0001', 'INV-0002']) === 'INV-0003', 'sequential');
  assert(nextInvoiceNumber(['INV-0009', 'INV-0003']) === 'INV-0010', 'after the highest');
  assert(nextInvoiceNumber(['inv-0041', 'A-99', 'INV-12x']) === 'INV-0042', 'other formats ignored, case-insensitive');
  assert(nextInvoiceNumber(['INV-123456']) === 'INV-123457', 'wider numbers keep width');
  assert(invoiceNumberKey(' INV-0001 ') === invoiceNumberKey('inv-0001'), 'number key ignores case and spaces');
}

// Email validation.
{
  assert(isValidEmail('client@example.co.nz'), 'valid email');
  assert(!isValidEmail('client@example'), 'no dot in domain');
  assert(!isValidEmail('a b@example.com'), 'space');
  assert(!isValidEmail('x@y.com, z@w.com'), 'two addresses in one');
  assert(!isValidEmail('Name <x@y.com>'), 'display-name form not accepted');
}

console.log('invoice calc: ok');
