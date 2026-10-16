/**
 * Commodities figures (KAN-81). Figures worked by hand. Run: npm run test:commodities
 */
import { COMMODITY_PRESETS, COMMODITY_UNITS, CATEGORY_UNITS, STALE_AFTER_DAYS, commodityFigures, presetByKey, quantityText } from './commodities.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

const today = '2026-10-17';

// 250 kg bright copper at $12.40/kg = $3,100; paid $2,500 → +$600 (+24%).
let f = commodityFigures({ quantity: 250, priceNzd: 12.4, priceBasis: 'unit', costNzd: 2500, valueOn: '2026-10-10' }, today);
eq(f.valueNzd, 3100, 'unit price × quantity');
eq(f.unitPriceNzd, 12.4, 'unit price kept');
eq(f.returnNzd, 600, 'return on cost');
eq(f.returnPct, 24, 'return %');
eq(f.ageDays, 7, 'age in days');
eq(f.stale, false, 'a week old is current');

// A total: 40 bales of wool for $6,000 → $150/bale. Blank cost counts as $0.
f = commodityFigures({ quantity: 40, priceNzd: 6000, priceBasis: 'total', costNzd: null, valueOn: '2026-10-17' }, today);
eq(f.valueNzd, 6000, 'total value as given');
eq(f.unitPriceNzd, 150, 'unit price from a total');
eq(f.returnNzd, 6000, 'blank cost = $0');
eq(f.returnPct, null, 'no % on a $0 cost');

// Stale after STALE_AFTER_DAYS: 30 days is still current, 31 is old.
eq(commodityFigures({ quantity: 1, priceNzd: 10, priceBasis: 'unit', costNzd: 0, valueOn: '2026-09-17' }, today).stale, false, `${STALE_AFTER_DAYS} days is current`);
eq(commodityFigures({ quantity: 1, priceNzd: 10, priceBasis: 'unit', costNzd: 0, valueOn: '2026-09-16' }, today).stale, true, 'one day more is stale');
eq(commodityFigures({ quantity: 1, priceNzd: 10, priceBasis: 'unit', costNzd: 0, valueOn: null }, today).stale, true, 'a value with no date is stale');

// No price: no value, no return, not stale (there's nothing to be out of date).
f = commodityFigures({ quantity: 100, priceNzd: null, priceBasis: 'unit', costNzd: 500, valueOn: null }, today);
eq(f.valueNzd, null, 'no price → no value (never invented)');
eq(f.returnNzd, null, 'no return without a value');
eq(f.stale, false, 'nothing to flag');

// Cents round: 3.333 kg × $2.10 = $6.9993 → $7.00.
eq(commodityFigures({ quantity: 3.333, priceNzd: 2.1, priceBasis: 'unit', costNzd: null, valueOn: today }, today).valueNzd, 7, 'value rounds to cents');

// The picklist: unique keys, valid units, and no precious metals (those live in Metals).
eq(new Set(COMMODITY_PRESETS.map((p) => p.key)).size, COMMODITY_PRESETS.length, 'preset keys unique');
eq(COMMODITY_PRESETS.every((p) => (COMMODITY_UNITS as readonly string[]).includes(p.unit)), true, 'preset units valid');
eq(COMMODITY_PRESETS.some((p) => /gold|silver|platinum|palladium/i.test(p.name)), false, 'no precious metals');
eq(Object.values(CATEGORY_UNITS).every((us) => us.every((u) => (COMMODITY_UNITS as readonly string[]).includes(u))), true, 'category units valid');
eq(presetByKey('milk_solids')?.unit, 'kgMS', 'milk solids in kgMS');
eq(presetByKey('nope'), null, 'unknown preset');
eq(quantityText(2500, 'kg'), '2,500 kg', 'quantity text');
eq(quantityText(1.5, 't'), '1.5 tonnes', 'tonnes');

console.log('commodities figures tests passed');
