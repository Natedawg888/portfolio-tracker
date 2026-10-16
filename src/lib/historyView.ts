/**
 * History page view logic: which Auckland years have snapshots, year stepping,
 * and the year headline (latest net worth and change since the first snapshot).
 */
import { isClosedQuantity } from './holdingValue';

export type HeadlineSnapshot = { takenAt: string; totalNzd: number };

export type YearHeadline<S extends HeadlineSnapshot> = {
  latest: S;
  first: S;
  /** Null with fewer than 2 snapshots. */
  changeNzd: number | null;
  /** Null with fewer than 2 snapshots, or when the first total is zero or negative. */
  changePct: number | null;
};

const aucklandYear = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric' });

function snapshotYear(takenAt: string): number | null {
  const d = new Date(takenAt);
  if (Number.isNaN(d.getTime())) return null;
  return Number(aucklandYear.format(d));
}

export function snapshotYears(snapshots: { takenAt: string }[]): number[] {
  const years = new Set<number>();
  for (const s of snapshots) {
    const y = snapshotYear(s.takenAt);
    if (y != null) years.add(y);
  }
  return [...years].sort((a, b) => a - b);
}

export function adjacentYears(years: number[], year: number): { prev: number | null; next: number | null } {
  let prev: number | null = null;
  let next: number | null = null;
  for (const y of years) {
    if (y < year && (prev == null || y > prev)) prev = y;
    if (y > year && (next == null || y < next)) next = y;
  }
  return { prev, next };
}

/** `snapshots` are one year's snapshots in ascending takenAt order, as the API returns them. */
export function yearHeadline<S extends HeadlineSnapshot>(snapshots: S[]): YearHeadline<S> | null {
  if (snapshots.length === 0) return null;
  const first = snapshots[0];
  const latest = snapshots[snapshots.length - 1];
  if (snapshots.length < 2) return { latest, first, changeNzd: null, changePct: null };
  const changeNzd = latest.totalNzd - first.totalNzd;
  const changePct = first.totalNzd > 0 ? (changeNzd / first.totalNzd) * 100 : null;
  return { latest, first, changeNzd, changePct };
}

/** Snapshot `breakdown.byClass` keys in display order, with readable names. */
export const CLASS_LABELS: Record<string, string> = {
  kiwiSaver: 'KiwiSaver',
  stocks: 'Stocks',
  gomining: 'GoMining miners',
  crypto: 'Crypto',
  cash: 'Cash',
  metals: 'Metals',
  forex: 'Forex',
  art: 'Art',
  stones: 'Stones',
  realEstate: 'Property',
  collectables: 'Collectables',
  cashLiabilities: 'Cash liabilities (credit cards)',
  realEstateMortgage: 'Mortgage',
  vehicles: 'Vehicles',
  vehicleLoans: 'Vehicle loans',
  defi: 'DeFi positions',
  debt: 'Debt',
};

/** Holding `assetClass` → the byClass key its value is counted under. */
export const ASSET_CLASS_TO_CLASS_KEY: Record<string, string> = {
  stock: 'stocks',
  crypto: 'crypto',
  gomining_miner: 'gomining',
  kiwisaver: 'kiwiSaver',
  metal: 'metals',
  forex: 'forex',
  art: 'art',
  stone: 'stones',
  real_estate: 'realEstate',
  collectable: 'collectables',
  vehicle: 'vehicles',
  defi: 'defi',
};

export function classLabel(classKey: string): string {
  return CLASS_LABELS[classKey] ?? classKey;
}

export function assetClassLabel(assetClass: string): string {
  const key = ASSET_CLASS_TO_CLASS_KEY[assetClass];
  return key ? classLabel(key) : assetClass;
}

/**
 * The net worth line already shows total/assets; cryptoWallets is part of crypto
 * and realEstateEquity is property minus mortgage, so plotting them double counts.
 */
const CHART_EXCLUDED_CLASS_KEYS = new Set(['total', 'assets', 'cryptoWallets', 'realEstateEquity', 'vehiclesEquity']);

/** byClass keys with at least one real value this year, labelled ones first in label order. */
export function chartClassKeys(snapshots: { breakdown?: { byClass?: Record<string, number | null> } }[]): string[] {
  const keys = new Set<string>();
  for (const s of snapshots) {
    for (const [k, v] of Object.entries(s.breakdown?.byClass ?? {})) {
      if (v != null && Number.isFinite(Number(v)) && !CHART_EXCLUDED_CLASS_KEYS.has(k)) keys.add(k);
    }
  }
  const known = Object.keys(CLASS_LABELS);
  return [...known.filter((k) => keys.has(k)), ...[...keys].filter((k) => !(k in CLASS_LABELS)).sort()];
}

type ValuedHolding = { id: string; label: string; valueNzd: number };

/**
 * Every holding seen this year, largest in the latest snapshot first; holdings
 * missing from the latest snapshot follow by label. A stable order keeps colours
 * stable between "top 5" and "show all".
 */
export function holdingOrder(snapshots: { breakdown?: { holdings?: ValuedHolding[] } }[]): string[] {
  const latest = snapshots.at(-1)?.breakdown?.holdings ?? [];
  const ranked = latest
    .filter((h) => Number.isFinite(Number(h.valueNzd)))
    .sort((a, b) => Number(b.valueNzd) - Number(a.valueNzd) || a.label.localeCompare(b.label))
    .map((h) => h.id);
  const seen = new Set(ranked);
  const labels = new Map<string, string>();
  for (const s of snapshots) {
    for (const h of s.breakdown?.holdings ?? []) {
      if (!seen.has(h.id)) labels.set(h.id, h.label || h.id);
    }
  }
  const rest = [...labels.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id]) => id);
  return [...ranked, ...rest];
}

export const TOP_HOLDINGS = 5;

/** Distinct bucket keys across resampled series. One bucket means nothing to draw a line through. */
export function bucketCount(series: { points: { at: string }[] }[]): number {
  return new Set(series.flatMap((s) => s.points.map((p) => p.at))).size;
}

export type LiveHolding = {
  id: string;
  assetClass?: string;
  shares?: number | null;
  amount?: number | null;
  costBasisNzd?: number | null;
};

/** A sold stock or crypto holding the snapshot still valued at its cost basis. */
export type CostValuedSold = {
  holdingId: string;
  label: string;
  assetClass: 'stock' | 'crypto';
  valueNzd: number;
  /** Shares (stock) or units (crypto) held now. */
  held: number;
};

/**
 * Snapshots (by takenAt) that include a holding now held at 0 shares/units yet
 * valued at exactly its cost. Detection only: stored values stay untouched.
 */
export function costValuedSoldFlags(
  snapshots: { takenAt: string; breakdown?: { holdings?: ValuedHolding[] } }[],
  live: LiveHolding[],
): Map<string, CostValuedSold[]> {
  const sold = new Map<string, { assetClass: 'stock' | 'crypto'; held: number; cost: number }>();
  for (const h of live) {
    if (h.assetClass !== 'stock' && h.assetClass !== 'crypto') continue;
    const quantity = h.assetClass === 'stock' ? h.shares : h.amount;
    const held = Number(quantity);
    const cost = Number(h.costBasisNzd);
    if (!isClosedQuantity(quantity) || h.costBasisNzd == null || !Number.isFinite(cost)) continue;
    sold.set(h.id, { assetClass: h.assetClass, held: Number.isFinite(held) ? held : 0, cost });
  }
  const out = new Map<string, CostValuedSold[]>();
  if (sold.size === 0) return out;
  for (const s of snapshots) {
    const hits: CostValuedSold[] = [];
    for (const h of s.breakdown?.holdings ?? []) {
      const live = sold.get(h.id);
      const value = Number(h.valueNzd);
      if (!live || !(value > 0) || Math.abs(value - live.cost) > 0.01) continue;
      hits.push({ holdingId: h.id, label: h.label || h.id, assetClass: live.assetClass, valueNzd: value, held: live.held });
    }
    if (hits.length > 0) out.set(s.takenAt, hits);
  }
  return out;
}

/** Which of a snapshot's flags apply to a chart line: all on net worth, by class or holding otherwise. */
export function flagsForSeries(seriesKey: string, flags: CostValuedSold[]): CostValuedSold[] {
  if (seriesKey === 'net') return flags;
  return flags.filter(
    (f) =>
      seriesKey === `class:${ASSET_CLASS_TO_CLASS_KEY[f.assetClass]}` || seriesKey === `hold:${f.holdingId}`,
  );
}

export function costValuedSoldSentence(flags: CostValuedSold[], formatMoney: (n: number) => string): string {
  const parts = flags.map(
    (f) =>
      `Includes ${f.label} ${formatMoney(f.valueNzd)} valued at cost although ${f.held} ${f.assetClass === 'stock' ? 'shares are' : 'units are'} held.`,
  );
  const total = flags.reduce((sum, f) => sum + f.valueNzd, 0);
  return `${parts.join(' ')} Net worth is overstated by about ${formatMoney(total)}.`;
}

export type SnapshotHolding = { id: string; label: string; assetClass: string; valueNzd: number };

export type ClassGroup<H extends SnapshotHolding> = {
  /** The byClass key, so the group matches its "By class" chart line. */
  classKey: string;
  label: string;
  totalNzd: number;
  /** Largest first. */
  holdings: H[];
};

/** One snapshot's holdings grouped by class, largest class total first. */
export function holdingsByClass<H extends SnapshotHolding>(holdings: H[]): ClassGroup<H>[] {
  const groups = new Map<string, ClassGroup<H>>();
  for (const h of holdings) {
    const value = Number(h.valueNzd);
    if (!Number.isFinite(value)) continue;
    const classKey = ASSET_CLASS_TO_CLASS_KEY[h.assetClass] ?? h.assetClass;
    const group = groups.get(classKey) ?? { classKey, label: assetClassLabel(h.assetClass), totalNzd: 0, holdings: [] };
    group.totalNzd += value;
    group.holdings.push(h);
    groups.set(classKey, group);
  }
  const byValue = (a: { valueNzd: number; label: string }, b: { valueNzd: number; label: string }) =>
    Number(b.valueNzd) - Number(a.valueNzd) || a.label.localeCompare(b.label);
  return [...groups.values()]
    .map((g) => ({ ...g, holdings: g.holdings.slice().sort(byValue) }))
    .sort((a, b) => b.totalNzd - a.totalNzd || a.label.localeCompare(b.label));
}

export function costValuedBadge(flag: CostValuedSold): string {
  return `${flag.assetClass === 'stock' ? '0 shares' : '0 held'} · valued at cost`;
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

/** Warning for the latest snapshot's flags. The caller prefixes the ⚠ glyph. */
export function costValuedWarning(flags: CostValuedSold[], formatMoney: (n: number) => string): string {
  const total = flags.reduce((sum, f) => sum + f.valueNzd, 0);
  return `${joinLabels(flags.map((f) => f.label))} counted at cost though you hold none — net worth is overstated by ${formatMoney(total)}.`;
}
