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

/**
 * IRD's tax depreciation rate for cars (Income Tax Act s EE 25D): motor vehicles designed mainly
 * to carry 12 or fewer people, not on short-term hire, depreciate at 30% a year diminishing value
 * (21% straight line). It's a business tax rate, offered as a starting point for an estimate, not
 * a market value. Checked 16 October 2026.
 */
export const IRD_CAR_DEPRECIATION = {
  ratePct: 30,
  method: 'diminishing value',
  label: 'IRD’s depreciation rate for cars (30% a year, diminishing value)',
  url: 'https://www.taxtechnical.ird.govt.nz/new-legislation/act-articles/taxation-depreciation-payment-dates-alignment-fbt-and-miscellaneous-provisions-act-2006-2006-no-3-/depreciation-rates',
  checkedOn: '2026-10-16',
} as const;

export type DistanceUnit = 'km' | 'mi';
export const DISTANCE_LABEL: Record<DistanceUnit, string> = { km: 'km', mi: 'miles' };

const YEAR_MS = 365.25 * 86_400_000;
const yearsBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / YEAR_MS;

/** Price paid, less `ratePct` a year diminishing value, from the purchase date to `asOf`. */
export function depreciatedValue(pricePaid: number, purchaseDate: string, ratePct: number, asOf: string): { valueNzd: number; years: number } | null {
  if (!(pricePaid > 0) || !(ratePct >= 0) || ratePct >= 100) return null;
  const years = yearsBetween(purchaseDate, asOf);
  if (!(years >= 0)) return null;
  return { valueNzd: r2(pricePaid * (1 - ratePct / 100) ** years), years: Math.round(years * 10) / 10 };
}

/** Distance a year from the reading when bought to the latest reading; null when it can't be worked out. */
export function distancePerYear(odometer: number | null, readOn: string | null, atPurchase: number | null, purchaseDate: string | null): number | null {
  if (odometer == null || atPurchase == null || !readOn || !purchaseDate || odometer < atPurchase) return null;
  const years = yearsBetween(purchaseDate, readOn);
  return years >= 0.25 ? Math.round((odometer - atPurchase) / years) : null;
}
