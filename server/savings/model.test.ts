/**
 * Savings-goal formulas. Amounts are NZD. Dates are calendar dates.
 * Run: npm run test:savings-goals
 */
import { isIsoDate } from '../debts/model.ts';
import {
  calendarDaysBetween,
  parseCreateSavingsGoal,
  parsePatchSavingsGoal,
  savingsGoalProgress,
} from './model.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function eq(actual: number | null | undefined, expected: number, msg: string): void {
  if (actual == null || Math.abs(actual - expected) > 1e-9) {
    throw new Error(`FAIL: ${msg} (got ${actual}, expected ${expected})`);
  }
}

function eqNull(actual: unknown, msg: string): void {
  if (actual != null) throw new Error(`FAIL: ${msg} (got ${actual})`);
}

const asOf = '2026-10-05';

const open = savingsGoalProgress({
  targetNzd: 10000,
  currentAmountNzd: 2500,
  deadline: '2027-04-05',
  asOf,
});
assert(open.currency === 'NZD', 'currency is NZD');
assert(open.timezone === 'Pacific/Auckland', 'timezone is Pacific/Auckland');
assert(open.asOf === asOf, 'asOf is the date passed in');
eq(open.remainingNzd, 7500, 'remaining is target minus current');
eq(open.percentComplete, 25, 'percent complete is current / target × 100');
eq(open.daysRemaining, 182, '5 Oct 2026 to 5 Apr 2027 is 182 days');
eq(open.requiredWeeklySavingNzd, 288.46, 'weekly is remaining × 7 / 182');
eq(open.requiredMonthlySavingNzd, 1254.29, 'monthly is remaining × (365.25 / 12) / 182');
assert(open.estimatedCompletion === '2027-04-05', 'open goal finishes on the deadline');

assert(calendarDaysBetween('2026-10-05', '2027-10-05') === 365, 'non-leap year span is 365 days');
assert(calendarDaysBetween('2023-10-05', '2024-10-05') === 366, 'span across 29 Feb 2024 is 366 days');
assert(calendarDaysBetween('2024-02-28', '2024-03-01') === 2, '2024 includes 29 February');
assert(calendarDaysBetween('2025-02-28', '2025-03-01') === 1, '2025 has no 29 February');

const year = savingsGoalProgress({
  targetNzd: 12000,
  currentAmountNzd: 0,
  deadline: '2027-10-05',
  asOf,
});
eq(year.daysRemaining, 365, 'one non-leap year is 365 days');
eq(year.percentComplete, 0, 'nothing saved yet is 0 percent');
eq(year.requiredWeeklySavingNzd, 230.14, '12000 × 7 / 365 rounds to 230.14');
eq(year.requiredMonthlySavingNzd, 1000.68, 'a 365-day year is a little over 12 mean months');
assert(year.estimatedCompletion === '2027-10-05', 'year goal finishes on the deadline');

const met = savingsGoalProgress({
  targetNzd: 10000,
  currentAmountNzd: 10000,
  deadline: '2027-04-05',
  asOf,
});
eq(met.remainingNzd, 0, 'a met goal has nothing remaining');
eq(met.percentComplete, 100, 'a met goal is 100 percent');
eq(met.requiredWeeklySavingNzd, 0, 'a met goal requires no weekly saving');
eq(met.requiredMonthlySavingNzd, 0, 'a met goal requires no monthly saving');
assert(met.estimatedCompletion === asOf, 'a met goal is complete on the count date');
eq(met.daysRemaining, 182, 'the deadline stays put after the goal is met');

const ahead = savingsGoalProgress({
  targetNzd: 10000,
  currentAmountNzd: 12500,
  deadline: '2027-04-05',
  asOf,
});
eq(ahead.remainingNzd, 0, 'extra savings do not create a negative remainder');
eq(ahead.percentComplete, 125, 'percent complete may exceed 100');
eq(ahead.requiredWeeklySavingNzd, 0, 'nothing further is required when ahead');
assert(ahead.estimatedCompletion === asOf, 'an ahead goal is complete on the count date');

const thirds = savingsGoalProgress({
  targetNzd: 3,
  currentAmountNzd: 1,
  deadline: null,
  asOf,
});
eq(thirds.percentComplete, 33.33, 'one third rounds to 33.33 percent');
const twoThirds = savingsGoalProgress({
  targetNzd: 3,
  currentAmountNzd: 2,
  deadline: null,
  asOf,
});
eq(twoThirds.percentComplete, 66.67, 'two thirds round to 66.67 percent');

const undated = savingsGoalProgress({
  targetNzd: 10000,
  currentAmountNzd: 2500,
  deadline: null,
  asOf,
});
eq(undated.percentComplete, 25, 'percent complete does not need a deadline');
eqNull(undated.daysRemaining, 'no deadline leaves days remaining blank');
eqNull(undated.requiredWeeklySavingNzd, 'no deadline leaves weekly saving blank');
eqNull(undated.requiredMonthlySavingNzd, 'no deadline leaves monthly saving blank');
eqNull(undated.estimatedCompletion, 'no deadline leaves estimated completion blank');

const missed = savingsGoalProgress({
  targetNzd: 10000,
  currentAmountNzd: 2500,
  deadline: '2026-09-01',
  asOf,
});
assert(missed.daysRemaining != null && missed.daysRemaining < 0, 'a past deadline is negative days');
eqNull(missed.requiredWeeklySavingNzd, 'a missed deadline has no weekly pace');
eqNull(missed.requiredMonthlySavingNzd, 'a missed deadline has no monthly pace');
eqNull(missed.estimatedCompletion, 'a missed deadline does not invent a later date');

const dueToday = savingsGoalProgress({
  targetNzd: 4000,
  currentAmountNzd: 1500,
  deadline: asOf,
  asOf,
});
eq(dueToday.daysRemaining, 0, 'a deadline of today is zero days');
eq(dueToday.remainingNzd, 2500, 'today still has a gap');
eq(dueToday.requiredWeeklySavingNzd, 2500, 'a gap due today is not spread across a week');
eq(dueToday.requiredMonthlySavingNzd, 2500, 'a gap due today is not spread across a month');
assert(dueToday.estimatedCompletion === asOf, 'a goal due today finishes today if the gap is saved');

const metLate = savingsGoalProgress({
  targetNzd: 1000,
  currentAmountNzd: 1000,
  deadline: '2026-01-01',
  asOf,
});
eq(metLate.requiredWeeklySavingNzd, 0, 'already met, even after the deadline, requires nothing');
assert(metLate.estimatedCompletion === asOf, 'already met is the count date, not the old deadline');

const created = parseCreateSavingsGoal({
  name: '  Holiday  ',
  targetNzd: '10000.126',
  currentAmountNzd: '2500.004',
  deadline: ' 2027-04-05 ',
  notes: '  beach ',
});
assert(created.ok, 'a trimmed goal is accepted');
if (created.ok) {
  assert(created.value.name === 'Holiday', 'name is trimmed');
  eq(created.value.targetNzd, 10000.13, 'target rounds to cents');
  eq(created.value.currentAmountNzd, 2500, 'sub-cent current rounds away');
  assert(created.value.deadline === '2027-04-05', 'deadline is trimmed');
  assert(created.value.notes === 'beach', 'notes are trimmed');
}

const defaults = parseCreateSavingsGoal({ name: 'Emergency', targetNzd: 1000 });
assert(defaults.ok && defaults.value.currentAmountNzd === 0, 'current defaults to 0');
assert(defaults.ok && defaults.value.deadline == null, 'deadline defaults to blank');
assert(defaults.ok && defaults.value.notes == null, 'notes default to blank');

assert(isIsoDate('2024-02-29'), '2024-02-29 is a real date');
const leap = parseCreateSavingsGoal({ name: 'Leap', targetNzd: 1, deadline: '2024-02-29' });
assert(leap.ok && leap.value.deadline === '2024-02-29', '29 February 2024 is accepted');

function rejected(body: unknown, error: string): void {
  const parsed = parseCreateSavingsGoal(body);
  assert(!parsed.ok && parsed.error === error, `expected ${error}, got ${parsed.ok ? 'ok' : parsed.error}`);
}

rejected({}, 'name is required');
rejected({ name: '   ', targetNzd: 10 }, 'name is required');
rejected({ name: 'A' }, 'targetNzd must be a positive number');
rejected({ name: 'A', targetNzd: 0 }, 'targetNzd must be a positive number');
rejected({ name: 'A', targetNzd: -5 }, 'targetNzd must be a positive number');
rejected({ name: 'A', targetNzd: 0.001 }, 'targetNzd must be a positive number');
rejected({ name: 'A', targetNzd: 10, currentAmountNzd: -1 }, 'currentAmountNzd must be a non-negative number');
rejected({ name: 'A', targetNzd: 10, deadline: '2026-02-29' }, 'deadline must be YYYY-MM-DD or blank');
rejected({ name: 'A', targetNzd: 10, deadline: '2026-04-31' }, 'deadline must be YYYY-MM-DD or blank');
rejected({ name: 'A', targetNzd: 10, deadline: '5 Oct 2026' }, 'deadline must be YYYY-MM-DD or blank');
rejected({ name: 'A', targetNzd: 10, notes: 4 }, 'notes must be a string or null');

const cleared = parsePatchSavingsGoal({ deadline: null, notes: '', currentAmountNzd: '0' });
assert(cleared.ok, 'patch can clear optional fields');
if (cleared.ok) {
  assert(cleared.value.deadline == null, 'null deadline clears it');
  assert(cleared.value.notes == null, 'blank notes clear them');
  eq(cleared.value.currentAmountNzd, 0, 'current can be set back to 0');
  assert(!Object.prototype.hasOwnProperty.call(cleared.value, 'name'), 'omitted name stays omitted');
  assert(!Object.prototype.hasOwnProperty.call(cleared.value, 'targetNzd'), 'omitted target stays omitted');
}

const emptyPatch = parsePatchSavingsGoal({});
assert(emptyPatch.ok && Object.keys(emptyPatch.value).length === 0, 'an empty patch changes nothing');
const badPatch = parsePatchSavingsGoal({ name: '' });
assert(!badPatch.ok && badPatch.error === 'name is required', 'a blank rename is rejected');

console.log('savings goal formula tests passed');
