/**
 * Onboarding budget categories: the checklist starts from what is saved, built-in categories
 * can't be unticked, the draft survives a reload, and Continue removes / recreates the right ones.
 * Also the "Step 3 of 3" counter. Run: npm run test:onboarding-categories
 */
import { DEFAULT_CATEGORY_SEEDS } from './categoryDefaults.ts';
import {
  addRow,
  buildRows,
  draftFromRows,
  parseDraft,
  savePlan,
  tickedCount,
  toggleRow,
  withDefaults,
  type SavedCategory,
} from './onboardingCategories.ts';
import { stepLabel } from './onboardingSteps.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// A new account: every starter category saved, with per-user ids.
const saved: SavedCategory[] = DEFAULT_CATEGORY_SEEDS.map((s) => ({ id: `${s.slug}__u1`, slug: s.slug, name: s.name, type: s.type, sortOrder: s.sortOrder }));
let rows = buildRows(saved);
assert(rows.length === DEFAULT_CATEGORY_SEEDS.length && rows.every((r) => r.ticked && r.source === 'saved'), 'starts with the starter set, all ticked');
const locked = rows.filter((r) => r.locked).map((r) => r.name).sort();
assert(
  JSON.stringify(locked) === JSON.stringify(['Charity', 'Debt', 'Dividends & interest', 'Income', 'Investments', 'Mining']),
  `the six built-in categories are always included (${locked.join(', ')})`,
);
assert(rows.find((r) => r.name === 'Debt')?.reason === 'Used for debt repayments.', 'locked rows say why');
assert(rows.find((r) => r.name === 'Salary')?.locked === false, 'Salary can be unticked (payslips recreate it when needed)');

// Unticking: a locked row doesn't change; others do.
const debt = rows.find((r) => r.name === 'Debt')!;
assert(toggleRow(rows, debt.key).find((r) => r.key === debt.key)?.ticked === true, 'Debt stays ticked');
const subs = rows.find((r) => r.name === 'Subscriptions')!;
rows = toggleRow(rows, subs.key);
assert(tickedCount(rows) === DEFAULT_CATEGORY_SEEDS.length - 1, 'count drops by one');
assert(tickedCount(rows, 'spending') === rows.filter((r) => r.type === 'spending').length - 1, 'per-tab count');

// Adding: ticked, deduplicated per tab, refused when ticked in another tab.
let out = addRow(rows, 'spending', '  Pets ');
assert(out.message === null && out.rows.find((r) => r.name === 'Pets')?.ticked, 'Pets added, ticked');
rows = out.rows;
assert(addRow(rows, 'spending', 'pets').message?.includes('already'), 'same name in the same tab is not added twice');
out = addRow(rows, 'spending', 'subscriptions');
assert(out.message === null && out.rows.find((r) => r.key === subs.key)?.ticked, 'adding an unticked name ticks it again');
assert(addRow(rows, 'income', 'Pets').message?.includes('Spending'), 'a name ticked in another tab is refused with where it is');
assert(addRow(rows, 'spending', 'x'.repeat(81)).message?.includes('80'), 'long names refused');

// Continue: delete what was unticked, create what was added.
let plan = savePlan(rows);
assert(plan.remove.length === 1 && plan.remove[0].name === 'Subscriptions', 'unticked starter category is removed');
assert(plan.create.length === 1 && plan.create[0].name === 'Pets' && plan.create[0].slug === undefined, 'new category created without a slug');

// The draft survives a reload and rebuilds the same choices.
const draft = parseDraft(JSON.stringify(draftFromRows(rows)));
const reloaded = buildRows(saved, draft);
assert(reloaded.find((r) => r.key === subs.key)?.ticked === false, 'reload: still unticked');
assert(reloaded.find((r) => r.name === 'Pets')?.ticked === true, 'reload: Pets still there');
assert(parseDraft('{oops') === null && parseDraft(null) === null, 'bad drafts ignored');

// Back after saving: Subscriptions was deleted, so it comes back unticked, not as a default.
const afterSave = saved.filter((c) => c.slug !== 'cat-subscriptions').concat([{ id: 'cat-pets__u1', slug: 'cat-pets__u1', name: 'Pets', type: 'spending', sortOrder: 100 }]);
rows = buildRows(afterSave);
const back = rows.find((r) => r.slug === 'cat-subscriptions')!;
assert(back.source === 'starter' && !back.ticked, 'a removed starter category shows unticked');
assert(rows.find((r) => r.name === 'Pets')?.ticked, 'saved custom category shows ticked');
plan = savePlan(toggleRow(rows, back.key));
assert(plan.create[0]?.slug === 'cat-subscriptions' && plan.create[0]?.id === 'cat-subscriptions', 're-ticking recreates it with its slug');

// Use the defaults: the starter set back, nothing new, nothing removed.
const defaults = withDefaults(addRow(rows, 'income', 'Tips').rows);
plan = savePlan(defaults);
assert(plan.remove.length === 0, 'defaults remove nothing');
assert(plan.create.length === 1 && plan.create[0].slug === 'cat-subscriptions', 'defaults recreate the removed starter category only');
assert(!defaults.some((r) => r.name === 'Tips'), 'defaults drop unsaved additions');

// Step counter.
assert(stepLabel('budgets', { crypto: false, offerAkahu: false }) === 'Step 3 of 3', 'budgets is 3 of 3 without crypto');
assert(stepLabel('budgets', { crypto: true, offerAkahu: false }) === 'Step 4 of 4', 'wallets step adds one');
assert(stepLabel('assets', { crypto: true, offerAkahu: true }) === 'Step 2 of 5', 'Akahu step counted when offered');
assert(stepLabel('wallets', { crypto: false, offerAkahu: false }) === null, 'a step that does not apply has no label');

console.log('onboarding categories: ok');
