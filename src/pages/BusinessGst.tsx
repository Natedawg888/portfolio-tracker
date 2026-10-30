/**
 * GST return for one business (KAN-127): the return period (monthly, two-monthly or six-monthly),
 * GST on sales, GST on expenses and what's to pay or refund, the GST101A boxes laid out to copy
 * into myIR, and the items behind them, each of which can be marked standard, zero-rated or no
 * GST. Payments basis. An estimate to check: nothing is filed. Business plan only.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api, formatNzd } from '../api/client';
import { BusinessTabs, errorText } from '../components/business/BusinessUi';
import { BusinessPlanNote } from '../components/business/BusinessPlanNote';
import { BUSINESS_PLAN_REQUIRED, IRD_GST_URL } from '../lib/business';
import { GST101A_BOXES, GST_FREQUENCIES, shiftPeriod, type GstFrequency } from '../lib/gst';
import { showQuietToast } from '../lib/quietToast';
import { formatInvoiceDate } from './invoicesView';
import type { GstItem, GstReturnView } from '../types';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const SALE_OPTIONS: { value: GstItem['treatment']; label: string }[] = [
  { value: 'standard', label: 'GST-inclusive (15%)' },
  { value: 'zero', label: 'Zero-rated (0%)' },
  { value: 'exempt', label: 'No GST (exempt or private)' },
];
const PURCHASE_OPTIONS: { value: GstItem['treatment']; label: string }[] = [
  { value: 'standard', label: 'GST-inclusive: claim it' },
  { value: 'exempt', label: 'No GST to claim' },
];

function ItemTable({ title, items, options, busy, onChange }: {
  title: string;
  items: GstItem[];
  options: { value: GstItem['treatment']; label: string }[];
  busy: boolean;
  onChange: (item: GstItem, treatment: GstItem['treatment']) => void;
}) {
  return (
    <section className="panel warranty-card gst-items" aria-labelledby={`gst-${title}`}>
      <div className="rental-card-head">
        <h3 id={`gst-${title}`}>{title}</h3>
        <span className="muted small">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="muted small">None in this period.</p>
      ) : (
        <div className="gst-table-wrap">
          <table className="gst-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">What</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col">GST</th>
                <th scope="col" className="num">GST content</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={`${i.kind}:${i.id}`}>
                  <td className="gst-date">{formatInvoiceDate(i.date)}</td>
                  <td>{i.description}</td>
                  <td className="num">{formatNzd(i.amountNzd)}</td>
                  <td>
                    {i.editable ? (
                      <select
                        aria-label={`GST for ${i.description} on ${formatInvoiceDate(i.date)}`}
                        value={i.treatment}
                        disabled={busy}
                        onChange={(e) => onChange(i, e.target.value as GstItem['treatment'])}
                      >
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="muted small">{i.treatment === 'standard' ? 'GST-inclusive, from the invoice' : 'No GST on the invoice: zero-rated'}</span>
                    )}
                  </td>
                  <td className="num">{i.gstNzd ? formatNzd(i.gstNzd) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function BusinessGst() {
  const { id = '' } = useParams<{ id: string }>();
  const [date, setDate] = useState<string | undefined>(undefined);
  const [data, setData] = useState<GstReturnView | null>(null);
  const [name, setName] = useState('');
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [frequency, setFrequency] = useState<GstFrequency>('two_monthly');
  const [endMonth, setEndMonth] = useState(3);

  useEffect(() => {
    let cancelled = false;
    api.business
      .gst(id, date)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setFrequency(d.settings.frequency);
        setEndMonth(d.settings.periodEndMonth);
        setLocked(false);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === BUSINESS_PLAN_REQUIRED) setLocked(true);
        else setError(errorText(e, 'Could not load the GST return.'));
      });
    return () => {
      cancelled = true;
    };
  }, [id, date, reload]);

  useEffect(() => {
    api.business
      .get(id)
      .then((d) => setName(d.business.name || 'Business'))
      .catch(() => setName(''));
  }, [id]);

  async function saveSettings() {
    setBusy(true);
    try {
      await api.business.setGstSettings(id, { frequency, periodEndMonth: endMonth });
      showQuietToast('GST periods saved.');
      setDate(undefined);
      setReload((n) => n + 1);
    } catch (e) {
      setError(errorText(e, 'Could not save the GST periods.'));
    } finally {
      setBusy(false);
    }
  }

  async function mark(item: GstItem, treatment: GstItem['treatment']) {
    if (!item.editable || (item.kind !== 'income' && item.kind !== 'transaction')) return;
    setBusy(true);
    try {
      await api.business.setGstItem(id, item.kind, item.id, treatment);
      setReload((n) => n + 1);
    } catch (e) {
      setError(errorText(e, 'Could not change that item.'));
    } finally {
      setBusy(false);
    }
  }

  async function copy(n: number) {
    const text = n.toFixed(2);
    try {
      await navigator.clipboard.writeText(text);
      showQuietToast(`Copied ${text}`);
    } catch {
      showQuietToast(`Copy ${text} by hand: the clipboard isn't available here.`, { kind: 'warn' });
    }
  }

  const b = data?.boxes;
  const settingsChanged = data != null && (frequency !== data.settings.frequency || endMonth !== data.settings.periodEndMonth);
  const backTo = `/business/${encodeURIComponent(id)}`;

  return (
    <div className="stack bills-page warranties-page rentals-page business-page gst-page">
      <BusinessTabs />
      <header className="business-detail-header">
        <Link className="warranties-back" to={backTo}>
          ‹ {name || 'Business'}
        </Link>
        <div className="business-detail-row">
          <div className="business-detail-name">
            <h2 className="page-title">GST return</h2>
            {data ? (
              <p className="muted small">
                {formatInvoiceDate(data.period.start)} to {formatInvoiceDate(data.period.end)} · due {formatInvoiceDate(data.dueDate)} · payments basis
              </p>
            ) : null}
          </div>
        </div>
        {data && data.registered ? (
          <nav className="budget-month-switch" aria-label="GST period">
            <button type="button" className="budget-month-step" aria-label="Previous period" onClick={() => setDate(shiftPeriod(data.period, data.settings, -1).start)}>
              ‹
            </button>
            <span className="budget-month-label" aria-live="polite">
              {formatInvoiceDate(data.period.start)} – {formatInvoiceDate(data.period.end)}
            </span>
            <button type="button" className="budget-month-step" aria-label="Next period" onClick={() => setDate(shiftPeriod(data.period, data.settings, 1).start)}>
              ›
            </button>
          </nav>
        ) : null}
      </header>

      {locked ? <BusinessPlanNote /> : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {!data && !locked && !error ? <p className="muted">Loading…</p> : null}

      {data && !data.registered ? (
        <section className="panel warranties-empty">
          <h3>Not registered for GST</h3>
          <p>
            Turn on “GST registered” and add the GST number in <Link to={backTo}>this business’s details</Link> to see its returns.
          </p>
        </section>
      ) : null}

      {data && data.registered && b ? (
        <>
          <section className="panel gst-estimate" role="note">
            <p>
              <strong>An estimate to check, not a filed return.</strong> Worked out on the payments basis from the money tagged to this business. Adjustments
              (boxes 9 and 13, such as private use) aren’t worked out. Check each figure in myIR before you file. <a href={IRD_GST_URL} target="_blank" rel="noreferrer noopener">GST on ird.govt.nz ↗</a>
            </p>
          </section>

          <section className="panel rental-summary business-summary" aria-label="GST for the period">
            <dl className="rental-totals business-totals business-totals--three">
              <div>
                <dt>GST on sales</dt>
                <dd>{formatNzd(b.box10)}</dd>
              </div>
              <div>
                <dt>GST on expenses</dt>
                <dd>{formatNzd(b.box14)}</dd>
              </div>
              <div>
                <dt>{b.box15 >= 0 ? 'To pay' : 'Refund'}</dt>
                <dd className={b.box15 > 0 ? 'gst-to-pay' : undefined}>{formatNzd(Math.abs(b.box15))}</dd>
              </div>
            </dl>
          </section>

          <section className="panel warranty-card" aria-labelledby="gst-boxes-title">
            <div className="rental-card-head">
              <h3 id="gst-boxes-title">GST101A, to copy into myIR</h3>
            </div>
            <table className="gst-boxes">
              <thead className="sr-only">
                <tr>
                  <th scope="col">Box</th>
                  <th scope="col">What it is</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Copy</th>
                </tr>
              </thead>
              <tbody>
                {GST101A_BOXES.map((row) => (
                  <tr key={row.box} className={row.number === 10 || row.number === 14 || row.number === 15 ? 'gst-box-total' : undefined}>
                    <th scope="row" className="gst-box-num">
                      {row.number}
                    </th>
                    <td>{row.label}</td>
                    <td className="num">{formatNzd(b[row.box])}</td>
                    <td>
                      <button type="button" className="btn small ghost" aria-label={`Copy box ${row.number}`} onClick={() => void copy(b[row.box])}>
                        Copy
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">
              Box 15 is {b.box15 >= 0 ? 'GST to pay' : 'a refund'}. In myIR the boxes may be shown in a different order; match them by number.
            </p>
          </section>

          <div className="pnl-columns">
            <ItemTable title="Sales and income" items={data.items.filter((i) => i.side === 'sale')} options={SALE_OPTIONS} busy={busy} onChange={(i, t) => void mark(i, t)} />
            <ItemTable title="Purchases and expenses" items={data.items.filter((i) => i.side === 'purchase')} options={PURCHASE_OPTIONS} busy={busy} onChange={(i, t) => void mark(i, t)} />
          </div>
          <p className="muted small">
            Sales count as GST-inclusive unless you mark them otherwise. An expense only counts once you mark it GST-inclusive, because a claim needs a tax
            invoice from the supplier.
          </p>

          <section className="panel warranty-card gst-settings" aria-labelledby="gst-settings-title">
            <h3 id="gst-settings-title">Return periods</h3>
            <p className="muted small">Use the filing frequency and period end on your GST registration in myIR.</p>
            <div className="form-grid warranty-form">
              <label>
                How often you file
                <select value={frequency} onChange={(e) => setFrequency(e.target.value as GstFrequency)}>
                  {GST_FREQUENCIES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              {frequency !== 'monthly' ? (
                <label>
                  A period ends in
                  <select value={endMonth} onChange={(e) => setEndMonth(Number(e.target.value))}>
                    {MONTH_NAMES.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="row gap">
              <button type="button" className="btn primary" disabled={busy || !settingsChanged} onClick={() => void saveSettings()}>
                Save periods
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
