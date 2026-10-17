/**
 * Rental tax rules (KAN-93): interest limitation, loss ring-fencing, bright-line. Figures worked by hand.
 * Run: npm run test:rentals
 */
import { addYears, brightLine, interestRule, rentalTaxYear } from './rentalTax.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

type E = { propertyId: string; date: string; kind: 'income' | 'expense'; category: string; amountNzd: number };
const inc = (propertyId: string, date: string, amountNzd: number): E => ({ propertyId, date, kind: 'income', category: 'rent', amountNzd });
const exp = (propertyId: string, date: string, amountNzd: number, category = 'rates'): E => ({ propertyId, date, kind: 'expense', category, amountNzd });
const flat = { id: 'a', ownHome: false, newBuild: false };

// A. Interest: 80% in 2024/25 (year 2025), 100% from 2025/26.
assert(interestRule(2025).share === 0.8 && interestRule(2026).share === 1 && interestRule(2027).share === 1, 'interest shares');
assert(interestRule(2024).note && !interestRule(2026).note, 'earlier years flagged');
let t = rentalTaxYear([flat], [inc('a', '2024-06-01', 20000), exp('a', '2024-07-01', 10000, 'interest')], 2025, 'portfolio');
assert(t.interest === 10000 && t.deductibleInterest === 8000, `2024/25: $10,000 → $8,000 (${t.deductibleInterest})`);
assert(t.net === 12000 && t.taxable === 12000, 'net counts interest at 80%');
t = rentalTaxYear([flat], [inc('a', '2025-06-01', 20000), exp('a', '2025-07-01', 10000, 'interest')], 2026, 'portfolio');
assert(t.deductibleInterest === 10000 && t.net === 10000, '2025/26: $10,000 → $10,000');
t = rentalTaxYear([{ ...flat, newBuild: true }], [exp('a', '2024-07-01', 10000, 'interest')], 2025, 'portfolio');
assert(t.deductibleInterest === 10000, 'new build not limited');
t = rentalTaxYear([{ id: 'h', ownHome: true, newBuild: false }], [exp('h', '2024-07-01', 1000, 'interest')], 2025, 'portfolio');
assert(t.deductibleInterest === 1000, 'own home not limited');
// Boundaries: 31 March 2025 is 2024/25; 1 April 2025 isn't.
t = rentalTaxYear([flat], [exp('a', '2025-03-31', 100, 'interest'), exp('a', '2025-04-01', 100, 'interest')], 2025, 'portfolio');
assert(t.interest === 100 && t.deductibleInterest === 80, 'year boundary');

// B. Ring-fencing: $5,000 loss then $8,000 profit → 0 taxable, $5,000 carried; then $3,000 taxable.
const ledger = [inc('a', '2025-05-01', 10000), exp('a', '2025-06-01', 15000), inc('a', '2026-05-01', 20000), exp('a', '2026-06-01', 12000)];
const y1 = rentalTaxYear([flat], ledger, 2026, 'portfolio');
assert(y1.net === -5000 && y1.taxable === 0 && y1.carriedForward === 5000, `year 1 ${JSON.stringify(y1)}`);
const y2 = rentalTaxYear([flat], ledger, 2027, 'portfolio');
assert(y2.net === 8000 && y2.broughtForward === 5000 && y2.taxable === 3000 && y2.carriedForward === 0, `year 2 ${JSON.stringify(y2)}`);
// The taxable figure never goes below 0, so a loss never reduces other income.
for (const y of [2026, 2027, 2028]) assert(rentalTaxYear([flat], ledger, y, 'portfolio').taxable >= 0, `never negative ${y}`);
// A year with no entries keeps the loss.
const gap = rentalTaxYear([flat], [exp('a', '2025-06-01', 1000), inc('a', '2027-06-01', 600)], 2028, 'portfolio');
assert(gap.broughtForward === 1000 && gap.taxable === 0 && gap.carriedForward === 400, 'carried over an empty year');

// Portfolio vs per property: A loses 5,000, B makes 3,000 in the same year.
const two = [{ id: 'a', ownHome: false, newBuild: false }, { id: 'b', ownHome: false, newBuild: false }];
const mixed = [exp('a', '2025-06-01', 5000), inc('b', '2025-06-01', 3000)];
const port = rentalTaxYear(two, mixed, 2026, 'portfolio');
assert(port.net === -2000 && port.taxable === 0 && port.carriedForward === 2000, 'portfolio offsets across properties');
const per = rentalTaxYear(two, mixed, 2026, 'property');
assert(per.taxable === 3000 && per.carriedForward === 5000, 'per property: B taxable, A carries its own loss');
assert(per.properties.a.carriedForward === 5000 && per.properties.b.taxable === 3000, 'per-property figures');
const perNext = rentalTaxYear(two, [...mixed, inc('b', '2026-06-01', 4000)], 2027, 'property');
assert(perNext.taxable === 4000 && perNext.carriedForward === 5000, 'A’s loss can’t be used against B');

// Own home with boarders is outside the ring-fence.
const home = [{ id: 'h', ownHome: true, newBuild: false }, flat];
const withHome = rentalTaxYear(home, [exp('h', '2025-06-01', 700), inc('a', '2025-06-01', 1000)], 2026, 'portfolio');
assert(withHome.outsideNet === -700 && withHome.net === 1000 && withHome.taxable === 1000, 'own home left out');
assert(!withHome.properties.h.ringFenced && withHome.properties.a.ringFenced, 'ring-fenced flags');
// Before 2019/20 there's no ring-fencing, so nothing carries.
const old = rentalTaxYear([flat], [exp('a', '2018-06-01', 1000)], 2020, 'portfolio');
assert(old.broughtForward === 0, 'losses before 2019/20 not carried');

// C. Bright-line (sale agreement on or after 1 July 2024: 2 years).
const sale = { purchaseDate: '2024-08-01', purchaseCostNzd: 700000, salePriceNzd: 780000, saleCostsNzd: 20000, mainHome: false };
let b = brightLine({ ...sale, saleAgreementDate: '2026-07-01' });
assert(b?.status === 'inside' && b.endsOn === '2026-08-01' && b.gainNzd === 60000, `inside ${JSON.stringify(b)}`);
b = brightLine({ ...sale, saleAgreementDate: '2026-08-02' });
assert(b?.status === 'outside' && b.gainNzd === null, 'outside');
assert(brightLine({ ...sale, saleAgreementDate: '2026-08-01' })?.status === 'inside', 'anniversary counted inside');
assert(brightLine({ ...sale, saleAgreementDate: '2026-07-01', mainHome: true })?.status === 'main_home', 'main home excluded');
assert(brightLine({ ...sale, saleAgreementDate: '2024-06-30' })?.status === 'older_rules', 'older sales flagged');
assert(brightLine({ ...sale, purchaseDate: null, saleAgreementDate: '2025-01-01' })?.status === 'incomplete', 'needs the settlement date');
assert(brightLine({ ...sale, saleAgreementDate: null }) === null, 'not sold');
assert(brightLine({ ...sale, salePriceNzd: null, saleAgreementDate: '2025-01-01' })?.gainNzd === null, 'gain needs the price');
assert(brightLine({ ...sale, salePriceNzd: 650000, saleAgreementDate: '2025-01-01' })?.gainNzd === -70000, 'a loss');
assert(addYears('2024-02-29', 2) === '2026-02-28' && addYears('2024-08-01', 2) === '2026-08-01', 'addYears');

console.log('rental tax tests passed');
