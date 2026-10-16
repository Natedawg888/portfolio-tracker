import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { prefetchNavTarget } from '../lib/routePrefetch';
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
import type { AssetBreakdownRow } from '../components/AssetBreakdownChart';
import { PortfolioTabs } from '../components/portfolio/PortfolioTabs';
import { PortfolioHeader, type RefreshProgress } from '../components/portfolio/PortfolioHeader';
import { OverviewTab, type OverviewRow } from '../components/portfolio/OverviewTab';
import { StocksTab } from '../components/portfolio/StocksTab';
import { CryptoList } from '../components/portfolio/CryptoList';
import { MetalsTab } from '../components/portfolio/MetalsTab';
import { dailyAverage, monthProgress } from '../lib/budgetView';
import { monthStart, todayAucklandYmd } from '../lib/period';
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
import {
  amountLabel,
  displayCostBasisNzd,
  displayName,
  formatAmount,
  formatHashrate,
  marketValueNzd,
  tickerFor,
  type Holding,
} from '../lib/holdingDisplay';
import {
  findIssues,
  formatSignedPct,
  holdingDomId,
  holdingReturn,
  panelId,
  priceSources,
  tabFromHash,
  tabId,
  visibleTabs,
  type PortfolioTab,
} from '../lib/portfolioView';
import { MoreMenu } from '../components/MoreMenu';
import { InfoTip } from '../components/InfoTip';
import {
  ADD_TAB,
  FOREX_CURRENCIES,
  parsePortfolioAddParams,
  PORTFOLIO_LINK_PARAMS,
  type PortfolioAddKind,
  type PortfolioAddRequest,
} from '../lib/portfolioAddParams';
import { revealAddForm, revealHolding, whenElementAppears } from '../lib/revealElement';
import { AddCostButton } from '../components/portfolio/AddCostButton';
import { ClassHeading } from '../components/portfolio/ClassHeading';
import { PropertyList, type PropertyDetailsPatch, type PropertyValuePatch } from '../components/portfolio/PropertyList';

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



function parseOptionalNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

function HoldingCard({
  holding,
  onRefresh,
  onDelete,
  onUpdateQuantity,
  onUpdateArt,
  onSetCost,
}: {
  holding: Holding;
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
  /** "+ Add cost" when the holding has no cost. */
  onSetCost?: (id: string, costNzd: number) => Promise<boolean>;
}) {
  const ticker = tickerFor(holding);
  const value = marketValueNzd(holding);
  const cost = displayCostBasisNzd(holding);
  const ret = holdingReturn(value, cost);
  const showRefresh =
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

  const canDelete =
    holding.assetClass === 'stock' ||
    holding.assetClass === 'crypto' ||
    holding.assetClass === 'forex' ||
    holding.assetClass === 'real_estate' ||
    holding.assetClass === 'collectable' ||
    holding.assetClass === 'art' ||
    holding.assetClass === 'metal' ||
    holding.assetClass === 'stone';

  const [editing, setEditing] = useState(false);
  const [editQuantity, setEditQuantity] = useState(
    String(holding.assetClass === 'stock' ? holding.shares ?? '' : holding.amount ?? ''),
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

  // Keep edit fields in sync when holding updates from parent reload.
  useEffect(() => {
    if (!editing) {
      setEditQuantity(
        String(holding.assetClass === 'stock' ? holding.shares ?? '' : holding.amount ?? ''),
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
    holding.lastValuationNzd,
    holding.ownershipPct,
    holding.purchasePriceNzd,
    holding.purchaseDate,
    editing,
  ]);

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
    <article className="holding-card" id={holdingDomId(holding.id)} tabIndex={-1}>
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
          <dd className={ret.kind === 'ok' ? (ret.pct >= 0 ? 'return-pos' : 'return-neg') : undefined}>
            {ret.kind === 'ok' ? (
              formatSignedPct(ret.pct)
            ) : ret.kind === 'no_cost' && onSetCost ? (
              <AddCostButton name={displayName(holding)} onSave={(c) => onSetCost(holding.id, c)} />
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div>
          <dt>Earnings</dt>
          <dd className={ret.kind === 'ok' ? (ret.returnNzd >= 0 ? 'return-pos' : 'return-neg') : undefined}>
            {ret.kind === 'ok' ? `${ret.returnNzd > 0 ? '+' : ''}${formatNzd(ret.returnNzd)}` : '—'}
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

      {(showRefresh && onRefresh) || (canDelete && onDelete) ? (
        <div className="holding-card-actions">
          <MoreMenu label={`More actions for ${displayName(holding)}`}>
            {(close) => (
              <>
                {showRefresh && onRefresh ? (
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => {
                      close();
                      onRefresh(holding.id);
                    }}
                  >
                    Refresh value
                  </button>
                ) : null}
                {canDelete && onDelete ? (
                  <button
                    type="button"
                    className="btn small danger"
                    onClick={() => {
                      close();
                      onDelete(holding.id);
                    }}
                  >
                    Delete
                  </button>
                ) : null}
              </>
            )}
          </MoreMenu>
        </div>
      ) : null}
    </article>
  );
}


const MANUAL_CRYPTO_ID = 'add-crypto-manual';

/** The inline add form each Value Search "Add" link opens (cards use the collectables modal). */
const ADD_DETAILS_ID: Record<Exclude<PortfolioAddKind, 'card'>, string> = {
  stock: 'add-stock',
  crypto: MANUAL_CRYPTO_ID,
  metal: 'add-metal',
  forex: 'add-forex',
  miner: 'add-miner',
};

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
  onSetCost,
  headerExtra,
  extraCards,
  before,
  info,
  total,
  children,
}: {
  title: string;
  items: Holding[];
  empty: string;
  /** ⓘ beside the title: where values come from. */
  info?: ReactNode;
  /** Class total from the portfolio summary; null while loading. */
  total: number | null;
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
  onSetCost?: (id: string, costNzd: number) => Promise<boolean>;
  /** Shown beside the title (e.g. a section total). */
  headerExtra?: ReactNode;
  /** Extra cards rendered in the same grid after the holdings (e.g. crypto wallets). */
  extraCards?: ReactNode[];
  /** Rendered between the heading and the card grid (e.g. the crypto list). */
  before?: ReactNode;
  children?: ReactNode;
}) {
  const hasExtra = Boolean(extraCards?.length);
  return (
    <section className="panel">
      <ClassHeading title={title} info={info} total={total}>
        {headerExtra}
      </ClassHeading>
      {before}
      {items.length === 0 && !hasExtra ? (
        empty ? <p className="muted">{empty}</p> : null
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
              onSetCost={onSetCost}
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
  marketplaceReport,
  received,
  onSetCost,
  onUpdateMiner,
  settings,
  onSettingsChange,
  onSaveDiscount,
  savingDiscount,
  classTotal: total,
  children,
}: {
  items: Holding[];
  empty: string;
  /** Class total from the portfolio summary; null while loading. */
  classTotal: number | null;
  onRefresh?: (id: string) => void;
  /** Mining income recorded on Budget this month; null if it couldn't be loaded. */
  received: { total: number; count: number; avgPerDay: number | null } | null;
  onSetCost: (id: string, costNzd: number) => Promise<boolean>;
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

  const [period, setPeriod] = useState<EarningsPeriod>('month');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const currency: 'NZD' | 'USD' | 'BTC' = settings.displayCurrency === 'ALL' ? 'NZD' : settings.displayCurrency;
  const totalEarnings = totals.periods[period];
  const totalsHaveFigures = totals.netBtcPerDay != null || totals.poolRewardBtcPerDay != null;
  const sorted = [...items].sort((a, b) => (Number(b.hashrateThs) || 0) - (Number(a.hashrateThs) || 0));

  return (
    <section className="panel mining-panel" aria-labelledby="mining-title">
      <ClassHeading id="mining-title" title="GoMining miners" total={total} />

      {items.length > 0 ? (
        <dl className="budget-summary-figures mining-summary">
          <div>
            <dt>Est. value</dt>
            <dd className="money">
              {formatNzd(totalEstNzd)}
              <span className="budget-figure-note">GoMining marketplace or your own figure</span>
            </dd>
          </div>
          <div>
            <dt>Hashrate</dt>
            <dd>
              {formatAmount(totalThs, 2)} TH/s
              <span className="budget-figure-note">
                {avgEeWeighted != null ? `avg ${formatAmount(avgEeWeighted, 2)} W/TH (TH-weighted)` : 'no W/TH recorded'}
              </span>
            </dd>
          </div>
          <div>
            <dt>Received this month</dt>
            <dd className="money">
              {received == null ? '—' : formatNzd(received.total)}
              <span className="budget-figure-note">
                {received == null
                  ? 'income records unavailable'
                  : received.count === 0
                    ? 'no mining income recorded on Budget'
                    : `${received.count} payment${received.count === 1 ? '' : 's'}${
                        received.avgPerDay != null ? ` · avg ${formatNzd(received.avgPerDay)}/day` : ''
                      }`}
              </span>
            </dd>
          </div>
          <div>
            <dt>Maintenance</dt>
            <dd>
              {totals.maintenanceUsdAfterDiscount != null ? `US$${totals.maintenanceUsdAfterDiscount.toFixed(2)}/day` : '—'}
              <span className="budget-figure-note">
                {settings.discountPct > 0 ? `after ${settings.discountPct}% discount` : 'electricity + service'}
              </span>
            </dd>
          </div>
        </dl>
      ) : null}

      {marketplaceReport && marketplaceReport.failures.length > 0 ? (
        <details className="marketplace-report">
          <summary className="muted small">
            Last value refresh: {marketplaceReport.appliedCount}/{marketplaceReport.total} miners valued ·{' '}
            {marketplaceReport.failedCount} not
          </summary>
          <ul className="marketplace-fail-list muted small">
            {marketplaceReport.failures.map((f) => (
              <li key={`${f.minerName}-${f.ee}`}>
                <strong>{f.minerName}</strong> ({f.ee}): {f.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {items.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <>
          <div className="mining-toggles">
            <div className="segmented segmented--small" role="group" aria-label="Earnings period">
              {PERIOD_LABELS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={'segmented-btn' + (period === key ? ' active' : '')}
                  aria-pressed={period === key}
                  onClick={() => setPeriod(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="segmented segmented--small" role="group" aria-label="Earnings currency">
              {(['NZD', 'USD', 'BTC'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={'segmented-btn' + (currency === c ? ' active' : '')}
                  aria-pressed={currency === c}
                  onClick={() => onSettingsChange({ ...settings, displayCurrency: c })}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <ul className="asset-list asset-list--miners">
            <li className="asset-list-head" aria-hidden="true">
              <span>Miner</span>
              <span>Cost</span>
              <span>Value</span>
              <span className="mining-earn-head">
                Est. earnings / {period}
                <InfoTip label="Where the earnings estimate comes from">{fxNote}</InfoTip>
              </span>
              <span />
            </li>
            {sorted.map((h) => (
              <MinerRow
                key={h.id}
                holding={h}
                estimate={earningsById[h.id] ?? null}
                period={period}
                currency={currency}
                onRefresh={onRefresh}
                onUpdateMiner={onUpdateMiner}
                onSetCost={onSetCost}
              />
            ))}
            <li className="asset-row mining-total-row">
              <div className="asset-row-hit asset-row-static">
                <span className="asset-row-title">All miners</span>
                <span />
                <span className="money">{formatNzd(totalEstNzd)}</span>
                <span className="money">
                  {totalsHaveFigures ? formatEarningsAmount(totalEarnings, currency, totals.anyCompleteNet) : '—'}
                </span>
                <span />
              </div>
            </li>
          </ul>
          {!totals.anyCompleteNet ? (
            <p className="muted small">
              Some figures are pool earnings before maintenance: set W/TH on each miner and keep BTC FX and pool income
              available for a full net estimate.
            </p>
          ) : null}
        </>
      )}

      <div className="mining-settings">
        <button
          type="button"
          className="debt-link-button"
          aria-expanded={settingsOpen}
          aria-controls={settingsOpen ? 'mining-settings-body' : undefined}
          onClick={() => setSettingsOpen((o) => !o)}
        >
          Discount and network settings <span aria-hidden="true">{settingsOpen ? '▴' : '▾'}</span>
        </button>
        {settingsOpen ? (
          <div id="mining-settings-body" className="form-grid gomining-params-grid">
            <label>
              GoMining discount (%)
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={settings.discountPct}
                onChange={(e) => onSettingsChange({ ...settings, discountPct: Number(e.target.value) || 0 })}
              />
            </label>
            <label>
              BTC / USD
              <input
                type="number"
                step="any"
                value={settings.btcUsd}
                onChange={(e) => onSettingsChange({ ...settings, btcUsd: e.target.value })}
                placeholder="Blank uses GoMining’s rate"
              />
            </label>
            <label>
              Network hashrate (EH/s)
              <input
                type="number"
                step="any"
                value={settings.networkHashrateEhs}
                onChange={(e) => onSettingsChange({ ...settings, networkHashrateEhs: e.target.value })}
                placeholder="Blank uses live network"
              />
            </label>
            <label>
              Daily BTC issuance
              <input
                type="number"
                step="any"
                value={settings.dailyBtcIssuance}
                onChange={(e) => onSettingsChange({ ...settings, dailyBtcIssuance: e.target.value })}
                placeholder="Blank uses 450"
              />
            </label>
            <label>
              kWh cost (USD)
              <input
                type="number"
                step="any"
                value={settings.kWhCostUsd}
                onChange={(e) => onSettingsChange({ ...settings, kWhCostUsd: e.target.value })}
                placeholder="Blank uses GoMining’s"
              />
            </label>
            <div className="span-2 row gap">
              <button type="button" className="btn small primary" onClick={onSaveDiscount} disabled={savingDiscount}>
                {savingDiscount ? 'Saving…' : 'Save settings'}
              </button>
            </div>
            {settings.note ? <p className="muted small span-2">{settings.note}</p> : null}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function MinerRow({
  holding: h,
  estimate,
  period,
  currency,
  onRefresh,
  onUpdateMiner,
  onSetCost,
}: {
  holding: Holding;
  estimate: GoMiningEarningsEstimate | null;
  period: EarningsPeriod;
  currency: 'NZD' | 'USD' | 'BTC';
  onRefresh?: (id: string) => void;
  onUpdateMiner?: (
    id: string,
    patch: { hashrateThs: number; energyEfficiencyWth: number | null; estimatedValueNzd?: number | null },
  ) => Promise<void>;
  onSetCost: (id: string, costNzd: number) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const cost = displayCostBasisNzd(h);
  const value = marketValueNzd(h);
  const hasNet = estimate?.netBtcStatus === 'ok';
  const hasPool = estimate?.poolRewardStatus === 'ok';
  const earnings = estimate && (hasNet || hasPool) ? formatEarningsAmount(estimate.periods[period], currency, hasNet) : '—';

  return (
    <li id={holdingDomId(h.id)} tabIndex={-1} className="asset-row">
      <div className="asset-row-hit asset-row-static">
        <span className="asset-row-name">
          <span className="asset-row-title">{displayName(h)}</span>
          <span className="muted small">
            {formatHashrate(h.hashrateThs)} TH/s
            {h.energyEfficiencyWth != null ? ` · ${formatAmount(h.energyEfficiencyWth, 2)} W/TH` : ' · W/TH not set'}
          </span>
        </span>
        <span className="asset-row-num small">
          {cost != null && cost > 0 ? (
            formatNzd(cost)
          ) : (
            <AddCostButton name={displayName(h)} onSave={(c) => onSetCost(h.id, c)} />
          )}
        </span>
        <span className="money">{formatNzd(value)}</span>
        <span className="money">
          {earnings}
          {estimate && !hasNet && hasPool ? <span className="muted small"> pool</span> : null}
        </span>
        <MoreMenu label={`More actions for ${displayName(h)}`}>
          {(close) => (
            <>
              {onUpdateMiner ? (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    close();
                    setEditing(true);
                  }}
                >
                  Edit TH / W/TH / value
                </button>
              ) : null}
              {onRefresh ? (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    close();
                    onRefresh(h.id);
                  }}
                >
                  Refresh value
                </button>
              ) : null}
            </>
          )}
        </MoreMenu>
      </div>
      {editing && onUpdateMiner ? (
        <MinerEditForm holding={h} onSave={onUpdateMiner} onClose={() => setEditing(false)} />
      ) : null}
    </li>
  );
}

function MinerEditForm({
  holding: h,
  onSave,
  onClose,
}: {
  holding: Holding;
  onSave: (
    id: string,
    patch: { hashrateThs: number; energyEfficiencyWth: number | null; estimatedValueNzd?: number | null },
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [th, setTh] = useState(String(h.hashrateThs ?? ''));
  const [ee, setEe] = useState(h.energyEfficiencyWth != null ? String(h.energyEfficiencyWth) : '');
  const [est, setEst] = useState(h.estimatedValueNzd != null ? String(h.estimatedValueNzd) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const thN = Number(th);
    if (!Number.isFinite(thN) || thN <= 0) return setError('TH/s must be a positive number.');
    const eeN = ee.trim() === '' ? null : Number(ee);
    if (eeN != null && (!Number.isFinite(eeN) || eeN < 0)) return setError('W/TH must be 0 or more, or blank.');
    const estN = est.trim() === '' ? null : Number(est);
    if (estN != null && (!Number.isFinite(estN) || estN < 0)) return setError('Value must be 0 or more, or blank.');
    setBusy(true);
    setError(null);
    try {
      await onSave(h.id, { hashrateThs: thN, energyEfficiencyWth: eeN, estimatedValueNzd: estN });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="plan-editor miner-inline-edit"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onClose();
      }}
    >
      <div className="plan-editor-row">
        <label>
          TH/s <input type="number" step="any" min={0} value={th} onChange={(e) => setTh(e.target.value)} disabled={busy} autoFocus />
        </label>
        <label>
          W/TH <input type="number" step="any" min={0} value={ee} onChange={(e) => setEe(e.target.value)} disabled={busy} placeholder="optional" />
        </label>
        <label>
          Value NZD{' '}
          <input type="number" step="any" min={0} value={est} onChange={(e) => setEst(e.target.value)} disabled={busy} placeholder="blank = marketplace" />
        </label>
        <button type="submit" className="btn small primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn small ghost" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
      {error ? (
        <p className="plan-editor-error" role="alert">{error}</p>
      ) : null}
    </form>
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

/** Holding asset class → the preference that enables it. */
const CLASS_PREF: Record<string, AssetClassPrefKey> = {
  stock: 'stock',
  crypto: 'crypto',
  gomining_miner: 'gomining',
  metal: 'metal',
  forex: 'forex',
  real_estate: 'real_estate',
  art: 'art',
  stone: 'stone',
  collectable: 'collectable',
};

/** Overview rows: one-line description and where the row leads. */
const OVERVIEW_ROW_META: Record<string, { description: string; tab?: PortfolioTab; href?: string }> = {
  cash: { description: 'Bank balances synced from Akahu and accounts you added', href: '/' },
  stocks: { description: 'Sharesies and Hatch via Akahu, plus manual tickers', tab: 'stocks' },
  crypto: { description: 'Wallets and holdings, valued at market quotes', tab: 'crypto' },
  gomining: { description: 'GoMining miners at marketplace or your own value', tab: 'mining' },
  metals: { description: 'Bullion valued at the live spot price', tab: 'metals' },
  collectables: { description: 'Trading cards and other collectables', tab: 'collectables' },
  forex: { description: 'Foreign cash held outside your bank', tab: 'forex' },
  realEstate: { description: 'Property equity: your value minus the mortgage', tab: 'property' },
  art: { description: 'Art at your recorded valuation', tab: 'art' },
  stones: { description: 'Precious stones at a quote or your valuation', tab: 'stones' },
  kiwiSaver: { description: 'Sharesies KiwiSaver and bank-held KiwiSaver', href: '/kiwisaver' },
};

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
  const [error, setError] = useState<string | null>(null);
  const [refreshProgress, setRefreshProgress] = useState<RefreshProgress | null>(null);
  const [miningReceived, setMiningReceived] = useState<{ total: number; count: number; avgPerDay: number | null } | null>(
    null,
  );
  // Tabs: the selected tab lives in the URL hash so links and back/forward work.
  const location = useLocation();
  const navigate = useNavigate();
  const tabs = visibleTabs((pref) => assetEnabled(pref as AssetClassPrefKey));
  const tab = tabFromHash(location.hash, tabs);
  const selectTab = useCallback(
    (next: PortfolioTab) => navigate({ hash: next === 'overview' ? '' : next }),
    [navigate],
  );
  // Value Search links: ?add=… seeds an add form, ?holding=<id> scrolls to a holding.
  const [searchParams] = useSearchParams();
  const linkParams = searchParams.toString();
  const [reveal, setReveal] = useState<{ kind: 'add'; id: string } | { kind: 'holding'; holdingId: string } | null>(
    null,
  );
  const [cardPrefill, setCardPrefill] = useState<Extract<PortfolioAddRequest, { kind: 'card' }> | null>(null);
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

  // Seed the form while rendering (not in an effect) so it is filled on the first paint.
  const [handledLink, setHandledLink] = useState('');
  if (linkParams !== handledLink) {
    setHandledLink(linkParams);
    const params = new URLSearchParams(linkParams);
    const add = parsePortfolioAddParams(params);
    const holdingId = params.get('holding');
    const num = (n: number | null) => (n == null ? '' : String(n));
    switch (add?.kind) {
      case 'stock':
        setStockForm({ ...emptyStock, ticker: add.ticker });
        setStockResolveHint(null);
        setResolvedStockName(null);
        break;
      case 'crypto':
        setCryptoForm({ ...emptyCrypto, ticker: add.ticker });
        setCryptoResolveHint(null);
        setResolvedCryptoName(null);
        break;
      case 'metal':
        setMetalForm({ ...emptyMetal, metal: add.metal, amount: num(add.amount), unit: add.unit ?? emptyMetal.unit });
        break;
      case 'forex':
        setForexForm({ ...emptyForex, currency: add.currency, amount: num(add.amount) });
        break;
      case 'miner':
        setForm({ ...emptyMiner, hashrateThs: num(add.ths), energyEfficiencyWth: num(add.wPerTh) });
        break;
      case 'card':
        setCardPrefill(add);
        break;
    }
    if (add && add.kind !== 'card') setReveal({ kind: 'add', id: ADD_DETAILS_ID[add.kind] });
    else if (!add && holdingId) setReveal({ kind: 'holding', holdingId });
  }

  // Then drop the link params so a refresh doesn't seed the form again; the hash keeps the tab.
  useEffect(() => {
    const params = new URLSearchParams(linkParams);
    if (!PORTFOLIO_LINK_PARAMS.some((k) => params.has(k))) return;
    const add = parsePortfolioAddParams(params);
    for (const k of PORTFOLIO_LINK_PARAMS) params.delete(k);
    navigate({ search: params.toString(), hash: add ? ADD_TAB[add.kind] : location.hash }, { replace: true });
  }, [linkParams, navigate, location.hash]);

  useEffect(() => {
    if (!reveal) return;
    const id = reveal.kind === 'add' ? reveal.id : holdingDomId(reveal.holdingId);
    return whenElementAppears(id, (el) => {
      if (el instanceof HTMLDetailsElement) revealAddForm(el);
      else revealHolding(el);
      setReveal(null);
    });
  }, [reveal]);

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

  const gominingOn = assetEnabled('gomining');
  useEffect(() => {
    if (!gominingOn) return;
    let live = true;
    const today = todayAucklandYmd();
    const ym = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
    api.income
      .list({ month: monthStart(ym).slice(0, 7) })
      .then((rows) => {
        if (!live) return;
        const mining = rows.filter(
          (r) => /^cat-income-mining/.test(r.categoryId ?? '') || /mining/i.test(r.categoryName ?? ''),
        );
        const total = mining.reduce((sum, r) => sum + (Number(r.amountNzd) || 0), 0);
        setMiningReceived({
          total,
          count: mining.length,
          avgPerDay: dailyAverage(total, mining.map((r) => r.date), monthProgress(ym, today)),
        });
      })
      .catch(() => {
        if (live) setMiningReceived(null);
      });
    return () => {
      live = false;
    };
  }, [gominingOn]);

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
      showQuietToast(`${currency} added.`, { kind: 'info' });
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
      showQuietToast(`${name} added.`, { kind: 'info' });
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
      const propertyName = realEstateForm.name.trim() || 'Property';
      await api.holdings.create({
        assetClass: 'real_estate',
        name: propertyName,
        propertyValueNzd,
        mortgageOutstandingNzd,
        costBasisNzd: parseOptionalNumber(realEstateForm.costBasisNzd),
        acquiredAt: realEstateForm.acquiredAt || null,
        notes: realEstateForm.notes || null,
        photoBase64: realEstateForm.photoBase64 || undefined,
      });
      setRealEstateForm(emptyRealEstate);
      showQuietToast(`${propertyName} added.`, { kind: 'info' });
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
        showQuietToast(`${title} added.`, { kind: 'info' });
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
        showQuietToast(`${title} added.`, { kind: 'info' });
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

  async function setHoldingCost(id: string, costNzd: number): Promise<boolean> {
    setMsg(null);
    try {
      await api.holdings.update(id, { costBasisNzd: costNzd });
      const h = holdings.find((x) => x.id === id);
      setMsg(`Saved a cost of ${formatNzd(costNzd)}${h ? ` for ${displayName(h)}` : ''}.`);
      await reloadAfterEdit();
      return true;
    } catch (err) {
      setMsg((err as Error).message);
      return false;
    }
  }

  async function savePropertyValue(id: string, patch: PropertyValuePatch): Promise<boolean> {
    setMsg(null);
    try {
      await api.holdings.update(id, patch);
      showQuietToast('Value updated.', { kind: 'info' });
      await reloadAfterEdit();
      return true;
    } catch (err) {
      setMsg((err as Error).message);
      return false;
    }
  }

  async function savePropertyDetails(id: string, patch: PropertyDetailsPatch): Promise<boolean> {
    setMsg(null);
    try {
      await api.holdings.update(id, patch);
      showQuietToast(`${patch.name} saved.`, { kind: 'info' });
      await reloadAfterEdit();
      return true;
    } catch (err) {
      setMsg((err as Error).message);
      return false;
    }
  }

  /** Runs every existing refresh in turn (per-holding for stocks / crypto, bulk for the rest). */
  async function refreshAllPrices() {
    if (refreshProgress) return;
    const pricedStocks = assetEnabled('stock') ? grouped.stocks.filter((h) => Number(h.shares) > 0) : [];
    const pricedCrypto = assetEnabled('crypto') ? grouped.crypto.filter((h) => Number(h.amount) > 0) : [];
    const steps: Array<{ label: string; run: () => Promise<unknown> }> = [];
    for (const h of pricedStocks) steps.push({ label: `Stocks: ${displayName(h)}`, run: () => api.holdings.refreshValue(h.id) });
    for (const h of pricedCrypto) steps.push({ label: `Crypto: ${displayName(h)}`, run: () => api.holdings.refreshValue(h.id) });
    if (assetEnabled('metal') && grouped.metals.length > 0) {
      steps.push({ label: 'Metal quotes', run: () => api.quotes.refreshMetals() });
    }
    if (assetEnabled('collectable') && grouped.collectables.some((h) => isApiCardGame(h.cardGame))) {
      steps.push({ label: 'Card quotes', run: () => api.holdings.refreshCollectablesValues() });
    }
    if (assetEnabled('gomining') && grouped.miners.length > 0) {
      steps.push({
        label: 'GoMining miner values',
        run: async () => {
          const r = await api.holdings.refreshGominingValues();
          setMarketplaceReport({
            appliedCount: r.appliedCount,
            total: r.total,
            failedCount: r.failedCount ?? 0,
            availableEeBands: r.availableEeBands ?? [],
            note: r.note ?? null,
            failures: (r.results ?? [])
              .filter((row) => !row.applied)
              .map((row) => ({
                minerName: String(row.minerName ?? row.holdingId),
                ee: row.energyEfficiencyWth != null ? `${row.energyEfficiencyWth} W/TH` : 'W/TH unknown',
                reason: String(row.failReason ?? row.quote?.message ?? 'No marketplace match'),
              })),
          });
          loadGmSettings();
        },
      });
    }
    if (assetEnabled('forex') && grouped.forex.length > 0) {
      steps.push({ label: 'FX rates', run: () => api.holdings.refreshForexValues() });
    }
    if (steps.length === 0) {
      setMsg('Nothing to refresh yet.');
      return;
    }
    setMsg(null);
    const failed: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      setRefreshProgress({ label: steps[i].label, step: i + 1, steps: steps.length });
      try {
        await steps[i].run();
      } catch {
        failed.push(steps[i].label);
      }
    }
    setRefreshProgress(null);
    await reloadAfterEdit();
    setMsg(
      failed.length === 0
        ? `Refreshed ${steps.length} price${steps.length === 1 ? '' : 's'}.`
        : `Refreshed ${steps.length - failed.length} of ${steps.length}. Not refreshed: ${failed.slice(0, 4).join('; ')}${
            failed.length > 4 ? '…' : ''
          }. Values that couldn't refresh keep their last price.`,
    );
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
          name: 'Property',
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

  /** A class tab's header total: the same figure as its Overview row (null while loading). */
  const classTotal = (key: string): number | null =>
    summary ? (assetBreakdown.find((r) => r.key === key)?.value ?? 0) : null;

  const totalAssetValueNzd = assetBreakdown.reduce(
    (sum, row) => sum + (Number.isFinite(row.value) ? Math.max(0, row.value) : 0),
    0,
  );

  const metalsInfo = summary?.metalsSpotStatus
    ? metalSpotHint({
        status: summary.metalsSpotStatus,
        source: summary.metalsSpotSource,
        configured: summary.metalsConfigured,
      })
    : metalsConfigured == null
      ? 'Checking metal spots…'
      : metalsConfigured
        ? 'Metal spots: Metals.Dev, NZD per oz t.'
        : 'Metal spots: gold-api.com, NZD per oz t (no key needed).';
  const sources = priceSources(
    holdings.filter((h) => assetEnabled(CLASS_PREF[h.assetClass] ?? ('stock' as AssetClassPrefKey))),
    summary?.metalsSpotSource ?? null,
  );
  const overviewRows: OverviewRow[] = assetBreakdown.map((row) => ({
    key: row.key,
    name: row.name,
    value: row.value,
    colour: row.colour,
    ...OVERVIEW_ROW_META[row.key],
  }));
  const issues = findIssues(
    holdings.map((h) => ({
      id: h.id,
      assetClass: h.assetClass,
      name: displayName(h),
      source: h.source ?? null,
      shares: h.shares ?? null,
      amount: h.amount ?? null,
      costNzd: displayCostBasisNzd(h),
      valueNzd: marketValueNzd(h),
    })),
  ).filter((i) => tabs.includes(i.tab));

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
      <PortfolioHeader
        total={summary ? totalAssetValueNzd : null}
        asOf={summary?.asOf ?? null}
        sources={sources}
        info={
          <>
            Total of the asset classes you have turned on (Settings → asset classes). Values come from known quotes and
            recorded balances; nothing is estimated. {metalsInfo}
            {summary?.quoteNote ? ` ${summary.quoteNote}` : ''}
          </>
        }
        progress={refreshProgress}
        onRefreshAll={() => void refreshAllPrices()}
      />
      <PortfolioTabs tabs={tabs} active={tab} onSelect={selectTab} />
      {msg && (
        <p className="banner" role="status">
          {msg}
        </p>
      )}

      <div
        id={panelId(tab)}
        role="tabpanel"
        aria-labelledby={tabId(tab)}
        tabIndex={0}
        className="portfolio-panel stack"
      >
{tab === 'overview' ? (
        summary ? (
          <OverviewTab rows={overviewRows} issues={issues} onOpenTab={selectTab} />
        ) : (
          <p className="muted">Loading your portfolio…</p>
        )
      ) : null}

{tab === 'stocks' && assetEnabled('stock') ? (
      <>
        <StocksTab
          holdings={grouped.stocks}
          total={classTotal('stocks')}
          onRefresh={refresh}
          onDelete={deleteHolding}
          onUpdateQuantity={updateHoldingQuantity}
          onSetCost={setHoldingCost}
        />
      <section className="panel">
        <InlineAddDetails label="Add stock" id={ADD_DETAILS_ID.stock}>
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
      </>
      ) : null}

{tab === 'dividends' && assetEnabled('stock') ? <DividendTracker placement="portfolio" /> : null}

{tab === 'crypto' && assetEnabled('crypto') ? (
      <Section
        title="Crypto"
        total={classTotal('crypto')}
        items={[]}
        empty=""
        headerExtra={<WalletsTotal state={cryptoWallets} />}
        extraCards={cryptoWallets.entries.map((e) => (
          <WalletCard key={`wallet-${e.wallet.id}`} entry={e} state={cryptoWallets} />
        ))}
        before={
          <CryptoList
            holdings={grouped.crypto}
            onRefresh={refresh}
            onDelete={deleteHolding}
            onSetCost={setHoldingCost}
            onUpdateQuantity={updateHoldingQuantity}
          />
        }
      >
        <WalletNotices state={cryptoWallets} />
        <p className="small">
          <Link to="/crypto" onMouseEnter={() => prefetchNavTarget('/crypto')}>
            Crypto gains, staking income and DeFi ›
          </Link>{' '}
          <span className="muted">Pro</span>
        </p>
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

{tab === 'mining' && assetEnabled('gomining') ? (
      <GoMiningMinersSection
        items={grouped.miners}
        classTotal={classTotal('gomining')}
        empty="No miners yet. Add one below."
        onRefresh={refresh}
        received={miningReceived}
        onSetCost={setHoldingCost}
        marketplaceReport={marketplaceReport}
        onUpdateMiner={updateMinerSpecs}
        settings={gmSettings}
        onSettingsChange={setGmSettings}
        onSaveDiscount={saveGmSettings}
        savingDiscount={savingGm}
      >
        <InlineAddDetails label="Add miner" id={ADD_DETAILS_ID.miner}>
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

{tab === 'metals' && assetEnabled('metal') ? (
      <MetalsTab
        holdings={grouped.metals}
        sourceInfo={metalsInfo}
        total={classTotal('metals')}
        onRefresh={refresh}
        onDelete={deleteHolding}
        onSetCost={setHoldingCost}
      >
        <InlineAddDetails label="Add metal" id={ADD_DETAILS_ID.metal}>
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
      </MetalsTab>
      ) : null}

{tab === 'forex' && assetEnabled('forex') ? (
      <section className="panel">
        <ClassHeading
          title="Forex"
          total={classTotal('forex')}
          info={
            <InfoTip label="About forex values">
              Foreign cash held outside your bank (e.g. Revolut), valued in NZD at Frankfurter rates. Use Refresh all prices
              for new rates.
            </InfoTip>
          }
        />
        {grouped.forex.length === 0 ? (
          <p className="muted">No forex holdings yet.</p>
        ) : (
          <div className="holding-cards">
            {grouped.forex.map((h) => (
              <HoldingCard
                key={h.id}
                holding={h}
                onRefresh={refresh}
                onDelete={deleteHolding}
                onUpdateQuantity={updateHoldingQuantity}
                onSetCost={setHoldingCost}
              />
            ))}
          </div>
        )}
        <InlineAddDetails label="Add forex" id={ADD_DETAILS_ID.forex}>
          <form className="form-grid" onSubmit={onAddForex}>
            <h4>Add forex (outside bank)</h4>
            <label>
              Currency
              <select
                value={forexForm.currency}
                onChange={(e) => setForexForm({ ...forexForm, currency: e.target.value })}
                required
              >
                {FOREX_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
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

{tab === 'property' && assetEnabled('real_estate') ? (
      <section className="panel">
        <ClassHeading
          title="Property"
          total={classTotal('realEstate')}
          info={
            <InfoTip label="About property values">
              Manual valuation only: the market value and mortgage you enter. The total is equity (value minus mortgage).
              Nothing is estimated.
            </InfoTip>
          }
        />
        {grouped.realEstate.length === 0 ? (
          <p className="muted">No property holdings yet.</p>
        ) : (
          <PropertyList
            holdings={grouped.realEstate}
            onSaveValue={savePropertyValue}
            onSaveDetails={savePropertyDetails}
            onSetCost={setHoldingCost}
            onDelete={deleteHolding}
          />
        )}
        <InlineAddDetails label="Add property">
          <form className="form-grid" onSubmit={onAddRealEstate}>
            <h4>Add property</h4>
            <label>
              Address or name
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

{tab === 'collectables' && assetEnabled('collectable') ? (
      <CollectablesPanel
        holdings={grouped.collectables}
        total={classTotal('collectables')}
        onChanged={reloadAfterEdit}
        onBanner={setMsg}
        initialAdd={cardPrefill}
        onInitialAddHandled={() => setCardPrefill(null)}
        revealHoldingId={reveal?.kind === 'holding' ? reveal.holdingId : null}
        renderCard={(h) => (
          <HoldingCard
            key={h.id}
            holding={h as Holding}
            onRefresh={refresh}
            onDelete={deleteHolding}
            onSetCost={setHoldingCost}
          />
        )}
      />
      ) : null}

{tab === 'art' && assetEnabled('art') ? (
      <Section
        title="Art"
        total={classTotal('art')}
        info={
          <InfoTip label="About art values">
            Manual valuation only: your appraisal, or your share of the latest valuation you enter. There is no Masterworks
            API, so nothing is fetched or estimated.
          </InfoTip>
        }
        items={grouped.art}
        empty="No art holdings yet."
        onDelete={deleteHolding}
        onUpdateArt={updateArtHolding}
        onSetCost={setHoldingCost}
      >
        <InlineAddDetails label="Add art">
          <form className="form-grid" onSubmit={onAddArt}>
            <h4>Add art</h4>
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

{tab === 'stones' && assetEnabled('stone') ? (
      <Section
        title="Precious stones"
        total={classTotal('stones')}
        info={
          <InfoTip label="About precious stone values">
            Diamonds: live OpenFacet (openfacet.net) quote in USD, converted to NZD at Frankfurter rates, or your own value if the quote fails. Other gems: the value
            you enter; there is no live gem price. Nothing is estimated.
          </InfoTip>
        }
        items={grouped.stones}
        empty="No precious stone holdings yet."
        onRefresh={refresh}
        onDelete={deleteHolding}
        onSetCost={setHoldingCost}
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
            <button type="submit" className="btn primary">
              Add stone
            </button>
          </form>
        </InlineAddDetails>
      </Section>
      ) : null}


      </div>
    </div>
  );
}
