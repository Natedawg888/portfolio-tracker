/**
 * One tax year everywhere (KAN-101). Run: npm run test:tax-year
 * Feeds the same dates through PAYE, crypto, rentals and donations and checks each lands in the
 * same tax year with the same label, whatever key the module stores.
 */
import { taxYearForDate as payeTaxYear } from './payeRates.ts';
import { cryptoTaxYear } from './cryptoGains.ts';
import { taxYearLabel as rentalLabel, taxYearOf as rentalTaxYear, taxYearRange as rentalRange } from './rental.ts';
import { nzTaxYearForDate } from '../../server/donations/model.ts';
import { taxYearEndForDate, taxYearForDate, taxYearFromEndYear, taxYearFromStartYear, taxYearLabelFromEnd, taxYearLabelFromStart, taxYearStartForDate } from './taxYear.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

eq(taxYearForDate('2027-03-31').label, '2026/27', '31 March 2027 is 2026/27');
eq(taxYearForDate('2027-04-01').label, '2027/28', '1 April 2027 is 2027/28');
eq(taxYearStartForDate('2027-03-31'), 2026, 'start year');
eq(taxYearEndForDate('2027-03-31'), 2027, 'end year (IRD name)');
eq(taxYearFromStartYear(2026).end, '2027-03-31', 'ends 31 March');
eq(taxYearFromEndYear(2027).start, '2026-04-01', 'starts 1 April');
eq(taxYearLabelFromStart(2099), '2099/00', 'century wrap');
eq(taxYearLabelFromEnd(2010), '2009/10', 'padded');

for (const [date, label] of [['2027-03-31', '2026/27'], ['2027-04-01', '2027/28'], ['2026-04-01', '2026/27'], ['2026-12-31', '2026/27'], ['2000-01-15', '1999/00']] as const) {
  const fromPaye = taxYearLabelFromStart(payeTaxYear(date));
  const fromCrypto = taxYearLabelFromStart(cryptoTaxYear(date));
  const fromRental = rentalLabel(rentalTaxYear(date));
  const don = nzTaxYearForDate(date);
  const fromDonations = don ? taxYearLabelFromEnd(don.taxYear) : null;
  for (const [mod, got] of [['PAYE', fromPaye], ['crypto', fromCrypto], ['rentals', fromRental], ['donations', fromDonations]] as const) {
    eq(got, label, `${mod}: ${date} -> ${label}`);
  }
  const range = rentalRange(rentalTaxYear(date));
  eq(range.start === don?.taxYearStart && range.end === don?.taxYearEnd, true, `rentals and donations agree on the bounds for ${date}`);
}

console.log('taxYear.test.ts ok');
