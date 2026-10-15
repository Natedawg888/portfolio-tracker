/**
 * Vehicles (KAN-65): running-cost kinds and frequencies, and totals per week / month / year.
 * Shared by the server and the Vehicles page. Amounts are what the user enters; nothing is
 * estimated.
 */
export type CostFrequency = 'week' | 'fortnight' | 'month' | 'quarter' | 'year';
export const COST_FREQUENCIES: { value: CostFrequency; label: string; perYear: number }[] = [
  { value: 'week', label: 'a week', perYear: 52 },
  { value: 'fortnight', label: 'a fortnight', perYear: 26 },
  { value: 'month', label: 'a month', perYear: 12 },
  { value: 'quarter', label: 'a quarter', perYear: 4 },
  { value: 'year', label: 'a year', perYear: 1 },
];
export const PER_YEAR: Record<CostFrequency, number> = Object.fromEntries(COST_FREQUENCIES.map((f) => [f.value, f.perYear])) as Record<CostFrequency, number>;

export type CostKind = 'fuel' | 'charging' | 'insurance' | 'registration' | 'wof' | 'servicing' | 'tyres' | 'ruc' | 'parking' | 'other';
export const COST_KINDS: { value: CostKind; label: string; defaultFrequency: CostFrequency }[] = [
  { value: 'fuel', label: 'Fuel', defaultFrequency: 'week' },
  { value: 'charging', label: 'Charging', defaultFrequency: 'week' },
  { value: 'insurance', label: 'Insurance', defaultFrequency: 'month' },
  { value: 'registration', label: 'Registration', defaultFrequency: 'year' },
  { value: 'wof', label: 'WOF / COF', defaultFrequency: 'year' },
  { value: 'servicing', label: 'Servicing and repairs', defaultFrequency: 'year' },
  { value: 'tyres', label: 'Tyres', defaultFrequency: 'year' },
  { value: 'ruc', label: 'Road user charges', defaultFrequency: 'year' },
  { value: 'parking', label: 'Parking and tolls', defaultFrequency: 'month' },
  { value: 'other', label: 'Other', defaultFrequency: 'year' },
];
export const COST_KIND_LABEL: Record<CostKind, string> = Object.fromEntries(COST_KINDS.map((k) => [k.value, k.label])) as Record<CostKind, string>;

export type RunningCost = { kind: CostKind; amountNzd: number; frequency: CostFrequency; label?: string };
export type PerPeriod = { week: number; month: number; year: number };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function perPeriod(yearly: number): PerPeriod {
  return { week: r2(yearly / 52), month: r2(yearly / 12), year: r2(yearly) };
}
export const yearlyOf = (amount: number, frequency: CostFrequency) => amount * (PER_YEAR[frequency] ?? 0);

/** Running costs, loan repayments, and both together. */
export function costToOwn(costs: RunningCost[], loanRepayment: { amountNzd: number; frequency: CostFrequency } | null): {
  running: PerPeriod;
  loan: PerPeriod;
  total: PerPeriod;
  byKind: { kind: CostKind; label: string; year: number }[];
} {
  const byKind = costs.map((c) => ({ kind: c.kind, label: c.label?.trim() || COST_KIND_LABEL[c.kind], year: r2(yearlyOf(c.amountNzd, c.frequency)) }));
  const running = byKind.reduce((s, c) => s + c.year, 0);
  const loan = loanRepayment ? yearlyOf(loanRepayment.amountNzd, loanRepayment.frequency) : 0;
  return { running: perPeriod(running), loan: perPeriod(loan), total: perPeriod(running + loan), byKind };
}
