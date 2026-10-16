/**
 * Settings → Business form helpers (KAN-71). Run: npm run test:invoices
 */
import {
  applyFormattedInput,
  caretAfterFormat,
  changedFields,
  checkBankAccount,
  checkGstNumber,
  checkInvoicePrefix,
  checkNzbn,
  formatBankAccount,
  formatGstNumber,
  formatNzbn,
  nextNumbersLine,
  normalizeSavedBankAccount,
} from './businessForm.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function same(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

// Bank account
same(formatBankAccount('12'), '12', 'no hyphen until the branch starts');
same(formatBankAccount('123'), '12-3', 'branch starts');
same(formatBankAccount('123456789012300'), '12-3456-7890123-00', '15 digits');
same(formatBankAccount('1234567890123001'), '12-3456-7890123-001', '16 digits');
same(formatBankAccount('12345678901230019'), '12-3456-7890123-001', 'capped at 16 digits');
same(formatBankAccount('12 3456 7890123 00'), '12-3456-7890123-00', 'spaces become hyphens');
same(checkBankAccount('').tone, 'hint', 'empty → hint');
same(checkBankAccount('12-3456-7890123-00').tone, 'ok', '15 digits ok');
same(checkBankAccount('12-3456-7890123-001').tone, 'ok', '16 digits ok');
same(checkBankAccount('12-3456-789').tone, 'error', 'too short');
assert(checkBankAccount('12-3456-789').text.includes('This has 9'), 'says how many digits');
same(checkBankAccount('ANZ 12-3456').tone, 'error', 'letters are an error');
same(normalizeSavedBankAccount('123456 7890123 00'), '12-3456-7890123-00', 'saved 15 digits reformatted');
same(normalizeSavedBankAccount('ANZ 12-3456-7890123-00'), 'ANZ 12-3456-7890123-00', 'saved text left alone');
same(normalizeSavedBankAccount('12-34'), '12-34', 'saved short value left alone');

// GST number
same(formatGstNumber('123456789'), '123-456-789', '9 digits');
same(formatGstNumber('12345678'), '12-345-678', '8 digits');
same(formatGstNumber('1234'), '123-4', 'partial uses 3-3-3');
same(formatGstNumber('1234567890'), '123-456-789', 'capped at 9');
same(checkGstNumber('', true).tone, 'error', 'required while registered');
same(checkGstNumber('', false).tone, 'hint', 'optional when not registered');
same(checkGstNumber('12-345-678', true).tone, 'ok', '8 ok');
same(checkGstNumber('123-456-789', true).tone, 'ok', '9 ok');
same(checkGstNumber('123-45', true).tone, 'error', 'wrong length');
// The server accepts what the formatter produces.
for (const n of ['123-456-789', '12-345-678']) {
  assert(/^\d{2,3}-?\d{3}-?\d{3}$/.test(n), `server GST pattern accepts ${n}`);
}

// NZBN
same(formatNzbn('9429 0412 34567'), '9429041234567', 'digits only');
same(formatNzbn('94290412345678'), '9429041234567', 'capped at 13');
same(checkNzbn('').tone, 'hint', 'empty is fine');
same(checkNzbn('9429041234567').tone, 'ok', '13 ok');
same(checkNzbn('94290').tone, 'error', 'short');

// Invoice prefix
same(checkInvoicePrefix('INV-'), null, 'normal prefix');
assert(checkInvoicePrefix('INV2026')?.tone === 'error', 'digit at end is an error');
same(nextNumbersLine('INV-', []), 'Next invoice: INV-0001, then INV-0002', 'first invoice');
same(nextNumbersLine('', ['INV-0007']), 'Next invoice: INV-0008, then INV-0009', 'blank prefix means INV-');
same(nextNumbersLine('ACME-', ['INV-0007']), 'Next invoice: ACME-0001, then ACME-0002', 'new prefix starts again');
same(nextNumbersLine('inv-', ['INV-0007']), 'Next invoice: inv-0008, then inv-0009', 'prefix case-insensitive');

// Caret
same(caretAfterFormat('12-3456-7', 3), 4, 'after third digit, past the hyphen');
same(caretAfterFormat('12-3', 0), 0, 'start');
same(caretAfterFormat('12-3', 9), 4, 'past the end clamps');

// Typing into formatted fields
{
  const typed = applyFormattedInput('12-345', '12-3456', 7, formatBankAccount);
  same(typed.value, '12-3456', 'typing a digit keeps format');
  const crossed = applyFormattedInput('12-3456', '12-34567', 8, formatBankAccount);
  same(crossed.value, '12-3456-7', 'typed past group gets hyphen');
  same(crossed.caret, 9, 'caret after the new digit');
  // Backspace right after a hyphen: "12-3|" → raw "123" at caret 2 (hyphen removed) → digit before goes.
  const back = applyFormattedInput('12-3456', '123456', 2, formatBankAccount);
  same(back.value, '13-456', 'backspace over hyphen removes the digit before it');
  same(back.caret, 1, 'caret after the remaining digit');
  same(applyFormattedInput('', '123456789', 9, formatGstNumber).value, '123-456-789', 'pasted GST');
}

// Unsaved changes
{
  const base = {
    businessName: 'Kōwhai Ltd', address: '', email: 'a@b.nz', phone: '', bankAccount: '',
    gstRegistered: false, gstNumber: '', nzbn: '', invoicePrefix: 'INV-',
  };
  same(changedFields(base, { ...base }).length, 0, 'no changes');
  same(changedFields(base, { ...base, businessName: 'Kōwhai Ltd ' }).length, 0, 'trailing space is not a change');
  same(changedFields(base, { ...base, phone: '021', email: 'x@y.nz' }).length, 2, 'two changes');
  same(changedFields(base, { ...base, gstRegistered: true, gstNumber: '123-456-789' }).length, 2, 'GST on + number');
  same(changedFields({ ...base, gstNumber: '1' }, { ...base, gstNumber: '' }).length, 0, 'hidden GST number ignored while off');
}

console.log('businessForm: ok');
