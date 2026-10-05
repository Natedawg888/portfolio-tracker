/**
 * Precious metals spot → NZD.
 *
 * Default (no key): gold-api.com `GET /price/{XAU|XAG|XPT|XPD}/NZD`.
 * That response is already NZD per troy ounce. No API key. We do not
 * multiply by `exchangeRate` (that would double-convert) and we do not
 * accept a non-NZD payload.
 *
 * Optional: Metals.Dev when METALS_API_KEY is set. Request `currency=NZD`.
 * If that API returns USD anyway, convert with Frankfurter (ECB). Never
 * invent rates. On quota/API failure, reuse last-good spots (status `stale`).
 */
import type { MetalKind, MetalUnit, QuoteResult } from '../../src/types/index.ts';
import { logger } from '../lib/logger.ts';

/** Grams per troy ounce (exact conventional factor). */
export const TROY_OZ_GRAMS = 31.1034768;

export const METAL_KINDS: MetalKind[] = ['gold', 'silver', 'platinum', 'palladium'];

const METALS_DEV_LATEST = 'https://api.metals.dev/v1/latest';
const FRANKFURTER_USD_NZD = 'https://api.frankfurter.dev/v1/latest?from=USD&to=NZD';
const GOLD_API_PRICE = 'https://api.gold-api.com/price';

/** gold-api.com spot symbols. Prices are requested in NZD per troy ounce. */
export const GOLD_API_SYMBOL: Record<MetalKind, string> = {
  gold: 'XAU',
  silver: 'XAG',
  platinum: 'XPT',
  palladium: 'XPD',
};

/** In-memory cache to stay within free quota (100 req/mo). */
let cache: {
  fetchedAt: number;
  results: Record<MetalKind, QuoteResult>;
  usdNzd: number | null;
  currency: 'NZD' | 'USD';
} | null = null;

/** Last successful live NZD/oz_t results (never invented). Survives TTL expiry. */
let lastGood: {
  fetchedAt: number;
  results: Record<MetalKind, QuoteResult>;
} | null = null;

/** Skip live Metals.Dev calls until this time when free-tier quota is exhausted. */
let quotaBlockedUntil = 0;
let lastQuotaMessage: string | null = null;

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — protect Metals.Dev free quota
const PUBLIC_CACHE_TTL_MS = 15 * 60 * 1000; // gold-api.com has no key quota
const QUOTA_BACKOFF_MS = 24 * 60 * 60 * 1000; // 24h before retrying after 1203

/** Successful gold-api.com set. Failures are not cached so the next read can retry. */
let publicCache: {
  fetchedAt: number;
  results: Record<MetalKind, QuoteResult>;
} | null = null;

export function metalAssetKey(metal: MetalKind, unit: MetalUnit = 'oz_t'): string {
  return `METAL:${metal}:${unit}`;
}

export function parseMetalAssetKey(
  assetKey: string,
): { metal: MetalKind; unit: MetalUnit } | null {
  const m = /^METAL:(gold|silver|platinum|palladium):(g|oz_t)$/i.exec(assetKey);
  if (!m) return null;
  return {
    metal: m[1].toLowerCase() as MetalKind,
    unit: m[2] as MetalUnit,
  };
}

/** Convert holding amount to troy ounces. */
export function toTroyOz(amount: number, unit: MetalUnit): number {
  if (!Number.isFinite(amount)) return NaN;
  return unit === 'oz_t' ? amount : amount / TROY_OZ_GRAMS;
}

/** NZD per gram from NZD per troy ounce (exact factor). */
export function nzdPerOzToPerGram(nzdPerOzT: number): number {
  return nzdPerOzT / TROY_OZ_GRAMS;
}

/** NZD market value = amount × NZD/oz_t (null if no price). */
export function metalMarketValueNzd(
  amount: number,
  unit: MetalUnit,
  pricePerOzTNzd: number | null | undefined,
): number | null {
  if (pricePerOzTNzd == null || !Number.isFinite(pricePerOzTNzd)) return null;
  const oz = toTroyOz(amount, unit);
  if (!Number.isFinite(oz)) return null;
  return oz * pricePerOzTNzd;
}

export function getMetalsApiKey(): string | null {
  const k = process.env.METALS_API_KEY?.trim();
  return k || null;
}

export function metalsConfigured(): boolean {
  return Boolean(getMetalsApiKey());
}

export function metalsQuotaBlocked(): boolean {
  return Date.now() < quotaBlockedUntil;
}

export function metalsQuotaMessage(): string | null {
  return metalsQuotaBlocked() ? lastQuotaMessage : null;
}

function unavailablePublic(metal: MetalKind, message: string): QuoteResult {
  return {
    assetKey: metalAssetKey(metal),
    currency: 'NZD',
    price: null,
    status: 'unavailable',
    source: 'gold-api',
    asOf: null,
    message,
  };
}

export type GoldApiParse =
  | { ok: true; price: number; asOf: string | null }
  | { ok: false; message: string };

/**
 * Accept a gold-api.com `/price/{symbol}/NZD` body only when it is that metal,
 * currency NZD, and a finite positive price. Does not apply `exchangeRate`.
 */
export function parseGoldApiNzd(metal: MetalKind, body: unknown): GoldApiParse {
  if (!body || typeof body !== 'object') {
    return { ok: false, message: 'gold-api.com returned a non-object' };
  }
  const row = body as {
    symbol?: unknown;
    currency?: unknown;
    price?: unknown;
    updatedAt?: unknown;
  };
  const symbol = GOLD_API_SYMBOL[metal];
  if (String(row.symbol ?? '').toUpperCase() !== symbol) {
    return { ok: false, message: `gold-api.com symbol was not ${symbol}` };
  }
  if (String(row.currency ?? '').toUpperCase() !== 'NZD') {
    return { ok: false, message: 'gold-api.com did not return NZD' };
  }
  const price = typeof row.price === 'number' ? row.price : Number(row.price);
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, message: `gold-api.com had no usable ${metal} NZD price` };
  }
  const asOfRaw = typeof row.updatedAt === 'string' ? row.updatedAt : '';
  const asOfMs = Date.parse(asOfRaw);
  return {
    ok: true,
    price,
    asOf: Number.isFinite(asOfMs) ? new Date(asOfMs).toISOString() : null,
  };
}

function isQuotaExhausted(msg: string, errorCode?: number): boolean {
  if (errorCode === 1203) return true;
  const m = msg.toLowerCase();
  return m.includes('quota') && (m.includes('exhaust') || m.includes('exceed'));
}

function cloneResults(
  results: Record<MetalKind, QuoteResult>,
): Record<MetalKind, QuoteResult> {
  return Object.fromEntries(
    METAL_KINDS.map((m) => [m, { ...results[m] }]),
  ) as Record<MetalKind, QuoteResult>;
}

function staleFromLastGood(reason: string): Record<MetalKind, QuoteResult> | null {
  if (!lastGood) return null;
  const allOk = METAL_KINDS.every(
    (m) =>
      lastGood!.results[m]?.status === 'ok' &&
      lastGood!.results[m]?.price != null &&
      Number.isFinite(lastGood!.results[m].price as number),
  );
  if (!allOk) return null;
  logger.warn('metals_stale_fallback', {
    reason,
    asOf: lastGood.results.gold?.asOf ?? null,
    fetchedAt: new Date(lastGood.fetchedAt).toISOString(),
  });
  return Object.fromEntries(
    METAL_KINDS.map((metal) => {
      const g = lastGood!.results[metal];
      return [
        metal,
        {
          ...g,
          status: 'stale' as const,
          message: `${reason} · last live ${g.source === 'gold-api' ? 'gold-api.com' : 'Metals.Dev'} NZD/oz t as of ${g.asOf ?? new Date(lastGood!.fetchedAt).toISOString()}`,
        } satisfies QuoteResult,
      ];
    }),
  ) as Record<MetalKind, QuoteResult>;
}

async function fetchUsdToNzd(): Promise<number | null> {
  try {
    const res = await fetch(FRANKFURTER_USD_NZD, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { rates?: { NZD?: number } };
    const nzd = data.rates?.NZD;
    return typeof nzd === 'number' && Number.isFinite(nzd) && nzd > 0 ? nzd : null;
  } catch {
    return null;
  }
}

type MetalsDevLatest = {
  status?: string;
  currency?: string;
  unit?: string;
  metals?: Record<string, number>;
  timestamps?: { metal?: string; currency?: string };
  timestamp?: string;
  error_code?: number;
  error_message?: string;
};

async function fetchMetalsDevLatest(apiKey: string): Promise<MetalsDevLatest> {
  const url = new URL(METALS_DEV_LATEST);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('currency', 'NZD');
  url.searchParams.set('unit', 'toz');
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json()) as MetalsDevLatest;
  if (!res.ok || data.status === 'failure') {
    const msg = data.error_message ?? `HTTP ${res.status}`;
    const err = new Error(msg) as Error & { errorCode?: number };
    err.errorCode = data.error_code;
    throw err;
  }
  return data;
}

function asOfFrom(data: MetalsDevLatest): string {
  return (
    data.timestamps?.metal ??
    data.timestamp ??
    new Date().toISOString()
  );
}

async function fetchGoldApiMetal(metal: MetalKind): Promise<QuoteResult> {
  const symbol = GOLD_API_SYMBOL[metal];
  const url = `${GOLD_API_PRICE}/${symbol}/NZD`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (compatible; PortfolioTracker/1.0; +http://127.0.0.1; local NZD portfolio)',
      },
      signal: AbortSignal.timeout(12_000),
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      return unavailablePublic(metal, `gold-api.com HTTP ${res.status}`);
    }
    const parsed = parseGoldApiNzd(metal, data);
    if (!parsed.ok) return unavailablePublic(metal, parsed.message);
    return {
      assetKey: metalAssetKey(metal),
      currency: 'NZD',
      price: parsed.price,
      status: 'ok',
      source: 'gold-api',
      asOf: parsed.asOf,
      message: `gold-api.com spot NZD/oz t (${symbol}).`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return unavailablePublic(metal, `gold-api.com error: ${msg}`);
  }
}

/**
 * Live NZD/oz t from gold-api.com. No API key. Never invents a price.
 * A full successful set is cached for 15 minutes. Total failure reuses
 * last-good as `stale` when that set exists.
 */
export async function fetchPublicMetalSpotNzd(
  force = false,
): Promise<Record<MetalKind, QuoteResult>> {
  if (!force && publicCache && Date.now() - publicCache.fetchedAt < PUBLIC_CACHE_TTL_MS) {
    return cloneResults(publicCache.results);
  }

  const rows = await Promise.all(METAL_KINDS.map((metal) => fetchGoldApiMetal(metal)));
  const results = Object.fromEntries(METAL_KINDS.map((metal, i) => [metal, rows[i]!])) as Record<
    MetalKind,
    QuoteResult
  >;
  const okCount = METAL_KINDS.filter(
    (m) => results[m].status === 'ok' && results[m].price != null,
  ).length;

  if (okCount === METAL_KINDS.length) {
    lastGood = { fetchedAt: Date.now(), results: cloneResults(results) };
    publicCache = { fetchedAt: Date.now(), results: cloneResults(results) };
    return cloneResults(results);
  }

  if (okCount === 0) {
    const stale = staleFromLastGood(
      results.gold?.message ?? 'gold-api.com NZD spots unavailable',
    );
    if (stale) return stale;
  }
  return results;
}

/**
 * Fetch all four metals as NZD per troy ounce.
 * Uses cache when fresh. Never invents prices.
 * Without METALS_API_KEY, uses gold-api.com NZD spots.
 * On Metals.Dev quota/API failure, returns last-good as `stale` when available.
 */
export async function fetchMetalSpotNzd(
  force = false,
): Promise<Record<MetalKind, QuoteResult>> {
  const key = getMetalsApiKey();
  if (!key) {
    return fetchPublicMetalSpotNzd(force);
  }

  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cloneResults(cache.results);
  }

  const now = Date.now();
  if (now < quotaBlockedUntil) {
    const reason =
      lastQuotaMessage ??
      'Metals.Dev free-tier quota exhausted — not calling API until backoff ends';
    const stale = staleFromLastGood(reason);
    if (stale) return stale;
    return Object.fromEntries(
      METAL_KINDS.map((metal) => [
        metal,
        {
          assetKey: metalAssetKey(metal),
          currency: 'NZD' as const,
          price: null,
          status: 'unavailable' as const,
          source: 'metals_dev' as const,
          asOf: null,
          message: reason,
        } satisfies QuoteResult,
      ]),
    ) as Record<MetalKind, QuoteResult>;
  }

  try {
    const data = await fetchMetalsDevLatest(key);
    const currencyRaw = (data.currency ?? 'NZD').toUpperCase();
    let usdNzd: number | null = null;
    let priceCurrency: 'NZD' | 'USD' = currencyRaw === 'USD' ? 'USD' : 'NZD';

    // Prefer native NZD from metals.dev. If API ignored currency=NZD, convert via Frankfurter.
    if (priceCurrency === 'USD') {
      usdNzd = await fetchUsdToNzd();
      if (usdNzd == null) {
        const fail = METAL_KINDS.map((metal) => [
          metal,
          {
            assetKey: metalAssetKey(metal),
            currency: 'NZD' as const,
            price: null,
            status: 'unavailable' as const,
            source: 'metals_dev' as const,
            asOf: asOfFrom(data),
            message:
              'Metals.Dev returned USD and Frankfurter USD→NZD failed. Not inventing FX.',
          } satisfies QuoteResult,
        ]);
        const failed = Object.fromEntries(fail) as Record<MetalKind, QuoteResult>;
        const stale = staleFromLastGood(
          'Metals.Dev USD response; Frankfurter FX failed',
        );
        return stale ?? failed;
      }
    }

    const asOf = asOfFrom(data);
    const metals = data.metals ?? {};
    const results = {} as Record<MetalKind, QuoteResult>;

    for (const metal of METAL_KINDS) {
      const raw = metals[metal];
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
        results[metal] = {
          assetKey: metalAssetKey(metal),
          currency: 'NZD',
          price: null,
          status: 'unavailable',
          source: 'metals_dev',
          asOf,
          message: `Metals.Dev had no usable ${metal} price.`,
        };
        continue;
      }
      const nzdPerOz =
        priceCurrency === 'NZD' ? raw : raw * (usdNzd as number);
      const fxNote =
        priceCurrency === 'USD' && usdNzd != null
          ? ` USD→NZD ${usdNzd} via Frankfurter (ECB).`
          : '';
      results[metal] = {
        assetKey: metalAssetKey(metal),
        currency: 'NZD',
        price: nzdPerOz,
        status: 'ok',
        source: 'metals_dev',
        asOf,
        message: `Metals.Dev spot NZD/oz t (${data.unit ?? 'toz'}).${fxNote}`.trim(),
      };
    }

    const okCount = METAL_KINDS.filter(
      (m) => results[m].status === 'ok' && results[m].price != null,
    ).length;
    if (okCount === METAL_KINDS.length) {
      lastGood = { fetchedAt: Date.now(), results: cloneResults(results) };
      quotaBlockedUntil = 0;
      lastQuotaMessage = null;
    }

    cache = {
      fetchedAt: Date.now(),
      results: cloneResults(results),
      usdNzd,
      currency: priceCurrency === 'NZD' ? 'NZD' : 'USD',
    };
    return cloneResults(results);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errorCode =
      err && typeof err === 'object' && 'errorCode' in err
        ? Number((err as { errorCode?: number }).errorCode)
        : undefined;

    if (isQuotaExhausted(msg, errorCode)) {
      quotaBlockedUntil = Date.now() + QUOTA_BACKOFF_MS;
      lastQuotaMessage = `Metals.Dev free-tier quota exhausted (error ${errorCode ?? 1203}). Upgrade at https://metals.dev/ or wait for monthly reset. Not inventing prices.`;
      const stale = staleFromLastGood(lastQuotaMessage);
      if (stale) {
        cache = {
          fetchedAt: Date.now(),
          results: cloneResults(stale),
          usdNzd: null,
          currency: 'NZD',
        };
        return stale;
      }
      return Object.fromEntries(
        METAL_KINDS.map((metal) => [
          metal,
          {
            assetKey: metalAssetKey(metal),
            currency: 'NZD' as const,
            price: null,
            status: 'unavailable' as const,
            source: 'metals_dev' as const,
            asOf: null,
            message: lastQuotaMessage,
          } satisfies QuoteResult,
        ]),
      ) as Record<MetalKind, QuoteResult>;
    }

    const stale = staleFromLastGood(`Metals.Dev error: ${msg}`);
    if (stale) return stale;

    return Object.fromEntries(
      METAL_KINDS.map((metal) => [
        metal,
        {
          assetKey: metalAssetKey(metal),
          currency: 'NZD' as const,
          price: null,
          status: 'unavailable' as const,
          source: 'metals_dev' as const,
          asOf: null,
          message: `Metals.Dev error: ${msg}`,
        } satisfies QuoteResult,
      ]),
    ) as Record<MetalKind, QuoteResult>;
  }
}

export async function getMetalQuote(
  metal: MetalKind,
  force = false,
): Promise<QuoteResult> {
  const all = await fetchMetalSpotNzd(force);
  return all[metal];
}

export function clearMetalsCache(): void {
  cache = null;
  publicCache = null;
  // Keep lastGood and quota backoff — clearing them would force burning quota.
}

/** Test/admin: clear last-good + quota backoff (does not invent prices). */
export function resetMetalsRuntimeState(): void {
  cache = null;
  publicCache = null;
  lastGood = null;
  quotaBlockedUntil = 0;
  lastQuotaMessage = null;
}

/**
 * Seed in-memory last-good from authentic previously persisted Metals.Dev rows.
 * Only accepts finite positive prices — never invents.
 */
export function seedMetalsLastGoodFromPersisted(
  rows: Array<{
    metal: MetalKind;
    price: number;
    asOf: string | null;
    message?: string | null;
    source?: QuoteResult['source'] | null;
  }>,
): boolean {
  const results = {} as Record<MetalKind, QuoteResult>;
  for (const metal of METAL_KINDS) {
    const row = rows.find((r) => r.metal === metal);
    if (!row || !Number.isFinite(row.price) || row.price <= 0) return false;
    const source = row.source === 'gold-api' ? 'gold-api' : 'metals_dev';
    results[metal] = {
      assetKey: metalAssetKey(metal),
      currency: 'NZD',
      price: row.price,
      status: 'ok',
      source,
      asOf: row.asOf,
      message:
        row.message ??
        (source === 'gold-api'
          ? `gold-api.com spot NZD/oz t (${GOLD_API_SYMBOL[metal]}).`
          : 'Metals.Dev spot NZD/oz t (toz).'),
    };
  }
  lastGood = { fetchedAt: Date.now(), results: cloneResults(results) };
  return true;
}
