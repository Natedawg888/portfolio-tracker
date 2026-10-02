/**
 * Shared net-worth computation for /net-worth and valuation_snapshots.
 * Never invents balances — uses known cash, cost/market when quotes ok, manual vals.
 */
import type { Database } from 'sql.js';
import { getDb, queryAll, queryOne } from '../db/index.ts';
import {
  coerceAkahuBalance,
  isLiquidCashAccountType,
  LIABILITY_ACCOUNT_TYPES,
} from '../akahu/sync.ts';
import {
  metalAssetKey,
  metalMarketValueNzd,
  metalsConfigured,
} from '../quotes/metals.ts';
import { ensureMetalQuotesPersisted } from '../quotes/metalQuotesDb.ts';
import {
  ensureForexQuotesPersisted,
  forexAssetKey,
} from '../quotes/forexQuotesDb.ts';
import type { MetalKind, MetalUnit } from '../../src/types/index.ts';

export type HoldingSeriesPoint = {
  id: string;
  label: string;
  assetClass: string;
  valueNzd: number;
};

export type NetWorthBreakdown = {
  byClass: Record<string, number | null>;
  holdings: HoldingSeriesPoint[];
};

export type NetWorthResult = {
  cashNzd: number;
  cashLiabilitiesNzd: number;
  stocksNzd: number;
  stocksUseMarket: boolean;
  cryptoNzd: number;
  cryptoUseMarket: boolean;
  gominingMinersNzd: number | null;
  artNzd: number | null;
  metalsNzd: number | null;
  metalsUseSpot: boolean;
  metalsConfigured: boolean;
  stonesNzd: number | null;
  forexNzd: number | null;
  forexUseSpot: boolean;
  realEstateNzd: number | null;
  realEstateMortgageNzd: number | null;
  realEstateEquityNzd: number | null;
  collectablesNzd: number | null;
  kiwiSaverNzd: number | null;
  /** Sum of debt_people.outstanding_nzd (personal I-owe liabilities). */
  debtOutstandingNzd: number;
  debtPersonCount: number;
  /** Assets before subtracting personal debt (cash + holdings + KS + bank liabilities as stored). */
  assetsKnownNzd: number;
  totalKnownNzd: number;
  hasUnavailableQuotes: boolean;
  asOf: string;
  quoteNote: string;
  settings: {
    defaultCurrency: string;
    timezone: string;
    locale: string;
  };
  counts: {
    accounts: number;
    holdings: number;
    gominingMiners: number;
    kiwisaver: number;
    debtPeople: number;
  };
  breakdown: NetWorthBreakdown;
};

function balanceOf(a: { balance: unknown }): number {
  const n = coerceAkahuBalance(a.balance);
  return n ?? (Number.isFinite(Number(a.balance)) ? Number(a.balance) : 0);
}

function holdingLabel(h: Record<string, unknown>): string {
  const name = typeof h.name === 'string' && h.name.trim() ? h.name.trim() : null;
  switch (h.asset_class) {
    case 'stock':
      return (typeof h.symbol === 'string' && h.symbol) || name || 'Stock';
    case 'crypto':
      return (typeof h.asset === 'string' && h.asset) || name || 'Crypto';
    case 'gomining_miner':
      return name || 'GoMining miner';
    case 'metal': {
      const metal = typeof h.metal === 'string' ? h.metal : 'metal';
      const amt = h.metal_amount != null ? Number(h.metal_amount) : null;
      const unit = (h.metal_unit as string) || 'g';
      if (amt != null && Number.isFinite(amt)) return `${metal} ${amt}${unit}`;
      return name || metal;
    }
    case 'art':
      return name || 'Art';
    case 'stone':
      return name || 'Stone';
    case 'forex': {
      const cur = typeof h.asset === 'string' && h.asset ? h.asset : 'FX';
      const src = typeof h.source === 'string' && h.source.trim() ? h.source.trim() : null;
      return name || (src ? `${cur} (${src})` : cur);
    }
    case 'real_estate':
      return name || 'Property';
    case 'collectable':
      return name || 'Card';
    default:
      return name || String(h.asset_class ?? 'Holding');
  }
}

export async function computeNetWorth(
  database?: Database,
  userId?: string | null,
): Promise<NetWorthResult> {
  const db = database ?? (await getDb());
  if (!userId) {
    throw new Error('computeNetWorth requires userId for per-user isolation');
  }
  await ensureMetalQuotesPersisted(db);
  await ensureForexQuotesPersisted(db);

  const accounts = queryAll<{
    balance: number;
    currency: string;
    account_type: string;
    notes: string | null;
  }>(db, `SELECT balance, currency, account_type, notes FROM bank_accounts WHERE user_id = ?`, [userId]);

  const nzdAccounts = accounts.filter((a) => (a.currency ?? '').toUpperCase() === 'NZD');

  const cashNzd = nzdAccounts
    .filter((a) => isLiquidCashAccountType(a.account_type, a.notes))
    .reduce((s, a) => s + balanceOf(a), 0);

  const cashLiabilitiesNzd = nzdAccounts
    .filter((a) => LIABILITY_ACCOUNT_TYPES.has((a.account_type ?? '').toLowerCase()))
    .reduce((s, a) => s + balanceOf(a), 0);

  const holdings = queryAll<Record<string, unknown>>(db, 'SELECT * FROM holdings WHERE user_id = ?', [userId]);
  const holdingPoints: HoldingSeriesPoint[] = [];

  let stocksCost = 0;
  let stocksMarket = 0;
  let stocksHaveMarket = false;
  let cryptoCost = 0;
  let cryptoMarket = 0;
  let cryptoHaveMarket = false;
  let gominingEst = 0;
  let gominingHasEst = false;
  let artVal = 0;
  let artHas = false;
  let metalsCost = 0;
  let metalsMarket = 0;
  let metalsHaveQuote = false;
  let metalsHaveAny = false;
  let stonesVal = 0;
  let stonesHas = false;
  let forexMarket = 0;
  let forexCost = 0;
  let forexHaveQuote = false;
  let forexHaveAny = false;
  let realEstateValue = 0;
  let realEstateMortgage = 0;
  let realEstateHas = false;
  let collectablesVal = 0;
  let collectablesHas = false;

  function quoteMarket(
    prefix: 'STOCK' | 'CRYPTO',
    symbol: string | null | undefined,
    qty: number | null | undefined,
  ): number | null {
    if (!symbol) return null;
    const q = queryOne(db, 'SELECT price, status FROM price_quotes WHERE asset_key = ?', [
      `${prefix}:${symbol}`,
    ]);
    if (!q || q.status !== 'ok' || q.price == null) return null;
    const unit = Number(q.price);
    const n = qty != null ? Number(qty) : null;
    if (!Number.isFinite(unit) || n == null || !Number.isFinite(n) || n <= 0) return null;
    return unit * n;
  }

  for (const h of holdings) {
    const rawCost = h.cost_basis_nzd;
    const cost =
      rawCost != null && Number.isFinite(Number(rawCost)) && Number(rawCost) > 0
        ? Number(rawCost)
        : 0;
    let lineValue: number | null = null;

    switch (h.asset_class) {
      case 'stock': {
        stocksCost += cost;
        const mv = quoteMarket('STOCK', h.symbol as string, h.shares as number);
        if (mv != null) {
          stocksMarket += mv;
          stocksHaveMarket = true;
          lineValue = mv;
        } else {
          stocksMarket += cost;
          lineValue = cost > 0 ? cost : null;
        }
        break;
      }
      case 'crypto': {
        cryptoCost += cost;
        const mv = quoteMarket('CRYPTO', h.asset as string, h.amount as number);
        if (mv != null) {
          cryptoMarket += mv;
          cryptoHaveMarket = true;
          lineValue = mv;
        } else {
          cryptoMarket += cost;
          lineValue = cost > 0 ? cost : null;
        }
        break;
      }
      case 'gomining_miner': {
        if (h.estimated_value_nzd != null) {
          const v = Number(h.estimated_value_nzd);
          gominingEst += v;
          gominingHasEst = true;
          lineValue = v;
        } else {
          gominingEst += cost;
          lineValue = cost > 0 ? cost : null;
        }
        break;
      }
      case 'art': {
        const v =
          h.last_valuation_nzd != null
            ? Number(h.last_valuation_nzd)
            : Number(h.purchase_price_nzd ?? cost);
        artVal += v;
        artHas = true;
        lineValue = Number.isFinite(v) ? v : null;
        break;
      }
      case 'metal': {
        metalsHaveAny = true;
        metalsCost += cost;
        const metal = h.metal as MetalKind | null;
        const amount = Number(h.metal_amount ?? 0);
        const unit = (h.metal_unit as MetalUnit) || 'g';
        if (metal) {
          const key = metalAssetKey(metal, 'oz_t');
          const q = queryOne(db, 'SELECT price, status FROM price_quotes WHERE asset_key = ?', [
            key,
          ]);
          if (q && (q.status === 'ok' || q.status === 'stale') && q.price != null) {
            const mv = metalMarketValueNzd(amount, unit, Number(q.price));
            if (mv != null) {
              metalsMarket += mv;
              metalsHaveQuote = true;
              lineValue = mv;
            } else {
              metalsMarket += cost;
              lineValue = cost > 0 ? cost : null;
            }
          } else {
            metalsMarket += cost;
            lineValue = cost > 0 ? cost : null;
          }
        } else {
          metalsMarket += cost;
          lineValue = cost > 0 ? cost : null;
        }
        break;
      }
      case 'forex': {
        forexHaveAny = true;
        forexCost += cost;
        const currency = (h.asset as string | null) ?? null;
        const amount = h.amount != null ? Number(h.amount) : null;
        if (currency) {
          const q = queryOne(db, 'SELECT price, status FROM price_quotes WHERE asset_key = ?', [
            forexAssetKey(currency),
          ]);
          if (q && q.status === 'ok' && q.price != null && amount != null && Number.isFinite(amount)) {
            const unit = Number(q.price);
            if (Number.isFinite(unit) && unit > 0) {
              const mv = unit * amount;
              forexMarket += mv;
              forexHaveQuote = true;
              lineValue = mv;
            } else {
              forexMarket += cost;
              lineValue = cost > 0 ? cost : null;
            }
          } else {
            forexMarket += cost;
            lineValue = cost > 0 ? cost : null;
          }
        } else {
          forexMarket += cost;
          lineValue = cost > 0 ? cost : null;
        }
        break;
      }
      case 'stone':
        if (h.valuation_nzd != null) {
          const v = Number(h.valuation_nzd);
          stonesVal += v;
          stonesHas = true;
          lineValue = v;
        }
        break;
      case 'real_estate': {
        const pv =
          h.property_value_nzd != null && Number.isFinite(Number(h.property_value_nzd))
            ? Number(h.property_value_nzd)
            : null;
        const mort =
          h.mortgage_outstanding_nzd != null && Number.isFinite(Number(h.mortgage_outstanding_nzd))
            ? Math.max(0, Number(h.mortgage_outstanding_nzd))
            : 0;
        if (pv != null) {
          realEstateValue += pv;
          realEstateMortgage += mort;
          realEstateHas = true;
          // Line shows equity clearly; gross tracked in class totals
          lineValue = pv - mort;
        }
        break;
      }
      case 'collectable': {
        // Prefer stored valuation_nzd (API quote × qty); else cost if known
        if (h.valuation_nzd != null && Number.isFinite(Number(h.valuation_nzd))) {
          const v = Number(h.valuation_nzd);
          collectablesVal += v;
          collectablesHas = true;
          lineValue = v;
        } else if (cost > 0) {
          collectablesVal += cost;
          collectablesHas = true;
          lineValue = cost;
        }
        break;
      }
    }

    if (lineValue != null && Number.isFinite(lineValue)) {
      holdingPoints.push({
        id: String(h.id),
        label: holdingLabel(h),
        assetClass: String(h.asset_class ?? 'unknown'),
        valueNzd: lineValue,
      });
    }
  }

  const ks = queryAll<{ balance_nzd: number; id: string; name: string }>(
    db,
    'SELECT id, name, balance_nzd FROM kiwisaver_accounts WHERE user_id = ?',
    [userId],
  );
  const kiwiSaverNzd = ks.reduce((s, r) => s + Number(r.balance_nzd), 0);
  for (const k of ks) {
    const v = Number(k.balance_nzd);
    if (Number.isFinite(v)) {
      holdingPoints.push({
        id: `ks:${k.id}`,
        label: k.name || 'KiwiSaver',
        assetClass: 'kiwisaver',
        valueNzd: v,
      });
    }
  }

  const debtPeople = queryAll<{ outstanding_nzd?: number }>(
    db,
    `SELECT outstanding_nzd FROM debt_people WHERE user_id = ?`,
    [userId],
  );
  const debtOutstandingNzd = debtPeople.reduce(
    (s, p) => s + (Number.isFinite(Number(p.outstanding_nzd)) ? Number(p.outstanding_nzd) : 0),
    0,
  );
  const debtPersonCount = debtPeople.length;

  const metalsNzdValue = metalsHaveAny
    ? metalsHaveQuote
      ? metalsMarket
      : metalsCost
    : null;

  const forexNzdValue = forexHaveAny
    ? forexHaveQuote
      ? forexMarket
      : forexCost
    : null;

  const stocksNzdValue = stocksHaveMarket ? stocksMarket : stocksCost;
  const cryptoNzdValue = cryptoHaveMarket ? cryptoMarket : cryptoCost;

  const realEstateEquity = realEstateHas ? realEstateValue - realEstateMortgage : null;
  // Gross property value in assets; mortgage subtracted with personal debt below
  const assetsKnownNzd =
    cashNzd +
    cashLiabilitiesNzd +
    stocksNzdValue +
    cryptoNzdValue +
    gominingEst +
    artVal +
    (metalsNzdValue ?? 0) +
    (stonesHas ? stonesVal : 0) +
    (forexNzdValue ?? 0) +
    (realEstateHas ? realEstateValue : 0) +
    (collectablesHas ? collectablesVal : 0) +
    kiwiSaverNzd;

  // Net worth = known assets − personal debt − real-estate mortgages (never invent)
  const totalKnownNzd = assetsKnownNzd - debtOutstandingNzd - (realEstateHas ? realEstateMortgage : 0);

  const settings = queryAll<{ key: string; value: string }>(
    db,
    'SELECT key, value FROM app_settings',
  );
  const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  const byClass: Record<string, number | null> = {
    cash: cashNzd,
    cashLiabilities: cashLiabilitiesNzd,
    stocks: stocksNzdValue,
    crypto: cryptoNzdValue,
    gomining: holdings.some((h) => h.asset_class === 'gomining_miner') ? gominingEst : null,
    art: artHas ? artVal : null,
    metals: metalsNzdValue,
    stones: stonesHas ? stonesVal : null,
    forex: forexNzdValue,
    realEstate: realEstateHas ? realEstateValue : null,
    realEstateMortgage: realEstateHas ? realEstateMortgage : null,
    realEstateEquity: realEstateEquity,
    collectables: collectablesHas ? collectablesVal : null,
    kiwiSaver: ks.length ? kiwiSaverNzd : null,
    debt: debtOutstandingNzd,
    assets: assetsKnownNzd,
    total: totalKnownNzd,
  };

  return {
    cashNzd,
    cashLiabilitiesNzd,
    stocksNzd: stocksNzdValue,
    stocksUseMarket: stocksHaveMarket,
    cryptoNzd: cryptoNzdValue,
    cryptoUseMarket: cryptoHaveMarket,
    gominingMinersNzd: holdings.some((h) => h.asset_class === 'gomining_miner')
      ? gominingEst
      : null,
    artNzd: artHas ? artVal : null,
    metalsNzd: metalsNzdValue,
    metalsUseSpot: metalsHaveQuote,
    metalsConfigured: metalsConfigured(),
    stonesNzd: stonesHas ? stonesVal : null,
    forexNzd: forexNzdValue,
    forexUseSpot: forexHaveQuote,
    realEstateNzd: realEstateHas ? realEstateValue : null,
    realEstateMortgageNzd: realEstateHas ? realEstateMortgage : null,
    realEstateEquityNzd: realEstateEquity,
    collectablesNzd: collectablesHas ? collectablesVal : null,
    kiwiSaverNzd: ks.length ? kiwiSaverNzd : null,
    debtOutstandingNzd,
    debtPersonCount,
    assetsKnownNzd,
    totalKnownNzd,
    hasUnavailableQuotes:
      (metalsHaveAny && !metalsHaveQuote) || (forexHaveAny && !forexHaveQuote),
    asOf: new Date().toISOString(),
    quoteNote: metalsHaveQuote
      ? 'Metals use Metals.Dev spot NZD; other live marks still stubbed (cost / manual). Never invented.'
      : metalsConfigured()
        ? 'Metals key set but no fresh spot yet — open Portfolio / Value search and Refresh. Other marks stubbed. Never invented.'
        : 'Live marks stubbed — totals use cost / manual. Set METALS_API_KEY (free at metals.dev) for metal spots. Never invented.',
    settings: {
      defaultCurrency: settingsMap.defaultCurrency ?? 'NZD',
      timezone: settingsMap.timezone ?? 'Pacific/Auckland',
      locale: settingsMap.locale ?? 'en-NZ',
    },
    counts: {
      accounts: accounts.length,
      holdings: holdings.length,
      gominingMiners: holdings.filter((h) => h.asset_class === 'gomining_miner').length,
      kiwisaver: ks.length,
      debtPeople: debtPersonCount,
    },
    breakdown: { byClass, holdings: holdingPoints },
  };
}
