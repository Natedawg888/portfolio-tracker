/**
 * Record a payment on an invoice (KAN-71). The same dialog the invoice page uses.
 * "Add to my income" still posts through addPayment, which tags the income record
 * to this payment. There is no other income-recording path.
 */
import { useState, type ReactNode } from 'react';
import { api, formatNzd } from '../api/client';
import type { Invoice } from '../types';

function todayNz(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function errText(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

export function InvoiceDialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-overlay" role="presentation" onClick={(e) => (e.target === e.currentTarget ? onClose() : undefined)}>
      <div className={`modal-dialog${wide ? ' modal-dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
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

export function InvoicePaymentDialog({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: (inv: Invoice) => void }) {
  const [date, setDate] = useState(todayNz());
  const [amount, setAmount] = useState(String(invoice.balanceNzd));
  const [method, setMethod] = useState('Bank transfer');
  const [notes, setNotes] = useState('');
  const [addToIncome, setAddToIncome] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onDone(await api.invoices.addPayment(invoice.id, { date, amountNzd: Number(amount), method, notes, addToIncome }));
    } catch (e) {
      setError(errText(e, 'Could not record the payment.'));
      setBusy(false);
    }
  }

  return (
    <InvoiceDialog title={`Record a payment on ${invoice.number}`} onClose={onClose}>
      <p className="muted small">Still owed: {formatNzd(invoice.balanceNzd)}</p>
      <div className="form-grid">
        <label>
          Date received
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Amount ($)
          <input type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          Method
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {['Bank transfer', 'Cash', 'Card', 'Cheque', 'Other'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Note (optional)
          <input value={notes} maxLength={200} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label className="field checkbox-field span-2">
          <label className="inline-check">
            <input type="checkbox" checked={addToIncome} onChange={(e) => setAddToIncome(e.target.checked)} />
            Add to my income on Budget and Home
          </label>
          <span className="muted small">
            Tagged to this invoice. When the same deposit comes in from your bank, it’s matched so it isn’t counted twice.
          </span>
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="row gap modal-actions">
        <button type="button" className="btn primary" disabled={busy || !(Number(amount) > 0)} onClick={() => void save()}>
          Record payment
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </InvoiceDialog>
  );
}
