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
