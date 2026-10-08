
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
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
import { isMoneyHidden, MONEY_MASK } from '../lib/privacy';
import { showQuietToast } from '../lib/quietToast';
import { AssetBreakdownChart, type AssetBreakdownRow } from '../components/AssetBreakdownChart';
import { DebtBreakdownChart, type DebtBreakdownPerson } from '../components/DebtBreakdownChart';
import { SavingsGoalsCard } from '../components/SavingsGoalsCard';
import { useAssetClassPrefs } from '../auth/AssetClassPrefsContext';
import type { AssetClassPrefKey } from '../lib/assetClassPrefs';
import { metalSpotHint, type MetalSpotSource, type MetalSpotStatus } from '../lib/metalSpotCopy';
import type { HomeMonthSnapshot } from '../types';

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
function formatSavingsRate(rate: number | null): string {
  if (isMoneyHidden()) return MONEY_MASK;
  if (rate == null || !Number.isFinite(rate)) return '—';
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
  const [summary, setSummary] = useState<Summary | null>(initialMain?.summary ?? null);
  const [accounts, setAccounts] = useState<BankAccountRow[]>(initialMain?.accounts ?? []);
  const [debtPeople, setDebtPeople] = useState<DebtBreakdownPerson[]>(initialMain?.debtPeople ?? []);
  const [error, setError] = useState<string | null>(null);
  const [monthSnapshot, setMonthSnapshot] = useState<HomeMonthSnapshot | null>(initialMonth ?? null);
  const [monthError, setMonthError] = useState<string | null>(null);
  const summaryRef = useRef(summary);
  summaryRef.current = summary;
  const monthRef = useRef(monthSnapshot);
  monthRef.current = monthSnapshot;

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
      })
      .catch((e: Error) => {
        if (summaryRef.current) {
          showQuietToast('Could not refresh dashboard — showing last data.', { kind: 'warn' });
          return;
        }
        setError(e.message);
      });
  }, []);

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
  const goalsCard = <SavingsGoalsCard />;

  if (error) {
    return (
      <div className="stack dashboard-page">
        {monthRow}
        {goalsCard}
        <div className="panel warn">
          <h2 className="page-title">Dashboard</h2>
          <p>The figures could not be loaded. Try again.</p>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="stack dashboard-page">
        {monthRow}
        {goalsCard}
        <div className="panel">Loading net worth…</div>
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

  return (
    <div className="stack dashboard-page">
      {monthRow}
      {goalsCard}
      <section className="hero-card">
        <p className="eyebrow page-title">Net worth · assets − debt outstanding</p>
        <p className="hero-value">{formatNzd(summary.totalKnownNzd)}</p>
        <p className="muted small">
          As of {formatAuckland(summary.asOf)} NZT
          {summary.assetsKnownNzd != null
            ? ` · Assets ${formatNzd(summary.assetsKnownNzd)}`
            : ''}
          {(summary.debtOutstandingNzd ?? 0) > 0
            ? ` − Debt ${formatNzd(summary.debtOutstandingNzd)}`
            : ''}
          {' · '}
          {dashboardQuoteNote(summary.quoteNote)}
        </p>
      </section>

      <section className="grid cards dashboard-cards">
        {assetEnabled('cash') ? (
          <Bucket title="Cash" value={summary.cashNzd} hint="NZD liquid (cheque/savings/wallet/term)" />
        ) : null}
        {assetEnabled('stock') ? (
          <Bucket
            title={summary.stocksUseMarket ? 'Shares, market value' : 'Shares, at cost'}
            value={summary.stocksNzd}
          />
        ) : null}
        {assetEnabled('crypto') ? (
          <Bucket title="Crypto" value={summary.cryptoNzd} hint={cryptoHint(summary)} />
        ) : null}
        {assetEnabled('gomining') ? (
          <Bucket title="GoMining miners" value={summary.gominingMinersNzd} />
        ) : null}
        {assetEnabled('art') ? <Bucket title="Art" value={summary.artNzd} /> : null}
        {assetEnabled('metal') ? (
          <Bucket
            title="Metals"
            value={summary.metalsNzd}
            hint={metalSpotHint({
              status:
                summary.metalsSpotStatus ??
                (summary.metalsUseSpot ? 'ok' : 'unavailable'),
              source:
                summary.metalsSpotSource ??
                (summary.metalsConfigured ? 'metals_dev' : summary.metalsUseSpot ? 'gold-api' : null),
              configured: summary.metalsConfigured,
            })}
          />
        ) : null}
        {assetEnabled('stone') ? (
          <Bucket title="Stones, recorded value only" value={summary.stonesNzd} />
        ) : null}
        {assetEnabled('forex') ? (
          <Bucket
            title="Forex"
            value={summary.forexNzd}
            hint={
              summary.forexUseSpot
                ? 'Frankfurter → NZD'
                : 'Outside bank (Revolut etc.) — refresh FX on Portfolio'
            }
          />
        ) : null}
        {assetEnabled('real_estate') ? (
          <Bucket
            title="Real estate (equity)"
            value={summary.realEstateEquityNzd ?? summary.realEstateNzd}
            hint={
              summary.realEstateNzd != null
                ? `Value ${formatNzd(summary.realEstateNzd)} − Mortgage ${formatNzd(summary.realEstateMortgageNzd ?? 0)}`
                : 'Manual market value − mortgage'
            }
          />
        ) : null}
        {assetEnabled('collectable') ? (
          <Bucket
            title="Collectables"
            value={summary.collectablesNzd}
            hint="MTG Scryfall / Pokémon TCG API → NZD (never invent)"
          />
        ) : null}
        {assetEnabled('kiwisaver') ? (
          <Bucket title="KiwiSaver" value={summary.kiwiSaverNzd} hint="Akahu Sharesies + manual bank-held" />
        ) : null}
        <Bucket
          title="Debt / I owe"
          value={summary.debtOutstandingNzd ?? 0}
          hint={
            (summary.debtPersonCount ?? 0) === 0 ? (
              <>
                No creditors recorded · manage under <Link to="/debts">Debts</Link>
              </>
            ) : (
              `${summary.debtPersonCount} creditor${summary.debtPersonCount === 1 ? '' : 's'} · outstanding reduces net worth (not spend)`
            )
          }
        />
      </section>

      <AssetBreakdownChart rows={assetBreakdown} asOf={formatAuckland(summary.asOf)} />

      <DebtBreakdownChart people={debtPeople} />

{assetEnabled('cash') ? (
      <section className="panel">
        <div className="panel-heading">
          <h2>Cash / bank accounts</h2>
        </div>
        {nzdAccounts.length === 0 ? (
          <p className="muted">
            No NZD bank balances yet.
          </p>
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
            <tbody>
              {nzdAccounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
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
                  <strong>{formatNzd(summary.cashNzd)}</strong>
                </td>
              </tr>
              {(summary.cashLiabilitiesNzd ?? 0) !== 0 && (
                <tr>
                  <td colSpan={3} className="muted">Credit / loan (excluded from Cash)</td>
                  <td style={{ textAlign: 'right' }} className="muted">
                    {formatNzd(summary.cashLiabilitiesNzd ?? 0)}
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
          </div>
        )}
        {otherAccounts.length > 0 && (
          <>
            <p className="muted small" style={{ marginTop: '1rem' }}>
              Non-NZD accounts (stored, excluded from cash total — no FX applied)
            </p>
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
                {otherAccounts.map((a) => {
                  const bal = balanceNumber(a.balance);
                  return (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td>{a.institution || '—'}</td>
                      <td>{a.currency}</td>
                      <td style={{ textAlign: 'right' }}>
                        {bal.toLocaleString('en-NZ', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        {a.currency}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </>
        )}
      </section>
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
          </div>
          <div className="month-snapshot-figure">
            <dt>Spending</dt>
            <dd>{formatNzd(snapshot.spendingNzd)}</dd>
          </div>
          <div className="month-snapshot-figure">
            <dt>Savings</dt>
            <dd>{formatNzd(snapshot.savingsNzd)}</dd>
          </div>
          <div className="month-snapshot-figure">
            <dt>Savings rate</dt>
            <dd>{formatSavingsRate(snapshot.savingsRate)}</dd>
          </div>
        </dl>
      ) : (
        <p className="month-snapshot-status">Loading this month…</p>
      )}
    </section>
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
  hint,
}: {
  title: string;
  value: number | null;
  hint?: ReactNode;
}) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="card-value">{formatNzd(value)}</p>
      {hint && <p className="muted small">{hint}</p>}
    </div>
  );
}
