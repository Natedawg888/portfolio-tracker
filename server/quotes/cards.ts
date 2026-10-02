/**
 * Collectable card quotes — real public APIs only; never invent prices.
 *
 * MTG: Scryfall https://api.scryfall.com — market USD + card art → NZD via Frankfurter
 * Pokémon: pokemontcg.io https://api.pokemontcg.io/v2 — TCGPlayer market USD + images → NZD
 *
 * No photo/vision pricing. Lookup by name / set / number / api id / CSV only.
 * If an API is down or returns no price, status=unavailable (leave valuation null).
 */
import { fetchFxToNzd } from './fx.ts';

const UA = 'PortfolioTracker/0.1 (local NZD portfolio; +https://localhost)';
const FETCH_MS = 18_000;

/** API-quoted games. Any other slug is a manual (appraisal) collectable type. */
export type ApiCardGame = 'mtg' | 'pokemon';
export type CardGame = ApiCardGame | 'other' | (string & {});
export type CardFinish = 'nonfoil' | 'foil' | 'etched' | 'holofoil' | 'reverseHolofoil' | 'normal';

export type MtgColour = 'W' | 'U' | 'B' | 'R' | 'G';

export type CardQuoteResult = {
  game: CardGame;
  name: string;
  set: string | null;
  number: string | null;
  finish: string | null;
  apiId: string | null;
  imageUrl: string | null;
  /** MTG colour identity letters (WUBRG). Empty array = colourless. Null = unknown / N/A. */
  colours: MtgColour[] | null;
  /** Normalized rarity: common | uncommon | rare | mythic (plus special/bonus when Scryfall returns them). */
  rarity: string | null;
  unitUsd: number | null;
  unitNzd: number | null;
  fxRate: number | null;
  status: 'ok' | 'unavailable';
  source: 'scryfall' | 'pokemontcg.io' | 'unavailable';
  asOf: string | null;
  message: string | null;
  assetKey: string | null;
};

export type CardLookupInput = {
  game: CardGame;
  name?: string | null;
  set?: string | null;
  number?: string | null;
  finish?: string | null;
  apiId?: string | null;
};

function positiveNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function unavailable(
  game: CardGame,
  message: string,
  partial?: Partial<CardQuoteResult>,
): CardQuoteResult {
  return {
    game,
    name: partial?.name ?? '',
    set: partial?.set ?? null,
    number: partial?.number ?? null,
    finish: partial?.finish ?? null,
    apiId: partial?.apiId ?? null,
    imageUrl: partial?.imageUrl ?? null,
    colours: partial?.colours ?? null,
    rarity: partial?.rarity ?? null,
    unitUsd: null,
    unitNzd: null,
    fxRate: null,
    status: 'unavailable',
    source: 'unavailable',
    asOf: new Date().toISOString(),
    message,
    assetKey: null,
  };
}

const WUBRG: MtgColour[] = ['W', 'U', 'B', 'R', 'G'];

/** Scryfall colour_identity (preferred) or colours → WUBRG letters; [] = colourless. */
export function extractScryfallColours(card: Record<string, unknown>): MtgColour[] | null {
  const raw = Array.isArray(card.color_identity)
    ? card.color_identity
    : Array.isArray(card.colors)
      ? card.colors
      : null;
  if (raw == null) return null;
  const set = new Set<MtgColour>();
  for (const c of raw) {
    const letter = String(c).trim().toUpperCase();
    if (letter === 'W' || letter === 'U' || letter === 'B' || letter === 'R' || letter === 'G') {
      set.add(letter);
    }
  }
  return WUBRG.filter((c) => set.has(c));
}

/** Normalize Scryfall / ManaBox rarity labels to common|uncommon|rare|mythic (or special/bonus). */
export function normalizeCardRarity(raw: unknown): string | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  if (!s) return null;
  if (s.includes('mythic')) return 'mythic';
  if (s.includes('uncommon')) return 'uncommon';
  if (s === 'rare' || s.startsWith('rare ') || s.endsWith(' rare') || s === 'r') return 'rare';
  if (s === 'common' || s.startsWith('common ') || s === 'c') return 'common';
  if (s === 'special' || s === 'bonus') return s;
  return s;
}

/** Persistable form: "W,U" or "" (colourless). Null if unknown. */
export function coloursToStorage(colours: MtgColour[] | null | undefined): string | null {
  if (colours == null) return null;
  return colours.join(',');
}

/** Parse stored colours back to letters. "" → []. null/undefined → null. */
export function coloursFromStorage(raw: unknown): MtgColour[] | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return [];
  const set = new Set<MtgColour>();
  for (const part of s.split(/[,\s]+/)) {
    const letter = part.trim().toUpperCase();
    if (letter === 'W' || letter === 'U' || letter === 'B' || letter === 'R' || letter === 'G') {
      set.add(letter);
    }
  }
  return WUBRG.filter((c) => set.has(c));
}

async function usdToNzd(usd: number): Promise<{ nzd: number; rate: number; asOf: string } | null> {
  const fx = await fetchFxToNzd('USD');
  if (fx.status !== 'ok' || fx.rate == null || !(fx.rate > 0)) return null;
  return {
    nzd: usd * fx.rate,
    rate: fx.rate,
    asOf: fx.asOf ?? new Date().toISOString(),
  };
}

function pickScryfallUsd(
  prices: Record<string, string | null> | null | undefined,
  finish: string | null | undefined,
): number | null {
  if (!prices) return null;
  const f = (finish ?? 'nonfoil').toLowerCase();
  if (f === 'foil' || f === 'holofoil') return positiveNum(prices.usd_foil) ?? positiveNum(prices.usd);
  if (f === 'etched') return positiveNum(prices.usd_etched) ?? positiveNum(prices.usd_foil) ?? positiveNum(prices.usd);
  return positiveNum(prices.usd) ?? positiveNum(prices.usd_foil);
}

function pickPokemonUsd(
  tcgplayer: {
    prices?: Record<string, { market?: number | null; mid?: number | null; low?: number | null }>;
  } | null | undefined,
  finish: string | null | undefined,
): { usd: number | null; variant: string | null } {
  const prices = tcgplayer?.prices;
  if (!prices || typeof prices !== 'object') return { usd: null, variant: null };
  const f = (finish ?? '').toLowerCase();
  const prefer: string[] = [];
  if (f.includes('reverse')) prefer.push('reverseHolofoil', 'reverseholofoil');
  else if (f.includes('holo') || f === 'foil') prefer.push('holofoil', 'holo', 'foil');
  else if (f === 'normal' || f === 'nonfoil' || !f) prefer.push('normal', 'holofoil');
  prefer.push(...Object.keys(prices));
  const seen = new Set<string>();
  for (const key of prefer) {
    const k = Object.keys(prices).find((p) => p.toLowerCase() === key.toLowerCase());
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const row = prices[k];
    const usd = positiveNum(row?.market) ?? positiveNum(row?.mid) ?? positiveNum(row?.low);
    if (usd != null) return { usd, variant: k };
  }
  return { usd: null, variant: null };
}

async function fetchJson(url: string): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data, text };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      text: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Scryfall: by id, or set+number, or fuzzy name (+ optional set). */
export async function quoteMtg(input: CardLookupInput): Promise<CardQuoteResult> {
  const finish = input.finish?.trim() || 'nonfoil';
  let url: string | null = null;
  if (input.apiId?.trim()) {
    url = `https://api.scryfall.com/cards/${encodeURIComponent(input.apiId.trim())}`;
  } else if (input.set?.trim() && input.number?.trim()) {
    url = `https://api.scryfall.com/cards/${encodeURIComponent(input.set.trim().toLowerCase())}/${encodeURIComponent(input.number.trim())}`;
  } else if (input.name?.trim()) {
    const q = new URLSearchParams({ fuzzy: input.name.trim() });
    if (input.set?.trim()) q.set('set', input.set.trim().toLowerCase());
    url = `https://api.scryfall.com/cards/named?${q}`;
  } else {
    return unavailable('mtg', 'MTG lookup needs name, set+number, or Scryfall id');
  }

  const res = await fetchJson(url);
  if (!res.ok || !res.data || typeof res.data !== 'object') {
    return unavailable(
      'mtg',
      `Scryfall HTTP ${res.status || 'err'}: ${res.text.replace(/\s+/g, ' ').slice(0, 140)}`,
      { name: input.name ?? '', set: input.set ?? null, number: input.number ?? null, finish },
    );
  }
  const card = res.data as Record<string, unknown>;
  const prices = card.prices as Record<string, string | null> | undefined;
  const unitUsd = pickScryfallUsd(prices, finish);
  const name = String(card.name ?? input.name ?? '');
  const set = card.set != null ? String(card.set) : input.set ?? null;
  const number = card.collector_number != null ? String(card.collector_number) : input.number ?? null;
  const apiId = card.id != null ? String(card.id) : null;
  const colours = extractScryfallColours(card);
  const rarity = normalizeCardRarity(card.rarity);
  const imageUrl =
    (card.image_uris as { normal?: string; small?: string } | undefined)?.normal ??
    (card.image_uris as { normal?: string; small?: string } | undefined)?.small ??
    (
      (card.card_faces as Array<{ image_uris?: { normal?: string; small?: string } }> | undefined)?.[0]
        ?.image_uris?.normal
    ) ??
    null;

  if (unitUsd == null) {
    return {
      game: 'mtg',
      name,
      set,
      number,
      finish,
      apiId,
      imageUrl,
      colours,
      rarity,
      unitUsd: null,
      unitNzd: null,
      fxRate: null,
      status: 'unavailable',
      source: 'scryfall',
      asOf: new Date().toISOString(),
      message: 'Scryfall has no USD price for this printing/finish',
      assetKey: apiId ? `CARD:mtg:${apiId}:${finish}` : null,
    };
  }

  const fx = await usdToNzd(unitUsd);
  if (!fx) {
    return {
      game: 'mtg',
      name,
      set,
      number,
      finish,
      apiId,
      imageUrl,
      colours,
      rarity,
      unitUsd,
      unitNzd: null,
      fxRate: null,
      status: 'unavailable',
      source: 'scryfall',
      asOf: new Date().toISOString(),
      message: `Scryfall USD ${unitUsd} but USD→NZD FX unavailable (never invent)`,
      assetKey: apiId ? `CARD:mtg:${apiId}:${finish}` : null,
    };
  }

  return {
    game: 'mtg',
    name,
    set,
    number,
    finish,
    apiId,
    imageUrl,
    colours,
    rarity,
    unitUsd,
    unitNzd: fx.nzd,
    fxRate: fx.rate,
    status: 'ok',
    source: 'scryfall',
    asOf: fx.asOf,
    message: `Scryfall USD ${unitUsd} × Frankfurter ${fx.rate} → NZD`,
    assetKey: apiId ? `CARD:mtg:${apiId}:${finish}` : `CARD:mtg:${set}:${number}:${finish}`,
  };
}

/** Pokémon TCG API (pokemontcg.io) — free tier; never invent if down. */
export async function quotePokemon(input: CardLookupInput): Promise<CardQuoteResult> {
  const finish = input.finish?.trim() || 'holofoil';
  let url: string | null = null;
  if (input.apiId?.trim()) {
    url = `https://api.pokemontcg.io/v2/cards/${encodeURIComponent(input.apiId.trim())}`;
  } else if (input.set?.trim() && input.number?.trim()) {
    const id = `${input.set.trim().toLowerCase()}-${input.number.trim()}`;
    url = `https://api.pokemontcg.io/v2/cards/${encodeURIComponent(id)}`;
  } else if (input.name?.trim()) {
    const parts = [`name:"${input.name.trim().replace(/"/g, '')}"`];
    if (input.set?.trim()) parts.push(`set.id:${input.set.trim().toLowerCase()}`);
    if (input.number?.trim()) parts.push(`number:${input.number.trim()}`);
    const q = new URLSearchParams({ q: parts.join(' '), pageSize: '1' });
    url = `https://api.pokemontcg.io/v2/cards?${q}`;
  } else {
    return unavailable('pokemon', 'Pokémon lookup needs name, set+number, or card id');
  }

  const res = await fetchJson(url);
  if (!res.ok || !res.data || typeof res.data !== 'object') {
    return unavailable(
      'pokemon',
      `pokemontcg.io HTTP ${res.status || 'err'}: ${res.text.replace(/\s+/g, ' ').slice(0, 140)}`,
      { name: input.name ?? '', set: input.set ?? null, number: input.number ?? null, finish },
    );
  }

  const root = res.data as { data?: unknown };
  let card: Record<string, unknown> | null = null;
  if (Array.isArray(root.data)) {
    card = (root.data[0] as Record<string, unknown>) ?? null;
  } else if (root.data && typeof root.data === 'object') {
    card = root.data as Record<string, unknown>;
  } else if ((res.data as { id?: string }).id) {
    card = res.data as Record<string, unknown>;
  }

  if (!card) {
    return unavailable('pokemon', 'No Pokémon card matched', {
      name: input.name ?? '',
      set: input.set ?? null,
      number: input.number ?? null,
      finish,
    });
  }

  const picked = pickPokemonUsd(
    card.tcgplayer as {
      prices?: Record<string, { market?: number | null; mid?: number | null; low?: number | null }>;
    },
    finish,
  );
  const name = String(card.name ?? input.name ?? '');
  const setObj = card.set as { id?: string } | undefined;
  const set = setObj?.id != null ? String(setObj.id) : input.set ?? null;
  const number = card.number != null ? String(card.number) : input.number ?? null;
  const apiId = card.id != null ? String(card.id) : null;
  const images = card.images as { small?: string; large?: string } | undefined;
  const imageUrl = images?.small ?? images?.large ?? null;
  const usedFinish = picked.variant ?? finish;
  const rarity = normalizeCardRarity(card.rarity);

  if (picked.usd == null) {
    return {
      game: 'pokemon',
      name,
      set,
      number,
      finish: usedFinish,
      apiId,
      imageUrl,
      colours: null,
      rarity,
      unitUsd: null,
      unitNzd: null,
      fxRate: null,
      status: 'unavailable',
      source: 'pokemontcg.io',
      asOf: new Date().toISOString(),
      message: 'pokemontcg.io returned no TCGPlayer market/mid/low price',
      assetKey: apiId ? `CARD:pokemon:${apiId}:${usedFinish}` : null,
    };
  }

  const fx = await usdToNzd(picked.usd);
  if (!fx) {
    return {
      game: 'pokemon',
      name,
      set,
      number,
      finish: usedFinish,
      apiId,
      imageUrl,
      colours: null,
      rarity,
      unitUsd: picked.usd,
      unitNzd: null,
      fxRate: null,
      status: 'unavailable',
      source: 'pokemontcg.io',
      asOf: new Date().toISOString(),
      message: `TCGPlayer USD ${picked.usd} but USD→NZD FX unavailable (never invent)`,
      assetKey: apiId ? `CARD:pokemon:${apiId}:${usedFinish}` : null,
    };
  }

  return {
    game: 'pokemon',
    name,
    set,
    number,
    finish: usedFinish,
    apiId,
    imageUrl,
    colours: null,
    rarity,
    unitUsd: picked.usd,
    unitNzd: fx.nzd,
    fxRate: fx.rate,
    status: 'ok',
    source: 'pokemontcg.io',
    asOf: fx.asOf,
    message: `pokemontcg.io TCGPlayer ${usedFinish} USD ${picked.usd} × Frankfurter ${fx.rate} → NZD`,
    assetKey: apiId ? `CARD:pokemon:${apiId}:${usedFinish}` : `CARD:pokemon:${set}:${number}:${usedFinish}`,
  };
}

export async function quoteCard(input: CardLookupInput): Promise<CardQuoteResult> {
  const game = (input.game ?? '').toLowerCase() as CardGame;
  if (game === 'mtg') return quoteMtg({ ...input, game });
  if (game === 'pokemon') return quotePokemon({ ...input, game });
  return unavailable('mtg', `Unsupported card game "${input.game}" (use mtg or pokemon)`);
}

export function isApiCardGame(game: string | null | undefined): game is ApiCardGame {
  const g = (game ?? '').toLowerCase();
  return g === 'mtg' || g === 'pokemon';
}

export function isManualCollectableGame(game: string | null | undefined): boolean {
  return Boolean(game) && !isApiCardGame(game);
}

/** Normalize card_game / type slug. Preserves custom manual types (e.g. figurines, sealed). */
export function parseCardGame(raw: unknown): string | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (s === 'mtg' || s === 'magic' || s === 'scryfall') return 'mtg';
  if (s === 'pokemon' || s === 'poke' || s === 'ptcg') return 'pokemon';
  if (s === 'other' || s === 'manual' || s === 'item' || s === 'collectable') return 'other';
  const slug = s.replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
  if (slug.length >= 1 && slug.length <= 40) return slug;
  return null;
}

/** Meta from Scryfall (no price) — used to backfill colour identity + rarity. */
export type ScryfallCardMeta = {
  id: string;
  name: string | null;
  colours: MtgColour[] | null;
  rarity: string | null;
  set: string | null;
  number: string | null;
  imageUrl: string | null;
};

const COLLECTION_CHUNK = 75;

/**
 * Bulk-fetch colour identity + rarity via Scryfall /cards/collection (max 75 ids/request).
 * Prefer this over per-card quoteMtg when only meta is needed.
 */
export async function fetchScryfallCollectionMeta(
  scryfallIds: string[],
): Promise<Map<string, ScryfallCardMeta>> {
  const out = new Map<string, ScryfallCardMeta>();
  const ids = [...new Set(scryfallIds.map((id) => id.trim()).filter(Boolean))];
  for (let i = 0; i < ids.length; i += COLLECTION_CHUNK) {
    const chunk = ids.slice(i, i + COLLECTION_CHUNK);
    const res = await fetchJsonPost('https://api.scryfall.com/cards/collection', {
      identifiers: chunk.map((id) => ({ id })),
    });
    if (res.ok && res.data && typeof res.data === 'object') {
      const list = res.data as { data?: unknown[] };
      const cards = Array.isArray(list.data) ? list.data : [];
      for (const raw of cards) {
        if (!raw || typeof raw !== 'object') continue;
        const card = raw as Record<string, unknown>;
        const id = card.id != null ? String(card.id) : '';
        if (!id) continue;
        const imageUrl =
          (card.image_uris as { normal?: string; small?: string } | undefined)?.normal ??
          (card.image_uris as { normal?: string; small?: string } | undefined)?.small ??
          (
            (card.card_faces as Array<{ image_uris?: { normal?: string; small?: string } }> | undefined)?.[0]
              ?.image_uris?.normal
          ) ??
          null;
        out.set(id, {
          id,
          name: card.name != null ? String(card.name) : null,
          colours: extractScryfallColours(card),
          rarity: normalizeCardRarity(card.rarity),
          set: card.set != null ? String(card.set) : null,
          number: card.collector_number != null ? String(card.collector_number) : null,
          imageUrl,
        });
      }
    }
    // Scryfall asks for ~50–100ms between requests
    if (i + COLLECTION_CHUNK < ids.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return out;
}

async function fetchJsonPost(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': UA,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_MS),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data, text };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      text: err instanceof Error ? err.message : String(err),
    };
  }
}
