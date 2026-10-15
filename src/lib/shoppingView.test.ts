/**
 * Shopping list page helpers. Run: npm run test:shopping
 */
import { budgetBar, cheapestComparable, daysAgo, displayBranch, qtyText, stepQty, storeKey } from './shoppingView.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// Branch display: only all-lowercase words are capitalised.
assert(displayBranch('royal  oak') === 'Royal Oak', 'lowercase words capitalised, spaces tidied');
assert(displayBranch('McLeod Road') === 'McLeod Road', 'words with capitals kept');
assert(displayBranch('CBD') === 'CBD', 'acronyms kept');
assert(storeKey({ chain: 'paknsave', branch: ' Royal  Oak ' }) === 'paknsave|royal oak', 'store key matches the server’s');

// Within the plan: $400 plan, $100 spent, $50 list → $250 left after the list.
let b = budgetBar(400, 100, 50);
assert(near(b.spentPct, 25) && near(b.listPct, 12.5) && b.planMarkPct === null, 'shares of the plan');
assert(b.afterList === 250 && !b.over && b.overBy === 0, 'left after the list');

// Over: $400 plan, $380 spent, $50 list → $30 over; bar scaled to $430 with the plan marked.
b = budgetBar(400, 380, 50);
assert(b.over && b.overBy === 30 && b.afterList === -30, 'over by $30');
assert(near(b.spentPct + b.listPct, 100) && near(b.planMarkPct ?? 0, (400 / 430) * 100), 'bar scaled to the total, plan marked');

// Already overspent before the list.
b = budgetBar(400, 450, 20);
assert(b.over && b.overBy === 70, 'over by spent overrun plus the list');

// Money is rounded to cents.
assert(budgetBar(100, 33.333, 33.333).afterList === 33.33, 'cents');

// Dates, quantities, stepper.
assert(daysAgo('2026-10-15', '2026-10-15') === 'today' && daysAgo('2026-10-14', '2026-10-15') === 'yesterday', 'today / yesterday');
assert(daysAgo('2026-10-12', '2026-10-15') === '3 days ago' && daysAgo('2026-10-16', '2026-10-15') === 'today', 'days ago; future treated as today');
assert(qtyText(2) === '2' && qtyText(1.2) === '1.2' && qtyText(0.25) === '0.25', 'quantity text');
assert(stepQty(2, 1) === 3 && stepQty(2, -1) === 1 && stepQty(1, -1) === 1, 'stepper, minimum 1');
assert(stepQty(1.2, 1) === 2 && stepQty(1.2, -1) === 1 && stepQty(2.5, -1) === 2, 'fractional quantities step to whole numbers');

// Cheapest only when the totals cover the same items.
const st = (total: number, priced: Record<string, number | null>) => ({ total, pricedCount: Object.values(priced).filter((v) => v != null).length, items: priced });
const a = st(13.07, { milk: 8.58, bread: 4.49, eggs: null });
const w = st(14.57, { milk: 9.58, bread: 4.99, eggs: null });
assert(cheapestComparable([a, w]).store === a, 'same items: the cheaper one');
const n = st(9, { milk: 9, bread: null, eggs: null });
const r = cheapestComparable([a, w, n]);
assert(r.store === null && !r.sameItems, 'different items: no cheapest, even though one total is lower');
assert(cheapestComparable([a]).store === null, 'one store: nothing to compare');
assert(cheapestComparable([st(0, { milk: null }), st(0, { milk: null })]).store === null, 'nothing priced: none');
assert(cheapestComparable([st(5, { milk: 5 }), st(5, { milk: 5 })]).store === null, 'a tie: none');

console.log('shopping view: ok');
