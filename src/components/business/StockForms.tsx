/**
 * Stock dialogs (KAN-119): add or edit an item, record a purchase batch, write off damaged
 * stock, and one item's details with its history. On-hand is never typed in: it comes from
 * batches, sales, write-offs and stock takes.
 */
import { useState } from 'react';
import { api, formatNzd } from '../../api/client';
import { STOCK_UNITS, type StockItemView, type StockUnit } from '../../lib/stock';
import { formatQty, levelLabel, stockHistory } from '../../lib/stockView';
import { formatInvoiceDate } from '../../pages/invoicesView';
import type { StockItemWriteBody } from '../../types';
import { Dialog, FormActions, errorText } from './BusinessUi';

const UNIT_LABELS: Record<StockUnit, string> = { each: 'Each', kg: 'Kilograms (kg)', L: 'Litres (L)' };

const optionalNumber = (s: string) => (s.trim() ? Number(s) : null);
const badNumber = (s: string) => s.trim() !== '' && (!Number.isFinite(Number(s)) || Number(s) < 0);

export function ItemForm({ businessId, item, onSaved, onClose }: {
  businessId: string;
  item: StockItemView | null;
  onSaved: (saved: StockItemView, note: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [sku, setSku] = useState(item?.sku ?? '');
  const [unit, setUnit] = useState<StockUnit>(item?.unit ?? 'each');
  const [sell, setSell] = useState(item?.sellPriceNzd == null ? '' : String(item.sellPriceNzd));
  const [reorder, setReorder] = useState(item?.reorderLevel == null ? '' : String(item.reorderLevel));
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hint = !name.trim() ? 'Add a name' : badNumber(sell) ? 'Sell price must be 0 or more' : badNumber(reorder) ? 'Reorder level must be 0 or more' : null;

  async function save() {
    if (hint) return;
    setBusy(true);
    setError(null);
    const body: StockItemWriteBody = { name: name.trim(), sku: sku.trim(), unit, sellPriceNzd: optionalNumber(sell), reorderLevel: optionalNumber(reorder), notes };
    try {
      const saved = item ? await api.business.updateStockItem(item.id, body) : await api.business.createStockItem(businessId, body);
      onSaved(saved, item ? `${saved.name} saved.` : `${saved.name} added. Record a purchase to bring stock in.`);
    } catch (e) {
      setError(errorText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={item ? `Edit ${item.name}` : 'Add a stock item'} onClose={onClose}>
      <div className="form-grid warranty-form">
        <label>
          Name
          <input value={name} maxLength={120} autoFocus autoComplete="off" placeholder="e.g. Mānuka honey 500 g" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          SKU (optional)
          <input value={sku} maxLength={40} autoComplete="off" onChange={(e) => setSku(e.target.value)} />
        </label>
        <label>
          Counted in
          <select value={unit} disabled={item != null && item.batches.length > 0} onChange={(e) => setUnit(e.target.value as StockUnit)}>
            {STOCK_UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABELS[u]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sell price per unit (optional)
          <input inputMode="decimal" value={sell} placeholder="$" onChange={(e) => setSell(e.target.value)} />
        </label>
        <label>
          Reorder level (optional)
          <input inputMode="decimal" value={reorder} onChange={(e) => setReorder(e.target.value)} aria-describedby="stock-reorder-note" />
          <span id="stock-reorder-note" className="muted small">
            The bar turns amber at or below this, red at 0.
          </span>
        </label>
        <label className="span-2">
          Notes (optional)
          <textarea value={notes} maxLength={1000} rows={2} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions busy={busy} hint={hint} saveLabel={item ? 'Save' : 'Add item'} onSave={() => void save()} onClose={onClose} />
    </Dialog>
  );
}

export function BatchForm({ item, today, onSaved, onClose }: {
  item: StockItemView;
  today: string;
  onSaved: (saved: StockItemView, note: string) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(today);
  const [quantity, setQuantity] = useState('');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = Number(quantity);
  const hint = !quantity.trim() || !(q > 0) ? 'Enter how many came in' : !cost.trim() || badNumber(cost) ? 'Enter the cost per unit (0 if it was free)' : date > today ? 'The date can’t be in the future' : null;

  async function save() {
    if (hint) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.business.addStockBatch(item.id, { date, quantity: q, unitCostNzd: Number(cost), notes });
      onSaved(saved, `${formatQty(q, item.unit)} of ${item.name} added.`);
    } catch (e) {
      setError(errorText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Stock in: ${item.name}`} onClose={onClose}>
      <div className="form-grid warranty-form">
        <label>
          Quantity{item.unit === 'each' ? '' : ` (${item.unit})`}
          <input inputMode="decimal" value={quantity} autoFocus onChange={(e) => setQuantity(e.target.value)} />
        </label>
        <label>
          Cost per unit
          <input inputMode="decimal" value={cost} placeholder="$" onChange={(e) => setCost(e.target.value)} aria-describedby="stock-cost-note" />
          <span id="stock-cost-note" className="muted small">
            Before freight. Freight on a supplier bill can be added to this cost later.
          </span>
        </label>
        <label>
          Date received
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Notes (optional)
          <input value={notes} maxLength={200} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {q > 0 && cost.trim() && !badNumber(cost) ? <p className="muted small">Total {formatNzd(q * Number(cost))}</p> : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions busy={busy} hint={hint} saveLabel="Add stock" onSave={() => void save()} onClose={onClose} />
    </Dialog>
  );
}

export function DamageForm({ item, today, onSaved, onClose }: {
  item: StockItemView;
  today: string;
  onSaved: (saved: StockItemView, note: string) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(today);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = Number(quantity);
  const hint = !quantity.trim() || !(q > 0) ? 'Enter how many were lost' : !reason.trim() ? 'Add a reason' : date > today ? 'The date can’t be in the future' : null;

  async function save() {
    if (hint) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.business.addStockAdjustment(item.id, { kind: 'damage', date, quantityLost: q, reason: reason.trim() });
      onSaved(saved, `${formatQty(q, item.unit)} of ${item.name} written off.`);
    } catch (e) {
      setError(errorText(e, 'Could not save.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Write off: ${item.name}`} onClose={onClose}>
      <div className="form-grid warranty-form">
        <label>
          Quantity lost{item.unit === 'each' ? '' : ` (${item.unit})`}
          <input inputMode="decimal" value={quantity} autoFocus onChange={(e) => setQuantity(e.target.value)} />
        </label>
        <label>
          Date
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="span-2">
          Reason
          <input value={reason} maxLength={200} placeholder="e.g. Broken in transit, expired" onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      {q > 0 && item.position.wacNzd != null ? <p className="muted small">Cost written off about {formatNzd(q * item.position.wacNzd)} at the average cost.</p> : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions busy={busy} hint={hint} saveLabel="Write off" onSave={() => void save()} onClose={onClose} />
    </Dialog>
  );
}

/** One item: figures, actions and its history (batches, write-offs and stock takes). */
export function ItemDetail({ item, busy, onEdit, onBatch, onDamage, onArchive, onRestore, onRemoveEntry, onClose }: {
  item: StockItemView;
  busy: boolean;
  onEdit: () => void;
  onBatch: () => void;
  onDamage: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onRemoveEntry: (kind: 'batch' | 'adjustment', id: string, label: string) => void;
  onClose: () => void;
}) {
  const p = item.position;
  const history = stockHistory(item);
  return (
    <Dialog title={item.name} onClose={onClose}>
      <p className="muted small">
        {[item.sku ? `SKU ${item.sku}` : null, levelLabel(p.level), item.archivedAt ? 'Archived' : null].filter(Boolean).join(' · ')}
      </p>
      <dl className="rental-totals business-totals stock-item-figures">
        <div>
          <dt>On hand</dt>
          <dd>{formatQty(p.onHand, item.unit)}</dd>
        </div>
        <div>
          <dt>Average cost</dt>
          <dd>{p.wacNzd == null ? '—' : formatNzd(p.wacNzd)}</dd>
        </div>
        <div>
          <dt>Sell price</dt>
          <dd>{p.sellPriceNzd == null ? '—' : formatNzd(p.sellPriceNzd)}</dd>
        </div>
        <div>
          <dt>Margin per unit</dt>
          <dd>{p.marginPerUnitNzd == null ? '—' : formatNzd(p.marginPerUnitNzd)}</dd>
        </div>
        <div>
          <dt>Value at cost</dt>
          <dd>{p.valueNzd == null ? '—' : formatNzd(p.valueNzd)}</dd>
        </div>
        <div>
          <dt>Value at sell price</dt>
          <dd>{p.sellValueNzd == null ? '—' : formatNzd(p.sellValueNzd)}</dd>
        </div>
      </dl>
      {p.level === 'oversold' ? (
        <p className="muted small" role="status">
          More has gone out than came in{p.oversoldSince ? ` since ${formatInvoiceDate(p.oversoldSince)}` : ''}. Record the purchase, or do a stock take to set what’s really there.
        </p>
      ) : null}

      <div className="row gap stock-item-actions">
        {item.archivedAt ? (
          <button type="button" className="btn small primary" disabled={busy} onClick={onRestore}>
            Restore item
          </button>
        ) : (
          <>
            <button type="button" className="btn small primary" disabled={busy} onClick={onBatch}>
              + Stock in
            </button>
            <button type="button" className="btn small" disabled={busy} onClick={onDamage}>
              Write off
            </button>
            <button type="button" className="btn small" disabled={busy} onClick={onEdit}>
              Edit
            </button>
            <button type="button" className="btn small ghost" disabled={busy} onClick={onArchive}>
              Archive
            </button>
          </>
        )}
      </div>

      <h4 className="stock-history-title">History</h4>
      {history.length === 0 ? (
        <p className="muted small">Nothing yet. Use Stock in when a purchase arrives.</p>
      ) : (
        <ul className="stock-history">
          {history.map((h) => {
            const label =
              h.kind === 'batch'
                ? `In: ${formatQty(h.quantity, item.unit)} at ${formatNzd(h.unitCostNzd)}`
                : h.kind === 'damage'
                  ? `Written off: ${formatQty(h.quantity, item.unit)}`
                  : `Stock take: counted ${formatQty(h.counted, item.unit)}`;
            const detail = h.kind === 'batch' ? [h.landedNzd !== h.quantity * h.unitCostNzd ? `${formatNzd(h.landedNzd)} with freight` : null, h.notes || null].filter(Boolean).join(' · ') : h.reason;
            return (
              <li key={`${h.kind}-${h.id}`} className={`stock-history-row stock-history-row--${h.kind}`}>
                <span className="stock-history-date">{formatInvoiceDate(h.date)}</span>
                <span className="stock-history-text">
                  {label}
                  {detail ? <span className="muted small"> · {detail}</span> : null}
                </span>
                {item.archivedAt ? null : (
                  <button
                    type="button"
                    className="link-btn small"
                    disabled={busy}
                    aria-label={`Remove ${label.toLowerCase()} on ${formatInvoiceDate(h.date)}`}
                    onClick={() => onRemoveEntry(h.kind === 'batch' ? 'batch' : 'adjustment', h.id, label)}
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
