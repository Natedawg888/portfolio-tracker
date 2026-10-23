/**
 * Business page (KAN-84). Pure helpers shared by the API and the Business pages.
 * Totals run over the New Zealand tax year (1 April – 31 March), named by the year it
 * ends in, as on Rentals: 2027 = 1 Apr 2026 – 31 Mar 2027.
 *
 * Asset values are always what the user entered. Nothing here estimates a price.
 */
import { roundMoney } from './debtModel.ts';

export { taxYearLabel, taxYearOf, taxYearRange } from './rental.ts';

export const BUSINESS_TYPES = [
  { value: 'sole_trader', label: 'Sole trader' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'company', label: 'Company' },
  { value: 'hobby', label: 'Hobby' },
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number]['value'];

export const ASSET_CATEGORIES = [
  { value: 'livestock', label: 'Livestock', unit: 'head' },
  { value: 'beehives', label: 'Beehives', unit: 'hives' },
  { value: 'equipment', label: 'Equipment', unit: '' },
  { value: 'vehicle', label: 'Vehicles', unit: '' },
  { value: 'stock', label: 'Stock / inventory', unit: '' },
  { value: 'other', label: 'Other', unit: '' },
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number]['value'];

export const HIVE_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'dead', label: 'Dead' },
  { value: 'sold', label: 'Sold' },
] as const;
export type HiveStatus = (typeof HIVE_STATUSES)[number]['value'];

export const MOVEMENT_KINDS = [
  { value: 'purchase', label: 'Purchase', sign: 1 },
  { value: 'birth', label: 'Birth', sign: 1 },
  { value: 'sale', label: 'Sale', sign: -1 },
  { value: 'death', label: 'Death', sign: -1 },
  { value: 'loss', label: 'Loss', sign: -1 },
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number]['value'];

export type ValueMode = 'total' | 'per_unit';

const has = <T extends { value: string }>(list: readonly T[], v: unknown): v is T['value'] =>
  typeof v === 'string' && list.some((x) => x.value === v);

export const isBusinessType = (v: unknown): v is BusinessType => has(BUSINESS_TYPES, v);
export const isAssetCategory = (v: unknown): v is AssetCategory => has(ASSET_CATEGORIES, v);
export const isHiveStatus = (v: unknown): v is HiveStatus => has(HIVE_STATUSES, v);
export const isMovementKind = (v: unknown): v is MovementKind => has(MOVEMENT_KINDS, v);

const labelOf = (list: readonly { value: string; label: string }[], v: string) => list.find((x) => x.value === v)?.label ?? 'Other';
export const businessTypeLabel = (v: string) => labelOf(BUSINESS_TYPES, v);
export const assetCategoryLabel = (v: string) => labelOf(ASSET_CATEGORIES, v);
export const movementKindLabel = (v: string) => labelOf(MOVEMENT_KINDS, v);

/** Default unit for a category ("head" for livestock, "hives" for beehives). */
export function defaultUnit(category: string): string {
  return ASSET_CATEGORIES.find((c) => c.value === category)?.unit ?? '';
}

/** How a movement changes the quantity: purchases and births add, sales, deaths and losses take away. */
export function movementDelta(kind: MovementKind, quantity: number): number {
  const sign = MOVEMENT_KINDS.find((k) => k.value === kind)?.sign ?? 1;
  return sign * quantity;
}

/** Quantity after a movement, or null when it would go below zero. */
export function quantityAfter(current: number, kind: MovementKind, quantity: number): number | null {
  const next = roundQty(current + movementDelta(kind, quantity));
  return next < 0 ? null : next;
}

/** Quantities are counts or weights; keep 3 decimal places so 0.1 + 0.2 stays 0.3. */
export function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * What the asset is worth from the user's own figure: the total as entered, or the value per
 * head / hive / unit times the quantity. No figure → null (unknown, not zero). A beehive record
 * marked sold is no longer held, so it adds nothing.
 */
export function assetValue(a: { quantity: number; valueMode: ValueMode; valueNzd: number | null; category: string; status: string }): number | null {
  if (a.valueNzd == null) return null;
  if (a.category === 'beehives' && a.status === 'sold') return 0;
  return roundMoney(a.valueMode === 'per_unit' ? a.valueNzd * a.quantity : a.valueNzd);
}

/**
 * GST in GST-inclusive takings at 15%: 3/23 of the amount. Educational only — it ignores
 * zero-rated and exempt supplies and GST on expenses, and is not a return.
 */
export function gstCollectedEstimate(gstInclusiveIncome: number): number {
  return roundMoney(Math.max(0, gstInclusiveIncome) * 3 / 23);
}

export const IRD_GST_URL = 'https://www.ird.govt.nz/gst';

/**
 * One-line tax note per business type on the Business pages. General information only, kept
 * short and factual; not tax advice. Change the wording here.
 */
export const BUSINESS_TYPE_NOTES: Record<BusinessType, string> = {
  sole_trader: 'You pay tax on the profit as personal income and file an IR3 each year. You may also need to pay provisional tax.',
  partnership: 'The partnership files an IR7. Each partner pays tax on their share of the profit in their own IR3.',
  company: 'The company files its own return (IR4) and pays tax at 28%. Money you take out is taxed as salary or dividends.',
  hobby: 'Hobby income usually isn’t taxed, and hobby costs can’t be claimed. If you’re selling regularly to make money, IRD may treat it as a business.',
};

/** "3 entries this tax year" or "nothing recorded yet": invoices issued plus items tagged in the year. */
export function entriesText(activity: { invoices: number; tagged: number }): string {
  const n = activity.invoices + activity.tagged;
  return n === 0 ? 'nothing recorded yet' : `${n} ${n === 1 ? 'entry' : 'entries'} this tax year`;
}

export type SetupStep = { id: 'money_in' | 'cost' | 'tag'; title: string; done: boolean };

/**
 * "Get [name] set up" steps for a business with nothing recorded in the tax year. Money in comes
 * from invoices or tagged income; costs only from tagged bank transactions.
 */
export function setupSteps(totals: { incomeNzd: number; expensesNzd: number }, activity: { invoices: number; tagged: number }): SetupStep[] {
  return [
    { id: 'money_in', title: 'Record money in', done: totals.incomeNzd > 0 || activity.invoices > 0 },
    { id: 'cost', title: 'Record a cost', done: totals.expensesNzd > 0 },
    { id: 'tag', title: 'Tag transactions from Budget', done: activity.tagged > 0 },
  ];
}

/** Nothing recorded in the tax year: the card shows setup steps instead of zero figures. */
export function isUnstarted(totals: { incomeNzd: number; expensesNzd: number }, activity: { invoices: number; tagged: number }): boolean {
  return totals.incomeNzd === 0 && totals.expensesNzd === 0 && activity.invoices === 0 && activity.tagged === 0;
}

/** Quick-add presets on a business's "What it owns" card. */
export const ASSET_QUICK_ADDS: { label: string; category: AssetCategory; name: string }[] = [
  { label: 'Beehives', category: 'beehives', name: 'Beehives' },
  { label: 'Equipment', category: 'equipment', name: '' },
  { label: 'Vehicle', category: 'vehicle', name: '' },
  { label: 'Livestock', category: 'livestock', name: '' },
];

/** Produce presets: a Portfolio commodity linked to the business (preset keys from src/lib/commodities.ts). */
export const PRODUCE_QUICK_ADDS: { label: string; preset: string | null; name: string; category: 'agriculture' | 'other'; unit: 'kg' | 'unit' }[] = [
  { label: 'Honey (kg)', preset: 'honey', name: 'Honey', category: 'agriculture', unit: 'kg' },
  { label: 'Wool (kg)', preset: 'wool', name: 'Wool', category: 'agriculture', unit: 'kg' },
  { label: 'Stock on hand', preset: null, name: 'Stock on hand', category: 'other', unit: 'unit' },
];

/** Profit is green when positive and in the warning colour when negative (class names). */
export function profitClass(n: number): string | undefined {
  return n > 0 ? 'business-profit--up' : n < 0 ? 'rental-net--loss' : undefined;
}

/** Under "Equipment & stock" / "What it owns". */
export function netWorthNote(counted: boolean): string {
  return counted ? 'Counted in your net worth' : 'Not counted in your net worth';
}

/** 402 code for business reports without the Business plan (KAN-125); show BusinessPlanNote. */
export const BUSINESS_PLAN_REQUIRED = 'BUSINESS_PLAN_REQUIRED';
