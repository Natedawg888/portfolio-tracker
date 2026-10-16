/**
 * Portfolio → Vehicles tab (KAN-65): each vehicle's recorded value, loan and equity, with the
 * total the Overview row shows. Adding and editing happen on the Vehicles page.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatNzd } from '../../api/client';
import type { VehiclesView } from '../../types';
import { ClassHeading } from './ClassHeading';
import { InfoTip } from '../InfoTip';

export function VehiclesPanel({ total }: { total: number | null }) {
  const [view, setView] = useState<VehiclesView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.vehicles
      .list()
      .then((v) => live && setView(v))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not load vehicles.'));
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="panel">
      <ClassHeading
        title="Vehicles"
        total={total}
        info={
          <InfoTip label="About vehicle values">
            The value you record for each vehicle, minus any loan you entered on it. A loan linked to a bank loan account is already in your
            cash liabilities. Nothing is estimated.
          </InfoTip>
        }
      >
        <Link className="btn small" to="/vehicles">
          Manage vehicles
        </Link>
      </ClassHeading>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {!view && !error ? <p className="muted">Loading…</p> : null}
      {view && !view.vehicles.length ? (
        <p className="muted">
          No vehicles yet. <Link to="/vehicles">Add a vehicle</Link>.
        </p>
      ) : null}
      {view?.vehicles.length ? (
        <ul className="hh-rows">
          {view.vehicles.map((v) => (
            <li key={v.id} className="hh-row-wrap">
              <span>
                {v.name}
                <span className="muted small">
                  {' '}
                  · {[v.year, v.make, v.model].filter(Boolean).join(' ') || v.kind}
                  {v.loanOwedNzd ? ` · loan ${formatNzd(v.loanOwedNzd)}` : ''}
                  {v.countInNetWorth ? '' : ' · not in net worth'}
                </span>
              </span>
              <span className="money">{v.equityNzd != null ? formatNzd(v.equityNzd) : '—'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
