/**
 * Warranties (KAN-61). Reached from the Budget page (not the nav bar).
 * Phase 1: header counts from the list totals (a short line before the first
 * warranty), an empty state when there are none, and "+ Add warranty" once some
 * exist. The add/edit dialog, tables, purchase link, and receipts are unchanged.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, formatNzd, type WarrantyWriteBody } from '../api/client';
import { WARRANTY_LENGTHS, daysLeftText, warrantyEndDate } from '../lib/warranty';
import type { Warranty, WarrantyListResponse, WarrantyPurchase } from '../types';
import { WARRANTY_STATUS_LABELS, warrantiesHeaderLine } from './warrantiesView';

function formatDate(ymd: string | null): string {
  if (!ymd) return '—';
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ymd
    : new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

function errText(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_RECEIPT_BYTES) {
      reject(new Error('Receipt must be 8 MB or smaller.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-overlay" role="presentation" onClick={(e) => (e.target === e.currentTarget ? onClose() : undefined)}>
      <div className="modal-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="btn small modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

type Draft = {
  itemName: string;
  retailer: string;
  price: string;
  startsOn: string;
  /** Months from WARRANTY_LENGTHS, or 'custom' to pick the end date. */
  length: string;
  endsOn: string;
  purchase: WarrantyPurchase | null;
  notes: string;
};

function PurchasePicker({ value, onPick }: { value: WarrantyPurchase | null; onPick: (p: WarrantyPurchase | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<WarrantyPurchase[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      api.warranties
        .purchases(q)
        .then((r) => {
          if (!cancelled) {
            setRows(r);
            setError(null);
          }
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(errText(e, 'Could not load purchases.'));
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [open, q]);

  if (value) {
    return (
      <div className="warranty-linked">
        <span>
          {value.description || 'Purchase'} · {formatDate(value.date)} · {formatNzd(value.amountNzd)}
          {value.receiptUrl ? ' · has receipt' : ''}
        </span>{' '}
        <button type="button" className="btn small ghost" onClick={() => onPick(null)}>
          Unlink
        </button>
      </div>
    );
  }
  if (!open) {
    return (
      <button type="button" className="btn small" onClick={() => setOpen(true)}>
        Find the purchase in your transactions
      </button>
    );
  }
  return (
    <div className="warranty-picker">
      <input type="search" placeholder="Search payee or description" value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
      {error ? <p className="auth-error small">{error}</p> : null}
      {rows == null && !error ? <p className="muted small">Loading…</p> : null}
      {rows && rows.length === 0 ? <p className="muted small">No purchases match.</p> : null}
      {rows && rows.length > 0 ? (
        <ul className="warranty-picker-list">
          {rows.map((p) => (
            <li key={p.id}>
              <button type="button" className="warranty-pick" onClick={() => onPick(p)}>
                <span>{p.description || 'Purchase'}</span>
                <span className="muted small">
                  {formatDate(p.date)} · {formatNzd(p.amountNzd)}
                  {p.receiptUrl ? ' · receipt' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="btn small ghost" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}

function WarrantyDialog({
  title,
  initial,
  isNew,
  saveLabel,
  onSave,
  onClose,
}: {
  title: string;
  initial: Draft;
  /** Adding: picking a purchase also sets the start date unless it was changed. */
  isNew: boolean;
  saveLabel: string;
  onSave: (body: WarrantyWriteBody, receipt: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [receipt, setReceipt] = useState<{ name: string; dataUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));

  const endsOn = d.length === 'custom' ? d.endsOn : d.startsOn ? warrantyEndDate(d.startsOn, Number(d.length)) : '';
  const price = d.price.trim() === '' ? null : Number(d.price);
  const valid = d.itemName.trim() && d.startsOn && endsOn && endsOn >= d.startsOn && (price == null || price >= 0);

  function pick(p: WarrantyPurchase | null) {
    setD((prev) =>
      p
        ? {
            ...prev,
            purchase: p,
            // Fill what's still empty from the purchase.
            retailer: prev.retailer || p.description,
            price: prev.price || String(p.amountNzd),
            startsOn: isNew && prev.startsOn === initial.startsOn ? p.date : prev.startsOn,
          }
        : { ...prev, purchase: null },
    );
  }

  async function chooseFile(file: File | undefined) {
    setError(null);
    if (!file) {
      setReceipt(null);
      return;
    }
    try {
      setReceipt({ name: file.name, dataUrl: await readFile(file) });
    } catch (e) {
      setError(errText(e, 'Could not read that file.'));
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave(
        {
          itemName: d.itemName,
          retailer: d.retailer,
          priceNzd: price,
          startsOn: d.startsOn,
          endsOn,
          transactionId: d.purchase?.id ?? null,
          notes: d.notes,
        },
        receipt?.dataUrl ?? null,
      );
    } catch (e) {
      setError(errText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <div className="form-grid">
        <label className="span-2">
          Item
          <input value={d.itemName} maxLength={80} placeholder="e.g. Samsung TV" onChange={(e) => set('itemName', e.target.value)} />
        </label>
        <div className="span-2">
          <p className="muted small" style={{ margin: '0 0 0.35rem' }}>
            Purchase (optional) — links the transaction and its receipt
          </p>
          <PurchasePicker value={d.purchase} onPick={pick} />
        </div>
        <label>
          Store (optional)
          <input value={d.retailer} maxLength={80} onChange={(e) => set('retailer', e.target.value)} />
        </label>
        <label>
          Price (NZD, optional)
          <input type="number" min={0} step="0.01" inputMode="decimal" value={d.price} onChange={(e) => set('price', e.target.value)} />
        </label>
        <label>
          Cover starts
          <input type="date" value={d.startsOn} onChange={(e) => set('startsOn', e.target.value)} />
        </label>
        <label>
          Length
          <select
            value={d.length}
            onChange={(e) => setD((prev) => ({ ...prev, length: e.target.value, endsOn: prev.endsOn || endsOn }))}
          >
            {WARRANTY_LENGTHS.map((l) => (
              <option key={l.months} value={String(l.months)}>
                {l.label}
              </option>
            ))}
            <option value="custom">Pick an end date</option>
          </select>
        </label>
        {d.length === 'custom' ? (
          <label>
            Cover ends (last day)
            <input type="date" value={d.endsOn} min={d.startsOn || undefined} onChange={(e) => set('endsOn', e.target.value)} />
          </label>
        ) : (
          <p className="muted small span-2" style={{ margin: 0 }}>
            Covered until {endsOn ? formatDate(endsOn) : '—'}
          </p>
        )}
        <label className="span-2">
          Receipt or warranty card (optional, image or PDF)
          <input type="file" accept="image/*,application/pdf" onChange={(e) => void chooseFile(e.target.files?.[0])} />
        </label>
        <label className="span-2">
          Notes (optional)
          <input value={d.notes} maxLength={500} placeholder="e.g. serial number, claim phone number" onChange={(e) => set('notes', e.target.value)} />
        </label>
      </div>
      {d.length === 'custom' && d.endsOn && d.startsOn && d.endsOn < d.startsOn ? (
        <p className="auth-error" role="alert">Cover can’t end before it starts.</p>
      ) : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="row gap modal-actions">
        <button type="button" className="btn primary" disabled={busy || !valid} onClick={() => void save()}>
          {saveLabel}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

function draftFor(w: Warranty): Draft {
  // Show a preset length when the saved dates match one; otherwise the exact end date.
  const preset = WARRANTY_LENGTHS.find((l) => warrantyEndDate(w.startsOn, l.months) === w.endsOn);
  return {
    itemName: w.itemName,
    retailer: w.retailer,
    price: w.priceNzd == null ? '' : String(w.priceNzd),
    startsOn: w.startsOn,
    length: preset ? String(preset.months) : 'custom',
    endsOn: w.endsOn,
    purchase: w.purchase,
    notes: w.notes,
  };
}

type DialogState = { mode: 'add' } | { mode: 'edit'; item: Warranty } | null;

function WarrantyShield() {
  return (
    <svg className="warranties-empty-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        d="M12 3.2 5.2 6.1v5.9c0 4.1 2.7 7 6.8 8.6 4.1-1.6 6.8-4.5 6.8-8.6V6.1L12 3.2z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.8 12.1 11 14.3 15.3 10"
      />
    </svg>
  );
}

function EmptyWarranties({ onAdd }: { onAdd: () => void }) {
  return (
    <section className="panel warranties-empty" aria-labelledby="warranties-empty-title">
      <WarrantyShield />
      <h3 id="warranties-empty-title">Never miss a free repair</h3>
      <p>Add what you bought and when the cover ends.</p>
      <button type="button" className="btn primary" onClick={onAdd}>
        Add your first warranty
      </button>
    </section>
  );
}

export function Warranties() {
  const [data, setData] = useState<WarrantyListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showExpired, setShowExpired] = useState(false);

  const [reload, setReload] = useState(0);
  const load = () => setReload((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    api.warranties
      .list()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errText(e, 'Could not load warranties.'));
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  async function act(key: string, fn: () => Promise<unknown>, note: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyKey(key);
    setMsg(null);
    try {
      await fn();
      setMsg(note);
      load();
    } catch (e) {
      setError(errText(e, 'Something went wrong.'));
    } finally {
      setBusyKey(null);
    }
  }

  async function uploadFor(w: Warranty, file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await readFile(file);
      await act(w.id, () => api.warranties.uploadReceipt(w.id, dataUrl), `Receipt saved for ${w.itemName}.`);
    } catch (e) {
      setError(errText(e, 'Could not read that file.'));
    }
  }

  const today = data?.today ?? '';
  const covered = data?.items.filter((i) => i.status !== 'expired') ?? [];
  const expired = data?.items.filter((i) => i.status === 'expired') ?? [];
  const blank: Draft = { itemName: '', retailer: '', price: '', startsOn: today, length: '12', endsOn: '', purchase: null, notes: '' };

  async function saveNew(body: WarrantyWriteBody, receipt: string | null) {
    const saved = await api.warranties.create(body);
    setDialog(null);
    if (receipt) {
      try {
        await api.warranties.uploadReceipt(saved.id, receipt);
      } catch (e) {
        setMsg(`${body.itemName} added, but the receipt didn’t upload: ${errText(e, 'try again from the list')}.`);
        load();
        return;
      }
    }
    setMsg(`${body.itemName} added.`);
    load();
  }

  async function saveEdit(item: Warranty, body: WarrantyWriteBody, receipt: string | null) {
    await api.warranties.update(item.id, body);
    if (receipt) await api.warranties.uploadReceipt(item.id, receipt);
    setDialog(null);
    setMsg(`${body.itemName} updated.`);
    load();
  }

  function row(w: Warranty) {
    return (
      <tr key={w.id} className={w.status === 'expired' ? 'bills-inactive' : undefined}>
        <td>
          {w.itemName}
          <div className="muted small">
            {[w.retailer, w.priceNzd != null ? formatNzd(w.priceNzd) : '', w.notes].filter(Boolean).join(' · ') || ' '}
          </div>
        </td>
        <td>
          {formatDate(w.endsOn)}
          <div className="muted small">from {formatDate(w.startsOn)}</div>
        </td>
        <td>
          <span className={`warranty-status warranty-status--${w.status}`}>{WARRANTY_STATUS_LABELS[w.status]}</span>
          <div className="muted small">{daysLeftText(w.endsOn, today)}</div>
        </td>
        <td>
          {w.purchase ? (
            <>
              {w.purchase.description || 'Purchase'}
              <div className="muted small">
                {formatDate(w.purchase.date)} · {formatNzd(w.purchase.amountNzd)}
                {w.purchase.receiptUrl ? (
                  <>
                    {' · '}
                    <a href={w.purchase.receiptUrl} target="_blank" rel="noreferrer">
                      Receipt
                    </a>
                  </>
                ) : null}
              </div>
            </>
          ) : (
            <span className="muted">Not linked</span>
          )}
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          {w.receiptUrl ? (
            <>
              <a href={w.receiptUrl} target="_blank" rel="noreferrer">
                View
              </a>{' '}
              <button
                type="button"
                className="btn small ghost"
                disabled={busyKey != null}
                onClick={() => void act(w.id, () => api.warranties.removeReceipt(w.id), `Receipt removed from ${w.itemName}.`, `Remove the receipt from ${w.itemName}?`)}
              >
                Remove
              </button>
            </>
          ) : (
            <label className="btn small warranty-upload">
              Upload
              <input
                type="file"
                accept="image/*,application/pdf"
                disabled={busyKey != null}
                onChange={(e) => {
                  void uploadFor(w, e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <button type="button" className="btn small" disabled={busyKey != null} onClick={() => setDialog({ mode: 'edit', item: w })}>
            Edit
          </button>{' '}
          <button
            type="button"
            className="btn small danger"
            disabled={busyKey != null}
            onClick={() => void act(w.id, () => api.warranties.remove(w.id), `${w.itemName} removed.`, `Remove the warranty for ${w.itemName}?`)}
          >
            Remove
          </button>
        </td>
      </tr>
    );
  }

  function table(items: Warranty[]) {
    return (
      <div className="table-wrap" style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Cover ends</th>
              <th>Status</th>
              <th>Purchase</th>
              <th>Receipt</th>
              <th />
            </tr>
          </thead>
          <tbody>{items.map(row)}</tbody>
        </table>
      </div>
    );
  }

  const openAdd = () => setDialog({ mode: 'add' });

  return (
    <div className="stack bills-page warranties-page">
      <header className="warranties-header">
        <div>
          <Link className="warranties-back" to="/spending">
            ‹ Budget
          </Link>
          <h2 className="page-title">Warranties</h2>
          {data ? (
            <p className="muted small warranties-header-line">{warrantiesHeaderLine(data.items.length, data.totals, data.expiringSoonDays)}</p>
          ) : null}
        </div>
        {data && data.items.length > 0 ? (
          <div className="warranties-header-actions">
            <button type="button" className="btn small primary" onClick={openAdd}>
              + Add warranty
            </button>
          </div>
        ) : null}
      </header>

      {error ? (
        <section className="panel">
          <p className="auth-error" role="alert">{error}</p>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setError(null);
              load();
            }}
          >
            Try again
          </button>
        </section>
      ) : null}
      {msg ? <p className="banner">{msg}</p> : null}
      {!data && !error ? <p className="muted">Loading warranties…</p> : null}

      {data && data.items.length === 0 ? <EmptyWarranties onAdd={openAdd} /> : null}

      {data && data.items.length > 0 ? (
        <>
          <section className="panel">
            <h3>Under warranty</h3>
            {covered.length === 0 ? (
              <p className="muted small">Nothing is under warranty right now.</p>
            ) : (
              table(covered)
            )}
          </section>

          {expired.length > 0 ? (
            <section className="panel">
              <div className="panel-heading">
                <h3>Expired ({expired.length})</h3>
                <button type="button" className="btn small ghost" onClick={() => setShowExpired((v) => !v)} aria-expanded={showExpired}>
                  {showExpired ? 'Hide' : 'Show'}
                </button>
              </div>
              {showExpired ? table(expired) : null}
            </section>
          ) : null}
        </>
      ) : null}

      {dialog?.mode === 'add' ? (
        <WarrantyDialog title="Add a warranty" initial={blank} isNew saveLabel="Add" onClose={() => setDialog(null)} onSave={saveNew} />
      ) : null}
      {dialog?.mode === 'edit' ? (
        <WarrantyDialog
          title={`Edit ${dialog.item.itemName}`}
          initial={draftFor(dialog.item)}
          isNew={false}
          saveLabel="Save"
          onClose={() => setDialog(null)}
          onSave={(body, receipt) => saveEdit(dialog.item, body, receipt)}
        />
      ) : null}
    </div>
  );
}
