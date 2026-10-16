/**
 * Transaction categories card wording and stable category colours. Run: npm run test:settings-categories
 */
import { isBuiltInCategory, monthTotalText, usageText } from './categoryManagerView.ts';
import { CATEGORY_PALETTE, categoryColourFor, paletteName, UNCATEGORISED_COLOUR } from './categoryColours.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

const money = (n: number) => `$${n.toFixed(2)}`;
const none = { transactions: 0, incomeRecords: 0, budgetPlans: 0, incomePlans: 0, payeeRules: 0, recurring: 0, shopping: 0 };
eq(usageText(none), '', 'nothing uses it');
eq(usageText({ ...none, transactions: 1 }), '1 transaction', 'one thing');
eq(usageText({ ...none, transactions: 12, budgetPlans: 1, payeeRules: 2 }), '12 transactions, 1 budget plan and 2 payee rules', 'list');
eq(monthTotalText(500.61, 'Oct', money), '$500.61 in Oct', 'month total');
eq(monthTotalText(0, 'Oct', money), 'Not used in Oct', 'unused this month');
eq(monthTotalText(undefined, 'Oct', money), 'Not used in Oct', 'no data');
eq(isBuiltInCategory('cat-debt'), true, 'debt is built in');
eq(isBuiltInCategory('cat-rental'), true, 'rental costs are built in');
eq(isBuiltInCategory('cat-food'), false, 'food is not');
eq(isBuiltInCategory(null), false, 'no slug');

// Auto colour: by place among categories of the same type (sort order, then id), whatever the spending order.
const cats = [
  { id: 'inc', type: 'income', colour: null, sortOrder: 0 },
  { id: 'food', type: 'spending', colour: null, sortOrder: 10 },
  { id: 'car', type: 'spending', colour: '#123456', sortOrder: 20 },
  { id: 'fun', type: 'spending', colour: 'not-a-colour', sortOrder: 30 },
  { id: 'out', type: 'transfer_out', colour: null, sortOrder: 80 },
];
eq(categoryColourFor(cats, 'inc'), CATEGORY_PALETTE[0], 'first income category');
eq(categoryColourFor(cats, 'food'), CATEGORY_PALETTE[0], 'first spending category');
eq(categoryColourFor(cats, 'car'), '#123456', 'saved colour wins');
eq(categoryColourFor(cats, 'fun'), CATEGORY_PALETTE[2], 'invalid saved colour falls back to its place');
eq(categoryColourFor(cats, 'out'), CATEGORY_PALETTE[0], 'first transfer category');
eq(categoryColourFor(cats, 'gone'), UNCATEGORISED_COLOUR, 'unknown category');
// Same sort order: ordered by id, so a rename (which re-sorts the list by name) keeps the colour.
const custom = [
  { id: 'cat-pets', name: 'Dog', type: 'spending', sortOrder: 100 },
  { id: 'cat-hobbies', name: 'Hobbies', type: 'spending', sortOrder: 100 },
];
eq(categoryColourFor(custom, 'cat-hobbies'), CATEGORY_PALETTE[0], 'hobbies by id');
eq(categoryColourFor([...custom].reverse(), 'cat-pets'), CATEGORY_PALETTE[1], 'pets keeps its colour in any list order');
eq(categoryColourFor([{ id: 'b', sortOrder: 1 }, { id: 'a', sortOrder: 2 }], 'b'), CATEGORY_PALETTE[0], 'sort order before id');
eq(paletteName('#4A8FD4'), 'Blue', 'palette names ignore case');
eq(paletteName('#123456'), null, 'custom colour has no name');

console.log('categoryManagerView.test.ts ok');
