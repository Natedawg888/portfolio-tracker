/**
 * Metal spot quotes API (Metals.Dev → NZD).
 * Never invents prices; stubs gracefully without METALS_API_KEY.
 */
import { Router } from 'express';
import { getDb, queryOne } from '../db/index.ts';
import {
  METAL_KINDS,
  metalAssetKey,
  metalsConfigured,
  clearMetalsCache,
  metalsQuotaBlocked,
  metalsQuotaMessage,
} from '../quotes/metals.ts';
import {
  persistMetalQuote,
  resolveMetalSpotNzd,
  readDbMetalQuotes,
} from '../quotes/metalQuotesDb.ts';
import { resolveCryptoTicker } from '../quotes/crypto.ts';
import { resolveStockTicker } from '../quotes/stocks.ts';
import {
  fetchCryptoHistory,
  fetchMetalHistory,
  fetchStockHistory,
  parseHistoryRange,
} from '../quotes/history.ts';
import type { MetalKind } from '../../src/types/index.ts';
import {
  DIAMOND_CLARITIES,
  DIAMOND_COLOURS,
  DIAMOND_SHAPES,
  quoteDiamondOpenFacet,
  clearStoneQuoteCache,
} from '../quotes/stones.ts';
import { quoteCard, parseCardGame } from '../quotes/cards.ts';
import { convertFxPair, convertToNzd, fetchFxPair } from '../quotes/fx.ts';
import { listFrankfurterCurrencies } from '../quotes/fxCurrencies.ts';

const router = Router();

function quotesPayload(
  db: Awaited<ReturnType<typeof getDb>>,
  results: Awaited<ReturnType<typeof resolveMetalSpotNzd>>,
) {
  return METAL_KINDS.map((metal) => {
    const q = results[metal];
    persistMetalQuote(db, q);
    return {
      metal,
      assetKey: q.assetKey,
      currency: q.currency,
      price: q.price,
      status: q.status,
      source: q.source,
      asOf: q.asOf,
      message: q.message,
    };
  });
}

/** Status + whether METALS_API_KEY is present (never exposes the key). */
router.get('/metals/status', async (_req, res) => {
  const db = await getDb();
  const dbGood = readDbMetalQuotes(db);
  const notes = dbGood?.gold?.message ?? '';
  const dbQuotaHint =
    typeof notes === 'string' && /quota/i.test(notes) ? notes : null;
  const memBlocked = metalsQuotaBlocked();
  res.json({
    configured: metalsConfigured(),
    provider: 'metals.dev',
    currency: 'NZD',
    unit: 'oz_t',
    displayUnits: ['oz_t', 'g'],
    metals: METAL_KINDS,
    // Honest: blocked in-memory OR last-good notes mention quota (free-tier miss).
    quotaBlocked: memBlocked || Boolean(dbQuotaHint),
    quotaMessage: metalsQuotaMessage() ?? dbQuotaHint,
    hasLastGood: Boolean(dbGood),
    lastGoodAsOf: dbGood?.gold?.asOf ?? null,
    docs: 'https://metals.dev/docs',
    signup: 'https://metals.dev/',
    envVar: 'METALS_API_KEY',
  });
});

/**
 * Latest cached or live metal spots (NZD / troy oz).
 * Query ?refresh=1 to force a Metals.Dev fetch (counts against free quota).
 */
router.get('/metals', async (req, res) => {
  const force = req.query.refresh === '1' || req.query.refresh === 'true';
  const db = await getDb();

  if (!force && !metalsConfigured()) {
    const dbGood = readDbMetalQuotes(db);
    const quotes = METAL_KINDS.map((metal) => {
      const key = metalAssetKey(metal);
      if (dbGood?.[metal]) {
        const q = dbGood[metal];
        return {
          metal,
          assetKey: key,
          currency: 'NZD',
          price: q.price,
          status: q.status,
          source: q.source,
          asOf: q.asOf,
          message: q.message,
        };
      }
      return {
        metal,
        assetKey: key,
        currency: 'NZD',
        price: null,
        status: 'unavailable',
        source: 'stub',
        asOf: null,
        message:
          'METALS_API_KEY not set. Free key at https://metals.dev/ → set METALS_API_KEY in .env',
      };
    });
    return res.json({
      configured: false,
      provider: 'metals.dev',
      currency: 'NZD',
      unit: 'oz_t',
      displayUnits: ['oz_t', 'g'],
      quotes,
    });
  }

  if (force) clearMetalsCache();
  const results = await resolveMetalSpotNzd(db, force);
  const quotes = quotesPayload(db, results);

  res.json({
    configured: metalsConfigured(),
    provider: 'metals.dev',
    currency: 'NZD',
    unit: 'oz_t',
    displayUnits: ['oz_t', 'g'],
    quotaBlocked: metalsQuotaBlocked(),
    quotaMessage: metalsQuotaMessage(),
    quotes,
  });
});

/** Force refresh all metal spots and persist to price_quotes. */
router.post('/metals/refresh', async (_req, res) => {
  const db = await getDb();
  clearMetalsCache();
  // Always resolve (stubs if no key); last-good DB/memory used on quota failure — never invent.
  const results = await resolveMetalSpotNzd(db, true);
  const quotes = quotesPayload(db, results);
  const okCount = quotes.filter(
    (q) => (q.status === 'ok' || q.status === 'stale') && q.price != null,
  ).length;
  res.json({
    configured: metalsConfigured(),
    provider: 'metals.dev',
    currency: 'NZD',
    unit: 'oz_t',
    displayUnits: ['oz_t', 'g'],
    quotaBlocked: metalsQuotaBlocked(),
    quotaMessage: metalsQuotaMessage(),
    okCount,
    quotes,
  });
});


/**
 * Resolve a ticker for manual add (crypto or stock).
 * Crypto: CoinGecko name + NZD unit quote when available.
 * Stock: Yahoo Finance live quote × Frankfurter/BTC FX → NZD (never invent).
 * Query: ?ticker=BTC&assetClass=crypto|stock  (&exchange= optional for stocks)
 */
router.get('/resolve', async (req, res) => {
  const ticker = String(req.query.ticker ?? '').trim().toUpperCase();
  const assetClass = String(req.query.assetClass ?? 'crypto').trim().toLowerCase();
  if (!ticker) {
    return res.status(400).json({ error: 'ticker query required' });
  }
  if (assetClass !== 'crypto' && assetClass !== 'stock') {
    return res.status(400).json({ error: 'assetClass must be crypto or stock' });
  }

  if (assetClass === 'crypto') {
    // Default: use TTL cache (free-tier). ?refresh=1 forces a live simple/price.
    const force =
      req.query.refresh === '1' || req.query.refresh === 'true';
    const resolved = await resolveCryptoTicker(ticker, force);
    return res.json({
      ticker: resolved.ticker,
      assetClass: 'crypto',
      name: resolved.name,
      symbol: resolved.ticker,
      asset: resolved.ticker,
      coingeckoId: resolved.coingeckoId,
      iconUrl: resolved.iconUrl,
      quote: resolved.quote,
      quoteAvailable: resolved.quote.status === 'ok' && resolved.quote.price != null,
    });
  }

  // Stocks: Yahoo live × FX → NZD (same pipeline as portfolio stock charts). Never invent.
  const force =
    req.query.refresh === '1' || req.query.refresh === 'true';
  const exchange =
    req.query.exchange != null && String(req.query.exchange).trim()
      ? String(req.query.exchange).trim()
      : null;
  const resolved = await resolveStockTicker(ticker, { exchange, force });
  return res.json({
    ticker: resolved.ticker,
    assetClass: 'stock',
    name: resolved.name,
    symbol: resolved.symbol,
    yahooSymbol: resolved.yahooSymbol,
    asset: null,
    coingeckoId: null,
    iconUrl: resolved.iconUrl,
    quote: resolved.quote,
    quoteAvailable:
      (resolved.quote.status === 'ok' || resolved.quote.status === 'stale') &&
      resolved.quote.price != null,
  });
});

/**
 * Price history for card charts.
 * Query: assetClass=crypto|metal|stock & range=1d|5d|1m|1y
 *   crypto: ticker=BTC
 *   metal: metal=gold|silver|platinum|palladium
 *   stock: ticker=AAPL&exchange=optional
 * Never invents — unavailable when sources fail.
 */
router.get('/history', async (req, res) => {
  const assetClass = String(req.query.assetClass ?? '').trim().toLowerCase();
  const range = parseHistoryRange(req.query.range);
  if (!range) {
    return res.status(400).json({
      error: 'range must be one of 1d, 5d, 1m, 1y',
    });
  }
  if (assetClass === 'crypto') {
    const ticker = String(req.query.ticker ?? req.query.symbol ?? '').trim();
    const result = await fetchCryptoHistory(ticker, range);
    return res.json(result);
  }
  if (assetClass === 'metal') {
    const metal = String(req.query.metal ?? '').trim().toLowerCase() as MetalKind;
    if (!['gold', 'silver', 'platinum', 'palladium'].includes(metal)) {
      return res.status(400).json({
        error: 'metal must be gold|silver|platinum|palladium',
      });
    }
    const result = await fetchMetalHistory(metal, range);
    return res.json(result);
  }
  if (assetClass === 'stock') {
    const ticker = String(req.query.ticker ?? req.query.symbol ?? '').trim();
    const exchange = req.query.exchange != null ? String(req.query.exchange) : null;
    const result = await fetchStockHistory(ticker, range, exchange);
    return res.json(result);
  }
  return res.status(400).json({
    error: 'assetClass must be crypto, metal, or stock',
  });
});



/**
 * Preview diamond price (OpenFacet USD → Frankfurter NZD). No holding created.
 * GET query or POST JSON: carat, colour|color, clarity, cut|shape
 */
function diamondParams(req: { query: Record<string, unknown>; body?: Record<string, unknown> }) {
  const src = { ...(req.query ?? {}), ...(req.body ?? {}) };
  const carat = Number(src.carat);
  const colour = String(src.colour ?? src.color ?? '').trim();
  const clarity = String(src.clarity ?? '').trim();
  const shape = String(src.cut ?? src.shape ?? 'round').trim();
  return { carat, colour, clarity, shape };
}

async function handleDiamondQuote(req: { query: Record<string, unknown>; body?: Record<string, unknown> }, res: import('express').Response) {
  const { carat, colour, clarity, shape } = diamondParams(req);
  if (!Number.isFinite(carat) || carat <= 0) {
    return res.status(400).json({ error: 'carat required (0.3–6.0)' });
  }
  if (!colour || !clarity) {
    return res.status(400).json({ error: 'colour (D–M) and clarity required' });
  }
  const force =
    String(req.query.refresh ?? '') === '1' ||
    String(req.query.refresh ?? '') === 'true' ||
    Boolean((req.body as { force?: boolean } | undefined)?.force);
  if (force) clearStoneQuoteCache();
  const quote = await quoteDiamondOpenFacet({ carat, colour, clarity, shape }, force);
  res.json({
    provider: 'openfacet',
    currency: 'NZD',
    specs: { carat, colour: colour.toUpperCase(), clarity: clarity.toUpperCase(), shape: shape.toLowerCase() },
    limits: {
      carat: [0.3, 6.0],
      colours: DIAMOND_COLOURS,
      clarities: DIAMOND_CLARITIES,
      shapes: DIAMOND_SHAPES,
    },
    quote,
  });
}

router.get('/stones/diamond', (req, res) => {
  void handleDiamondQuote(req as typeof req & { body?: Record<string, unknown> }, res);
});

router.post('/stones/diamond', (req, res) => {
  void handleDiamondQuote(
    { query: req.query as Record<string, unknown>, body: (req.body ?? {}) as Record<string, unknown> },
    res,
  );
});

router.get('/stones/status', (_req, res) => {
  res.json({
    provider: 'openfacet',
    configured: true,
    apiKeyRequired: false,
    diamondOnly: true,
    docs: 'https://openfacet.net/',
    mcp: 'https://mcp.openfacet.net/',
    colours: DIAMOND_COLOURS,
    clarities: DIAMOND_CLARITIES,
    shapes: DIAMOND_SHAPES,
    caratRange: [0.3, 6.0],
    note: 'Diamonds: OpenFacet https://openfacet.net/ (MCP https://mcp.openfacet.net/). Non-diamond gems: manual estimated NZD only — never invent.',
  });
});


/**
 * Preview collectable card quote (Scryfall / pokemontcg.io → NZD).
 * Does not create a holding. Never invents prices.
 * Query: game=mtg|pokemon & name= & set= & number= & finish= & apiId=
 */
router.get('/cards', async (req, res) => {
  const gameRaw = String(req.query.game ?? '').trim();
  const game = parseCardGame(gameRaw);
  if (game !== 'mtg' && game !== 'pokemon') {
    return res.status(400).json({
      error: 'game must be mtg or pokemon',
    });
  }
  const name = req.query.name != null ? String(req.query.name).trim() : '';
  const set = req.query.set != null ? String(req.query.set).trim() : '';
  const number = req.query.number != null ? String(req.query.number).trim() : '';
  const finish = req.query.finish != null ? String(req.query.finish).trim() : '';
  const apiId = req.query.apiId != null ? String(req.query.apiId).trim() : '';
  if (!apiId && !name && !(set && number)) {
    return res.status(400).json({
      error: 'Provide name, set+number, or apiId',
    });
  }
  const quote = await quoteCard({
    game,
    name: name || null,
    set: set || null,
    number: number || null,
    finish: finish || null,
    apiId: apiId || null,
  });
  res.json({
    provider: quote.source,
    currency: 'NZD',
    quote,
  });
});

/**
 * Frankfurter currency catalogue (all ECB currencies) with country search aliases.
 * Never invents rates — catalogue only.
 */
router.get('/fx/currencies', async (req, res) => {
  const force =
    req.query.refresh === '1' || req.query.refresh === 'true';
  const data = await listFrankfurterCurrencies(force);
  res.json({
    currencies: data.currencies,
    source: data.source,
    asOf: data.asOf,
    message: data.message,
    count: data.currencies.length,
  });
});

/**
 * FX rate / convert any→any via Frankfurter (ECB).
 * Query: from=NZD&to=JPY&amount=100
 * `to` defaults to NZD for backward compatibility.
 * USD→NZD keeps BTC FX ratio fallback. Never invents rates.
 */
router.get('/fx', async (req, res) => {
  const from = String(req.query.from ?? req.query.currency ?? '').trim().toUpperCase();
  const to = String(req.query.to ?? 'NZD').trim().toUpperCase() || 'NZD';
  if (!from || from.length !== 3) {
    return res.status(400).json({ error: 'from must be a 3-letter ISO currency (e.g. USD)' });
  }
  if (!to || to.length !== 3) {
    return res.status(400).json({ error: 'to must be a 3-letter ISO currency (e.g. JPY)' });
  }
  const force =
    req.query.refresh === '1' || req.query.refresh === 'true';
  const amountRaw = req.query.amount;
  const hasAmount = amountRaw != null && String(amountRaw).trim() !== '';
  const amount = hasAmount ? Number(amountRaw) : null;
  if (hasAmount && (!Number.isFinite(amount) || (amount as number) < 0)) {
    return res.status(400).json({ error: 'amount must be a non-negative number' });
  }

  const quote =
    hasAmount && amount != null
      ? await convertFxPair(amount, from, to, force)
      : await fetchFxPair(from, to, force);

  // Backward-compat fields when converting to NZD
  let convertedCompat: {
    nzd: number;
    rate: number;
    fromCurrency: string;
    source: string;
    asOf: string;
    message: string;
  } | null = null;
  if (to === 'NZD' && hasAmount && amount != null && quote.status === 'ok' && quote.rate != null) {
    convertedCompat = {
      nzd: amount * quote.rate,
      rate: quote.rate,
      fromCurrency: quote.fromCurrency,
      source: quote.source,
      asOf: quote.asOf ?? new Date().toISOString(),
      message: quote.message ?? `${from}→NZD @ ${quote.rate}`,
    };
  } else if (to === 'NZD' && hasAmount && amount != null) {
    const c = await convertToNzd(amount, from, force);
    if (c) {
      convertedCompat = {
        nzd: c.nzd,
        rate: c.rate,
        fromCurrency: c.fromCurrency,
        source: c.source,
        asOf: c.asOf,
        message: c.message,
      };
    }
  }

  res.json({
    fromCurrency: quote.fromCurrency,
    toCurrency: quote.toCurrency,
    rate: quote.rate,
    status: quote.status,
    source: quote.source,
    asOf: quote.asOf,
    message: quote.message,
    amount: hasAmount ? amount : null,
    convertedAmount: quote.converted,
    nzd: to === 'NZD' ? (quote.converted ?? convertedCompat?.nzd ?? null) : null,
    converted: convertedCompat,
  });
});

export default router;
