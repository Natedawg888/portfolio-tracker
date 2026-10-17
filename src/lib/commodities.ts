/**
 * Commodities (KAN-81): one generic holding type for physical goods other than precious metals
 * (gold, silver, platinum and palladium stay in Metals). Each holding is a name, a category, a
 * quantity and unit, a cost, and a value the user set with its date. There is no live price feed
 * for these: scrap and farm-gate prices vary by buyer and grade, so a value is only ever what the
 * user entered. Shared by the server and the Commodities panel.
 */

export const COMMODITY_CATEGORIES = ['industrial_metals', 'energy', 'agriculture', 'livestock', 'other'] as const;
export type CommodityCategory = (typeof COMMODITY_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<CommodityCategory, string> = {
  industrial_metals: 'Industrial & scrap metals',
  energy: 'Energy',
  agriculture: 'Agriculture',
  livestock: 'Livestock',
  other: 'Other',
};

export const COMMODITY_UNITS = ['kg', 't', 'g', 'oz', 'lb', 'kgMS', 'L', 'barrel', 'bale', 'm3', 'head', 'unit'] as const;
export type CommodityUnit = (typeof COMMODITY_UNITS)[number];

export const UNIT_LABEL: Record<CommodityUnit, string> = {
  kg: 'kg',
  t: 'tonnes',
  g: 'grams',
  oz: 'oz',
  lb: 'lb',
  kgMS: 'kg milk solids',
  L: 'litres',
  barrel: 'barrels',
  bale: 'bales',
  m3: 'm³',
  head: 'head',
  unit: 'units',
};

/** Short form after a price: "$12.50/kg". */
export const UNIT_SHORT: Record<CommodityUnit, string> = { ...UNIT_LABEL, t: 't', g: 'g', kgMS: 'kgMS', L: 'L', barrel: 'barrel', bale: 'bale', head: 'head', unit: 'unit' };

/** Units offered first for each category (any unit can still be chosen). */
export const CATEGORY_UNITS: Record<CommodityCategory, CommodityUnit[]> = {
  industrial_metals: ['kg', 't'],
  energy: ['L', 'barrel', 'kg', 't', 'm3'],
  agriculture: ['kg', 't', 'kgMS', 'bale', 'unit'],
  livestock: ['head'],
  other: ['unit', 'kg', 't', 'L'],
};

export type CommodityPreset = { key: string; name: string; category: CommodityCategory; unit: CommodityUnit };

/**
 * Common NZ items. Adding a commodity is one more line here; anything else is free text.
 * Keys are stored with the holding, so don't rename one that's in use.
 */
export const COMMODITY_PRESETS: CommodityPreset[] = [
  { key: 'copper', name: 'Copper', category: 'industrial_metals', unit: 'kg' },
  { key: 'copper_bright', name: 'Bright copper', category: 'industrial_metals', unit: 'kg' },
  { key: 'copper_wire', name: 'Copper wire (insulated)', category: 'industrial_metals', unit: 'kg' },
  { key: 'aluminium', name: 'Aluminium', category: 'industrial_metals', unit: 'kg' },
  { key: 'brass', name: 'Brass', category: 'industrial_metals', unit: 'kg' },
  { key: 'lead', name: 'Lead', category: 'industrial_metals', unit: 'kg' },
  { key: 'zinc', name: 'Zinc', category: 'industrial_metals', unit: 'kg' },
  { key: 'stainless', name: 'Stainless steel', category: 'industrial_metals', unit: 'kg' },
  { key: 'steel', name: 'Steel', category: 'industrial_metals', unit: 't' },
  { key: 'mixed_scrap', name: 'Mixed scrap', category: 'industrial_metals', unit: 'kg' },
  { key: 'crude_oil', name: 'Crude oil', category: 'energy', unit: 'barrel' },
  { key: 'diesel', name: 'Diesel', category: 'energy', unit: 'L' },
  { key: 'lpg', name: 'LPG', category: 'energy', unit: 'kg' },
  { key: 'coal', name: 'Coal', category: 'energy', unit: 't' },
  { key: 'firewood', name: 'Firewood', category: 'energy', unit: 'm3' },
  { key: 'honey', name: 'Honey', category: 'agriculture', unit: 'kg' },
  { key: 'manuka_honey', name: 'Mānuka honey', category: 'agriculture', unit: 'kg' },
  { key: 'wool', name: 'Wool', category: 'agriculture', unit: 'kg' },
  { key: 'milk_solids', name: 'Milk solids', category: 'agriculture', unit: 'kgMS' },
  { key: 'wheat', name: 'Wheat', category: 'agriculture', unit: 't' },
  { key: 'barley', name: 'Barley', category: 'agriculture', unit: 't' },
  { key: 'maize', name: 'Maize', category: 'agriculture', unit: 't' },
  { key: 'coffee', name: 'Coffee', category: 'agriculture', unit: 'kg' },
  { key: 'hay', name: 'Hay', category: 'agriculture', unit: 'bale' },
  { key: 'cattle', name: 'Cattle', category: 'livestock', unit: 'head' },
  { key: 'sheep', name: 'Sheep', category: 'livestock', unit: 'head' },
  { key: 'deer', name: 'Deer', category: 'livestock', unit: 'head' },
  { key: 'pigs', name: 'Pigs', category: 'livestock', unit: 'head' },
];

export function presetByKey(key: string | null | undefined): CommodityPreset | null {
  return COMMODITY_PRESETS.find((p) => p.key === key) ?? null;
}

/** How the value was entered: a price per unit (× quantity) or one total. */
export type PriceBasis = 'unit' | 'total';

/** A value older than this many days shows a stale warning. Commodity prices move; check monthly. */
export const STALE_AFTER_DAYS = 30;

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86_400_000);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type CommodityTerms = { quantity: number; priceNzd: number | null; priceBasis: PriceBasis; costNzd: number | null; valueOn: string | null };

export type CommodityFigures = {
  /** NZD value from the user's price, or null when none is set (shown as a dash, not counted). */
  valueNzd: number | null;
  /** Price per unit, given or worked out from a total (null without a value or quantity). */
  unitPriceNzd: number | null;
  /** Value − cost; a blank cost counts as $0. Null without a value. */
  returnNzd: number | null;
  returnPct: number | null;
  /** Days since the value was set, and whether that's past STALE_AFTER_DAYS. */
  ageDays: number | null;
  stale: boolean;
};

export function commodityFigures(t: CommodityTerms, today: string): CommodityFigures {
  const valueNzd = t.priceNzd == null ? null : round2(t.priceBasis === 'unit' ? t.quantity * t.priceNzd : t.priceNzd);
  const unitPriceNzd = t.priceNzd == null ? null : t.priceBasis === 'unit' ? t.priceNzd : t.quantity > 0 ? t.priceNzd / t.quantity : null;
  const cost = t.costNzd ?? 0;
  const returnNzd = valueNzd == null ? null : round2(valueNzd - cost);
  const ageDays = valueNzd != null && t.valueOn ? Math.max(0, daysBetween(t.valueOn, today)) : null;
  return {
    valueNzd,
    unitPriceNzd,
    returnNzd,
    returnPct: returnNzd != null && cost > 0 ? (returnNzd / cost) * 100 : null,
    ageDays,
    // A value with no date can't be shown as current either.
    stale: valueNzd != null && (ageDays == null || ageDays > STALE_AFTER_DAYS),
  };
}

/** "2,500 kg", "1.5 tonnes", "40 head". */
export function quantityText(quantity: number, unit: CommodityUnit): string {
  return `${quantity.toLocaleString('en-NZ', { maximumFractionDigits: 4 })} ${UNIT_LABEL[unit]}`;
}
