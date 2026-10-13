/**
 * Warranties (KAN-61). Reached from the Budget page (not the nav bar).
 * Phase 1: header counts from the list totals (a short line before the first
 * warranty), an empty state when there are none, and "+ Add warranty" once some
 * exist.
 * Phase 2: the add / edit form (components/warranties/WarrantyForm) with one-tap cover
 * lengths, purchase linking, receipt, and a live "Covered until" line.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatNzd, type WarrantyWriteBody } from '../api/client';
import { WarrantyForm, type WarrantyDraftForm } from '../components/warranties/WarrantyForm';
import { errText, readFile } from '../components/warranties/receiptFile';
import { daysLeftText } from '../lib/warranty';
import type { Warranty, WarrantyListResponse } from '../types';
import { WARRANTY_STATUS_LABELS, coverChoiceFor, warrantiesHeaderLine } from './warrantiesView';

function formatDate(ymd: string | null): string {
  if (!ymd) return '—';
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ymd
    : new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

function draftFor(w: Warranty): WarrantyDraftForm {
  return {
    itemName: w.itemName,
    retailer: w.retailer,
    price: w.priceNzd == null ? '' : String(w.priceNzd),
    startsOn: w.startsOn,
    purchase: w.purchase,
    notes: w.notes,
    ...coverChoiceFor(w.startsOn, w.endsOn),
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
  const blank: WarrantyDraftForm = {
    itemName: '',
    retailer: '',
    price: '',
    startsOn: today,
    cover: '12',
    customBy: 'months',
    customMonths: '',
    endsOn: '',
    purchase: null,
    notes: '',
  };

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

  async function saveEdit(item: Warranty, body: WarrantyWriteBody, receipt: string | null, removeReceipt: boolean) {
    await api.warranties.update(item.id, body);
    if (receipt) await api.warranties.uploadReceipt(item.id, receipt);
    else if (removeReceipt) await api.warranties.removeReceipt(item.id);
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
        <WarrantyForm
          title="Add warranty"
          initial={blank}
          today={today}
          saveLabel="Save warranty"
          existingReceiptUrl={null}
          onClose={() => setDialog(null)}
          onSave={(body, receipt) => saveNew(body, receipt)}
        />
      ) : null}
      {dialog?.mode === 'edit' ? (
        <WarrantyForm
          title={`Edit ${dialog.item.itemName}`}
          initial={draftFor(dialog.item)}
          today={today}
          saveLabel="Save"
          existingReceiptUrl={dialog.item.receiptUrl}
          onClose={() => setDialog(null)}
          onSave={(body, receipt, removeReceipt) => saveEdit(dialog.item, body, receipt, removeReceipt)}
        />
      ) : null}
    </div>
  );
}
