/**
 * Add / edit a crypto ledger entry (KAN-47). "Look up" fills the NZD value from Yahoo Finance ×
 * Frankfurter for the day (IRD names Yahoo Finance as a source); otherwise you enter it.
 */
import { useState, type ReactNode } from 'react';
import { api, formatNzd } from '../../api/client';
import type { CryptoTxn, CryptoTxnBody, CryptoTxnKind } from '../../types';
import { CRYPTO_TXN_KINDS, KIND_LABEL, NEEDS_VALUE } from '../../lib/cryptoGains';

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
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

const s = (n: number | null | undefined) => (n == null ? '' : String(n));

export function CryptoTxnForm({ txn, onClose, onSave }: { txn: CryptoTxn | null; onClose: () => void; onSave: (body: CryptoTxnBody) => Promise<void> }) {
  const [date, setDate] = useState(txn?.date ?? '');
  const [kind, setKind] = useState<CryptoTxnKind>(txn?.kind ?? 'buy');
  const [asset, setAsset] = useState(txn?.asset ?? '');
  const [amount, setAmount] = useState(s(txn?.amount));
  const [value, setValue] = useState(s(txn?.nzdValue));
  const [source, setSource] = useState(txn?.priceSource ?? 'manual');
  const [fee, setFee] = useState(txn?.feeNzd ? String(txn.feeNzd) : '');
  const [toAsset, setToAsset] = useState(txn?.toAsset ?? '');
  const [toAmount, setToAmount] = useState(s(txn?.toAmount));
  const [notes, setNotes] = useState(txn?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [lookup, setLookup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needsValue = NEEDS_VALUE.has(kind) || kind === 'fee';

  async function look() {
    setLookup('Looking up…');
    try {
      const r = await api.crypto.price(asset, date);
      if (r.priceNzd != null && Number(amount) > 0) {
        setValue(String(Math.round(r.priceNzd * Number(amount) * 100) / 100));
        setSource('yahoo+frankfurter');
        setLookup(`${asset.toUpperCase()} was ${formatNzd(r.priceNzd)} on ${r.priceDate} (Yahoo Finance × Frankfurter).`);
      } else setLookup(r.reason ?? 'No price found; enter the value.');
    } catch (e) {
      setLookup(e instanceof Error ? e.message : 'Lookup failed.');
    }
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await onSave({
        date,
        kind,
        asset: asset.trim(),
        amount: Number(amount),
        nzdValue: value.trim() === '' ? null : Number(value),
        priceSource: source,
        feeNzd: fee.trim() === '' ? 0 : Number(fee),
        toAsset: kind === 'swap' ? toAsset.trim() : null,
        toAmount: kind === 'swap' ? Number(toAmount) : null,
        notes: notes.trim(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      setBusy(false);
    }
  }

  const blocker = !date ? 'Enter the date' : !asset.trim() ? 'Enter the coin' : !(Number(amount) > 0) ? 'Enter the amount' : kind === 'swap' && (!toAsset.trim() || !(Number(toAmount) > 0)) ? 'Enter what you received' : null;

  return (
    <Dialog title={txn ? 'Edit transaction' : 'Add a transaction'} onClose={onClose}>
      <div className="form-grid crypto-form">
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          What happened
          <select value={kind} onChange={(e) => setKind(e.target.value as CryptoTxnKind)}>
            {CRYPTO_TXN_KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label>
          {kind === 'swap' ? 'Gave (coin)' : 'Coin or token'}
          <input value={asset} maxLength={20} placeholder="e.g. BTC" autoCapitalize="characters" onChange={(e) => setAsset(e.target.value)} />
        </label>
        <label>
          Amount
          <input type="number" min={0} step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        {kind === 'swap' ? (
          <>
            <label>
              Received (coin)
              <input value={toAsset} maxLength={20} autoCapitalize="characters" onChange={(e) => setToAsset(e.target.value)} />
            </label>
            <label>
              Amount received
              <input type="number" min={0} step="any" inputMode="decimal" value={toAmount} onChange={(e) => setToAmount(e.target.value)} />
            </label>
          </>
        ) : null}
        {needsValue ? (
          <label className="span-2">
            {kind === 'swap' ? 'NZD value of what you gave' : kind === 'sell' || kind === 'spend' ? 'NZD received (before fees)' : 'NZD value at the time'}
            <span className="crypto-value-row">
              <input type="number" min={0} step="0.01" inputMode="decimal" value={value} onChange={(e) => { setValue(e.target.value); setSource('manual'); }} />
              <button type="button" className="btn small ghost" disabled={!asset.trim() || !date || !(Number(amount) > 0)} onClick={() => void look()}>
                Look up
              </button>
            </span>
            {lookup ? <span className="muted small" aria-live="polite">{lookup}</span> : <span className="muted small">Leave blank if you don’t know yet; it’s flagged until you add it.</span>}
          </label>
        ) : (
          <p className="span-2 muted small">{kind.startsWith('transfer') ? 'Moving between your own wallets doesn’t change your cost or gains.' : 'Still yours while it’s in the protocol, so cost and gains don’t change.'}</p>
        )}
        {kind === 'buy' || kind === 'sell' || kind === 'swap' || kind === 'spend' ? (
          <label>
            Fees (NZD)
            <input type="number" min={0} step="0.01" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
          </label>
        ) : null}
        <label className="span-2">
          Notes (optional)
          <input value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="row gap modal-actions">
        <button type="button" className="btn primary" disabled={busy || !!blocker} onClick={() => void save()}>
          {txn ? 'Save changes' : 'Add'}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        {blocker ? <span className="muted small">{blocker}</span> : null}
      </div>
    </Dialog>
  );
}
