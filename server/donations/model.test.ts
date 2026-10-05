/**
 * Donation tax-year and tax-credit formulas. Amounts are NZD.
 * Run: npm run test:donations
 */
import { roundMoney } from '../debts/model.ts';
import {
  donationSummary,
  nzTaxYearForDate,
  parseCreateDonation,
  parsePatchDonation,
  parseTaxYearQuery,
  summarizeTaxYear,
} from './model.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function eq(actual: number | null | undefined, expected: number, msg: string): void {
  if (actual == null || Math.abs(actual - expected) > 1e-9) {
    throw new Error(`FAIL: ${msg} (got ${actual}, expected ${expected})`);
  }
}

const march = nzTaxYearForDate('2026-03-31');
assert(march?.taxYear === 2026, '31 March 2026 is the 2026 tax year');
assert(march?.taxYearStart === '2025-04-01', '2026 tax year starts 1 April 2025');
assert(march?.taxYearEnd === '2026-03-31', '2026 tax year ends 31 March 2026');

const april = nzTaxYearForDate('2026-04-01');
assert(april?.taxYear === 2027, '1 April 2026 is the 2027 tax year');
assert(april?.taxYearStart === '2026-04-01', '2027 tax year starts 1 April 2026');
assert(april?.taxYearEnd === '2027-03-31', '2027 tax year ends 31 March 2027');
assert(nzTaxYearForDate('2026-10-05')?.taxYear === 2027, '5 October 2026 is the 2027 tax year');
assert(nzTaxYearForDate('2027-03-31')?.taxYear === 2027, '31 March 2027 is still the 2027 tax year');
assert(nzTaxYearForDate('2027-04-01')?.taxYear === 2028, '1 April 2027 opens the 2028 tax year');
assert(nzTaxYearForDate('2024-02-29')?.taxYear === 2024, '29 February 2024 is in the 2024 tax year');
assert(nzTaxYearForDate('2025-02-29') == null, '29 February 2025 is not a date');
assert(nzTaxYearForDate('2026-10-05T00:00:00') == null, 'a timestamp is not a calendar date');

const rows = [
  { date: '2026-03-31', amountNzd: 100 },
  { date: '2026-04-01', amountNzd: 5 },
  { date: '2026-06-15', amountNzd: 10 },
  { date: '2026-08-01', amountNzd: 4.99 },
  { date: '2027-04-01', amountNzd: 20 },
];

const year2027 = summarizeTaxYear(rows, 2027);
eq(year2027.count, 3, 'three donations fall in the 2027 tax year');
eq(year2027.totalAmountNzd, 19.99, '2027 total is 5 + 10 + 4.99');
eq(year2027.eligibleCount, 2, 'only the gifts of $5 or more are eligible');
eq(year2027.eligibleAmountNzd, 15, 'eligible amount is 5 + 10');
eq(year2027.belowMinimumCount, 1, '4.99 is below the $5 minimum');
eq(year2027.belowMinimumAmountNzd, 4.99, 'the under-$5 gift is still a total');
eq(year2027.estimatedTaxCreditNzd, 5, 'one third of 15 is 5');
assert(year2027.estimateLabel === 'estimate', 'the credit is labelled an estimate');
assert(year2027.incomeCapApplied === false, 'the taxable-income cap is not applied');
assert(year2027.minimumDonationNzd === 5, 'minimum is $5');
assert(year2027.creditRate === '1/3', 'rate is one third');

const split = summarizeTaxYear(
  [
    { date: '2026-05-01', amountNzd: 5 },
    { date: '2026-05-02', amountNzd: 5 },
  ],
  2027,
);
eq(split.eligibleAmountNzd, 10, 'two $5 gifts sum to 10');
eq(split.estimatedTaxCreditNzd, roundMoney(10 / 3), 'one third is taken on the sum');
eq(split.estimatedTaxCreditNzd, 3.33, '10 / 3 rounds to 3.33, not 1.67 + 1.67');

const pooled = summarizeTaxYear(
  [
    { date: '2026-05-01', amountNzd: 4.99 },
    { date: '2026-05-02', amountNzd: 4.99 },
  ],
  2027,
);
eq(pooled.totalAmountNzd, 9.98, 'under-$5 gifts still add into the total');
eq(pooled.eligibleAmountNzd, 0, 'under-$5 gifts are not pooled to reach $5');
eq(pooled.estimatedTaxCreditNzd, 0, 'nothing under $5 earns the estimate');

eq(summarizeTaxYear([{ date: '2026-05-01', amountNzd: 5 }], 2027).estimatedTaxCreditNzd, 1.67, '5 / 3 rounds to 1.67');
eq(summarizeTaxYear([{ date: '2026-05-01', amountNzd: 10 }], 2027).estimatedTaxCreditNzd, 3.33, '10 / 3 rounds to 3.33');
eq(summarizeTaxYear([{ date: '2026-05-01', amountNzd: 7 }], 2027).estimatedTaxCreditNzd, 2.33, '7 / 3 rounds to 2.33');

const empty = summarizeTaxYear([], 2027);
eq(empty.count, 0, 'an empty year has no donations');
eq(empty.totalAmountNzd, 0, 'an empty year totals 0');
eq(empty.estimatedTaxCreditNzd, 0, 'an empty year estimates 0');

const summary = donationSummary(rows, '2026-10-05', null);
assert(summary.currency === 'NZD', 'summary currency is NZD');
assert(summary.timezone === 'Pacific/Auckland', 'summary timezone is Pacific/Auckland');
assert(summary.asOf === '2026-10-05', 'summary asOf is the date passed in');
assert(summary.currentTaxYear === 2027, '5 October 2026 is in the 2027 tax year');
assert(summary.taxYear === 2027, 'omitted taxYear selects the current tax year');
assert(summary.estimateLabel === 'estimate', 'summary labels the credit an estimate');
assert(summary.estimateNote.includes('Estimate only'), 'summary includes the estimate rule');
assert(summary.estimateNote.includes('taxable income'), 'summary documents the income cap');
assert(summary.taxYearNote.includes('1 April'), 'summary documents the tax year');
assert(summary.incomeCapApplied === false, 'summary does not apply the income cap');
eq(summary.selected.totalAmountNzd, 19.99, 'selected year matches the 2027 total');
assert(
  JSON.stringify(summary.years.map((year) => year.taxYear)) === JSON.stringify([2028, 2027, 2026]),
  `years are newest first (got ${summary.years.map((year) => year.taxYear).join(',')})`,
);
eq(summary.years.find((year) => year.taxYear === 2026)?.totalAmountNzd, 100, '2026 keeps the March gift');
eq(summary.years.find((year) => year.taxYear === 2028)?.totalAmountNzd, 20, '2028 keeps the next April gift');

const asked = donationSummary(rows, '2026-10-05', 2026);
assert(asked.taxYear === 2026, 'taxYear query selects that year');
eq(asked.selected.estimatedTaxCreditNzd, roundMoney(100 / 3), '2026 credit is one third of 100');
eq(asked.selected.estimatedTaxCreditNzd, 33.33, '100 / 3 rounds to 33.33');
assert(asked.currentTaxYear === 2027, 'current tax year stays the year of asOf');

const created = parseCreateDonation({
  date: '2026-06-15',
  recipient: '  City Mission  ',
  amountNzd: '12.345',
  notes: '  appeal  ',
  evidenceUrl: 'https://example.org/gift?id=1',
  receiptTransactionId: '',
});
assert(created.ok, 'a complete donation parses');
if (created.ok) {
  assert(created.value.date === '2026-06-15', 'date is kept');
  assert(created.value.recipient === 'City Mission', 'recipient is trimmed');
  eq(created.value.amountNzd, 12.35, 'amount rounds to cents');
  assert(created.value.notes === 'appeal', 'notes are trimmed');
  assert(created.value.evidenceUrl === 'https://example.org/gift?id=1', 'evidence URL is kept');
  assert(created.value.receiptTransactionId == null, 'blank receipt link is null');
}

const roundedUp = parseCreateDonation({
  date: '2026-06-15',
  recipient: 'School',
  amountNzd: 4.995,
});
assert(roundedUp.ok && roundedUp.value.amountNzd === 5, '4.995 NZD rounds to 5.00 before the $5 test');

const roundedDown = parseCreateDonation({
  date: '2026-06-15',
  recipient: 'School',
  amountNzd: 4.994,
});
assert(roundedDown.ok && roundedDown.value.amountNzd === 4.99, '4.994 NZD rounds to 4.99');

assert(!parseCreateDonation({ recipient: 'X', amountNzd: 5 }).ok, 'date is required');
assert(parseCreateDonation({}).error === 'date is required', 'missing date names the field');
assert(
  parseCreateDonation({ date: '2026-02-31', recipient: 'X', amountNzd: 5 }).error === 'date must be YYYY-MM-DD',
  '31 February is rejected',
);
assert(parseCreateDonation({ date: '2026-06-15', amountNzd: 5 }).error === 'recipient is required', 'recipient is required');
assert(
  parseCreateDonation({ date: '2026-06-15', recipient: 'X', amountNzd: 0 }).error === 'amountNzd must be a positive number',
  'zero is rejected',
);
assert(
  parseCreateDonation({ date: '2026-06-15', recipient: 'X', amountNzd: -1 }).error === 'amountNzd must be a positive number',
  'a negative amount is rejected',
);
assert(
  parseCreateDonation({
    date: '2026-06-15',
    recipient: 'X',
    amountNzd: 5,
    evidenceUrl: 'javascript:alert(1)',
  }).error === 'evidenceUrl must be an http(s) URL or blank',
  'a javascript URL is rejected',
);
assert(
  parseCreateDonation({
    date: '2026-06-15',
    recipient: 'X',
    amountNzd: 5,
    notes: 4,
  }).error === 'notes must be a string or null',
  'notes must be text',
);

const patched = parsePatchDonation({ notes: '', evidenceUrl: null, amountNzd: '8' });
assert(patched.ok, 'a patch parses');
if (patched.ok) {
  assert(patched.value.notes == null, 'blank notes clear');
  assert(patched.value.evidenceUrl == null, 'null evidence clears');
  eq(patched.value.amountNzd, 8, 'patched amount parses');
  assert(patched.value.date == null && patched.value.recipient == null, 'omitted fields stay omitted');
}

assert(parseTaxYearQuery(undefined).ok && parseTaxYearQuery(undefined).value == null, 'omitted taxYear means all / current');
assert(parseTaxYearQuery('2027').value === 2027, '2027 is a tax year');
assert(parseTaxYearQuery('1899').error === 'taxYear must be from 1900 to 2200', 'years before 1900 are rejected');
assert(!parseTaxYearQuery('27').ok, 'a two-digit year is rejected');
assert(!parseTaxYearQuery('2027.5').ok, 'a fractional year is rejected');

console.log('donation model tests passed');
