/**
 * Splits and settle-up maths (KAN-77 phase 3). Run: npm run test:household
 */
import { balances, settleUp, splitShares } from './splitMath.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
const amounts = (r: ReturnType<typeof splitShares>) => (r.ok ? r.shares.map((s) => s.amountNzd) : r.error);
const sumOf = (r: ReturnType<typeof splitShares>) => (r.ok ? Math.round(r.shares.reduce((s, x) => s + x.amountNzd, 0) * 100) : NaN);

// Equal: exact halves, and odd cents to the first people listed.
assert(JSON.stringify(amounts(splitShares(84.2, 'equal', [{ memberId: 'o' }, { memberId: 'a' }]))) === '[42.1,42.1]', '50/50');
assert(JSON.stringify(amounts(splitShares(10, 'equal', [{ memberId: 'o' }, { memberId: 'a' }, { memberId: 'v' }]))) === '[3.34,3.33,3.33]', 'thirds: the extra cent goes first');
assert(sumOf(splitShares(10, 'equal', [{ memberId: 'o' }, { memberId: 'a' }, { memberId: 'v' }])) === 1000, 'equal shares add up exactly');

// Percent.
assert(JSON.stringify(amounts(splitShares(200, 'percent', [{ memberId: 'o', value: 70 }, { memberId: 'a', value: 30 }]))) === '[140,60]', '70 / 30');
const odd = splitShares(10, 'percent', [{ memberId: 'o', value: 33.33 }, { memberId: 'a', value: 33.33 }, { memberId: 'v', value: 33.34 }]);
assert(sumOf(odd) === 1000, `percent shares add up exactly: ${amounts(odd)}`);
assert(!splitShares(100, 'percent', [{ memberId: 'o', value: 60 }, { memberId: 'a', value: 30 }]).ok, 'percent must total 100');

// Amount.
assert(JSON.stringify(amounts(splitShares(84.2, 'amount', [{ memberId: 'o', value: 50 }, { memberId: 'a', value: 34.2 }]))) === '[50,34.2]', 'by amount');
const bad = splitShares(84.2, 'amount', [{ memberId: 'o', value: 50 }, { memberId: 'a', value: 30 }]);
assert(!bad.ok && bad.error === 'Amounts must add up to 84.20 (they add up to 80.00)', 'amounts must match the total');

// Validation.
assert(!splitShares(10, 'equal', [{ memberId: 'o' }]).ok, 'at least two people');
assert(!splitShares(10, 'equal', [{ memberId: 'o' }, { memberId: 'o' }]).ok, 'no duplicates');
assert(!splitShares(0, 'equal', [{ memberId: 'o' }, { memberId: 'a' }]).ok, 'nothing to split');
assert(!splitShares(10, 'percent', [{ memberId: 'o', value: -10 }, { memberId: 'a', value: 110 }]).ok, 'no negative percentages');

// Balances: Olive paid 84.20 split 50/50; Adam paid 60 split 3 ways; Adam paid Olive 10 back.
const net = balances(
  [
    { payerId: 'o', shares: [{ memberId: 'o', amountNzd: 42.1 }, { memberId: 'a', amountNzd: 42.1 }] },
    { payerId: 'a', shares: [{ memberId: 'o', amountNzd: 20 }, { memberId: 'a', amountNzd: 20 }, { memberId: 'v', amountNzd: 20 }] },
  ],
  [{ fromId: 'a', toId: 'o', amountNzd: 10 }],
);
assert(net.get('o') === 12.1 && net.get('a') === 7.9 && net.get('v') === -20, `balances: ${JSON.stringify([...net])}`);
assert(Math.round([...net.values()].reduce((s, v) => s + v, 0) * 100) === 0, 'balances sum to zero');

// Settle up: Vic owes 20 → pays Olive 12.10 and Adam 7.90.
const plan = settleUp(net);
assert(JSON.stringify(plan) === JSON.stringify([{ fromId: 'v', toId: 'o', amountNzd: 12.1 }, { fromId: 'v', toId: 'a', amountNzd: 7.9 }]), `settle up: ${JSON.stringify(plan)}`);
// Applying the suggestions clears everything.
const after = balances([], [...[...net].map(([id, v]) => ({ fromId: v < 0 ? id : 'x', toId: v < 0 ? 'x' : id, amountNzd: 0 })), ...plan]);
const cleared = new Map([...net].map(([id, v]) => [id, Math.round((v + (after.get(id) ?? 0)) * 100)]));
assert([...cleared.values()].every((c) => c === 0), 'suggested payments settle every balance');
assert(settleUp(new Map([['o', 0], ['a', 0]])).length === 0, 'nothing to settle');

console.log('split maths: ok');
