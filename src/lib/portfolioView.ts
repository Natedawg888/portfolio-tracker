/**
 * Portfolio page view logic: returns without ∞, tabs + URL hash, the
 * "Needs a look" checks and allocation shares. Pure functions over the
 * figures the API already returns; nothing here is estimated.
 */

import { isClosedQuantity } from './holdingValue';

export type HoldingReturn =
  | { kind: 'no_value' }
  /** Cost missing or 0: no return can be worked out — show "+ Add cost". */
  | { kind: 'no_cost' }
  | { kind: 'ok'; returnNzd: number; pct: number };

/** Value vs cost. Never produces ±∞: a missing or zero cost is "no_cost". */
export function holdingReturn(valueNzd: number | null | undefined, costNzd: number | null | undefined): HoldingReturn {
  if (valueNzd == null || !Number.isFinite(valueNzd)) return { kind: 'no_value' };
  if (costNzd == null || !Number.isFinite(costNzd) || costNzd <= 0) return { kind: 'no_cost' };
  const returnNzd = valueNzd - costNzd;
  return { kind: 'ok', returnNzd, pct: (returnNzd / costNzd) * 100 };
}

/** "+12.34%" / "−5.00%" — the sign always shows, so colour is never the only signal. */
export function formatSignedPct(pct: number): string {
  if (!Number.isFinite(pct)) return '—';
  const rounded = Math.round(pct * 100) / 100;
  if (rounded === 0) return '0.00%';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(2)}%`;
}

export const PORTFOLIO_TABS = [
  'overview',
  'stocks',
  'dividends',
  'crypto',
  'mining',
  'metals',
  'collectables',
  'other',
] as const;
export type PortfolioTab = (typeof PORTFOLIO_TABS)[number];

export const TAB_LABELS: Record<PortfolioTab, string> = {
  overview: 'Overview',
  stocks: 'Stocks',
  dividends: 'Dividends',
  crypto: 'Crypto',
  mining: 'Mining',
  metals: 'Metals',
  collectables: 'Collectables',
  other: 'Other assets',
};

/** Asset-class preference keys each tab needs (any one enables it). Overview always shows. */
export const TAB_PREFS: Record<PortfolioTab, string[]> = {
  overview: [],
  stocks: ['stock'],
  dividends: ['stock'],
  crypto: ['crypto'],
  mining: ['gomining'],
  metals: ['metal'],
  collectables: ['collectable'],
  other: ['forex', 'real_estate', 'art', 'stone'],
};

export function visibleTabs(enabled: (pref: string) => boolean): PortfolioTab[] {
  return PORTFOLIO_TABS.filter((t) => t === 'overview' || TAB_PREFS[t].some((p) => enabled(p)));
}

/** "#stocks" → 'stocks' when that tab is visible; anything else → overview. */
export function tabFromHash(hash: string, visible: PortfolioTab[]): PortfolioTab {
  const key = hash.replace(/^#/, '').toLowerCase();
  return (visible as string[]).includes(key) ? (key as PortfolioTab) : 'overview';
}

export function tabId(tab: PortfolioTab): string {
  return `portfolio-tab-${tab}`;
}

export function panelId(tab: PortfolioTab): string {
  return `portfolio-panel-${tab}`;
}

/** DOM id of a holding's row or card; Value Search links scroll to it. */
export function holdingDomId(holdingId: string): string {
  return `holding-${holdingId}`;
}

/** Arrow-key target in a tablist (wraps; Home / End jump). */
export function nextTab(tabs: PortfolioTab[], current: PortfolioTab, key: string): PortfolioTab | null {
  const i = tabs.indexOf(current);
  if (i < 0) return null;
  if (key === 'ArrowRight') return tabs[(i + 1) % tabs.length];
  if (key === 'ArrowLeft') return tabs[(i - 1 + tabs.length) % tabs.length];
  if (key === 'Home') return tabs[0];
  if (key === 'End') return tabs[tabs.length - 1];
  return null;
}

export type IssueHolding = {
  id: string;
  assetClass: string;
  name: string;
  source?: string | null;
  shares?: number | null;
  amount?: number | null;
  costNzd: number | null;
  valueNzd: number | null;
};

export type PortfolioIssue = {
  key: string;
  tab: PortfolioTab;
  text: string;
  action: string;
};

const SYNCED = new Set(['Sharesies', 'Hatch']);
const qty = (h: IssueHolding) => Number(h.assetClass === 'stock' ? h.shares : h.amount);
const CLASS_TAB: Record<string, PortfolioTab> = {
  stock: 'stocks',
  crypto: 'crypto',
  gomining_miner: 'mining',
  metal: 'metals',
};
const CLASS_PLURAL: Record<string, string> = {
  stock: 'stock',
  crypto: 'crypto',
  gomining_miner: 'miner',
  metal: 'metal',
};

/**
 * Problems worth a look, only the ones that apply:
 *  - stock positions at 0 shares that still carry a cost (sold, still listed by Akahu);
 *  - empty (0-quantity) crypto lines;
 *  - holdings with a value but no cost, so no return can be shown (per class);
 *  - synced stocks whose recorded cost is over 2× their value — Akahu's cost is
 *    "value − returns", which keeps money from shares already sold.
 */
export function findIssues(holdings: IssueHolding[]): PortfolioIssue[] {
  const issues: PortfolioIssue[] = [];
  const closed = holdings.filter((h) => h.assetClass === 'stock' && isClosedQuantity(h.shares));
  if (closed.length > 0) {
    issues.push({
      key: 'closed-stocks',
      tab: 'stocks',
      text: `${listNames(closed)} ${closed.length === 1 ? 'has' : 'have'} 0 shares but ${closed.length === 1 ? 'is' : 'are'} still listed with a cost.`,
      action: 'Review closed positions',
    });
  }
  const emptyCrypto = holdings.filter((h) => h.assetClass === 'crypto' && isClosedQuantity(h.amount));
  if (emptyCrypto.length > 0) {
    issues.push({
      key: 'empty-crypto',
      tab: 'crypto',
      text: `${emptyCrypto.length} crypto holding${emptyCrypto.length === 1 ? ' is' : 's are'} empty (0 quantity): ${listNames(emptyCrypto)}.`,
      action: 'Review',
    });
  }
  for (const cls of Object.keys(CLASS_TAB)) {
    const missing = holdings.filter(
      (h) =>
        h.assetClass === cls &&
        (cls === 'gomining_miner' || cls === 'metal' || qty(h) > 0) &&
        h.valueNzd != null &&
        h.valueNzd > 0 &&
        !(h.costNzd != null && h.costNzd > 0),
    );
    if (missing.length > 0) {
      issues.push({
        key: `no-cost-${cls}`,
        tab: CLASS_TAB[cls],
        text: `${missing.length} ${CLASS_PLURAL[cls]} holding${missing.length === 1 ? ' has' : 's have'} no cost, so no return can be shown.`,
        action: 'Add costs',
      });
    }
  }
  const highCost = holdings.filter(
    (h) =>
      h.assetClass === 'stock' &&
      SYNCED.has(h.source ?? '') &&
      qty(h) > 0 &&
      h.costNzd != null &&
      h.valueNzd != null &&
      h.valueNzd > 0 &&
      h.costNzd > 2 * h.valueNzd,
  );
  if (highCost.length > 0) {
    issues.push({
      key: 'synced-cost',
      tab: 'stocks',
      text: `${listNames(highCost)}: recorded cost is more than twice the value. Akahu’s cost keeps money from shares already sold.`,
      action: 'Review',
    });
  }
  return issues;
}

function listNames(rows: Array<{ name: string }>): string {
  const names = rows.map((r) => r.name);
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
}

/** Share of the positive total, as a 0–100 percent; null when the total is 0. */
export function shareOfTotal(value: number, total: number): number | null {
  if (!(total > 0) || !Number.isFinite(value)) return null;
  return (Math.max(0, value) / total) * 100;
}

/** Percent change from the first to the last point of a price series; null with fewer than 2 points. */
export function seriesChangePct(points: Array<{ price: number }>): number | null {
  const valid = points.filter((p) => Number.isFinite(p.price) && p.price > 0);
  if (valid.length < 2) return null;
  const first = valid[0].price;
  const last = valid[valid.length - 1].price;
  return ((last - first) / first) * 100;
}

export type SourceHolding = {
  assetClass: string;
  source?: string | null;
  cardGame?: string | null;
  notes?: string | null;
  stoneType?: string | null;
};

/**
 * Price sources actually in use, for the header line, in a fixed order.
 * Derived from the holdings themselves (Akahu-synced vs manual, card games,
 * FX notes) and the metal spot provider the server reported.
 */
export function priceSources(holdings: SourceHolding[], metalsProvider: 'gold-api' | 'metals_dev' | null): string[] {
  const found = new Set<string>();
  for (const h of holdings) {
    const synced = h.source === 'Sharesies' || h.source === 'Hatch';
    if (synced) found.add('Akahu');
    if (h.assetClass === 'stock' && !synced) found.add('Yahoo');
    if (h.assetClass === 'crypto' && !synced) found.add('CoinGecko');
    if (h.assetClass === 'forex' || /frankfurter/i.test(h.notes ?? '')) found.add('Frankfurter FX');
    if (h.assetClass === 'gomining_miner') found.add('GoMining');
    if (h.assetClass === 'metal') found.add(metalsProvider === 'metals_dev' ? 'Metals.Dev' : 'gold-api.com');
    if (h.assetClass === 'collectable' && h.cardGame === 'mtg') found.add('Scryfall');
    if (h.assetClass === 'collectable' && h.cardGame === 'pokemon') found.add('Pokémon TCG API');
    if (h.assetClass === 'stone' && /diamond/i.test(h.stoneType ?? '')) found.add('OpenFacet');
  }
  const order = [
    'Akahu',
    'Yahoo',
    'Frankfurter FX',
    'CoinGecko',
    'GoMining',
    'gold-api.com',
    'Metals.Dev',
    'Scryfall',
    'Pokémon TCG API',
    'OpenFacet',
  ];
  return order.filter((s) => found.has(s));
}
