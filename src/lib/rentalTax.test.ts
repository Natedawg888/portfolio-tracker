/**
 * Rental tax rules (KAN-93): interest limitation, loss ring-fencing, bright-line.
 * Run: npm run test:rentals
 */
import { addYears, brightLineCheck, interestDeductibleShare, isRentalLossBasis, rentalTaxView } from './rentalTax.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

const inc = (propertyId: string, date: string, amountNzd: number) => ({ propertyId, date, kind: 'income' as const, category: 'rent', amountNzd });
const exp = (propertyId: string, date: string, amountNzd: number, category = 'rates') => ({ propertyId, date, kind: 'expense' as const, category, amountNzd });
const props = [{ id: 'a', ownHome: false }, { id: 'b', ownHome: false }, { id: 'home', ownHome: true }];

// A. Interest: 2024/25 (ends 2025) 80%; 2025/26 100%.
eq(interestDeductibleShare(2025), 0.8, '2024/25 is 80%');
eq(interestDeductibleShare(2026), 1, '2025/26 is 100%');
eq(interestDeductibleShare(2027), 1, '2026/27 is 100%');
{
  const y25 = rentalTaxView([inc('a', '2024-06-01', 20000), exp('a', '2024-06-01', 10000, 'interest')], props, 2025);
  eq(y25.rental.interest, 10000, '2024/25 interest paid');
  eq(y25.rental.deductibleInterest, 8000, '2024/25: $10,000 interest → $8,000 deductible');
  eq(y25.rental.net, 12000, 'net uses the deductible interest');
  const y26 = rentalTaxView([inc('a', '2025-06-01', 20000), exp('a', '2025-06-01', 10000, 'interest')], props, 2026);
  eq(y26.rental.deductibleInterest, 10000, '2025/26: $10,000 → $10,000');
  eq(y26.interestModelled, true, 'from 2024/25 the interest rule is modelled');
  eq(rentalTaxView([], props, 2024).interestModelled, false, 'earlier limits are flagged as not modelled');
  // Other expenses are untouched by the interest rule.
  eq(rentalTaxView([exp('a', '2024-06-01', 1000)], props, 2025).rental.deductibleExpenses, 1000, 'rates in full in 2024/25');
}

// B. Ring-fencing: loss $5,000 in year 1, profit $8,000 in year 2.
{
  const entries = [
    inc('a', '2025-05-01', 10000), exp('a', '2025-05-02', 15000), // 2025/26: −5,000
    inc('a', '2026-05-01', 20000), exp('a', '2026-05-02', 12000), // 2026/27: +8,000
  ];
  const y1 = rentalTaxView(entries, props, 2026).rental;
  eq(y1.net, -5000, 'year 1 loss');
  eq(y1.taxable, 0, 'year 1 taxable rental is 0, the loss never goes below 0');
  eq(y1.carriedForward, 5000, '$5,000 carried forward');
  const y2 = rentalTaxView(entries, props, 2027).rental;
  eq(y2.broughtForward, 5000, 'year 2 brings in the $5,000');
  eq(y2.lossUsed, 5000, 'all of it used');
  eq(y2.taxable, 3000, 'year 2 taxable rental $3,000');
  eq(y2.carriedForward, 0, 'nothing left over');
  // A loss bigger than the next profit keeps carrying.
  const big = [inc('a', '2025-05-01', 0.01), exp('a', '2025-05-02', 9000.01), inc('a', '2026-05-01', 3000)];
  const r = rentalTaxView(big, props, 2027).rental;
  eq(r.taxable, 0, 'profit fully absorbed');
  eq(r.carriedForward, 6000, 'rest still carried');
}

// Portfolio vs per-property basis: a's loss offsets b's profit only on the portfolio basis.
{
  const entries = [exp('a', '2026-05-01', 4000), inc('b', '2026-05-01', 10000)];
  const pool = rentalTaxView(entries, props, 2027, 'portfolio').rental;
  eq(pool.taxable, 6000, 'portfolio: losses pooled');
  eq(pool.carriedForward, 0, 'portfolio: nothing carried');
  const each = rentalTaxView(entries, props, 2027, 'property');
  eq(each.rental.taxable, 10000, 'per property: a’s loss stays with a');
  eq(each.rental.carriedForward, 4000, 'per property: a carries $4,000');
  eq(each.perProperty.a.carriedForward, 4000, 'a on its own');
  eq(rentalTaxView(entries, props, 2027).basis, 'portfolio', 'portfolio is the default');
  eq(isRentalLossBasis('property') && !isRentalLossBasis('pooled'), true, 'basis values');
}

// Your home with rooms let is outside ring-fencing and the interest rule.
{
  const view = rentalTaxView([exp('home', '2024-06-01', 5000, 'interest'), inc('a', '2024-06-01', 1000)], props, 2025);
  eq(view.rental.taxable, 1000, 'home loss is not in the ring-fenced pool');
  eq(view.perProperty.home, undefined, 'home is not a ring-fenced property');
}

// Losses before 2019/20 weren't ring-fenced, so they don't carry.
{
  const r = rentalTaxView([exp('a', '2018-06-01', 7000), inc('a', '2019-06-01', 2000)], props, 2020).rental;
  eq(r.broughtForward, 0, 'no carry from 2018/19');
  eq(r.taxable, 2000, '2019/20 profit taxable');
  eq(rentalTaxView([exp('a', '2018-06-01', 7000)], props, 2019).rental.taxable, 0, 'a pre-ring-fencing year still never shows a negative taxable');
}

// C. Bright-line: settled 1 Aug 2024.
const sale = { purchaseDate: '2024-08-01', purchasePrice: 700000, salePrice: 780000, saleCosts: 25000, ownHome: false };
{
  const inside = brightLineCheck({ ...sale, saleAgreementDate: '2026-07-01' });
  eq(inside.status, 'inside', 'agreement 1 Jul 2026 → inside');
  eq(inside.status === 'inside' && inside.gain, 55000, 'gain = sale − cost − costs');
  eq(inside.status === 'inside' && inside.periodEnds, '2026-08-01', 'period ends 2 years on');
  eq(brightLineCheck({ ...sale, saleAgreementDate: '2026-08-02' }).status, 'outside', 'agreement 2 Aug 2026 → outside');
  eq(brightLineCheck({ ...sale, saleAgreementDate: '2026-08-01' }).status, 'outside', 'the anniversary itself is outside');
  eq(brightLineCheck({ ...sale, saleAgreementDate: '2026-07-31' }).status, 'inside', 'the day before is inside');
  eq(brightLineCheck({ ...sale, saleAgreementDate: '2026-07-01', ownHome: true }).status, 'main_home', 'main home excluded');
  eq(brightLineCheck({ ...sale, saleAgreementDate: null }).status, 'not_sold', 'not sold');
  eq(brightLineCheck({ ...sale, purchaseDate: null, saleAgreementDate: '2026-07-01' }).status, 'no_purchase_date', 'needs a purchase date');
  eq(brightLineCheck({ ...sale, purchaseDate: '2023-01-10', saleAgreementDate: '2024-06-30' }).status, 'earlier_rules', 'before 1 Jul 2024 is flagged');
  const noPrice = brightLineCheck({ ...sale, salePrice: null, saleAgreementDate: '2026-07-01' });
  eq(noPrice.status === 'inside' && noPrice.gain, null, 'no gain without both prices');
  const loss = brightLineCheck({ ...sale, salePrice: 690000, saleAgreementDate: '2026-07-01' });
  eq(loss.status === 'inside' && loss.gain, -35000, 'a loss shows as negative');
}
eq(addYears('2024-02-29', 2), '2026-02-28', '29 Feb in a non-leap year');
eq(addYears('2024-02-29', 4), '2028-02-29', 'and kept in a leap year');

console.log('rental tax tests passed');
