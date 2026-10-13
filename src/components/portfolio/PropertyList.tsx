/**
 * Property: one card per property with the address as entered, market value,
 * mortgage, equity (value − mortgage) and when it was last updated. "+ Add purchase
 * price" when there is no cost. Edit, Update value and Delete sit in the ⋯ menu and
 * save through the existing holding update. Nothing here is estimated.
 */
import { useId, useState, type FormEvent } from 'react';
import { formatNzd } from '../../api/client';
import { MoreMenu } from '../MoreMenu';
import { AddCostButton } from './AddCostButton';
import type { Holding } from '../../lib/holdingDisplay';
import { holdingDomId, propertyFigures } from '../../lib/portfolioView';

export type PropertyValuePatch = { propertyValueNzd: number; mortgageOutstandingNzd: number };
export type PropertyDetailsPatch = { name: string; notes: string; photoBase64?: string; clearPhoto?: boolean };

function updatedOn(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Could not read that photo.'));
    reader.readAsDataURL(file);
  });
}

function ValueForm({
  holding,
  onSave,
  onCancel,
}: {
  holding: Holding;
  onSave: (patch: PropertyValuePatch) => Promise<boolean>;
  onCancel: () => void;
}) {
  const ids = { value: useId(), mortgage: useId() };
  const fig = propertyFigures(holding);
  const [value, setValue] = useState(fig.valueNzd == null ? '' : String(fig.valueNzd));
  const [mortgage, setMortgage] = useState(String(fig.mortgageNzd));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = Number(value);
    const m = mortgage.trim() === '' ? 0 : Number(mortgage);
    if (!value.trim() || !Number.isFinite(v) || v < 0) return setError('Enter the market value in NZD.');
    if (!Number.isFinite(m) || m < 0) return setError('Mortgage must be 0 or more.');
    setBusy(true);
    setError(null);
    const ok = await onSave({ propertyValueNzd: v, mortgageOutstandingNzd: m });
    setBusy(false);
    if (ok) onCancel();
  }

  return (
    <form className="form-grid property-form" onSubmit={submit}>
      <label htmlFor={ids.value}>
        Market value (NZD)
        <input id={ids.value} type="number" step="any" min={0} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} required />
      </label>
      <label htmlFor={ids.mortgage}>
        Mortgage outstanding (NZD)
        <input id={ids.mortgage} type="number" step="any" min={0} inputMode="decimal" value={mortgage} onChange={(e) => setMortgage(e.target.value)} />
      </label>
      {error ? <p className="auth-error small span-2" role="alert">{error}</p> : null}
      <div className="row gap span-2">
        <button type="submit" className="btn small primary" disabled={busy}>
          Save value
        </button>
        <button type="button" className="btn small ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DetailsForm({
  holding,
  onSave,
  onCancel,
}: {
  holding: Holding;
  onSave: (patch: PropertyDetailsPatch) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(holding.name ?? '');
  const [notes, setNotes] = useState(holding.notes ?? '');
  const [photo, setPhoto] = useState<string | null>(null);
  const [clearPhoto, setClearPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoUrl = holding.photoUrl ?? null;

  async function pick(file: File | undefined) {
    setError(null);
    if (!file) return setPhoto(null);
    try {
      setPhoto(await readImage(file));
      setClearPhoto(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Enter the address or a name.');
    setBusy(true);
    setError(null);
    const ok = await onSave({ name: name.trim(), notes, ...(photo ? { photoBase64: photo } : clearPhoto ? { clearPhoto: true } : {}) });
    setBusy(false);
    if (ok) onCancel();
  }

  return (
    <form className="form-grid property-form" onSubmit={submit}>
      <label className="span-2">
        Address or name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="span-2">
        Notes
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </label>
      <label>
        {photoUrl && !clearPhoto ? 'Replace photo' : 'Photo'}
        <input type="file" accept="image/*" onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      {photoUrl && !photo ? (
        <label className="property-form-check">
          <input type="checkbox" checked={clearPhoto} onChange={(e) => setClearPhoto(e.target.checked)} />
          Remove the current photo
        </label>
      ) : null}
      {error ? <p className="auth-error small span-2" role="alert">{error}</p> : null}
      <div className="row gap span-2">
        <button type="submit" className="btn small primary" disabled={busy}>
          Save
        </button>
        <button type="button" className="btn small ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function PropertyList({
  holdings,
  onSaveValue,
  onSaveDetails,
  onSetCost,
  onDelete,
}: {
  holdings: Holding[];
  onSaveValue: (id: string, patch: PropertyValuePatch) => Promise<boolean>;
  onSaveDetails: (id: string, patch: PropertyDetailsPatch) => Promise<boolean>;
  onSetCost: (id: string, costNzd: number) => Promise<boolean>;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<{ id: string; mode: 'value' | 'details' } | null>(null);

  return (
    <div className="property-list">
      {holdings.map((h) => {
        const fig = propertyFigures(h);
        const name = h.name || 'Property';
        const photoUrl = h.photoUrl ?? null;
        const cost = h.costBasisNzd;
        const open = editing?.id === h.id ? editing.mode : null;
        return (
          <article key={h.id} id={holdingDomId(h.id)} tabIndex={-1} className="card property-card" aria-label={name}>
            <div className="property-card-head">
              {photoUrl ? <img className="property-photo" src={photoUrl} alt="" /> : null}
              <div className="property-card-title">
                <h4>{name}</h4>
                <p className="muted small">Updated {updatedOn(h.updatedAt)}</p>
              </div>
              <MoreMenu label={`More actions for ${name}`}>
                {(close) => (
                  <>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => {
                        close();
                        setEditing({ id: h.id, mode: 'details' });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => {
                        close();
                        setEditing({ id: h.id, mode: 'value' });
                      }}
                    >
                      Update value
                    </button>
                    <button
                      type="button"
                      className="btn small danger"
                      onClick={() => {
                        close();
                        onDelete(h.id);
                      }}
                    >
                      Delete
                    </button>
                  </>
                )}
              </MoreMenu>
            </div>

            <dl className="property-figures">
              <div>
                <dt>Market value</dt>
                <dd className="money">{formatNzd(fig.valueNzd)}</dd>
              </div>
              <div>
                <dt>Mortgage</dt>
                <dd className="money">{formatNzd(fig.mortgageNzd)}</dd>
              </div>
              <div>
                <dt>Equity</dt>
                <dd className="money property-equity">{formatNzd(fig.equityNzd)}</dd>
              </div>
            </dl>

            {cost != null && cost > 0 ? (
              <p className="muted small property-cost">Purchase price {formatNzd(cost)}</p>
            ) : (
              <AddCostButton name={name} label="purchase price" onSave={(c) => onSetCost(h.id, c)} />
            )}

            {open === 'value' ? (
              <ValueForm holding={h} onSave={(p) => onSaveValue(h.id, p)} onCancel={() => setEditing(null)} />
            ) : open === 'details' ? (
              <DetailsForm holding={h} onSave={(p) => onSaveDetails(h.id, p)} onCancel={() => setEditing(null)} />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
