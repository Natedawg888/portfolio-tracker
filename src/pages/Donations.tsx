/**
 * Donations (KAN-25), opened from Budget. The donations ledger on /api/donations: gifts for one
 * NZ tax year (1 April – 31 March), the totals IRD's donation tax credit (IR526) is worked from,
 * and the credit estimate (a third of eligible gifts, cut to cents). Amounts follow Hide amounts.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, formatNzd } from '../api/client';
import type { Donation, DonationSummary } from '../types';
import { useMoneyHidden } from '../lib/privacy';
import { longDate } from './warrantiesView';
import {
  donationBodyFromFields,
  donationYearLabel,
  donationYearNotes,
  emptyDonationFields,
  fieldsFromDonation,
  type DonationFields,
} from '../lib/donationsView';

const IRD_DONATIONS = 'https://www.ird.govt.nz/income-tax/income-tax-for-individuals/individual-tax-credits/donation-tax-credits';
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function DonationForm({ donation, today, onClose, onSave }: { donation: Donation | null; today: string; onClose: () => void; onSave: (f: DonationFields) => Promise<void> }) {
  const [f, setF] = useState<DonationFields>(() => (donation ? fieldsFromDonation(donation) : emptyDonationFields(today)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof DonationFields, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const checked = donationBodyFromFields(f);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(f);
    } catch (err) {
      setError(errText(err, 'Could not save the donation.'));
      setBusy(false);
    }
  }

  const title = donation ? 'Edit donation' : 'Add a donation';
  return (
    <div className="modal-overlay" role="presentation" onClick={(e) => (e.target === e.currentTarget ? onClose() : undefined)}>
      <div className="modal-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="btn small modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <form onSubmit={(e) => void submit(e)}>
          <div className="form-grid">
            <label>
              Date
              <input type="date" value={f.date} max={today} onChange={(e) => set('date', e.target.value)} required />
            </label>
            <label>
              Amount (NZD)
              <input type="number" min={0.01} step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} required />
            </label>
            <label className="span-2">
              Charity or recipient
              <input value={f.recipient} maxLength={200} onChange={(e) => set('recipient', e.target.value)} required />
            </label>
            <label className="span-2">
              Receipt link (optional)
              <input type="url" placeholder="https://" value={f.evidenceUrl} onChange={(e) => set('evidenceUrl', e.target.value)} />
              <span className="muted small">Keep your receipts: IRD needs them for the claim.</span>
            </label>
            <label className="span-2">
              Notes (optional)
              <textarea rows={2} value={f.notes} maxLength={1000} onChange={(e) => set('notes', e.target.value)} />
            </label>
          </div>
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="row gap modal-actions">
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Donations() {
  useMoneyHidden();
  const [taxYear, setTaxYear] = useState<number | null>(null);
  const [summary, setSummary] = useState<DonationSummary | null>(null);
  const [rows, setRows] = useState<Donation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ donation: Donation | null } | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.donations.summary(taxYear ?? undefined), api.donations.list(taxYear ?? undefined)])
      .then(([s, list]) => {
        setSummary(s);
        setRows([...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)));
      })
      .catch((e: unknown) => setError(errText(e, 'Could not load your donations.')));
  }, [taxYear]);
  useEffect(load, [load]);

  async function save(f: DonationFields) {
    const checked = donationBodyFromFields(f);
    if (!checked.ok) throw new Error(checked.error);
    const existing = dialog?.donation ?? null;
    if (existing) await api.donations.update(existing.id, checked.body);
    else await api.donations.create(checked.body);
    setDialog(null);
    setMsg(existing ? 'Donation updated.' : `Gift to ${checked.body.recipient} added.`);
    load();
  }

  async function remove(d: Donation) {
    if (!window.confirm(`Delete the ${formatNzd(d.amountNzd)} gift to ${d.recipient}?`)) return;
    try {
      await api.donations.remove(d.id);
      setMsg('Donation deleted.');
      load();
    } catch (e) {
      setError(errText(e, 'Could not delete the donation.'));
    }
  }

  const y = summary?.selected;
  const today = summary?.asOf ?? new Date().toISOString().slice(0, 10);
  return (
    <div className="stack bills-page donations-page">
      <header className="warranties-header">
        <div>
          <Link className="warranties-back" to="/spending">
            ‹ Budget
          </Link>
          <h2 className="page-title">Donations</h2>
          <p className="muted small">Gifts to charities and other approved donees, and the tax credit you can claim back from IRD.</p>
        </div>
        <div className="warranties-header-actions">
          {summary ? (
            <label className="small">
              Tax year{' '}
              <select value={summary.taxYear} onChange={(e) => setTaxYear(Number(e.target.value))}>
                {summary.years.map((yr) => (
                  <option key={yr.taxYear} value={yr.taxYear}>
                    {donationYearLabel(yr.taxYear)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="button" className="btn small primary" disabled={!summary} onClick={() => setDialog({ donation: null })}>
            + Add donation
          </button>
        </div>
      </header>

      {error ? (
        <div className="panel">
          <p className="auth-error" role="alert">
            {error}
          </p>
          <button type="button" className="btn small" onClick={load}>
            Try again
          </button>
        </div>
      ) : null}
      {msg ? <p className="banner">{msg}</p> : null}
      {!summary && !error ? <p className="muted">Loading donations…</p> : null}

      {summary && y ? (
        <section className="panel" aria-labelledby="donations-total-title">
          <h3 id="donations-total-title">
            {donationYearLabel(y.taxYear)} · {longDate(y.taxYearStart)} to {longDate(y.taxYearEnd)}
          </h3>
          <dl className="hh-pay-figures">
            <div>
              <dt>Given</dt>
              <dd className="money">{formatNzd(y.totalAmountNzd)}</dd>
              <dd className="muted small">{y.count === 1 ? '1 gift' : `${y.count} gifts`}</dd>
            </div>
            <div>
              <dt>Counts for the credit</dt>
              <dd className="money">{formatNzd(y.claimableAmountNzd)}</dd>
              <dd className="muted small">Gifts of ${y.minimumDonationNzd} or more</dd>
            </div>
            <div className="hh-pay-net">
              <dt>Tax credit (estimate)</dt>
              <dd className="money">{formatNzd(y.estimatedTaxCreditNzd)}</dd>
              <dd className="muted small">A third, claimed after 31 March</dd>
            </div>
          </dl>
          {donationYearNotes(y).map((n) => (
            <p key={n} className="small hh-over">
              {n}
            </p>
          ))}
          <p className="muted small">
            {summary.estimateNote} The credit can’t be more than a third of your taxable income, which isn’t checked here. Claim it in myIR
            or on an IR526 after the tax year ends. An estimate, not tax advice. See IRD:{' '}
            <a href={IRD_DONATIONS} target="_blank" rel="noreferrer">
              donation tax credits
            </a>
            .
          </p>
        </section>
      ) : null}

      {summary && rows && rows.length === 0 ? (
        <section className="panel">
          <h3>No donations in {donationYearLabel(summary.taxYear)}</h3>
          <p className="muted small">Record each gift with its receipt to see what you can claim back. Gifts of $5 or more count.</p>
          <button type="button" className="btn primary" onClick={() => setDialog({ donation: null })}>
            Add a donation
          </button>
        </section>
      ) : null}

      {rows && rows.length ? (
        <section className="panel" aria-label="Your donations">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Recipient</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Receipt</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td>{longDate(d.date)}</td>
                    <td>
                      {d.recipient}
                      {d.notes ? <span className="muted small"> · {d.notes}</span> : null}
                      {d.amountNzd < (summary?.minimumDonationNzd ?? 5) ? <span className="muted small"> · under $5, not counted</span> : null}
                    </td>
                    <td className="money" style={{ textAlign: 'right' }}>
                      {formatNzd(d.amountNzd)}
                    </td>
                    <td className="small">
                      {d.receiptUrl ? (
                        <a href={d.receiptUrl} target="_blank" rel="noreferrer">
                          Receipt
                        </a>
                      ) : d.evidenceUrl ? (
                        <a href={d.evidenceUrl} target="_blank" rel="noreferrer">
                          Link
                        </a>
                      ) : (
                        <span className="muted">None</span>
                      )}
                    </td>
                    <td className="small">
                      <button type="button" className="link-btn" onClick={() => setDialog({ donation: d })}>
                        Edit
                      </button>{' '}
                      <button type="button" className="link-btn" onClick={() => void remove(d)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {dialog ? <DonationForm donation={dialog.donation} today={today} onClose={() => setDialog(null)} onSave={save} /> : null}
    </div>
  );
}
