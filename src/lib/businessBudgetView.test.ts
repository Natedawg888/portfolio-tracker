/**
 * Business budget page helpers (KAN-123): months, variance, plan inputs, spreading.
 * Run: npm run test:business
 */
import { monthLabel, planInputs, planPercent, plansFromInputs, spreadEvenly, variance } from './businessBudgetView.ts';
import type { BusinessBudgetLine } from '../types/index.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`FAIL: ${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
  }
}

eq(monthLabel('2026-04'), 'Apr 2026', 'month');
eq(monthLabel('2027-03', true), 'Mar', 'short month');

eq(variance({ kind: 'expense', plannedNzd: null, actualNzd: 5 }), { diffNzd: null, status: null, text: 'Not planned' }, 'no plan');
eq(variance({ kind: 'expense', plannedNzd: 100, actualNzd: 120 }), { diffNzd: 20, status: 'bad', text: 'over plan' }, 'expense over');
eq(variance({ kind: 'expense', plannedNzd: 100, actualNzd: 80 }), { diffNzd: -20, status: 'good', text: 'under plan' }, 'expense under');
eq(variance({ kind: 'income', plannedNzd: 100, actualNzd: 130 }), { diffNzd: 30, status: 'good', text: 'above plan' }, 'income above');
eq(variance({ kind: 'income', plannedNzd: 100, actualNzd: 60 }), { diffNzd: -40, status: 'bad', text: 'below plan' }, 'income below');
eq(variance({ kind: 'income', plannedNzd: 100, actualNzd: 100.001 }).status, 'even', 'on plan');

eq(planPercent({ plannedNzd: 200, actualNzd: 50 }), 25, 'percent used');
eq(planPercent({ plannedNzd: 0, actualNzd: 50 }), null, 'zero plan');
eq(planPercent({ plannedNzd: 100, actualNzd: 150 }), 150, 'over 100');

const label = (p: string) => p;
eq(plansFromInputs({ '2026-04': '1,200', '2026-05': '', '2026-06': '$50.555' }, label), { plans: [{ period: '2026-04', amountNzd: 1200 }, { period: '2026-05', amountNzd: null }, { period: '2026-06', amountNzd: 50.56 }] }, 'inputs to plans');
eq(plansFromInputs({ '2026-04': '-3' }, label), { error: 'Check the amount for 2026-04' }, 'negative refused');
eq(plansFromInputs({ '2027': 'abc' }, label), { error: 'Check the amount for 2027' }, 'text refused');

const months = ['2026-04', '2026-05', '2026-06'];
eq(spreadEvenly(100, months), { '2026-04': '33.33', '2026-05': '33.33', '2026-06': '33.34' }, 'spread with rounding');
eq(spreadEvenly(0, []), {}, 'no months');

const line: BusinessBudgetLine = {
  id: 'c', name: 'Rent', kind: 'expense', role: null, planCadence: 'month', sortOrder: 0, plannedNzd: 250, actualNzd: 0,
  months: [{ month: '2026-04', plannedNzd: 250, actualNzd: 0 }, { month: '2026-05', plannedNzd: null, actualNzd: 0 }],
};
eq(planInputs(line, 2027), { '2026-04': '250', '2026-05': '' }, 'month inputs');
eq(planInputs({ ...line, planCadence: 'year', plannedNzd: null }, 2027), { '2027': '' }, 'year input');

console.log('business budget view: ok');
