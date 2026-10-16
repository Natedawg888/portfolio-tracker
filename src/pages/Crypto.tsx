/**
 * Advanced crypto (KAN-47, Pro): gains for the NZ tax year, staking income, holdings with
 * unrealised gains, the crypto ledger, importing from your wallets, and DeFi positions.
 * Cost basis is FIFO or weighted average (the two methods IRD lists). An estimate for your
 * records, not tax advice. Amounts follow Hide amounts through formatNzd.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, formatNzd } from '../api/client';
import type { CryptoSummary, CryptoTxn, CryptoTxnBody } from '../types';
import { useMoneyHidden } from '../lib/privacy';
import { longDate } from './warrantiesView';
import { KIND_LABEL } from '../lib/cryptoGains';
import { CryptoTxnForm } from '../components/crypto/CryptoTxnForm';
import { CryptoImport } from '../components/crypto/CryptoImport';
import { DefiPositions } from '../components/crypto/DefiPositions';

const IRD_CALC = 'https://www.ird.govt.nz/cryptoassets/taxing/income-expenses/calculating-cryptoasset-income';
const IRD_CONVERT = 'https://www.ird.govt.nz/cryptoassets/taxing/income-expenses/convert-currency';
const qty = (n: number) => n.toLocaleString('en-NZ', { maximumFractionDigits: 8 });
const signed = (n: number) => (n < 0 ? `−${formatNzd(-n)}` : formatNzd(n));

function Upsell() {
  return (
    <section className="panel">
      <h3>Part of KoruLedger Pro</h3>
      <p className="muted">Pro adds a crypto ledger with cost basis and gains for your tax return:</p>
      <ul className="crypto-upsell">
        <li>Realised and unrealised gains, by NZ tax year, using FIFO or weighted average cost</li>
        <li>Staking rewards and airdrops as income at their value when received</li>
        <li>Import transactions from your wallets, with each one classified</li>
        <li>DeFi positions (lending, pools, vaults, borrowing) in your net worth</li>
      </ul>
    </section>
  );
}

export function Crypto() {
  useMoneyHidden();
  const [view, setView] = useState<CryptoSummary | null>(null);
  const [year, setYear] = useState<number | undefined>(undefined);
  const [pro, setPro] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ txn: CryptoTxn | null } | null>(null);

  const load = useCallback(() => {
    api.crypto
      .summary(year)
      .then((v) => {
        setPro(true);
        setView(v);
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.code === 'PRO_REQUIRED') setPro(false);
        else setError(e instanceof Error ? e.message : 'Could not load.');
      });
  }, [year]);
  useEffect(load, [load]);

  async function saveTxn(body: CryptoTxnBody) {
    const existing = dialog?.txn ?? null;
    if (existing) await api.crypto.updateTxn(existing.id, body);
    else await api.crypto.createTxn(body);
    setDialog(null);
    setMsg(existing ? 'Transaction updated.' : 'Transaction added.');
    load();
  }

  async function removeTxn(t: CryptoTxn) {
    if (!window.confirm(`Delete this ${KIND_LABEL[t.kind].toLowerCase()} of ${qty(t.amount)} ${t.asset}?`)) return;
    await api.crypto.removeTxn(t.id);
    setMsg('Transaction deleted.');
    load();
  }

  const y = view?.year;
  return (
    <div className="stack bills-page crypto-page">
      <header className="warranties-header">
        <div>
          <Link className="warranties-back" to="/portfolio">
            ‹ Portfolio
          </Link>
          <h2 className="page-title">Crypto gains</h2>
          <p className="muted small">Cost basis, gains, staking income and DeFi, for your records and tax return.</p>
        </div>
        {view ? (
          <div className="warranties-header-actions">
            <button type="button" className="btn small primary" onClick={() => setDialog({ txn: null })}>
              + Add transaction
            </button>
          </div>
        ) : null}
      </header>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {msg ? <p className="banner">{msg}</p> : null}
      {!pro ? <Upsell /> : null}
      {pro && !view && !error ? <p className="muted">Loading…</p> : null}

      {view && y ? (
        <>
          <section className="panel" aria-labelledby="crypto-year-title">
            <div className="payslips-ytd-head">
              <h3 id="crypto-year-title">Tax year</h3>
              <label className="payslips-year">
                <span className="sr-only">Tax year</span>
                <select value={view.taxYear} onChange={(e) => setYear(Number(e.target.value))}>
                  {view.years.map((yr) => (
                    <option key={yr.startYear} value={yr.startYear}>
                      {yr.startYear}/{String((yr.startYear + 1) % 100).padStart(2, '0')}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted small">{view.years.find((x) => x.startYear === view.taxYear)?.label}</p>
            <dl className="hh-pay-figures">
              <div className="hh-pay-net">
                <dt>Realised gains</dt>
                <dd className={'money' + (y.realisedNzd < 0 ? ' hh-owes' : '')}>{signed(y.realisedNzd)}</dd>
              </div>
              <div>
                <dt>Staking, airdrops and pay</dt>
                <dd className="money">{formatNzd(y.incomeNzd)}</dd>
              </div>
              <div>
                <dt>Sold or swapped for</dt>
                <dd className="money">{formatNzd(y.proceedsNzd)}</dd>
              </div>
              <div>
                <dt>Cost of what went</dt>
                <dd className="money">{formatNzd(y.costNzd)}</dd>
              </div>
            </dl>
            <div className="crypto-method" role="group" aria-label="Cost basis method">
              <span className="small">Cost basis:</span>
              <div className="segmented">
                {(['fifo', 'wac'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={'segmented-btn' + (view.costMethod === m ? ' active' : '')}
                    aria-pressed={view.costMethod === m}
                    onClick={() => void api.crypto.setCostMethod(m).then(load)}
                  >
                    {m === 'fifo' ? 'First in, first out' : 'Weighted average'}
                  </button>
                ))}
              </div>
            </div>
            {view.missingValue ? <p className="small hh-over">{view.missingValue === 1 ? '1 transaction needs' : `${view.missingValue} transactions need`} an NZD value. Until then it’s left out of the money figures.</p> : null}
            {view.shortfalls.length ? <p className="small hh-over">You sold more {view.shortfalls.join(', ')} than the ledger shows you had. Add the earlier buys or transfers.</p> : null}
            <p className="muted small">
              IRD accepts first-in-first-out or weighted average cost; use one consistently. Unrealised gains aren’t taxed. An estimate for your records, not tax advice. See IRD:{' '}
              <a href={IRD_CALC} target="_blank" rel="noreferrer">calculating cryptoasset income</a> ·{' '}
              <a href={IRD_CONVERT} target="_blank" rel="noreferrer">converting to NZD</a>.
            </p>
            {view.disposals.length ? (
              <details className="proj-fold">
                <summary>Sales and swaps ({view.disposals.length})</summary>
                <div className="table-wrap" style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Coin</th>
                        <th style={{ textAlign: 'right' }}>Proceeds</th>
                        <th style={{ textAlign: 'right' }}>Cost</th>
                        <th style={{ textAlign: 'right' }}>Gain</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.disposals.map((d) => (
                        <tr key={d.txnId}>
                          <td>{d.date}</td>
                          <td>
                            {qty(d.amount)} {d.asset}
                          </td>
                          <td className="money" style={{ textAlign: 'right' }}>{formatNzd(d.proceedsNzd)}</td>
                          <td className="money" style={{ textAlign: 'right' }}>{formatNzd(d.costNzd)}</td>
                          <td className="money" style={{ textAlign: 'right' }}>{signed(d.gainNzd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
            {view.income.length ? (
              <details className="proj-fold">
                <summary>Staking and other crypto income ({view.income.length})</summary>
                <ul className="hh-rows">
                  {view.income.map((i) => (
                    <li key={i.txnId}>
                      <span>
                        {qty(i.amount)} {i.asset} <span className="muted small">· {KIND_LABEL[i.kind]} · {longDate(i.date)}</span>
                      </span>
                      <span className="money">{formatNzd(i.nzdValue)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          <section className="panel" aria-labelledby="crypto-hold-title">
            <h3 id="crypto-hold-title">What you hold now</h3>
            {view.positions.length ? (
              <>
                <div className="table-wrap" style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Coin</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                        <th style={{ textAlign: 'right' }}>Cost</th>
                        <th style={{ textAlign: 'right' }}>Value</th>
                        <th style={{ textAlign: 'right' }}>Unrealised</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.positions.map((p) => (
                        <tr key={p.asset}>
                          <td>{p.asset}</td>
                          <td style={{ textAlign: 'right' }}>{qty(p.quantity)}</td>
                          <td className="money" style={{ textAlign: 'right' }}>{p.costIncomplete ? <span className="hh-over">Needs values</span> : formatNzd(p.costNzd)}</td>
                          <td className="money" style={{ textAlign: 'right' }}>{p.valueNzd != null ? formatNzd(p.valueNzd) : '—'}</td>
                          <td className="money" style={{ textAlign: 'right' }}>{p.unrealisedNzd != null ? signed(p.unrealisedNzd) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="small">
                  Unrealised: <strong className="money">{signed(view.unrealisedNzd)}</strong> <span className="muted">at today’s prices, where available. Not taxed until sold.</span>
                </p>
              </>
            ) : (
              <p className="muted small">Nothing yet. Add your buys, or import from a wallet below.</p>
            )}
          </section>

          <section className="panel" aria-labelledby="crypto-import-title">
            <h3 id="crypto-import-title">Import from a wallet</h3>
            <p className="muted small">Reads recent transfers from a wallet you’ve added (coins and tokens), suggests what each one was, and fills in its NZD value for the day where it can.</p>
            <CryptoImport
              wallets={view.wallets}
              onDone={(m) => {
                setMsg(m);
                load();
              }}
            />
          </section>

          <section className="panel" aria-labelledby="crypto-ledger-title">
            <h3 id="crypto-ledger-title">Ledger ({view.txns.length})</h3>
            {view.txns.length ? (
              <ul className="hh-rows crypto-ledger">
                {view.txns.map((t) => (
                  <li key={t.id} className="hh-row-wrap">
                    <span>
                      <strong>{KIND_LABEL[t.kind]}</strong> {qty(t.amount)} {t.asset}
                      {t.kind === 'swap' && t.toAsset ? ` → ${qty(t.toAmount ?? 0)} ${t.toAsset}` : ''}
                      <span className="muted small">
                        {' '}· {longDate(t.date)}
                        {t.imported ? ' · imported' : ''}
                      </span>
                    </span>
                    <span className="money">{t.nzdValue != null ? formatNzd(t.nzdValue) : t.needsValue ? <span className="hh-over">Needs a value</span> : '—'}</span>
                    <span className="payslip-actions">
                      <button type="button" className="link-btn" onClick={() => setDialog({ txn: t })}>
                        Edit
                      </button>
                      <button type="button" className="link-btn" onClick={() => void removeTxn(t)}>
                        Delete
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">No transactions yet.</p>
            )}
          </section>

          <section className="panel" aria-labelledby="crypto-defi-title">
            <h3 id="crypto-defi-title">DeFi positions</h3>
            <DefiPositions view={view.defi} onChange={(d) => setView((v) => (v ? { ...v, defi: d } : v))} onNote={setMsg} />
          </section>
        </>
      ) : null}

      {dialog ? <CryptoTxnForm txn={dialog.txn} onClose={() => setDialog(null)} onSave={saveTxn} /> : null}
    </div>
  );
}
