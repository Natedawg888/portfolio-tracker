/**
 * Home page preview (example figures only).
 * Run: npm run test:home
 */
import { calculatePaye } from './payeCalc.ts';
import { EXAMPLE_SALARY, PREVIEW_TABS, exampleTakeHome, nextPreviewTab, previewData } from './homePreview.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
const close = (a: number, b: number) => Math.abs(a - b) < 0.01;

// Take-home comes from the PAYE engine, not hard-coded numbers.
const b = exampleTakeHome();
assert(b.annualGross === EXAMPLE_SALARY && b.taxCode === 'M', 'main job, $70,000');
const paye = previewData('paye');
assert(paye.figure === b.takeHome, 'figure is the engine take-home');
assert(close(paye.rows.reduce((s, r) => s + r.amount, 0), EXAMPLE_SALARY), 'rows add up to the salary');
assert(paye.rows.every((r) => r.amount > 0), 'no empty rows');
const again = calculatePaye({
  amount: 70_000, frequency: 'year', hoursPerWeek: 40, employment: 'primary', secondaryTotalAnnualIncome: 0, otherAnnualGross: 0,
  kiwiSaverOptIn: true, kiwiSaverEmployeeRatePct: 3.5, kiwiSaverEmployerRatePct: 3.5, salarySacrifice: false, studentLoan: false,
  ietc: true, payrollGivingAnnual: 0,
});
assert(close(again.takeHome, b.takeHome), 'same as the PAYE page inputs');

// Every tab: a figure, a summary and four rows; net worth and budget figures are their rows' total.
for (const { id } of PREVIEW_TABS) {
  const d = previewData(id);
  assert(d.rows.length === 4 && d.summary && d.figure > 0, `${id} has content`);
  if (id !== 'paye') assert(close(d.figure, d.rows.reduce((s, r) => s + r.amount, 0)), `${id} figure is the rows' total`);
}

// Keyboard.
assert(nextPreviewTab('networth', 'ArrowRight') === 'budget', 'right');
assert(nextPreviewTab('networth', 'ArrowLeft') === 'paye', 'left wraps');
assert(nextPreviewTab('paye', 'ArrowRight') === 'networth', 'right wraps');
assert(nextPreviewTab('budget', 'Home') === 'networth' && nextPreviewTab('budget', 'End') === 'paye', 'home / end');
assert(nextPreviewTab('budget', 'a') === null, 'other keys ignored');

console.log('home preview tests passed');
