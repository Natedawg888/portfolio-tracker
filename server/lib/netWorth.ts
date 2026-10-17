/**
 * Shared net-worth computation for /net-worth and valuation_snapshots.
 * Never invents balances — uses known cash, cost/market when quotes ok, manual vals.
 * Crypto = manual crypto holdings + read-only wallets (KAN-42); a wallet that can't be
 * valued is left out and flagged, and unpriced tokens count as 0 (no spam inflation).
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
import { readDbMetalQuotes } from '../quotes/metalQuotesDb.ts';
import { quotesForRead } from '../quotes/readQuotes.ts';
import { metalSpotQuoteNote, summarizeStoredMetalSpots } from '../quotes/metalSpotCopy.ts';
import { forexAssetKey } from '../quotes/forexQuotesDb.ts';
import type { MetalKind, MetalUnit } from '../../src/types/index.ts';
import { aucklandToday } from '../debts/model.ts';
import { isClosedQuantity, isTotalNotUnitQuote, parseNzdValueFromNotes } from '../../src/lib/holdingValue.ts';
import { applyScheduledInterestForUser } from '../debts/store.ts';
import { vehicleTotals } from '../vehicles/store.ts';
import { businessAssetTotals } from '../business/store.ts';
import { defiTotals } from '../crypto/store.ts';
import { bondTotals } from '../bonds/store.ts';
import { commodityTotals, isCommoditiesPlus } from '../commodities/store.ts';
import '../chain/index.ts'; // registers chain adapters for wallet balances
import { combineValuations, valueWallet, type WalletValuation } from '../chain/valuation.ts';
import type { WalletRef } from '../chain/service.ts';
import type { WalletNetwork } from './walletAddress.ts';

export type WalletValuer = (wallet: WalletRef) => Promise<WalletValuation>;

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
  /** Manual crypto holdings + wallets. */
  cryptoNzd: number;
  cryptoUseMarket: boolean;
  /** Manual crypto holdings only (market when quoted, else cost). */
  cryptoHoldingsNzd: number;
  /** Read-only wallets that could be valued (priced/stale items only); null when none added. */
  cryptoWalletsNzd: number | null;
  /** False when a wallet couldn't be valued or holds an unpriced non-zero asset. */
  cryptoWalletsComplete: boolean;
  cryptoWalletsFailed: number;
  /** Crypto as % of net worth (1 dp); null when there's no crypto or net worth ≤ 0. */
  cryptoPctOfNetWorth: number | null;
  gominingMinersNzd: number | null;
  artNzd: number | null;
  metalsNzd: number | null;
  metalsUseSpot: boolean;
  metalsConfigured: boolean;
  /** Spot table status. Independent of whether this user holds any metal. */
  metalsSpotStatus: 'ok' | 'stale' | 'unavailable';
  metalsSpotSource: 'gold-api' | 'metals_dev' | null;
  stonesNzd: number | null;
  forexNzd: number | null;
  forexUseSpot: boolean;
  realEstateNzd: number | null;
  realEstateMortgageNzd: number | null;
  realEstateEquityNzd: number | null;
  collectablesNzd: number | null;
  /** Vehicles counted in net worth (KAN-65): recorded value, loans entered on them, and the difference. */
  vehiclesNzd: number | null;
  vehicleLoansNzd: number | null;
  vehiclesEquityNzd: number | null;
  /** Businesses counted in net worth (KAN-84): each one's value from what it owns (assets plus linked produce). Field name kept for the API. */
  businessAssetsNzd: number | null;
  /** DeFi positions counted in net worth (KAN-47): recorded values, borrowing taken off. */
  defiNzd: number | null;
  /** Bonds and term deposits (KAN-80): recorded value or cost; TDs linked to a synced account are in cash already. */
  bondsNzd: number | null;
  /** The term-deposit part of bondsNzd. */
  bondsTermDepositsNzd: number | null;
  /** Commodities (KAN-81): values the user set; holdings with no value aren't counted. */
  commoditiesNzd: number | null;
  /** Plus: Commodities shows as its own class in the asset mix and on the Economic cycle page. */
  commoditiesExposure: boolean;
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
    /** NZD bank and wallet accounts behind cashNzd (not cards or foreign accounts). */
    cashAccounts: number;
    holdings: number;
    gominingMiners: number;
    kiwisaver: number;
    debtPeople: number;
    wallets: number;
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
      return name || 'Miner';
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
  /** Injectable for tests; defaults to sync-cached chain balances × crypto quotes. */
  valuer: WalletValuer = (w) => valueWallet(w),
): Promise<NetWorthResult> {
  const db = database ?? (await getDb());
  if (!userId) {
    throw new Error('computeNetWorth requires userId for per-user isolation');
  }
  // Stored quotes now; stale ones refresh in the background (see readQuotes.ts).
  await quotesForRead(db, userId);
  const metalSpots = summarizeStoredMetalSpots(readDbMetalQuotes(db));

  const accounts = queryAll<{
    balance: number;
    currency: string;
    account_type: string;
    notes: string | null;
  }>(db, `SELECT balance, currency, account_type, notes FROM bank_accounts WHERE user_id = ?`, [userId]);

  const nzdAccounts = accounts.filter((a) => (a.currency ?? '').toUpperCase() === 'NZD');

  const cashAccounts = nzdAccounts.filter((a) => isLiquidCashAccountType(a.account_type, a.notes));
  const cashNzd = cashAccounts.reduce((s, a) => s + balanceOf(a), 0);

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
    const q = queryOne(db, 'SELECT price, status, notes FROM price_quotes WHERE asset_key = ?', [
      `${prefix}:${symbol}`,
    ]);
    if (!q || q.status !== 'ok' || q.price == null) return null;
    if (isTotalNotUnitQuote(q.notes as string | null)) return null;
    const unit = Number(q.price);
    const n = qty != null ? Number(qty) : null;
    if (!Number.isFinite(unit) || n == null || !Number.isFinite(n) || n <= 0) return null;
    return unit * n;
  }

  /** NZD value Akahu still reports on a 0-quantity holding (its notes), else 0. */
  const closedPositionValue = (notes: unknown): number => {
    const v = parseNzdValueFromNotes(typeof notes === 'string' ? notes : null);
    return v != null && Number.isFinite(v) && v > 0 ? v : 0;
  };

  for (const h of holdings) {
    const rawCost = h.cost_basis_nzd;
    const cost =
      rawCost != null && Number.isFinite(Number(rawCost)) && Number(rawCost) > 0
        ? Number(rawCost)
        : 0;
    let lineValue: number | null = null;

    switch (h.asset_class) {
      case 'stock': {
        if (isClosedQuantity(h.shares)) {
          // Explicit 0 shares: only what Akahu still reports, never the old cost.
          const left = closedPositionValue(h.notes);
          // Same in both totals, so it counts whether or not other lines have a quote.
          stocksMarket += left;
          stocksCost += left;
          lineValue = left > 0 ? left : null;
          break;
        }
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
        if (isClosedQuantity(h.amount)) {
          const left = closedPositionValue(h.notes);
          // Same in both totals, so it counts whether or not other lines have a quote.
          cryptoMarket += left;
          cryptoCost += left;
          lineValue = left > 0 ? left : null;
          break;
        }
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

  // Read-only wallets: balances the sync job cached (fetched on a cache miss) × crypto quotes.
  const wallets = queryAll<{ id: string; name: string; network: string; address: string }>(
    db,
    'SELECT id, name, network, address FROM wallets WHERE user_id = ? ORDER BY created_at ASC',
    [userId],
  );
  const walletValuations = await Promise.all(
    wallets.map((w) => valuer({ network: w.network as WalletNetwork, address: w.address })),
  );
  const walletsCombined = combineValuations(walletValuations);
  wallets.forEach((w, i) => {
    const v = walletValuations[i];
    if (v.ok) {
      holdingPoints.push({ id: `wallet:${w.id}`, label: w.name, assetClass: 'crypto', valueNzd: v.totalNzd });
    }
  });
  const cryptoWalletsNzd = wallets.length ? walletsCombined.totalNzd : null;

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

  applyScheduledInterestForUser(db, userId, aucklandToday());
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
  const cryptoHoldingsNzd = cryptoHaveMarket ? cryptoMarket : cryptoCost;
  const cryptoNzdValue = cryptoHoldingsNzd + (cryptoWalletsNzd ?? 0);

  const realEstateEquity = realEstateHas ? realEstateValue - realEstateMortgage : null;
  // Vehicles (KAN-65): recorded value in assets; loans entered on them subtracted below. Loans
  // linked to a bank loan account are already in cashLiabilities.
  const vehicles = vehicleTotals(db, userId);
  const vehiclesValue = vehicles?.valueNzd ?? 0;
  const vehicleLoans = vehicles?.manualLoansNzd ?? 0;
  const defi = defiTotals(db, userId);
  const bonds = bondTotals(db, userId);
  const bondsValue = bonds ? bonds.bondsNzd + bonds.termDepositsNzd : 0;
  for (const b of bonds?.perBond ?? []) {
    holdingPoints.push({ id: b.id, label: b.label, assetClass: 'bond', valueNzd: b.valueNzd });
  }
  const commodities = commodityTotals(db, userId);
  for (const c of commodities?.perHolding ?? []) {
    holdingPoints.push({ id: c.id, label: c.label, assetClass: 'commodity', valueNzd: c.valueNzd });
  }
  for (const d of defi?.perPosition ?? []) {
    holdingPoints.push({ id: d.id, label: d.label, assetClass: 'defi', valueNzd: d.valueNzd });
  }
  for (const v of vehicles?.perVehicle ?? []) {
    holdingPoints.push({ id: v.id, label: v.name, assetClass: 'vehicle', valueNzd: v.valueNzd - v.loanNzd });
  }
  const business = businessAssetTotals(db, userId, aucklandToday());
  for (const b of business?.perBusiness ?? []) {
    holdingPoints.push({ id: b.id, label: b.name, assetClass: 'business', valueNzd: b.valueNzd });
  }
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
    vehiclesValue +
    (business?.valueNzd ?? 0) +
    (defi?.netNzd ?? 0) +
    bondsValue +
    (commodities?.valueNzd ?? 0) +
    kiwiSaverNzd;

  // Net worth = known assets − personal debt − real-estate mortgages (never invent)
  const totalKnownNzd = assetsKnownNzd - debtOutstandingNzd - (realEstateHas ? realEstateMortgage : 0) - vehicleLoans;

  const hasCrypto = cryptoNzdValue !== 0 || wallets.length > 0 || holdings.some((h) => h.asset_class === 'crypto');
  const cryptoPctOfNetWorth =
    hasCrypto && totalKnownNzd > 0 ? Math.round((cryptoNzdValue / totalKnownNzd) * 1000) / 10 : null;

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
    cryptoWallets: cryptoWalletsNzd,
    gomining: holdings.some((h) => h.asset_class === 'gomining_miner') ? gominingEst : null,
    art: artHas ? artVal : null,
    metals: metalsNzdValue,
    stones: stonesHas ? stonesVal : null,
    forex: forexNzdValue,
    realEstate: realEstateHas ? realEstateValue : null,
    realEstateMortgage: realEstateHas ? realEstateMortgage : null,
    realEstateEquity: realEstateEquity,
    collectables: collectablesHas ? collectablesVal : null,
    vehicles: vehicles ? vehiclesValue : null,
    vehicleLoans: vehicles ? vehicleLoans : null,
    vehiclesEquity: vehicles ? vehiclesValue - vehicleLoans : null,
    business: business ? business.valueNzd : null,
    defi: defi ? defi.netNzd : null,
    bonds: bonds ? bondsValue : null,
    commodities: commodities ? commodities.valueNzd : null,
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
    cryptoHoldingsNzd,
    cryptoWalletsNzd,
    cryptoWalletsComplete: walletsCombined.complete,
    cryptoWalletsFailed: walletsCombined.failedWallets,
    cryptoPctOfNetWorth,
    gominingMinersNzd: holdings.some((h) => h.asset_class === 'gomining_miner')
      ? gominingEst
      : null,
    artNzd: artHas ? artVal : null,
    metalsNzd: metalsNzdValue,
    metalsUseSpot: metalsHaveQuote,
    metalsConfigured: metalsConfigured(),
    metalsSpotStatus: metalSpots.status,
    metalsSpotSource: metalSpots.source,
    stonesNzd: stonesHas ? stonesVal : null,
    forexNzd: forexNzdValue,
    forexUseSpot: forexHaveQuote,
    realEstateNzd: realEstateHas ? realEstateValue : null,
    realEstateMortgageNzd: realEstateHas ? realEstateMortgage : null,
    realEstateEquityNzd: realEstateEquity,
    collectablesNzd: collectablesHas ? collectablesVal : null,
    vehiclesNzd: vehicles ? vehiclesValue : null,
    vehicleLoansNzd: vehicles ? vehicleLoans : null,
    vehiclesEquityNzd: vehicles ? vehiclesValue - vehicleLoans : null,
    businessAssetsNzd: business ? business.valueNzd : null,
    defiNzd: defi ? defi.netNzd : null,
    bondsNzd: bonds ? bondsValue : null,
    bondsTermDepositsNzd: bonds ? bonds.termDepositsNzd : null,
    commoditiesNzd: commodities ? commodities.valueNzd : null,
    commoditiesExposure: isCommoditiesPlus(db, userId),
    kiwiSaverNzd: ks.length ? kiwiSaverNzd : null,
    debtOutstandingNzd,
    debtPersonCount,
    assetsKnownNzd,
    totalKnownNzd,
    hasUnavailableQuotes:
      (metalsHaveAny && !metalsHaveQuote) || (forexHaveAny && !forexHaveQuote),
    asOf: new Date().toISOString(),
    quoteNote: metalSpotQuoteNote({
      configured: metalsConfigured(),
      status: metalSpots.status,
      source: metalSpots.source,
    }),
    settings: {
      defaultCurrency: settingsMap.defaultCurrency ?? 'NZD',
      timezone: settingsMap.timezone ?? 'Pacific/Auckland',
      locale: settingsMap.locale ?? 'en-NZ',
    },
    counts: {
      accounts: accounts.length,
      cashAccounts: cashAccounts.length,
      holdings: holdings.length,
      gominingMiners: holdings.filter((h) => h.asset_class === 'gomining_miner').length,
      kiwisaver: ks.length,
      debtPeople: debtPersonCount,
      wallets: wallets.length,
    },
    breakdown: { byClass, holdings: holdingPoints },
  };
}
