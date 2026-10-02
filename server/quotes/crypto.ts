/**
 * Crypto ticker → CoinGecko id / name / NZD unit price.
 * Order: cache → CoinGecko → on fail/429 → Coinbase USD spot → Kraken → FX USD→NZD
 * (Frankfurter / existing BTC FX path). Never invents prices — unavailable on failure.
 *
 * Free-tier friendly: in-memory + price_quotes TTL cache, 429 backoff, last-good NZD
 * reuse after live venues fail, and coalesced in-flight resolve/price calls.
 * CRO/Cronos → crypto-com-chain (CoinGecko) and CRO-USD (spot fallbacks).
 * Icons: CoinGecko thumb/well-known → cryptocurrency-icons CDN (UI letter avatar last).
 *
 * Docs: https://docs.coingecko.com/reference/simple-price
 *       https://docs.coingecko.com/reference/search-data
 *       server/quotes/cryptoSpotFallbacks.ts
 */
import type { QuoteResult, QuoteSource } from '../../src/types/index.ts';
import { resolveCryptoIconUrl } from '../../src/lib/holdingIcons.ts';
import { getDb, queryOne, run, newId, persist } from '../db/index.ts';
import { fetchSpotUsdThenNzd } from './cryptoSpotFallbacks.ts';
import { fetchFxToNzd } from './fx.ts';
import { logger } from '../lib/logger.ts';

export type CryptoResolveResult = {
  ticker: string;
  assetClass: 'crypto';
  name: string;
  coingeckoId: string | null;
  iconUrl: string | null;
  quote: QuoteResult;
};

const UA = 'PortfolioTracker/1.0 (local NZD portfolio; +https://localhost)';
const FETCH_MS = 12_000;
/** Fresh TTL for successful simple/price (free tier: avoid hammering). */
const PRICE_TTL_MS = 10 * 60 * 1000; // 10 min
/** How long we may reuse a last-good NZD quote when rate-limited / fetch fails. */
const STALE_OK_MAX_MS = 24 * 60 * 60 * 1000; // 24 h
/** Resolved id cache (search is expensive + rate-limited). */
const ID_TTL_MS = 24 * 60 * 60 * 1000;
/** Global backoff after HTTP 429. */
const RATE_LIMIT_BACKOFF_MS = 60_000;

/** Well-known symbol → CoinGecko id (avoids search latency / rate limits). */
const WELL_KNOWN: Record<string, { id: string; name: string }> = {
  BTC: { id: 'bitcoin', name: 'Bitcoin' },
  ETH: { id: 'ethereum', name: 'Ethereum' },
  XRP: { id: 'ripple', name: 'XRP' },
  SOL: { id: 'solana', name: 'Solana' },
  ADA: { id: 'cardano', name: 'Cardano' },
  DOGE: { id: 'dogecoin', name: 'Dogecoin' },
  DOT: { id: 'polkadot', name: 'Polkadot' },
  AVAX: { id: 'avalanche-2', name: 'Avalanche' },
  MATIC: { id: 'matic-network', name: 'Polygon' },
  LINK: { id: 'chainlink', name: 'Chainlink' },
  LTC: { id: 'litecoin', name: 'Litecoin' },
  BCH: { id: 'bitcoin-cash', name: 'Bitcoin Cash' },
  ATOM: { id: 'cosmos', name: 'Cosmos' },
  UNI: { id: 'uniswap', name: 'Uniswap' },
  XLM: { id: 'stellar', name: 'Stellar' },
  NEAR: { id: 'near', name: 'NEAR Protocol' },
  APT: { id: 'aptos', name: 'Aptos' },
  ARB: { id: 'arbitrum', name: 'Arbitrum' },
  OP: { id: 'optimism', name: 'Optimism' },
  SUI: { id: 'sui', name: 'Sui' },
  TRX: { id: 'tron', name: 'TRON' },
  TON: { id: 'the-open-network', name: 'Toncoin' },
  SHIB: { id: 'shiba-inu', name: 'Shiba Inu' },
  USDT: { id: 'tether', name: 'Tether' },
  USDC: { id: 'usd-coin', name: 'USD Coin' },
  DAI: { id: 'dai', name: 'Dai' },
  AAVE: { id: 'aave', name: 'Aave' },
  MKR: { id: 'maker', name: 'Maker' },
  CRV: { id: 'curve-dao-token', name: 'Curve DAO' },
  // GoMining Token (CoinGecko id gmt-token; symbol often GOMINING — STEPN uses GMT on CoinGecko search)
  GMT: { id: 'gmt-token', name: 'GoMining Token' },
  GOMINING: { id: 'gmt-token', name: 'GoMining Token' },
  BNB: { id: 'binancecoin', name: 'BNB' },
  ETC: { id: 'ethereum-classic', name: 'Ethereum Classic' },
  FIL: { id: 'filecoin', name: 'Filecoin' },
  ICP: { id: 'internet-computer', name: 'Internet Computer' },
  ALGO: { id: 'algorand', name: 'Algorand' },
  VET: { id: 'vechain', name: 'VeChain' },
  HBAR: { id: 'hedera-hashgraph', name: 'Hedera' },
  EGLD: { id: 'elrond-erd-2', name: 'MultiversX' },
  FTM: { id: 'fantom', name: 'Fantom' },
  NEXO: { id: 'nexo', name: 'Nexo' },
  PEPE: { id: 'pepe', name: 'Pepe' },
  // Cronos (Crypto.com Chain) — CRO ticker resolves to crypto-com-chain
  CRO: { id: 'crypto-com-chain', name: 'Cronos' },
  CRONOS: { id: 'crypto-com-chain', name: 'Cronos' },
};

type PriceCacheEntry = {
  at: number;
  nzd: number | null;
  usd: number | null;
  status: 'ok' | 'unavailable';
  message: string | null;
  /** True when serving a previously successful quote after rate limit / error. */
  stale?: boolean;
  /** Live venue that produced this quote (for QuoteResult.source). */
  source?: QuoteSource;
};

type IdCacheEntry = {
  at: number;
  id: string;
  name: string;
  thumb: string | null;
};

function markCryptoStale(id: string, at: number): void {
  logger.warn('crypto_stale_fallback', { id, asOf: new Date(at).toISOString() });
}

const priceCache = new Map<string, PriceCacheEntry>();
const lastGoodPrice = new Map<
  string,
  { at: number; nzd: number; usd: number | null }
>();
const idCache = new Map<string, IdCacheEntry>();
const inflightPrice = new Map<string, Promise<PriceCacheEntry>>();
const inflightResolve = new Map<string, Promise<CryptoResolveResult>>();
const inflightSearch = new Map<
  string,
  Promise<{ id: string; name: string; thumb: string | null } | null>
>();

let rateLimitedUntil = 0;

function positiveNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isRateLimited(): boolean {
  return Date.now() < rateLimitedUntil;
}

function markRateLimited(retryAfterSec?: number | null): void {
  const ms =
    retryAfterSec != null && Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? Math.min(retryAfterSec * 1000, 5 * 60_000)
      : RATE_LIMIT_BACKOFF_MS;
  rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + ms);
}

/** Friendly status text — never dump raw JSON bodies to the UI. */
function friendlyHttpDetail(label: string, status: number): string {
  if (status === 429) {
    return `${label} rate limit reached — retries paused briefly. Using cached NZD if available.`;
  }
  if (status === 404) return `${label}: not found`;
  if (status >= 500) return `${label}: provider temporarily unavailable (HTTP ${status})`;
  return `${label}: HTTP ${status}`;
}

type FetchResult =
  | { ok: true; data: unknown }
  | { ok: false; detail: string; status: number | null; rateLimited: boolean };

async function fetchJson(url: string, label: string): Promise<FetchResult> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 429) {
        const ra = res.headers.get('retry-after');
        const sec = ra != null ? Number(ra) : null;
        markRateLimited(Number.isFinite(sec as number) ? (sec as number) : null);
      }
      return {
        ok: false,
        detail: friendlyHttpDetail(label, res.status),
        status: res.status,
        rateLimited: res.status === 429,
      };
    }
    try {
      return { ok: true, data: JSON.parse(text) as unknown };
    } catch {
      return {
        ok: false,
        detail: `${label} returned non-JSON`,
        status: res.status,
        rateLimited: false,
      };
    }
  } catch (err) {
    return {
      ok: false,
      detail: `${label} fetch failed: ${(err as Error).message}`,
      status: null,
      rateLimited: false,
    };
  }
}

function rememberGood(coingeckoId: string, nzd: number, usd: number | null): void {
  lastGoodPrice.set(coingeckoId, { at: Date.now(), nzd, usd });
}

function staleFromLastGood(
  coingeckoId: string,
  reason: string,
): PriceCacheEntry | null {
  const g = lastGoodPrice.get(coingeckoId);
  if (!g || g.nzd == null) return null;
  if (Date.now() - g.at > STALE_OK_MAX_MS) return null;
  markCryptoStale(coingeckoId, g.at);
  return {
    at: g.at,
    nzd: g.nzd,
    usd: g.usd,
    status: 'ok',
    stale: true,
    message: `${reason} · cached NZD from ${new Date(g.at).toISOString()}`,
  };
}

/** Read last-good NZD from price_quotes (CRYPTO:TICKER or CRYPTO_ID:id). */
async function readDbLastGood(
  assetKey: string,
  coingeckoId: string | null,
): Promise<PriceCacheEntry | null> {
  try {
    const db = await getDb();
    const keys = [assetKey];
    if (coingeckoId) keys.push(`CRYPTO_ID:${coingeckoId}`);
    for (const key of keys) {
      const row = queryOne(
        db,
        'SELECT price, status, as_of, notes, source FROM price_quotes WHERE asset_key = ?',
        [key],
      );
      if (!row || row.status !== 'ok' || row.price == null) continue;
      const nzd = positiveNum(row.price);
      if (nzd == null) continue;
      const asOf = row.as_of ? Date.parse(String(row.as_of)) : NaN;
      if (!Number.isFinite(asOf) || Date.now() - asOf > STALE_OK_MAX_MS) continue;
      rememberGood(coingeckoId ?? assetKey, nzd, null);
      return {
        at: asOf,
        nzd,
        usd: null,
        status: 'ok',
        stale: true,
        message: `Cached NZD from price_quotes (${new Date(asOf).toISOString()})`,
      };
    }
  } catch {
    // DB optional for quote path — ignore
  }
  return null;
}

async function persistGoodQuote(
  assetKey: string,
  coingeckoId: string | null,
  entry: PriceCacheEntry,
): Promise<void> {
  if (entry.status !== 'ok' || entry.nzd == null || entry.stale) return;
  try {
    const db = await getDb();
    const now = new Date(entry.at).toISOString();
    const source = entry.source ?? 'coingecko';
    const notes =
      entry.message ??
      (coingeckoId
        ? `Live NZD from ${source} (${coingeckoId})`
        : `Live NZD from ${source}`);
    const keys = [assetKey];
    if (coingeckoId) keys.push(`CRYPTO_ID:${coingeckoId}`);
    for (const key of keys) {
      run(
        db,
        `INSERT INTO price_quotes (id, asset_key, currency, price, status, source, as_of, notes)
         VALUES (?, ?, 'NZD', ?, 'ok', ?, ?, ?)
         ON CONFLICT(asset_key) DO UPDATE SET
           price=excluded.price, status=excluded.status, source=excluded.source,
           as_of=excluded.as_of, notes=excluded.notes, currency=excluded.currency`,
        [newId('q'), key, entry.nzd, source, now, notes],
      );
    }
    persist();
  } catch {
    // non-fatal
  }
}

/** Prefer exact symbol match from CoinGecko search; never invent an id. */
async function searchCoingeckoId(
  ticker: string,
): Promise<{ id: string; name: string; thumb: string | null } | null> {
  const upper = ticker.toUpperCase();
  const cached = idCache.get(upper);
  if (cached && Date.now() - cached.at < ID_TTL_MS) {
    return { id: cached.id, name: cached.name, thumb: cached.thumb };
  }

  const existing = inflightSearch.get(upper);
  if (existing) return existing;

  const promise = (async () => {
    if (isRateLimited()) {
      // Still allow well-known / cache; search would fail
      return cached
        ? { id: cached.id, name: cached.name, thumb: cached.thumb }
        : null;
    }
    const q = encodeURIComponent(ticker);
    const r = await fetchJson(
      `https://api.coingecko.com/api/v3/search?query=${q}`,
      'CoinGecko search',
    );
    if (!r.ok) return null;
    const data = r.data as {
      coins?: Array<{
        id?: string;
        name?: string;
        symbol?: string;
        thumb?: string;
        market_cap_rank?: number | null;
      }>;
    };
    const coins = data.coins ?? [];
    const exact = coins.filter(
      (c) => (c.symbol ?? '').toUpperCase() === upper && c.id,
    );
    if (exact.length === 0) return null;
    exact.sort((a, b) => {
      const ra = a.market_cap_rank ?? 999999;
      const rb = b.market_cap_rank ?? 999999;
      return ra - rb;
    });
    const best = exact[0]!;
    const entry: IdCacheEntry = {
      at: Date.now(),
      id: best.id!,
      name: best.name ?? ticker,
      thumb: best.thumb ?? null,
    };
    idCache.set(upper, entry);
    return { id: entry.id, name: entry.name, thumb: entry.thumb };
  })().finally(() => {
    inflightSearch.delete(upper);
  });

  inflightSearch.set(upper, promise);
  return promise;
}

async function trySpotFallbacks(
  ticker: string,
  cacheKey: string,
  reason: string,
): Promise<PriceCacheEntry | null> {
  const spot = await fetchSpotUsdThenNzd(ticker);
  if (!spot.ok) return null;
  const asOf = Date.now();
  const entry: PriceCacheEntry = {
    at: asOf,
    nzd: spot.nzd,
    usd: spot.usd,
    status: 'ok',
    source: spot.source,
    message: `${spot.message} · after ${reason}`,
  };
  rememberGood(cacheKey, spot.nzd, spot.usd);
  priceCache.set(cacheKey, entry);
  return entry;
}

async function fetchSimplePriceNzd(
  ticker: string,
  coingeckoId: string | null,
  force = false,
): Promise<PriceCacheEntry> {
  const cacheKey = coingeckoId ?? `TICKER:${ticker}`;

  if (!force) {
    const hit = priceCache.get(cacheKey);
    if (hit && hit.status === 'ok' && Date.now() - hit.at < PRICE_TTL_MS) {
      return hit;
    }
  }

  const existing = inflightPrice.get(cacheKey);
  if (existing) return existing;

  const promise = (async (): Promise<PriceCacheEntry> => {
    const asOf = Date.now();
    const cgBlocked = isRateLimited();

    // ── CoinGecko (skip live call while rate-limited) ──
    if (coingeckoId && !cgBlocked) {
      const url =
        `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coingeckoId)}` +
        `&vs_currencies=usd,nzd`;
      const r = await fetchJson(url, 'CoinGecko');

      if (r.ok) {
        const row = (r.data as Record<string, { usd?: number; nzd?: number }>)[
          coingeckoId
        ];
        const nzd = positiveNum(row?.nzd);
        const usd = positiveNum(row?.usd);
        if (nzd != null) {
          const entry: PriceCacheEntry = {
            at: Date.now(),
            nzd,
            usd,
            status: 'ok',
            source: 'coingecko',
            message: 'Live NZD from CoinGecko',
          };
          rememberGood(cacheKey, nzd, usd);
          priceCache.set(cacheKey, entry);
          return entry;
        }
        // USD-only from CG: still convert via FX rather than inventing nothing
        if (usd != null) {
          const fx = await fetchFxToNzd('USD', false);
          if (fx.status === 'ok' && fx.rate != null) {
            const nzdFromFx = usd * fx.rate;
            if (Number.isFinite(nzdFromFx) && nzdFromFx > 0) {
              const entry: PriceCacheEntry = {
                at: Date.now(),
                nzd: nzdFromFx,
                usd,
                status: 'ok',
                source: 'coingecko',
                message: `CoinGecko USD × ${fx.source === 'frankfurter' ? 'Frankfurter' : 'FX'} USD→NZD ${fx.rate}`,
              };
              rememberGood(cacheKey, nzdFromFx, usd);
              priceCache.set(cacheKey, entry);
              return entry;
            }
          }
        }
        // No usable CG prices — fall through to public spot
      } else {
        // 429 or other failure → public spot fallbacks before stale cache
        const reason =
          r.rateLimited || r.status === 429
            ? 'CoinGecko rate limit'
            : r.detail;
        const spot = await trySpotFallbacks(ticker, cacheKey, reason);
        if (spot) return spot;

        const stale = staleFromLastGood(
          cacheKey,
          r.rateLimited || r.status === 429
            ? 'CoinGecko rate limit — using last good NZD'
            : 'CoinGecko unavailable — using last good NZD',
        );
        if (stale) {
          priceCache.set(cacheKey, stale);
          return stale;
        }
        return {
          at: asOf,
          nzd: null,
          usd: null,
          status: 'unavailable',
          message:
            r.rateLimited || r.status === 429
              ? 'CoinGecko rate limit and public spot fallbacks (Coinbase/Kraken + FX) unavailable. Try again shortly.'
              : `${r.detail} · public spot fallbacks also failed.`,
        };
      }
    } else if (coingeckoId && cgBlocked) {
      // Rate-limited: skip CG, go straight to public spot
      const spot = await trySpotFallbacks(
        ticker,
        cacheKey,
        'CoinGecko rate limit',
      );
      if (spot) return spot;
      const stale = staleFromLastGood(
        cacheKey,
        'CoinGecko rate limit — using last good NZD',
      );
      if (stale) {
        priceCache.set(cacheKey, stale);
        return stale;
      }
      return {
        at: asOf,
        nzd: null,
        usd: null,
        status: 'unavailable',
        message:
          'CoinGecko rate limit and public spot fallbacks (Coinbase/Kraken + FX) unavailable. Try again shortly.',
      };
    }

    // No CoinGecko id (or CG returned empty) → public spot by ticker symbol
    const spot = await trySpotFallbacks(
      ticker,
      cacheKey,
      coingeckoId
        ? `CoinGecko returned no prices for ${coingeckoId}`
        : 'no CoinGecko id',
    );
    if (spot) return spot;

    const stale = staleFromLastGood(cacheKey, 'Live venues unavailable');
    if (stale) {
      priceCache.set(cacheKey, stale);
      return stale;
    }

    return {
      at: asOf,
      nzd: null,
      usd: null,
      status: 'unavailable',
      message: coingeckoId
        ? `No live NZD for ${ticker} (${coingeckoId}) from CoinGecko, Coinbase, or Kraken (+ FX).`
        : `No live NZD for ${ticker} — no CoinGecko id and public spot fallbacks unavailable.`,
    };
  })().finally(() => {
    inflightPrice.delete(cacheKey);
  });

  inflightPrice.set(cacheKey, promise);
  return promise;
}

/**
 * Resolve a crypto ticker to display name + optional NZD unit quote.
 * Always returns a result; quote.status may be unavailable.
 * Concurrent calls for the same ticker are coalesced.
 */
export async function resolveCryptoTicker(
  rawTicker: string,
  forceQuote = false,
): Promise<CryptoResolveResult> {
  const ticker = rawTicker.trim().toUpperCase();
  const coalesceKey = `${ticker}:${forceQuote ? '1' : '0'}`;
  const existing = inflightResolve.get(coalesceKey);
  if (existing) return existing;

  const promise = resolveCryptoTickerInner(ticker, forceQuote).finally(() => {
    inflightResolve.delete(coalesceKey);
  });
  inflightResolve.set(coalesceKey, promise);
  return promise;
}

async function resolveCryptoTickerInner(
  ticker: string,
  forceQuote: boolean,
): Promise<CryptoResolveResult> {
  const assetKey = `CRYPTO:${ticker}`;

  if (!ticker) {
    return {
      ticker: '',
      assetClass: 'crypto',
      name: '',
      coingeckoId: null,
      iconUrl: null,
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
  }

  const known = WELL_KNOWN[ticker];
  let coingeckoId = known?.id ?? null;
  let name = known?.name ?? ticker;
  let iconUrl: string | null = null;
  const finalizeIcon = (thumb: string | null) =>
    resolveCryptoIconUrl(ticker, thumb);

  if (known) {
    const knownThumb = finalizeIcon(null);
    idCache.set(ticker, {
      at: Date.now(),
      id: known.id,
      name: known.name,
      thumb: knownThumb,
    });
    iconUrl = knownThumb;
  }

  if (!coingeckoId) {
    const cached = idCache.get(ticker);
    if (cached && Date.now() - cached.at < ID_TTL_MS) {
      coingeckoId = cached.id;
      name = cached.name;
      iconUrl = finalizeIcon(cached.thumb);
    } else {
      const found = await searchCoingeckoId(ticker);
      if (found) {
        coingeckoId = found.id;
        name = found.name;
        iconUrl = finalizeIcon(found.thumb);
      }
    }
  }

  // Even without a CoinGecko id, try public spot (Coinbase/Kraken) by symbol.
  const px = await fetchSimplePriceNzd(ticker, coingeckoId, forceQuote);
  if (px.status === 'ok' && px.nzd != null && !px.stale) {
    void persistGoodQuote(assetKey, coingeckoId, px);
  } else if (px.status !== 'ok' || px.nzd == null) {
    // Try DB last-good under CRYPTO:TICKER before giving up
    const dbHit = await readDbLastGood(assetKey, coingeckoId);
    if (dbHit) {
      const asOfIso = new Date(dbHit.at).toISOString();
      const idNote = coingeckoId ? ` (${coingeckoId})` : '';
      return {
        ticker,
        assetClass: 'crypto',
        name,
        coingeckoId,
        iconUrl: finalizeIcon(iconUrl),
        quote: {
          assetKey,
          currency: 'NZD',
          price: dbHit.nzd,
          status: 'ok',
          source: 'coingecko',
          asOf: asOfIso,
          message: `${dbHit.message}${idNote}`,
        },
      };
    }
  }

  if (!coingeckoId && (px.status !== 'ok' || px.nzd == null)) {
    return {
      ticker,
      assetClass: 'crypto',
      name: ticker,
      coingeckoId: null,
      iconUrl: finalizeIcon(iconUrl),
      quote: {
        assetKey,
        currency: 'NZD',
        price: null,
        status: 'unavailable',
        source: 'stub',
        asOf: null,
        message:
          px.message ??
          `No CoinGecko match for ticker ${ticker} and public spot fallbacks unavailable — holding can still be added; Value stays — until a quote is available.`,
      },
    };
  }

  const asOfIso =
    px.status === 'ok' && px.nzd != null
      ? new Date(px.at).toISOString()
      : null;

  const idNote = coingeckoId ?? ticker;
  const quoteSource: QuoteSource =
    px.status === 'ok' ? (px.source ?? 'coingecko') : 'stub';

  iconUrl = finalizeIcon(iconUrl);

  return {
    ticker,
    assetClass: 'crypto',
    name,
    coingeckoId,
    iconUrl,
    quote: {
      assetKey,
      currency: 'NZD',
      price: px.nzd,
      status: px.status,
      source: quoteSource,
      asOf: asOfIso,
      message: px.message
        ? px.message.includes(idNote)
          ? px.message
          : `${px.message} (${idNote})`
        : null,
    },
  };
}

/** NZD unit quote for a ticker (resolve + CoinGecko). */
export async function getCryptoQuoteNzd(
  ticker: string,
  force = false,
): Promise<QuoteResult> {
  const r = await resolveCryptoTicker(ticker, force);
  return r.quote;
}

/** Resolve CoinGecko id only (uses well-known + id cache; may search). */
export async function resolveCoingeckoId(
  rawTicker: string,
): Promise<{ ticker: string; coingeckoId: string | null; name: string }> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) return { ticker: '', coingeckoId: null, name: '' };
  const known = WELL_KNOWN[ticker];
  if (known) return { ticker, coingeckoId: known.id, name: known.name };
  const cached = idCache.get(ticker);
  if (cached && Date.now() - cached.at < ID_TTL_MS) {
    return { ticker, coingeckoId: cached.id, name: cached.name };
  }
  const found = await searchCoingeckoId(ticker);
  if (found) return { ticker, coingeckoId: found.id, name: found.name };
  return { ticker, coingeckoId: null, name: ticker };
}

export function clearCryptoQuoteCache(): void {
  priceCache.clear();
  lastGoodPrice.clear();
  idCache.clear();
  rateLimitedUntil = 0;
}

export function getCryptoRateLimitRemainingMs(): number {
  return Math.max(0, rateLimitedUntil - Date.now());
}
