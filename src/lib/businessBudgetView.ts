/**
 * Business budget page helpers (KAN-123): month labels, planned vs actual, the plan editor's
 * inputs, and spreading a total evenly over months. Amounts are NZD, rounded to cents.
 */
import type { BusinessBudgetLine } from '../types/index.ts';

const round2 = (n: number) => Math.round(n * 100) / 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-04' → 'Apr 2026' (or 'Apr' when short). */
export function monthLabel(month: string, short = false): string {
  const [y, m] = month.split('-').map(Number);
  const name = MONTHS[(m || 1) - 1] ?? month;
  return short ? name : `${name} ${y}`;
}

export type VarianceStatus = 'good' | 'bad' | 'even' | null;

/**
 * Actual against plan. For income, more than planned is good; for an expense, less is. null
 * when nothing is planned.
 */
export function variance(line: Pick<BusinessBudgetLine, 'kind' | 'plannedNzd' | 'actualNzd'>): { diffNzd: number | null; status: VarianceStatus; text: string } {
  if (line.plannedNzd == null) return { diffNzd: null, status: null, text: 'Not planned' };
  const diff = round2(line.actualNzd - line.plannedNzd);
  if (Math.abs(diff) < 0.005) return { diffNzd: 0, status: 'even', text: 'On plan' };
  const ahead = line.kind === 'income' ? diff > 0 : diff < 0;
  const word = line.kind === 'income' ? (diff > 0 ? 'above' : 'below') : diff > 0 ? 'over' : 'under';
  return { diffNzd: diff, status: ahead ? 'good' : 'bad', text: `${word} plan` };
}

/** How much of the plan is used, 0–100+ (for a bar); null with no plan or a zero plan. */
export function planPercent(line: Pick<BusinessBudgetLine, 'plannedNzd' | 'actualNzd'>): number | null {
  if (!line.plannedNzd) return null;
  return Math.max(0, Math.round((line.actualNzd / line.plannedNzd) * 100));
}

/**
 * The plan editor's inputs into the API's plans: blank clears a period, numbers set it.
 * Returns an error naming the first bad input instead.
 */
export function plansFromInputs(inputs: Record<string, string>, label: (period: string) => string): { plans: { period: string; amountNzd: number | null }[] } | { error: string } {
  const plans: { period: string; amountNzd: number | null }[] = [];
  for (const [period, raw] of Object.entries(inputs)) {
    const t = raw.trim().replace(/[$,\s]/g, '');
    if (!t) {
      plans.push({ period, amountNzd: null });
      continue;
    }
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) return { error: `Check the amount for ${label(period)}` };
    plans.push({ period, amountNzd: round2(n) });
  }
  return { plans };
}

/** A year total spread over months in whole cents; the last month takes the rounding. */
export function spreadEvenly(total: number, months: string[]): Record<string, string> {
  if (!months.length) return {};
  const cents = Math.round(total * 100);
  const each = Math.floor(cents / months.length);
  const out: Record<string, string> = {};
  months.forEach((m, i) => {
    const c = i === months.length - 1 ? cents - each * (months.length - 1) : each;
    out[m] = (c / 100).toFixed(2);
  });
  return out;
}

/** The current plan as editor inputs. */
export function planInputs(line: BusinessBudgetLine, taxYear: number): Record<string, string> {
  if (line.planCadence === 'year') return { [String(taxYear)]: line.plannedNzd == null ? '' : String(line.plannedNzd) };
  return Object.fromEntries(line.months.map((m) => [m.month, m.plannedNzd == null ? '' : String(m.plannedNzd)]));
}

export const ROLE_NOTES: Record<NonNullable<BusinessBudgetLine['role']>, string> = {
  sales: 'Fills in from sales and invoice payments',
  other_income: 'Fills in from income and deposits tagged to the business',
  stock: 'Fills in from paid stock bills (freight goes to Delivery)',
  delivery: 'Fills in from freight on paid bills and delivery bills',
  wages: 'Fills in from wages paid',
};
