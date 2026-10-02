/**
 * Precious metals spot → NZD via Metals.Dev (https://metals.dev/).
 *
 * Free plan: sign up at https://metals.dev/ (no credit card), copy API key
 * into METALS_API_KEY in .env. 100 requests/month on free tier.
 *
 * NZD: request `currency=NZD` so metals.dev returns gold/silver/platinum/
 * palladium prices already in NZD per troy ounce (their FX). We never invent
 * rates. Optional fallback: if a USD-only response slips through, convert
 * with Frankfurter (ECB) https://api.frankfurter.dev — also never invented.
 *
 * On API failure (incl. free-tier quota exhausted), reuse last-good live
 * spots from this process memory when available (status `stale`) — never invent.
 *
 * Without METALS_API_KEY: return unavailable/stubbed (cost-only / —).
 */
import type { MetalKind, MetalUnit, QuoteResult } from '../../src/types/index.ts';
import { logger } from '../lib/logger.ts';

/** Grams per troy ounce (exact conventional factor). */
export const TROY_OZ_GRAMS = 31.1034768;

export const METAL_KINDS: MetalKind[] = ['gold', 'silver', 'platinum', 'palladium'];

const METALS_DEV_LATEST = 'https://api.metals.dev/v1/latest';
const FRANKFURTER_USD_NZD = 'https://api.frankfurter.dev/v1/latest?from=USD&to=NZD';

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

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — protect free quota
const QUOTA_BACKOFF_MS = 24 * 60 * 60 * 1000; // 24h before retrying after 1203

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

function stubMissingKey(metal: MetalKind): QuoteResult {
  return {
    assetKey: metalAssetKey(metal),
    currency: 'NZD',
    price: null,
    status: 'unavailable',
    source: 'stub',
    asOf: null,
    message:
      'METALS_API_KEY not set. Free key: https://metals.dev/ → Dashboard → copy key into .env as METALS_API_KEY. Until then, metal value shows cost only / —.',
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
          message: `${reason} · last live Metals.Dev NZD/oz t as of ${g.asOf ?? new Date(lastGood!.fetchedAt).toISOString()}`,
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

/**
 * Fetch all four metals as NZD per troy ounce.
 * Uses cache when fresh. Never invents prices.
 * On quota/API failure, returns last-good as `stale` when available.
 */
export async function fetchMetalSpotNzd(
  force = false,
): Promise<Record<MetalKind, QuoteResult>> {
  const key = getMetalsApiKey();
  if (!key) {
    return Object.fromEntries(METAL_KINDS.map((m) => [m, stubMissingKey(m)])) as Record<
      MetalKind,
      QuoteResult
    >;
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
  // Keep lastGood and quota backoff — clearing them would force burning quota.
}

/** Test/admin: clear last-good + quota backoff (does not invent prices). */
export function resetMetalsRuntimeState(): void {
  cache = null;
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
  }>,
): boolean {
  const results = {} as Record<MetalKind, QuoteResult>;
  for (const metal of METAL_KINDS) {
    const row = rows.find((r) => r.metal === metal);
    if (!row || !Number.isFinite(row.price) || row.price <= 0) return false;
    results[metal] = {
      assetKey: metalAssetKey(metal),
      currency: 'NZD',
      price: row.price,
      status: 'ok',
      source: 'metals_dev',
      asOf: row.asOf,
      message: row.message ?? 'Metals.Dev spot NZD/oz t (toz).',
    };
  }
  lastGood = { fetchedAt: Date.now(), results: cloneResults(results) };
  return true;
}
