import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, coerceBalance, formatAuckland, formatNzd } from '../api/client';
import { maybeAutoSyncBankTransactions, maybeAutoSyncPortfolio } from '../lib/akahuTxnAutoSync';
import {
  beginPageRead,
  commitPageRead,
  invalidateAfterExternalSync,
  portfolioSyncChanged,
  readPageCache,
  txnSyncChanged,
} from '../lib/pageDataCache';
import { usePageCacheValue } from '../lib/usePageCache';
import { isMoneyHidden, MONEY_MASK, useMoneyHidden } from '../lib/privacy';
import { incomeTooLowForRatios } from '../lib/incomeThreshold';
import { showQuietToast } from '../lib/quietToast';
import { PieChart, type AssetBreakdownRow } from '../components/AssetBreakdownChart';
import { InfoTip } from '../components/InfoTip';
import { maskAccountNumbers } from '../lib/accountMask';
import { DebtBalances, type DebtBreakdownPerson } from '../components/DebtBalances';
import { NetWorthHero } from '../components/NetWorthHero';
import { AssetDrillDown, type DrillHolding } from '../components/AssetDrillDown';
import type { SnapshotLike } from '../lib/netWorthHistory';
import { SavingsGoalsCard } from '../components/SavingsGoalsCard';
import { HealthScoreCard } from '../components/HealthScoreCard';
import { useAssetClassPrefs } from '../auth/AssetClassPrefsContext';
import type { AssetClassPrefKey } from '../lib/assetClassPrefs';
import {
  metalProviderFooter,
  metalSpotHint,
  type MetalSpotSource,
  type MetalSpotStatus,
} from '../lib/metalSpotCopy';
import type { HomeMonthSnapshot, SpendingBreakdown } from '../types';

type Summary = {
  cashNzd: number;
  cashLiabilitiesNzd?: number;
  stocksNzd: number | null;
  cryptoNzd: number | null;
  cryptoHoldingsNzd?: number;
  cryptoWalletsNzd?: number | null;
  cryptoWalletsFailed?: number;
  cryptoPctOfNetWorth?: number | null;
  gominingMinersNzd: number | null;
  artNzd: number | null;
  metalsNzd: number | null;
  metalsUseSpot?: boolean;
  metalsConfigured?: boolean;
  metalsSpotStatus?: MetalSpotStatus;
  metalsSpotSource?: MetalSpotSource | null;
  stonesNzd: number | null;
  /** True when the shares total uses market quotes (cost only when this is false). */
  stocksUseMarket?: boolean;
  forexNzd: number | null;
  forexUseSpot?: boolean;
  realEstateNzd: number | null;
  realEstateMortgageNzd?: number | null;
  realEstateEquityNzd?: number | null;
  collectablesNzd: number | null;
  kiwiSaverNzd: number | null;
  debtOutstandingNzd?: number;
  debtPersonCount?: number;
  assetsKnownNzd?: number;
  totalKnownNzd: number;
  hasUnavailableQuotes: boolean;
  asOf: string;
  quoteNote?: string;
  counts?: Record<string, number>;
  /** Lines behind each class total (holdings, wallets, KiwiSaver accounts). */
  holdings?: Array<DrillHolding & { assetClass: string }>;
};

type BankAccountRow = {
  id: string;
  name: string;
  institution: string;
  accountType: string;
  currency: string;
  balance: number | unknown;
  notes?: string | null;
  updatedAt?: string;
};

function balanceNumber(raw: unknown): number {
  return coerceBalance(raw) ?? 0;
}


/** savingsRate is a fraction of income. 0.6 is 60%, -1.5 is -150%. Null stays an em dash. */
function formatSavingsRate(rate: number | null, incomeNzd: number): string {
  if (isMoneyHidden()) return MONEY_MASK;
  if (rate == null || !Number.isFinite(rate) || incomeTooLowForRatios(incomeNzd)) return '—';
  return new Intl.NumberFormat('en-NZ', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(rate);
}

function monthErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return 'Could not load this month.';
}

type DashboardMain = {
  summary: Summary;
  accounts: BankAccountRow[];
  debtPeople: DebtBreakdownPerson[];
};

const DASHBOARD_MAIN = 'dashboard:main';
const DASHBOARD_MONTH = 'dashboard:month';
const DASHBOARD_HISTORY = 'dashboard:history';
const DRILL_ID = 'asset-drill';

/** Tile → holdings.assetClass from /net-worth. Cash shows its accounts instead. */
const DRILL_CLASS: Partial<Record<AssetClassPrefKey, string>> = {
  stock: 'stock',
  crypto: 'crypto',
  gomining: 'gomining_miner',
  art: 'art',
  metal: 'metal',
  stone: 'stone',
  forex: 'forex',
  real_estate: 'real_estate',
  collectable: 'collectable',
  kiwisaver: 'kiwisaver',
};

/** Drop env key names from copy shown on the dashboard. */
function dashboardQuoteNote(note: string | undefined): string | undefined {
  if (!note) return note;
  if (/api[_-]?key|\b[A-Za-z0-9]+_KEY\b/i.test(note)) {
    return 'Live marks use cost or recorded values. Metals are not connected.';
  }
  return note;
}

export function Dashboard() {
  const { enabled: assetEnabled } = useAssetClassPrefs();
  const initialMain = readPageCache<DashboardMain>(DASHBOARD_MAIN);
  const initialMonth = readPageCache<HomeMonthSnapshot>(DASHBOARD_MONTH);
  const cachedMain = usePageCacheValue<DashboardMain>(DASHBOARD_MAIN);
  const cachedMonth = usePageCacheValue<HomeMonthSnapshot>(DASHBOARD_MONTH);
  const [summaryState, setSummary] = useState<Summary | null>(initialMain?.summary ?? null);
  const [accountsState, setAccounts] = useState<BankAccountRow[]>(initialMain?.accounts ?? []);
  const [debtPeopleState, setDebtPeople] = useState<DebtBreakdownPerson[]>(initialMain?.debtPeople ?? []);
  const [error, setError] = useState<string | null>(null);
  const [monthState, setMonthSnapshot] = useState<HomeMonthSnapshot | null>(initialMonth ?? null);
  const [monthError, setMonthError] = useState<string | null>(null);
  const cachedHistory = usePageCacheValue<SnapshotLike[]>(DASHBOARD_HISTORY);
  const [historyState, setHistory] = useState<SnapshotLike[] | null>(
    () => readPageCache<SnapshotLike[]>(DASHBOARD_HISTORY) ?? null,
  );
  const history = historyState ?? cachedHistory ?? null;
  const [openTile, setOpenTile] = useState<AssetClassPrefKey | null>(null);
  const closeDrill = useCallback(() => setOpenTile(null), []);
  const toggleTile = useCallback(
    (key: AssetClassPrefKey) => setOpenTile((cur) => (cur === key ? null : key)),
    [],
  );
  // State wins once this visit has applied a read. Until then, a read that
  // finished after unmount (or after a newer read started) still paints.
  const summary = summaryState ?? cachedMain?.summary ?? null;
  const accounts = summaryState ? accountsState : (cachedMain?.accounts ?? accountsState);
  const debtPeople = summaryState ? debtPeopleState : (cachedMain?.debtPeople ?? debtPeopleState);
  const monthSnapshot = monthState ?? cachedMonth ?? null;
  const summaryRef = useRef(summary);
  const monthRef = useRef(monthSnapshot);
  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);
  useEffect(() => {
    monthRef.current = monthSnapshot;
  }, [monthSnapshot]);

  // Read after /net-worth, which saves today's snapshot, so the sparkline ends today.
  const loadHistory = useCallback(() => {
    const stamp = beginPageRead(DASHBOARD_HISTORY);
    return api.snapshots
      .list()
      .then((rows) => {
        if (!commitPageRead(stamp, rows)) return;
        setHistory(rows);
      })
      .catch(() => {
        // The hero still shows today's figure; the trend just stays hidden.
      });
  }, []);

  const load = useCallback(() => {
    const stamp = beginPageRead(DASHBOARD_MAIN);
    return Promise.all([api.netWorth(), api.accounts.list(), api.debts.people()])
      .then(([net, accts, people]) => {
        const bundle: DashboardMain = {
          summary: net as Summary,
          accounts: accts as BankAccountRow[],
          debtPeople: people,
        };
        if (!commitPageRead(stamp, bundle)) return;
        setSummary(bundle.summary);
        setAccounts(bundle.accounts);
        setDebtPeople(bundle.debtPeople);
        setError(null);
        void loadHistory();
      })
      .catch((e: Error) => {
        if (summaryRef.current) {
          showQuietToast('Could not refresh dashboard — showing last data.', { kind: 'warn' });
          return;
        }
        setError(e.message);
      });
  }, [loadHistory]);

  const loadMonth = useCallback(() => {
    const stamp = beginPageRead(DASHBOARD_MONTH);
    return api.home
      .snapshot()
      .then((snap) => {
        if (!commitPageRead(stamp, snap)) return;
        setMonthSnapshot(snap);
        setMonthError(null);
      })
      .catch((e: unknown) => {
        if (monthRef.current) {
          showQuietToast('Could not refresh this month — showing last data.', { kind: 'warn' });
          return;
        }
        setMonthError(monthErrorMessage(e));
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    void loadMonth();
  }, [loadMonth]);

  // Debounced Akahu auto-sync on dashboard open (bank txns + Sharesies/stocks).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [txn, port] = await Promise.all([
          maybeAutoSyncBankTransactions(),
          maybeAutoSyncPortfolio(),
        ]);
        if (cancelled) return;
        const txnInserted = txn.ran && txn.result.ok && (txn.result.inserted ?? 0) > 0;
        const portOk = port.ran && port.result.ok;
        const changed =
          (txn.ran && txn.result.ok && txnSyncChanged(txn.result)) ||
          (port.ran && port.result.ok && portfolioSyncChanged(port.result));
        if (changed) invalidateAfterExternalSync();
        if (txnInserted || portOk) await Promise.all([load(), loadMonth()]);
      } catch {
        showQuietToast('Bank/portfolio sync paused — showing last data.', { kind: 'warn' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, loadMonth]);


  const monthRow = <MonthSnapshot snapshot={monthSnapshot} error={monthError} />;
  const accountUpdatedAt = Object.fromEntries(accounts.map((a) => [a.id, a.updatedAt]));
  const goalsCard = <SavingsGoalsCard accountUpdatedAt={accountUpdatedAt} />;
  const healthCard = <HealthScoreCard />;

  if (error) {
    return (
      <div className="stack dashboard-page">
        <div className="panel warn">
          <h2 className="page-title">Dashboard</h2>
          <p>The figures could not be loaded. Try again.</p>
        </div>
        {monthRow}
        {goalsCard}
        {healthCard}
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="stack dashboard-page">
        <div className="panel">Loading net worth…</div>
        {monthRow}
        {goalsCard}
        {healthCard}
      </div>
    );
  }

  // NZD rows feed cashNzd; non-NZD shown separately (no FX invented)
  const nzdAccounts = accounts
    .filter((a) => (a.currency ?? '').toUpperCase() === 'NZD')
    .sort((a, b) => balanceNumber(b.balance) - balanceNumber(a.balance));
  const otherAccounts = accounts.filter(
    (a) => (a.currency ?? '').toUpperCase() !== 'NZD',
  );
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

  const assetBreakdown: AssetBreakdownRow[] = [
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
    }));

  const asOfText = formatAuckland(summary.asOf);
  const cashUpdated = latestIso(nzdAccounts.map((a) => a.updatedAt)) ?? summary.asOf;
  const quoteNote = dashboardQuoteNote(summary.quoteNote);
  const metalHint = metalSpotHint({
    status: summary.metalsSpotStatus ?? (summary.metalsUseSpot ? 'ok' : 'unavailable'),
    source:
      summary.metalsSpotSource ??
      (summary.metalsConfigured ? 'metals_dev' : summary.metalsUseSpot ? 'gold-api' : null),
    configured: summary.metalsConfigured,
  });

  /** Null when the loaded figures predate the holdings list (cached from an older server). */
  const drillHoldings = (key: AssetClassPrefKey): DrillHolding[] | null => {
    if (!summary.holdings) return null;
    const cls = DRILL_CLASS[key];
    return summary.holdings.filter((h) => h.assetClass === cls);
  };
  const tile = (key: AssetClassPrefKey) => ({ open: openTile === key, onToggle: () => toggleTile(key) });
  const drillTitles: Record<AssetClassPrefKey, string> = {
    cash: 'Cash accounts',
    stock: 'Shares',
    crypto: 'Crypto',
    gomining: 'GoMining miners',
    art: 'Art',
    metal: 'Metals',
    stone: 'Stones',
    forex: 'Forex',
    real_estate: 'Real estate',
    collectable: 'Collectables',
    kiwisaver: 'KiwiSaver',
  };

  return (
    <div className="stack dashboard-page">
      <NetWorthHero
        totalNzd={summary.totalKnownNzd}
        kiwiSaverNzd={summary.kiwiSaverNzd}
        assetsNzd={summary.assetsKnownNzd ?? null}
        debtNzd={summary.debtOutstandingNzd ?? 0}
        snapshots={history}
        info={
          <>
            Total is assets minus debt outstanding. Accessible also leaves out KiwiSaver, which you generally
            can&apos;t withdraw until 65. The trend uses one snapshot a day, saved when you open the dashboard.{' '}
            {quoteNote ? `${quoteNote} ` : ''}
            {metalProviderFooter(summary.metalsSpotSource ?? null)}. Sync failures stay quiet and the last
            data is shown. Updated {asOfText} NZT.
          </>
        }
      />

      <section className="grid cards dashboard-cards" aria-label="Assets by class">
        {assetEnabled('cash') ? (
          <Bucket {...tile('cash')} title="Cash" value={summary.cashNzd} updated={cashUpdated}>
            Bank balances synced from Akahu, plus accounts you added by hand. NZD only; credit cards and loans are left
            out
            {(summary.cashLiabilitiesNzd ?? 0) !== 0
              ? ` (${formatNzd(summary.cashLiabilitiesNzd ?? 0)} excluded)`
              : ''}
            .
          </Bucket>
        ) : null}
        {assetEnabled('stock') ? (
          <Bucket
            {...tile('stock')}
            title={summary.stocksUseMarket ? 'Shares, market value' : 'Shares, at cost'}
            value={summary.stocksNzd}
            updated={summary.asOf}
          >
            Sharesies via Akahu, plus holdings you added by hand.{' '}
            {summary.stocksUseMarket ? 'Valued at market quotes.' : 'No market quotes, so shown at cost.'}
          </Bucket>
        ) : null}
        {assetEnabled('crypto') ? (
          <Bucket {...tile('crypto')} title="Crypto" value={summary.cryptoNzd} updated={summary.asOf}>
            Read-only wallets plus holdings you added by hand, valued at market quotes where available.
            {cryptoHint(summary) ? ` ${cryptoHint(summary)}.` : ''}
          </Bucket>
        ) : null}
        {assetEnabled('gomining') ? (
          <Bucket {...tile('gomining')} title="GoMining miners" value={summary.gominingMinersNzd} updated={summary.asOf}>
            GoMining miners you have recorded.
          </Bucket>
        ) : null}
        {assetEnabled('art') ? (
          <Bucket {...tile('art')} title="Art" value={summary.artNzd} updated={summary.asOf}>
            Values you have recorded.
          </Bucket>
        ) : null}
        {assetEnabled('metal') ? (
          <Bucket {...tile('metal')} title="Metals" value={summary.metalsNzd} updated={summary.asOf}>
            {metalHint.replace(/\.$/, '')}. Weights are the holdings you recorded.
          </Bucket>
        ) : null}
        {assetEnabled('stone') ? (
          <Bucket {...tile('stone')} title="Stones, recorded value only" value={summary.stonesNzd} updated={summary.asOf}>
            Values you have recorded. No market quote is applied.
          </Bucket>
        ) : null}
        {assetEnabled('forex') ? (
          <Bucket {...tile('forex')} title="Forex" value={summary.forexNzd} updated={summary.asOf}>
            {summary.forexUseSpot
              ? 'Foreign cash held outside your bank, converted with Frankfurter rates to NZD.'
              : 'Foreign cash held outside your bank (Revolut etc.). Refresh FX on Portfolio to convert it.'}
          </Bucket>
        ) : null}
        {assetEnabled('real_estate') ? (
          <Bucket
            {...tile('real_estate')}
            title="Real estate (equity)"
            value={summary.realEstateEquityNzd ?? summary.realEstateNzd}
            updated={summary.asOf}
          >
            {summary.realEstateNzd != null
              ? `Market value you recorded (${formatNzd(summary.realEstateNzd)}) minus mortgage (${formatNzd(summary.realEstateMortgageNzd ?? 0)}).`
              : 'Market value you record, minus the mortgage.'}
          </Bucket>
        ) : null}
        {assetEnabled('collectable') ? (
          <Bucket {...tile('collectable')} title="Collectables" value={summary.collectablesNzd} updated={summary.asOf}>
            Magic: The Gathering prices from Scryfall and Pokémon prices from the Pokémon TCG API, converted to NZD.
            Prices are never estimated.
          </Bucket>
        ) : null}
        {assetEnabled('kiwisaver') ? (
          <Bucket {...tile('kiwisaver')} title="KiwiSaver" value={summary.kiwiSaverNzd} updated={summary.asOf}>
            Sharesies KiwiSaver via Akahu, plus bank-held KiwiSaver you recorded.
          </Bucket>
        ) : null}
      </section>

      {openTile && assetEnabled(openTile) ? (
        openTile === 'cash' ? (
          <AssetDrillDown id={DRILL_ID} title={drillTitles.cash} onClose={closeDrill}>
            <CashAccounts
              nzdAccounts={nzdAccounts}
              otherAccounts={otherAccounts}
              cashNzd={summary.cashNzd}
              cashLiabilitiesNzd={summary.cashLiabilitiesNzd ?? 0}
            />
          </AssetDrillDown>
        ) : (
          <AssetDrillDown
            id={DRILL_ID}
            title={drillTitles[openTile]}
            holdings={drillHoldings(openTile)}
            note={
              openTile === 'real_estate'
                ? 'Each property shows equity: the value you recorded minus its mortgage.'
                : openTile === 'crypto' && (summary.cryptoWalletsFailed ?? 0) > 0
                  ? 'Wallets that could not be valued are not listed.'
                  : undefined
            }
            onClose={closeDrill}
          />
        )
      ) : null}

      <AllocationExpander rows={assetBreakdown} />

      {monthRow}
      {goalsCard}
      <DebtBalances people={debtPeople} asOf={asOfText} />
      {healthCard}
    </div>
  );
}

function latestIso(values: Array<string | undefined>): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const v of values) {
    const ms = v ? Date.parse(v) : NaN;
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = v!;
    }
  }
  return best;
}

/** The asset donut, collapsed by default. Tiles carry the amounts; the legend shows shares only. */
function AllocationExpander({ rows }: { rows: AssetBreakdownRow[] }) {
  const [open, setOpen] = useState(false);
  const moneyHidden = useMoneyHidden();
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0);
  return (
    <section className="allocation" aria-label="Allocation">
      <button
        type="button"
        className="btn ghost allocation-toggle"
        aria-expanded={open}
        aria-controls="allocation-detail"
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> Allocation
      </button>
      {open ? (
        <div id="allocation-detail" className="panel allocation-detail">
          {moneyHidden ? (
            <p className="muted small">Allocation hidden while amounts are hidden.</p>
          ) : total > 0 ? (
            <>
              <div className="allocation-pie">
                <PieChart rows={rows} total={total} centerLabel="Assets" chartLabel="assets by class" />
              </div>
              <ul className="allocation-legend" aria-label="Share of assets by class">
                {rows
                  .filter((row) => row.value > 0)
                  .sort((a, b) => b.value - a.value)
                  .map((row) => (
                    <li key={row.key}>
                      <span className="spend-swatch" style={{ background: row.colour }} aria-hidden />
                      <span className="asset-legend-name">{row.name}</span>
                      <strong>{((row.value / total) * 100).toFixed(0)}%</strong>
                    </li>
                  ))}
              </ul>
            </>
          ) : (
            <p className="muted small">No asset values yet.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function CashAccounts({
  nzdAccounts,
  otherAccounts,
  cashNzd,
  cashLiabilitiesNzd,
}: {
  nzdAccounts: BankAccountRow[];
  otherAccounts: BankAccountRow[];
  cashNzd: number;
  cashLiabilitiesNzd: number;
}) {
  const [showEmpty, setShowEmpty] = useState(false);
  const isEmpty = (a: BankAccountRow) => balanceNumber(a.balance) === 0;
  const emptyCount = nzdAccounts.filter(isEmpty).length + otherAccounts.filter(isEmpty).length;
  const nzdShown = showEmpty ? nzdAccounts : nzdAccounts.filter((a) => !isEmpty(a));
  const otherShown = showEmpty ? otherAccounts : otherAccounts.filter((a) => !isEmpty(a));

  return (
    <div className="cash-accounts">
      {nzdAccounts.length === 0 ? (
        <p className="muted">No NZD bank balances yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Institution</th>
                <th>Type</th>
                <th style={{ textAlign: 'right' }}>Balance (NZD)</th>
              </tr>
            </thead>
            <tbody id="cash-accounts-rows">
              {nzdShown.map((a) => (
                <tr key={a.id}>
                  <td>{maskAccountNumbers(a.name)}</td>
                  <td>{a.institution || '—'}</td>
                  <td>{a.accountType || '—'}</td>
                  <td className="money" style={{ textAlign: 'right' }}>{formatNzd(balanceNumber(a.balance))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}><strong>Cash total (NZD liquid)</strong></td>
                <td className="money" style={{ textAlign: 'right' }}>
                  <strong>{formatNzd(cashNzd)}</strong>
                </td>
              </tr>
              {cashLiabilitiesNzd !== 0 && (
                <tr>
                  <td colSpan={3} className="muted">Credit / loan (excluded from Cash)</td>
                  <td style={{ textAlign: 'right' }} className="muted">
                    {formatNzd(cashLiabilitiesNzd)}
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}
      {otherShown.length > 0 && (
        <>
          <h3 className="section-subtitle">
            Non-NZD accounts
            <InfoTip label="About non-NZD accounts">
              Stored in their own currency and left out of the cash total. No FX is applied.
            </InfoTip>
          </h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Institution</th>
                  <th>Currency</th>
                  <th style={{ textAlign: 'right' }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {otherShown.map((a) => {
                  const bal = balanceNumber(a.balance);
                  return (
                    <tr key={a.id}>
                      <td>{maskAccountNumbers(a.name)}</td>
                      <td>{a.institution || '—'}</td>
                      <td>{a.currency}</td>
                      <td style={{ textAlign: 'right' }}>
                        {isMoneyHidden()
                          ? MONEY_MASK
                          : `${bal.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${a.currency}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {emptyCount > 0 ? (
        <button
          type="button"
          className="btn small ghost cash-empty-toggle"
          aria-expanded={showEmpty}
          aria-controls="cash-accounts-rows"
          onClick={() => setShowEmpty((v) => !v)}
        >
          {showEmpty
            ? `Hide ${emptyCount} empty account${emptyCount === 1 ? '' : 's'}`
            : `+${emptyCount} empty account${emptyCount === 1 ? '' : 's'}`}
        </button>
      ) : null}
    </div>
  );
}

function MonthSnapshot({
  snapshot,
  error,
}: {
  snapshot: HomeMonthSnapshot | null;
  error: string | null;
}) {
  const [spendOpen, setSpendOpen] = useState(false);
  const breakdown = snapshot?.spendingBreakdown ?? null;
  const canExpand = Boolean(breakdown && breakdown.rows.length > 0);
  return (
    <section className="card month-snapshot" aria-labelledby="this-month-heading">
      <h2 id="this-month-heading" className="month-snapshot-period">This month</h2>
      {error ? (
        <p className="month-snapshot-error" role="alert">{error}</p>
      ) : snapshot ? (
        <dl className="month-snapshot-row">
          <div className="month-snapshot-figure">
            <dt>Income</dt>
            <dd>{formatNzd(snapshot.incomeNzd)}</dd>
            {snapshot.expectedPay ? (
              <dd className="month-snapshot-expected">
                Expected {formatNzd(snapshot.expectedPay.monthlyNetNzd)} from saved pay
              </dd>
            ) : null}
          </div>
          <div className="month-snapshot-figure">
            <dt>Spending</dt>
            <dd>{formatNzd(snapshot.spendingNzd)}</dd>
            {canExpand ? (
              <dd className="month-snapshot-expected">
                <button
                  type="button"
                  className="month-spending-toggle"
                  aria-expanded={spendOpen}
                  aria-controls={spendOpen ? 'month-spending-detail' : undefined}
                  onClick={() => setSpendOpen((o) => !o)}
                >
                  {breakdown!.by === 'category' ? 'By category' : 'Top merchants'}{' '}
                  <span aria-hidden="true">{spendOpen ? '▴' : '▾'}</span>
                </button>
              </dd>
            ) : null}
          </div>
          <div className="month-snapshot-figure">
            {incomeTooLowForRatios(snapshot.incomeNzd) && snapshot.savingsNzd < 0 ? (
              <>
                <dt>Savings</dt>
                <dd className="month-snapshot-plain">
                  Spent {formatNzd(-snapshot.savingsNzd)} more than came in
                </dd>
              </>
            ) : (
              <>
                <dt>Savings</dt>
                <dd>{formatNzd(snapshot.savingsNzd)}</dd>
              </>
            )}
          </div>
          <div className="month-snapshot-figure">
            <dt>Savings rate</dt>
            <dd>{formatSavingsRate(snapshot.savingsRate, snapshot.incomeNzd)}</dd>
          </div>
        </dl>
      ) : (
        <p className="month-snapshot-status">Loading this month…</p>
      )}
      {snapshot && spendOpen && breakdown ? <SpendingDetail breakdown={breakdown} /> : null}
    </section>
  );
}

function SpendingDetail({ breakdown }: { breakdown: SpendingBreakdown }) {
  const moneyHidden = useMoneyHidden();
  const max = Math.max(...breakdown.rows.map((row) => row.amountNzd), 0);
  const title = breakdown.by === 'category' ? 'Spending by category' : 'Top 5 merchants';
  return (
    <div id="month-spending-detail" className="month-spending-detail">
      <h3 className="month-spending-title">
        {title}
        {breakdown.by === 'merchant' ? (
          <InfoTip label="About top merchants">
            None of this month&apos;s spending is categorised yet, so the biggest merchants are shown instead. Categorise
            transactions on Budget to see categories here.
          </InfoTip>
        ) : null}
      </h3>
      <ul className="month-spending-list">
        {breakdown.rows.map((row) => (
          <li key={row.label}>
            <div className="month-spending-row">
              <span className="month-spending-label">{row.label}</span>
              <span className="money">{formatNzd(row.amountNzd)}</span>
            </div>
            {moneyHidden ? null : (
              <div className="month-spending-bar" aria-hidden="true">
                <span style={{ width: `${max > 0 ? (row.amountNzd / max) * 100 : 0}%` }} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "12.5% of net worth · 2 wallets + manual · 1 wallet not valued" (KAN-42). */
function cryptoHint(s: Summary): string | undefined {
  const parts: string[] = [];
  if (s.cryptoPctOfNetWorth != null) parts.push(`${s.cryptoPctOfNetWorth}% of net worth`);
  else if ((s.cryptoNzd ?? 0) > 0 && s.totalKnownNzd <= 0) parts.push('% of net worth not shown while net worth is zero or below');
  const wallets = s.counts?.wallets ?? 0;
  if (wallets > 0) {
    const manual = (s.cryptoHoldingsNzd ?? 0) > 0 ? ' + manual' : '';
    parts.push(`${wallets} wallet${wallets === 1 ? '' : 's'}${manual}`);
  }
  const failed = s.cryptoWalletsFailed ?? 0;
  if (failed > 0) parts.push(`${failed} wallet${failed === 1 ? '' : 's'} not valued`);
  return parts.length ? parts.join(' · ') : undefined;
}

function Bucket({
  title,
  value,
  updated,
  open,
  onToggle,
  children,
}: {
  title: string;
  value: number | null;
  updated: string;
  open: boolean;
  onToggle: () => void;
  /** Data source note, shown behind the ⓘ. */
  children: ReactNode;
}) {
  return (
    <div className={'card dashboard-tile' + (open ? ' dashboard-tile--open' : '')}>
      <button
        type="button"
        className="dashboard-tile-hit"
        aria-expanded={open}
        aria-controls={open ? DRILL_ID : undefined}
        onClick={onToggle}
      >
        <span className="dashboard-tile-title">{title}</span>
        <span className="card-value">{formatNzd(value)}</span>
        <span className="dashboard-tile-cue">
          {open ? 'Hide details' : 'Details'} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
        </span>
      </button>
      <InfoTip label={`About ${title}`}>
        {children} Updated {formatAuckland(updated)} NZT.
      </InfoTip>
    </div>
  );
}
