import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api, formatNzd, formatAuckland } from '../api/client';
import { maybeAutoSyncBankTransactions, maybeAutoSyncPortfolio } from '../lib/akahuTxnAutoSync';
import { showQuietToast } from '../lib/quietToast';
import {
  abandonPageRead,
  beginPageRead,
  commitPageRead,
  invalidateAfterExternalSync,
  invalidateFinancial,
  portfolioSyncChanged,
  readPageCache,
  txnSyncChanged,
  writePageCache,
} from '../lib/pageDataCache';
import { AssetBreakdownChart, type AssetBreakdownRow } from '../components/AssetBreakdownChart';
import { HoldingPriceChart } from '../components/HoldingPriceChart';
import {
  estimateMinerEarnings,
  aggregateMinerEarnings,
  formatEarningsAmount,
  type GoMiningNetworkParams,
  type GoMiningEarningsEstimate,
  type EarningsPeriod,
  type EarningsDisplayCurrency,
  type BtcFxRates,
} from '../lib/gominingEarnings';
import { HoldingIcon } from '../components/HoldingIcon';
import {
  ManaIcon,
  rarityLabel,
} from '../components/MtgFilters';
import { CollectablesPanel } from '../components/CollectablesPanel';
import { isApiCardGame, isManualCollectableGame } from '../lib/collectables';
import type { MtgColour } from '../types';
import { DividendTracker } from '../components/DividendTracker';
import {
  AddWalletDetails,
  WalletCard,
  WalletNotices,
  WalletsTotal,
} from '../components/CryptoWalletCards';
import { useCryptoWallets } from '../lib/cryptoWallets';
import { useAssetClassPrefs } from '../auth/AssetClassPrefsContext';
import type { AssetClassPrefKey } from '../lib/assetClassPrefs';
import { metalSpotHint, type MetalSpotSource, type MetalSpotStatus } from '../lib/metalSpotCopy';

type Holding = {
  id: string;
  assetClass: string;
  name: string;
  costBasisNzd: number | null;
  minerName?: string;
  hashrateThs?: number;
  energyEfficiencyWth?: number | null;
  rarity?: string | null;
  level?: number | null;
  estimatedValueNzd?: number | null;
  estimatedValueAt?: string | null;
  estimatedValueSource?: string | null;
  asset?: string;
  amount?: number;
  symbol?: string;
  shares?: number;
  exchange?: string | null;
  notes?: string;
  metal?: string;
  unit?: string;
  ownershipPct?: number;
  purchasePriceNzd?: number | null;
  purchaseDate?: string | null;
  lastValuationNzd?: number | null;
  artworkTitle?: string;
  artist?: string;
  artKind?: 'fractional' | 'physical' | null;
  stoneType?: string;
  carat?: number;
  clarity?: string | null;
  cut?: string | null;
  colour?: string | null;
  valuationNzd?: number | null;
  valuationSource?: string | null;
  valuationNotes?: string | null;
  lastValuationAt?: string | null;
  source?: string;
  /** Akahu / Sharesies instrument logo (icons only). */
  logoUrl?: string | null;
  marketValueNzd?: number | null;
  spotPriceNzdPerOzT?: number | null;
  spotAsOf?: string | null;
  /** forex ISO currency (USD/EUR/GBP) */
  currency?: string;
  unitPriceNzd?: number | null;
  quoteAsOf?: string | null;
  quoteNotes?: string | null;
  /** real_estate */
  propertyValueNzd?: number | null;
  mortgageOutstandingNzd?: number | null;
  equityNzd?: number | null;
  photoPath?: string | null;
  photoUrl?: string | null;
  /** collectable */
  cardGame?: string | null;
  cardSet?: string | null;
  cardNumber?: string | null;
  cardFinish?: string | null;
  cardApiId?: string | null;
  cardImageUrl?: string | null;
  cardColours?: MtgColour[] | null;
  cardRarity?: string | null;
  quantity?: number | null;
};

const emptyMiner = {
  minerName: '',
  hashrateThs: '',
  energyEfficiencyWth: '',
  rarity: '',
  level: '',
  costBasisNzd: '',
  acquiredAt: '',
  estimatedValueNzd: '',
  notes: '',
};

type GoMiningIncomeRates = {
  poolIncomeUsdPerTh: number | null;
  poolIncomeBtcPerTh: number | null;
  poolIncomeSatPerTh: number | null;
  btcCourseInUsd: number | null;
  impliedKwhCostUsd?: number | null;
  goBtcPaySatPerTh?: number;
  goBtcPayBtcPerTh?: number;
  goBtcPayStatus?: 'ok' | 'unavailable';
  goBtcPayMessage?: string | null;
  status: 'ok' | 'unavailable';
  source?: string | null;
  asOf?: string | null;
  message?: string | null;
};

type GoMiningNetworkLive = {
  networkHashrateEhs: number | null;
  status: 'ok' | 'unavailable';
  source?: string | null;
  asOf?: string | null;
  message?: string | null;
};

type GominingUiSettings = {
  discountPct: number;
  btcUsd: string;
  networkHashrateEhs: string;
  dailyBtcIssuance: string;
  kWhCostUsd: string;
  note: string;
  fx: BtcFxRates | null;
  income: GoMiningIncomeRates | null;
  networkLive: GoMiningNetworkLive | null;
  /** Effective EH/s used in estimates (manual override or live). */
  effectiveNetworkEhs: number | null;
  fxLoading?: boolean;
  displayCurrency: EarningsDisplayCurrency;
};

const emptyGmSettings: GominingUiSettings = {
  discountPct: 0,
  btcUsd: '',
  networkHashrateEhs: '',
  dailyBtcIssuance: '',
  kWhCostUsd: '',
  note: '',
  fx: null,
  income: null,
  networkLive: null,
  effectiveNetworkEhs: null,
  fxLoading: true,
  displayCurrency: 'ALL',
};

const emptyCrypto = {
  ticker: '',
  amount: '',
  costBasisNzd: '',
  notes: '',
};

const emptyStock = {
  ticker: '',
  shares: '',
  costBasisNzd: '',
  exchange: '',
  notes: '',
};

const emptyMetal = {
  name: '',
  metal: 'gold' as 'gold' | 'silver' | 'platinum' | 'palladium',
  amount: '',
  unit: 'g' as 'g' | 'oz_t',
  costBasisNzd: '',
  notes: '',
};

const emptyForex = {
  currency: 'USD',
  amount: '',
  costBasisNzd: '',
  source: 'Revolut',
  notes: '',
};

const emptyRealEstate = {
  name: '',
  propertyValueNzd: '',
  mortgageOutstandingNzd: '',
  costBasisNzd: '',
  acquiredAt: '',
  notes: '',
  photoBase64: '' as string,
};

const emptyArt = {
  artKind: 'fractional' as 'fractional' | 'physical',
  artworkTitle: '',
  artist: '',
  ownershipPct: '',
  purchasePriceNzd: '',
  purchaseDate: '',
  lastValuationNzd: '',
  appraisalNzd: '',
  notes: '',
  externalId: '',
  photoBase64: '' as string,
};

const DIAMOND_COLOURS = ['D','E','F','G','H','I','J','K','L','M'] as const;
const DIAMOND_CLARITIES = ['FL','IF','VVS1','VVS2','VS1','VS2','SI1','SI2'] as const;
const DIAMOND_SHAPES = [
  'round','cushion','radiant','emerald','oval','pear','marquise','heart',
] as const;

function isDiamondStoneTypeUi(stoneType: string): boolean {
  const t = stoneType.trim().toLowerCase();
  return t === 'diamond' || t === 'natural diamond' || t === 'natural_diamond';
}

const emptyStone = {
  name: '',
  stoneType: 'Diamond',
  stoneTypeOther: '',
  carat: '',
  colour: 'G',
  clarity: 'VS2',
  cut: 'round',
  costBasisNzd: '',
  valuationNzd: '',
  notes: '',
};



/**
 * Parse NZD market value from Akahu / holding notes.
 * Only accepts an explicit NZD figure — never treats USD/other as NZD.
 */
export function parseNzdValueFromNotes(notes?: string | null): number | null {
  if (!notes) return null;
  // Prefer explicit FX conversion: "44.78 USD → 79.33 NZD @ rate"
  const arrow = notes.match(/→\s*([\d.]+)\s*NZD\b/i);
  if (arrow) {
    const n = Number(arrow[1]);
    return Number.isFinite(n) ? n : null;
  }
  // Reject notes that only carry a non-NZD value (e.g. "11.89 USD (no FX applied)")
  if (/\b(?:USD|AUD|EUR|GBP)\b/i.test(notes) && /\bno FX\b|\bFX unavailable\b/i.test(notes)) {
    return null;
  }
  const nzdMatch = notes.match(
    /(?:Akahu\s+(?:market\s+)?value[:\s]*|Akahu\s+portfolio\s+value\s+|Akahu\s+total\s+value\s+|value\s+)([\d.]+)\s*NZD\b/i,
  );
  if (nzdMatch) {
    const n = Number(nzdMatch[1]);
    return Number.isFinite(n) ? n : null;
  }
  // Broader: any "NUMBER NZD" in notes
  const anyNzd = notes.match(/\b([\d.]+)\s*NZD\b/i);
  if (anyNzd) {
    const n = Number(anyNzd[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Market value in NZD when known — never invent FX or prices. */
export function marketValueNzd(h: Holding): number | null {
  if (h.assetClass === 'gomining_miner' && h.estimatedValueNzd != null && Number.isFinite(h.estimatedValueNzd)) {
    return Number(h.estimatedValueNzd);
  }
  if (h.assetClass === 'art') {
    if (h.lastValuationNzd != null && Number.isFinite(h.lastValuationNzd)) {
      return Number(h.lastValuationNzd);
    }
    if (h.purchasePriceNzd != null && Number.isFinite(h.purchasePriceNzd)) {
      return Number(h.purchasePriceNzd);
    }
    return null;
  }
  if (h.assetClass === 'stone' && h.valuationNzd != null && Number.isFinite(h.valuationNzd)) {
    return Number(h.valuationNzd);
  }
  if (h.assetClass === 'real_estate') {
    // Card Value shows equity (value − mortgage); gross in meta
    if (h.equityNzd != null && Number.isFinite(h.equityNzd)) return Number(h.equityNzd);
    if (h.propertyValueNzd != null && Number.isFinite(h.propertyValueNzd)) {
      const mort = h.mortgageOutstandingNzd != null ? Number(h.mortgageOutstandingNzd) : 0;
      return Number(h.propertyValueNzd) - (Number.isFinite(mort) ? mort : 0);
    }
  }
  if (h.assetClass === 'collectable') {
    if (h.marketValueNzd != null && Number.isFinite(h.marketValueNzd)) return Number(h.marketValueNzd);
    if (h.valuationNzd != null && Number.isFinite(h.valuationNzd)) return Number(h.valuationNzd);
  }
  // Stocks / crypto / metals: prefer API marketValueNzd (Akahu × live FX or Metals.Dev)
  if (h.marketValueNzd != null && Number.isFinite(h.marketValueNzd)) {
    return Number(h.marketValueNzd);
  }
  return parseNzdValueFromNotes(h.notes);
}

/** Display cost: blank/— when unknown; never show fake $0 for Akahu unknowns. */
export function displayCostBasisNzd(h: Holding): number | null {
  const c = h.costBasisNzd;
  if (c == null || !Number.isFinite(c)) {
    if (
      h.assetClass === 'art' &&
      h.purchasePriceNzd != null &&
      Number.isFinite(h.purchasePriceNzd)
    ) {
      return Number(h.purchasePriceNzd);
    }
    return null;
  }
  if (c === 0 && (h.source === 'Sharesies' || h.source === 'Hatch')) return null;
  return c;
}

/**
 * Return ($) / Earnings (%) from value vs cost.
 * Blank/missing/non-finite cost is treated as $0 for P&L (Cost display may still show —).
 * returnNzd = value - cost; pct = return/cost*100, or ±∞% when cost is 0 and value ≠ 0.
 */
export function computeReturn(
  valueNzd: number | null,
  costBasisNzd: number | null,
): { returnNzd: number; pct: number } | null {
  if (valueNzd == null || !Number.isFinite(valueNzd)) return null;
  const cost =
    costBasisNzd == null || !Number.isFinite(costBasisNzd) ? 0 : costBasisNzd;
  const returnNzd = valueNzd - cost;
  let pct: number;
  if (cost === 0) {
    if (valueNzd === 0) pct = 0;
    else pct = valueNzd > 0 ? Infinity : -Infinity;
  } else {
    pct = (returnNzd / cost) * 100;
  }
  return { returnNzd, pct };
}

function parseOptionalNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatAmount(n: number | null | undefined, digits = 6): string {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-NZ', {
    maximumFractionDigits: digits,
  }).format(n);
}

function formatPct(pct: number): string {
  if (pct === Infinity) return '+∞%';
  if (pct === -Infinity) return '-∞%';
  if (!Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function tickerFor(h: Holding): string {
  if (h.assetClass === 'stock') return (h.symbol ?? h.name).toUpperCase();
  if (h.assetClass === 'crypto') return (h.asset ?? h.name).toUpperCase();
  if (h.assetClass === 'gomining_miner') return 'GM';
  if (h.assetClass === 'metal') return (h.metal ?? 'METAL').toUpperCase().slice(0, 4);
  if (h.assetClass === 'forex') return (h.currency ?? h.asset ?? 'FX').toUpperCase().slice(0, 3);
  if (h.assetClass === 'art') return 'ART';
  if (h.assetClass === 'stone') return (h.stoneType ?? 'ST').toUpperCase().slice(0, 3);
  if (h.assetClass === 'real_estate') return 'RE';
  if (h.assetClass === 'collectable') {
    const g = (h.cardGame ?? 'CARD').toUpperCase();
    return g === 'POKEMON' ? 'PKMN' : g === 'MTG' ? 'MTG' : g.slice(0, 4);
  }
  return h.name.slice(0, 2).toUpperCase();
}

function displayName(h: Holding): string {
  if (h.assetClass === 'gomining_miner') return h.minerName ?? h.name;
  if (h.assetClass === 'art') return h.artworkTitle ?? h.name;
  if (h.assetClass === 'metal') return h.name || (h.metal ?? 'Metal');
  if (h.assetClass === 'forex') {
    const cur = (h.currency ?? h.asset ?? 'FX').toUpperCase();
    const src = h.source?.trim();
    return h.name || (src ? `${cur} (${src})` : cur);
  }
  if (h.assetClass === 'stone') return h.name || (h.stoneType ?? 'Stone');
  if (h.assetClass === 'real_estate') return h.name || 'Property';
  if (h.assetClass === 'collectable') {
    const bits = [h.name];
    if (h.cardSet) bits.push(String(h.cardSet).toUpperCase());
    if (h.cardNumber) bits.push(`#${h.cardNumber}`);
    return bits.filter(Boolean).join(' · ');
  }
  return h.name;
}

function amountLabel(h: Holding): string {
  switch (h.assetClass) {
    case 'stock':
      return `${formatAmount(h.shares, 4)} shares`;
    case 'crypto':
      return `${formatAmount(h.amount)} ${h.asset ?? ''}`.trim();
    case 'gomining_miner':
      return `${formatAmount(h.hashrateThs, 2)} TH/s`;
    case 'metal': {
      const unit = h.unit === 'oz_t' ? 'oz t' : h.unit === 'g' ? 'g' : h.unit ?? '';
      return `${formatAmount(h.amount, 4)} ${unit}`.trim();
    }
    case 'forex': {
      const cur = (h.currency ?? h.asset ?? '').toUpperCase();
      return `${formatAmount(h.amount, 2)} ${cur}`.trim();
    }
    case 'art':
      return h.ownershipPct != null ? `${formatAmount(h.ownershipPct, 2)}% ownership` : '—';
    case 'stone':
      return h.carat != null ? `${formatAmount(h.carat, 3)} ct` : '—';
    case 'real_estate': {
      const pv = h.propertyValueNzd != null ? formatNzd(h.propertyValueNzd) : '—';
      const mort = formatNzd(h.mortgageOutstandingNzd ?? 0);
      return `Value ${pv} · Mortgage ${mort}`;
    }
    case 'collectable': {
      const q = h.quantity ?? h.amount ?? 1;
      const fin = h.cardFinish ? ` · ${h.cardFinish}` : '';
      return `${formatAmount(q, 0)}× ${(h.cardGame ?? 'card').toUpperCase()}${fin}`;
    }
    default:
      return '—';
  }
}

const PERIOD_LABELS: { key: EarningsPeriod; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
];

function parseOptNum(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function networkFromUi(s: GominingUiSettings): GoMiningNetworkParams {
  const manualEhs = parseOptNum(s.networkHashrateEhs);
  const liveEhs =
    s.effectiveNetworkEhs ??
    (s.networkLive?.status === 'ok' ? s.networkLive.networkHashrateEhs : null);
  const poolBtc =
    s.income?.status === 'ok' ? s.income.poolIncomeBtcPerTh ?? null : null;
  const poolUsd =
    s.income?.status === 'ok' ? s.income.poolIncomeUsdPerTh ?? null : null;
  // Prefer manual BTC override; else GoMining payout course (matches app C1/C2).
  const courseBtc =
    s.income?.status === 'ok' ? s.income.btcCourseInUsd ?? null : null;
  const manualKwh = parseOptNum(s.kWhCostUsd);
  const impliedKwh =
    s.income?.status === 'ok' ? s.income.impliedKwhCostUsd ?? null : null;
  const gbpSat =
    s.income?.status === 'ok' ? s.income.goBtcPaySatPerTh ?? null : null;
  const gbpBtc =
    s.income?.status === 'ok' ? s.income.goBtcPayBtcPerTh ?? null : null;
  return {
    btcUsd: parseOptNum(s.btcUsd) ?? courseBtc,
    poolIncomeUsdPerTh: poolUsd,
    poolIncomeBtcPerTh: poolBtc,
    goBtcPaySatPerTh: gbpSat,
    goBtcPayBtcPerTh: gbpBtc,
    networkHashrateEhs: manualEhs ?? liveEhs,
    dailyBtcIssuance: parseOptNum(s.dailyBtcIssuance),
    kWhCostUsd: manualKwh ?? impliedKwh,
  };
}

function EarningsPeriodsGrid({
  estimate,
  displayCurrency,
  fxNote,
}: {
  estimate: GoMiningEarningsEstimate | null;
  displayCurrency: EarningsDisplayCurrency;
  fxNote?: string | null;
}) {
  if (!estimate) {
    return (
      <p className="muted small holding-card-meta">Earnings estimate: unavailable</p>
    );
  }
  const hasNet = estimate.netBtcStatus === 'ok';
  const hasPool = estimate.poolRewardStatus === 'ok';
  const preferNet = hasNet;
  const currencies: Array<'BTC' | 'USD' | 'NZD'> =
    displayCurrency === 'ALL' ? ['BTC', 'USD', 'NZD'] : [displayCurrency];

  return (
    <div className="earnings-periods">
      <p className="earnings-periods-label muted small">
        Earnings estimate
        {hasNet ? ' (net)' : hasPool ? ' (pool — maint. incomplete)' : ' (stubbed)'}
        {fxNote ? ` · ${fxNote}` : ''}
      </p>
      {currencies.map((cur) => (
        <div key={cur} className="earnings-currency-block">
          {displayCurrency === 'ALL' && (
            <p className="earnings-currency-tag muted small">{cur}</p>
          )}
          <dl className="earnings-periods-grid">
            {PERIOD_LABELS.map(({ key, label }) => {
              const slice = estimate.periods[key];
              return (
                <div key={`${cur}-${key}`}>
                  <dt>{label}</dt>
                  <dd>
                    {hasNet || hasPool
                      ? formatEarningsAmount(slice, cur, preferNet)
                      : '—'}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
      {estimate.maintenanceUsdAfterDiscount != null && (
        <p className="muted small holding-card-meta">
          Maint. ~${estimate.maintenanceUsdAfterDiscount.toFixed(4)}/day
          {estimate.discountPct > 0 ? ` (−${estimate.discountPct}% on C1+C2)` : ''}
        </p>
      )}
      {!hasNet && estimate.netBtcMessage && (
        <p className="muted small holding-card-meta" title={estimate.netBtcMessage}>
          {estimate.netBtcMessage}
        </p>
      )}
    </div>
  );
}

function HoldingCard({
  holding,
  onRefresh,
  onDelete,
  onUpdateMiner,
  onUpdateQuantity,
  onUpdateArt,
  earnings,
  displayCurrency = 'ALL',
  fxNote,
}: {
  holding: Holding;
  onRefresh?: (id: string) => void;
  onDelete?: (id: string) => void;
  onUpdateMiner?: (
    id: string,
    patch: {
      hashrateThs: number;
      energyEfficiencyWth: number | null;
      estimatedValueNzd?: number | null;
    },
  ) => Promise<void>;
  onUpdateQuantity?: (id: string, quantity: number) => Promise<void>;
  onUpdateArt?: (
    id: string,
    patch: {
      lastValuationNzd?: number | null;
      appraisalNzd?: number | null;
      ownershipPct?: number;
      purchasePriceNzd?: number | null;
      purchaseDate?: string | null;
    },
  ) => Promise<void>;
  earnings?: GoMiningEarningsEstimate | null;
  displayCurrency?: EarningsDisplayCurrency;
  fxNote?: string | null;
}) {
  const ticker = tickerFor(holding);
  const value = marketValueNzd(holding);
  const cost = displayCostBasisNzd(holding);
  const ret = computeReturn(value, cost);
  const showRefresh =
    holding.assetClass === 'gomining_miner' ||
    holding.assetClass === 'crypto' ||
    holding.assetClass === 'metal' ||
    holding.assetClass === 'stock' ||
    holding.assetClass === 'forex' ||
    (holding.assetClass === 'collectable' && isApiCardGame(holding.cardGame)) ||
    (holding.assetClass === 'stone' &&
      isDiamondStoneTypeUi(String(holding.stoneType ?? '')) &&
      holding.carat != null &&
      Boolean(holding.colour) &&
      Boolean(holding.clarity));

  const [editing, setEditing] = useState(false);
  const [editQuantity, setEditQuantity] = useState(
    String(holding.assetClass === 'stock' ? holding.shares ?? '' : holding.amount ?? ''),
  );
  const [editTh, setEditTh] = useState(String(holding.hashrateThs ?? ''));
  const [editEe, setEditEe] = useState(
    holding.energyEfficiencyWth != null ? String(holding.energyEfficiencyWth) : '',
  );
  const [editEst, setEditEst] = useState(
    holding.estimatedValueNzd != null ? String(holding.estimatedValueNzd) : '',
  );
  const [editArtVal, setEditArtVal] = useState(
    holding.lastValuationNzd != null ? String(holding.lastValuationNzd) : '',
  );
  const [editArtOwn, setEditArtOwn] = useState(
    holding.ownershipPct != null ? String(holding.ownershipPct) : '',
  );
  const [editArtPurchase, setEditArtPurchase] = useState(
    holding.purchasePriceNzd != null ? String(holding.purchasePriceNzd) : '',
  );
  const [editArtDate, setEditArtDate] = useState(holding.purchaseDate ?? '');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const minerThInputRef = useRef<HTMLInputElement>(null);

  // Keep edit fields in sync when holding updates from parent reload.
  useEffect(() => {
    if (!editing) {
      setEditQuantity(
        String(holding.assetClass === 'stock' ? holding.shares ?? '' : holding.amount ?? ''),
      );
      setEditTh(String(holding.hashrateThs ?? ''));
      setEditEe(
        holding.energyEfficiencyWth != null ? String(holding.energyEfficiencyWth) : '',
      );
      setEditEst(
        holding.estimatedValueNzd != null ? String(holding.estimatedValueNzd) : '',
      );
      setEditArtVal(
        holding.lastValuationNzd != null ? String(holding.lastValuationNzd) : '',
      );
      setEditArtOwn(
        holding.ownershipPct != null ? String(holding.ownershipPct) : '',
      );
      setEditArtPurchase(
        holding.purchasePriceNzd != null ? String(holding.purchasePriceNzd) : '',
      );
      setEditArtDate(holding.purchaseDate ?? '');
    }
  }, [
    holding.assetClass,
    holding.shares,
    holding.amount,
    holding.hashrateThs,
    holding.energyEfficiencyWth,
    holding.estimatedValueNzd,
    holding.lastValuationNzd,
    holding.ownershipPct,
    holding.purchasePriceNzd,
    holding.purchaseDate,
    editing,
  ]);

  useEffect(() => {
    if (!editing || holding.assetClass !== 'gomining_miner') return;
    minerThInputRef.current?.focus();
  }, [editing, holding.assetClass]);

  useEffect(() => {
    if (!editing || holding.assetClass !== 'gomining_miner') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || savingEdit) return;
      setEditing(false);
      setEditError(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, holding.assetClass, savingEdit]);

  async function saveQuantity(e: FormEvent) {
    e.preventDefault();
    if (!onUpdateQuantity) return;
    setEditError(null);
    const quantity = Number(editQuantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      setEditError(
        holding.assetClass === 'stock'
          ? 'Shares must be a finite, non-negative number'
          : 'Amount must be a finite, non-negative number',
      );
      return;
    }
    setSavingEdit(true);
    try {
      await onUpdateQuantity(holding.id, quantity);
      setEditing(false);
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }

  function openMinerEdit() {
    if (editing) return;
    setEditTh(String(holding.hashrateThs ?? ''));
    setEditEe(
      holding.energyEfficiencyWth != null ? String(holding.energyEfficiencyWth) : '',
    );
    setEditEst(
      holding.estimatedValueNzd != null ? String(holding.estimatedValueNzd) : '',
    );
    setEditError(null);
    setEditing(true);
  }

  function closeMinerEdit() {
    if (savingEdit) return;
    setEditing(false);
    setEditError(null);
  }

  async function saveMinerSpecs(e: FormEvent) {
    e.preventDefault();
    if (!onUpdateMiner) return;
    setEditError(null);
    const th = Number(editTh);
    if (!Number.isFinite(th) || th <= 0) {
      setEditError('TH/s must be a positive number');
      return;
    }
    const eeRaw = editEe.trim();
    const ee = eeRaw === '' ? null : Number(eeRaw);
    if (eeRaw !== '' && (!Number.isFinite(ee!) || ee! < 0)) {
      setEditError('Energy efficiency must be ≥ 0 or blank');
      return;
    }
    const estRaw = editEst.trim();
    let estimatedValueNzd: number | null | undefined = undefined;
    if (estRaw === '') {
      estimatedValueNzd = null;
    } else {
      const est = Number(estRaw);
      if (!Number.isFinite(est) || est < 0) {
        setEditError('Est. NZD must be ≥ 0 or blank');
        return;
      }
      estimatedValueNzd = est;
    }
    setSavingEdit(true);
    try {
      await onUpdateMiner(holding.id, {
        hashrateThs: th,
        energyEfficiencyWth: ee,
        estimatedValueNzd,
      });
      setEditing(false);
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }


  async function saveArt(e: FormEvent) {
    e.preventDefault();
    if (!onUpdateArt) return;
    setEditError(null);
    const valRaw = editArtVal.trim();
    let lastValuationNzd: number | null | undefined = undefined;
    if (valRaw === '') {
      // Physical requires appraisal — keep required on save when physical
      if (holding.artKind === 'physical') {
        setEditError('Appraisal NZD required for physical art (manual — never invent)');
        return;
      }
      lastValuationNzd = null;
    } else {
      const v = Number(valRaw);
      if (!Number.isFinite(v) || v < 0) {
        setEditError('Appraisal / valuation NZD must be ≥ 0');
        return;
      }
      lastValuationNzd = v;
    }
    const patch: {
      lastValuationNzd?: number | null;
      ownershipPct?: number;
      purchasePriceNzd?: number | null;
      purchaseDate?: string | null;
    } = { lastValuationNzd };
    if (holding.artKind !== 'physical') {
      const ownRaw = editArtOwn.trim();
      if (ownRaw !== '') {
        const own = Number(ownRaw);
        if (!Number.isFinite(own) || own <= 0 || own > 100) {
          setEditError('Ownership % must be > 0 and ≤ 100');
          return;
        }
        patch.ownershipPct = own;
      }
      const purRaw = editArtPurchase.trim();
      if (purRaw !== '') {
        const pur = Number(purRaw);
        if (!Number.isFinite(pur) || pur < 0) {
          setEditError('Purchase price NZD must be ≥ 0');
          return;
        }
        patch.purchasePriceNzd = pur;
      }
      if (editArtDate.trim()) {
        patch.purchaseDate = editArtDate.trim();
      }
    }
    setSavingEdit(true);
    try {
      await onUpdateArt(holding.id, patch);
      setEditing(false);
    } catch (err) {
      setEditError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }


  return (
    <article className="holding-card">
      <header className="holding-card-head">
        <HoldingIcon
          ticker={ticker}
          assetClass={holding.assetClass}
          iconUrl={
            holding.assetClass === 'real_estate'
              ? holding.photoUrl
              : holding.assetClass === 'art'
                ? holding.photoUrl
                : holding.assetClass === 'collectable'
                  ? isManualCollectableGame(holding.cardGame)
                    ? holding.photoUrl
                    : holding.cardImageUrl || holding.photoUrl
                  : holding.assetClass === 'stock' || holding.assetClass === 'crypto'
                    ? holding.logoUrl
                    : undefined
          }
        />
        <div className="holding-card-titles">
          <h4 className="holding-card-name">{displayName(holding)}</h4>
          <span className="holding-card-ticker muted small">{ticker}</span>
        </div>
      </header>
      {(holding.assetClass === 'real_estate' ||
        holding.assetClass === 'art' ||
        (holding.assetClass === 'collectable' && isManualCollectableGame(holding.cardGame))) &&
        holding.photoUrl && (
        <img
          className="holding-property-photo"
          src={holding.photoUrl}
          alt=""
          loading="lazy"
        />
      )}

      <div className="holding-card-amount">{amountLabel(holding)}</div>

      <dl className="holding-card-stats">
        <div>
          <dt>Cost</dt>
          <dd>{formatNzd(cost)}</dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd>{formatNzd(value)}</dd>
        </div>
        <div>
          <dt>Return</dt>
          <dd
            className={
              ret == null
                ? undefined
                : ret.pct >= 0
                  ? 'return-pos'
                  : 'return-neg'
            }
          >
            {ret == null ? '—' : formatPct(ret.pct)}
          </dd>
        </div>
        <div>
          <dt>Earnings</dt>
          <dd
            className={
              ret == null
                ? undefined
                : ret.returnNzd >= 0
                  ? 'return-pos'
                  : 'return-neg'
            }
          >
            {ret == null ? '—' : formatNzd(ret.returnNzd)}
          </dd>
        </div>
      </dl>

      {(holding.assetClass === 'stock' ||
        holding.assetClass === 'crypto' ||
        holding.assetClass === 'forex') &&
        onUpdateQuantity && (
          <div className="holding-quantity-edit">
            {!editing ? (
              <button
                type="button"
                className="btn ghost holding-card-action"
                onClick={() => {
                  setEditQuantity(
                    String(holding.assetClass === 'stock' ? holding.shares ?? '' : holding.amount ?? ''),
                  );
                  setEditError(null);
                  setEditing(true);
                }}
              >
                Edit {holding.assetClass === 'stock' ? 'shares' : 'amount'}
              </button>
            ) : (
              <form className="holding-quantity-form" onSubmit={saveQuantity}>
                <label>
                  {holding.assetClass === 'stock' ? 'Shares' : 'Amount'}
                  <input
                    type="number"
                    step="any"
                    min={0}
                    value={editQuantity}
                    onChange={(e) => setEditQuantity(e.target.value)}
                    required
                    aria-label={
                      holding.assetClass === 'stock'
                        ? 'Shares'
                        : holding.assetClass === 'forex'
                          ? 'Forex amount'
                          : 'Crypto amount'
                    }
                  />
                </label>
                <div className="holding-quantity-actions">
                  <button type="submit" className="btn primary" disabled={savingEdit}>
                    {savingEdit ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={savingEdit}
                    onClick={() => {
                      setEditing(false);
                      setEditError(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
                {editError && <p className="muted small holding-quantity-error">{editError}</p>}
              </form>
            )}
          </div>
        )}

      {holding.assetClass === 'art' && onUpdateArt && (
        <div className="holding-quantity-edit">
          {!editing ? (
            <button
              type="button"
              className="btn ghost holding-card-action"
              onClick={() => {
                setEditArtVal(
                  holding.lastValuationNzd != null ? String(holding.lastValuationNzd) : '',
                );
                setEditArtOwn(
                  holding.ownershipPct != null ? String(holding.ownershipPct) : '',
                );
                setEditArtPurchase(
                  holding.purchasePriceNzd != null ? String(holding.purchasePriceNzd) : '',
                );
                setEditArtDate(holding.purchaseDate ?? '');
                setEditError(null);
                setEditing(true);
              }}
            >
              Edit {holding.artKind === 'physical' ? 'appraisal' : 'valuation'}
            </button>
          ) : (
            <form className="holding-quantity-form" onSubmit={saveArt}>
              <label>
                {holding.artKind === 'physical' ? 'Appraisal NZD' : 'Latest valuation NZD'}
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={editArtVal}
                  onChange={(e) => setEditArtVal(e.target.value)}
                  required={holding.artKind === 'physical'}
                  placeholder="Manual only — never invent"
                  aria-label={
                    holding.artKind === 'physical' ? 'Appraisal NZD' : 'Latest valuation NZD'
                  }
                />
              </label>
              {holding.artKind !== 'physical' && (
                <>
                  <label>
                    Ownership %
                    <input
                      type="number"
                      step="any"
                      min={0}
                      max={100}
                      value={editArtOwn}
                      onChange={(e) => setEditArtOwn(e.target.value)}
                      aria-label="Ownership percent"
                    />
                  </label>
                  <label>
                    Purchase price NZD
                    <input
                      type="number"
                      step="any"
                      min={0}
                      value={editArtPurchase}
                      onChange={(e) => setEditArtPurchase(e.target.value)}
                      aria-label="Purchase price NZD"
                    />
                  </label>
                  <label>
                    Purchase date
                    <input
                      type="date"
                      value={editArtDate}
                      onChange={(e) => setEditArtDate(e.target.value)}
                      aria-label="Purchase date"
                    />
                  </label>
                </>
              )}
              <div className="holding-quantity-actions">
                <button type="submit" className="btn primary" disabled={savingEdit}>
                  {savingEdit ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={savingEdit}
                  onClick={() => {
                    setEditing(false);
                    setEditError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
              {editError && <p className="muted small holding-quantity-error">{editError}</p>}
            </form>
          )}
        </div>
      )}

      {holding.assetClass === 'gomining_miner' && (
        <>
          <p className="muted small holding-card-meta">
            {[
              holding.energyEfficiencyWth != null
                ? `${formatAmount(holding.energyEfficiencyWth, 2)} W/TH`
                : null,
              holding.rarity,
              holding.level != null ? `Lv ${holding.level}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Miner'}
            {holding.estimatedValueNzd != null && (
              <>
                {' '}
                · est.{' '}
                {holding.estimatedValueSource === 'gomining'
                  ? 'marketplace'
                  : holding.estimatedValueSource === 'gomining_extrapolated'
                    ? 'estimate extrapolated from primary 12/15 W/TH'
                    : holding.estimatedValueSource === 'manual'
                      ? 'manual'
                      : holding.estimatedValueSource ?? 'value'}{' '}
                {formatNzd(holding.estimatedValueNzd)}
              </>
            )}
            {holding.estimatedValueAt && (
              <> · valued {formatAuckland(holding.estimatedValueAt)}</>
            )}
          </p>
          {earnings?.netSatPerTh != null && (
            <p className="muted small holding-card-meta">
              ~{earnings.netSatPerTh.toFixed(4)} sat/TH/day net
              {earnings.goBtcPaySatPerTh > 0
                ? ` · GBP ${earnings.goBtcPaySatPerTh.toFixed(4)}`
                : ''}
            </p>
          )}
          {onUpdateMiner && (
            <div className="miner-edit">
              <button
                type="button"
                className="btn ghost holding-card-action"
                aria-haspopup="dialog"
                aria-expanded={editing}
                aria-controls={`miner-edit-dialog-${holding.id}`}
                onClick={openMinerEdit}
              >
                Edit TH / EE / Est. NZD
              </button>
            </div>
          )}
          {onUpdateMiner && editing && (
            <div
              className="modal-overlay"
              role="presentation"
              onClick={(e) => {
                if (e.target === e.currentTarget) closeMinerEdit();
              }}
            >
              <div
                className="modal-dialog miner-edit-dialog"
                id={`miner-edit-dialog-${holding.id}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={`miner-edit-title-${holding.id}`}
                aria-describedby={`miner-edit-desc-${holding.id}`}
              >
                <div className="modal-header">
                  <h3 id={`miner-edit-title-${holding.id}`}>Edit {displayName(holding)}</h3>
                  <button
                    type="button"
                    className="btn small modal-close"
                    aria-label="Close"
                    disabled={savingEdit}
                    onClick={closeMinerEdit}
                  >
                    ×
                  </button>
                </div>
                <p className="section-desc" id={`miner-edit-desc-${holding.id}`}>
                  TH/s is this miner’s computing power. EE is energy efficiency in watts per
                  terahash; leave it blank if you don’t have it. Est. NZD is a manual value:
                  a number stores that override, and a blank field clears it. Save writes these
                  three fields only. The earnings estimate still uses the same formula.
                </p>
                <form className="miner-edit-form" onSubmit={saveMinerSpecs}>
                  <label>
                    TH/s
                    <input
                      ref={minerThInputRef}
                      type="number"
                      step="any"
                      min={0}
                      value={editTh}
                      onChange={(e) => setEditTh(e.target.value)}
                      required
                      aria-label="Computing power TH/s"
                    />
                  </label>
                  <label>
                    EE (W/TH)
                    <input
                      type="number"
                      step="any"
                      min={0}
                      value={editEe}
                      onChange={(e) => setEditEe(e.target.value)}
                      placeholder="optional"
                      aria-label="Energy efficiency W/TH"
                    />
                  </label>
                  <label className="span-2">
                    Est. NZD
                    <input
                      type="number"
                      step="any"
                      min={0}
                      value={editEst}
                      onChange={(e) => setEditEst(e.target.value)}
                      placeholder="manual if EE outside 12/15"
                      aria-label="Manual estimated value NZD"
                    />
                  </label>
                  <div className="miner-edit-actions">
                    <button type="submit" className="btn primary" disabled={savingEdit}>
                      {savingEdit ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={savingEdit}
                      onClick={closeMinerEdit}
                    >
                      Cancel
                    </button>
                  </div>
                  {editError && <p className="muted small miner-edit-error">{editError}</p>}
                </form>
              </div>
            </div>
          )}
          <EarningsPeriodsGrid estimate={earnings ?? null} displayCurrency={displayCurrency} fxNote={fxNote} />
        </>
      )}

      {holding.assetClass === 'metal' && (
        <p className="muted small holding-card-meta">
          {holding.spotPriceNzdPerOzT != null
            ? `Spot ${formatNzd(holding.spotPriceNzdPerOzT)}/oz t`
            : 'No spot NZD — cost / — (spot unavailable)'}
          {holding.spotAsOf && <> · {formatAuckland(holding.spotAsOf)}</>}
        </p>
      )}

      {holding.assetClass === 'forex' && (
        <p className="muted small holding-card-meta">
          {holding.unitPriceNzd != null
            ? `FX 1 ${(holding.currency ?? holding.asset ?? '').toUpperCase()} = ${formatNzd(holding.unitPriceNzd)}`
            : 'No FX rate — Value — (Frankfurter; never invent)'}
          {holding.quoteAsOf && <> · {formatAuckland(holding.quoteAsOf)}</>}
        </p>
      )}

      {holding.assetClass === 'stone' && (
        <p className="muted small holding-card-meta">
          {holding.carat != null ? `${holding.carat} ct` : '— ct'}
          {holding.colour ? ` · ${holding.colour}` : ''}
          {holding.clarity ? ` · ${holding.clarity}` : ''}
          {holding.cut ? ` · ${holding.cut}` : ''}
          {' · '}
          {holding.valuationNzd != null
            ? `${holding.valuationSource ?? 'value'} ${formatNzd(holding.valuationNzd)}`
            : 'No valuation — never invent'}
          {holding.quoteAsOf && <> · {formatAuckland(holding.quoteAsOf)}</>}
          {holding.valuationNotes && (
            <> · {holding.valuationNotes.length > 80 ? `${holding.valuationNotes.slice(0, 80)}…` : holding.valuationNotes}</>
          )}
        </p>
      )}

      {holding.assetClass === 'art' && (
        <p className="muted small holding-card-meta">
          {holding.artKind === 'physical' ? 'Physical' : 'Fractional'}
          {holding.artist ? ` · ${holding.artist}` : ''}
          {holding.ownershipPct != null ? ` · ${formatAmount(holding.ownershipPct, 2)}%` : ''}
          {holding.lastValuationNzd != null
            ? ` · ${holding.artKind === 'physical' ? 'Appraisal' : 'Valuation'} ${formatNzd(holding.lastValuationNzd)}`
            : holding.purchasePriceNzd != null
              ? ` · Purchase ${formatNzd(holding.purchasePriceNzd)}`
              : ' · No valuation — enter manually (never invent)'}
          {holding.lastValuationAt && <> · {formatAuckland(holding.lastValuationAt)}</>}
          {holding.valuationNotes && (
            <> · {holding.valuationNotes.length > 60 ? `${holding.valuationNotes.slice(0, 60)}…` : holding.valuationNotes}</>
          )}
        </p>
      )}

      {holding.assetClass === 'real_estate' && (
        <p className="muted small holding-card-meta">
          Equity {formatNzd(holding.equityNzd ?? marketValueNzd(holding))} · manual market value
          {holding.mortgageOutstandingNzd != null && Number(holding.mortgageOutstandingNzd) > 0
            ? ' (mortgage as liability on Dashboard)'
            : ''}
        </p>
      )}

      {holding.assetClass === 'collectable' && (
        <p className="muted small holding-card-meta">
          {holding.cardGame === 'mtg' && (
            <span className="mtg-card-badges">
              {holding.cardColours != null && (
                <span className="mtg-card-colours" aria-label="Colour identity">
                  {holding.cardColours.length === 0 ? (
                    <ManaIcon colour="C" size={14} title="Colourless" />
                  ) : (
                    holding.cardColours.map((c) => <ManaIcon key={c} colour={c} size={14} />)
                  )}
                </span>
              )}
              {holding.cardRarity && (
                <span className={`mtg-rarity-pill rarity-${holding.cardRarity.toLowerCase()}`}>
                  {rarityLabel(holding.cardRarity)}
                </span>
              )}
              {(holding.cardColours != null || holding.cardRarity) && ' · '}
            </span>
          )}
          {holding.unitPriceNzd != null
            ? `Unit ${formatNzd(holding.unitPriceNzd)} · ${holding.quoteNotes ?? holding.valuationSource ?? 'API'}`
            : holding.quoteNotes ?? 'No live quote — Value — (never invent)'}
          {holding.quoteAsOf && <> · {formatAuckland(holding.quoteAsOf)}</>}
        </p>
      )}

      {holding.assetClass === 'crypto' && (
        <HoldingPriceChart assetClass="crypto" ticker={ticker} />
      )}
      {holding.assetClass === 'stock' && (
        <HoldingPriceChart
          assetClass="stock"
          ticker={ticker}
          exchange={holding.exchange}
        />
      )}
      {holding.assetClass === 'metal' && holding.metal && (
        <HoldingPriceChart assetClass="metal" metal={holding.metal} />
      )}

      {holding.source && (
        <p className="muted small holding-card-meta">{holding.source}</p>
      )}

      {holding.notes && holding.assetClass !== 'gomining_miner' && (
        <p className="muted small holding-card-notes" title={holding.notes}>
          {/* Prefer FX snippet so Value context is visible (avoid CSS truncating at "44.78 U") */}
          {(() => {
            const n = holding.notes;
            const fx = n.match(/([\d.]+\s+[A-Z]{3}\s*→\s*[\d.]+\s*NZD\s*@\s*[\d.]+(?:\s*\([^)]+\))?)/i);
            if (fx) return fx[1];
            if (n.length > 100) return `${n.slice(0, 100)}…`;
            return n;
          })()}
        </p>
      )}

      <div className="holding-card-actions">
        {showRefresh && onRefresh && (
          <button
            type="button"
            className="btn ghost holding-card-action"
            onClick={() => onRefresh(holding.id)}
          >
            Refresh value
          </button>
        )}
        {(holding.assetClass === 'stock' ||
          holding.assetClass === 'crypto' ||
          holding.assetClass === 'forex' ||
          holding.assetClass === 'real_estate' ||
          holding.assetClass === 'collectable' ||
          holding.assetClass === 'art') &&
          onDelete && (
            <button
              type="button"
              className="btn danger holding-card-action"
              onClick={() => onDelete(holding.id)}
              aria-label={`Delete ${displayName(holding)}`}
            >
              Delete
            </button>
          )}
      </div>
    </article>
  );
}


const MANUAL_CRYPTO_ID = 'add-crypto-manual';

/** Exchange / app balances (Nexo, GoMining…) go in the manual crypto form (KAN-69). */
function openManualCrypto() {
  const el = document.getElementById(MANUAL_CRYPTO_ID);
  if (!(el instanceof HTMLDetailsElement)) return;
  el.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.querySelector('input')?.focus({ preventScroll: true });
}

function InlineAddDetails({ label, id, children }: { label: string; id?: string; children: ReactNode }) {
  return (
    <details className="section-add" id={id}>
      <summary className="section-add-summary">
        <span className="section-add-label">{label}</span>
      </summary>
      {children}
    </details>
  );
}

function Section({
  title,
  items,
  empty,
  onRefresh,
  onDelete,
  onUpdateQuantity,
  onUpdateArt,
  earningsById,
  headerExtra,
  extraCards,
  children,
}: {
  title: string;
  items: Holding[];
  empty: string;
  onRefresh?: (id: string) => void;
  onDelete?: (id: string) => void;
  onUpdateQuantity?: (id: string, quantity: number) => Promise<void>;
  onUpdateArt?: (
    id: string,
    patch: {
      lastValuationNzd?: number | null;
      appraisalNzd?: number | null;
      ownershipPct?: number;
      purchasePriceNzd?: number | null;
      purchaseDate?: string | null;
    },
  ) => Promise<void>;
  earningsById?: Record<string, GoMiningEarningsEstimate>;
  /** Shown beside the title (e.g. a section total). */
  headerExtra?: ReactNode;
  /** Extra cards rendered in the same grid after the holdings (e.g. crypto wallets). */
  extraCards?: ReactNode[];
  children?: ReactNode;
}) {
  const hasExtra = Boolean(extraCards?.length);
  return (
    <section className="panel">
      {headerExtra ? (
        <div className="section-head-row">
          <h3>{title}</h3>
          {headerExtra}
        </div>
      ) : (
        <h3>{title}</h3>
      )}
      {items.length === 0 && !hasExtra ? (
        <p className="muted">{empty}</p>
      ) : (
        <div className="holding-cards">
          {items.map((h) => (
            <HoldingCard
              key={h.id}
              holding={h}
              onRefresh={onRefresh}
              onDelete={onDelete}
              onUpdateQuantity={onUpdateQuantity}
              onUpdateArt={onUpdateArt}
              earnings={earningsById?.[h.id]}
            />
          ))}
          {extraCards}
        </div>
      )}
      {children}
    </section>
  );
}

function GoMiningMinersSection({
  items,
  empty,
  onRefresh,
  onRefreshMarketplace,
  refreshingMarketplace,
  marketplaceReport,
  onUpdateMiner,
  settings,
  onSettingsChange,
  onSaveDiscount,
  savingDiscount,
  children,
}: {
  items: Holding[];
  empty: string;
  onRefresh?: (id: string) => void;
  onRefreshMarketplace?: () => void;
  refreshingMarketplace?: boolean;
  marketplaceReport?: {
    appliedCount: number;
    total: number;
    failedCount: number;
    availableEeBands: number[];
    note: string | null;
    failures: Array<{ minerName: string; ee: string; reason: string }>;
  } | null;
  onUpdateMiner?: (
    id: string,
    patch: {
      hashrateThs: number;
      energyEfficiencyWth: number | null;
      estimatedValueNzd?: number | null;
    },
  ) => Promise<void>;
  settings: GominingUiSettings;
  onSettingsChange: (s: GominingUiSettings) => void;
  onSaveDiscount: () => void;
  savingDiscount: boolean;
  children?: ReactNode;
}) {
  const fxNote = useMemo(() => {
    const parts: string[] = [];
    const fx = settings.fx;
    if (!fx) {
      parts.push(settings.fxLoading ? 'FX: loading…' : 'FX: not loaded');
    } else if (fx.status === 'ok') {
      const bits = [];
      if (fx.btcUsd != null) bits.push(`BTC/USD ${fx.btcUsd.toLocaleString()}`);
      if (fx.btcNzd != null) bits.push(`BTC/NZD ${fx.btcNzd.toLocaleString()}`);
      const src = fx.source ?? 'quote';
      parts.push(
        bits.length
          ? `FX live · ${bits.join(' · ')} (${src})`
          : 'FX: quote ok but empty',
      );
    } else {
      parts.push(fx.message || 'FX unavailable — USD/NZD show — (never invent)');
    }

    const inc = settings.income;
    if (!inc) {
      if (!settings.fxLoading) parts.push('Pool: not loaded');
    } else if (inc.status === 'ok' && inc.poolIncomeSatPerTh != null) {
      parts.push(
        `Pool live · ${inc.poolIncomeSatPerTh.toFixed(2)} sat/TH (GoMining)`,
      );
      if (inc.goBtcPayStatus === 'ok' && (inc.goBtcPaySatPerTh ?? 0) > 0) {
        parts.push(`GBP ${inc.goBtcPaySatPerTh!.toFixed(4)} sat/TH`);
      } else {
        parts.push('GBP=0');
      }
    } else if (inc.status === 'ok' && inc.poolIncomeUsdPerTh != null) {
      parts.push(
        `Pool live · $${inc.poolIncomeUsdPerTh.toFixed(6)}/TH (GoMining)`,
      );
      parts.push(
        inc.goBtcPayStatus === 'ok' && (inc.goBtcPaySatPerTh ?? 0) > 0
          ? `GBP ${inc.goBtcPaySatPerTh!.toFixed(4)} sat/TH`
          : 'GBP=0',
      );
    } else {
      const liveEhs =
        settings.effectiveNetworkEhs ??
        (settings.networkLive?.status === 'ok'
          ? settings.networkLive.networkHashrateEhs
          : null);
      if (liveEhs != null) {
        const src = settings.networkLive?.source ?? 'network';
        parts.push(
          `Pool fallback · network ${liveEhs.toFixed(1)} EH/s (${src})`,
        );
      } else {
        parts.push(
          inc.message ||
            'Pool stubbed — GoMining income + network EH/s unavailable (never invent)',
        );
      }
    }

    return parts.join(' · ');
  }, [
    settings.fx,
    settings.fxLoading,
    settings.income,
    settings.networkLive,
    settings.effectiveNetworkEhs,
  ]);

  const earningsById = useMemo(() => {
    const network = networkFromUi(settings);
    const map: Record<string, GoMiningEarningsEstimate> = {};
    for (const h of items) {
      map[h.id] = estimateMinerEarnings({
        hashrateThs: Number(h.hashrateThs) || 0,
        energyEfficiencyWth: h.energyEfficiencyWth ?? null,
        discountPct: settings.discountPct,
        network,
        fx: settings.fx,
      });
    }
    return map;
  }, [items, settings]);

  const totals = useMemo(
    () => aggregateMinerEarnings(Object.values(earningsById), settings.fx),
    [earningsById, settings.fx],
  );

  const totalThs = items.reduce((s, h) => s + (Number(h.hashrateThs) || 0), 0);

  const avgEeWeighted = useMemo(() => {
    let thSum = 0;
    let weighted = 0;
    let withEe = 0;
    for (const h of items) {
      const th = Number(h.hashrateThs) || 0;
      const ee = h.energyEfficiencyWth;
      if (ee == null || !Number.isFinite(ee) || th <= 0) continue;
      thSum += th;
      weighted += ee * th;
      withEe += 1;
    }
    if (thSum > 0) return weighted / thSum;
    if (withEe === 0) return null;
    // fallback simple mean if no positive TH
    const ees = items
      .map((h) => h.energyEfficiencyWth)
      .filter((ee): ee is number => ee != null && Number.isFinite(ee));
    if (!ees.length) return null;
    return ees.reduce((a, b) => a + b, 0) / ees.length;
  }, [items]);

  const totalEstNzd = useMemo(() => {
    let sum = 0;
    let any = false;
    for (const h of items) {
      if (h.estimatedValueNzd != null && Number.isFinite(h.estimatedValueNzd)) {
        sum += h.estimatedValueNzd;
        any = true;
      }
    }
    return any ? sum : null;
  }, [items]);

  const [minersExpanded, setMinersExpanded] = useState(false);

  return (
    <section className="panel">
      <div className="gomining-section-head">
        <h3>GoMining miners</h3>
        {onRefreshMarketplace && items.length > 0 && (
          <button
            type="button"
            className="btn ghost"
            onClick={onRefreshMarketplace}
            disabled={refreshingMarketplace}
            title="Primary generative USD/TH × BTC FX → NZD; out-of-band EE extrapolated from live 12/15"
          >
            {refreshingMarketplace ? 'Refreshing values…' : 'Refresh marketplace values'}
          </button>
        )}
      </div>
      <p className="muted small">
        Card Value / Return use estimated NZD from public primary generative list{' '}
        (priceUsdt ÷ TH × BTC FX). Live generative EE bands are typically{' '}
        <strong>12 and 15 W/TH only</strong>. Miners outside those bands (~19–23
        W/TH) get an <strong>estimate extrapolated from primary 12/15 W/TH</strong>{' '}
        (linear usd/TH vs EE from live anchors × TH × FX), labelled{' '}
        <code>gomining_extrapolated</code>. Manual Est. NZD override still works.
        Refresh reports per-miner failures.
      </p>
      {marketplaceReport && (
        <div className="marketplace-report" role="status">
          <p className="muted small">
            Last refresh: {marketplaceReport.appliedCount}/{marketplaceReport.total}{' '}
            applied
            {marketplaceReport.availableEeBands.length > 0 && (
              <>
                {' '}
                · primary EE bands{' '}
                {marketplaceReport.availableEeBands.join(', ')} W/TH
              </>
            )}
            {marketplaceReport.failedCount > 0 && (
              <> · {marketplaceReport.failedCount} failed</>
            )}
          </p>
          {marketplaceReport.note && (
            <p className="muted small">{marketplaceReport.note}</p>
          )}
          {marketplaceReport.failures.length > 0 && (
            <ul className="marketplace-fail-list muted small">
              {marketplaceReport.failures.map((f) => (
                <li key={`${f.minerName}-${f.ee}`}>
                  <strong>{f.minerName}</strong> ({f.ee}): {f.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="gomining-discount-bar">
        <div className="gomining-discount-row">
          <label className="gomining-discount-label">
            GoMining discount applied
            <span className="muted small">
              {' '}
              (C1 electricity + C2 service — not secondary NZD value)
            </span>
            <div className="gomining-discount-input-row">
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={settings.discountPct}
                onChange={(e) =>
                  onSettingsChange({
                    ...settings,
                    discountPct: Number(e.target.value) || 0,
                  })
                }
                aria-label="GoMining discount percent"
              />
              <span className="muted">%</span>
              <button
                type="button"
                className="btn primary"
                onClick={onSaveDiscount}
                disabled={savingDiscount}
              >
                {savingDiscount ? 'Saving…' : 'Save'}
              </button>
            </div>
          </label>
        </div>
        <div className="earnings-currency-toggle" role="group" aria-label="Earnings display currency">
          <span className="muted small">Show earnings in</span>
          {(['BTC', 'USD', 'NZD', 'ALL'] as EarningsDisplayCurrency[]).map((c) => (
            <button
              key={c}
              type="button"
              className={
                settings.displayCurrency === c ? 'btn primary' : 'btn ghost'
              }
              onClick={() =>
                onSettingsChange({ ...settings, displayCurrency: c })
              }
            >
              {c === 'ALL' ? 'All' : c}
            </button>
          ))}
          <span className="muted small">{fxNote}</span>
        </div>
        <details className="gomining-network-params">
          <summary className="muted small">
            Network params for estimate (optional — never invent rates)
          </summary>
          <div className="form-grid gomining-params-grid">
            <label>
              BTC / USD
              <input
                type="number"
                step="any"
                value={settings.btcUsd}
                onChange={(e) =>
                  onSettingsChange({ ...settings, btcUsd: e.target.value })
                }
                placeholder="Leave blank if unknown"
              />
            </label>
            <label>
              Network hashrate (EH/s)
              <input
                type="number"
                step="any"
                value={settings.networkHashrateEhs}
                onChange={(e) =>
                  onSettingsChange({
                    ...settings,
                    networkHashrateEhs: e.target.value,
                  })
                }
                placeholder="Live mempool/blockchain if blank"
              />
            </label>
            <label>
              Daily BTC issuance
              <input
                type="number"
                step="any"
                value={settings.dailyBtcIssuance}
                onChange={(e) =>
                  onSettingsChange({
                    ...settings,
                    dailyBtcIssuance: e.target.value,
                  })
                }
                placeholder="Default 450 (protocol)"
              />
            </label>
            <label>
              kWh cost (USD)
              <input
                type="number"
                step="any"
                value={settings.kWhCostUsd}
                onChange={(e) =>
                  onSettingsChange({ ...settings, kWhCostUsd: e.target.value })
                }
                placeholder="Default 0.05 (app / API c1)"
              />
            </label>
            <button
              type="button"
              className="btn"
              onClick={onSaveDiscount}
              disabled={savingDiscount}
            >
              Save network params
            </button>
          </div>
          <p className="muted small">{settings.note}</p>
        </details>

        {items.length > 0 && (
          <div className="gomining-section-totals">
            <p className="muted small">
              Section totals · {items.length} miner{items.length === 1 ? '' : 's'} ·{' '}
              {formatAmount(totalThs, 2)} TH/s · labeled estimates
            </p>
            <EarningsPeriodsGrid
              estimate={
                {
                  label: 'estimate' as const,
                  discountPct: settings.discountPct,
                  discountFraction: settings.discountPct / 100,
                  kWhCostUsd: 0,
                  kWhCostSource: 'docs_default' as const,
                  dailyBtcIssuance: 450,
                  dailyBtcIssuanceSource: 'protocol_default' as const,
                  electricityUsdPerDay: null,
                  electricityUsdStatus: 'stubbed' as const,
                  electricityUsdMessage: null,
                  serviceUsdPerDay: null,
                  serviceUsdStatus: 'stubbed' as const,
                  serviceUsdMessage: null,
                  maintenanceUsdPerDay: totals.maintenanceUsdAfterDiscount,
                  maintenanceUsdAfterDiscount: totals.maintenanceUsdAfterDiscount,
                  maintenanceUsdStatus: totals.maintenanceUsdAfterDiscount != null ? 'ok' as const : 'stubbed' as const,
                  electricityBtcPerDay: null,
                  serviceBtcPerDay: null,
                  maintenanceBtcPerDay: null,
                  maintenanceBtcAfterDiscount: null,
                  maintenanceBtcStatus: 'stubbed' as const,
                  maintenanceBtcMessage: null,
                  poolRewardSatPerTh: null,
                  goBtcPaySatPerTh: 0,
                  goBtcPayStatus: 'stubbed' as const,
                  goBtcPayMessage: null,
                  electricitySatPerThAfterDiscount: null,
                  serviceSatPerThAfterDiscount: null,
                  netSatPerTh: null,
                  poolRewardBtcPerDay: totals.poolRewardBtcPerDay,
                  goBtcPayBtcPerDay: totals.goBtcPayBtcPerDay ?? 0,
                  poolRewardStatus: totals.poolRewardBtcPerDay != null ? 'ok' as const : 'unavailable' as const,
                  poolRewardMessage: null,
                  poolRewardSource: totals.poolRewardBtcPerDay != null ? ('gomining_income' as const) : null,
                  netBtcPerDay: totals.netBtcPerDay,
                  netBtcStatus: totals.anyCompleteNet ? 'ok' as const : 'stubbed' as const,
                  netBtcMessage: totals.anyCompleteNet
                    ? null
                    : 'Set EE + BTC FX + GoMining pool income (or network EH/s) for full net estimate',
                  summary: '',
                  periods: totals.periods,
                }
              }
              displayCurrency={settings.displayCurrency}
              fxNote={fxNote}
            />
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <>
          <div className="gomining-miners-summary" aria-label="GoMining miners summary">
            <div className="gomining-summary-stat">
              <span className="gomining-summary-label">Miners</span>
              <span className="gomining-summary-value">{items.length}</span>
            </div>
            <div className="gomining-summary-stat">
              <span className="gomining-summary-label">Total TH/s</span>
              <span className="gomining-summary-value">{formatAmount(totalThs, 2)}</span>
            </div>
            <div className="gomining-summary-stat">
              <span className="gomining-summary-label">Avg EE</span>
              <span className="gomining-summary-value">
                {avgEeWeighted != null
                  ? `${formatAmount(avgEeWeighted, 2)} W/TH`
                  : '—'}
              </span>
              <span className="muted small">TH-weighted</span>
            </div>
            {totalEstNzd != null && (
              <div className="gomining-summary-stat">
                <span className="gomining-summary-label">Est. value</span>
                <span className="gomining-summary-value">{formatNzd(totalEstNzd)}</span>
              </div>
            )}
            <div className="gomining-summary-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setMinersExpanded((v) => !v)}
                aria-expanded={minersExpanded}
              >
                {minersExpanded ? 'Hide miners' : 'Show miners'}
              </button>
            </div>
          </div>

          {minersExpanded && (
            <div className="gomining-miners-expanded">
              <p className="muted small">
                Manage individual miners (edit TH/EE, refresh value). Collapsed by default.
              </p>
              <div className="holding-cards">
                {items.map((h) => (
                  <HoldingCard
                    key={h.id}
                    holding={h}
                    onRefresh={onRefresh}
                    onUpdateMiner={onUpdateMiner}
                    earnings={earningsById[h.id]}
                    displayCurrency={settings.displayCurrency}
                    fxNote={fxNote}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {children}
    </section>
  );
}


type PortfolioNetWorth = {
  cashNzd: number;
  stocksNzd: number | null;
  cryptoNzd: number | null;
  gominingMinersNzd: number | null;
  artNzd: number | null;
  metalsNzd: number | null;
  stonesNzd: number | null;
  forexNzd: number | null;
  realEstateNzd: number | null;
  realEstateEquityNzd?: number | null;
  collectablesNzd: number | null;
  kiwiSaverNzd: number | null;
  assetsKnownNzd?: number;
  totalKnownNzd: number;
  asOf: string;
  quoteNote?: string;
  metalsConfigured?: boolean;
  metalsSpotStatus?: MetalSpotStatus;
  metalsSpotSource?: MetalSpotSource | null;
};

type PortfolioBundle = { holdings: Holding[]; summary: PortfolioNetWorth };

const PORTFOLIO_KEY = 'portfolio';
const PORTFOLIO_GM = 'portfolio:gomining';
const PORTFOLIO_METALS = 'portfolio:metals';

export function Portfolio() {
  const { enabled: assetEnabled } = useAssetClassPrefs();
  const cryptoWallets = useCryptoWallets(assetEnabled('crypto'));
  const initialPortfolio = readPageCache<PortfolioBundle>(PORTFOLIO_KEY);
  const initialGm = readPageCache<GominingUiSettings>(PORTFOLIO_GM);
  const [holdings, setHoldings] = useState<Holding[]>(initialPortfolio?.holdings ?? []);
  const [summary, setSummary] = useState<PortfolioNetWorth | null>(initialPortfolio?.summary ?? null);
  const [form, setForm] = useState(emptyMiner);
  const [cryptoForm, setCryptoForm] = useState(emptyCrypto);
  const [stockForm, setStockForm] = useState(emptyStock);
  const [metalForm, setMetalForm] = useState(emptyMetal);
  const [forexForm, setForexForm] = useState(emptyForex);
  const [realEstateForm, setRealEstateForm] = useState(emptyRealEstate);
  const [artForm, setArtForm] = useState(emptyArt);
  const [stoneForm, setStoneForm] = useState(emptyStone);
  const [cryptoResolveHint, setCryptoResolveHint] = useState<string | null>(null);
  const [stockResolveHint, setStockResolveHint] = useState<string | null>(null);
  const [resolvedCryptoName, setResolvedCryptoName] = useState<string | null>(null);
  const [resolvedStockName, setResolvedStockName] = useState<string | null>(null);
  /** Debounce / coalesce ticker blur resolves so we do not hammer CoinGecko. */
  const cryptoResolveRef = useRef<{ ticker: string; at: number; inflight: boolean }>({
    ticker: '',
    at: 0,
    inflight: false,
  });
  const stockResolveRef = useRef<{ ticker: string; at: number; inflight: boolean }>({
    ticker: '',
    at: 0,
    inflight: false,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [refreshingMarketplace, setRefreshingMarketplace] = useState(false);
  const [marketplaceReport, setMarketplaceReport] = useState<{
    appliedCount: number;
    total: number;
    failedCount: number;
    availableEeBands: number[];
    note: string | null;
    failures: Array<{ minerName: string; ee: string; reason: string }>;
  } | null>(null);
  const [metalsConfigured, setMetalsConfigured] = useState<boolean | null>(
    () => readPageCache<boolean>(PORTFOLIO_METALS) ?? null,
  );
  const [refreshingMetals, setRefreshingMetals] = useState(false);
  const [refreshingForex, setRefreshingForex] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gmSettings, setGmSettings] = useState<GominingUiSettings>(
    initialGm ? { ...initialGm, fxLoading: false } : emptyGmSettings,
  );
  const [savingGm, setSavingGm] = useState(false);
  const holdingsRef = useRef(holdings);
  const gmCurrencyRef = useRef(gmSettings.displayCurrency);
  const gmNoteRef = useRef(gmSettings.note);
  useEffect(() => {
    holdingsRef.current = holdings;
  }, [holdings]);
  useEffect(() => {
    gmCurrencyRef.current = gmSettings.displayCurrency;
  }, [gmSettings.displayCurrency]);
  useEffect(() => {
    gmNoteRef.current = gmSettings.note;
  }, [gmSettings.note]);

  const load = useCallback(() => {
    const stamp = beginPageRead(PORTFOLIO_KEY);
    return Promise.all([api.holdings.list(), api.netWorth()])
      .then(([h, net]) => {
        const bundle: PortfolioBundle = {
          holdings: h as Holding[],
          summary: net as PortfolioNetWorth,
        };
        if (!commitPageRead(stamp, bundle)) return;
        setHoldings(bundle.holdings);
        setSummary(bundle.summary);
        setError(null);
      })
      .catch((e: Error) => {
        abandonPageRead(stamp);
        if (holdingsRef.current.length > 0) {
          showQuietToast('Could not refresh portfolio — showing last data.', { kind: 'warn' });
          return;
        }
        setError(e.message);
      });
  }, []);

  const reloadAfterEdit = useCallback(() => {
    invalidateFinancial('portfolio', 'dashboard', 'yearly', 'dividends', 'projections');
    return load();
  }, [load]);

  // Net worth includes wallets (KAN-42): refresh the totals when wallet values change
  // (add / remove / sync), but not for the first wallet load — `load` already covers that.
  const walletsKey = cryptoWallets.data
    ? `${cryptoWallets.entries.length}:${cryptoWallets.data.totalNzd}:${cryptoWallets.data.failedWallets}`
    : null;
  const lastWalletsKey = useRef<string | null>(null);
  useEffect(() => {
    if (walletsKey == null) return;
    const prev = lastWalletsKey.current;
    lastWalletsKey.current = walletsKey;
    if (prev == null || prev === walletsKey) return;
    invalidateFinancial('dashboard', 'yearly', 'projections');
    api
      .netWorth()
      .then((net) => {
        const next = net as PortfolioNetWorth;
        setSummary(next);
        writePageCache(PORTFOLIO_KEY, { holdings: holdingsRef.current, summary: next });
      })
      .catch(() => {});
  }, [walletsKey]);

  const loadGmSettings = () => {
    const stamp = beginPageRead(PORTFOLIO_GM);
    if (readPageCache<GominingUiSettings>(PORTFOLIO_GM) == null) {
      setGmSettings((prev) => ({ ...prev, fxLoading: true }));
    }
    return api.settings
      .getGomining()
      .then((g) => {
        const raw = g as {
          fx?: BtcFxRates | null;
          income?: GoMiningIncomeRates | null;
          networkHashrate?: GoMiningNetworkLive | null;
          effective?: {
            networkHashrateEhs: number | null;
            poolIncomeUsdPerTh: number | null;
            poolIncomeBtcPerTh: number | null;
          };
        };
        const fxRaw = raw.fx ?? null;
        const incomeRaw = raw.income ?? null;
        const networkLive = raw.networkHashrate ?? null;
        const nextSettings: GominingUiSettings = {
          discountPct: g.discountPct ?? 0,
          btcUsd: g.btcUsd != null ? String(g.btcUsd) : '',
          networkHashrateEhs:
            g.networkHashrateEhs != null ? String(g.networkHashrateEhs) : '',
          dailyBtcIssuance:
            g.dailyBtcIssuance != null ? String(g.dailyBtcIssuance) : '',
          kWhCostUsd: g.kWhCostUsd != null ? String(g.kWhCostUsd) : '',
          note: g.defaults?.note ?? '',
          fx: fxRaw,
          income: incomeRaw,
          networkLive,
          effectiveNetworkEhs: raw.effective?.networkHashrateEhs ?? null,
          fxLoading: false,
          displayCurrency: gmCurrencyRef.current ?? 'ALL',
        };
        setGmSettings(nextSettings);
        commitPageRead(stamp, nextSettings);
      })
      .catch((e: Error) => {
        setGmSettings((prev) => ({ ...prev, fxLoading: false }));
        setMsg(`GoMining settings: ${e.message}`);
      });
  };

  useEffect(() => {
    load();
    loadGmSettings();
    const metalStamp = beginPageRead(PORTFOLIO_METALS);
    api.quotes
      .metalsStatus()
      .then((s) => {
        if (!commitPageRead(metalStamp, s.configured)) return;
        setMetalsConfigured(s.configured);
      })
      .catch(() => {
        if (readPageCache<boolean>(PORTFOLIO_METALS) == null) setMetalsConfigured(false);
      });
  }, [load]);

  // Silent background Akahu auto-sync on open / refresh (banks + holdings).
  // Mount-only + loadRef so Strict Mode remount / stable load identity never
  // cancels a completed sync before the UI reloads (same pattern as Budget).
  const portfolioLoadRef = useRef(load);
  useEffect(() => {
    portfolioLoadRef.current = load;
  }, [load]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [txn, port] = await Promise.all([
          maybeAutoSyncBankTransactions(),
          maybeAutoSyncPortfolio(),
        ]);
        if (cancelled) return;
        if (
          (txn.ran && txn.result.ok && txnSyncChanged(txn.result)) ||
          (port.ran && port.result.ok && portfolioSyncChanged(port.result))
        ) {
          invalidateAfterExternalSync();
        }
        await portfolioLoadRef.current();
      } catch {
        showQuietToast('Sync paused — showing last holdings.', { kind: 'warn' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveGmSettings() {
    setSavingGm(true);
    setMsg(null);
    try {
      const g = (await api.settings.updateGomining({
        discountPct: gmSettings.discountPct,
        btcUsd: parseOptNum(gmSettings.btcUsd),
        networkHashrateEhs: parseOptNum(gmSettings.networkHashrateEhs),
        dailyBtcIssuance: parseOptNum(gmSettings.dailyBtcIssuance),
        kWhCostUsd: parseOptNum(gmSettings.kWhCostUsd),
      })) as {
        discountPct: number;
        btcUsd: number | null;
        networkHashrateEhs: number | null;
        dailyBtcIssuance: number | null;
        kWhCostUsd: number | null;
        defaults?: { note?: string };
      };
      const raw = g as {
        fx?: BtcFxRates | null;
        income?: GoMiningIncomeRates | null;
        networkHashrate?: GoMiningNetworkLive | null;
        effective?: { networkHashrateEhs: number | null };
        defaults?: { note?: string };
      };
      const fxRaw = raw.fx ?? null;
      const nextSettings: GominingUiSettings = {
        discountPct: g.discountPct ?? 0,
        btcUsd: g.btcUsd != null ? String(g.btcUsd) : '',
        networkHashrateEhs:
          g.networkHashrateEhs != null ? String(g.networkHashrateEhs) : '',
        dailyBtcIssuance:
          g.dailyBtcIssuance != null ? String(g.dailyBtcIssuance) : '',
        kWhCostUsd: g.kWhCostUsd != null ? String(g.kWhCostUsd) : '',
        note: raw.defaults?.note ?? gmNoteRef.current,
        fx: fxRaw,
        income: raw.income ?? null,
        networkLive: raw.networkHashrate ?? null,
        effectiveNetworkEhs: raw.effective?.networkHashrateEhs ?? null,
        fxLoading: false,
        displayCurrency: gmCurrencyRef.current,
      };
      setGmSettings(nextSettings);
      commitPageRead(beginPageRead(PORTFOLIO_GM), nextSettings);
      setMsg('GoMining discount / network params saved.');
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSavingGm(false);
    }
  }

  const grouped = useMemo(() => {
    const stocks = holdings.filter((h) => h.assetClass === 'stock');
    const crypto = holdings.filter((h) => h.assetClass === 'crypto');
    const miners = holdings.filter((h) => h.assetClass === 'gomining_miner');
    const metals = holdings.filter((h) => h.assetClass === 'metal');
    const forex = holdings.filter((h) => h.assetClass === 'forex');
    const realEstate = holdings.filter((h) => h.assetClass === 'real_estate');
    const collectables = holdings.filter((h) => h.assetClass === 'collectable');
    const art = holdings.filter((h) => h.assetClass === 'art');
    const stones = holdings.filter((h) => h.assetClass === 'stone');
    return { stocks, crypto, miners, metals, forex, realEstate, collectables, art, stones };
  }, [holdings]);


  async function updateHoldingQuantity(id: string, quantity: number) {
    setMsg(null);
    const holding = holdings.find((h) => h.id === id);
    if (
      !holding ||
      (holding.assetClass !== 'stock' &&
        holding.assetClass !== 'crypto' &&
        holding.assetClass !== 'forex')
    ) {
      throw new Error('Only stock, crypto, or forex amounts can be edited here');
    }
    await api.holdings.update(
      id,
      holding.assetClass === 'stock' ? { shares: quantity } : { amount: quantity },
    );
    setMsg(
      holding.assetClass === 'stock'
        ? 'Stock shares updated.'
        : holding.assetClass === 'forex'
          ? 'Forex amount updated.'
          : 'Crypto amount updated.',
    );
    await reloadAfterEdit();
  }

  async function deleteHolding(id: string) {
    const holding = holdings.find((h) => h.id === id);
    if (!holding) return;
    if (
      holding.assetClass !== 'stock' &&
      holding.assetClass !== 'crypto' &&
      holding.assetClass !== 'forex' &&
      holding.assetClass !== 'metal' &&
      holding.assetClass !== 'stone' &&
      holding.assetClass !== 'gomining_miner' &&
      holding.assetClass !== 'real_estate' &&
      holding.assetClass !== 'collectable' &&
      holding.assetClass !== 'art'
    )
      return;
    const label = `${displayName(holding)} (${tickerFor(holding)})`;
    if (!window.confirm(`Delete this ${holding.assetClass} holding?\n\n${label}`)) return;
    setMsg(null);
    try {
      await api.holdings.remove(id);
      setMsg(`Deleted ${label}.`);
      await reloadAfterEdit();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function resolveCryptoTickerField() {
    const ticker = cryptoForm.ticker.trim().toUpperCase();
    if (!ticker) {
      setCryptoResolveHint(null);
      setResolvedCryptoName(null);
      cryptoResolveRef.current = { ticker: '', at: 0, inflight: false };
      return;
    }
    const now = Date.now();
    const prev = cryptoResolveRef.current;
    // Skip duplicate blur within 30s for the same ticker (server also caches / coalesces).
    if (prev.ticker === ticker && (prev.inflight || now - prev.at < 30_000)) {
      return;
    }
    cryptoResolveRef.current = { ticker, at: now, inflight: true };
    setCryptoResolveHint('Resolving…');
    try {
      const r = await api.quotes.resolveTicker(ticker, 'crypto');
      if (cryptoResolveRef.current.ticker !== ticker) return; // superseded
      setResolvedCryptoName(r.name || ticker);
      if (r.quoteAvailable && r.quote.price != null) {
        setCryptoResolveHint(
          `${r.name} · ${formatNzd(r.quote.price)} / unit (CoinGecko)` +
            (r.quote.asOf ? ` · ${formatAuckland(r.quote.asOf)}` : ''),
        );
      } else {
        const msg = r.quote.message ?? 'no price';
        setCryptoResolveHint(
          `${r.name || ticker} · quote unavailable — Value will show — (${msg})`,
        );
      }
      cryptoResolveRef.current = { ticker, at: Date.now(), inflight: false };
    } catch (err) {
      if (cryptoResolveRef.current.ticker !== ticker) return;
      setResolvedCryptoName(ticker);
      setCryptoResolveHint(`Resolve failed: ${(err as Error).message} — can still add; Value may be —`);
      cryptoResolveRef.current = { ticker, at: Date.now(), inflight: false };
    }
  }

  async function resolveStockTickerField() {
    const ticker = stockForm.ticker.trim().toUpperCase();
    const exchange = stockForm.exchange.trim() || null;
    const cacheKey = `${ticker}|${(exchange ?? '').toUpperCase()}`;
    if (!ticker) {
      setStockResolveHint(null);
      setResolvedStockName(null);
      stockResolveRef.current = { ticker: '', at: 0, inflight: false };
      return;
    }
    const now = Date.now();
    const prev = stockResolveRef.current;
    if (prev.ticker === cacheKey && (prev.inflight || now - prev.at < 30_000)) {
      return;
    }
    stockResolveRef.current = { ticker: cacheKey, at: now, inflight: true };
    setStockResolveHint('Resolving Yahoo → NZD…');
    try {
      const r = await api.quotes.resolveTicker(ticker, 'stock', { exchange });
      if (stockResolveRef.current.ticker !== cacheKey) return;
      setResolvedStockName(r.name || ticker);
      const yahoo = r.yahooSymbol ? ` · Yahoo ${r.yahooSymbol}` : '';
      if (r.quoteAvailable && r.quote.price != null) {
        setStockResolveHint(
          `${r.name}${yahoo} · ${formatNzd(r.quote.price)} / share (${r.quote.source})` +
            (r.quote.status === 'stale' ? ' · stale' : '') +
            (r.quote.asOf ? ` · ${formatAuckland(r.quote.asOf)}` : ''),
        );
      } else {
        const msg = r.quote.message ?? 'no price';
        setStockResolveHint(
          `${r.name || ticker}${yahoo} · quote unavailable — Value will show — (${msg})`,
        );
      }
      stockResolveRef.current = { ticker: cacheKey, at: Date.now(), inflight: false };
    } catch (err) {
      if (stockResolveRef.current.ticker !== cacheKey) return;
      setResolvedStockName(ticker);
      setStockResolveHint(`Resolve failed: ${(err as Error).message} — can still add; Value may be —`);
      stockResolveRef.current = { ticker: cacheKey, at: Date.now(), inflight: false };
    }
  }

  async function updateMinerSpecs(
    id: string,
    patch: {
      hashrateThs: number;
      energyEfficiencyWth: number | null;
      estimatedValueNzd?: number | null;
    },
  ) {
    setMsg(null);
    const body: Record<string, unknown> = {
      hashrateThs: patch.hashrateThs,
      energyEfficiencyWth: patch.energyEfficiencyWth,
    };
    if (patch.estimatedValueNzd !== undefined) {
      body.estimatedValueNzd = patch.estimatedValueNzd;
      body.estimatedValueSource = patch.estimatedValueNzd != null ? 'manual' : null;
    }
    await api.holdings.update(id, body);
    setMsg(
      patch.estimatedValueNzd !== undefined
        ? 'Miner TH / EE / Est. NZD updated.'
        : 'Miner TH / EE updated.',
    );
    await reloadAfterEdit();
  }

  async function onAddMiner(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api.holdings.create({
        assetClass: 'gomining_miner',
        name: form.minerName || 'GoMining miner',
        minerName: form.minerName || 'GoMining miner',
        hashrateThs: Number(form.hashrateThs) || 0,
        energyEfficiencyWth: form.energyEfficiencyWth
          ? Number(form.energyEfficiencyWth)
          : null,
        rarity: form.rarity || null,
        level: form.level ? Number(form.level) : null,
        costBasisNzd: parseOptionalNumber(form.costBasisNzd),
        acquiredAt: form.acquiredAt || null,
        estimatedValueNzd: form.estimatedValueNzd ? Number(form.estimatedValueNzd) : null,
        notes: form.notes || null,
      });
      setForm(emptyMiner);
      setMsg('Miner added.');
      await reloadAfterEdit();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function onAddCrypto(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const ticker = cryptoForm.ticker.trim().toUpperCase();
      if (!ticker) {
        setMsg('Ticker required for crypto');
        return;
      }
      const name = resolvedCryptoName || ticker;
      const created = (await api.holdings.create({
        assetClass: 'crypto',
        name,
        ticker,
        asset: ticker,
        amount: Number(cryptoForm.amount) || 0,
        costBasisNzd: parseOptionalNumber(cryptoForm.costBasisNzd),
        source: 'manual',
        notes: cryptoForm.notes
          ? `Nexo (manual). ${cryptoForm.notes}`
          : 'Nexo (manual)',
      })) as { merged?: boolean; amount?: number; costBasisNzd?: number | null };
      setCryptoForm(emptyCrypto);
      setCryptoResolveHint(null);
      setResolvedCryptoName(null);
      setMsg(
        created.merged
          ? `Merged into existing ${name} (${ticker}): amount + cost basis updated (weighted NZD).`
          : `Added ${name} (${ticker}).`,
      );
      await reloadAfterEdit();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function onAddStock(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const ticker = stockForm.ticker.trim().toUpperCase();
      if (!ticker) {
        setMsg('Ticker required for stock');
        return;
      }
      const name = resolvedStockName || ticker;
      const created = (await api.holdings.create({
        assetClass: 'stock',
        name,
        ticker,
        symbol: ticker,
        shares: Number(stockForm.shares) || 0,
        exchange: stockForm.exchange.trim() || null,
        costBasisNzd: parseOptionalNumber(stockForm.costBasisNzd),
        source: 'manual',
        notes: stockForm.notes || null,
      })) as { merged?: boolean; shares?: number; costBasisNzd?: number | null };
      setStockForm(emptyStock);
      setStockResolveHint(null);
      setResolvedStockName(null);
      setMsg(
        created.merged
          ? `Merged into existing ${name} (${ticker}): shares + cost basis updated (weighted NZD).`
          : `Added ${name} (${ticker}).`,
      );
      await reloadAfterEdit();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function onAddMetal(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const metal = metalForm.metal;
      const label = metalForm.name.trim();
      const name = label || metal.charAt(0).toUpperCase() + metal.slice(1);
      await api.holdings.create({
        assetClass: 'metal',
        name,
        metal,
        amount: Number(metalForm.amount) || 0,
        unit: metalForm.unit,
        costBasisNzd: parseOptionalNumber(metalForm.costBasisNzd),
        notes: metalForm.notes || null,
      });
      setMetalForm(emptyMetal);
      setMsg(`Added ${name}.`);
      await reloadAfterEdit();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function onAddForex(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const currency = forexForm.currency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) {
        setMsg('Currency must be a 3-letter ISO code (e.g. USD, EUR, GBP)');
        return;
      }
      if (currency === 'NZD') {
        setMsg('Use a bank account for NZD — forex is for foreign cash outside bank (e.g. Revolut)');
        return;
      }
      const amount = Number(forexForm.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        setMsg('Amount must be a finite, non-negative number');
        return;
      }
      const source = forexForm.source.trim() || 'manual';
      await api.holdings.create({
        assetClass: 'forex',
        currency,
        amount,
        costBasisNzd: parseOptionalNumber(forexForm.costBasisNzd),
        source,
        notes: forexForm.notes || null,
      });
      setForexForm(emptyForex);
      setMsg(`Added ${currency} (${source}) · Frankfurter → NZD on create.`);
      await reloadAfterEdit();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }


  async function onAddStone(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      let stoneType = stoneForm.stoneType;
      if (stoneType === 'Other') {
        stoneType = stoneForm.stoneTypeOther.trim();
        if (!stoneType) {
          setMsg('Enter a stone type for Other');
          return;
        }
      }
      const carat = Number(stoneForm.carat);
      if (!Number.isFinite(carat) || carat <= 0) {
        setMsg('Carat must be a positive number');
        return;
      }
      const diamond = isDiamondStoneTypeUi(stoneType);
      const valuationNzd = parseOptionalNumber(stoneForm.valuationNzd);
      if (!diamond && (valuationNzd == null || valuationNzd < 0)) {
        setMsg('Estimated value NZD required for non-diamond stones (no live gem API)');
        return;
      }
      const label = stoneForm.name.trim();
      const name =
        label ||
        `${stoneType.charAt(0).toUpperCase()}${stoneType.slice(1)} ${carat}ct`;
      const body: Record<string, unknown> = {
        assetClass: 'stone',
        name,
        stoneType,
        carat,
        costBasisNzd: parseOptionalNumber(stoneForm.costBasisNzd),
        notes: stoneForm.notes || null,
      };
      if (diamond) {
        body.colour = stoneForm.colour;
        body.clarity = stoneForm.clarity;
        body.cut = stoneForm.cut;
        if (valuationNzd != null) body.valuationNzd = valuationNzd;
      } else {
        body.valuationNzd = valuationNzd;
      }
      await api.holdings.create(body);
      setStoneForm(emptyStone);
      setMsg(
        diamond
          ? `Added ${name} — OpenFacet diamond quote (or manual fallback if live failed).`
          : `Added ${name} — manual estimated NZD (no live gem API).`,
      );
      await reloadAfterEdit();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function refresh(id: string) {
    setMsg(null);
    try {
      const r = (await api.holdings.refreshValue(id)) as {
        quote?: { message?: string; status?: string };
        note?: string;
        applied?: boolean;
        marketValueNzd?: number | null;
      };
      setMsg(
        `${r.quote?.status ?? 'stubbed'}: ${r.quote?.message ?? r.note}` +
          (r.applied && r.marketValueNzd != null
            ? ` · holding ${formatNzd(r.marketValueNzd)}`
            : ''),
      );
      await reloadAfterEdit();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function refreshMarketplace() {
    setMsg(null);
    setMarketplaceReport(null);
    setRefreshingMarketplace(true);
    try {
      const r = await api.holdings.refreshGominingValues();
      const failures = (r.results ?? [])
        .filter((row) => !row.applied)
        .map((row) => ({
          minerName: String(row.minerName ?? row.holdingId),
          ee:
            row.energyEfficiencyWth != null
              ? `${row.energyEfficiencyWth} W/TH`
              : 'EE unknown',
          reason: String(
            row.failReason ??
              row.quote?.message ??
              'No marketplace match — never invent',
          ),
        }));
      const bands = r.availableEeBands ?? [];
      setMarketplaceReport({
        appliedCount: r.appliedCount,
        total: r.total,
        failedCount: r.failedCount ?? failures.length,
        availableEeBands: bands,
        note: r.note ?? null,
        failures,
      });
      const failSummary =
        failures.length === 0
          ? ''
          : ` · ${failures.length} failed: ` +
            failures
              .slice(0, 4)
              .map((f) => `${f.minerName} (${f.ee})`)
              .join('; ') +
            (failures.length > 4 ? '…' : '');
      setMsg(
        `GoMining marketplace: ${r.appliedCount}/${r.total} updated` +
          (bands.length ? ` · EE bands ${bands.join(', ')} W/TH` : '') +
          failSummary +
          (r.note ? ` · ${r.note}` : ''),
      );
      await reloadAfterEdit();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setRefreshingMarketplace(false);
    }
  }


  async function onAddRealEstate(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const propertyValueNzd = Number(realEstateForm.propertyValueNzd);
      if (!Number.isFinite(propertyValueNzd) || propertyValueNzd < 0) {
        setMsg('Property market value (NZD) required');
        return;
      }
      const mortgageOutstandingNzd = parseOptionalNumber(realEstateForm.mortgageOutstandingNzd) ?? 0;
      await api.holdings.create({
        assetClass: 'real_estate',
        name: realEstateForm.name.trim() || 'Property',
        propertyValueNzd,
        mortgageOutstandingNzd,
        costBasisNzd: parseOptionalNumber(realEstateForm.costBasisNzd),
        acquiredAt: realEstateForm.acquiredAt || null,
        notes: realEstateForm.notes || null,
        photoBase64: realEstateForm.photoBase64 || undefined,
      });
      setRealEstateForm(emptyRealEstate);
      setMsg('Real estate added (manual value − mortgage = equity on Dashboard)');
      await reloadAfterEdit();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  function onPickImage(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      setRealEstateForm((prev) => ({ ...prev, photoBase64: result }));
    };
    reader.readAsDataURL(file);
  }

  function onPickArtImage(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      setArtForm((prev) => ({ ...prev, photoBase64: result }));
    };
    reader.readAsDataURL(file);
  }

  async function onAddArt(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const title = artForm.artworkTitle.trim();
      if (!title) {
        setMsg('Artwork title required');
        return;
      }
      const artist = artForm.artist.trim() || undefined;
      const notesParts: string[] = [];
      if (artForm.notes.trim()) notesParts.push(artForm.notes.trim());
      if (artForm.externalId.trim()) {
        notesParts.push(`externalId: ${artForm.externalId.trim()}`);
      }
      if (artForm.artKind === 'fractional') {
        const ownershipPct = Number(artForm.ownershipPct);
        if (!Number.isFinite(ownershipPct) || ownershipPct <= 0 || ownershipPct > 100) {
          setMsg('Ownership % must be > 0 and ≤ 100');
          return;
        }
        const purchasePriceNzd = Number(artForm.purchasePriceNzd);
        if (!Number.isFinite(purchasePriceNzd) || purchasePriceNzd < 0) {
          setMsg('Purchase price NZD required for fractional art');
          return;
        }
        if (!artForm.purchaseDate.trim()) {
          setMsg('Purchase date required for fractional art');
          return;
        }
        const lastValuationNzd = parseOptionalNumber(artForm.lastValuationNzd);
        await api.holdings.create({
          assetClass: 'art',
          artKind: 'fractional',
          name: artist ? `${title} — ${artist}` : title,
          artworkTitle: title,
          artist: artist ?? null,
          ownershipPct,
          purchasePriceNzd,
          purchaseDate: artForm.purchaseDate.trim(),
          lastValuationNzd: lastValuationNzd,
          notes: notesParts.length ? notesParts.join('\n') : null,
          externalId: artForm.externalId.trim() || null,
        });
        setMsg('Fractional art added (manual valuation only — no Masterworks API)');
      } else {
        const appraisalNzd = Number(artForm.appraisalNzd);
        if (!Number.isFinite(appraisalNzd) || appraisalNzd < 0) {
          setMsg('Appraisal NZD required for physical art (manual — never invent)');
          return;
        }
        const purchasePriceNzd = parseOptionalNumber(artForm.purchasePriceNzd);
        await api.holdings.create({
          assetClass: 'art',
          artKind: 'physical',
          name: artist ? `${title} — ${artist}` : title,
          artworkTitle: title,
          artist: artist ?? null,
          ownershipPct: 100,
          appraisalNzd,
          purchasePriceNzd: purchasePriceNzd,
          purchaseDate: artForm.purchaseDate.trim() || null,
          notes: notesParts.length ? notesParts.join('\n') : null,
          photoBase64: artForm.photoBase64 || undefined,
        });
        setMsg('Physical art added (appraisal + optional photo — never invent values)');
      }
      setArtForm(emptyArt);
      await reloadAfterEdit();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function updateArtHolding(
    id: string,
    patch: {
      lastValuationNzd?: number | null;
      appraisalNzd?: number | null;
      ownershipPct?: number;
      purchasePriceNzd?: number | null;
      purchaseDate?: string | null;
    },
  ) {
    setMsg(null);
    await api.holdings.update(id, patch);
    setMsg('Art valuation updated (manual — never invent)');
    await reloadAfterEdit();
  }

  async function refreshMetalsAll() {
    setMsg(null);
    setRefreshingMetals(true);
    try {
      const status = await api.quotes.metalsStatus();
      setMetalsConfigured(status.configured);
      const r = await api.quotes.refreshMetals();
      const ok = r.quotes.filter(
        (q) => (q.status === 'ok' || q.status === 'stale') && q.price != null,
      ).length;
      setMsg(
        status.configured
          ? `Metals.Dev: ${ok}/${r.quotes.length} NZD spots refreshed · reload holdings`
          : ok > 0
            ? `gold-api.com: ${ok}/${r.quotes.length} NZD spots refreshed · reload holdings`
            : 'gold-api.com returned no NZD spots. Metal value stays cost / —. Not inventing prices.',
      );
      await reloadAfterEdit();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setRefreshingMetals(false);
    }
  }

  async function refreshForexAll() {
    setMsg(null);
    setRefreshingForex(true);
    try {
      const r = await api.holdings.refreshForexValues();
      setMsg(
        `Forex FX: ${r.appliedCount}/${r.totalCurrencies} currencies refreshed via Frankfurter → NZD` +
          (r.failedCount ? ` · ${r.failedCount} unavailable (never invent)` : ''),
      );
      await reloadAfterEdit();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setRefreshingForex(false);
    }
  }

  const breakdownPref: Record<string, AssetClassPrefKey> = {
    cash: 'cash',
    stocks: 'stock',
    crypto: 'crypto',
    gomining: 'gomining',
    art: 'art',
    metals: 'metal',
    stones: 'stone',
    forex: 'forex',
    realEstate: 'real_estate',
    collectables: 'collectable',
    kiwiSaver: 'kiwisaver',
  };

  const assetBreakdown: AssetBreakdownRow[] = summary
    ? [
        { key: 'cash', name: 'Cash', value: summary.cashNzd, colour: '#3d9a6a' },
        { key: 'stocks', name: 'Stocks', value: summary.stocksNzd ?? 0, colour: '#4a8fd4' },
        { key: 'crypto', name: 'Crypto', value: summary.cryptoNzd ?? 0, colour: '#9a6ad4' },
        { key: 'gomining', name: 'GoMining', value: summary.gominingMinersNzd ?? 0, colour: '#c47a2c' },
        { key: 'art', name: 'Art', value: summary.artNzd ?? 0, colour: '#d45a7a' },
        { key: 'metals', name: 'Metals', value: summary.metalsNzd ?? 0, colour: '#d4b84a' },
        { key: 'stones', name: 'Stones', value: summary.stonesNzd ?? 0, colour: '#a07050' },
        { key: 'forex', name: 'Forex', value: summary.forexNzd ?? 0, colour: '#5ab8a0' },
        {
          key: 'realEstate',
          name: 'Real estate',
          value: summary.realEstateEquityNzd ?? summary.realEstateNzd ?? 0,
          colour: '#7a9e5a',
        },
        { key: 'collectables', name: 'Collectables', value: summary.collectablesNzd ?? 0, colour: '#c45a9a' },
        { key: 'kiwiSaver', name: 'KiwiSaver', value: summary.kiwiSaverNzd ?? 0, colour: '#6a8fd4' },
      ]
        .filter((row) => {
          const pref = breakdownPref[row.key];
          return !pref || assetEnabled(pref);
        })
        .map((row) => ({
          ...row,
          value: Number.isFinite(row.value) ? row.value : 0,
        }))
    : [];

  const totalAssetValueNzd = assetBreakdown.reduce(
    (sum, row) => sum + (Number.isFinite(row.value) ? Math.max(0, row.value) : 0),
    0,
  );

  if (error && holdings.length === 0) {
    return (
      <div className="panel warn portfolio-page">
        <h2 className="page-title">Portfolio</h2>
        <p>Portfolio API error: {error}</p>
      </div>
    );
  }

  return (
    <div className="stack portfolio-page">
      {summary ? (
        <>
          <section className="hero-card hero-card--centered">
            <h2 className="page-title">Portfolio</h2>
            <p className="eyebrow">Total asset value · NZD</p>
            <p className="hero-value">{formatNzd(totalAssetValueNzd)}</p>
            <p className="muted small">
              As of {formatAuckland(summary.asOf)} NZT
              {' · '}
              Enabled asset classes only
              {summary.quoteNote ? ` · ${summary.quoteNote}` : ''}
            </p>
          </section>
          <AssetBreakdownChart
            rows={assetBreakdown}
            asOf={formatAuckland(summary.asOf)}
            title="Assets by class"
            subtitle="NZD totals · classes enabled in portfolio preferences"
            centerLabel="Assets"
            barTitle="By class"
            note="Values come from known quotes and recorded balances — never invented. Toggle classes in the account menu → Settings."
            headingId="portfolio-asset-breakdown-title"
            showPie={false}
            showTotal={false}
          />
        </>
      ) : (
        <div className="panel">
          <h2 className="page-title">Portfolio</h2>
          Loading total asset value…
        </div>
      )}
      {msg && <p className="banner">{msg}</p>}

{assetEnabled('stock') ? (
      <section className="panel">
        <div className="panel-heading">
          <h3>Stocks</h3>
          <div className="row gap" style={{ marginTop: 0 }}>
            <span className="muted small">
              Value = Akahu market × live FX (Frankfurter; USD fallback BTC FX) → NZD.
              Connect / re-link in the account menu → Settings; initial sync is during signup.
            </span>
          </div>
        </div>
        {grouped.stocks.length === 0 ? (
          <p className="muted">No stock holdings yet. Connect Akahu during signup, or later in the account menu → Settings, or add manually below (ticker required).</p>
        ) : (
          <div className="holding-cards" style={{ marginTop: '0.75rem' }}>
            {grouped.stocks.map((h) => (
              <HoldingCard
                key={h.id}
                holding={h}
                onRefresh={refresh}
                onDelete={deleteHolding}
                onUpdateQuantity={updateHoldingQuantity}
              />
            ))}
          </div>
        )}
        <InlineAddDetails label="Add stock">
          <form className="form-grid" onSubmit={onAddStock}>
            <h4>Add stock (manual)</h4>
            <label>
              Ticker
              <input
                value={stockForm.ticker}
                onChange={(e) => {
                  setStockForm({ ...stockForm, ticker: e.target.value });
                  setStockResolveHint(null);
                  setResolvedStockName(null);
                }}
                onBlur={() => void resolveStockTickerField()}
                required
                placeholder="AAPL, NZ50ETF…"
                autoCapitalize="characters"
              />
            </label>
            <label>
              Shares
              <input
                type="number"
                step="any"
                value={stockForm.shares}
                onChange={(e) => setStockForm({ ...stockForm, shares: e.target.value })}
                required
              />
            </label>
            <label>
              Exchange (optional)
              <input
                value={stockForm.exchange}
                onChange={(e) => {
                  setStockForm({ ...stockForm, exchange: e.target.value });
                  setStockResolveHint(null);
                  setResolvedStockName(null);
                }}
                onBlur={() => void resolveStockTickerField()}
                placeholder="NZX, NYSE… (NZX → .NZ on Yahoo)"
              />
            </label>
            <label>
              Cost basis (NZD)
              <input
                type="number"
                step="any"
                value={stockForm.costBasisNzd}
                onChange={(e) => setStockForm({ ...stockForm, costBasisNzd: e.target.value })}
                placeholder="unknown"
              />
            </label>
            <label>
              Notes
              <input
                value={stockForm.notes}
                onChange={(e) => setStockForm({ ...stockForm, notes: e.target.value })}
                placeholder="Optional"
              />
            </label>
            {stockResolveHint && (
              <p className="muted small span-2">{stockResolveHint}</p>
            )}
            <button type="submit" className="btn primary">
              Add stock
            </button>
          </form>
        </InlineAddDetails>
      </section>
      ) : null}

      <DividendTracker placement="portfolio" />

{assetEnabled('crypto') ? (
      <Section
        title="Crypto"
        items={grouped.crypto}
        empty="No crypto lines yet."
        onRefresh={refresh}
        onDelete={deleteHolding}
        onUpdateQuantity={updateHoldingQuantity}
        headerExtra={<WalletsTotal state={cryptoWallets} />}
        extraCards={cryptoWallets.entries.map((e) => (
          <WalletCard key={`wallet-${e.wallet.id}`} entry={e} state={cryptoWallets} />
        ))}
      >
        <WalletNotices state={cryptoWallets} />
        {grouped.crypto.length > 0 && cryptoWallets.entries.length > 0 ? (
          <p className="muted small">
            Wallets and manual crypto lines both count toward net worth. If a manual line tracks the same
            coins as a wallet, remove it so they aren&apos;t counted twice.
          </p>
        ) : null}
        <AddWalletDetails state={cryptoWallets} onUseManual={openManualCrypto} />
        <InlineAddDetails label="Add crypto" id={MANUAL_CRYPTO_ID}>
          <form className="form-grid" onSubmit={onAddCrypto}>
            <h4>Add crypto (manual / Nexo)</h4>
            <label>
              Ticker
              <input
                value={cryptoForm.ticker}
                onChange={(e) => {
                  setCryptoForm({ ...cryptoForm, ticker: e.target.value });
                  setCryptoResolveHint(null);
                  setResolvedCryptoName(null);
                }}
                onBlur={() => void resolveCryptoTickerField()}
                required
                placeholder="BTC, ETH, GMT, NEXO…"
                autoCapitalize="characters"
              />
            </label>
            <label>
              Amount
              <input
                type="number"
                step="any"
                value={cryptoForm.amount}
                onChange={(e) => setCryptoForm({ ...cryptoForm, amount: e.target.value })}
                required
              />
            </label>
            <label>
              Cost basis (NZD)
              <input
                type="number"
                step="any"
                value={cryptoForm.costBasisNzd}
                onChange={(e) => setCryptoForm({ ...cryptoForm, costBasisNzd: e.target.value })}
                placeholder="unknown"
              />
            </label>
            <label>
              Notes
              <input
                value={cryptoForm.notes}
                onChange={(e) => setCryptoForm({ ...cryptoForm, notes: e.target.value })}
                placeholder="Optional"
              />
            </label>
            {cryptoResolveHint && (
              <p className="muted small span-2">{cryptoResolveHint}</p>
            )}
            <button type="submit" className="btn primary">
              Add crypto
            </button>
          </form>
        </InlineAddDetails>
      </Section>
      ) : null}

{assetEnabled('gomining') ? (
      <GoMiningMinersSection
        items={grouped.miners}
        empty="No miners yet. Add one below."
        onRefresh={refresh}
        onRefreshMarketplace={refreshMarketplace}
        refreshingMarketplace={refreshingMarketplace}
        marketplaceReport={marketplaceReport}
        onUpdateMiner={updateMinerSpecs}
        settings={gmSettings}
        onSettingsChange={setGmSettings}
        onSaveDiscount={saveGmSettings}
        savingDiscount={savingGm}
      >
        <InlineAddDetails label="Add miner">
          <form className="form-grid" onSubmit={onAddMiner}>
            <h4>Add GoMining miner</h4>
            <label>
              Name / ID
              <input
                value={form.minerName}
                onChange={(e) => setForm({ ...form, minerName: e.target.value })}
                required
                placeholder="e.g. Miner #42"
              />
            </label>
            <label>
              Hashrate (TH/s)
              <input
                type="number"
                step="any"
                value={form.hashrateThs}
                onChange={(e) => setForm({ ...form, hashrateThs: e.target.value })}
                required
              />
            </label>
            <label>
              Energy efficiency (W/TH)
              <input
                type="number"
                step="any"
                value={form.energyEfficiencyWth}
                onChange={(e) =>
                  setForm({ ...form, energyEfficiencyWth: e.target.value })
                }
                placeholder="e.g. 15 — from GoMining app"
              />
            </label>
            <label>
              Rarity
              <input
                value={form.rarity}
                onChange={(e) => setForm({ ...form, rarity: e.target.value })}
                placeholder="Common / Rare / …"
              />
            </label>
            <label>
              Level
              <input
                type="number"
                value={form.level}
                onChange={(e) => setForm({ ...form, level: e.target.value })}
              />
            </label>
            <label>
              Cost basis (NZD)
              <input
                type="number"
                step="any"
                value={form.costBasisNzd}
                onChange={(e) => setForm({ ...form, costBasisNzd: e.target.value })}
                placeholder="unknown"
              />
            </label>
            <label>
              Purchase date
              <input
                type="date"
                value={form.acquiredAt}
                onChange={(e) => setForm({ ...form, acquiredAt: e.target.value })}
              />
            </label>
            <label>
              Est. market value (NZD, optional manual — or use Refresh marketplace)
              <input
                type="number"
                step="any"
                value={form.estimatedValueNzd}
                onChange={(e) => setForm({ ...form, estimatedValueNzd: e.target.value })}
                placeholder="Leave blank if unknown"
              />
            </label>
            <label className="span-2">
              Notes
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
            <button type="submit" className="btn primary">
              Add miner
            </button>
          </form>
        </InlineAddDetails>
      </GoMiningMinersSection>
      ) : null}

{assetEnabled('metal') ? (
      <section className="panel">
        <div className="panel-heading">
          <h3>Metals</h3>
          <div className="row gap" style={{ marginTop: 0 }}>
            <span className="muted small">
              {summary?.metalsSpotStatus
                ? metalSpotHint({
                    status: summary.metalsSpotStatus,
                    source: summary.metalsSpotSource,
                    configured: summary.metalsConfigured,
                  })
                : metalsConfigured == null
                  ? 'Checking metal spots…'
                  : metalsConfigured
                    ? 'Metals.Dev spot NZD'
                    : 'Live NZD/oz t via gold-api.com (no key)'}
            </span>
            <button
              type="button"
              className="btn ghost"
              onClick={refreshMetalsAll}
              disabled={refreshingMetals}
            >
              {refreshingMetals ? 'Refreshing metals…' : 'Refresh metal quotes'}
            </button>
          </div>
        </div>
        {grouped.metals.length === 0 ? (
          <p className="muted">
            No metal holdings yet. Add below, then Refresh metal quotes.
          </p>
        ) : (
          <div className="holding-cards" style={{ marginTop: '0.75rem' }}>
            {grouped.metals.map((h) => (
              <HoldingCard
                key={h.id}
                holding={h}
                onRefresh={refresh}
                onDelete={deleteHolding}
              />
            ))}
          </div>
        )}
        <InlineAddDetails label="Add metal">
          <form className="form-grid" onSubmit={onAddMetal}>
            <h4>Add metal</h4>
            <label>
              Name (optional label)
              <input
                value={metalForm.name}
                onChange={(e) => setMetalForm({ ...metalForm, name: e.target.value })}
                placeholder="e.g. Perth Mint bar"
              />
            </label>
            <label>
              Metal
              <select
                value={metalForm.metal}
                onChange={(e) =>
                  setMetalForm({
                    ...metalForm,
                    metal: e.target.value as typeof metalForm.metal,
                  })
                }
                required
              >
                <option value="gold">Gold</option>
                <option value="silver">Silver</option>
                <option value="platinum">Platinum</option>
                <option value="palladium">Palladium</option>
              </select>
            </label>
            <label>
              Amount
              <input
                type="number"
                step="any"
                value={metalForm.amount}
                onChange={(e) => setMetalForm({ ...metalForm, amount: e.target.value })}
                required
              />
            </label>
            <label>
              Unit
              <select
                value={metalForm.unit}
                onChange={(e) =>
                  setMetalForm({
                    ...metalForm,
                    unit: e.target.value as typeof metalForm.unit,
                  })
                }
                required
              >
                <option value="g">Grams (g)</option>
                <option value="oz_t">Troy ounces (oz t)</option>
              </select>
            </label>
            <label>
              Cost basis (NZD)
              <input
                type="number"
                step="any"
                value={metalForm.costBasisNzd}
                onChange={(e) => setMetalForm({ ...metalForm, costBasisNzd: e.target.value })}
                placeholder="unknown"
              />
            </label>
            <label>
              Notes
              <input
                value={metalForm.notes}
                onChange={(e) => setMetalForm({ ...metalForm, notes: e.target.value })}
                placeholder="Optional"
              />
            </label>
            <button type="submit" className="btn primary">
              Add metal
            </button>
          </form>
        </InlineAddDetails>
      </section>
      ) : null}

{assetEnabled('forex') ? (
      <section className="panel">
        <div className="panel-heading">
          <h3>Forex</h3>
          <div className="row gap" style={{ marginTop: 0 }}>
            <span className="muted small">
              Foreign cash outside bank (e.g. Revolut) · Frankfurter → NZD (never invent)
            </span>
            <button
              type="button"
              className="btn ghost"
              onClick={refreshForexAll}
              disabled={refreshingForex || grouped.forex.length === 0}
            >
              {refreshingForex ? 'Refreshing FX…' : 'Refresh FX rates'}
            </button>
          </div>
        </div>
        {grouped.forex.length === 0 ? (
          <p className="muted">
            No forex holdings yet. Add USD/EUR/GBP (etc.) below — valued in NZD via Frankfurter.
          </p>
        ) : (
          <div className="holding-cards" style={{ marginTop: '0.75rem' }}>
            {grouped.forex.map((h) => (
              <HoldingCard
                key={h.id}
                holding={h}
                onRefresh={refresh}
                onDelete={deleteHolding}
                onUpdateQuantity={updateHoldingQuantity}
              />
            ))}
          </div>
        )}
        <InlineAddDetails label="Add forex">
          <form className="form-grid" onSubmit={onAddForex}>
            <h4>Add forex (outside bank)</h4>
            <label>
              Currency
              <select
                value={forexForm.currency}
                onChange={(e) => setForexForm({ ...forexForm, currency: e.target.value })}
                required
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="AUD">AUD</option>
                <option value="CAD">CAD</option>
                <option value="CHF">CHF</option>
                <option value="JPY">JPY</option>
                <option value="SGD">SGD</option>
              </select>
            </label>
            <label>
              Amount
              <input
                type="number"
                step="any"
                min={0}
                value={forexForm.amount}
                onChange={(e) => setForexForm({ ...forexForm, amount: e.target.value })}
                required
                placeholder="e.g. 500"
              />
            </label>
            <label>
              Source
              <input
                value={forexForm.source}
                onChange={(e) => setForexForm({ ...forexForm, source: e.target.value })}
                placeholder="Revolut, Wise…"
              />
            </label>
            <label>
              Cost basis (NZD, optional)
              <input
                type="number"
                step="any"
                value={forexForm.costBasisNzd}
                onChange={(e) => setForexForm({ ...forexForm, costBasisNzd: e.target.value })}
                placeholder="unknown"
              />
            </label>
            <label>
              Notes
              <input
                value={forexForm.notes}
                onChange={(e) => setForexForm({ ...forexForm, notes: e.target.value })}
                placeholder="Optional"
              />
            </label>
            <button type="submit" className="btn primary">
              Add forex
            </button>
          </form>
        </InlineAddDetails>
      </section>
      ) : null}

{assetEnabled('real_estate') ? (
      <section className="panel">
        <div className="panel-heading">
          <h3>Real estate</h3>
          <span className="muted small">
            Manual market value NZD · mortgage as liability · equity on Dashboard
          </span>
        </div>
        {grouped.realEstate.length === 0 ? (
          <p className="muted">No properties yet. Add below with value, mortgage, optional photo.</p>
        ) : (
          <div className="holding-cards" style={{ marginTop: '0.75rem' }}>
            {grouped.realEstate.map((h) => (
              <HoldingCard key={h.id} holding={h} onDelete={deleteHolding} />
            ))}
          </div>
        )}
        <InlineAddDetails label="Add real estate">
          <form className="form-grid" onSubmit={onAddRealEstate}>
            <h4>Add real estate</h4>
            <label>
              Name / address
              <input
                value={realEstateForm.name}
                onChange={(e) => setRealEstateForm({ ...realEstateForm, name: e.target.value })}
                placeholder="e.g. 12 Example St"
                required
              />
            </label>
            <label>
              Market / owned value (NZD)
              <input
                type="number"
                step="any"
                min={0}
                value={realEstateForm.propertyValueNzd}
                onChange={(e) =>
                  setRealEstateForm({ ...realEstateForm, propertyValueNzd: e.target.value })
                }
                required
              />
            </label>
            <label>
              Mortgage outstanding (NZD)
              <input
                type="number"
                step="any"
                min={0}
                value={realEstateForm.mortgageOutstandingNzd}
                onChange={(e) =>
                  setRealEstateForm({ ...realEstateForm, mortgageOutstandingNzd: e.target.value })
                }
                placeholder="0"
              />
            </label>
            <label>
              Cost basis (NZD, optional)
              <input
                type="number"
                step="any"
                value={realEstateForm.costBasisNzd}
                onChange={(e) =>
                  setRealEstateForm({ ...realEstateForm, costBasisNzd: e.target.value })
                }
              />
            </label>
            <label>
              Photo of house
              <input
                type="file"
                accept="image/*"
                onChange={(e) => onPickImage(e.target.files?.[0] ?? null)}
              />
            </label>
            <label>
              Notes
              <input
                value={realEstateForm.notes}
                onChange={(e) => setRealEstateForm({ ...realEstateForm, notes: e.target.value })}
              />
            </label>
            {realEstateForm.photoBase64 && (
              <p className="muted small span-2">Photo ready to upload with property</p>
            )}
            <button type="submit" className="btn primary">
              Add property
            </button>
          </form>
        </InlineAddDetails>
      </section>
      ) : null}

{assetEnabled('collectable') ? (
      <CollectablesPanel
        holdings={grouped.collectables}
        onChanged={reloadAfterEdit}
        onBanner={setMsg}
        renderCard={(h) => (
          <HoldingCard
            key={h.id}
            holding={h as Holding}
            onRefresh={refresh}
            onDelete={deleteHolding}
          />
        )}
      />
      ) : null}

{assetEnabled('art') ? (
      <Section
        title="Art"
        items={grouped.art}
        empty="No art holdings yet. Add fractional (Masterworks-style) or physical below — manual valuation only."
        onDelete={deleteHolding}
        onUpdateArt={updateArtHolding}
      >
        <InlineAddDetails label="Add art">
          <form className="form-grid" onSubmit={onAddArt}>
            <h4>Add art</h4>
            <p className="muted small span-2">
              No Masterworks API — enter values yourself from the app/UI. Never invent valuations.
            </p>
            <div className="span-2">
              <div className="chart-toggle" role="group" aria-label="Art kind">
                <button
                  type="button"
                  className={`btn${artForm.artKind === 'fractional' ? ' primary' : ''}`}
                  onClick={() => setArtForm({ ...artForm, artKind: 'fractional' })}
                >
                  Fractional
                </button>
                <button
                  type="button"
                  className={`btn${artForm.artKind === 'physical' ? ' primary' : ''}`}
                  onClick={() => setArtForm({ ...artForm, artKind: 'physical' })}
                >
                  Physical piece
                </button>
              </div>
            </div>
            <label>
              Artwork title
              <input
                value={artForm.artworkTitle}
                onChange={(e) => setArtForm({ ...artForm, artworkTitle: e.target.value })}
                placeholder="e.g. Untitled (1962)"
                required
              />
            </label>
            <label>
              Artist
              <input
                value={artForm.artist}
                onChange={(e) => setArtForm({ ...artForm, artist: e.target.value })}
                placeholder="Optional"
              />
            </label>
            {artForm.artKind === 'fractional' ? (
              <>
                <label>
                  Ownership %
                  <input
                    type="number"
                    step="any"
                    min={0.0001}
                    max={100}
                    value={artForm.ownershipPct}
                    onChange={(e) => setArtForm({ ...artForm, ownershipPct: e.target.value })}
                    placeholder="e.g. 2.5"
                    required
                  />
                </label>
                <label>
                  Purchase price (NZD)
                  <input
                    type="number"
                    step="any"
                    min={0}
                    value={artForm.purchasePriceNzd}
                    onChange={(e) =>
                      setArtForm({ ...artForm, purchasePriceNzd: e.target.value })
                    }
                    required
                  />
                </label>
                <label>
                  Purchase date
                  <input
                    type="date"
                    value={artForm.purchaseDate}
                    onChange={(e) => setArtForm({ ...artForm, purchaseDate: e.target.value })}
                    required
                  />
                </label>
                <label>
                  Latest valuation (NZD, optional)
                  <input
                    type="number"
                    step="any"
                    min={0}
                    value={artForm.lastValuationNzd}
                    onChange={(e) =>
                      setArtForm({ ...artForm, lastValuationNzd: e.target.value })
                    }
                    placeholder="From Masterworks UI — manual"
                  />
                </label>
                <label>
                  Platform / external id (optional)
                  <input
                    value={artForm.externalId}
                    onChange={(e) => setArtForm({ ...artForm, externalId: e.target.value })}
                    placeholder="e.g. Masterworks offering id"
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  Appraisal (NZD)
                  <input
                    type="number"
                    step="any"
                    min={0}
                    value={artForm.appraisalNzd}
                    onChange={(e) => setArtForm({ ...artForm, appraisalNzd: e.target.value })}
                    required
                    placeholder="Your appraisal — never invent"
                  />
                </label>
                <label>
                  Purchase / cost (NZD, optional)
                  <input
                    type="number"
                    step="any"
                    min={0}
                    value={artForm.purchasePriceNzd}
                    onChange={(e) =>
                      setArtForm({ ...artForm, purchasePriceNzd: e.target.value })
                    }
                  />
                </label>
                <label>
                  Purchase date (optional)
                  <input
                    type="date"
                    value={artForm.purchaseDate}
                    onChange={(e) => setArtForm({ ...artForm, purchaseDate: e.target.value })}
                  />
                </label>
                <label>
                  Photo
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => onPickArtImage(e.target.files?.[0] ?? null)}
                  />
                </label>
                {artForm.photoBase64 && (
                  <p className="muted small span-2">Photo ready to upload with art</p>
                )}
              </>
            )}
            <label className="span-2">
              Notes
              <input
                value={artForm.notes}
                onChange={(e) => setArtForm({ ...artForm, notes: e.target.value })}
                placeholder="Platform name, condition, etc."
              />
            </label>
            <button type="submit" className="btn primary">
              Add {artForm.artKind === 'physical' ? 'physical art' : 'fractional art'}
            </button>
          </form>
        </InlineAddDetails>
      </Section>
      ) : null}

{assetEnabled('stone') ? (
      <Section
        title="Precious stones"
        items={grouped.stones}
        empty="No precious stones yet. Add diamonds (OpenFacet live) or other gems (manual NZD) below."
        onRefresh={refresh}
        onDelete={deleteHolding}
      >
        <InlineAddDetails label="Add precious stone">
          <form className="form-grid" onSubmit={onAddStone}>
            <h4>Add precious stone</h4>
            <label>
              Name (optional)
              <input
                value={stoneForm.name}
                onChange={(e) => setStoneForm({ ...stoneForm, name: e.target.value })}
                placeholder="e.g. Engagement diamond"
              />
            </label>
            <label>
              Stone type
              <select
                value={stoneForm.stoneType}
                onChange={(e) => setStoneForm({ ...stoneForm, stoneType: e.target.value })}
                required
              >
                <option value="Diamond">Diamond</option>
                <option value="Ruby">Ruby</option>
                <option value="Sapphire">Sapphire</option>
                <option value="Emerald">Emerald</option>
                <option value="Other">Other…</option>
              </select>
            </label>
            {stoneForm.stoneType === 'Other' && (
              <label>
                Other type
                <input
                  value={stoneForm.stoneTypeOther}
                  onChange={(e) => setStoneForm({ ...stoneForm, stoneTypeOther: e.target.value })}
                  required
                  placeholder="e.g. Tanzanite"
                />
              </label>
            )}
            <label>
              Carat
              <input
                type="number"
                step="any"
                min={0.01}
                value={stoneForm.carat}
                onChange={(e) => setStoneForm({ ...stoneForm, carat: e.target.value })}
                required
                placeholder="e.g. 1.0 (diamonds: 0.3–6.0 for live quote)"
              />
            </label>
            {isDiamondStoneTypeUi(stoneForm.stoneType) && (
              <>
                <label>
                  Colour (D–M)
                  <select
                    value={stoneForm.colour}
                    onChange={(e) => setStoneForm({ ...stoneForm, colour: e.target.value })}
                    required
                  >
                    {DIAMOND_COLOURS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Clarity
                  <select
                    value={stoneForm.clarity}
                    onChange={(e) => setStoneForm({ ...stoneForm, clarity: e.target.value })}
                    required
                  >
                    {DIAMOND_CLARITIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Cut / shape
                  <select
                    value={stoneForm.cut}
                    onChange={(e) => setStoneForm({ ...stoneForm, cut: e.target.value })}
                  >
                    {DIAMOND_SHAPES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label>
              Cost basis (NZD, optional)
              <input
                type="number"
                step="any"
                value={stoneForm.costBasisNzd}
                onChange={(e) => setStoneForm({ ...stoneForm, costBasisNzd: e.target.value })}
                placeholder="unknown"
              />
            </label>
            <label>
              {isDiamondStoneTypeUi(stoneForm.stoneType)
                ? 'Estimated value NZD (optional override if live quote fails)'
                : 'Estimated value NZD (required — no live gem API)'}
              <input
                type="number"
                step="any"
                min={0}
                value={stoneForm.valuationNzd}
                onChange={(e) => setStoneForm({ ...stoneForm, valuationNzd: e.target.value })}
                required={!isDiamondStoneTypeUi(stoneForm.stoneType)}
                placeholder={isDiamondStoneTypeUi(stoneForm.stoneType) ? 'Leave blank for OpenFacet' : 'Manual estimate'}
              />
            </label>
            <label>
              Notes
              <input
                value={stoneForm.notes}
                onChange={(e) => setStoneForm({ ...stoneForm, notes: e.target.value })}
                placeholder="Optional"
              />
            </label>
            <p className="muted small span-2">
              Diamonds: live{' '}
              <a href="https://openfacet.net/" target="_blank" rel="noreferrer">
                OpenFacet
              </a>{' '}
              (MCP{' '}
              <a href="https://mcp.openfacet.net/" target="_blank" rel="noreferrer">
                mcp.openfacet.net
              </a>
              ) USD → Frankfurter NZD (never invent). Other gems: manual NZD only — no live gem API.
            </p>
            <button type="submit" className="btn primary">
              Add stone
            </button>
          </form>
        </InlineAddDetails>
      </Section>
      ) : null}


    </div>
  );
}
