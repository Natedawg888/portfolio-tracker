/**
 * Asset-class visibility preferences (signup toggles + settings).
 * Keys match app domains: holdings assetClass, KiwiSaver page, Cash/Banks.
 */

export const ASSET_CLASS_PREF_KEYS = [
  'stock',
  'crypto',
  'gomining',
  'metal',
  'forex',
  'real_estate',
  'art',
  'stone',
  'collectable',
  'vehicles',
  'business',
  'bonds',
  'commodities',
  'kiwisaver',
  'cash',
] as const;

export type AssetClassPrefKey = (typeof ASSET_CLASS_PREF_KEYS)[number];

export type AssetClassPrefs = Record<AssetClassPrefKey, boolean>;

export type AssetClassPrefMeta = {
  key: AssetClassPrefKey;
  label: string;
  blurb: string;
};

/** Ordered options shown on signup / settings — labels match UI sections. */
export const ASSET_CLASS_PREF_OPTIONS: AssetClassPrefMeta[] = [
  { key: 'stock', label: 'Stocks', blurb: 'Sharesies / Hatch / manual tickers' },
  { key: 'crypto', label: 'Crypto', blurb: 'BTC, ETH, Nexo, etc.' },
  { key: 'gomining', label: 'Crypto mining', blurb: 'Your own rigs and cloud mining (GoMining…)' },
  { key: 'metal', label: 'Metals', blurb: 'Gold, silver, platinum, palladium' },
  { key: 'forex', label: 'Forex', blurb: 'Foreign cash (Revolut etc.)' },
  { key: 'real_estate', label: 'Property', blurb: 'Market value − mortgage' },
  { key: 'art', label: 'Art', blurb: 'Fractional or physical' },
  { key: 'stone', label: 'Precious stones', blurb: 'Diamonds & gems' },
  { key: 'collectable', label: 'Collectables', blurb: 'MTG, Pokémon, figurines' },
  { key: 'vehicles', label: 'Vehicles', blurb: 'Cars, bikes, boats − loans' },
  { key: 'business', label: 'Business assets', blurb: 'Livestock, beehives, equipment, stock' },
  { key: 'bonds', label: 'Bonds & fixed income', blurb: 'Govt & corporate bonds, term deposits' },
  { key: 'commodities', label: 'Commodities', blurb: 'Scrap metal, honey, wool, oil, livestock' },
  { key: 'kiwisaver', label: 'KiwiSaver', blurb: 'Sharesies KiwiSaver (read-only)' },
  { key: 'cash', label: 'Cash / Banks', blurb: 'NZD bank & wallet balances' },
];

export function defaultAssetClassPrefs(): AssetClassPrefs {
  const out = {} as AssetClassPrefs;
  for (const k of ASSET_CLASS_PREF_KEYS) out[k] = true;
  return out;
}

export function normalizeAssetClassPrefs(raw: unknown): AssetClassPrefs {
  const base = defaultAssetClassPrefs();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;
  for (const k of ASSET_CLASS_PREF_KEYS) {
    if (typeof o[k] === 'boolean') base[k] = o[k];
  }
  return base;
}

/** Map holding.assetClass → preference key (gomining_miner → gomining). */
export function prefKeyForHoldingClass(assetClass: string): AssetClassPrefKey | null {
  switch (assetClass) {
    case 'stock':
      return 'stock';
    case 'crypto':
      return 'crypto';
    case 'gomining_miner':
      return 'gomining';
    case 'metal':
      return 'metal';
    case 'forex':
      return 'forex';
    case 'real_estate':
      return 'real_estate';
    case 'art':
      return 'art';
    case 'stone':
      return 'stone';
    case 'collectable':
      return 'collectable';
    default:
      return null;
  }
}

export function isAssetClassEnabled(
  prefs: AssetClassPrefs | null | undefined,
  key: AssetClassPrefKey,
): boolean {
  if (!prefs) return true;
  return prefs[key] !== false;
}
