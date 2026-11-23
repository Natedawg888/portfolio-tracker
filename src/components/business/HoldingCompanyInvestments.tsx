/**
 * Holding company investments (KAN-134): each asset class it holds with its NZD value and number
 * of holdings, from real Portfolio values only. Compact on the Business overview card; on the
 * business page the owner can assign holdings from Portfolio.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, formatNzd } from '../../api/client';
import type { BusinessAssetClassRow, BusinessHoldingOption } from '../../types';
import {
  HOLDING_COMPANY_EMPTY,
  HOLDING_COMPANY_NET_WORTH_NOTE,
  groupHoldingOptions,
  holdingClassCountText,
  holdingClassesTotal,
} from '../../lib/holdingCompanyView';
import { Dialog, errorText } from './BusinessUi';

function AssignHoldingsDialog({ businessId, name, onClose, onChanged }: { businessId: string; name: string; onClose: () => void; onChanged: () => void }) {
  const [options, setOptions] = useState<BusinessHoldingOption[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.business
      .holdingOptions(businessId)
      .then((o) => live && setOptions(o))
      .catch((e: unknown) => live && setError(errorText(e, 'Could not load your holdings.')));
    return () => {
      live = false;
    };
  }, [businessId]);

  async function toggle(o: BusinessHoldingOption, assigned: boolean) {
    setBusy(o.id);
    setError(null);
    try {
      await api.business.assignHolding(businessId, o.id, assigned);
      setOptions((prev) => prev?.map((x) => (x.id === o.id ? { ...x, assignedHere: assigned, assignedElsewhere: assigned ? false : x.assignedElsewhere } : x)) ?? null);
      onChanged();
    } catch (e) {
      setError(errorText(e, 'Could not save.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog title={`Holdings ${name} owns`} onClose={onClose}>
      <p className="muted small">Tick what the company owns. Values come from Portfolio, and each holding stays in your net worth once.</p>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {!options && !error ? <p className="muted">Loading…</p> : null}
      {options && !options.length ? <p className="muted small">No holdings in Portfolio yet. Add them there first.</p> : null}
      {options
        ? groupHoldingOptions(options).map((g) => (
            <fieldset key={g.classLabel} className="holding-company-group">
              <legend>{g.classLabel}</legend>
              {g.items.map((o) => (
                <label key={o.id} className="payslip-check">
                  <input type="checkbox" checked={o.assignedHere} disabled={busy != null} onChange={(e) => void toggle(o, e.target.checked)} />
                  <span>
                    {o.label}
                    {o.assignedElsewhere ? <span className="muted small"> · held by another business; ticking moves it here</span> : null}
                  </span>
                </label>
              ))}
            </fieldset>
          ))
        : null}
      <div className="row gap modal-actions">
        <button type="button" className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

export function HoldingCompanyInvestments({ businessId, name, compact = false, canAssign = false }: { businessId: string; name: string; compact?: boolean; canAssign?: boolean }) {
  const [rows, setRows] = useState<BusinessAssetClassRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(() => {
    api.business
      .assetClasses(businessId)
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e: unknown) => setError(errorText(e, 'Could not load the investments.')));
  }, [businessId]);
  useEffect(load, [load]);

  const body = (
    <>
      {error ? <p className="auth-error small" role="alert">{error}</p> : null}
      {!rows && !error ? <p className="muted small">Loading investments…</p> : null}
      {rows && !rows.length ? <p className="muted small">{HOLDING_COMPANY_EMPTY}</p> : null}
      {rows?.length ? (
        <>
          <ul className="holding-company-classes">
            {rows.map((r) => (
              <li key={r.key}>
                <span>
                  {r.label}
                  <span className="muted small"> · {holdingClassCountText(r)}</span>
                </span>
                <span className="money">{formatNzd(r.valueNzd)}</span>
              </li>
            ))}
          </ul>
          {!compact ? (
            <p className="small">
              <strong>Investments {formatNzd(holdingClassesTotal(rows))}</strong> <span className="muted">· {HOLDING_COMPANY_NET_WORTH_NOTE}</span>
            </p>
          ) : null}
        </>
      ) : null}
      {canAssign ? (
        <button type="button" className="btn small" onClick={() => setAssigning(true)}>
          Assign holdings
        </button>
      ) : null}
      {assigning ? <AssignHoldingsDialog businessId={businessId} name={name} onClose={() => setAssigning(false)} onChanged={load} /> : null}
    </>
  );

  if (compact) return <div className="holding-company-compact">{body}</div>;
  return (
    <section className="panel warranty-card" aria-labelledby={`hc-${businessId}`}>
      <div className="rental-card-head">
        <h3 id={`hc-${businessId}`}>Investments</h3>
      </div>
      {body}
    </section>
  );
}
