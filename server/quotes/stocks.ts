/**
 * Equity live quotes — Yahoo Finance chart meta × Frankfurter / BTC FX → NZD.
 * Same Yahoo pipeline as stock history charts (server/quotes/history.ts).
 * Icons still use public FMP CDN (UI only) — never invent prices.
 */
import type { QuoteResult, QuoteSource } from '../../src/types/index.ts';
import { logger } from '../lib/logger.ts';
import { resolveStockIconUrl } from '../../src/lib/holdingIcons.ts';
import { yahooEquitySymbol } from './history.ts';
import { convertToNzd } from './fx.ts';

export type StockResolveResult = {
  ticker: string;
  assetClass: 'stock';
  name: string;
  symbol: string;
  yahooSymbol: string;
  exchange: string | null;
  iconUrl: string | null;
  quote: QuoteResult;
  /** Yahoo's own price/currency and the FX rate applied; null when no price was converted. */
  native: NativePrice | null;
};

/** The pre-conversion price behind an NZD quote (fxRate 1 when Yahoo already quotes NZD). */
export type NativePrice = { price: number; currency: string; fxRate: number };

const UA =
  'Mozilla/5.0 (compatible; PortfolioTracker/1.0; +http://127.0.0.1; local NZD portfolio)';
const FETCH_MS = 15_000;
/** Fresh TTL for successful live quotes (free public Yahoo; avoid hammering). */
const PRICE_TTL_MS = 60_000;
/** Reuse last-good NZD briefly when Yahoo/FX fails (honest stale). */
const STALE_OK_MAX_MS = 6 * 60 * 60 * 1000;

type YahooLiveOk = {
  ok: true;
  yahooSymbol: string;
  currency: string;
  price: number;
  asOf: string;
  name: string;
  exchangeName: string | null;
};

type YahooLiveFail = { ok: false; detail: string; yahooSymbol: string };

type CacheEntry = {
  at: number;
  quote: QuoteResult;
  name: string;
  yahooSymbol: string;
  exchangeName: string | null;
  native: NativePrice | null;
};

const cache = new Map<string, CacheEntry>();
const lastGood = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

function positiveNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function stockAssetKey(ticker: string): string {
  return `STOCK:${ticker.trim().toUpperCase()}`;
}

export function parseStockAssetKey(
  assetKey: string,
): { ticker: string } | null {
  const m = /^STOCK:(.+)$/i.exec(assetKey.trim());
  if (!m?.[1]) return null;
  const ticker = m[1].trim().toUpperCase();
  return ticker ? { ticker } : null;
}

async function fetchYahooLive(
  yahooSymbol: string,
): Promise<YahooLiveOk | YahooLiveFail> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}` +
    `?range=1d&interval=1d&includePrePost=false`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        yahooSymbol,
        detail: `Yahoo HTTP ${res.status}: ${text.replace(/\s+/g, ' ').slice(0, 120)}`,
      };
    }
    const data = JSON.parse(text) as {
      chart?: {
        result?: Array<{
          meta?: {
            currency?: string;
            symbol?: string;
            regularMarketPrice?: number;
            regularMarketTime?: number;
            previousClose?: number;
            chartPreviousClose?: number;
            shortName?: string;
            longName?: string;
            exchangeName?: string;
            fullExchangeName?: string;
          };
        }>;
        error?: { description?: string };
      };
    };
    const meta = data.chart?.result?.[0]?.meta;
    if (!meta) {
      return {
        ok: false,
        yahooSymbol,
        detail:
          data.chart?.error?.description ?? `Yahoo: no quote for ${yahooSymbol}`,
      };
    }
    const price =
      positiveNum(meta.regularMarketPrice) ??
      positiveNum(meta.previousClose) ??
      positiveNum(meta.chartPreviousClose);
    if (price == null) {
      return {
        ok: false,
        yahooSymbol,
        detail: `Yahoo ${yahooSymbol}: no market price`,
      };
    }
    const asOf =
      meta.regularMarketTime != null && Number.isFinite(meta.regularMarketTime)
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : new Date().toISOString();
    const name =
      (meta.longName ?? meta.shortName ?? yahooSymbol).trim() || yahooSymbol;
    return {
      ok: true,
      yahooSymbol: (meta.symbol ?? yahooSymbol).toUpperCase(),
      currency: (meta.currency ?? 'USD').toUpperCase(),
      price,
      asOf,
      name,
      exchangeName: meta.fullExchangeName ?? meta.exchangeName ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      yahooSymbol,
      detail: `Yahoo fetch failed: ${(err as Error).message}`,
    };
  }
}

async function yahooLiveWithNzFallback(
  ticker: string,
  exchange?: string | null,
): Promise<YahooLiveOk | YahooLiveFail> {
  const primary = yahooEquitySymbol(ticker, exchange);
  const first = await fetchYahooLive(primary);
  if (first.ok) return first;
  // Bare NZ tickers often need .NZ when exchange unknown (same as history).
  if (!primary.includes('.') && !(exchange ?? '').trim()) {
    const nz = await fetchYahooLive(`${primary}.NZ`);
    if (nz.ok) return nz;
  }
  return first;
}

function quoteSourceForFx(
  nativeCurrency: string,
  fxSource: string,
): QuoteSource {
  if (nativeCurrency === 'NZD') return 'yahoo';
  if (fxSource === 'frankfurter' || fxSource === 'btc_fx_ratio' || fxSource === 'identity') {
    return 'yahoo+frankfurter';
  }
  return 'yahoo+frankfurter';
}

async function buildNzdQuote(
  assetKey: string,
  live: YahooLiveOk,
): Promise<Omit<CacheEntry, 'at'>> {
  if (live.currency === 'NZD') {
    return {
      native: { price: live.price, currency: 'NZD', fxRate: 1 },
      name: live.name,
      yahooSymbol: live.yahooSymbol,
      exchangeName: live.exchangeName,
      quote: {
        assetKey,
        currency: 'NZD',
        price: live.price,
        status: 'ok',
        source: 'yahoo',
        asOf: live.asOf,
        message: `Yahoo Finance ${live.yahooSymbol} ${live.price} NZD/share`,
      },
    };
  }

  const converted = await convertToNzd(live.price, live.currency, false);
  if (!converted) {
    return {
      native: null,
      name: live.name,
      yahooSymbol: live.yahooSymbol,
      exchangeName: live.exchangeName,
      quote: {
        assetKey,
        currency: 'NZD',
        price: null,
        status: 'unavailable',
        source: 'yahoo+frankfurter',
        asOf: live.asOf,
        message: `Yahoo ${live.yahooSymbol} ${live.price} ${live.currency}/share — FX to NZD unavailable (never invent).`,
      },
    };
  }

  const source = quoteSourceForFx(live.currency, converted.source);
  return {
    native: { price: live.price, currency: live.currency, fxRate: converted.rate },
    name: live.name,
    yahooSymbol: live.yahooSymbol,
    exchangeName: live.exchangeName,
    quote: {
      assetKey,
      currency: 'NZD',
      price: converted.nzd,
      status: 'ok',
      source,
      asOf: live.asOf,
      message: `Yahoo Finance ${live.yahooSymbol} ${live.price} ${live.currency} × ${converted.message} → ${converted.nzd.toFixed(4)} NZD/share`,
    },
  };
}

function cacheKey(ticker: string, exchange?: string | null): string {
  return `${ticker.trim().toUpperCase()}|${(exchange ?? '').trim().toUpperCase()}`;
}

async function fetchStockQuoteInner(
  ticker: string,
  exchange: string | null | undefined,
  force: boolean,
): Promise<CacheEntry> {
  const t = ticker.trim().toUpperCase();
  const assetKey = stockAssetKey(t);
  const key = cacheKey(t, exchange);

  if (!force) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit;
  }

  if (!t) {
    const entry: CacheEntry = {
      at: Date.now(),
      name: '',
      yahooSymbol: '',
      exchangeName: null,
      native: null,
      quote: {
        assetKey,
        currency: 'NZD',
        price: null,
        status: 'unavailable',
        source: 'stub',
        asOf: null,
        message: 'Ticker required',
      },
    };
    return entry;
  }

  const live = await yahooLiveWithNzFallback(t, exchange);
  if (!live.ok) {
    const stale = lastGood.get(key);
    if (stale && Date.now() - stale.at < STALE_OK_MAX_MS && stale.quote.price != null) {
      logger.warn('stocks_stale_fallback', { key, asOf: new Date(stale.at).toISOString() });
      const entry: CacheEntry = {
        at: Date.now(),
        name: stale.name,
        yahooSymbol: stale.yahooSymbol,
        exchangeName: stale.exchangeName,
        native: stale.native,
        quote: {
          ...stale.quote,
          status: 'stale',
          message: `${stale.quote.message ?? 'Last good Yahoo NZD'} · live fetch failed: ${live.detail}`,
        },
      };
      cache.set(key, entry);
      return entry;
    }
    const entry: CacheEntry = {
      at: Date.now(),
      name: t,
      yahooSymbol: live.yahooSymbol,
      exchangeName: null,
      native: null,
      quote: {
        assetKey,
        currency: 'NZD',
        price: null,
        status: 'unavailable',
        source: 'yahoo',
        asOf: null,
        message: `${live.detail} — equity quote unavailable (never invent).`,
      },
    };
    cache.set(key, entry);
    return entry;
  }

  const entry: CacheEntry = { at: Date.now(), ...(await buildNzdQuote(assetKey, live)) };
  cache.set(key, entry);
  if (entry.quote.status === 'ok' && entry.quote.price != null) lastGood.set(key, entry);
  return entry;
}

/**
 * Live NZD unit price per share for a ticker (Yahoo × FX).
 * Never invents — unavailable/stale when Yahoo or FX fails.
 */
export async function getStockQuoteNzd(
  ticker: string,
  opts?: { exchange?: string | null; force?: boolean },
): Promise<QuoteResult> {
  const force = opts?.force === true;
  const exchange = opts?.exchange ?? null;
  const t = ticker.trim().toUpperCase();
  const key = cacheKey(t, exchange);
  const existing = inflight.get(key);
  if (existing && !force) {
    return (await existing).quote;
  }
  const promise = fetchStockQuoteInner(t, exchange, force).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return (await promise).quote;
}

/** Resolve ticker name + NZD quote for Value Search / manual add. */
export async function resolveStockTicker(
  ticker: string,
  opts?: { exchange?: string | null; force?: boolean },
): Promise<StockResolveResult> {
  const t = ticker.trim().toUpperCase();
  const force = opts?.force === true;
  const exchange = opts?.exchange ?? null;
  const key = cacheKey(t, exchange);
  const existing = inflight.get(key);
  const entry = existing && !force
    ? await existing
    : await (async () => {
        const promise = fetchStockQuoteInner(t, exchange, force).finally(() => {
          inflight.delete(key);
        });
        inflight.set(key, promise);
        return promise;
      })();

  return {
    ticker: t,
    assetClass: 'stock',
    name: entry.name || t,
    symbol: t,
    yahooSymbol: entry.yahooSymbol || yahooEquitySymbol(t, exchange),
    exchange: exchange,
    iconUrl: resolveStockIconUrl(t),
    quote: entry.quote,
    native: entry.native,
  };
}

/** Test helper. */
export function clearStockQuoteCache(): void {
  cache.clear();
  lastGood.clear();
  inflight.clear();
}
