/**
 * Rental tax years and totals (KAN-66).
 * Run: npm run test:rentals
 */
import { isRentalCategory, rentalCategoryLabel, rentalTaxYears, rentalTotals, taxYearLabel, taxYearOf, taxYearRange } from './rental.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(taxYearOf('2026-03-31') === 2026, '31 March ends the tax year');
assert(taxYearOf('2026-04-01') === 2027, '1 April starts the next');
assert(taxYearOf('2026-10-15') === 2027, 'October is in the year ending next March');
assert(taxYearRange(2027).start === '2026-04-01' && taxYearRange(2027).end === '2027-03-31', 'range');
assert(taxYearLabel(2027) === '2026–27' && taxYearLabel(2100) === '2099–00', 'label');

assert(isRentalCategory('income', 'rent') && !isRentalCategory('income', 'rates'), 'income categories');
assert(isRentalCategory('expense', 'interest') && !isRentalCategory('expense', 'rent'), 'expense categories');
assert(rentalCategoryLabel('interest') === 'Mortgage interest' && rentalCategoryLabel('??') === 'Other', 'labels');

const entries = [
  { propertyId: 'a', date: '2026-04-01', kind: 'income' as const, amountNzd: 650.1 },
  { propertyId: 'a', date: '2026-10-06', kind: 'income' as const, amountNzd: 650.2 },
  { propertyId: 'a', date: '2026-10-20', kind: 'expense' as const, amountNzd: 812.4 },
  { propertyId: 'b', date: '2027-03-31', kind: 'income' as const, amountNzd: 300 },
  { propertyId: 'b', date: '2026-03-31', kind: 'expense' as const, amountNzd: 99 },
];
const all = rentalTotals(entries, 2027);
assert(all.income === 1600.3 && all.expenses === 812.4 && all.net === 787.9, 'year totals, money rounded');
const a = rentalTotals(entries, 2027, 'a');
assert(a.income === 1300.3 && a.expenses === 812.4 && a.net === 487.9, 'one property');
const prior = rentalTotals(entries, 2026);
assert(prior.income === 0 && prior.expenses === 99 && prior.net === -99, 'a loss is negative');
assert(rentalTaxYears(entries, '2026-10-15').join() === '2027,2026', 'years with entries, newest first');
assert(rentalTaxYears([], '2026-10-15').join() === '2027', 'current year when empty');

console.log('rental lib tests passed');
