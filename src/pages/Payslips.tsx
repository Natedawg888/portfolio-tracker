/**
 * Payslips (KAN-78), under Budget. Keep each payslip, check it against the PAYE calculator
 * (Plus), see year-to-date totals for the NZ tax year with a pay history chart and missing-pay
 * warnings, and put net pay into Income matched to the bank deposit (Plus). Amounts follow
 * Hide amounts through formatNzd. Educational only, not tax advice.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatNzd } from '../api/client';
import type { Payslip, PayslipWriteBody, PayslipsView } from '../types';
import { useMoneyHidden } from '../lib/privacy';
import { longDate } from './warrantiesView';
import { FREQUENCY_LABEL } from '../lib/payslipCheck';
import { PayslipForm } from '../components/payslips/PayslipForm';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const EMPLOYER_KEY = 'koru-payslips-employer';
const short = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });

function HistoryChart({ history }: { history: PayslipsView['history'] }) {
  if (history.length < 2) return null;
  const max = Math.max(...history.map((h) => h.grossNzd), 1);
  const w = 100 / history.length;
  const total = history.reduce((s, h) => s + h.netNzd, 0);
  return (
    <figure className="payslip-chart">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`Pay history: ${history.length} payslips from ${longDate(history[0].payDate)} to ${longDate(history[history.length - 1].payDate)}, ${formatNzd(total)} net in total.`}>
        {history.map((h, i) => (
          <g key={`${h.payDate}-${i}`}>
            <rect className="payslip-bar-gross" x={i * w + w * 0.15} width={w * 0.7} y={40 - (h.grossNzd / max) * 38} height={(h.grossNzd / max) * 38} />
            <rect className="payslip-bar-net" x={i * w + w * 0.15} width={w * 0.7} y={40 - (h.netNzd / max) * 38} height={(h.netNzd / max) * 38} />
          </g>
        ))}
      </svg>
      <figcaption className="muted small">
        <span className="payslip-key payslip-key-net" aria-hidden="true" /> Net <span className="payslip-key payslip-key-gross" aria-hidden="true" /> Gross · {short(history[0].payDate)} to {short(history[history.length - 1].payDate)}
      </figcaption>
    </figure>
  );
}

function CheckBadge({ p, plus }: { p: Payslip; plus: boolean }) {
  if (!plus || !p.check) return <span className="payslip-badge">Check with Plus</span>;
  if (p.check.status === 'not_checked') return <span className="payslip-badge">Not checked</span>;
  const bad = p.check.items.filter((i) => !i.ok).length;
  return bad ? <span className="payslip-badge payslip-badge-warn">{bad === 1 ? '1 difference' : `${bad} differences`}</span> : <span className="payslip-badge payslip-badge-ok">Matches PAYE</span>;
}

function PayslipCard({ p, plus, onEdit, onDelete }: { p: Payslip; plus: boolean; onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="payslip-card">
      <div className="payslip-card-top">
        <div>
          <h4>{p.employer}</h4>
          <p className="muted small">
            Paid {longDate(p.payDate)} · {FREQUENCY_LABEL[p.frequency].toLowerCase()} · {short(p.periodStart)}–{short(p.periodEnd)}
            {p.taxCode ? ` · ${p.taxCode}` : ''}
          </p>
        </div>
        <CheckBadge p={p} plus={plus} />
      </div>
      <dl className="payslip-figs">
        <div>
          <dt>Gross</dt>
          <dd className="money">{formatNzd(p.grossNzd + p.allowancesNzd)}</dd>
        </div>
        <div>
          <dt>Tax</dt>
          <dd className="money">{formatNzd(p.payeNzd + (p.accNzd ?? 0))}</dd>
        </div>
        <div>
          <dt>Net</dt>
          <dd className="money">{formatNzd(p.netNzd)}</dd>
        </div>
      </dl>
      {!p.netCheck.matches ? <p className="small hh-over">The lines on this payslip come to {formatNzd(p.netCheck.expected)}, not {formatNzd(p.netNzd)}.</p> : null}
      <p className="small muted">
        {p.income.bankMatch
          ? `In Income, matched to the bank deposit on ${longDate(p.income.bankMatch.date)} (${p.income.bankMatch.description}).`
          : p.income.inIncome
            ? `In Income. ${p.income.reason ?? ''}`
            : p.income.reason}
      </p>
      <div className="payslip-actions">
        {plus && p.check?.status === 'checked' ? (
          <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide the check' : 'See the check'}
          </button>
        ) : null}
        {p.fileUrl ? (
          <a className="link-btn" href={p.fileUrl} target="_blank" rel="noreferrer">
            View file
          </a>
        ) : null}
        <button type="button" className="link-btn" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="link-btn" onClick={onDelete}>
          Delete
        </button>
      </div>
      {plus && p.check?.status === 'not_checked' ? <p className="small muted">{p.check.reason}</p> : null}
      {open && p.check?.status === 'checked' ? (
        <div className="payslip-check-detail">
          <table className="hh-wff-table">
            <caption className="sr-only">PAYE check for this payslip</caption>
            <thead>
              <tr>
                <th scope="col">Deduction</th>
                <th scope="col">Payslip</th>
                <th scope="col">Expected</th>
              </tr>
            </thead>
            <tbody>
              {p.check.items.map((i) => (
                <tr key={i.key} className={i.ok ? undefined : 'payslip-row-warn'}>
                  <th scope="row">
                    {i.label}
                    {i.ok ? '' : ` (${i.difference > 0 ? '+' : '−'}${formatNzd(Math.abs(i.difference))})`}
                  </th>
                  <td className="money">{formatNzd(i.actual)}</td>
                  <td className="money">{formatNzd(i.expected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {p.check.items.filter((i) => i.note).map((i) => (
            <p key={i.key} className="small muted">{i.note}</p>
          ))}
          {p.check.notes.map((n) => (
            <p key={n} className="small muted">{n}</p>
          ))}
          <p className="small muted">An estimate for information, not tax advice. If something looks wrong, ask your employer or Inland Revenue.</p>
        </div>
      ) : null}
    </article>
  );
}

export function Payslips() {
  useMoneyHidden();
  const [view, setView] = useState<PayslipsView | null>(null);
  const [year, setYear] = useState<number | undefined>(undefined);
  // The employer being viewed (null = all), remembered on this device.
  const [employer, setEmployer] = useState<string | null>(() => {
    try {
      return localStorage.getItem(EMPLOYER_KEY);
    } catch {
      return null;
    }
  });
  const pickEmployer = (key: string | null) => {
    setEmployer(key);
    try {
      if (key) localStorage.setItem(EMPLOYER_KEY, key);
      else localStorage.removeItem(EMPLOYER_KEY);
    } catch {
      /* private mode */
    }
  };
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ payslip: Payslip | null } | null>(null);

  const load = useCallback(() => {
    api.payslips
      .list(year, employer)
      .then(setView)
      .catch((e: unknown) => setError(errText(e, 'Could not load payslips.')));
  }, [year, employer]);
  useEffect(load, [load]);

  async function save(body: PayslipWriteBody, file: string | null, removeFile: boolean) {
    const existing = dialog?.payslip ?? null;
    const saved = existing ? await api.payslips.update(existing.id, body) : await api.payslips.create(body);
    // Show the employer it was saved under when viewing a different one.
    if (employer && saved.employerKey !== employer) pickEmployer(saved.employerKey);
    let note = existing ? 'Payslip updated.' : 'Payslip added.';
    try {
      if (file) await api.payslips.uploadFile(saved.id, file);
      else if (removeFile) await api.payslips.removeFile(saved.id);
    } catch (e) {
      note = `${note} The file didn’t upload: ${errText(e, 'try again from Edit')}.`;
    }
    setDialog(null);
    setMsg(note);
    load();
  }

  async function remove(p: Payslip) {
    if (!window.confirm(`Delete the ${longDate(p.payDate)} payslip from ${p.employer}? Its file and Income entry go too; your bank deposit stays.`)) return;
    try {
      await api.payslips.remove(p.id);
      setMsg('Payslip deleted.');
      load();
    } catch (e) {
      setError(errText(e, 'Could not delete the payslip.'));
    }
  }

  const ytd = view?.ytd;
  const atLimit = view && !view.plan.plus && view.plan.usedThisYear >= view.plan.freeLimit;
  const missing = ytd?.bySource.flatMap((s) => s.missing.map((m) => ({ ...m, employer: s.employer }))) ?? [];

  return (
    <div className="stack bills-page payslips-page">
      <header className="warranties-header">
        <div>
          <Link className="warranties-back" to="/spending">
            ‹ Budget
          </Link>
          <h2 className="page-title">Payslips</h2>
          <p className="muted small">Keep your payslips, check the deductions against PAYE, and see the tax year so far.</p>
        </div>
        <div className="warranties-header-actions">
          <button type="button" className="btn small primary" disabled={!view || !!atLimit} onClick={() => setDialog({ payslip: null })}>
            + Add payslip
          </button>
        </div>
      </header>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
      {msg ? <p className="banner">{msg}</p> : null}
      {!view && !error ? <p className="muted">Loading payslips…</p> : null}

      {view && view.employers.length > 1 ? (
        <nav className="payslip-employers" aria-label="Employer">
          <div className="segmented">
            <button type="button" className={'segmented-btn' + (view.employer == null ? ' active' : '')} aria-pressed={view.employer == null} onClick={() => pickEmployer(null)}>
              All employers
            </button>
            {view.employers.map((e) => (
              <button key={e.key} type="button" className={'segmented-btn' + (view.employer === e.key ? ' active' : '')} aria-pressed={view.employer === e.key} onClick={() => pickEmployer(e.key)}>
                {e.name}
              </button>
            ))}
          </div>
        </nav>
      ) : null}

      {view ? (
        <>
          <section className="panel" aria-labelledby="payslips-ytd-title">
            <div className="payslips-ytd-head">
              <h3 id="payslips-ytd-title">
                Tax year so far
                {view.employer ? <span className="muted"> · {view.employers.find((e) => e.key === view.employer)?.name}</span> : null}
              </h3>
              <label className="payslips-year">
                <span className="sr-only">Tax year</span>
                <select value={view.taxYear} onChange={(e) => setYear(Number(e.target.value))}>
                  {view.years.map((y) => (
                    <option key={y.startYear} value={y.startYear}>
                      {y.startYear}/{String((y.startYear + 1) % 100).padStart(2, '0')}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted small">{view.years.find((y) => y.startYear === view.taxYear)?.label}</p>
            {ytd && ytd.count ? (
              <>
                <dl className="hh-pay-figures">
                  <div>
                    <dt>Gross</dt>
                    <dd className="money">{formatNzd(ytd.grossNzd)}</dd>
                  </div>
                  <div>
                    <dt>Tax (PAYE + ACC)</dt>
                    <dd className="money">{formatNzd(ytd.taxNzd)}</dd>
                  </div>
                  <div>
                    <dt>KiwiSaver</dt>
                    <dd className="money">{formatNzd(ytd.kiwiSaverNzd)}</dd>
                  </div>
                  <div>
                    <dt>Student loan</dt>
                    <dd className="money">{formatNzd(ytd.studentLoanNzd)}</dd>
                  </div>
                  <div className="hh-pay-net">
                    <dt>Net</dt>
                    <dd className="money">{formatNzd(ytd.netNzd)}</dd>
                  </div>
                  <div>
                    <dt>Payslips</dt>
                    <dd>{ytd.count}</dd>
                  </div>
                </dl>
                <HistoryChart history={view.history} />
                {missing.length ? (
                  <ul className="payslip-missing" aria-label="Possibly missing payslips">
                    {missing.map((m) => (
                      <li key={`${m.employer}-${m.after}`} className="small">
                        No payslip from {m.employer} between {longDate(m.after)} and {longDate(m.before)}. Missing one?
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="muted small">No payslips for this tax year yet.</p>
            )}
            {!view.plan.plus ? (
              <p className="small payslip-plan">
                {view.plan.usedThisYear} of {view.plan.freeLimit} payslips this tax year on the free plan. KoruLedger Plus keeps them all, checks each one against PAYE, and adds your pay to Income matched to the bank deposit.
              </p>
            ) : null}
          </section>

          {view.payslips.length ? (
            <section aria-labelledby="payslips-list-title" className="payslip-list">
              <h3 id="payslips-list-title" className="sr-only">
                Payslips
              </h3>
              {view.payslips.map((p) => (
                <PayslipCard key={p.id} p={p} plus={view.plan.plus} onEdit={() => setDialog({ payslip: p })} onDelete={() => void remove(p)} />
              ))}
            </section>
          ) : null}
        </>
      ) : null}

      {dialog && view ? <PayslipForm view={view} payslip={dialog.payslip} startEmployer={view.employer} onClose={() => setDialog(null)} onSave={save} /> : null}
    </div>
  );
}
