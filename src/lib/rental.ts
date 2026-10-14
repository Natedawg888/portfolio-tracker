/**
 * Rental income (KAN-66). Pure helpers shared by the API and the Rentals page.
 * Dates are YYYY-MM-DD in Pacific/Auckland. Totals run over the New Zealand tax
 * year (1 April – 31 March), named by the year it ends in: 2027 = 1 Apr 2026 – 31 Mar 2027.
 */
import { roundMoney } from './debtModel.ts';

export type RentalEntryKind = 'income' | 'expense';

export const RENTAL_CATEGORIES = {
  income: [
    { value: 'rent', label: 'Rent' },
    { value: 'other_income', label: 'Other income' },
  ],
  expense: [
    { value: 'interest', label: 'Mortgage interest' },
    { value: 'rates', label: 'Rates' },
    { value: 'insurance', label: 'Insurance' },
    { value: 'repairs', label: 'Repairs & maintenance' },
    { value: 'management', label: 'Property management' },
    { value: 'body_corporate', label: 'Body corporate' },
    { value: 'other_expense', label: 'Other expense' },
  ],
} as const satisfies Record<RentalEntryKind, readonly { value: string; label: string }[]>;

export type RentalCategory =
  | (typeof RENTAL_CATEGORIES.income)[number]['value']
  | (typeof RENTAL_CATEGORIES.expense)[number]['value'];

export function isRentalCategory(kind: RentalEntryKind, value: unknown): value is RentalCategory {
  return RENTAL_CATEGORIES[kind].some((c) => c.value === value);
}

export function rentalCategoryLabel(value: string): string {
  for (const kind of ['income', 'expense'] as const) {
    const hit = RENTAL_CATEGORIES[kind].find((c) => c.value === value);
    if (hit) return hit.label;
  }
  return 'Other';
}

/** Tax year (named by its end year) that a date falls in. */
export function taxYearOf(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month >= 4 ? year + 1 : year;
}

export function taxYearRange(endYear: number): { start: string; end: string } {
  return { start: `${endYear - 1}-04-01`, end: `${endYear}-03-31` };
}

/** "2026–27" for the year ending 31 March 2027. */
export function taxYearLabel(endYear: number): string {
  return `${endYear - 1}–${String(endYear).slice(-2)}`;
}

export type RentalTotals = { income: number; expenses: number; net: number };

type Summable = { propertyId: string; date: string; kind: RentalEntryKind; amountNzd: number };

/** Income, expenses and net (income − expenses) for entries in one tax year. */
export function rentalTotals(entries: readonly Summable[], endYear: number, propertyId?: string): RentalTotals {
  const { start, end } = taxYearRange(endYear);
  let income = 0;
  let expenses = 0;
  for (const e of entries) {
    if (e.date < start || e.date > end) continue;
    if (propertyId && e.propertyId !== propertyId) continue;
    if (e.kind === 'income') income += e.amountNzd;
    else expenses += e.amountNzd;
  }
  income = roundMoney(income);
  expenses = roundMoney(expenses);
  return { income, expenses, net: roundMoney(income - expenses) };
}

/** Tax years with any entries, plus the current one, newest first. */
export function rentalTaxYears(entries: readonly { date: string }[], today: string): number[] {
  const years = new Set<number>([taxYearOf(today)]);
  for (const e of entries) years.add(taxYearOf(e.date));
  return [...years].sort((a, b) => b - a);
}
