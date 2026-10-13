/**
 * Add / edit warranty form (phase 2). Kept as a modal, as before, with the new layout:
 * What is it?, Where from?, Bought on, Price, one-tap cover length, linking a purchase,
 * the receipt, and a live "Covered until …" line. Save stays off until the item and a
 * valid date are in, with the reason beside the button.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { api, formatNzd, type WarrantyWriteBody } from '../../api/client';
import type { WarrantyPurchase } from '../../types';
import {
  COVER_OPTIONS,
  coverEndDate,
  coverLine,
  longDate,
  saveBlocker,
  type CoverChoice,
} from '../../pages/warrantiesView';
import { RadioChips } from './RadioChips';
import { errText, readFile } from './receiptFile';

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

export type WarrantyDraftForm = CoverChoice & {
  itemName: string;
  retailer: string;
  price: string;
  startsOn: string;
  purchase: WarrantyPurchase | null;
  notes: string;
};

const CUSTOM_BY = [
  { value: 'months', label: 'Months' },
  { value: 'date', label: 'End date' },
];

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
          {value.description || 'Purchase'} · {longDate(value.date)} · {formatNzd(value.amountNzd)}
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
        Find the purchase in transactions
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
                  {longDate(p.date)} · {formatNzd(p.amountNzd)}
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

export function WarrantyForm({
  title,
  initial,
  today,
  saveLabel,
  existingReceiptUrl,
  onSave,
  onClose,
}: {
  title: string;
  initial: WarrantyDraftForm;
  today: string;
  saveLabel: string;
  /** Editing: the warranty's own receipt, which can be removed on save. */
  existingReceiptUrl: string | null;
  onSave: (body: WarrantyWriteBody, receipt: string | null, removeReceipt: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [d, setD] = useState<WarrantyDraftForm>(initial);
  const [receipt, setReceipt] = useState<{ name: string; dataUrl: string } | null>(null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { cover: useId(), customBy: useId(), hint: useId() };
  const set = <K extends keyof WarrantyDraftForm>(k: K, v: WarrantyDraftForm[K]) => setD((prev) => ({ ...prev, [k]: v }));

  const endsOn = coverEndDate(d.startsOn, d);
  const blocker = saveBlocker(d);

  function pick(p: WarrantyPurchase | null) {
    // Choosing a purchase fills store, date and price from it and links it.
    setD((prev) => (p ? { ...prev, purchase: p, retailer: p.description || prev.retailer, price: String(p.amountNzd), startsOn: p.date } : { ...prev, purchase: null }));
  }

  async function chooseFile(file: File | undefined) {
    setError(null);
    if (!file) {
      setReceipt(null);
      return;
    }
    try {
      setReceipt({ name: file.name, dataUrl: await readFile(file) });
      setRemoveReceipt(false);
    } catch (e) {
      setError(errText(e, 'Could not read that file.'));
    }
  }

  async function save() {
    if (blocker) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(
        {
          itemName: d.itemName,
          retailer: d.retailer,
          priceNzd: d.price.trim() === '' ? null : Number(d.price),
          startsOn: d.startsOn,
          endsOn,
          transactionId: d.purchase?.id ?? null,
          notes: d.notes,
        },
        receipt?.dataUrl ?? null,
        removeReceipt && !receipt,
      );
    } catch (e) {
      setError(errText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <div className="form-grid warranty-form">
        <label className="span-2">
          What is it?
          <input value={d.itemName} maxLength={80} placeholder="e.g. Samsung TV" onChange={(e) => set('itemName', e.target.value)} />
        </label>
        <label>
          Where from? (optional)
          <input value={d.retailer} maxLength={80} placeholder="e.g. Noel Leeming" onChange={(e) => set('retailer', e.target.value)} />
        </label>
        <label>
          Price (NZD, optional)
          <input type="number" min={0} step="0.01" inputMode="decimal" value={d.price} onChange={(e) => set('price', e.target.value)} />
        </label>
        <label>
          Bought on
          <input type="date" value={d.startsOn} onChange={(e) => set('startsOn', e.target.value)} />
        </label>

        <div className="span-2 warranty-field">
          <span id={ids.cover} className="warranty-field-label">
            Cover length
          </span>
          <RadioChips labelId={ids.cover} options={COVER_OPTIONS} value={d.cover} onChange={(v) => set('cover', v)} />
        </div>
        {d.cover === 'custom' ? (
          <div className="span-2 warranty-custom">
            <div className="warranty-field">
              <span id={ids.customBy} className="warranty-field-label">
                Custom cover by
              </span>
              <RadioChips small labelId={ids.customBy} options={CUSTOM_BY} value={d.customBy} onChange={(v) => set('customBy', v as WarrantyDraftForm['customBy'])} />
            </div>
            {d.customBy === 'months' ? (
              <label>
                Months of cover
                <input type="number" min={1} max={600} step={1} inputMode="numeric" value={d.customMonths} onChange={(e) => set('customMonths', e.target.value)} />
              </label>
            ) : (
              <label>
                Cover ends (last day)
                <input type="date" value={d.endsOn} min={d.startsOn || undefined} onChange={(e) => set('endsOn', e.target.value)} />
              </label>
            )}
          </div>
        ) : null}

        <div className="span-2 warranty-field">
          <span className="warranty-field-label">Purchase (optional)</span>
          <PurchasePicker value={d.purchase} onPick={pick} />
        </div>

        <div className="span-2 warranty-field">
          <span className="warranty-field-label">Receipt or warranty card (optional)</span>
          <div className="warranty-receipt-row">
            <label className="btn small warranty-upload">
              {receipt || (existingReceiptUrl && !removeReceipt) ? 'Replace receipt' : 'Attach receipt'}
              <input type="file" accept="image/*,application/pdf" onChange={(e) => void chooseFile(e.target.files?.[0])} />
            </label>
            {receipt ? (
              <span className="muted small">
                {receipt.name}{' '}
                <button type="button" className="link-btn" onClick={() => setReceipt(null)}>
                  Clear
                </button>
              </span>
            ) : existingReceiptUrl ? (
              removeReceipt ? (
                <span className="muted small">
                  Receipt will be removed{' '}
                  <button type="button" className="link-btn" onClick={() => setRemoveReceipt(false)}>
                    Undo
                  </button>
                </span>
              ) : (
                <span className="muted small">
                  <a href={existingReceiptUrl} target="_blank" rel="noreferrer">
                    View receipt
                  </a>{' '}
                  ·{' '}
                  <button type="button" className="link-btn" onClick={() => setRemoveReceipt(true)}>
                    Remove receipt
                  </button>
                </span>
              )
            ) : null}
          </div>
        </div>

        <label className="span-2">
          Notes (optional)
          <input value={d.notes} maxLength={500} placeholder="e.g. serial number, claim phone number" onChange={(e) => set('notes', e.target.value)} />
        </label>
      </div>

      <p className="warranty-cover-line" aria-live="polite">
        {endsOn && endsOn >= d.startsOn ? coverLine(endsOn, today) : '\u00a0'}
      </p>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="row gap modal-actions warranty-form-actions">
        <button type="button" className="btn primary" disabled={busy || blocker != null} aria-describedby={blocker ? ids.hint : undefined} onClick={() => void save()}>
          {saveLabel}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        {blocker ? (
          <span id={ids.hint} className="muted small warranty-save-hint">
            {blocker}
          </span>
        ) : null}
      </div>
    </Dialog>
  );
}
