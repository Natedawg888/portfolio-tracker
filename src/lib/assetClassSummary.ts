/**
 * Settings → Categories & assets: what is in each asset class, from the net worth summary
 * (GET /api/net-worth). Values are the same class totals the Dashboard shows (property and
 * vehicles net of loans); a class whose total is unknown (no quote) shows its count only.
 */
import type { AssetClassPrefKey } from './assetClassPrefs';

export type AssetClassGroupId = 'accounts' | 'investments' | 'owned';

export const ASSET_CLASS_GROUPS: { id: AssetClassGroupId; title: string }[] = [
  { id: 'accounts', title: 'Accounts' },
  { id: 'investments', title: 'Investments' },
  { id: 'owned', title: 'Things you own' },
];

const GROUP_OF: Partial<Record<string, AssetClassGroupId>> = {
  cash: 'accounts',
  kiwisaver: 'accounts',
  real_estate: 'owned',
  vehicles: 'owned',
  collectable: 'owned',
  art: 'owned',
  stone: 'owned',
};

/** Classes not listed above (stocks, crypto, crypto mining, metals, forex, bonds, commodities) are investments. */
export function assetClassGroup(key: string): AssetClassGroupId {
  return GROUP_OF[key] ?? 'investments';
}

/** Order inside "Things you own" (the option list orders the rest). */
const OWNED_ORDER = ['real_estate', 'vehicles', 'collectable', 'art', 'stone'];
const ACCOUNTS_ORDER = ['cash', 'kiwisaver'];

export function orderInGroup<T extends { key: string }>(group: AssetClassGroupId, options: T[]): T[] {
  const order = group === 'owned' ? OWNED_ORDER : group === 'accounts' ? ACCOUNTS_ORDER : null;
  const mine = options.filter((o) => assetClassGroup(o.key) === group);
  if (!order) return mine;
  return [...mine].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

/** cash: count is the NZD bank and wallet accounts behind valueNzd (cards and foreign accounts aren't counted). */
export type ClassContents = { count: number; valueNzd: number | null; noun: [string, string]; cash?: true };

type NetWorthLike = {
  cashNzd?: number | null;
  stocksNzd?: number | null;
  cryptoNzd?: number | null;
  gominingMinersNzd?: number | null;
  metalsNzd?: number | null;
  forexNzd?: number | null;
  realEstateNzd?: number | null;
  realEstateEquityNzd?: number | null;
  artNzd?: number | null;
  stonesNzd?: number | null;
  collectablesNzd?: number | null;
  vehiclesEquityNzd?: number | null;
  bondsNzd?: number | null;
  commoditiesNzd?: number | null;
  kiwiSaverNzd?: number | null;
  counts?: { accounts?: number; cashAccounts?: number };
  holdings?: { assetClass: string }[];
  breakdown?: { holdings?: { assetClass: string }[] };
};

/** Holding-point classes (net worth breakdown) behind each preference key. */
export const POINT_CLASSES: Partial<Record<AssetClassPrefKey, string[]>> = {
  stock: ['stock'],
  crypto: ['crypto', 'defi'],
  gomining: ['gomining_miner'],
  metal: ['metal'],
  forex: ['forex'],
  real_estate: ['real_estate'],
  art: ['art'],
  stone: ['stone'],
  collectable: ['collectable'],
  vehicles: ['vehicle'],
  bonds: ['bond'],
  commodities: ['commodity'],
  kiwisaver: ['kiwisaver'],
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function classContents(raw: unknown, key: string): ClassContents | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as NetWorthLike;
  if (key === 'cash') {
    // Older servers sent only the total account count; fall back to the cash figure alone.
    const n = s.counts?.cashAccounts ?? null;
    if (n == null) {
      const any = s.counts?.accounts ?? 0;
      return { count: any, valueNzd: any > 0 ? num(s.cashNzd) : null, noun: ['account', 'accounts'], cash: true };
    }
    return { count: n, valueNzd: n > 0 ? num(s.cashNzd) : null, noun: ['account', 'accounts'] };
  }
  const points = s.holdings ?? s.breakdown?.holdings;
  const classes = POINT_CLASSES[key as AssetClassPrefKey];
  if (!points || !classes) return null;
  const count = points.filter((p) => classes.includes(p.assetClass)).length;
  const value: Record<string, unknown> = {
    stock: s.stocksNzd,
    crypto: s.cryptoNzd,
    gomining: s.gominingMinersNzd,
    metal: s.metalsNzd,
    forex: s.forexNzd,
    real_estate: s.realEstateEquityNzd ?? s.realEstateNzd,
    art: s.artNzd,
    stone: s.stonesNzd,
    collectable: s.collectablesNzd,
    vehicles: s.vehiclesEquityNzd,
    bonds: s.bondsNzd,
    commodities: s.commoditiesNzd,
    kiwisaver: s.kiwiSaverNzd,
  };
  const noun: [string, string] =
    key === 'real_estate' ? ['property', 'properties'] : key === 'vehicles' ? ['vehicle', 'vehicles'] : key === 'kiwisaver' ? ['account', 'accounts'] : ['holding', 'holdings'];
  return { count, valueNzd: count > 0 ? num(value[key]) : null, noun };
}

const countText = (c: ClassContents) => `${c.count} ${c.count === 1 ? c.noun[0] : c.noun[1]}`;

/** "3 holdings · $115.61", "1 property", "$1,200.50 NZD cash", or "Nothing added". */
export function contentsText(c: ClassContents, money: (n: number) => string): string {
  if (c.count === 0) return 'Nothing added';
  if (c.cash) return c.valueNzd == null ? 'Bank accounts added' : `${money(c.valueNzd)} NZD cash`;
  return c.valueNzd == null ? countText(c) : `${countText(c)} · ${money(c.valueNzd)}`;
}

/** For "[Class] is hidden but you have …": "3 holdings worth $115.61", "1 property", "$1,200.50 NZD cash". */
export function hiddenText(c: ClassContents, money: (n: number) => string): string {
  if (c.cash) return c.valueNzd == null ? `${countText(c)}` : `${money(c.valueNzd)} NZD cash`;
  return c.valueNzd == null ? countText(c) : `${countText(c)} worth ${money(c.valueNzd)}`;
}
