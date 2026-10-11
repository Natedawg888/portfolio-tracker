/**
 * Budget page view logic. Run: npm run test:budget
 */
import { categoryDirectionMismatch } from './categoryTypes.ts';
import { AHEAD_OF_PACE_POINTS, budgetUsed, dailyAverage, matchesTxnFilter, monthProgress, percentOfPlan, planStatus, spendInsight } from './budgetView.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}

const oct = { year: 2026, month: 10 };
const now = monthProgress(oct, '2026-10-11');
eq(now.state, 'current', 'October is current on 11 Oct');
eq(now.state === 'current' ? now.day : null, 11, 'day 11');
eq(now.daysInMonth, 31, 'October has 31 days');
eq(Math.round(now.fraction * 1000), 355, '11 of 31 days gone');
eq(monthProgress(oct, '2026-10-31').fraction, 1, 'last day is the whole month');
eq(monthProgress(oct, '2026-11-02').state, 'past', 'after the month');
eq(monthProgress({ year: 2026, month: 11 }, '2026-10-11').state, 'future', 'before the month');
eq(monthProgress({ year: 2028, month: 2 }, '2028-02-10').daysInMonth, 29, 'leap February');

eq(budgetUsed(120, 0), null, 'no plan, no budget used');
eq(budgetUsed(300, 400)?.fraction, 0.75, 'spent in planned ÷ planned');
eq(budgetUsed(500, 400)?.fraction, 1.25, 'over plan is not capped');

const rows = [
  { categoryId: null, name: 'Uncategorised', spend: 900 },
  { categoryId: 'cat-food', name: 'Groceries', spend: 412 },
  { categoryId: 'cat-rent', name: 'Rent', spend: 300 },
  { categoryId: 'cat-fun', name: 'Fun', spend: 68 },
];
const insight = spendInsight(rows, new Set(['cat-rent']));
eq(insight?.largest.name, 'Groceries', 'largest categorised spend, not uncategorised');
eq(insight?.largest.spend, 412, 'its amount');
eq(insight?.unplannedTotal, 1380, 'unplanned includes uncategorised');
eq(spendInsight(rows, new Set(['cat-food'])), null, 'largest has a plan: no insight');
eq(spendInsight([{ categoryId: null, name: 'Uncategorised', spend: 50 }], new Set()), null, 'nothing categorised: no insight');
eq(spendInsight([], new Set()), null, 'no spending: no insight');

eq(percentOfPlan(346, 100), 346, 'over-budget percent is not capped');
eq(percentOfPlan(5, 0), null, 'no plan amount, no percent');

const day12 = monthProgress(oct, '2026-10-12'); // 38.7% of the month
eq(planStatus(30, 100, day12).kind, 'on_track', '30% spent on day 12 is on track');
eq(planStatus(48, 100, day12).kind, 'on_track', `within ${AHEAD_OF_PACE_POINTS} points is on track`);
eq(planStatus(55, 100, day12).kind, 'ahead', '55% spent on day 12 is ahead of pace');
const over = planStatus(346, 100, day12);
eq(over.kind, 'over', 'over plan');
eq(over.kind === 'over' ? over.overBy : null, 246, 'over by the difference');
eq(over.kind === 'over' ? over.percent : null, 346, 'real percent');
eq(planStatus(100, 100, day12).kind, 'ahead', 'exactly on plan early in the month is ahead of pace, not over');
eq(planStatus(90, 100, monthProgress(oct, '2026-11-05')).kind, 'within', 'finished month within plan');
eq(planStatus(0, 100, monthProgress({ year: 2026, month: 12 }, '2026-10-11')).kind, 'on_track', 'future month');
eq(planStatus(5, 0, day12).kind, 'over', 'spending against a $0 plan is over');

eq(categoryDirectionMismatch('transfer_out', 120), true, 'money in as Transfer out is flagged');
eq(categoryDirectionMismatch('income', -50), true, 'money out as Income is flagged');
eq(categoryDirectionMismatch('transfer_in', -50), true, 'money out as Transfer in is flagged');
eq(categoryDirectionMismatch('spending', 30), false, 'a refund in a spending category is fine');
eq(categoryDirectionMismatch('transfer_out', -30), false, 'money out as Transfer out is fine');
eq(categoryDirectionMismatch('income', 0), false, 'zero amount never flagged');

eq(dailyAverage(110, ['2026-10-01', '2026-10-05'], now), 10, 'received ÷ 11 days gone');
eq(dailyAverage(4000, ['2026-10-01'], now), null, 'one payday is not a daily rate');
eq(dailyAverage(4000, ['2026-10-01', '2026-10-01'], now), null, 'same day twice is still one day');
eq(dailyAverage(310, ['2026-10-01', '2026-10-20'], monthProgress(oct, '2026-11-02')), 10, 'past month uses all its days');

const types = new Map([
  ['cat-food', 'spending'],
  ['cat-xout', 'transfer_out'],
  ['cat-xin', 'transfer_in'],
]);
eq(matchesTxnFilter({ categoryId: null }, { kind: 'needs' }, types), true, 'uncategorised needs a category');
eq(matchesTxnFilter({ categoryId: 'cat-food' }, { kind: 'needs' }, types), false, 'categorised does not');
eq(matchesTxnFilter({ categoryId: 'cat-xout' }, { kind: 'transfers' }, types), true, 'transfer out is a transfer');
eq(matchesTxnFilter({ categoryId: 'cat-xin' }, { kind: 'transfers' }, types), true, 'transfer in is a transfer');
eq(matchesTxnFilter({ categoryId: 'cat-food' }, { kind: 'transfers' }, types), false, 'spending is not');
eq(matchesTxnFilter({ categoryId: 'cat-food' }, { kind: 'category', categoryId: 'cat-food' }, types), true, 'category filter');
eq(matchesTxnFilter({ categoryId: null }, { kind: 'all' }, types), true, 'all');

console.log('budgetView: ok');
