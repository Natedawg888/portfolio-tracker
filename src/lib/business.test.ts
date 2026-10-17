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
