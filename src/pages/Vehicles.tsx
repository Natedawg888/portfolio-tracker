/**
 * Vehicles (KAN-65), under Budget. Each vehicle's recorded value, any loan, equity, and what it
 * costs to run and own. Vehicles set to count add to net worth (value minus loans entered here;
 * loans linked to a bank loan account are already counted there). Amounts follow Hide amounts.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatNzd } from '../api/client';
import type { Vehicle, VehicleWriteBody, VehiclesView } from '../types';
import { useMoneyHidden } from '../lib/privacy';
import { longDate } from './warrantiesView';
import { VehicleForm } from '../components/vehicles/VehicleForm';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** "Valued 14 months ago" when a value is older than a year. */
function staleNote(valuedOn: string | null): string | null {
  if (!valuedOn) return null;
  const months = Math.floor((Date.now() - Date.parse(`${valuedOn}T00:00:00`)) / (30.44 * 86_400_000));
  return months >= 12 ? `Valued ${months} months ago. Worth checking what it’s worth now.` : null;
}

function VehicleCard({ v, onEdit, onDelete }: { v: Vehicle; onEdit: () => void; onDelete: () => void }) {
  const desc = [v.year, v.make, v.model].filter(Boolean).join(' ');
  const stale = staleNote(v.valuedOn);
  return (
    <article className="payslip-card vehicle-card">
      <div className="payslip-card-top">
        <div>
          <h4>{v.name}</h4>
          <p className="muted small">
            {[desc, v.plate].filter(Boolean).join(' · ') || 'No details yet'}
          </p>
        </div>
        <span className={'payslip-badge' + (v.countInNetWorth && v.valueNzd != null ? ' payslip-badge-ok' : '')}>
          {v.countInNetWorth ? (v.valueNzd != null ? 'In net worth' : 'No value yet') : 'Not in net worth'}
        </span>
      </div>
      <dl className="payslip-figs">
        <div>
          <dt>Value</dt>
          <dd className="money">{v.valueNzd != null ? formatNzd(v.valueNzd) : '—'}</dd>
        </div>
        <div>
          <dt>Loan</dt>
          <dd className="money">{v.loanOwedNzd != null ? formatNzd(v.loanOwedNzd) : '—'}</dd>
        </div>
        <div>
          <dt>Equity</dt>
          <dd className="money">{v.equityNzd != null ? formatNzd(v.equityNzd) : '—'}</dd>
        </div>
      </dl>
      {v.valuedOn ? <p className="small muted">Valued {longDate(v.valuedOn)}{v.purchasePriceNzd != null ? ` · paid ${formatNzd(v.purchasePriceNzd)}${v.purchaseDate ? ` on ${longDate(v.purchaseDate)}` : ''}` : ''}.</p> : null}
      {stale ? <p className="small hh-over">{stale}</p> : null}
      {v.loan.kind === 'account' && v.loanAccountName ? <p className="small muted">Loan: your {v.loanAccountName} account, already counted in net worth.</p> : null}
      {v.loan.kind !== 'none' && (v.loan.lender || v.loan.ratePct != null) ? (
        <p className="small muted">
          {[v.loan.lender, v.loan.ratePct != null ? `${v.loan.ratePct}% interest` : null].filter(Boolean).join(' · ')}
        </p>
      ) : null}
      {v.costToOwn.total.year > 0 ? (
        <div className="vehicle-costs">
          <p className="small">
            <strong>{formatNzd(v.costToOwn.total.month)} a month</strong> to own ({formatNzd(v.costToOwn.total.week)} a week)
            {v.costToOwn.loan.year > 0 ? `: ${formatNzd(v.costToOwn.running.month)} running costs + ${formatNzd(v.costToOwn.loan.month)} loan` : ''}.
          </p>
          {v.costToOwn.byKind.length ? (
            <ul className="vehicle-cost-list small">
              {v.costToOwn.byKind.map((c, i) => (
                <li key={`${c.kind}-${i}`}>
                  <span>{c.label}</span>
                  <span className="money">{formatNzd(c.year)} a year</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="small muted">No running costs added.</p>
      )}
      <div className="payslip-actions">
        <button type="button" className="link-btn" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="link-btn" onClick={onDelete}>
          Delete
        </button>
      </div>
    </article>
  );
}

export function Vehicles() {
  useMoneyHidden();
  const [view, setView] = useState<VehiclesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ vehicle: Vehicle | null } | null>(null);

  const load = useCallback(() => {
    api.vehicles
      .list()
      .then(setView)
      .catch((e: unknown) => setError(errText(e, 'Could not load vehicles.')));
  }, []);
  useEffect(load, [load]);

  async function save(body: VehicleWriteBody) {
    const existing = dialog?.vehicle ?? null;
    if (existing) await api.vehicles.update(existing.id, body);
    else await api.vehicles.create(body);
    setDialog(null);
    setMsg(existing ? `${body.name} updated.` : `${body.name} added.`);
    load();
  }

  async function remove(v: Vehicle) {
    if (!window.confirm(`Delete ${v.name}? It comes out of your net worth.${v.loan.kind === 'account' ? ' Your bank loan account stays.' : ''}`)) return;
    try {
      await api.vehicles.remove(v.id);
      setMsg(`${v.name} deleted.`);
      load();
    } catch (e) {
      setError(errText(e, 'Could not delete the vehicle.'));
    }
  }

  const t = view?.totals;
  return (
    <div className="stack bills-page vehicles-page">
      <header className="warranties-header">
        <div>
          <Link className="warranties-back" to="/spending">
            ‹ Budget
          </Link>
          <h2 className="page-title">Vehicles</h2>
          <p className="muted small">What your vehicles are worth, what you owe on them, and what they cost to run.</p>
        </div>
        <div className="warranties-header-actions">
          <button type="button" className="btn small primary" disabled={!view} onClick={() => setDialog({ vehicle: null })}>
            + Add vehicle
          </button>
        </div>
      </header>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
      {msg ? <p className="banner">{msg}</p> : null}
      {!view && !error ? <p className="muted">Loading vehicles…</p> : null}

      {view && t && t.count ? (
        <section className="panel" aria-labelledby="vehicles-total-title">
          <h3 id="vehicles-total-title">All vehicles</h3>
          <dl className="hh-pay-figures">
            <div>
              <dt>Value in net worth</dt>
              <dd className="money">{formatNzd(t.valueNzd)}</dd>
            </div>
            <div>
              <dt>Owed on them</dt>
              <dd className="money">{formatNzd(t.loansNzd)}</dd>
            </div>
            <div className="hh-pay-net">
              <dt>Equity</dt>
              <dd className="money">{formatNzd(t.equityNzd)}</dd>
            </div>
            <div>
              <dt>Running costs</dt>
              <dd className="money">{formatNzd(t.runningPerMonthNzd)} a month</dd>
            </div>
            <div>
              <dt>Cost to own (with loans)</dt>
              <dd className="money">{formatNzd(t.costToOwnPerMonthNzd)} a month</dd>
            </div>
          </dl>
          <p className="muted small">Values are what you record; nothing is estimated. Cars usually lose value, so update them now and then.</p>
        </section>
      ) : null}

      {view && !view.vehicles.length ? (
        <section className="panel">
          <h3>No vehicles yet</h3>
          <p className="muted small">Add your car, ute, bike or boat to see it in your net worth, with any loan on it, and what it costs to run.</p>
          <button type="button" className="btn primary" onClick={() => setDialog({ vehicle: null })}>
            Add a vehicle
          </button>
        </section>
      ) : null}

      {view?.vehicles.length ? (
        <section className="payslip-list" aria-label="Your vehicles">
          {view.vehicles.map((v) => (
            <VehicleCard key={v.id} v={v} onEdit={() => setDialog({ vehicle: v })} onDelete={() => void remove(v)} />
          ))}
        </section>
      ) : null}

      {dialog && view ? <VehicleForm view={view} vehicle={dialog.vehicle} onClose={() => setDialog(null)} onSave={save} /> : null}
    </div>
  );
}
