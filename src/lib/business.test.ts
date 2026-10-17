/**
 * Business helpers (KAN-84): quantity movements never go below zero, values come only from
 * what the user entered, and the GST figure is 3/23 of GST-inclusive income.
 * Run: npm run test:business
 */
import { assetValue, gstCollectedEstimate, movementDelta, quantityAfter, roundQty } from './business.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(movementDelta('purchase', 5) === 5 && movementDelta('birth', 2) === 2, 'purchases and births add');
assert(movementDelta('sale', 5) === -5 && movementDelta('death', 1) === -1 && movementDelta('loss', 3) === -3, 'sales, deaths and losses take away');
assert(quantityAfter(40, 'death', 3) === 37, '40 hives less 3 dead');
assert(quantityAfter(2, 'sale', 3) === null, 'can’t sell more than there are');
assert(quantityAfter(0.1, 'purchase', 0.2) === 0.3, 'decimal quantities stay tidy');
assert(roundQty(1.23456) === 1.235, 'three decimal places');

const hive = { quantity: 40, valueMode: 'per_unit' as const, valueNzd: 350, category: 'beehives', status: 'active' };
assert(assetValue(hive) === 14000, 'per-hive value × count');
assert(assetValue({ ...hive, valueMode: 'total' }) === 350, 'total value as entered');
assert(assetValue({ ...hive, valueNzd: null }) === null, 'no value entered → unknown, not zero');
assert(assetValue({ ...hive, status: 'sold' }) === 0, 'sold hives are no longer held');

assert(gstCollectedEstimate(1150) === 150, '3/23 of $1,150');
assert(gstCollectedEstimate(-10) === 0, 'never negative');

console.log('business helpers: ok');

// ---- Business pages redesign: entries, setup steps, type notes.
{
  const { entriesText, setupSteps, isUnstarted, BUSINESS_TYPE_NOTES, BUSINESS_TYPES } = await import('./business.ts');
  const ok = (cond: unknown, msg: string) => {
    if (!cond) throw new Error(`FAIL: ${msg}`);
  };
  ok(entriesText({ invoices: 0, tagged: 0 }) === 'nothing recorded yet', 'nothing recorded');
  ok(entriesText({ invoices: 1, tagged: 0 }) === '1 entry this tax year', 'one entry');
  ok(entriesText({ invoices: 2, tagged: 3 }) === '5 entries this tax year', 'entries add up');
  const none = { incomeNzd: 0, expensesNzd: 0 };
  ok(isUnstarted(none, { invoices: 0, tagged: 0 }), 'unstarted');
  ok(!isUnstarted(none, { invoices: 1, tagged: 0 }), 'an unpaid invoice counts as started');
  let steps = setupSteps(none, { invoices: 0, tagged: 0 });
  ok(steps.every((s) => !s.done) && steps.length === 3, 'nothing ticked');
  steps = setupSteps({ incomeNzd: 0, expensesNzd: 0 }, { invoices: 1, tagged: 0 });
  ok(steps[0].done && !steps[1].done && !steps[2].done, 'an invoice ticks money in');
  steps = setupSteps({ incomeNzd: 0, expensesNzd: 40 }, { invoices: 0, tagged: 1 });
  ok(!steps[0].done && steps[1].done && steps[2].done, 'a tagged cost ticks cost and tagging');
  ok(BUSINESS_TYPES.every((t) => BUSINESS_TYPE_NOTES[t.value].length > 0), 'a note for every type');
  console.log('business pages helpers passed');
}
