/**
 * Commodities for one user (KAN-81). Every query filters on user_id.
 *
 * - One generic holding: name, category, quantity and unit, cost, and a value the user set (a price
 *   per unit or a total) with its date. No live prices: scrap and farm-gate prices vary by buyer and
 *   grade, and no permitted feed has been verified for base metals. Never invented.
 * - No value set: shown as a dash and left out of net worth (counted as unvalued).
 * - A value older than STALE_AFTER_DAYS (or with no date) is flagged stale.
 * - Free: add and value commodities, counted in net worth. Plus ('commodities_plus'): Commodities as
 *   its own class in the asset mix and on the Economic cycle page.
 */
import type { Database } from 'sql.js';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { aucklandToday, roundMoney } from '../debts/model.ts';
import { isYmd } from '../../src/lib/invoiceCalc.ts';
import {
  COMMODITY_CATEGORIES,
  COMMODITY_UNITS,
  commodityFigures,
  presetByKey,
  type CommodityCategory,
  type CommodityFigures,
  type CommodityUnit,
  type PriceBasis,
} from '../../src/lib/commodities.ts';
import { hasFeature } from '../lib/entitlements.ts';

const MAX = 1e10;

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code?: string };
const fail = (status: number, error: string, code?: string): { ok: false; status: number; error: string; code?: string } => ({ ok: false, status, error, code });
export const isCommoditiesPlus = (db: Database, userId: string) => hasFeature(db, userId, 'commodities_plus');

export type CommodityDraft = {
  name: string;
  preset: string | null;
  category: CommodityCategory;
  quantity: number;
  unit: CommodityUnit;
  costNzd: number | null;
  priceNzd: number | null;
  priceBasis: PriceBasis;
  valueOn: string | null;
  notes: string;
};

type Row = {
  id: string;
  name: string;
  preset: string | null;
  category: CommodityCategory;
  quantity: number;
  unit: CommodityUnit;
  cost_nzd: number | null;
  price_nzd: number | null;
  price_basis: PriceBasis;
  value_on: string | null;
  notes: string;
  updated_at: string;
  business_id: string | null;
  business_name: string | null;
};

/** businessName: the business this is produce of (KAN-84); its value counts in that business, not here. */
export type Commodity = CommodityDraft & CommodityFigures & { id: string; updatedAt: string; businessId: string | null; businessName: string | null };

export type CommoditiesView = {
  plus: boolean;
  commodities: Commodity[];
  totals: { valueNzd: number; costNzd: number; returnNzd: number; unvalued: number; stale: number };
};

// ---------------------------------------------------------------- parsing

function num(v: unknown, label: string, opts: { required?: boolean } = {}): number | null | string {
  if (v === null || v === undefined || v === '') return opts.required ? `${label} is required` : null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return `${label} must be a number`;
  if (n < 0) return `${label} can’t be negative`;
  if (n > MAX) return `${label} is too large`;
  return n;
}

export function parseCommodity(raw: unknown, today = aucklandToday()): { ok: true; value: CommodityDraft } | { ok: false; error: string } {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'Enter the commodity' };
  const preset = typeof o.preset === 'string' && o.preset ? presetByKey(o.preset) : null;
  if (typeof o.preset === 'string' && o.preset && !preset) return { ok: false, error: 'Choose one from the list, or type your own' };
  const name = (typeof o.name === 'string' ? o.name.trim().slice(0, 80) : '') || preset?.name || '';
  if (!name) return { ok: false, error: 'Enter what it is' };
  if (!COMMODITY_CATEGORIES.includes(o.category as CommodityCategory)) return { ok: false, error: 'Choose a category' };
  if (!COMMODITY_UNITS.includes(o.unit as CommodityUnit)) return { ok: false, error: 'Choose a unit' };
  const basis: PriceBasis = o.priceBasis === 'total' ? 'total' : 'unit';
  const nums: Record<string, number | null> = {};
  for (const [k, label, opts] of [
    ['quantity', 'Quantity', { required: true }],
    ['costNzd', 'Cost', {}],
    ['priceNzd', basis === 'unit' ? 'Price' : 'Value', {}],
  ] as const) {
    const v = num(o[k], label, opts);
    if (typeof v === 'string') return { ok: false, error: v };
    nums[k] = v;
  }
  if (!(nums.quantity! > 0)) return { ok: false, error: 'Quantity must be more than 0' };
  let valueOn: string | null = null;
  if (o.valueOn != null && o.valueOn !== '') {
    if (!isYmd(o.valueOn)) return { ok: false, error: 'Value date must be a date' };
    if ((o.valueOn as string) > today) return { ok: false, error: 'The value date can’t be in the future' };
    valueOn = o.valueOn as string;
  }
  // A value needs the date it was set, so it can be flagged once it's old.
  if (nums.priceNzd != null && !valueOn) return { ok: false, error: 'Enter the date of that price' };
  return {
    ok: true,
    value: {
      name,
      preset: preset?.key ?? null,
      category: o.category as CommodityCategory,
      quantity: Math.round(nums.quantity! * 10000) / 10000,
      unit: o.unit as CommodityUnit,
      costNzd: nums.costNzd == null ? null : roundMoney(nums.costNzd),
      // Per-unit prices keep 4 decimals (scrap is often quoted to the cent per kg, fractions matter at volume).
      priceNzd: nums.priceNzd == null ? null : basis === 'unit' ? Math.round(nums.priceNzd * 10000) / 10000 : roundMoney(nums.priceNzd),
      priceBasis: basis,
      valueOn: nums.priceNzd == null ? null : valueOn,
      notes: typeof o.notes === 'string' ? o.notes.trim().slice(0, 300) : '',
    },
  };
}

// ---------------------------------------------------------------- view

function present(r: Row, today: string): Commodity {
  const draft: CommodityDraft = {
    name: r.name,
    preset: r.preset,
    category: r.category,
    quantity: Number(r.quantity),
    unit: r.unit,
    costNzd: r.cost_nzd == null ? null : Number(r.cost_nzd),
    priceNzd: r.price_nzd == null ? null : Number(r.price_nzd),
    priceBasis: r.price_basis === 'total' ? 'total' : 'unit',
    valueOn: r.value_on,
    notes: r.notes,
  };
  return {
    id: r.id,
    ...draft,
    ...commodityFigures(draft, today),
    updatedAt: r.updated_at,
    businessId: r.business_id ?? null,
    businessName: r.business_id ? (r.business_name ?? '') : null,
  };
}

function rows(db: Database, userId: string): Row[] {
  return queryAll<Row>(
    db,
    `SELECT c.*, b.name AS business_name FROM commodities c
     LEFT JOIN businesses b ON b.id = c.business_id AND b.user_id = c.user_id
     WHERE c.user_id = ? ORDER BY c.category, c.name, c.created_at`,
    [userId],
  );
}

export function listCommodities(db: Database, userId: string, today = aucklandToday()): CommoditiesView {
  const commodities = rows(db, userId).map((r) => present(r, today));
  // Produce of a business counts in that business's value (KAN-84), so it isn't in these totals.
  const valued = commodities.filter((c) => c.valueNzd != null && !c.businessId);
  const valueNzd = roundMoney(valued.reduce((s, c) => s + c.valueNzd!, 0));
  // Return compares like with like: only holdings that have a value.
  const costNzd = roundMoney(valued.reduce((s, c) => s + (c.costNzd ?? 0), 0));
  return {
    plus: isCommoditiesPlus(db, userId),
    commodities,
    totals: {
      valueNzd,
      costNzd,
      returnNzd: roundMoney(valueNzd - costNzd),
      unvalued: commodities.filter((c) => c.valueNzd == null && !c.businessId).length,
      stale: valued.filter((c) => c.stale).length,
    },
  };
}

/** Valued holdings for net worth, or null when the user has none at all. */
export function commodityTotals(db: Database, userId: string, today = aucklandToday()): { valueNzd: number; perHolding: { id: string; label: string; valueNzd: number }[]; unvalued: number } | null {
  // Produce of a business is counted in that business (businessAssetTotals), not here.
  const all = rows(db, userId).map((r) => present(r, today)).filter((c) => !c.businessId);
  if (!all.length) return null;
  const perHolding = all.filter((c) => c.valueNzd != null).map((c) => ({ id: c.id, label: c.name, valueNzd: c.valueNzd! }));
  return { valueNzd: roundMoney(perHolding.reduce((s, c) => s + c.valueNzd, 0)), perHolding, unvalued: all.length - perHolding.length };
}

// ---------------------------------------------------------------- writes

const COLS = `name=?, preset=?, category=?, quantity=?, unit=?, cost_nzd=?, price_nzd=?, price_basis=?, value_on=?, notes=?`;
const values = (d: CommodityDraft) => [d.name, d.preset, d.category, d.quantity, d.unit, d.costNzd, d.priceNzd, d.priceBasis, d.valueOn, d.notes];

export function createCommodity(db: Database, userId: string, body: unknown, today = aucklandToday()): Result<CommoditiesView> {
  const p = parseCommodity(body, today);
  if (!p.ok) return fail(400, p.error);
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO commodities (id, user_id, name, preset, category, quantity, unit, cost_nzd, price_nzd, price_basis, value_on, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [newId('cmd'), userId, ...values(p.value), now, now],
  );
  return { ok: true, value: listCommodities(db, userId, today) };
}

export function updateCommodity(db: Database, userId: string, id: string, body: unknown, today = aucklandToday()): Result<CommoditiesView> {
  if (!queryOne(db, `SELECT 1 FROM commodities WHERE id = ? AND user_id = ?`, [id, userId])) return fail(404, 'Not found');
  const p = parseCommodity(body, today);
  if (!p.ok) return fail(400, p.error);
  run(db, `UPDATE commodities SET ${COLS}, updated_at=? WHERE id=? AND user_id=?`, [...values(p.value), new Date().toISOString(), id, userId]);
  return { ok: true, value: listCommodities(db, userId, today) };
}

export function deleteCommodity(db: Database, userId: string, id: string): Result<CommoditiesView> {
  if (!queryOne(db, `SELECT 1 FROM commodities WHERE id = ? AND user_id = ?`, [id, userId])) return fail(404, 'Not found');
  run(db, `DELETE FROM commodities WHERE id = ? AND user_id = ?`, [id, userId]);
  return { ok: true, value: listCommodities(db, userId) };
}
