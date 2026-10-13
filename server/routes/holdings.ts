
import { Router } from 'express';
import { isTotalNotUnitQuote } from '../../src/lib/holdingValue.ts';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { unlinkDividendsForHolding } from '../dividends/store.ts';
import { getDb, queryAll, queryOne, run, newId, persist } from '../db/index.ts';
import { providerForAssetKey } from '../quotes/providers.ts';
import {
  metalAssetKey,
  metalMarketValueNzd,
  getMetalQuote,
} from '../quotes/metals.ts';
import {
  isDiamondStoneType,
  normalizeDiamondClarity,
  normalizeDiamondColour,
  normalizeDiamondShape,
  quoteDiamondOpenFacet,
  stoneAssetKey,
} from '../quotes/stones.ts';
import { quotesForRead } from '../quotes/readQuotes.ts';
import {
  estimateMinerValueNzd,
  estimateToQuoteResult,
} from '../quotes/gominingMarketplace.ts';
import { resolveCryptoTicker } from '../quotes/crypto.ts';
import { getStockQuoteNzd, resolveStockTicker } from '../quotes/stocks.ts';
import {
  forexAssetKey,
  refreshForexCurrency,
} from '../quotes/forexQuotesDb.ts';
import type { MetalKind, MetalUnit } from '../../src/types/index.ts';
import {
  parseCardGame,
  quoteCard,
  coloursToStorage,
  coloursFromStorage,
  normalizeCardRarity,
  isApiCardGame,
  isManualCollectableGame,
  fetchScryfallCollectionMeta,
} from '../quotes/cards.ts';
import { convertToNzd } from '../quotes/fx.ts';
import {
  deletePropertyPhoto,
  photoUrlFromPath,
  saveArtPhoto,
  saveCollectablePhoto,
  savePropertyPhoto,
} from '../lib/uploads.ts';

const router = Router();

/** Attach scopeUserId for every holdings route (requireAuth already ran). */
router.use((req, res, next) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  (req as AuthedRequest & { scopeUserId: string }).scopeUserId = userId;
  next();
});

function uid(req: { scopeUserId?: string; user?: { id: string } | null }): string {
  return (req as AuthedRequest & { scopeUserId?: string }).scopeUserId
    || (req as AuthedRequest).user?.id
    || '';
}


/** Preserve an unknown cost basis as SQL NULL instead of coercing it to zero. */
function optionalNumber(value: unknown): number | null {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}


/** Weighted merge of total NZD cost basis when adding another lot.
 * cost_basis_nzd is total paid (not per-unit). Summing totals = qty-weighted avg. */
function mergeCostBasisNzd(
  existingCost: unknown,
  addCost: number | null,
): number | null {
  const old =
    existingCost != null && Number.isFinite(Number(existingCost))
      ? Number(existingCost)
      : null;
  if (old != null && addCost != null) return old + addCost;
  if (old != null) return old;
  if (addCost != null) return addCost;
  return null;
}

function findMergeTarget(
  db: Awaited<ReturnType<typeof getDb>>,
  assetClass: 'stock' | 'crypto',
  ticker: string,
  userId: string,
): Record<string, unknown> | null {
  // Prefer non-Akahu (manual) rows so broker sync cannot wipe merged qty.
  if (assetClass === 'stock') {
    return (
      queryOne(
        db,
        `SELECT * FROM holdings
         WHERE user_id = ? AND asset_class = 'stock' AND UPPER(symbol) = ?
           AND (external_id IS NULL OR external_id NOT LIKE 'akahu:%')
         ORDER BY CASE WHEN source = 'manual' THEN 0 ELSE 1 END, updated_at DESC
         LIMIT 1`,
        [userId, ticker],
      ) ?? null
    );
  }
  return (
    queryOne(
      db,
      `SELECT * FROM holdings
       WHERE user_id = ? AND asset_class = 'crypto' AND UPPER(asset) = ?
         AND (external_id IS NULL OR external_id NOT LIKE 'akahu:%')
       ORDER BY CASE WHEN source = 'manual' THEN 0 ELSE 1 END, updated_at DESC
       LIMIT 1`,
      [userId, ticker],
    ) ?? null
  );
}


function lookupMetalSpotNzd(
  db: Awaited<ReturnType<typeof getDb>>,
  metal: string | null | undefined,
): { price: number | null; asOf: string | null; status: string | null } {
  if (!metal) return { price: null, asOf: null, status: null };
  const key = metalAssetKey(metal as MetalKind, 'oz_t');
  const row = queryOne(db, 'SELECT price, as_of, status FROM price_quotes WHERE asset_key = ?', [key]);
  if (!row) return { price: null, asOf: null, status: null };
  const price =
    row.price != null && (row.status === 'ok' || row.status === 'stale')
      ? Number(row.price)
      : null;
  return {
    price: price != null && Number.isFinite(price) ? price : null,
    asOf: (row.as_of as string) ?? null,
    status: (row.status as string) ?? null,
  };
}

function lookupAkahuMarketNzd(
  db: Awaited<ReturnType<typeof getDb>>,
  assetClass: string,
  symbolOrAsset: string | null | undefined,
  qty: number | null | undefined,
): { marketValueNzd: number | null; unitPriceNzd: number | null; quoteAsOf: string | null; quoteNotes: string | null } {
  if (!symbolOrAsset) {
    return { marketValueNzd: null, unitPriceNzd: null, quoteAsOf: null, quoteNotes: null };
  }
  const prefix = assetClass === 'crypto' ? 'CRYPTO' : 'STOCK';
  const key = `${prefix}:${symbolOrAsset}`;
  const q = queryOne(db, 'SELECT price, status, as_of, notes FROM price_quotes WHERE asset_key = ?', [key]);
  if (!q || q.status !== 'ok' || q.price == null) {
    return {
      marketValueNzd: null,
      unitPriceNzd: null,
      quoteAsOf: (q?.as_of as string) ?? null,
      quoteNotes: (q?.notes as string) ?? null,
    };
  }
  const unit = Number(q.price);
  if (!Number.isFinite(unit)) {
    return { marketValueNzd: null, unitPriceNzd: null, quoteAsOf: null, quoteNotes: null };
  }
  const n = qty != null ? Number(qty) : null;
  const notes = (q.notes as string) ?? null;
  let market: number | null = null;
  let unitOut: number | null = unit;
  if (isTotalNotUnitQuote(notes)) {
    // Written by older syncs: an Akahu total for some position, not a price per unit.
    // The holding's own notes carry its value; never multiply this by a quantity.
    market = null;
    unitOut = null;
  } else if (n != null && Number.isFinite(n) && n > 0) {
    market = unit * n;
  }
  return {
    marketValueNzd: market,
    unitPriceNzd: unitOut,
    quoteAsOf: (q.as_of as string) ?? null,
    quoteNotes: notes,
  };
}


function lookupFxMarketNzd(
  db: Awaited<ReturnType<typeof getDb>>,
  currency: string | null | undefined,
  qty: number | null | undefined,
): {
  marketValueNzd: number | null;
  unitPriceNzd: number | null;
  quoteAsOf: string | null;
  quoteNotes: string | null;
} {
  if (!currency) {
    return { marketValueNzd: null, unitPriceNzd: null, quoteAsOf: null, quoteNotes: null };
  }
  const key = forexAssetKey(currency);
  const q = queryOne(db, 'SELECT price, status, as_of, notes FROM price_quotes WHERE asset_key = ?', [key]);
  if (!q || q.status !== 'ok' || q.price == null) {
    return {
      marketValueNzd: null,
      unitPriceNzd: null,
      quoteAsOf: (q?.as_of as string) ?? null,
      quoteNotes: (q?.notes as string) ?? null,
    };
  }
  const unit = Number(q.price);
  if (!Number.isFinite(unit) || unit <= 0) {
    return { marketValueNzd: null, unitPriceNzd: null, quoteAsOf: null, quoteNotes: null };
  }
  const n = qty != null ? Number(qty) : null;
  const market =
    n != null && Number.isFinite(n) && n >= 0 ? unit * n : null;
  return {
    marketValueNzd: market,
    unitPriceNzd: unit,
    quoteAsOf: (q.as_of as string) ?? null,
    quoteNotes: (q.notes as string) ?? null,
  };
}

function persistUnitQuote(
  db: Awaited<ReturnType<typeof getDb>>,
  assetKey: string,
  quote: {
    currency: string;
    price: number | null;
    status: string;
    source: string;
    asOf: string | null;
    message?: string | null;
  },
) {
  const now = quote.asOf ?? new Date().toISOString();
  run(
    db,
    `INSERT INTO price_quotes (id, asset_key, currency, price, status, source, as_of, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(asset_key) DO UPDATE SET
       price=excluded.price, status=excluded.status, source=excluded.source,
       as_of=excluded.as_of, notes=excluded.notes, currency=excluded.currency`,
    [
      newId('q'),
      assetKey,
      quote.currency,
      quote.price,
      quote.status,
      quote.source,
      now,
      quote.message ?? null,
    ],
  );
}

function mapHolding(
  row: Record<string, unknown>,
  opts?: {
    spotPerOzNzd?: number | null;
    spotAsOf?: string | null;
    marketValueNzd?: number | null;
    unitPriceNzd?: number | null;
    quoteAsOf?: string | null;
    quoteNotes?: string | null;
  },
) {
  // Treat legacy fake 0 cost on Akahu rows as unknown (display —).
  let costBasisNzd = row.cost_basis_nzd as number | null;
  if (
    costBasisNzd === 0 &&
    typeof row.external_id === 'string' &&
    row.external_id.startsWith('akahu:')
  ) {
    costBasisNzd = null;
  }
  const logoRaw = row.logo_url != null ? String(row.logo_url).trim() : '';
  const base = {
    id: row.id as string,
    assetClass: row.asset_class as string,
    name: row.name as string,
    notes: (row.notes as string) ?? undefined,
    costBasisNzd,
    acquiredAt: (row.acquired_at as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    source: (row.source as string) ?? undefined,
    externalId: (row.external_id as string) ?? undefined,
    logoUrl: logoRaw || null,
  };
  switch (row.asset_class) {
    case 'stock':
      return {
        ...base,
        symbol: row.symbol,
        shares: row.shares,
        exchange: row.exchange,
        marketValueNzd: opts?.marketValueNzd ?? null,
        unitPriceNzd: opts?.unitPriceNzd ?? null,
        quoteAsOf: opts?.quoteAsOf ?? null,
        quoteNotes: opts?.quoteNotes ?? null,
      };
    case 'crypto':
      return {
        ...base,
        asset: row.asset,
        amount: row.amount,
        marketValueNzd: opts?.marketValueNzd ?? null,
        unitPriceNzd: opts?.unitPriceNzd ?? null,
        quoteAsOf: opts?.quoteAsOf ?? null,
        quoteNotes: opts?.quoteNotes ?? null,
      };
    case 'gomining_miner':
      return {
        ...base,
        minerName: row.miner_name,
        minerExternalId: row.miner_external_id,
        hashrateThs: row.hashrate_ths,
        energyEfficiencyWth: row.energy_efficiency_wth,
        rarity: row.rarity,
        level: row.level,
        estimatedValueNzd: row.estimated_value_nzd,
        estimatedValueAt: row.estimated_value_at,
        estimatedValueSource: row.estimated_value_source,
      };
    case 'art': {
      const photoPath = (row.photo_path as string) ?? null;
      const artKindRaw = row.art_kind != null ? String(row.art_kind) : null;
      const artKind =
        artKindRaw === 'physical' || artKindRaw === 'fractional'
          ? artKindRaw
          : row.ownership_pct != null && Number(row.ownership_pct) < 100
            ? 'fractional'
            : photoPath
              ? 'physical'
              : 'fractional';
      return {
        ...base,
        artKind,
        ownershipPct: row.ownership_pct != null ? Number(row.ownership_pct) : null,
        purchasePriceNzd:
          row.purchase_price_nzd != null ? Number(row.purchase_price_nzd) : null,
        purchaseDate: (row.purchase_date as string) ?? null,
        lastValuationNzd:
          row.last_valuation_nzd != null ? Number(row.last_valuation_nzd) : null,
        lastValuationAt: (row.last_valuation_at as string) ?? null,
        artworkTitle: (row.artwork_title as string) ?? undefined,
        artist: (row.artist as string) ?? undefined,
        valuationSource: (row.valuation_source as string) ?? null,
        valuationNotes: (row.valuation_notes as string) ?? null,
        photoPath,
        photoUrl: photoUrlFromPath(photoPath),
      };
    }
    case 'metal': {
      const amount = Number(row.metal_amount ?? 0);
      const unit = (row.metal_unit as MetalUnit) || 'g';
      const spot = opts?.spotPerOzNzd ?? null;
      const marketValueNzd = metalMarketValueNzd(amount, unit, spot);
      return {
        ...base,
        metal: row.metal,
        amount: row.metal_amount,
        unit: row.metal_unit,
        spotPriceNzdPerOzT: spot,
        spotAsOf: opts?.spotAsOf ?? null,
        marketValueNzd,
      };
    }
    case 'forex':
      return {
        ...base,
        currency: (row.asset as string) ?? '',
        amount: row.amount,
        marketValueNzd: opts?.marketValueNzd ?? null,
        unitPriceNzd: opts?.unitPriceNzd ?? null,
        quoteAsOf: opts?.quoteAsOf ?? null,
        quoteNotes: opts?.quoteNotes ?? null,
      };
    case 'stone':
      return {
        ...base,
        stoneType: row.stone_type,
        carat: row.carat,
        clarity: row.clarity,
        cut: row.cut,
        colour: row.colour,
        lengthMm: row.length_mm,
        widthMm: row.width_mm,
        depthMm: row.depth_mm,
        valuationNzd: row.valuation_nzd != null ? Number(row.valuation_nzd) : null,
        valuationSource: row.valuation_source,
        valuationNotes: row.valuation_notes,
        lastValuationAt: row.last_valuation_at ?? null,
        quoteAsOf: opts?.quoteAsOf ?? row.last_valuation_at ?? null,
        quoteNotes: opts?.quoteNotes ?? row.valuation_notes ?? null,
      };
    case 'real_estate': {
      const propertyValueNzd =
        row.property_value_nzd != null ? Number(row.property_value_nzd) : null;
      const mortgageOutstandingNzd =
        row.mortgage_outstanding_nzd != null ? Number(row.mortgage_outstanding_nzd) : 0;
      const equityNzd =
        propertyValueNzd != null && Number.isFinite(propertyValueNzd)
          ? propertyValueNzd - (Number.isFinite(mortgageOutstandingNzd) ? mortgageOutstandingNzd : 0)
          : null;
      const photoPath = (row.photo_path as string) ?? null;
      return {
        ...base,
        propertyValueNzd,
        mortgageOutstandingNzd: Number.isFinite(mortgageOutstandingNzd) ? mortgageOutstandingNzd : 0,
        equityNzd,
        photoPath,
        photoUrl: photoUrlFromPath(photoPath),
      };
    }
    case 'collectable': {
      const qty =
        row.amount != null && Number.isFinite(Number(row.amount)) ? Number(row.amount) : 1;
      const unit =
        opts?.unitPriceNzd != null
          ? opts.unitPriceNzd
          : row.valuation_nzd != null && qty > 0
            ? Number(row.valuation_nzd) / qty
            : null;
      const market =
        opts?.marketValueNzd != null
          ? opts.marketValueNzd
          : row.valuation_nzd != null
            ? Number(row.valuation_nzd)
            : unit != null
              ? unit * qty
              : null;
      const photoPath = (row.photo_path as string) ?? null;
      return {
        ...base,
        cardGame: row.card_game,
        cardSet: row.card_set,
        cardNumber: row.card_number,
        cardFinish: row.card_finish,
        cardApiId: row.card_api_id,
        cardImageUrl: row.card_image_url ?? null,
        cardColours: coloursFromStorage(row.card_colours),
        cardRarity: row.card_rarity != null ? String(row.card_rarity) : null,
        photoPath,
        photoUrl: photoUrlFromPath(photoPath),
        quantity: qty,
        amount: qty,
        valuationNzd: row.valuation_nzd != null ? Number(row.valuation_nzd) : null,
        valuationSource: row.valuation_source,
        unitPriceNzd: unit,
        marketValueNzd: market,
        quoteAsOf: opts?.quoteAsOf ?? row.last_valuation_at ?? null,
        quoteNotes: opts?.quoteNotes ?? row.valuation_notes ?? null,
      };
    }
    default:
      return base;
  }
}

router.get('/', async (req, res) => {
  const db = await getDb();
  // Stored NZD spots and FX rates now; stale ones refresh in the background (readQuotes.ts).
  await quotesForRead(db, uid(req));
  const rows = queryAll(db, 'SELECT * FROM holdings WHERE user_id = ? ORDER BY asset_class, name', [uid(req)]);
  res.json(
    rows.map((row) => {
      if (row.asset_class === 'metal') {
        const spot = lookupMetalSpotNzd(db, row.metal as string);
        return mapHolding(row, { spotPerOzNzd: spot.price, spotAsOf: spot.asOf });
      }
      if (row.asset_class === 'stock') {
        const m = lookupAkahuMarketNzd(db, 'stock', row.symbol as string, row.shares as number);
        return mapHolding(row, m);
      }
      if (row.asset_class === 'crypto') {
        const m = lookupAkahuMarketNzd(db, 'crypto', row.asset as string, row.amount as number);
        return mapHolding(row, m);
      }
      if (row.asset_class === 'forex') {
        const m = lookupFxMarketNzd(db, row.asset as string, row.amount as number);
        return mapHolding(row, m);
      }
      return mapHolding(row);
    }),
  );
});

router.get('/:id', async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, 'SELECT * FROM holdings WHERE id = ? AND user_id = ?', [req.params.id, uid(req)]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.asset_class === 'metal') {
    const spot = lookupMetalSpotNzd(db, row.metal as string);
    return res.json(mapHolding(row, { spotPerOzNzd: spot.price, spotAsOf: spot.asOf }));
  }
  if (row.asset_class === 'stock') {
    const m = lookupAkahuMarketNzd(db, 'stock', row.symbol as string, row.shares as number);
    return res.json(mapHolding(row, m));
  }
  if (row.asset_class === 'crypto') {
    const m = lookupAkahuMarketNzd(db, 'crypto', row.asset as string, row.amount as number);
    return res.json(mapHolding(row, m));
  }
  if (row.asset_class === 'forex') {
    await quotesForRead(db, uid(req));
    const m = lookupFxMarketNzd(db, row.asset as string, row.amount as number);
    return res.json(mapHolding(row, m));
  }
  res.json(mapHolding(row));
});

router.post('/', async (req, res) => {
  const db = await getDb();
  const b = req.body ?? {};
  const id = newId('hld');
  const now = new Date().toISOString();
  const assetClass = b.assetClass as string;
  if (!assetClass) {
    return res.status(400).json({ error: 'assetClass required' });
  }

  // Manual stock/crypto: ticker required (symbol / asset). Prefill name from ticker when omitted.
  let name = typeof b.name === 'string' ? b.name.trim() : '';
  let symbol = b.symbol != null ? String(b.symbol).trim().toUpperCase() : null;
  let asset = b.asset != null ? String(b.asset).trim().toUpperCase() : null;
  // Accept `ticker` as alias for symbol/asset on stock/crypto.
  const tickerAlias =
    b.ticker != null ? String(b.ticker).trim().toUpperCase() : '';
  if (assetClass === 'stock') {
    symbol = symbol || tickerAlias || null;
    if (!symbol) {
      return res.status(400).json({ error: 'ticker (symbol) required for stock' });
    }
    if (!name) name = symbol;
  } else if (assetClass === 'crypto') {
    asset = asset || tickerAlias || null;
    if (!asset) {
      return res.status(400).json({ error: 'ticker (asset) required for crypto' });
    }
    if (!name) name = asset;
  } else if (assetClass === 'forex') {
    const currencyRaw =
      b.currency != null
        ? String(b.currency).trim().toUpperCase()
        : asset || tickerAlias || '';
    if (!/^[A-Z]{3}$/.test(currencyRaw)) {
      return res.status(400).json({ error: 'currency (ISO 4217, e.g. USD/EUR/GBP) required for forex' });
    }
    if (currencyRaw === 'NZD') {
      return res.status(400).json({
        error: 'Use a bank account for NZD cash — forex is for foreign currencies held outside bank (e.g. Revolut)',
      });
    }
    asset = currencyRaw;
    const srcLabel =
      b.source != null && String(b.source).trim()
        ? String(b.source).trim()
        : '';
    if (!name) name = srcLabel ? `${currencyRaw} (${srcLabel})` : currencyRaw;
    if (b.amount == null || !Number.isFinite(Number(b.amount)) || Number(b.amount) < 0) {
      return res.status(400).json({ error: 'amount (foreign currency units) required for forex' });
    }
  } else if (assetClass === 'art') {
    /* validated below in art block — name derived from artworkTitle */
  } else if (!name) {
    return res.status(400).json({ error: 'assetClass and name required' });
  }

  const source =
    b.source != null
      ? String(b.source)
      : assetClass === 'stock' || assetClass === 'crypto' || assetClass === 'forex'
        ? 'manual'
        : null;

  // Manual stock/crypto: if ticker already exists (non-Akahu), merge qty + weighted cost.
  if (assetClass === 'stock' && symbol) {
    const existing = findMergeTarget(db, 'stock', symbol, uid(req));
    if (existing) {
      const addShares = Number(b.shares ?? 0);
      if (!Number.isFinite(addShares) || addShares < 0) {
        return res.status(400).json({ error: 'shares must be a finite, non-negative number' });
      }
      const oldShares =
        existing.shares != null && Number.isFinite(Number(existing.shares))
          ? Number(existing.shares)
          : 0;
      const mergedShares = oldShares + addShares;
      const addCost = optionalNumber(b.costBasisNzd);
      const mergedCost = mergeCostBasisNzd(existing.cost_basis_nzd, addCost);
      const nowIso = now;
      const mergedName =
        typeof b.name === 'string' && b.name.trim() && b.name.trim() !== symbol
          ? b.name.trim()
          : (existing.name as string);
      const mergedNotes =
        b.notes != null && String(b.notes).trim()
          ? existing.notes
            ? `${existing.notes}\n${String(b.notes).trim()}`
            : String(b.notes).trim()
          : existing.notes;
      const mergedExchange =
        b.exchange != null && String(b.exchange).trim()
          ? String(b.exchange).trim()
          : existing.exchange;
      const mergedAcquired =
        b.acquiredAt != null
          ? b.acquiredAt
          : existing.acquired_at;
      run(
        db,
        `UPDATE holdings SET name=?, notes=?, cost_basis_nzd=?, acquired_at=?, updated_at=?,
          shares=?, exchange=?, source=COALESCE(source, ?)
         WHERE id=?`,
        [
          mergedName,
          mergedNotes ?? null,
          mergedCost,
          mergedAcquired ?? null,
          nowIso,
          mergedShares,
          mergedExchange ?? null,
          source ?? 'manual',
          existing.id,
        ],
      );
      const assetKey = `STOCK:${symbol}`;
      const quote = await getStockQuoteNzd(symbol, {
        exchange: mergedExchange != null ? String(mergedExchange) : null,
        force: false,
      });
      persistUnitQuote(db, assetKey, quote);
      const unit =
        (quote.status === 'ok' || quote.status === 'stale') && quote.price != null
          ? quote.price
          : null;
      const marketOpts = {
        unitPriceNzd: unit,
        marketValueNzd:
          unit != null && Number.isFinite(mergedShares) ? unit * mergedShares : null,
        quoteAsOf: quote.asOf,
        quoteNotes: quote.message ?? null,
      };
      const row = queryOne(db, 'SELECT * FROM holdings WHERE id = ?', [existing.id]);
      return res.status(200).json({
        ...mapHolding(row!, marketOpts),
        merged: true,
        addedShares: addShares,
        previousShares: oldShares,
      });
    }
  } else if (assetClass === 'crypto' && asset) {
    const existing = findMergeTarget(db, 'crypto', asset, uid(req));
    if (existing) {
      const addAmount = Number(b.amount ?? 0);
      if (!Number.isFinite(addAmount) || addAmount < 0) {
        return res.status(400).json({ error: 'amount must be a finite, non-negative number' });
      }
      const oldAmount =
        existing.amount != null && Number.isFinite(Number(existing.amount))
          ? Number(existing.amount)
          : 0;
      const mergedAmount = oldAmount + addAmount;
      const addCost = optionalNumber(b.costBasisNzd);
      const mergedCost = mergeCostBasisNzd(existing.cost_basis_nzd, addCost);
      const mergedName =
        typeof b.name === 'string' && b.name.trim() && b.name.trim() !== asset
          ? b.name.trim()
          : (existing.name as string);
      const mergedNotes =
        b.notes != null && String(b.notes).trim()
          ? existing.notes
            ? `${existing.notes}\n${String(b.notes).trim()}`
            : String(b.notes).trim()
          : existing.notes;
      const mergedAcquired =
        b.acquiredAt != null
          ? b.acquiredAt
          : existing.acquired_at;
      run(
        db,
        `UPDATE holdings SET name=?, notes=?, cost_basis_nzd=?, acquired_at=?, updated_at=?,
          amount=?, source=COALESCE(source, ?)
         WHERE id=?`,
        [
          mergedName,
          mergedNotes ?? null,
          mergedCost,
          mergedAcquired ?? null,
          now,
          mergedAmount,
          source ?? 'manual',
          existing.id,
        ],
      );
      const resolved = await resolveCryptoTicker(asset, false);
      persistUnitQuote(db, resolved.quote.assetKey, resolved.quote);
      const unit = resolved.quote.status === 'ok' ? resolved.quote.price : null;
      const marketOpts = {
        unitPriceNzd: unit,
        marketValueNzd:
          unit != null && Number.isFinite(mergedAmount) ? unit * mergedAmount : null,
        quoteAsOf: resolved.quote.asOf,
        quoteNotes: resolved.quote.message ?? null,
      };
      if (resolved.name && resolved.name !== asset && mergedName === asset) {
        run(db, 'UPDATE holdings SET name=? WHERE id=?', [resolved.name, existing.id]);
      }
      const row = queryOne(db, 'SELECT * FROM holdings WHERE id = ?', [existing.id]);
      return res.status(200).json({
        ...mapHolding(row!, marketOpts),
        merged: true,
        addedAmount: addAmount,
        previousAmount: oldAmount,
      });
    }
  }


  // Art: fractional (Masterworks-style) or physical — manual only, never invent / no API
  let artKind: 'fractional' | 'physical' | null = null;
  let artOwnershipPct: number | null = null;
  let artPurchasePriceNzd: number | null = null;
  let artPurchaseDate: string | null = null;
  let artLastValuationNzd: number | null = null;
  let artLastValuationAt: string | null = null;
  let artTitle: string | null = null;
  let artArtist: string | null = null;
  let artValSource: string | null = null;
  let artValNotes: string | null = null;
  let artPhotoPath: string | null = null;
  let artCostBasisNzd: number | null = null;
  if (assetClass === 'art') {
    const kindRaw = String(b.artKind ?? b.kind ?? 'fractional').trim().toLowerCase();
    if (kindRaw !== 'fractional' && kindRaw !== 'physical') {
      return res.status(400).json({ error: "artKind must be 'fractional' or 'physical'" });
    }
    artKind = kindRaw as 'fractional' | 'physical';
    artTitle =
      b.artworkTitle != null
        ? String(b.artworkTitle).trim() || null
        : b.title != null
          ? String(b.title).trim() || null
          : null;
    artArtist = b.artist != null ? String(b.artist).trim() || null : null;
    if (!artTitle && !name) {
      return res.status(400).json({ error: 'artworkTitle (or name) required for art' });
    }
    if (!name) {
      name = artTitle
        ? artArtist
          ? `${artTitle} — ${artArtist}`
          : artTitle
        : 'Art';
    }
    if (!artTitle) artTitle = name;

    if (artKind === 'fractional') {
      artOwnershipPct = optionalNumber(b.ownershipPct);
      if (artOwnershipPct == null || artOwnershipPct <= 0 || artOwnershipPct > 100) {
        return res.status(400).json({
          error: 'ownershipPct (0–100, exclusive of 0) required for fractional art',
        });
      }
      artPurchasePriceNzd = optionalNumber(b.purchasePriceNzd);
      if (artPurchasePriceNzd == null || artPurchasePriceNzd < 0) {
        return res.status(400).json({
          error: 'purchasePriceNzd required for fractional art (manual — never invent)',
        });
      }
      artPurchaseDate =
        b.purchaseDate != null && String(b.purchaseDate).trim()
          ? String(b.purchaseDate).trim()
          : b.acquiredAt != null && String(b.acquiredAt).trim()
            ? String(b.acquiredAt).trim()
            : null;
      if (!artPurchaseDate) {
        return res.status(400).json({ error: 'purchaseDate required for fractional art' });
      }
      artLastValuationNzd = optionalNumber(b.lastValuationNzd ?? b.valuationNzd);
      if (artLastValuationNzd != null) {
        if (artLastValuationNzd < 0) {
          return res.status(400).json({ error: 'lastValuationNzd must be ≥ 0' });
        }
        artLastValuationAt = now;
        artValSource = 'user_valuation';
        artValNotes =
          b.valuationNotes != null && String(b.valuationNotes).trim()
            ? String(b.valuationNotes).trim()
            : 'Manual valuation (e.g. from Masterworks UI — no live API)';
      }
      artCostBasisNzd = optionalNumber(b.costBasisNzd) ?? artPurchasePriceNzd;
    } else {
      // physical — appraisal required; ownership 100%; optional cost/purchase
      artOwnershipPct = optionalNumber(b.ownershipPct) ?? 100;
      if (artOwnershipPct <= 0 || artOwnershipPct > 100) {
        return res.status(400).json({ error: 'ownershipPct must be 0–100 for physical art' });
      }
      const appraisal = optionalNumber(
        b.appraisalNzd ?? b.lastValuationNzd ?? b.valuationNzd,
      );
      if (appraisal == null || appraisal < 0) {
        return res.status(400).json({
          error: 'appraisalNzd (manual appraised value NZD) required for physical art',
        });
      }
      artLastValuationNzd = appraisal;
      artLastValuationAt = now;
      artValSource = 'user_valuation';
      artValNotes =
        b.valuationNotes != null && String(b.valuationNotes).trim()
          ? String(b.valuationNotes).trim()
          : 'User appraisal (manual — never invented)';
      artPurchasePriceNzd = optionalNumber(b.purchasePriceNzd ?? b.costBasisNzd);
      if (artPurchasePriceNzd != null && artPurchasePriceNzd < 0) {
        return res.status(400).json({ error: 'purchasePriceNzd must be ≥ 0' });
      }
      artPurchaseDate =
        b.purchaseDate != null && String(b.purchaseDate).trim()
          ? String(b.purchaseDate).trim()
          : b.acquiredAt != null && String(b.acquiredAt).trim()
            ? String(b.acquiredAt).trim()
            : null;
      artCostBasisNzd =
        optionalNumber(b.costBasisNzd) ?? artPurchasePriceNzd ?? null;
    }
  }

  // Real estate: require manual property value NZD (never invent)
  let propertyValueNzd: number | null = null;
  let mortgageOutstandingNzd: number | null = null;
  let photoPath: string | null = null;
  if (assetClass === 'real_estate') {
    propertyValueNzd = optionalNumber(b.propertyValueNzd ?? b.valuationNzd);
    if (propertyValueNzd == null || propertyValueNzd < 0) {
      return res.status(400).json({ error: 'propertyValueNzd (market/owned value NZD) required for real estate' });
    }
    mortgageOutstandingNzd = optionalNumber(b.mortgageOutstandingNzd) ?? 0;
    if (mortgageOutstandingNzd < 0) {
      return res.status(400).json({ error: 'mortgageOutstandingNzd must be ≥ 0' });
    }
    if (!name) name = 'Property';
  }

  // Collectables: resolve live card quote (Scryfall / pokemontcg.io) — never invent
  let cardGame: string | null = null;
  let cardSet: string | null = null;
  let cardNumber: string | null = null;
  let cardFinish: string | null = null;
  let cardApiId: string | null = null;
  let cardImageUrl: string | null = null;
  let cardColours: string | null = null;
  let cardRarity: string | null = null;
  let collectableQty = 1;
  let collectableValuation: number | null = null;
  let collectableValSource: string | null = null;
  let collectableValNotes: string | null = null;
  let collectableUnitNzd: number | null = null;
  let collectableQuoteAsOf: string | null = null;
  let collectablePhotoPath: string | null = null;
  if (assetClass === 'collectable') {
    cardGame = parseCardGame(b.cardGame ?? b.game) ?? (b.kind === 'manual' || b.manual ? 'other' : null);
    if (!cardGame) {
      return res.status(400).json({ error: 'cardGame required (mtg | pokemon | other | custom type slug)' });
    }
    const qRaw = b.quantity ?? b.amount ?? 1;
    collectableQty = Number(qRaw);
    if (!Number.isFinite(collectableQty) || collectableQty <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive number' });
    }

    if (isManualCollectableGame(cardGame)) {
      // Non-card collectable: manual appraised NZD only (never invent)
      if (!name) {
        return res.status(400).json({ error: 'name required for non-card collectables' });
      }
      const appraisal = optionalNumber(b.appraisalNzd ?? b.valuationNzd ?? b.estimatedValueNzd);
      if (appraisal == null || appraisal < 0) {
        return res.status(400).json({ error: 'appraisalNzd (manual appraised value NZD) required for non-card collectables' });
      }
      collectableValuation = appraisal;
      collectableValSource = 'user_valuation';
      collectableValNotes = 'Manual appraisal (never invented)';
      collectableUnitNzd = collectableQty > 0 ? appraisal / collectableQty : appraisal;
      collectableQuoteAsOf = now;
      cardFinish = null;
      cardSet = null;
      cardNumber = null;
      cardApiId = null;
      cardImageUrl = null;
      cardColours = null;
      cardRarity = null;
    } else {
      cardSet = b.cardSet != null ? String(b.cardSet).trim() || null : b.set != null ? String(b.set).trim() || null : null;
      cardNumber =
        b.cardNumber != null
          ? String(b.cardNumber).trim() || null
          : b.number != null
            ? String(b.number).trim() || null
            : null;
      cardFinish =
        b.cardFinish != null
          ? String(b.cardFinish).trim() || null
          : b.finish != null
            ? String(b.finish).trim() || null
            : cardGame === 'mtg'
              ? 'nonfoil'
              : 'holofoil';
      cardApiId = b.cardApiId != null ? String(b.cardApiId).trim() || null : b.apiId != null ? String(b.apiId).trim() || null : null;

      if (!name && !cardApiId && !(cardSet && cardNumber)) {
        return res.status(400).json({
          error: 'name, set+number, or cardApiId required for card collectables',
        });
      }
      {
        const quoted = await quoteCard({
          game: cardGame as 'mtg' | 'pokemon',
          name: name || null,
          set: cardSet,
          number: cardNumber,
          finish: cardFinish,
          apiId: cardApiId,
        });
        if (quoted.name) name = quoted.name;
        cardSet = quoted.set ?? cardSet;
        cardNumber = quoted.number ?? cardNumber;
        cardFinish = quoted.finish ?? cardFinish;
        cardApiId = quoted.apiId ?? cardApiId;
        cardImageUrl = quoted.imageUrl;
        cardColours = coloursToStorage(quoted.colours);
        cardRarity = quoted.rarity ?? normalizeCardRarity(b.rarity ?? b.cardRarity) ?? null;
        collectableUnitNzd = quoted.status === 'ok' ? quoted.unitNzd : null;
        collectableQuoteAsOf = quoted.asOf;
        collectableValNotes = quoted.message;
        if (quoted.status === 'ok' && quoted.unitNzd != null) {
          collectableValuation = quoted.unitNzd * collectableQty;
          collectableValSource = quoted.source;
        } else {
          collectableValuation = null;
          collectableValSource = null;
        }
        if (quoted.assetKey && quoted.status === 'ok') {
          persistUnitQuote(db, quoted.assetKey, {
            currency: 'NZD',
            price: quoted.unitNzd,
            status: 'ok',
            source: quoted.source,
            asOf: quoted.asOf,
            message: quoted.message,
          });
        }
      }
    }
  }

  // Precious stones: diamonds via OpenFacet; other gems manual NZD only — never invent
  let stoneType: string | null = null;
  let stoneCarat: number | null = null;
  let stoneClarity: string | null = null;
  let stoneCut: string | null = null;
  let stoneColour: string | null = null;
  let stoneValuation: number | null = null;
  let stoneValSource: string | null = null;
  let stoneValNotes: string | null = null;
  let stoneLastValAt: string | null = null;
  let stoneQuoteAssetKey: string | null = null;
  if (assetClass === 'stone') {
    stoneType = b.stoneType != null ? String(b.stoneType).trim() : '';
    if (!stoneType) {
      return res.status(400).json({ error: 'stoneType required (Diamond, Ruby, Sapphire, Emerald, Other…)' });
    }
    stoneCarat = Number(b.carat);
    if (!Number.isFinite(stoneCarat) || stoneCarat <= 0) {
      return res.status(400).json({ error: 'carat must be a positive number' });
    }
    if (!name) {
      name = `${stoneType.charAt(0).toUpperCase()}${stoneType.slice(1)} ${stoneCarat}ct`;
    }
    const manualNzd = optionalNumber(b.valuationNzd ?? b.estimatedValueNzd);
    if (isDiamondStoneType(stoneType)) {
      const colour = normalizeDiamondColour(String(b.colour ?? b.color ?? ''));
      const clarity = normalizeDiamondClarity(String(b.clarity ?? ''));
      if (!colour) {
        return res.status(400).json({
          error: 'colour required for diamonds (D–M)',
        });
      }
      if (!clarity) {
        return res.status(400).json({
          error: 'clarity required for diamonds (FL|IF|VVS1|VVS2|VS1|VS2|SI1|SI2)',
        });
      }
      const shape = normalizeDiamondShape(
        b.cut != null ? String(b.cut) : b.shape != null ? String(b.shape) : 'round',
      );
      stoneColour = colour;
      stoneClarity = clarity;
      stoneCut = shape;
      stoneQuoteAssetKey = stoneAssetKey({
        carat: stoneCarat,
        colour,
        clarity,
        shape,
      });
      const quote = await quoteDiamondOpenFacet(
        { carat: stoneCarat, colour, clarity, shape },
        true,
      );
      if (quote.status === 'ok' && quote.price != null) {
        stoneValuation = quote.price;
        stoneValSource = quote.source;
        stoneValNotes = quote.message ?? null;
        stoneLastValAt = quote.asOf ?? now;
        persistUnitQuote(db, stoneQuoteAssetKey, quote);
      } else if (manualNzd != null && manualNzd >= 0) {
        stoneValuation = manualNzd;
        stoneValSource = 'user_valuation';
        stoneValNotes =
          `Manual estimate NZD (OpenFacet unavailable: ${quote.message ?? 'no quote'})`;
        stoneLastValAt = now;
        persistUnitQuote(db, stoneQuoteAssetKey, quote);
      } else {
        stoneValuation = null;
        stoneValSource = quote.source;
        stoneValNotes =
          quote.message ??
          'OpenFacet/FX unavailable — valuation left null (never invent). Optional: pass valuationNzd as manual fallback.';
        stoneLastValAt = null;
        persistUnitQuote(db, stoneQuoteAssetKey, quote);
      }
    } else {
      // Non-diamond: require manual estimated NZD
      if (manualNzd == null || manualNzd < 0) {
        return res.status(400).json({
          error:
            'valuationNzd (manual estimated value NZD) required for non-diamond stones — no live gem API',
        });
      }
      stoneColour = b.colour != null ? String(b.colour).trim() || null : b.color != null ? String(b.color).trim() || null : null;
      stoneClarity = b.clarity != null ? String(b.clarity).trim() || null : null;
      stoneCut = b.cut != null ? String(b.cut).trim() || null : b.shape != null ? String(b.shape).trim() || null : null;
      stoneValuation = manualNzd;
      stoneValSource = 'user_valuation';
      stoneValNotes = 'Manual estimate — live quotes are diamond-only (OpenFacet); never invented';
      stoneLastValAt = now;
    }
  }

  run(
    db,
    `INSERT INTO holdings (
      id, user_id, asset_class, name, notes, cost_basis_nzd, acquired_at, created_at, updated_at,
      symbol, shares, exchange,
      asset, amount,
      miner_name, miner_external_id, hashrate_ths, energy_efficiency_wth, rarity, level,
      estimated_value_nzd, estimated_value_at, estimated_value_source,
      ownership_pct, purchase_price_nzd, purchase_date, last_valuation_nzd, last_valuation_at,
      artwork_title, artist,
      metal, metal_amount, metal_unit,
      stone_type, carat, clarity, cut, colour, length_mm, width_mm, depth_mm,
      valuation_nzd, valuation_source, valuation_notes,
      property_value_nzd, mortgage_outstanding_nzd, photo_path,
      card_game, card_set, card_number, card_finish, card_api_id, card_image_url,
      card_colours, card_rarity,
      source, external_id
    ) VALUES (
      ?,?,?,?,?,?,?,?,?,
      ?,?,?,
      ?,?,
      ?,?,?,?,?,?,
      ?,?,?,
      ?,?,?,?,?,
      ?,?,
      ?,?,?,
      ?,?,?,?,?,?,?,?,
      ?,?,?,
      ?,?,?,
      ?,?,?,?,?,?,
      ?,?,
      ?,?
    )`,
    [
      id, uid(req), assetClass, name, b.notes ?? null,
      assetClass === 'art' ? artCostBasisNzd : optionalNumber(b.costBasisNzd),
      assetClass === 'art'
        ? (artPurchaseDate ?? b.acquiredAt ?? null)
        : (b.acquiredAt ?? null),
      now, now,
      symbol, b.shares ?? null, b.exchange ?? null,
      asset,
      assetClass === 'collectable' ? collectableQty : b.amount ?? null,
      b.minerName ?? name ?? null, b.minerExternalId ?? null, b.hashrateThs ?? null, b.energyEfficiencyWth ?? null, b.rarity ?? null, b.level ?? null,
      b.estimatedValueNzd ?? null, b.estimatedValueNzd != null ? now : null, b.estimatedValueNzd != null ? 'manual' : null,
      assetClass === 'art' ? artOwnershipPct : b.ownershipPct ?? null,
      assetClass === 'art' ? artPurchasePriceNzd : b.purchasePriceNzd ?? null,
      assetClass === 'art' ? artPurchaseDate : b.purchaseDate ?? null,
      assetClass === 'art'
        ? artLastValuationNzd
        : assetClass === 'stone'
          ? stoneValuation
          : b.lastValuationNzd ?? null,
      assetClass === 'art'
        ? artLastValuationAt
        : assetClass === 'stone'
          ? stoneLastValAt
          : b.lastValuationAt ?? null,
      assetClass === 'art' ? artTitle : b.artworkTitle ?? null,
      assetClass === 'art' ? artArtist : b.artist ?? null,
      b.metal ?? null, b.amount ?? b.metalAmount ?? null, b.unit ?? b.metalUnit ?? null,
      assetClass === 'stone' ? stoneType : b.stoneType ?? null,
      assetClass === 'stone' ? stoneCarat : b.carat ?? null,
      assetClass === 'stone' ? stoneClarity : b.clarity ?? null,
      assetClass === 'stone' ? stoneCut : b.cut ?? null,
      assetClass === 'stone' ? stoneColour : b.colour ?? null,
      b.lengthMm ?? null, b.widthMm ?? null, b.depthMm ?? null,
      assetClass === 'collectable'
        ? collectableValuation
        : assetClass === 'stone'
          ? stoneValuation
          : b.valuationNzd ?? null,
      assetClass === 'art'
        ? artValSource
        : assetClass === 'collectable'
          ? collectableValSource
          : assetClass === 'stone'
            ? stoneValSource
            : b.valuationSource ?? null,
      assetClass === 'art'
        ? artValNotes
        : assetClass === 'collectable'
          ? collectableValNotes
          : assetClass === 'stone'
            ? stoneValNotes
            : b.valuationNotes ?? null,
      propertyValueNzd, mortgageOutstandingNzd, null,
      cardGame, cardSet, cardNumber, cardFinish, cardApiId, cardImageUrl,
      cardColours, cardRarity,
      source, b.externalId ?? null,
    ],
  );

  if (assetClass === 'art' && artKind) {
    run(db, 'UPDATE holdings SET art_kind=? WHERE id=?', [artKind, id]);
  }

  // Optional property photo (base64 / data URL) stored under data/uploads/properties/
  if (assetClass === 'real_estate' && b.photoBase64) {
    try {
      photoPath = savePropertyPhoto(id, String(b.photoBase64));
      run(db, 'UPDATE holdings SET photo_path=? WHERE id=?', [photoPath, id]);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }
  // Manual (non-card) collectable photo only — cards use API art, not user photo pricing
  if (assetClass === 'collectable' && isManualCollectableGame(cardGame) && b.photoBase64) {
    try {
      collectablePhotoPath = saveCollectablePhoto(id, String(b.photoBase64));
      run(db, 'UPDATE holdings SET photo_path=? WHERE id=?', [collectablePhotoPath, id]);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }
  // Physical art photo → data/uploads/art/
  if (assetClass === 'art' && artKind === 'physical' && b.photoBase64) {
    try {
      artPhotoPath = saveArtPhoto(id, String(b.photoBase64));
      run(db, 'UPDATE holdings SET photo_path=? WHERE id=?', [artPhotoPath, id]);
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }


  // Prefill quote for manual crypto via CoinGecko when available (never invent).
  let marketOpts:
    | {
        marketValueNzd: number | null;
        unitPriceNzd: number | null;
        quoteAsOf: string | null;
        quoteNotes: string | null;
      }
    | undefined;
  if (assetClass === 'crypto' && asset) {
    // Prefer cached NZD on add (blur/resolve already warmed cache); never invent.
    const resolved = await resolveCryptoTicker(asset, false);
    persistUnitQuote(db, resolved.quote.assetKey, resolved.quote);
    const qty = b.amount != null ? Number(b.amount) : null;
    const unit = resolved.quote.status === 'ok' ? resolved.quote.price : null;
    marketOpts = {
      unitPriceNzd: unit,
      marketValueNzd:
        unit != null && qty != null && Number.isFinite(qty) ? unit * qty : null,
      quoteAsOf: resolved.quote.asOf,
      quoteNotes: resolved.quote.message ?? null,
    };
    // Prefer resolved display name when caller left name = ticker
    if (resolved.name && resolved.name !== asset && name === asset) {
      run(db, 'UPDATE holdings SET name=? WHERE id=?', [resolved.name, id]);
    }
  } else if (assetClass === 'stock' && symbol) {
    // Yahoo live × FX → NZD (never invent). Prefill name when still = ticker.
    const assetKey = `STOCK:${symbol}`;
    const exchange =
      b.exchange != null && String(b.exchange).trim()
        ? String(b.exchange).trim()
        : null;
    const resolved = await resolveStockTicker(symbol, { exchange, force: false });
    persistUnitQuote(db, assetKey, resolved.quote);
    const qty = b.shares != null ? Number(b.shares) : null;
    const unit =
      (resolved.quote.status === 'ok' || resolved.quote.status === 'stale') &&
      resolved.quote.price != null
        ? resolved.quote.price
        : null;
    marketOpts = {
      unitPriceNzd: unit,
      marketValueNzd:
        unit != null && qty != null && Number.isFinite(qty) ? unit * qty : null,
      quoteAsOf: resolved.quote.asOf,
      quoteNotes: resolved.quote.message ?? null,
    };
    if (resolved.name && resolved.name !== symbol && name === symbol) {
      run(db, 'UPDATE holdings SET name=? WHERE id=?', [resolved.name, id]);
    }
  } else if (assetClass === 'forex' && asset) {
    const refreshed = await refreshForexCurrency(db, asset, true);
    const qty = b.amount != null ? Number(b.amount) : null;
    const unit = refreshed.status === 'ok' ? refreshed.rate : null;
    marketOpts = {
      unitPriceNzd: unit,
      marketValueNzd:
        unit != null && qty != null && Number.isFinite(qty) ? unit * qty : null,
      quoteAsOf: refreshed.asOf,
      quoteNotes: refreshed.message ?? null,
    };
  }

  const row = queryOne(db, 'SELECT * FROM holdings WHERE id = ? AND user_id = ?', [id, uid(req)]);
  if (assetClass === 'stock' || assetClass === 'crypto' || assetClass === 'forex') {
    return res.status(201).json(mapHolding(row!, marketOpts));
  }
  if (assetClass === 'collectable') {
    return res.status(201).json(
      mapHolding(row!, {
        unitPriceNzd: collectableUnitNzd,
        marketValueNzd: collectableValuation,
        quoteAsOf: collectableQuoteAsOf,
        quoteNotes: collectableValNotes,
      }),
    );
  }
  res.status(201).json(mapHolding(row!));
});

router.patch('/:id', async (req, res) => {
  const db = await getDb();
  const existing = queryOne(db, 'SELECT * FROM holdings WHERE id = ? AND user_id = ?', [req.params.id, uid(req)]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const b = req.body ?? {};
  const now = new Date().toISOString();
  const name = b.name ?? existing.name;
  const notes = b.notes !== undefined ? b.notes : existing.notes;
  const cost = b.costBasisNzd !== undefined ? optionalNumber(b.costBasisNzd) : existing.cost_basis_nzd;
  const acquired = b.acquiredAt !== undefined ? b.acquiredAt : existing.acquired_at;

  // Quantity edits are intentionally limited to the matching holding subtype.
  // Keep them as finite, non-negative numbers so refreshed market values remain valid.
  const parseQuantity = (value: unknown): number | null => {
    if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  if (existing.asset_class === 'gomining_miner') {
    const est = b.estimatedValueNzd !== undefined ? b.estimatedValueNzd : existing.estimated_value_nzd;
    const estAt =
      b.estimatedValueNzd !== undefined
        ? b.estimatedValueNzd != null
          ? now
          : null
        : existing.estimated_value_at;
    const estSrc =
      b.estimatedValueNzd !== undefined
        ? b.estimatedValueNzd != null
          ? (b.estimatedValueSource ?? 'manual')
          : null
        : existing.estimated_value_source;
    run(
      db,
      `UPDATE holdings SET name=?, notes=?, cost_basis_nzd=?, acquired_at=?, updated_at=?,
        miner_name=?, miner_external_id=?, hashrate_ths=?, energy_efficiency_wth=?, rarity=?, level=?,
        estimated_value_nzd=?, estimated_value_at=?, estimated_value_source=?
       WHERE id=?`,
      [
        name, notes, cost, acquired, now,
        b.minerName ?? existing.miner_name, b.minerExternalId !== undefined ? b.minerExternalId : existing.miner_external_id,
        b.hashrateThs ?? existing.hashrate_ths,
        b.energyEfficiencyWth !== undefined ? b.energyEfficiencyWth : existing.energy_efficiency_wth,
        b.rarity !== undefined ? b.rarity : existing.rarity,
        b.level !== undefined ? b.level : existing.level,
        est, estAt, estSrc, req.params.id,
      ],
    );
  } else if (existing.asset_class === 'stock') {
    let shares = existing.shares;
    if (b.shares !== undefined) {
      shares = parseQuantity(b.shares);
      if (shares == null) {
        return res.status(400).json({ error: 'shares must be a finite, non-negative number' });
      }
    }
    run(
      db,
      `UPDATE holdings SET name=?, notes=?, cost_basis_nzd=?, acquired_at=?, updated_at=?, shares=? WHERE id=?`,
      [name, notes, cost, acquired, now, shares, req.params.id],
    );
  } else if (existing.asset_class === 'crypto') {
    let amount = existing.amount;
    if (b.amount !== undefined) {
      amount = parseQuantity(b.amount);
      if (amount == null) {
        return res.status(400).json({ error: 'amount must be a finite, non-negative number' });
      }
    }
    run(
      db,
      `UPDATE holdings SET name=?, notes=?, cost_basis_nzd=?, acquired_at=?, updated_at=?, amount=? WHERE id=?`,
      [name, notes, cost, acquired, now, amount, req.params.id],
    );
  } else if (existing.asset_class === 'forex') {
    let amount = existing.amount;
    if (b.amount !== undefined) {
      amount = parseQuantity(b.amount);
      if (amount == null) {
        return res.status(400).json({ error: 'amount must be a finite, non-negative number' });
      }
    }
    const src =
      b.source !== undefined
        ? (b.source != null && String(b.source).trim() ? String(b.source).trim() : null)
        : existing.source;
    run(
      db,
      `UPDATE holdings SET name=?, notes=?, cost_basis_nzd=?, acquired_at=?, updated_at=?, amount=?, source=? WHERE id=?`,
      [name, notes, cost, acquired, now, amount, src, req.params.id],
    );
  } else if (existing.asset_class === 'real_estate') {
    const pv =
      b.propertyValueNzd !== undefined
        ? optionalNumber(b.propertyValueNzd)
        : existing.property_value_nzd;
    if (pv == null || Number(pv) < 0) {
      return res.status(400).json({ error: 'propertyValueNzd must be ≥ 0' });
    }
    const mort =
      b.mortgageOutstandingNzd !== undefined
        ? optionalNumber(b.mortgageOutstandingNzd) ?? 0
        : existing.mortgage_outstanding_nzd ?? 0;
    if (Number(mort) < 0) {
      return res.status(400).json({ error: 'mortgageOutstandingNzd must be ≥ 0' });
    }
    let photoPath = existing.photo_path;
    if (b.photoBase64) {
      try {
        photoPath = savePropertyPhoto(String(req.params.id), String(b.photoBase64));
      } catch (err) {
        return res.status(400).json({ error: (err as Error).message });
      }
    } else if (b.clearPhoto === true) {
      deletePropertyPhoto(existing.photo_path as string | null);
      photoPath = null;
    }
    run(
      db,
      `UPDATE holdings SET name=?, notes=?, cost_basis_nzd=?, acquired_at=?, updated_at=?,
        property_value_nzd=?, mortgage_outstanding_nzd=?, photo_path=?
       WHERE id=?`,
      [name, notes, cost, acquired, now, pv, mort, photoPath ?? null, req.params.id],
    );
  } else if (existing.asset_class === 'art') {
    // Manual appraisal / valuation only — never invent. Stamp last_valuation_at on change.
    let ownershipPct =
      existing.ownership_pct != null ? Number(existing.ownership_pct) : null;
    if (b.ownershipPct !== undefined) {
      const pct = optionalNumber(b.ownershipPct);
      if (pct == null || pct <= 0 || pct > 100) {
        return res.status(400).json({ error: 'ownershipPct must be > 0 and ≤ 100' });
      }
      ownershipPct = pct;
    }
    let purchasePrice =
      existing.purchase_price_nzd != null ? Number(existing.purchase_price_nzd) : null;
    if (b.purchasePriceNzd !== undefined) {
      purchasePrice = optionalNumber(b.purchasePriceNzd);
      if (purchasePrice != null && purchasePrice < 0) {
        return res.status(400).json({ error: 'purchasePriceNzd must be ≥ 0' });
      }
    }
    let purchaseDate =
      b.purchaseDate !== undefined
        ? b.purchaseDate != null && String(b.purchaseDate).trim()
          ? String(b.purchaseDate).trim()
          : null
        : existing.purchase_date;
    let lastVal =
      existing.last_valuation_nzd != null ? Number(existing.last_valuation_nzd) : null;
    let lastValAt = existing.last_valuation_at as string | null;
    let valSource = existing.valuation_source as string | null;
    let valNotes = existing.valuation_notes as string | null;
    const appraisalIn =
      b.lastValuationNzd !== undefined
        ? b.lastValuationNzd
        : b.appraisalNzd !== undefined
          ? b.appraisalNzd
          : undefined;
    if (appraisalIn !== undefined) {
      if (appraisalIn === null || (typeof appraisalIn === 'string' && appraisalIn.trim() === '')) {
        lastVal = null;
        lastValAt = null;
        valSource = null;
        valNotes = null;
      } else {
        const v = optionalNumber(appraisalIn);
        if (v == null || v < 0) {
          return res.status(400).json({
            error: 'lastValuationNzd / appraisalNzd must be ≥ 0 (manual — never invent)',
          });
        }
        lastVal = v;
        lastValAt = now;
        valSource = 'user_valuation';
        valNotes =
          b.valuationNotes != null && String(b.valuationNotes).trim()
            ? String(b.valuationNotes).trim()
            : existing.art_kind === 'physical' || String(existing.art_kind) === 'physical'
              ? 'User appraisal (manual — never invented)'
              : 'Manual valuation (never invented)';
      }
    } else if (b.valuationNotes !== undefined) {
      valNotes =
        b.valuationNotes != null && String(b.valuationNotes).trim()
          ? String(b.valuationNotes).trim()
          : null;
    }
    const artworkTitle =
      b.artworkTitle !== undefined
        ? String(b.artworkTitle).trim() || null
        : existing.artwork_title;
    const artist =
      b.artist !== undefined
        ? b.artist != null && String(b.artist).trim()
          ? String(b.artist).trim()
          : null
        : existing.artist;
    let artKind = existing.art_kind;
    if (b.artKind !== undefined) {
      const k = String(b.artKind).trim().toLowerCase();
      if (k !== 'fractional' && k !== 'physical') {
        return res.status(400).json({ error: "artKind must be 'fractional' or 'physical'" });
      }
      artKind = k;
    }
    let photoPath = existing.photo_path;
    if (b.photoBase64) {
      try {
        photoPath = saveArtPhoto(String(req.params.id), String(b.photoBase64));
      } catch (err) {
        return res.status(400).json({ error: (err as Error).message });
      }
    } else if (b.clearPhoto === true) {
      deletePropertyPhoto(existing.photo_path as string | null);
      photoPath = null;
    }
    const nextCost =
      b.costBasisNzd !== undefined
        ? cost
        : purchasePrice != null
          ? (existing.cost_basis_nzd ?? purchasePrice)
          : cost;
    run(
      db,
      `UPDATE holdings SET name=?, notes=?, cost_basis_nzd=?, acquired_at=?, updated_at=?,
        art_kind=?, ownership_pct=?, purchase_price_nzd=?, purchase_date=?,
        last_valuation_nzd=?, last_valuation_at=?, artwork_title=?, artist=?,
        valuation_source=?, valuation_notes=?, photo_path=?
       WHERE id=?`,
      [
        name,
        notes,
        nextCost,
        purchaseDate ?? acquired,
        now,
        artKind ?? null,
        ownershipPct,
        purchasePrice,
        purchaseDate,
        lastVal,
        lastValAt,
        artworkTitle,
        artist,
        valSource,
        valNotes,
        photoPath ?? null,
        req.params.id,
      ],
    );
  } else if (existing.asset_class === 'collectable') {
    let amount = existing.amount;
    if (b.quantity !== undefined || b.amount !== undefined) {
      amount = parseQuantity(b.quantity ?? b.amount);
      if (amount == null || amount <= 0) {
        return res.status(400).json({ error: 'quantity must be a positive number' });
      }
    }
    run(
      db,
      `UPDATE holdings SET name=?, notes=?, cost_basis_nzd=?, acquired_at=?, updated_at=?, amount=? WHERE id=?`,
      [name, notes, cost, acquired, now, amount, req.params.id],
    );
    // Recompute valuation from unit quote if we have valuation_nzd previously
    const refreshed = queryOne(db, 'SELECT * FROM holdings WHERE id = ? AND user_id = ?', [req.params.id, uid(req)]);
    if (refreshed && refreshed.valuation_nzd != null && refreshed.amount != null) {
      // Keep total in sync only when unit was known via refresh; skip inventing
    }
  } else {
    run(
      db,
      `UPDATE holdings SET name=?, notes=?, cost_basis_nzd=?, acquired_at=?, updated_at=? WHERE id=?`,
      [name, notes, cost, acquired, now, req.params.id],
    );
  }
  const row = queryOne(db, 'SELECT * FROM holdings WHERE id = ? AND user_id = ?', [req.params.id, uid(req)]);
  if (row?.asset_class === 'forex') {
    const m = lookupFxMarketNzd(db, row.asset as string, row.amount as number);
    return res.json(mapHolding(row, m));
  }
  if (row?.asset_class === 'stock') {
    const m = lookupAkahuMarketNzd(db, 'stock', row.symbol as string, row.shares as number);
    return res.json(mapHolding(row, m));
  }
  if (row?.asset_class === 'crypto') {
    const m = lookupAkahuMarketNzd(db, 'crypto', row.asset as string, row.amount as number);
    return res.json(mapHolding(row, m));
  }
  res.json(mapHolding(row!));
});

router.delete('/:id', async (req, res) => {
  const db = await getDb();
  const userId = uid(req);
  const holdingId = String(req.params.id);
  const row = queryOne<{ photo_path?: string | null }>(
    db,
    'SELECT photo_path FROM holdings WHERE id = ? AND user_id = ?',
    [holdingId, userId],
  );
  if (!row) {
    res.status(204).end();
    return;
  }
  if (row.photo_path) deletePropertyPhoto(row.photo_path);
  unlinkDividendsForHolding(db, userId, holdingId);
  run(db, 'DELETE FROM holdings WHERE id = ? AND user_id = ?', [holdingId, userId]);
  res.status(204).end();
});





/** Prefer Scryfall colour/rarity; only fill DB when the column is still null. */
function coalesceCardMeta(
  existing: unknown,
  fromQuote: string | null,
  fromCsv: string | null = null,
): string | null {
  if (existing != null) return String(existing);
  if (fromQuote != null) return fromQuote;
  if (fromCsv != null) return fromCsv;
  return null;
}

/**
 * Parse collectables CSV. Both the original compact format and ManaBox exports
 * are accepted. Header matching is case-insensitive and tolerant of spaces,
 * hyphens, and underscores.
 */
function parseCollectablesCsv(text: string): Array<Record<string, string>> {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length < 2) return [];

  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = !inQ;
        }
      } else if (ch === ',' && !inQ) {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const normalizeHeader = (header: string): string =>
    header
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  const headers = split(lines[0]).map(normalizeHeader);
  const rows: Array<Record<string, string>> = [];
  for (const line of lines.slice(1)) {
    const cols = split(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function csvValue(row: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value != null && value.trim() !== '') return value.trim();
  }
  return '';
}

/** Parse a CSV money value, accepting commas, currency symbols, and brackets. */
function parseCsvMoney(raw: string): number | null {
  let value = raw.trim();
  if (!value) return null;
  if (/^\(.*\)$/.test(value)) value = `-${value.slice(1, -1)}`;
  value = value.replace(/,/g, '').replace(/[^0-9.+-]/g, '');
  if (!value || value === '-' || value === '+') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeImportCurrency(raw: string): string {
  const value = raw.trim().toUpperCase();
  if (!value) return 'NZD';
  if (value === '$' || value === 'NZ$' || value === 'NZD$') return 'NZD';
  if (value === 'US$' || value === 'USD$') return 'USD';
  if (value === 'A$' || value === 'AUD$') return 'AUD';
  if (value === '€') return 'EUR';
  if (value === '£') return 'GBP';
  return value;
}

function normalizeCardFinish(raw: string, game: string): string {
  const value = raw.trim();
  if (!value) return game === 'mtg' ? 'nonfoil' : 'holofoil';
  if (game === 'mtg') {
    if (/^(true|1|yes|y|foil)$/i.test(value)) return 'foil';
    if (/^(false|0|no|n|nonfoil|normal)$/i.test(value)) return 'nonfoil';
  }
  return value;
}

function appendImportNotes(base: string, metadata: string[]): string | null {
  const extra = metadata.filter(Boolean);
  return [base.trim(), ...extra].filter(Boolean).join('\n') || null;
}

/** Bulk import collectables from CSV; quotes each row via public API (never invent). */
router.post('/import-collectables-csv', async (req, res) => {
  const db = await getDb();
  const csvText =
    typeof req.body?.csv === 'string'
      ? req.body.csv
      : typeof req.body?.text === 'string'
        ? req.body.text
        : '';
  if (!csvText.trim()) {
    return res.status(400).json({
      error:
        'csv (string) required. Supports game,name,set,number,finish,quantity,cost_basis_nzd,notes,api_id and ManaBox exports',
    });
  }
  const rows = parseCollectablesCsv(csvText);
  if (!rows.length) {
    return res.status(400).json({ error: 'No data rows found (need header + at least one row)' });
  }
  const results: Array<Record<string, unknown>> = [];
  let created = 0;
  let quotedOk = 0;
  let fxConverted = 0;
  for (const row of rows) {
    const manaBoxScryfallId = csvValue(row, 'scryfall_id');
    const apiId = manaBoxScryfallId || csvValue(row, 'api_id', 'card_api_id');
    // A ManaBox Scryfall ID is unambiguous evidence that this is an MTG row.
    // Keep the explicit game for the legacy compact format, which can also
    // use api_id for Pokémon cards.
    const game = manaBoxScryfallId
      ? 'mtg'
      : parseCardGame(csvValue(row, 'game', 'card_game'));
    if (!game) {
      results.push({ ok: false, error: 'invalid or missing game (mtg|pokemon)', row });
      continue;
    }
    if (!isApiCardGame(game)) {
      results.push({ ok: false, error: 'CSV import is for mtg|pokemon cards only (manual types use Add item)', row });
      continue;
    }

    const name = csvValue(row, 'name', 'card_name');
    const setCode = csvValue(row, 'set_code');
    const setName = csvValue(row, 'set_name');
    const set = csvValue(row, 'set', 'card_set') || setCode || setName || null;
    const number = csvValue(row, 'number', 'card_number', 'collector_number') || null;
    const finish = normalizeCardFinish(
      csvValue(row, 'finish', 'card_finish', 'foil'),
      game,
    );
    const resolvedApiId = apiId || null;
    const qty = Number(csvValue(row, 'quantity', 'qty', 'amount') || 1);
    if (!Number.isFinite(qty) || qty <= 0) {
      results.push({ ok: false, error: 'invalid quantity', name, game });
      continue;
    }
    if (!name && !apiId && !(set && number)) {
      results.push({ ok: false, error: 'need name or set+number or api_id', row });
      continue;
    }

    const purchasePriceRaw = csvValue(row, 'purchase_price', 'purchaseprice');
    const legacyCostRaw = csvValue(row, 'cost_basis_nzd', 'cost_basis', 'cost');
    const purchasePrice = purchasePriceRaw ? parseCsvMoney(purchasePriceRaw) : null;
    const purchaseCurrency = normalizeImportCurrency(
      csvValue(row, 'purchase_price_currency', 'purchase_currency', 'currency'),
    );
    let cost: number | null = purchasePriceRaw ? null : optionalNumber(legacyCostRaw);
    let fxRate: number | null = null;
    let fxMessage: string | null = null;
    if (purchasePriceRaw && purchasePrice != null) {
      const converted = await convertToNzd(purchasePrice, purchaseCurrency);
      if (converted) {
        cost = converted.nzd;
        fxRate = converted.rate;
        fxMessage = converted.message;
        if (purchaseCurrency !== 'NZD') fxConverted += 1;
      } else {
        fxMessage = `${purchaseCurrency}→NZD unavailable; cost basis left unknown`;
      }
    }

    const quoted = await quoteCard({
      game,
      name: name || null,
      set,
      number,
      finish,
      apiId: resolvedApiId,
    });
    const id = newId('hld');
    const now = new Date().toISOString();
    const displayName = quoted.name || name || `${game} card`;
    const valuation =
      quoted.status === 'ok' && quoted.unitNzd != null ? quoted.unitNzd * qty : null;
    if (valuation != null) quotedOk += 1;

    const csvRarity = normalizeCardRarity(csvValue(row, 'rarity'));
    const cardColours = coloursToStorage(quoted.colours);
    const cardRarity = quoted.rarity ?? csvRarity;

    const notes = appendImportNotes(csvValue(row, 'notes'), [
      setName && setName.toLowerCase() !== (setCode || '').toLowerCase()
        ? `ManaBox set name: ${setName}`
        : '',
      csvValue(row, 'manabox_id') ? `ManaBox ID: ${csvValue(row, 'manabox_id')}` : '',
      // Prefer structured card_rarity column; keep note only if we still lack a stored rarity
      csvRarity && !cardRarity ? `Rarity: ${csvValue(row, 'rarity')}` : '',
      csvValue(row, 'condition') ? `Condition: ${csvValue(row, 'condition')}` : '',
      csvValue(row, 'language') ? `Language: ${csvValue(row, 'language')}` : '',
      csvValue(row, 'misprint') ? `Misprint: ${csvValue(row, 'misprint')}` : '',
      csvValue(row, 'altered') ? `Altered: ${csvValue(row, 'altered')}` : '',
      csvValue(row, 'added') ? `Added: ${csvValue(row, 'added')}` : '',
      purchasePriceRaw && purchasePrice != null
        ? `Purchase price: ${purchasePrice} ${purchaseCurrency}${fxMessage ? ` (${fxMessage})` : ''}`
        : '',
      purchasePriceRaw && purchasePrice == null ? `Purchase price invalid: ${purchasePriceRaw}` : '',
    ]);

    run(
      db,
      `INSERT INTO holdings (
        id, user_id, asset_class, name, notes, cost_basis_nzd, acquired_at, created_at, updated_at,
        amount, valuation_nzd, valuation_source, valuation_notes, last_valuation_at,
        card_game, card_set, card_number, card_finish, card_api_id, card_image_url,
        card_colours, card_rarity, source
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        uid(req),
        'collectable',
        displayName,
        notes,
        cost,
        null,
        now,
        now,
        qty,
        valuation,
        quoted.status === 'ok' ? quoted.source : null,
        quoted.message,
        quoted.asOf,
        game,
        quoted.set ?? set,
        quoted.number ?? number,
        quoted.finish ?? finish,
        quoted.apiId ?? resolvedApiId,
        quoted.imageUrl,
        cardColours,
        cardRarity,
        'csv',
      ],
    );
    if (quoted.assetKey && quoted.status === 'ok') {
      persistUnitQuote(db, quoted.assetKey, {
        currency: 'NZD',
        price: quoted.unitNzd,
        status: 'ok',
        source: quoted.source,
        asOf: quoted.asOf,
        message: quoted.message,
      });
    }
    created += 1;
    results.push({
      ok: true,
      id,
      name: displayName,
      game,
      quantity: qty,
      costBasisNzd: cost,
      purchasePrice: purchasePrice ?? undefined,
      purchaseCurrency: purchasePriceRaw ? purchaseCurrency : undefined,
      fxRate,
      unitNzd: quoted.unitNzd,
      marketValueNzd: valuation,
      quoteStatus: quoted.status,
      source: quoted.source,
      message: quoted.message,
    });
    // Gentle rate limit for Scryfall (~10/s) and pokemontcg.io
    await new Promise((r) => setTimeout(r, 120));
  }
  res.status(201).json({
    ok: true,
    created,
    quotedOk,
    fxConverted,
    totalRows: rows.length,
    columns:
      'legacy: game,name,set,number,finish,quantity,cost_basis_nzd,notes,api_id; ManaBox: Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency,Added',
    results,
  });
});

/** Refresh all collectable card quotes (public APIs → NZD). */
router.post('/refresh-collectables-values', async (req, res) => {
  const db = await getDb();
  const rows = queryAll(db, "SELECT * FROM holdings WHERE asset_class = 'collectable' AND user_id = ?", [uid(req)]);
  const results: Array<Record<string, unknown>> = [];
  let appliedCount = 0;
  for (const row of rows) {
    const game = parseCardGame(row.card_game);
    if (!game) {
      results.push({ holdingId: row.id, applied: false, message: 'unknown game' });
      continue;
    }
    if (!isApiCardGame(game)) {
      results.push({ holdingId: row.id, applied: false, message: 'manual type — no API quote' });
      continue;
    }
    const quoted = await quoteCard({
      game,
      name: String(row.name ?? ''),
      set: row.card_set as string | null,
      number: row.card_number as string | null,
      finish: row.card_finish as string | null,
      apiId: row.card_api_id as string | null,
    });
    const qty = row.amount != null ? Number(row.amount) : 1;
    const nowIso = new Date().toISOString();
    const fillColours = coalesceCardMeta(row.card_colours, coloursToStorage(quoted.colours));
    const fillRarity = coalesceCardMeta(row.card_rarity, quoted.rarity);
    if (quoted.status === 'ok' && quoted.unitNzd != null) {
      const market = quoted.unitNzd * qty;
      run(
        db,
        `UPDATE holdings SET valuation_nzd=?, valuation_source=?, valuation_notes=?,
          last_valuation_at=?, card_api_id=COALESCE(?, card_api_id),
          card_set=COALESCE(?, card_set), card_number=COALESCE(?, card_number),
          card_finish=COALESCE(?, card_finish), card_image_url=COALESCE(?, card_image_url),
          card_colours=?, card_rarity=?,
          updated_at=? WHERE id=?`,
        [
          market,
          quoted.source,
          quoted.message,
          quoted.asOf ?? nowIso,
          quoted.apiId,
          quoted.set,
          quoted.number,
          quoted.finish,
          quoted.imageUrl,
          fillColours,
          fillRarity,
          nowIso,
          row.id,
        ],
      );
      if (quoted.assetKey) {
        persistUnitQuote(db, quoted.assetKey, {
          currency: 'NZD',
          price: quoted.unitNzd,
          status: 'ok',
          source: quoted.source,
          asOf: quoted.asOf,
          message: quoted.message,
        });
      }
      appliedCount += 1;
      results.push({
        holdingId: row.id,
        name: row.name,
        applied: true,
        unitNzd: quoted.unitNzd,
        marketValueNzd: market,
        source: quoted.source,
        cardColours: fillColours,
        cardRarity: fillRarity,
      });
    } else {
      // Still backfill colour/rarity from Scryfall when price is unavailable
      if (fillColours !== row.card_colours || fillRarity !== row.card_rarity) {
        run(
          db,
          `UPDATE holdings SET card_colours=?, card_rarity=?, valuation_notes=?, updated_at=? WHERE id=?`,
          [fillColours, fillRarity, quoted.message, nowIso, row.id],
        );
      }
      results.push({
        holdingId: row.id,
        name: row.name,
        applied: false,
        message: quoted.message,
        source: quoted.source,
        cardColours: fillColours,
        cardRarity: fillRarity,
      });
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  res.json({
    ok: true,
    total: rows.length,
    appliedCount,
    failedCount: rows.length - appliedCount,
    results,
  });
});


/** Backfill MTG colour identity + rarity from Scryfall collection API (no prices). */
router.post('/backfill-mtg-card-meta', async (req, res) => {
  const db = await getDb();
  const force = Boolean(req.body?.force);
  const rows = queryAll(
    db,
    force
      ? `SELECT id, name, card_api_id, card_colours, card_rarity FROM holdings
         WHERE asset_class = 'collectable' AND user_id = ? AND lower(card_game) = 'mtg'
           AND card_api_id IS NOT NULL AND trim(card_api_id) != ''`
      : `SELECT id, name, card_api_id, card_colours, card_rarity FROM holdings
         WHERE asset_class = 'collectable' AND user_id = ? AND lower(card_game) = 'mtg'
           AND card_api_id IS NOT NULL AND trim(card_api_id) != ''
           AND (card_colours IS NULL OR card_rarity IS NULL)`,
    [uid(req)],
  );
  if (rows.length === 0) {
    return res.json({ ok: true, total: 0, updated: 0, missingMeta: 0, message: 'Nothing to backfill' });
  }
  const ids = rows.map((r) => String(r.card_api_id));
  const meta = await fetchScryfallCollectionMeta(ids);
  const nowIso = new Date().toISOString();
  let updated = 0;
  let missingMeta = 0;
  for (const row of rows) {
    const apiId = String(row.card_api_id);
    const m = meta.get(apiId);
    if (!m) {
      missingMeta += 1;
      continue;
    }
    const fillColours = coalesceCardMeta(force ? null : row.card_colours, coloursToStorage(m.colours));
    const fillRarity = coalesceCardMeta(force ? null : row.card_rarity, m.rarity);
    if (fillColours === row.card_colours && fillRarity === row.card_rarity) continue;
    db.run(
      `UPDATE holdings SET card_colours=?, card_rarity=?,
        card_image_url=COALESCE(card_image_url, ?),
        card_set=COALESCE(card_set, ?),
        card_number=COALESCE(card_number, ?),
        updated_at=? WHERE id=?`,
      [fillColours, fillRarity, m.imageUrl, m.set, m.number, nowIso, row.id],
    );
    updated += 1;
  }
  if (updated > 0) persist();
  res.json({
    ok: true,
    total: rows.length,
    updated,
    missingMeta,
    fetched: meta.size,
  });
});

/** Refresh all forex holdings via Frankfurter → NZD (never invent). */
router.post('/refresh-forex-values', async (req, res) => {
  const db = await getDb();
  const rows = queryAll(db, "SELECT * FROM holdings WHERE asset_class = 'forex' AND user_id = ?", [uid(req)]);
  const currencies = [
    ...new Set(
      rows
        .map((r) => String(r.asset ?? '').trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  const results: Array<Record<string, unknown>> = [];
  let appliedCount = 0;
  for (const c of currencies) {
    const refreshed = await refreshForexCurrency(db, c, true);
    results.push({
      currency: c,
      rate: refreshed.rate,
      status: refreshed.status,
      source: refreshed.source,
      asOf: refreshed.asOf,
      message: refreshed.message,
      applied: refreshed.status === 'ok' && refreshed.rate != null,
    });
    if (refreshed.status === 'ok' && refreshed.rate != null) appliedCount += 1;
  }
  const holdingsOut = rows.map((row) => {
    const m = lookupFxMarketNzd(db, row.asset as string, row.amount as number);
    return {
      holdingId: row.id,
      currency: row.asset,
      amount: row.amount,
      marketValueNzd: m.marketValueNzd,
      unitPriceNzd: m.unitPriceNzd,
    };
  });
  res.json({
    ok: true,
    totalCurrencies: currencies.length,
    appliedCount,
    failedCount: currencies.length - appliedCount,
    source: 'Frankfurter (api.frankfurter.dev) → NZD; USD fallback BTC FX ratio',
    results,
    holdings: holdingsOut,
  });
});

/** Refresh all GoMining miners from public primary marketplace USD/TH × BTC FX → NZD. */
router.post('/refresh-gomining-values', async (req, res) => {
  const db = await getDb();
  const rows = queryAll(db, "SELECT * FROM holdings WHERE asset_class = 'gomining_miner' AND user_id = ?", [uid(req)]);
  const results: Array<Record<string, unknown>> = [];
  let appliedCount = 0;
  let force = true;
  for (const row of rows) {
    const hashrate = Number(row.hashrate_ths ?? 0);
    const ee =
      row.energy_efficiency_wth != null ? Number(row.energy_efficiency_wth) : null;
    const estimate = await estimateMinerValueNzd({
      hashrateThs: hashrate,
      energyEfficiencyWth: ee,
      force,
    });
    force = false; // reuse marketplace + FX cache after first
    const assetKey = `GOMINING:miner:${row.id}`;
    const quote = estimateToQuoteResult(assetKey, estimate);
    const now = estimate.asOf ?? new Date().toISOString();
    run(
      db,
      `INSERT INTO price_quotes (id, asset_key, currency, price, status, source, as_of, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(asset_key) DO UPDATE SET
         price=excluded.price, status=excluded.status, source=excluded.source,
         as_of=excluded.as_of, notes=excluded.notes, currency=excluded.currency`,
      [
        newId('q'),
        assetKey,
        quote.currency,
        quote.price,
        quote.status,
        quote.source,
        now,
        quote.message ?? null,
      ],
    );
    let applied = false;
    if (estimate.status === 'ok' && estimate.estimatedValueNzd != null) {
      const valueSource =
        estimate.source === 'gomining_extrapolated'
          ? 'gomining_extrapolated'
          : 'gomining';
      run(
        db,
        `UPDATE holdings SET estimated_value_nzd=?, estimated_value_at=?, estimated_value_source=?, updated_at=? WHERE id=?`,
        [estimate.estimatedValueNzd, now, valueSource, now, row.id],
      );
      applied = true;
      appliedCount += 1;
    }
    const failReason =
      applied
        ? null
        : estimate.failureCode === 'ee_out_of_band'
          ? `EE ${ee ?? '—'} W/TH outside primary generative bands (${(estimate.availableEeBands ?? []).join(', ') || 'none'} only) — set manual estimated NZD`
          : estimate.failureCode === 'no_hashrate'
            ? 'Hashrate missing/invalid'
            : estimate.failureCode === 'market_down'
              ? 'Marketplace feed unavailable'
              : estimate.failureCode === 'fx_down'
                ? 'BTC FX unavailable (cannot convert USD→NZD)'
                : estimate.message ?? 'No marketplace match';
    results.push({
      holdingId: row.id,
      minerName: row.miner_name ?? row.name,
      hashrateThs: hashrate,
      energyEfficiencyWth: ee,
      estimatedValueNzd: estimate.estimatedValueNzd,
      usdPerTh: estimate.usdPerTh,
      applied,
      failed: !applied,
      failureCode: estimate.failureCode,
      failReason,
      availableEeBands: estimate.availableEeBands,
      matchMode: estimate.matchMode,
      quote,
      estimate: {
        matchedCollectionId: estimate.matchedCollectionId,
        matchedPower: estimate.matchedPower,
        matchedEnergyEfficiency: estimate.matchedEnergyEfficiency,
        usdNzdRate: estimate.usdNzdRate,
        matchMode: estimate.matchMode,
        failureCode: estimate.failureCode,
        availableEeBands: estimate.availableEeBands,
        message: estimate.message,
      },
    });
  }
  const failed = results.filter((r) => r.failed);
  const bands =
    results.find((r) => Array.isArray(r.availableEeBands) && (r.availableEeBands as number[]).length)?.availableEeBands ??
    [];
  res.json({
    ok: true,
    total: rows.length,
    appliedCount,
    failedCount: failed.length,
    availableEeBands: bands,
    source:
      'GET api.gomining.com/api/nft-collection/find-all-generative (primary generative USD/TH) × BTC/USD→NZD FX; out-of-band EE → linear extrapolate usd/TH vs EE (gomining_extrapolated)',
    computation:
      'Exact EE (±0.5) → closest power; EE between live bands → interpolate usd/TH; EE outside bands (today: 12 & 15 W/TH) → linear extrapolate usd/TH from live extreme-band prices at closest power × TH × FX (labelled gomining_extrapolated). Secondary P2P needs auth MCP — not used. Anchors always live.',
    note:
      bands.length
        ? `Primary generative EE bands: ${(bands as number[]).join(', ')} W/TH. Out-of-band miners use estimate extrapolated from primary ${(bands as number[]).join('/')} W/TH (source gomining_extrapolated).`
        : null,
    results,
  });
});

/** Refresh valuation via quote provider (metals live; others stubbed). */
/** Attach / replace property photo (JSON body: { photoBase64: data-url or base64 }). */
router.post('/:id/photo', async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, 'SELECT * FROM holdings WHERE id = ? AND user_id = ?', [req.params.id, uid(req)]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.asset_class === 'real_estate') {
    /* ok */
  } else if (row.asset_class === 'collectable' && isManualCollectableGame(String(row.card_game ?? ''))) {
    /* manual item photo ok */
  } else if (row.asset_class === 'art') {
    /* physical (or any) art photo ok — display only, never invents value */
  } else {
    return res.status(400).json({
      error: 'Photos only for real_estate, art, or non-card (manual) collectables — cards use API art',
    });
  }
  const b64 = req.body?.photoBase64 ?? req.body?.photo;
  if (!b64 || typeof b64 !== 'string') {
    return res.status(400).json({ error: 'photoBase64 (data URL or base64) required' });
  }
  try {
    const photoPath =
      row.asset_class === 'real_estate'
        ? savePropertyPhoto(String(req.params.id), b64)
        : row.asset_class === 'art'
          ? saveArtPhoto(String(req.params.id), b64)
          : saveCollectablePhoto(String(req.params.id), b64);
    const now = new Date().toISOString();
    run(db, 'UPDATE holdings SET photo_path=?, updated_at=? WHERE id=?', [
      photoPath,
      now,
      req.params.id,
    ]);
    const updated = queryOne(db, 'SELECT * FROM holdings WHERE id = ? AND user_id = ?', [req.params.id, uid(req)]);
    res.json(mapHolding(updated!));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/:id/refresh-value', async (req, res) => {
  const db = await getDb();
  const row = queryOne(db, 'SELECT * FROM holdings WHERE id = ? AND user_id = ?', [req.params.id, uid(req)]);
  if (!row) return res.status(404).json({ error: 'Not found' });

  let assetKey = '';
  if (row.asset_class === 'gomining_miner') {
    assetKey = `GOMINING:miner:${row.id}`;
  } else if (row.asset_class === 'crypto') {
    assetKey = `CRYPTO:${row.asset}`;
  } else if (row.asset_class === 'stock') {
    assetKey = `STOCK:${row.symbol}`;
  } else if (row.asset_class === 'metal') {
    assetKey = metalAssetKey(row.metal as MetalKind, 'oz_t');
  } else if (row.asset_class === 'stone') {
    if (
      isDiamondStoneType(String(row.stone_type ?? '')) &&
      row.carat != null &&
      row.colour &&
      row.clarity
    ) {
      assetKey = stoneAssetKey({
        carat: Number(row.carat),
        colour: String(row.colour),
        clarity: String(row.clarity),
        cut: row.cut != null ? String(row.cut) : 'round',
      });
    } else {
      assetKey = `STONE:${row.id}`;
    }
  } else if (row.asset_class === 'forex') {
    assetKey = forexAssetKey(String(row.asset ?? ''));
  } else {
    assetKey = `${row.asset_class}:${row.id}`;
  }

  let quote;
  let marketValueNzd: number | null = null;
  let applied = false;
  let note =
    'Provider stubbed — no invented price applied. Update estimated value manually if known.';

  if (row.asset_class === 'metal') {
    // Force refresh for this metal (shares Metals.Dev batch cache).
    quote = await getMetalQuote(row.metal as MetalKind, true);
    assetKey = quote.assetKey;
    const now = quote.asOf ?? new Date().toISOString();
    run(
      db,
      `INSERT INTO price_quotes (id, asset_key, currency, price, status, source, as_of, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(asset_key) DO UPDATE SET
         price=excluded.price, status=excluded.status, source=excluded.source,
         as_of=excluded.as_of, notes=excluded.notes, currency=excluded.currency`,
      [
        newId('q'),
        assetKey,
        quote.currency,
        quote.price,
        quote.status,
        quote.source,
        now,
        quote.message ?? null,
      ],
    );
    const amount = Number(row.metal_amount ?? 0);
    const unit = (row.metal_unit as MetalUnit) || 'g';
    marketValueNzd = metalMarketValueNzd(amount, unit, quote.price);
    applied = quote.status === 'ok' && marketValueNzd != null;
    note = applied
      ? `Applied Metals.Dev spot: ${quote.price?.toFixed(2)} NZD/oz t → holding ${marketValueNzd!.toFixed(2)} NZD.`
      : (quote.message ?? 'Metal quote unavailable — showing cost only.');
  } else if (row.asset_class === 'gomining_miner') {
    const hashrate = Number(row.hashrate_ths ?? 0);
    const ee =
      row.energy_efficiency_wth != null ? Number(row.energy_efficiency_wth) : null;
    const estimate = await estimateMinerValueNzd({
      hashrateThs: hashrate,
      energyEfficiencyWth: ee,
      force: true,
    });
    quote = estimateToQuoteResult(assetKey, estimate);
    const now = estimate.asOf ?? new Date().toISOString();
    run(
      db,
      `INSERT INTO price_quotes (id, asset_key, currency, price, status, source, as_of, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(asset_key) DO UPDATE SET
         price=excluded.price, status=excluded.status, source=excluded.source,
         as_of=excluded.as_of, notes=excluded.notes, currency=excluded.currency`,
      [
        newId('q'),
        assetKey,
        quote.currency,
        quote.price,
        quote.status,
        quote.source,
        now,
        quote.message ?? null,
      ],
    );
    if (estimate.status === 'ok' && estimate.estimatedValueNzd != null) {
      const valueSource =
        estimate.source === 'gomining_extrapolated'
          ? 'gomining_extrapolated'
          : 'gomining';
      run(
        db,
        `UPDATE holdings SET estimated_value_nzd=?, estimated_value_at=?, estimated_value_source=?, updated_at=? WHERE id=?`,
        [estimate.estimatedValueNzd, now, valueSource, now, row.id],
      );
      marketValueNzd = estimate.estimatedValueNzd;
      applied = true;
      note =
        estimate.matchMode === 'ee_extrapolated'
          ? `Applied extrapolated estimate from primary bands (${estimate.matchMode}): $${estimate.usdPerTh?.toFixed(4)}/TH × ${hashrate} TH → ${estimate.estimatedValueNzd.toFixed(2)} NZD · estimate extrapolated from primary 12/15 W/TH.`
          : `Applied primary generative marketplace (${estimate.matchMode}): $${estimate.usdPerTh?.toFixed(4)}/TH × ${hashrate} TH → ${estimate.estimatedValueNzd.toFixed(2)} NZD (USD→NZD via BTC FX).`;
    } else {
      const bands = (estimate.availableEeBands ?? []).join(', ') || 'none';
      note =
        estimate.failureCode === 'ee_out_of_band'
          ? `EE ${ee ?? '—'} W/TH outside primary generative bands (${bands} W/TH) and extrapolation unavailable. Set manual Est. NZD on the miner card. ${estimate.message ?? ''}`
          : (estimate.message ??
            'GoMining marketplace / FX unavailable — estimated value not updated (never invent).');
    }
  } else if (row.asset_class === 'stock' || row.asset_class === 'crypto') {
    const isAkahu =
      (typeof row.external_id === 'string' && row.external_id.startsWith('akahu:')) ||
      row.source === 'Sharesies' ||
      row.source === 'Hatch';

    if (isAkahu) {
      // Clear refresh path: re-sync Akahu (live Frankfurter / BTC FX → NZD). No invented prices.
      const { syncAkahuPortfolio } = await import('../akahu/sync.ts');
      const syncResult = await syncAkahuPortfolio(db, uid(req));
      const refreshed = queryOne(db, 'SELECT * FROM holdings WHERE id = ?', [row.id]);
      const qty =
        row.asset_class === 'stock'
          ? (refreshed?.shares as number | null)
          : (refreshed?.amount as number | null);
      const sym =
        row.asset_class === 'stock'
          ? (refreshed?.symbol as string | null)
          : (refreshed?.asset as string | null);
      const m = lookupAkahuMarketNzd(db, row.asset_class as string, sym, qty);
      marketValueNzd = m.marketValueNzd;
      applied = marketValueNzd != null;
      const fxBit =
        syncResult.fxSources?.length ? ` · FX: ${syncResult.fxSources.join(', ')}` : '';
      note = applied
        ? `Akahu re-sync applied${fxBit} → ${marketValueNzd!.toFixed(2)} NZD.`
        : `Akahu re-sync done${fxBit} but NZD value still unavailable (FX or shares missing — never invent).`;
      quote = {
        assetKey,
        currency: 'NZD',
        price: m.unitPriceNzd,
        status: applied ? 'ok' : 'unavailable',
        source: 'akahu',
        asOf: m.quoteAsOf ?? new Date().toISOString(),
        message: note,
      };
    } else if (row.asset_class === 'crypto') {
      // Manual / Nexo crypto: CoinGecko NZD unit × amount.
      const ticker = String(row.asset ?? '').toUpperCase();
      const resolved = await resolveCryptoTicker(ticker, true);
      quote = resolved.quote;
      persistUnitQuote(db, assetKey, quote);
      const qty = row.amount != null ? Number(row.amount) : null;
      const unit = quote.status === 'ok' ? quote.price : null;
      if (unit != null && qty != null && Number.isFinite(qty)) {
        marketValueNzd = unit * qty;
        applied = true;
        note = `CoinGecko ${resolved.coingeckoId ?? ticker}: ${unit.toFixed(4)} NZD × ${qty} → ${marketValueNzd.toFixed(2)} NZD.`;
      } else {
        applied = false;
        note =
          quote.message ??
          'Crypto quote unavailable — Value stays — (never invent).';
      }
    } else {
      // Manual stock: Yahoo Finance × FX → NZD (same as Value Search / charts).
      const exchange =
        row.exchange != null && String(row.exchange).trim()
          ? String(row.exchange).trim()
          : null;
      quote = await getStockQuoteNzd(String(row.symbol ?? ''), {
        exchange,
        force: true,
      });
      persistUnitQuote(db, assetKey, quote);
      const qty = row.shares != null ? Number(row.shares) : null;
      const unit =
        (quote.status === 'ok' || quote.status === 'stale') && quote.price != null
          ? quote.price
          : null;
      if (unit != null && qty != null && Number.isFinite(qty)) {
        marketValueNzd = unit * qty;
        applied = true;
        note = `Yahoo ${quote.source}: ${unit.toFixed(4)} NZD/share × ${qty} → ${marketValueNzd.toFixed(2)} NZD.`;
      } else {
        applied = false;
        note =
          quote.message ??
          'Equity quote unavailable — Value stays — (never invent).';
      }
    }
  } else if (row.asset_class === 'forex') {
    const currency = String(row.asset ?? '').toUpperCase();
    const refreshed = await refreshForexCurrency(db, currency, true);
    assetKey = refreshed.assetKey;
    const qty = row.amount != null ? Number(row.amount) : null;
    const unit = refreshed.status === 'ok' ? refreshed.rate : null;
    if (unit != null && qty != null && Number.isFinite(qty)) {
      marketValueNzd = unit * qty;
      applied = true;
      note = `Frankfurter ${currency}→NZD @ ${unit.toFixed(6)} × ${qty} → ${marketValueNzd.toFixed(2)} NZD (${refreshed.source}).`;
    } else {
      applied = false;
      note =
        refreshed.message ??
        'FX rate unavailable — Value stays — (never invent).';
    }
    quote = {
      assetKey,
      currency: 'NZD',
      price: unit,
      status: applied ? 'ok' : 'unavailable',
      source: refreshed.source,
      asOf: refreshed.asOf ?? new Date().toISOString(),
      message: note,
    };
  } else if (row.asset_class === 'stone') {
    const st = String(row.stone_type ?? '');
    if (
      isDiamondStoneType(st) &&
      row.carat != null &&
      row.colour &&
      row.clarity
    ) {
      const specs = {
        carat: Number(row.carat),
        colour: String(row.colour),
        clarity: String(row.clarity),
        shape: normalizeDiamondShape(row.cut != null ? String(row.cut) : 'round'),
      };
      assetKey = stoneAssetKey(specs);
      quote = await quoteDiamondOpenFacet(specs, true);
      const nowIso = quote.asOf ?? new Date().toISOString();
      persistUnitQuote(db, assetKey, quote);
      if (quote.status === 'ok' && quote.price != null) {
        marketValueNzd = quote.price;
        applied = true;
        note = quote.message ?? `OpenFacet → ${quote.price.toFixed(2)} NZD`;
        run(
          db,
          `UPDATE holdings SET valuation_nzd=?, valuation_source=?, valuation_notes=?,
            last_valuation_at=?, updated_at=? WHERE id=?`,
          [
            marketValueNzd,
            quote.source,
            quote.message ?? null,
            nowIso,
            nowIso,
            row.id,
          ],
        );
      } else {
        applied = false;
        note =
          quote.message ??
          'OpenFacet/FX unavailable — valuation not updated (never invent)';
        run(
          db,
          `UPDATE holdings SET valuation_notes=?, updated_at=? WHERE id=?`,
          [note, nowIso, row.id],
        );
      }
    } else {
      applied = false;
      note =
        'Live stone quotes are diamond-only (OpenFacet with carat/colour/clarity). Non-diamond gems keep manual estimated NZD — never invent.';
      quote = {
        assetKey,
        currency: 'NZD',
        price: row.valuation_nzd != null ? Number(row.valuation_nzd) : null,
        status: 'not_applicable',
        source: 'user_valuation',
        asOf: (row.last_valuation_at as string) ?? new Date().toISOString(),
        message: note,
      };
      marketValueNzd =
        row.valuation_nzd != null ? Number(row.valuation_nzd) : null;
    }
  } else if (row.asset_class === 'collectable') {

    const game = parseCardGame(row.card_game);
    if (!game || !isApiCardGame(game)) {
      applied = false;
      note = !game
        ? 'Unknown card game — cannot refresh (never invent)'
        : 'Manual collectable type — no API quote (never invent)';
      quote = {
        assetKey,
        currency: 'NZD',
        price: null,
        status: 'unavailable',
        source: 'stub',
        asOf: new Date().toISOString(),
        message: note,
      };
    } else {
      const quoted = await quoteCard({
        game,
        name: String(row.name ?? ''),
        set: row.card_set as string | null,
        number: row.card_number as string | null,
        finish: row.card_finish as string | null,
        apiId: row.card_api_id as string | null,
      });
      const qty = row.amount != null ? Number(row.amount) : 1;
      const unit = quoted.status === 'ok' ? quoted.unitNzd : null;
      const nowIso = new Date().toISOString();
      const fillColours = coalesceCardMeta(row.card_colours, coloursToStorage(quoted.colours));
      const fillRarity = coalesceCardMeta(row.card_rarity, quoted.rarity);
      if (unit != null && Number.isFinite(qty)) {
        marketValueNzd = unit * qty;
        applied = true;
        note = quoted.message ?? `Card unit ${unit.toFixed(4)} NZD × ${qty}`;
        run(
          db,
          `UPDATE holdings SET valuation_nzd=?, valuation_source=?, valuation_notes=?,
            last_valuation_at=?, card_api_id=COALESCE(?, card_api_id),
            card_set=COALESCE(?, card_set), card_number=COALESCE(?, card_number),
            card_finish=COALESCE(?, card_finish), card_image_url=COALESCE(?, card_image_url),
            card_colours=?, card_rarity=?,
            name=COALESCE(?, name), updated_at=?
           WHERE id=?`,
          [
            marketValueNzd,
            quoted.source,
            quoted.message,
            quoted.asOf ?? nowIso,
            quoted.apiId,
            quoted.set,
            quoted.number,
            quoted.finish,
            quoted.imageUrl,
            fillColours,
            fillRarity,
            quoted.name || null,
            nowIso,
            row.id,
          ],
        );
        if (quoted.assetKey) {
          persistUnitQuote(db, quoted.assetKey, {
            currency: 'NZD',
            price: unit,
            status: 'ok',
            source: quoted.source,
            asOf: quoted.asOf,
            message: quoted.message,
          });
          assetKey = quoted.assetKey;
        }
      } else {
        applied = false;
        note = quoted.message ?? 'Card quote unavailable — Value stays — (never invent)';
        run(
          db,
          `UPDATE holdings SET valuation_notes=?, card_colours=?, card_rarity=?, updated_at=? WHERE id=?`,
          [note, fillColours, fillRarity, nowIso, row.id],
        );
      }
      quote = {
        assetKey,
        currency: 'NZD',
        price: unit,
        status: applied ? 'ok' : 'unavailable',
        source: quoted.source,
        asOf: quoted.asOf ?? nowIso,
        message: note,
      };
    }
  } else if (row.asset_class === 'real_estate') {
    applied = false;
    note =
      'Real estate uses manual propertyValueNzd / mortgage — no live quote (never invent).';
    quote = {
      assetKey,
      currency: 'NZD',
      price: row.property_value_nzd != null ? Number(row.property_value_nzd) : null,
      status: 'not_applicable',
      source: 'manual',
      asOf: new Date().toISOString(),
      message: note,
    };
    marketValueNzd =
      row.property_value_nzd != null ? Number(row.property_value_nzd) : null;
  } else {
    const provider = providerForAssetKey(assetKey);
    quote = await provider.getQuote(assetKey);
    const now = new Date().toISOString();
    run(
      db,
      `INSERT INTO price_quotes (id, asset_key, currency, price, status, source, as_of, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(asset_key) DO UPDATE SET
         price=excluded.price, status=excluded.status, source=excluded.source,
         as_of=excluded.as_of, notes=excluded.notes`,
      [
        newId('q'),
        assetKey,
        quote.currency,
        quote.price,
        quote.status,
        quote.source,
        now,
        quote.message ?? null,
      ],
    );
  }

  res.json({
    holdingId: row.id,
    assetKey,
    quote,
    marketValueNzd,
    applied,
    note,
  });
});

export default router;
