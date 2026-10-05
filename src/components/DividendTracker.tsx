/**
 * Dividend dashboard and entry on the Portfolio page.
 * Totals are calculated from the signed-in user's rows. Empty when they have none.
 * Paid net NZD is also mirrored into Budgeting income for that user.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, formatMoney, formatNzd } from '../api/client';
import { todayAucklandYmd } from '../lib/period';
import type { DetectedDividend, DividendDashboard, DividendEvent, DividendWriteBody } from '../types/dividends';

type Placement = 'portfolio' | 'budget';

const emptyForm = {
  holdingId: '',
  sharesHeld: '',
  dividendPerShare: '',
  taxWithholding: '',
  imputationCredits: '',
  paymentDate: '',
  currency: 'NZD',
  fxRateToNzd: '',
  reinvested: false,
  reinvestedAmount: '',
  notes: '',
};

function formatPct(value: number | null, signed = false): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const text = value.toLocaleString('en-NZ', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  if (signed && value > 0) return `+${text}%`;
  return `${text}%`;
}

function moneyOrDash(value: number | null, currency = 'NZD'): string {
  if (value == null) return '—';
  return currency === 'NZD' ? formatNzd(value) : formatMoney(value, currency);
}

/** Published per-share cash amounts can be smaller than one cent. Keep those digits. */
function formatPerShare(value: number, currency: string): string {
  const code = (currency || 'NZD').trim().toUpperCase() || 'NZD';
  const trimmed = Number(value.toFixed(6)).toString();
  const places = trimmed.includes('.') ? trimmed.split('.')[1]!.length : 0;
  const maximumFractionDigits = Math.max(2, Math.min(6, places));
  try {
    return new Intl.NumberFormat('en-NZ', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits,
    }).format(value);
  } catch {
    return `${trimmed} ${code}`;
  }
}

function cadencePhrase(months: number | null): string {
  if (months === 1) return 'a monthly gap';
  if (months === 3) return 'a quarterly gap';
  if (months === 6) return 'a twice-yearly gap';
  if (months === 12) return 'a yearly gap';
  return 'the published dates';
}

export function DividendTracker({ placement }: { placement: Placement }) {
  const [year, setYear] = useState(() => Number(todayAucklandYmd().slice(0, 4)));
  const [data, setData] = useState<DividendDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const requestRef = useRef(0);

  const load = useCallback(() => {
    const ticket = ++requestRef.current;
    return api.dividends
      .dashboard(year)
      .then((payload) => {
        if (ticket !== requestRef.current) return;
        setData(payload);
        setError(null);
      })
      .catch((err: Error) => {
        if (ticket !== requestRef.current) return;
        setError(err.message);
      })
      .finally(() => {
        if (ticket === requestRef.current) setLoading(false);
      });
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  function changeYear(next: number) {
    setLoading(true);
    setYear(next);
  }

  const preview = useMemo(() => {
    const shares = Number(form.sharesHeld);
    const perShare = Number(form.dividendPerShare);
    const tax = form.taxWithholding.trim() === '' ? 0 : Number(form.taxWithholding);
    if (!Number.isFinite(shares) || !Number.isFinite(perShare) || !Number.isFinite(tax)) return null;
    const gross = shares * perShare;
    return { gross, net: gross - tax };
  }, [form.dividendPerShare, form.sharesHeld, form.taxWithholding]);

  function resetForm() {
    setForm({ ...emptyForm, paymentDate: todayAucklandYmd() });
    setEditingId(null);
    setFormError(null);
  }

  function openCreate() {
    resetForm();
    setShowForm(true);
  }

  function openEdit(event: DividendEvent) {
    setEditingId(event.id);
    setForm({
      holdingId: event.holdingId ?? '',
      sharesHeld: String(event.sharesHeld),
      dividendPerShare: String(event.dividendPerShare),
      taxWithholding: String(event.taxWithholding),
      imputationCredits: String(event.imputationCredits),
      paymentDate: event.paymentDate,
      currency: event.currency,
      fxRateToNzd: event.currency === 'NZD' || event.fxRateToNzd == null ? '' : String(event.fxRateToNzd),
      reinvested: event.reinvested,
      reinvestedAmount: event.reinvestedAmount == null ? '' : String(event.reinvestedAmount),
      notes: event.notes ?? '',
    });
    setFormError(null);
    setShowForm(true);
  }

  function onHoldingChange(holdingId: string) {
    const holding = data?.holdings.find((item) => item.id === holdingId);
    setForm((prev) => ({
      ...prev,
      holdingId,
      sharesHeld: holding?.shares != null ? String(holding.shares) : prev.sharesHeld,
    }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const sharesHeld = Number(form.sharesHeld);
    const dividendPerShare = Number(form.dividendPerShare);
    const taxWithholding = form.taxWithholding.trim() === '' ? 0 : Number(form.taxWithholding);
    const imputationCredits = form.imputationCredits.trim() === '' ? 0 : Number(form.imputationCredits);
    const currency = form.currency.trim().toUpperCase() || 'NZD';
    const body: DividendWriteBody = {
      holdingId: form.holdingId,
      sharesHeld,
      dividendPerShare,
      taxWithholding,
      imputationCredits,
      paymentDate: form.paymentDate,
      currency,
      fxRateToNzd: currency === 'NZD' || form.fxRateToNzd.trim() === '' ? null : Number(form.fxRateToNzd),
      reinvested: form.reinvested,
      reinvestedAmount: form.reinvested ? Number(form.reinvestedAmount) : null,
      notes: form.notes.trim() || null,
    };
    setSaving(true);
    try {
      if (editingId) await api.dividends.update(editingId, body);
      else await api.dividends.create(body);
      resetForm();
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(event: DividendEvent) {
    const label = event.symbol ? `${event.symbol} · ${event.companyName}` : event.companyName;
    if (!window.confirm(`Delete the ${event.paymentDate} dividend for ${label}?`)) return;
    setFormError(null);
    try {
      await api.dividends.remove(event.id);
      if (editingId === event.id) {
        resetForm();
        setShowForm(false);
      }
      await load();
    } catch (err) {
      setFormError((err as Error).message);
    }
  }

  if (error && !data) {
    return (
      <section className="panel warn">
        <h3>Dividends</h3>
        <p>{error}</p>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="panel">
        <h3>Dividends</h3>
        <p className="muted">{loading ? 'Loading dividends…' : 'No dividend data.'}</p>
      </section>
    );
  }

  const lead = placement === 'portfolio'
    ? 'Dividends on the stocks and ETFs in this portfolio.'
    : 'Dividend income from your holdings, in NZD when you record an FX rate.';
  const yearHasTotal = data.yearPaidCount > 0 && data.yearIncomeNzd != null;

  return (
    <div className="stack" aria-label="Dividends">
      <section className="hero-card">
        {error ? <p className="banner">{error}</p> : null}
        <p className="eyebrow">{data.year} dividend income</p>
        {yearHasTotal ? (
          <p className="hero-value">{formatNzd(data.yearIncomeNzd)}</p>
        ) : (
          <p className="page-lead">
            {data.yearPaidCount === 0
              ? `No dividend income recorded for ${data.year}.`
              : `Payments are recorded for ${data.year}, but an FX rate to NZD is still needed before they can be totalled.`}
          </p>
        )}
        <p className="muted small">
          {lead} Paid rows only. {data.disclaimer}
        </p>
        {data.yearUnconvertedCount > 0 ? (
          <p className="muted small">
            {data.yearUnconvertedCount} paid {data.yearUnconvertedCount === 1 ? 'row is' : 'rows are'} left out of the NZD total until you record an FX rate.
          </p>
        ) : null}
        <div className="period-pager" role="navigation" aria-label="Dividend year">
          <button type="button" className="btn" disabled={year <= 1980} onClick={() => changeYear(year - 1)} aria-label="Previous year">
            {'<- Prev'}
          </button>
          <div className="period-pager-label">
            <strong>{data.year}</strong>
          </div>
          <button type="button" className="btn" disabled={year >= 2100} onClick={() => changeYear(year + 1)} aria-label="Next year">
            {'Next ->'}
          </button>
        </div>
      </section>

      {data.hasEvents ? (
        <section className="grid cards spending-summary-cards" aria-label="Dividend summary">
          <div className="card">
            <p className="eyebrow">Monthly dividends</p>
            <p className="stat-value">
              {data.month && data.month.paidCount > 0 && data.month.netNzd != null
                ? formatNzd(data.month.netNzd)
                : '—'}
            </p>
            <p className="muted small">
              {data.month ? data.month.label : 'No paid month in this year'}
              {data.month && data.month.unconvertedCount > 0 ? ' · FX rate needed' : ''}
            </p>
          </div>
          <div className="card">
            <p className="eyebrow">Annual dividends</p>
            <p className="stat-value">{yearHasTotal ? formatNzd(data.yearIncomeNzd) : '—'}</p>
            <p className="muted small">{data.year} · recorded net in NZD</p>
          </div>
          <div className="card">
            <p className="eyebrow">Dividend growth</p>
            <p className="stat-value">{data.growth.available ? formatPct(data.growth.changePct, true) : '—'}</p>
            <p className="muted small">{data.growth.note}</p>
          </div>
          <div className="card">
            <p className="eyebrow">Dividend yield</p>
            <p className="stat-value">{data.yield.available ? formatPct(data.yield.yieldPct) : '—'}</p>
            <p className="muted small">{data.yield.note}</p>
          </div>
        </section>
      ) : null}

      {data.hasEvents ? (
        <section className="panel">
          <h3>Monthly dividends · {data.year}</h3>
          <div className="grid cards spending-summary-cards" aria-label={`Monthly dividends ${data.year}`}>
            {data.months.map((month) => (
              <div className="card" key={month.yearMonth}>
                <p className="eyebrow">{month.label}</p>
                <p className="stat-value">
                  {month.paidCount === 0 || month.netNzd == null ? '—' : formatNzd(month.netNzd)}
                </p>
                <p className="muted small">
                  {month.paidCount === 0
                    ? 'No payment recorded'
                    : month.netNzd == null
                      ? 'FX rate needed'
                      : `${month.paidCount} payment${month.paidCount === 1 ? '' : 's'}`}
                </p>
              </div>
            ))}
          </div>
          {data.annual.length > 0 ? (
            <>
              <h4 className="section-subtitle">Annual dividends</h4>
              <div className="grid cards spending-summary-cards" aria-label="Annual dividends">
                {data.annual.map((item) => (
                  <div className="card" key={item.year}>
                    <p className="eyebrow">{item.year}</p>
                    <p className="stat-value">{item.netNzd == null ? '—' : formatNzd(item.netNzd)}</p>
                    <p className="muted small">
                      {item.paidCount} paid
                      {item.unconvertedCount > 0 ? ` · ${item.unconvertedCount} without FX` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="panel">
        <h3>Dividend forecast</h3>
        <p className="section-desc">{data.forecast.heading}. {data.forecast.note}</p>
        {data.forecast.historyRunRateNzd == null
          && data.forecast.statedUpcomingNzd == null
          && data.forecast.detectedCount === 0 ? (
          <p className="muted">
            No projection yet. Record a past payment, enter an upcoming payment, or hold a stock or ETF whose published dividend history includes a real amount. Nothing is filled in without that figure.
          </p>
        ) : (
          <>
            <div className="grid cards budget-compare-summary">
              <div className="card">
                <p className="eyebrow">From your history</p>
                <p className="stat-value">
                  {data.forecast.historyRunRateNzd == null ? '—' : formatNzd(data.forecast.historyRunRateNzd)}
                </p>
                <p className="muted small">
                  {data.forecast.historyCount > 0
                    ? `Repeats ${data.forecast.historyCount} recorded payment${data.forecast.historyCount === 1 ? '' : 's'} since ${data.forecast.historyWindowStart}. Not a market forecast.`
                    : 'No paid dividends with an NZD amount in the last 12 months.'}
                </p>
              </div>
              <div className="card">
                <p className="eyebrow">Stated upcoming</p>
                <p className="stat-value">
                  {data.forecast.statedUpcomingNzd == null ? '—' : formatNzd(data.forecast.statedUpcomingNzd)}
                </p>
                <p className="muted small">
                  {data.forecast.statedUpcomingCount === 0
                    ? 'No upcoming payments entered.'
                    : `${data.forecast.statedUpcomingCount} payment${data.forecast.statedUpcomingCount === 1 ? '' : 's'} you entered`}
                  {data.forecast.statedUnconvertedCount > 0
                    ? ` · ${data.forecast.statedUnconvertedCount} without an FX rate`
                    : ''}
                  . Not a market forecast.
                </p>
              </div>
              <div className="card">
                <p className="eyebrow">From published history</p>
                <p className="stat-value">
                  {data.forecast.detectedNzd == null ? '—' : formatNzd(data.forecast.detectedNzd)}
                </p>
                <p className="muted small">
                  {data.forecast.detectedCount === 0
                    ? 'No stock or ETF you hold has a published dividend to project.'
                    : `${data.forecast.detectedCount} next payment${data.forecast.detectedCount === 1 ? '' : 's'} from published dividend history`}
                  {data.forecast.detectedUnconvertedCount > 0
                    ? ` · ${data.forecast.detectedUnconvertedCount} without an FX rate`
                    : ''}
                  . Not a market forecast.
                </p>
              </div>
            </div>
            {data.forecast.detected.length > 0 ? (
              <DetectedDividendTable rows={data.forecast.detected} />
            ) : null}
          </>
        )}
      </section>

      <section className="panel">
        <h3>Upcoming dividends</h3>
        {data.upcoming.length === 0 ? (
          <p className="muted">No upcoming dividends. A future payment date is one you enter yourself.</p>
        ) : (
          <DividendTable rows={data.upcoming} onEdit={openEdit} onDelete={onDelete} />
        )}
      </section>

      <section className="panel">
        <h3>Dividend history</h3>
        {data.history.length === 0 ? (
          <p className="muted">No paid dividends recorded yet.</p>
        ) : (
          <DividendTable rows={data.history} onEdit={openEdit} onDelete={onDelete} />
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h3>{editingId ? 'Edit dividend' : 'Record a dividend'}</h3>
          <button type="button" className="btn primary" onClick={() => (showForm ? setShowForm(false) : openCreate())}>
            {showForm ? 'Hide form' : '+ Record dividend'}
          </button>
        </div>
        <p className="section-desc">
          Tied to a stock or ETF you already hold. Gross is shares times dividend per share. Net cash is gross minus tax or withholding. NZ imputation credits are recorded beside that and are not subtracted. Reinvestment is noted here and does not change the share count. This is a personal record, not advice.
        </p>
        {formError ? <p className="banner">{formError}</p> : null}
        {data.holdings.length === 0 ? (
          <p className="muted">Add a stock or ETF on the Portfolio page before recording a dividend.</p>
        ) : null}
        {showForm && data.holdings.length > 0 ? (
          <form className="form-grid" onSubmit={onSubmit}>
            <label className="span-2">
              Company or ETF
              <select value={form.holdingId} onChange={(e) => onHoldingChange(e.target.value)} required>
                <option value="">Select a holding…</option>
                {data.holdings.map((holding) => (
                  <option key={holding.id} value={holding.id}>
                    {holding.symbol ? `${holding.symbol} · ` : ''}
                    {holding.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Shares held
              <input
                type="number"
                step="any"
                min="0"
                value={form.sharesHeld}
                onChange={(e) => setForm({ ...form, sharesHeld: e.target.value })}
                required
              />
            </label>
            <label>
              Dividend per share
              <input
                type="number"
                step="any"
                min="0"
                value={form.dividendPerShare}
                onChange={(e) => setForm({ ...form, dividendPerShare: e.target.value })}
                required
              />
            </label>
            <label>
              Tax / withholding
              <input
                type="number"
                step="any"
                min="0"
                value={form.taxWithholding}
                onChange={(e) => setForm({ ...form, taxWithholding: e.target.value })}
                placeholder="0"
              />
            </label>
            <label>
              Imputation credits (NZ)
              <input
                type="number"
                step="any"
                min="0"
                value={form.imputationCredits}
                onChange={(e) => setForm({ ...form, imputationCredits: e.target.value })}
                placeholder="0"
              />
            </label>
            <label>
              Payment date
              <input
                type="date"
                value={form.paymentDate}
                onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
                required
              />
            </label>
            <label>
              Currency
              <input
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                maxLength={3}
                required
              />
            </label>
            {form.currency.trim().toUpperCase() !== 'NZD' ? (
              <label>
                FX rate to NZD
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={form.fxRateToNzd}
                  onChange={(e) => setForm({ ...form, fxRateToNzd: e.target.value })}
                  placeholder="Leave blank if you do not have a rate"
                />
              </label>
            ) : (
              <p className="muted small">NZD payments use a rate of 1.</p>
            )}
            <label>
              Reinvested
              <select
                value={form.reinvested ? 'yes' : 'no'}
                onChange={(e) => setForm({ ...form, reinvested: e.target.value === 'yes' })}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </label>
            {form.reinvested ? (
              <label>
                Amount reinvested
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={form.reinvestedAmount}
                  onChange={(e) => setForm({ ...form, reinvestedAmount: e.target.value })}
                  required
                />
              </label>
            ) : null}
            <label className="span-2">
              Notes (optional)
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                maxLength={500}
              />
            </label>
            {preview ? (
              <p className="muted small span-2">
                Gross {moneyOrDash(preview.gross, form.currency || 'NZD')} · Net {moneyOrDash(preview.net, form.currency || 'NZD')}
                {form.currency.trim().toUpperCase() === 'NZD' ? '' : ' in the payment currency'}
                . Imputation credits are not part of net cash.
              </p>
            ) : null}
            <div className="span-2 row gap">
              <button type="submit" className="btn primary" disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Save dividend' : 'Record dividend'}
              </button>
              {editingId ? (
                <button type="button" className="btn" onClick={() => { resetForm(); setShowForm(false); }}>
                  Cancel edit
                </button>
              ) : null}
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}

function DetectedDividendTable({ rows }: { rows: DetectedDividend[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Next date</th>
            <th>Holding</th>
            <th>Per share</th>
            <th>Shares</th>
            <th>Cash amount</th>
            <th>NZD</th>
            <th>Where this comes from</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.holdingId}>
              <td className="muted small">{row.paymentDate}</td>
              <td>
                {row.symbol} · {row.name}
              </td>
              <td className="money">{formatPerShare(row.dividendPerShare, row.currency)}</td>
              <td className="money">{row.sharesHeld}</td>
              <td className="money">{moneyOrDash(row.amount, row.currency)}</td>
              <td className="amt-in money">{row.amountNzd == null ? '—' : formatNzd(row.amountNzd)}</td>
              <td className="muted small">
                {row.basis === 'published'
                  ? `Yahoo Finance published this date and this cash amount (${row.historyCount} published dividend${row.historyCount === 1 ? '' : 's'} on file).`
                  : `Projected by repeating ${cadencePhrase(row.intervalMonths)} across ${row.historyCount} published dividends. Last cash dividend ${formatPerShare(row.dividendPerShare, row.currency)} on ${row.lastPaidDate}.`}
                {' '}Tax is not estimated. Not a market forecast.
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DividendTable({
  rows,
  onEdit,
  onDelete,
}: {
  rows: DividendEvent[];
  onEdit: (event: DividendEvent) => void;
  onDelete: (event: DividendEvent) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Payment date</th>
            <th>Company or ETF</th>
            <th>Shares</th>
            <th>Per share</th>
            <th>Gross</th>
            <th>Tax</th>
            <th>Imputation</th>
            <th>Net</th>
            <th>FX to NZD</th>
            <th>Net NZD</th>
            <th>Reinvested</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="muted small">{row.paymentDate}</td>
              <td>
                {row.symbol ? `${row.symbol} · ` : ''}
                {row.companyName}
              </td>
              <td className="money">{row.sharesHeld}</td>
              <td className="money">{moneyOrDash(row.dividendPerShare, row.currency)}</td>
              <td className="money">{moneyOrDash(row.grossDividend, row.currency)}</td>
              <td className="money">{moneyOrDash(row.taxWithholding, row.currency)}</td>
              <td className="money">{moneyOrDash(row.imputationCredits, row.currency)}</td>
              <td className="money">{moneyOrDash(row.netDividend, row.currency)}</td>
              <td className="muted small">{row.fxRateToNzd == null ? '—' : row.fxRateToNzd}</td>
              <td className="amt-in money">{row.netNzd == null ? '—' : formatNzd(row.netNzd)}</td>
              <td className="muted small">
                {row.reinvested
                  ? `Yes${row.reinvestedAmount != null ? ` · ${moneyOrDash(row.reinvestedAmount, row.currency)}` : ''}`
                  : 'No'}
              </td>
              <td>
                <div className="row gap" style={{ marginTop: 0 }}>
                  <button type="button" className="btn small" onClick={() => onEdit(row)}>
                    Edit
                  </button>
                  <button type="button" className="btn small danger" onClick={() => onDelete(row)}>
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
