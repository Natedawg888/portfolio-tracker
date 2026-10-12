/**
 * Value Search query parsing: what kind of thing did the user type, and what did they ask for.
 * Pure (no API calls) so it can run on every keystroke. Run tests: npm run test:value-search
 */
import type { AssetClassPrefKey } from './assetClassPrefs.ts';
import { KNOWN_CRYPTO } from './knownCrypto.ts';
import type { ValueSearchPrefs } from './valueSearchPrefs.ts';

export type SearchType =
  | 'stock'
  | 'crypto'
  | 'mtg'
  | 'pokemon'
  | 'metal'
  | 'currency'
  | 'miner'
  | 'diamond';

export type MetalName = 'gold' | 'silver' | 'platinum' | 'palladium';
export type MetalAmountUnit = 'oz_t' | 'g' | 'kg';

export type ParsedQuery =
  | { type: 'stock'; symbol: string }
  | { type: 'crypto'; symbol: string }
  | { type: 'mtg'; name: string }
  | { type: 'mtg'; apiId: string }
  | { type: 'pokemon'; name: string }
  | { type: 'pokemon'; apiId: string }
  | { type: 'metal'; metal: MetalName; amount: number | null; unit: MetalAmountUnit | null }
  | { type: 'currency'; amount: number | null; from: string; to: string }
  | { type: 'miner'; ths: number; wPerTh: number | null }
  | {
      type: 'diamond';
      carat: number;
      colour: string | null;
      clarity: string | null;
      shape: string | null;
    };

export type DetectContext = {
  enabled: ReadonlySet<SearchType>;
  heldStocks: readonly string[];
  heldCrypto: readonly string[];
};

/** Display order of the type buttons; also the fallback order when auto finds nothing. */
export const SEARCH_TYPES: readonly SearchType[] = [
  'stock',
  'crypto',
  'mtg',
  'pokemon',
  'metal',
  'currency',
  'miner',
  'diamond',
];

/** Settings switch that shows each search type; currency has its own Value Search pref. */
const TYPE_PREF: Record<Exclude<SearchType, 'currency'>, AssetClassPrefKey> = {
  stock: 'stock',
  crypto: 'crypto',
  mtg: 'collectable',
  pokemon: 'collectable',
  metal: 'metal',
  miner: 'gomining',
  diamond: 'stone',
};

/** Types the user's Settings show, in display order. The page and its nav link both use this. */
export function visibleSearchTypes(
  enabled: (key: AssetClassPrefKey) => boolean,
  prefs: Pick<ValueSearchPrefs, 'showCurrencyExchanger'>,
): SearchType[] {
  return SEARCH_TYPES.filter((t) => (t === 'currency' ? prefs.showCurrencyExchanger !== false : enabled(TYPE_PREF[t])));
}

export const SEARCH_TYPE_LABEL: Record<SearchType, string> = {
  stock: 'Stock',
  crypto: 'Crypto',
  mtg: 'MTG card',
  pokemon: 'Pokémon card',
  metal: 'Metal',
  currency: 'Currency',
  miner: 'Miner',
  diamond: 'Diamond',
};

/** Default source per type: named when a lookup fails before any source answered, and in the page's sources line. */
export const SOURCE_NAME: Record<SearchType, string> = {
  stock: 'Yahoo Finance',
  crypto: 'CoinGecko',
  mtg: 'Scryfall',
  pokemon: 'pokemontcg.io',
  metal: 'gold-api.com',
  currency: 'Frankfurter',
  miner: 'GoMining',
  diamond: 'OpenFacet',
};

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const CURRENCY_RE = new RegExp(String.raw`^(?:(\d[\d,]*(?:\.\d+)?)\s*)?([a-z]{3})\s+(?:to|in)\s+([a-z]{3})$`, 'i');
const CURRENCY_LOOSE_RE = new RegExp(String.raw`^(?:(\d[\d,]*(?:\.\d+)?)\s*)?([a-z]{3})$`, 'i');
// Lowercase "th" glued to a number is an ordinal ("100th anniversary"), so it needs a space or "/s".
const HASHRATE_RE = new RegExp(String.raw`(?<![\w/.])${NUM}(?:\s*[Tt][Hh]\/[Ss]|\s*TH|\s+[Tt][Hh])(?![A-Za-z])`);
const W_PER_TH_RE = new RegExp(String.raw`${NUM}\s*w\s*\/\s*th\b`, 'i');
const METAL_RE = /^(gold|silver|platinum|palladium)\b(.*)$/i;
const METAL_AMOUNT_RE = new RegExp(String.raw`${NUM}\s*(oz\s*t|ozt|oz|troy\s*oz|grams?|g|kg)?\b`, 'i');
const CARAT_RE = new RegExp(String.raw`${NUM}\s*(?:ct|cts|carats?)\b`, 'i');
/** Scryfall card id. */
const SCRYFALL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** pokemontcg.io card id: set id (has a digit) + "-" + number, e.g. sv3pt5-25, base1-4, swsh12pt5gg-GG01. */
const POKEMON_ID_RE = /^[a-z][a-z0-9]*\d[a-z0-9]*-[a-z]*\d+[a-z]*$/i;

const DIAMOND_COLOURS = new Set(['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']);
const DIAMOND_CLARITIES = new Set(['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2']);
const DIAMOND_SHAPES = new Set([
  'round',
  'cushion',
  'radiant',
  'emerald',
  'oval',
  'pear',
  'marquise',
  'heart',
]);

const CRYPTO_BY_NAME = new Map(
  Object.entries(KNOWN_CRYPTO).map(([symbol, { name }]) => [name.toLowerCase(), symbol]),
);

function num(s: string | undefined): number | null {
  if (s == null) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function metalUnit(raw: string | undefined): MetalAmountUnit | null {
  if (!raw) return null;
  const u = raw.toLowerCase().replace(/\s+/g, '');
  if (u === 'kg') return 'kg';
  if (u === 'g' || u === 'gram' || u === 'grams') return 'g';
  return 'oz_t';
}

function parseCurrency(q: string, loose: boolean): ParsedQuery | null {
  const m = CURRENCY_RE.exec(q);
  if (m) return { type: 'currency', amount: num(m[1]), from: m[2].toUpperCase(), to: m[3].toUpperCase() };
  if (!loose) return null;
  const l = CURRENCY_LOOSE_RE.exec(q);
  return l ? { type: 'currency', amount: num(l[1]), from: l[2].toUpperCase(), to: 'NZD' } : null;
}

function parseMiner(q: string, loose: boolean): ParsedQuery | null {
  const wPerTh = num(W_PER_TH_RE.exec(q)?.[1]);
  const ths = num(HASHRATE_RE.exec(q)?.[1]) ?? (loose ? num(/^\s*(\d+(?:\.\d+)?)/.exec(q)?.[1]) : null);
  return ths != null && ths > 0 ? { type: 'miner', ths, wPerTh } : null;
}

function parseMetal(q: string): ParsedQuery | null {
  const m = METAL_RE.exec(q);
  if (!m) return null;
  const amount = METAL_AMOUNT_RE.exec(m[2]);
  return {
    type: 'metal',
    metal: m[1].toLowerCase() as MetalName,
    amount: num(amount?.[1]),
    unit: metalUnit(amount?.[2]),
  };
}

function parseDiamond(q: string, loose: boolean): ParsedQuery | null {
  const carat = num(CARAT_RE.exec(q)?.[1]) ?? (loose ? num(/^\s*(\d+(?:\.\d+)?)/.exec(q)?.[1]) : null);
  if (carat == null) return null;
  const tokens = q.split(/[\s,]+/);
  const upper = tokens.map((t) => t.toUpperCase());
  return {
    type: 'diamond',
    carat,
    colour: upper.find((t) => DIAMOND_COLOURS.has(t)) ?? null,
    clarity: upper.find((t) => DIAMOND_CLARITIES.has(t)) ?? null,
    shape: tokens.map((t) => t.toLowerCase()).find((t) => DIAMOND_SHAPES.has(t)) ?? null,
  };
}

function parseCrypto(q: string, ctx: DetectContext, loose: boolean): ParsedQuery | null {
  const upper = q.toUpperCase();
  if (Object.hasOwn(KNOWN_CRYPTO, upper)) return { type: 'crypto', symbol: upper };
  const byName = CRYPTO_BY_NAME.get(q.toLowerCase());
  if (byName) return { type: 'crypto', symbol: byName };
  if (loose || ctx.heldCrypto.some((h) => h.toUpperCase() === upper)) {
    return /^[A-Z0-9.-]{1,15}$/.test(upper) ? { type: 'crypto', symbol: upper } : null;
  }
  return null;
}

function parseStock(q: string, ctx: DetectContext, loose: boolean): ParsedQuery | null {
  const upper = q.toUpperCase();
  const held = ctx.heldStocks.some((h) => h.toUpperCase() === upper);
  if (held || /^(?=.*[A-Z])[A-Z.]{1,6}$/.test(q)) return { type: 'stock', symbol: upper };
  return loose && /^[A-Z0-9.:-]{1,15}$/.test(upper) ? { type: 'stock', symbol: upper } : null;
}

/**
 * One parser per type. `loose` is for an explicitly chosen type button: the user has
 * already said what it is, so e.g. "100" is enough for Miner and "USD" for Currency.
 */
const PARSERS: Record<SearchType, (q: string, ctx: DetectContext, loose: boolean) => ParsedQuery | null> = {
  currency: (q, _ctx, loose) => parseCurrency(q, loose),
  miner: (q, _ctx, loose) => parseMiner(q, loose),
  metal: (q) => parseMetal(q),
  diamond: (q, _ctx, loose) => parseDiamond(q, loose),
  crypto: parseCrypto,
  stock: parseStock,
  mtg: (q) => (SCRYFALL_ID_RE.test(q) ? { type: 'mtg', apiId: q.toLowerCase() } : { type: 'mtg', name: q }),
  pokemon: (q) => (POKEMON_ID_RE.test(q) ? { type: 'pokemon', apiId: q } : { type: 'pokemon', name: q }),
};

/** A pasted card id wins over every other rule, but only for its own game. */
function detectCardId(q: string, ctx: DetectContext): ParsedQuery | null {
  if (ctx.enabled.has('mtg') && SCRYFALL_ID_RE.test(q)) return { type: 'mtg', apiId: q.toLowerCase() };
  if (ctx.enabled.has('pokemon') && POKEMON_ID_RE.test(q)) return { type: 'pokemon', apiId: q };
  return null;
}

const AUTO_ORDER: readonly SearchType[] = [
  'currency',
  'miner',
  'metal',
  'diamond',
  'crypto',
  'stock',
  'mtg',
];

export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

/** Parse the query as one specific type (a type button other than Auto). */
export function parseAs(type: SearchType, query: string, ctx: DetectContext): ParsedQuery | null {
  const q = normalizeQuery(query);
  return q ? PARSERS[type](q, ctx, true) : null;
}

/** Auto mode: first enabled rule that matches; null for an empty query or nothing enabled. */
export function detectQuery(query: string, ctx: DetectContext): ParsedQuery | null {
  const q = normalizeQuery(query);
  if (!q) return null;
  const cardId = detectCardId(q, ctx);
  if (cardId) return cardId;
  for (const type of AUTO_ORDER) {
    if (!ctx.enabled.has(type)) continue;
    const parsed = PARSERS[type](q, ctx, false);
    if (parsed) return parsed;
  }
  for (const type of SEARCH_TYPES) {
    if (!ctx.enabled.has(type)) continue;
    const parsed = PARSERS[type](q, ctx, true);
    if (parsed) return parsed;
  }
  return null;
}

/** The query text for a currency lookup; the picker and swap button rewrite the query with it. */
export function formatCurrencyQuery(q: { amount: number | null; from: string; to: string }): string {
  return `${q.amount != null ? `${q.amount} ` : ''}${q.from} to ${q.to}`;
}
