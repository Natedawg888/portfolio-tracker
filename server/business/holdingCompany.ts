/**
 * Holding company investments (KAN-134). The owner can assign their own Portfolio holdings
 * (holdings.business_id) to a business; a holding company's card then shows what it holds by asset
 * class, valued exactly as Portfolio and net worth value them (computeNetWorth's per-holding
 * values). Nothing is estimated: a holding with no value counts but adds nothing.
 *
 * Assigned holdings stay in your net worth once, under Portfolio. The business's own value (what
 * it owns on the Business page) doesn't add them again.
 */
import type { Database } from 'sql.js';
import { queryAll, queryOne, run } from '../db/index.ts';
import { computeNetWorth, type WalletValuer } from '../lib/netWorth.ts';
import { ASSET_CLASS_PREF_OPTIONS, prefKeyForHoldingClass, type AssetClassPrefKey } from '../../src/lib/assetClassPrefs.ts';
import type { BusinessAssetClassRow, BusinessHoldingOption } from '../../src/types/index.ts';

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

type HoldingRow = { id: string; name: string | null; asset: string | null; symbol: string | null; asset_class: string; business_id: string | null };

/** Asset classes a holding company can hold: every class but Businesses. */
const CLASS_ORDER = ASSET_CLASS_PREF_OPTIONS.filter((o) => o.key !== 'business');

function ownsBusiness(db: Database, userId: string, businessId: string): boolean {
  return Boolean(queryOne(db, `SELECT 1 AS x FROM businesses WHERE id = ? AND user_id = ?`, [businessId, userId]));
}

function holdingLabel(h: HoldingRow): string {
  const name = (h.name ?? '').trim();
  const code = (h.symbol ?? h.asset ?? '').trim();
  if (name && code && name.toUpperCase() !== code.toUpperCase()) return `${name} (${code})`;
  return name || code || 'Holding';
}

/** Group holdings into asset classes; empty classes are left out. values: holding id → NZD. */
export function groupByAssetClass(holdings: readonly { id: string; assetClass: string }[], values: ReadonlyMap<string, number>): BusinessAssetClassRow[] {
  const by = new Map<AssetClassPrefKey, { valueNzd: number; count: number; unvalued: number }>();
  for (const h of holdings) {
    const key = prefKeyForHoldingClass(h.assetClass);
    if (!key || key === 'business') continue;
    const row = by.get(key) ?? { valueNzd: 0, count: 0, unvalued: 0 };
    row.count += 1;
    const v = values.get(h.id);
    if (v != null && Number.isFinite(v)) row.valueNzd += v;
    else row.unvalued += 1;
    by.set(key, row);
  }
  return CLASS_ORDER.filter((o) => by.has(o.key)).map((o) => {
    const r = by.get(o.key)!;
    return { key: o.key, label: o.label, valueNzd: Math.round(r.valueNzd * 100) / 100, count: r.count, unvalued: r.unvalued };
  });
}

/** GET /api/business/:id/asset-classes. userId is the business owner (the route runs as them). */
export async function businessAssetClasses(db: Database, userId: string, businessId: string, valuer?: WalletValuer): Promise<Result<BusinessAssetClassRow[]>> {
  if (!ownsBusiness(db, userId, businessId)) return { ok: false, status: 404, error: 'Business not found' };
  const assigned = queryAll<HoldingRow>(db, `SELECT id, name, asset, symbol, asset_class, business_id FROM holdings WHERE user_id = ? AND business_id = ?`, [userId, businessId]);
  if (!assigned.length) return { ok: true, value: [] };
  const nw = valuer ? await computeNetWorth(db, userId, valuer) : await computeNetWorth(db, userId);
  const values = new Map(nw.breakdown.holdings.map((p) => [p.id, p.valueNzd]));
  return { ok: true, value: groupByAssetClass(assigned.map((h) => ({ id: h.id, assetClass: h.asset_class })), values) };
}

/** GET /api/business/:id/holdings: the owner's holdings that can be assigned, and where each is now. */
export function businessHoldingOptions(db: Database, userId: string, businessId: string): Result<BusinessHoldingOption[]> {
  if (!ownsBusiness(db, userId, businessId)) return { ok: false, status: 404, error: 'Business not found' };
  const rows = queryAll<HoldingRow>(db, `SELECT id, name, asset, symbol, asset_class, business_id FROM holdings WHERE user_id = ? ORDER BY asset_class, name COLLATE NOCASE`, [userId]);
  const out: BusinessHoldingOption[] = [];
  for (const h of rows) {
    const key = prefKeyForHoldingClass(h.asset_class);
    if (!key || key === 'business') continue;
    out.push({
      id: h.id,
      label: holdingLabel(h),
      assetClass: key,
      classLabel: CLASS_ORDER.find((o) => o.key === key)?.label ?? key,
      assignedHere: h.business_id === businessId,
      assignedElsewhere: h.business_id != null && h.business_id !== businessId,
    });
  }
  return { ok: true, value: out };
}

/** PUT /api/business/:id/holdings/:holdingId { assigned } — owner only. */
export function assignHolding(db: Database, userId: string, businessId: string, holdingId: string, body: unknown): Result<{ id: string; businessId: string | null }> {
  if (!ownsBusiness(db, userId, businessId)) return { ok: false, status: 404, error: 'Business not found' };
  const assigned = (body as { assigned?: unknown } | null)?.assigned;
  if (typeof assigned !== 'boolean') return { ok: false, status: 400, error: 'assigned must be true or false' };
  const h = queryOne<HoldingRow>(db, `SELECT id, name, asset, symbol, asset_class, business_id FROM holdings WHERE id = ? AND user_id = ?`, [holdingId, userId]);
  if (!h) return { ok: false, status: 404, error: 'Holding not found' };
  const key = prefKeyForHoldingClass(h.asset_class);
  if (!key || key === 'business') return { ok: false, status: 400, error: 'That holding can’t be held by a business' };
  if (assigned) {
    run(db, `UPDATE holdings SET business_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [businessId, new Date().toISOString(), holdingId, userId]);
    return { ok: true, value: { id: holdingId, businessId } };
  }
  // Unassign only from this business; one held by another business is left alone.
  if (h.business_id === businessId) {
    run(db, `UPDATE holdings SET business_id = NULL, updated_at = ? WHERE id = ? AND user_id = ?`, [new Date().toISOString(), holdingId, userId]);
  }
  return { ok: true, value: { id: holdingId, businessId: h.business_id === businessId ? null : h.business_id } };
}

/** When a business is deleted, its holdings go back to being personal. */
export function releaseBusinessHoldings(db: Database, userId: string, businessId: string): void {
  run(db, `UPDATE holdings SET business_id = NULL WHERE user_id = ? AND business_id = ?`, [userId, businessId]);
}
