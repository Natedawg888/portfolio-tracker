/**
 * Value Search logic that needs no network: the metal headline for the chosen unit,
 * "You own …" against the user's holdings, the "Add to Portfolio" link, the "Things you
 * own" shortcuts, recent searches and the page's sources line.
 * Run tests: npm run test:value-search
 */
import { isClosedQuantity } from './holdingValue.ts';
import { marketValueNzd, type Holding } from './holdingDisplay.ts';
import { TROY_OZ_GRAMS, type MetalDisplayUnit } from './metalUnits.ts';
import {
  FOREX_CURRENCIES,
  holdingHref,
  portfolioAddHref,
  type PortfolioAddRequest,
} from './portfolioAddParams.ts';
import type { PortfolioTab } from './portfolioView.ts';
import {
  normalizeQuery,
  SEARCH_TYPES,
  SOURCE_NAME,
  type MetalAmountUnit,
  type SearchType,
} from './valueSearchDetect.ts';
import type { LookupResult } from './valueSearchLookup.ts';

const GRAMS_PER: Record<MetalAmountUnit, number> = { oz_t: TROY_OZ_GRAMS, g: 1, kg: 1000 };
const UNIT_LABEL: Record<MetalAmountUnit, string> = { oz_t: 'oz t', g: 'g', kg: 'kg' };

const qty = (n: number) => n.toLocaleString('en-NZ', { maximumFractionDigits: 8 });

/**
 * Metal headline for the oz t / gram toggle: the price per unit, or the value of the
 * amount the query asked for ("silver 10 oz") with the per-unit price in the note.
 */
export function metalHeadline(
  perOzNzd: number | null,
  amount: number | null,
  amountUnit: MetalAmountUnit | null,
  displayUnit: MetalDisplayUnit,
): { value: number | null; perUnit: number | null; note: string } {
  const perUnit = perOzNzd == null ? null : (perOzNzd * GRAMS_PER[displayUnit]) / TROY_OZ_GRAMS;
  const per = displayUnit === 'g' ? 'per gram' : 'per oz t';
  if (amount == null) return { value: perUnit, perUnit, note: per };
  const unit = amountUnit ?? displayUnit;
  const value = perOzNzd == null ? null : (perOzNzd * amount * GRAMS_PER[unit]) / TROY_OZ_GRAMS;
  return { value, perUnit, note: `${qty(amount)} ${UNIT_LABEL[unit]}` };
}

/** "You own …" line. `worthNzd` is null when any matched holding has no value of its own. */
export type Owned = { text: string; worthNzd: number | null; href: string };

function quantityOf(h: Holding): unknown {
  switch (h.assetClass) {
    case 'stock':
      return h.shares;
    case 'collectable':
      return h.quantity;
    case 'gomining_miner':
      return h.hashrateThs;
    default:
      return h.amount;
  }
}

/** Holdings that still hold something (sold lines keep a 0 quantity). */
function open(holdings: readonly Holding[], assetClass: string): Holding[] {
  return holdings.filter((h) => h.assetClass === assetClass && !isClosedQuantity(quantityOf(h)));
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/** Both sides must agree only when both sides say something. */
const looseSame = (a: string | null | undefined, b: string | null | undefined) =>
  !a?.trim() || !b?.trim() || same(a, b);

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/** The holding's own value, as Portfolio shows it; never the searched price × quantity. */
function worth(matches: Holding[]): number | null {
  const values = matches.map(marketValueNzd);
  return values.every((v): v is number => v != null) ? sum(values) : null;
}

function owned(matches: Holding[], tab: PortfolioTab, text: string): Owned | null {
  if (matches.length === 0) return null;
  return { text, worthNzd: worth(matches), href: holdingHref(tab, matches[0].id) };
}

function matchStocks(symbol: string, holdings: Holding[]): Holding[] {
  const exact = holdings.filter((h) => same(h.symbol, symbol));
  if (exact.length > 0) return exact;
  const base = (s: string | undefined) => (s ?? '').trim().toUpperCase().replace(/\.NZ$/, '');
  const near = holdings.filter((h) => base(h.symbol) === base(symbol));
  // "AIR" ↔ "AIR.NZ" only when every candidate is the same listing.
  return new Set(near.map((h) => h.symbol?.toUpperCase())).size === 1 ? near : [];
}

function foreignCurrency(from: string, to: string): string {
  return from === 'NZD' ? to : from;
}

export function findOwned(result: LookupResult, holdings: readonly Holding[]): Owned | null {
  switch (result.type) {
    case 'stock': {
      const m = matchStocks(result.symbol, open(holdings, 'stock'));
      const shares = sum(m.map((h) => Number(h.shares)));
      return owned(m, 'stocks', `You own ${qty(shares)} ${shares === 1 ? 'share' : 'shares'}`);
    }
    case 'crypto': {
      const m = open(holdings, 'crypto').filter((h) => same(h.asset, result.symbol));
      return owned(m, 'crypto', `You own ${qty(sum(m.map((h) => Number(h.amount))))} ${result.symbol}`);
    }
    case 'metal': {
      const m = open(holdings, 'metal').filter((h) => same(h.metal, result.metal));
      const units = new Set(m.map((h) => (h.unit === 'g' ? 'g' : 'oz_t')));
      const unit: MetalAmountUnit = units.size === 1 && units.has('g') ? 'g' : 'oz_t';
      const total = sum(m.map((h) => (Number(h.amount) * GRAMS_PER[h.unit === 'g' ? 'g' : 'oz_t']) / GRAMS_PER[unit]));
      return owned(m, 'metals', `You own ${qty(total)} ${UNIT_LABEL[unit]} of ${result.metal}`);
    }
    case 'currency': {
      const code = foreignCurrency(result.from, result.to);
      const m = open(holdings, 'forex').filter((h) => same(h.currency, code));
      return owned(m, 'other', `You own ${qty(sum(m.map((h) => Number(h.amount))))} ${code}`);
    }
    case 'mtg':
    case 'pokemon': {
      const { card } = result;
      const m = open(holdings, 'collectable').filter(
        (h) =>
          same(h.cardGame, result.type) &&
          (card.apiId && h.cardApiId
            ? same(h.cardApiId, card.apiId)
            : same(h.name, card.name) &&
              looseSame(h.cardSet, card.set) &&
              looseSame(h.cardNumber, card.number) &&
              looseSame(h.cardFinish, card.finish)),
      );
      const copies = sum(m.map((h) => Number(h.quantity)));
      return owned(m, 'collectables', `You own ${qty(copies)} ${copies === 1 ? 'copy' : 'copies'}`);
    }
    case 'miner': {
      const m = open(holdings, 'gomining_miner');
      const ths = sum(m.map((h) => Number(h.hashrateThs)));
      return owned(m, 'mining', `You own ${m.length} ${m.length === 1 ? 'miner' : 'miners'}, ${qty(ths)} TH/s total`);
    }
    case 'diamond':
      return null;
  }
}

/**
 * The add request for this result, or null when Portfolio has no add form for it or the
 * lookup found nothing to add.
 */
export function addRequestFor(result: LookupResult, opts: { forexEnabled: boolean }): PortfolioAddRequest | null {
  if (result.status.kind === 'unavailable') return null;
  switch (result.type) {
    case 'stock':
    case 'crypto':
      return { kind: result.type, ticker: result.symbol };
    case 'metal': {
      // The Portfolio metal form takes grams or troy ounces.
      const { amount, amountUnit } = result;
      if (amountUnit === 'kg') {
        return { kind: 'metal', metal: result.metal, amount: amount == null ? null : amount * 1000, unit: 'g' };
      }
      return { kind: 'metal', metal: result.metal, amount, unit: amountUnit };
    }
    case 'currency': {
      const code = foreignCurrency(result.from, result.to);
      const currency = FOREX_CURRENCIES.find((c) => c === code);
      if (!opts.forexEnabled || !currency) return null;
      return { kind: 'forex', currency, amount: result.from === code ? result.amount : null };
    }
    case 'miner':
      return { kind: 'miner', ths: result.ths, wPerTh: result.wPerTh };
    case 'mtg':
    case 'pokemon':
      return { kind: 'card', game: result.type, ...result.card, name: result.card.name || null };
    case 'diamond':
      return null;
  }
}

const ADD_LABEL: Record<PortfolioAddRequest['kind'], string> = {
  stock: 'Add to Portfolio',
  crypto: 'Add to Portfolio',
  metal: 'Add to Portfolio',
  forex: 'Add to Portfolio',
  card: 'Add to collection',
  miner: 'Add miner',
};

export function addAction(
  result: LookupResult,
  opts: { forexEnabled: boolean },
): { label: string; href: string } | null {
  const req = addRequestFor(result, opts);
  return req ? { label: ADD_LABEL[req.kind], href: portfolioAddHref(req) } : null;
}

/** A search the user can run in one tap: a "Things you own" shortcut or a recent search. */
export type SavedSearch = { query: string; type: SearchType };
export type Shortcut = SavedSearch & { label: string };

const searchKey = (s: SavedSearch) => `${s.type}:${normalizeQuery(s.query).toLowerCase()}`;

const SHORTCUT_LIMIT = 10;

function shortcutFor(h: Holding): Shortcut | null {
  const name = (s: string | null | undefined) => s?.trim() || null;
  switch (h.assetClass) {
    case 'stock': {
      const symbol = name(h.symbol)?.toUpperCase();
      return symbol ? { label: symbol, query: symbol, type: 'stock' } : null;
    }
    case 'crypto': {
      const asset = name(h.asset)?.toUpperCase();
      return asset ? { label: asset, query: asset, type: 'crypto' } : null;
    }
    case 'metal': {
      const metal = name(h.metal)?.toLowerCase();
      return metal ? { label: metal[0].toUpperCase() + metal.slice(1), query: metal, type: 'metal' } : null;
    }
    case 'collectable': {
      const card = name(h.name);
      const game = h.cardGame === 'mtg' || h.cardGame === 'pokemon' ? h.cardGame : null;
      return card && game ? { label: card, query: card, type: game } : null;
    }
    default:
      return null;
  }
}

/**
 * "Things you own": one button per distinct stock, coin, metal and card still held, plus
 * one for all miners together, biggest holding first. Types not in `types` are left out.
 */
export function ownedShortcuts(holdings: readonly Holding[], types: readonly SearchType[]): Shortcut[] {
  const byKey = new Map<string, { shortcut: Shortcut; value: number }>();
  let minerThs = 0;
  let minerValue = 0;
  for (const h of holdings) {
    if (isClosedQuantity(quantityOf(h))) continue;
    const value = marketValueNzd(h) ?? 0;
    if (h.assetClass === 'gomining_miner') {
      minerThs += Number(h.hashrateThs) || 0;
      minerValue += value;
      continue;
    }
    const shortcut = shortcutFor(h);
    if (!shortcut || !types.includes(shortcut.type)) continue;
    const key = searchKey(shortcut);
    const seen = byKey.get(key);
    if (seen) seen.value += value;
    else byKey.set(key, { shortcut, value });
  }
  if (minerThs > 0 && types.includes('miner')) {
    const ths = Number(minerThs.toFixed(4));
    byKey.set('miner', { shortcut: { label: `${qty(ths)} TH/s`, query: `${ths} TH`, type: 'miner' }, value: minerValue });
  }
  return [...byKey.values()]
    .sort((a, b) => b.value - a.value || a.shortcut.label.localeCompare(b.shortcut.label))
    .slice(0, SHORTCUT_LIMIT)
    .map((e) => e.shortcut);
}

const RECENT_LIMIT = 5;

/** Most recent first; an earlier copy of the same search moves to the top. */
export function pushRecent(recents: readonly SavedSearch[], next: SavedSearch): SavedSearch[] {
  const entry = { query: normalizeQuery(next.query), type: next.type };
  if (!entry.query) return [...recents];
  const key = searchKey(entry);
  return [entry, ...recents.filter((r) => searchKey(r) !== key)].slice(0, RECENT_LIMIT);
}

/** Stored recents; anything unreadable or of an unknown type is dropped. */
export function parseRecents(raw: string | null): SavedSearch[] {
  let data: unknown;
  try {
    data = JSON.parse(raw ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const valid = data.filter((item): item is SavedSearch => {
    const r = item as Partial<SavedSearch> | null;
    return typeof r?.query === 'string' && SEARCH_TYPES.includes(r.type as SearchType);
  });
  // Oldest first through pushRecent keeps the newest copy of any duplicate, in stored order.
  return valid.reduceRight<SavedSearch[]>((acc, r) => pushRecent(acc, r), []);
}

/**
 * Sources behind the visible types, in type order. Metals name the provider the server
 * says is in use (Metals.Dev when its key is configured, otherwise gold-api.com).
 */
export function pageSources(types: readonly SearchType[], metalProvider: string | null): string[] {
  return types.map((t) =>
    t === 'metal' && (metalProvider === 'metals.dev' || metalProvider === 'metals_dev') ? 'Metals.Dev' : SOURCE_NAME[t],
  );
}
