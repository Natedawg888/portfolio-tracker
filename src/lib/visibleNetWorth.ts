/**
 * Net worth without the asset classes turned off in Settings → Categories & assets.
 * Snapshots keep every class; this is applied when figures are read (Dashboard total, History,
 * Yearly report, Projections), so turning a class back on brings its history straight back.
 *
 * A hidden class takes out what it adds to the total. Property and vehicles count net of the
 * loans recorded on them, so those loans go with them. Card balances and personal debts are
 * debt, not an asset class, and always count.
 */
import { ASSET_CLASS_PREF_OPTIONS, isAssetClassEnabled, type AssetClassPrefKey, type AssetClassPrefs } from './assetClassPrefs';
import { POINT_CLASSES } from './assetClassSummary';

type ByClass = Record<string, number | null | undefined>;

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The net worth breakdown keys that belong to each class (set to null when it is hidden). */
const BY_CLASS_KEYS: Record<AssetClassPrefKey, string[]> = {
  cash: ['cash'],
  stock: ['stocks'],
  crypto: ['crypto', 'cryptoWallets', 'defi'],
  gomining: ['gomining'],
  metal: ['metals'],
  forex: ['forex'],
  real_estate: ['realEstate', 'realEstateMortgage', 'realEstateEquity'],
  art: ['art'],
  stone: ['stones'],
  collectable: ['collectables'],
  vehicles: ['vehicles', 'vehicleLoans', 'vehiclesEquity'],
  business: ['business'],
  bonds: ['bonds'],
  commodities: ['commodities'],
  kiwisaver: ['kiwiSaver'],
};

/** What a class adds to the total (property and vehicles net of their loans). */
export function classNetNzd(byClass: ByClass, key: AssetClassPrefKey): number {
  const b = byClass;
  switch (key) {
    case 'cash':
      return n(b.cash);
    case 'stock':
      return n(b.stocks);
    case 'crypto':
      return n(b.crypto) + n(b.defi);
    case 'gomining':
      return n(b.gomining);
    case 'metal':
      return n(b.metals);
    case 'forex':
      return n(b.forex);
    case 'real_estate':
      return b.realEstateEquity != null ? n(b.realEstateEquity) : n(b.realEstate) - n(b.realEstateMortgage);
    case 'art':
      return n(b.art);
    case 'stone':
      return n(b.stones);
    case 'collectable':
      return n(b.collectables);
    case 'vehicles':
      return b.vehiclesEquity != null ? n(b.vehiclesEquity) : n(b.vehicles) - n(b.vehicleLoans);
    case 'business':
      return n(b.business);
    case 'bonds':
      return n(b.bonds);
    case 'commodities':
      return n(b.commodities);
    case 'kiwisaver':
      return n(b.kiwiSaver);
  }
}

/** What a class adds to assets (before the loans on property and vehicles). */
function classGrossNzd(byClass: ByClass, key: AssetClassPrefKey): number {
  if (key === 'real_estate') return n(byClass.realEstate);
  if (key === 'vehicles') return n(byClass.vehicles);
  return classNetNzd(byClass, key);
}

export type HiddenClass = { key: AssetClassPrefKey; label: string; nzd: number };

export type HiddenTotals = {
  /** Hidden classes that hold something, in Settings order. */
  classes: HiddenClass[];
  /** Taken off the total. */
  netNzd: number;
  /** Taken off assets. */
  grossNzd: number;
};

const cents = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export function hiddenTotals(byClass: ByClass | null | undefined, prefs: AssetClassPrefs | null | undefined): HiddenTotals {
  const out: HiddenTotals = { classes: [], netNzd: 0, grossNzd: 0 };
  if (!byClass || !prefs) return out;
  for (const opt of ASSET_CLASS_PREF_OPTIONS) {
    if (isAssetClassEnabled(prefs, opt.key)) continue;
    const net = classNetNzd(byClass, opt.key);
    const gross = classGrossNzd(byClass, opt.key);
    if (net === 0 && gross === 0) continue;
    out.classes.push({ key: opt.key, label: opt.key === 'cash' ? 'Cash & banks' : opt.label, nzd: cents(net) });
    out.netNzd += net;
    out.grossNzd += gross;
  }
  out.netNzd = cents(out.netNzd);
  out.grossNzd = cents(out.grossNzd);
  return out;
}

type SnapshotBreakdown = {
  byClass?: ByClass;
  holdings?: { assetClass: string }[];
  assetsKnownNzd?: number;
  [k: string]: unknown;
};

/**
 * A stored snapshot as History should show it: total, assets, class lines and holdings without
 * the hidden classes. A snapshot with no class breakdown (very old) keeps its stored total.
 */
export function visibleSnapshot<S extends { totalNzd: number; breakdown: unknown }>(
  snapshot: S,
  prefs: AssetClassPrefs | null | undefined,
): S & { hiddenNzd: number } {
  const breakdown = (snapshot.breakdown && typeof snapshot.breakdown === 'object' ? snapshot.breakdown : {}) as SnapshotBreakdown;
  const byClass = breakdown.byClass;
  const hidden = hiddenTotals(byClass, prefs);
  const hiddenKeys = ASSET_CLASS_PREF_OPTIONS.filter((o) => !isAssetClassEnabled(prefs, o.key)).map((o) => o.key);
  if (!byClass || hiddenKeys.length === 0) return { ...snapshot, hiddenNzd: 0 };

  const nextByClass: ByClass = { ...byClass };
  for (const key of hiddenKeys) for (const k of BY_CLASS_KEYS[key]) if (k in nextByClass) nextByClass[k] = null;
  if (typeof byClass.total === 'number') nextByClass.total = cents(byClass.total - hidden.netNzd);
  if (typeof byClass.assets === 'number') nextByClass.assets = cents(byClass.assets - hidden.grossNzd);

  const hiddenPoints = new Set(hiddenKeys.flatMap((k) => POINT_CLASSES[k] ?? []));
  return {
    ...snapshot,
    totalNzd: cents(snapshot.totalNzd - hidden.netNzd),
    hiddenNzd: hidden.netNzd,
    breakdown: {
      ...breakdown,
      byClass: nextByClass,
      ...(breakdown.holdings ? { holdings: breakdown.holdings.filter((h) => !hiddenPoints.has(h.assetClass)) } : {}),
      ...(typeof breakdown.assetsKnownNzd === 'number' ? { assetsKnownNzd: cents(breakdown.assetsKnownNzd - hidden.grossNzd) } : {}),
    },
  };
}

/** "Leaves out Property ($240,000.00), hidden in Settings → Categories & assets." */
export function hiddenClassesSentence(classes: { label: string; nzd: number }[], money: (n: number) => string): string {
  const parts = classes.map((c) => `${c.label} (${money(c.nzd)})`);
  const list = parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `Leaves out ${list}, hidden in Settings → Categories & assets.`;
}
