
import { useCallback, useEffect, useState } from 'react';
import { api, coerceBalance, formatAuckland, formatNzd } from '../api/client';
import { maybeAutoSyncBankTransactions, maybeAutoSyncPortfolio } from '../lib/akahuTxnAutoSync';
import { showQuietToast } from '../lib/quietToast';
import { AssetBreakdownChart, type AssetBreakdownRow } from '../components/AssetBreakdownChart';
import { DebtBreakdownChart, type DebtBreakdownPerson } from '../components/DebtBreakdownChart';
import { useAssetClassPrefs } from '../auth/AssetClassPrefsContext';
import type { AssetClassPrefKey } from '../lib/assetClassPrefs';

type Summary = {
  cashNzd: number;
  cashLiabilitiesNzd?: number;
  stocksNzd: number | null;
  cryptoNzd: number | null;
  gominingMinersNzd: number | null;
  artNzd: number | null;
  metalsNzd: number | null;
  metalsUseSpot?: boolean;
  metalsConfigured?: boolean;
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
  const [summary, setSummary] = useState<Summary | null>(null);
  const [accounts, setAccounts] = useState<BankAccountRow[]>([]);
  const [debtPeople, setDebtPeople] = useState<DebtBreakdownPerson[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return Promise.all([api.netWorth(), api.accounts.list(), api.debts.people()])
      .then(([net, accts, people]) => {
        setSummary(net as Summary);
        setAccounts(accts as BankAccountRow[]);
        setDebtPeople(people);
        setError(null);
      })
      .catch((e: Error) => {
        setSummary((prev) => {
          if (prev) {
            showQuietToast('Could not refresh dashboard — showing last data.', { kind: 'warn' });
            return prev;
          }
          setError(e.message);
          return prev;
        });
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
        if (txnInserted || portOk) await load();
      } catch {
        showQuietToast('Bank/portfolio sync paused — showing last data.', { kind: 'warn' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);


  if (error) {
    return (
      <div className="panel warn dashboard-page">
        <h2 className="page-title">Dashboard</h2>
        <p>The figures could not be loaded. Try again.</p>
      </div>
    );
  }

  if (!summary) return <div className="panel dashboard-page">Loading net worth…</div>;

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
        {assetEnabled('crypto') ? <Bucket title="Crypto" value={summary.cryptoNzd} /> : null}
        {assetEnabled('gomining') ? (
          <Bucket title="GoMining miners" value={summary.gominingMinersNzd} />
        ) : null}
        {assetEnabled('art') ? <Bucket title="Art" value={summary.artNzd} /> : null}
        {assetEnabled('metal') ? (
          <Bucket
            title="Metals"
            value={summary.metalsNzd}
            hint={
              summary.metalsUseSpot
                ? summary.metalsConfigured
                  ? 'Metals.Dev spot NZD (stale OK if quota exhausted)'
                  : 'gold-api.com spot NZD'
                : summary.metalsConfigured
                  ? 'Refresh on Portfolio or Value search for a spot. The last good value stays if the quota is used up.'
                  : 'No stored spot yet'
            }
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
            (summary.debtPersonCount ?? 0) === 0
              ? 'No creditors recorded · manage under Spending'
              : `${summary.debtPersonCount} creditor${summary.debtPersonCount === 1 ? '' : 's'} · outstanding reduces net worth (not spend)`
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

function Bucket({
  title,
  value,
  hint,
}: {
  title: string;
  value: number | null;
  hint?: string;
}) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="card-value">{formatNzd(value)}</p>
      {hint && <p className="muted small">{hint}</p>}
    </div>
  );
}
