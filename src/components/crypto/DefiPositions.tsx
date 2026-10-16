/**
 * DeFi positions (KAN-47): what you have in a protocol, or owe, at the value you record.
 * Positions set to count are added to net worth (borrowing taken off).
 */
import { useState } from 'react';
import { api, formatNzd } from '../../api/client';
import type { DefiKind, DefiPosition, DefiView } from '../../types';
import { Dialog } from './CryptoTxnForm';

const KINDS: { value: DefiKind; label: string }[] = [
  { value: 'lending', label: 'Lending / supplying' },
  { value: 'liquidity', label: 'Liquidity pool' },
  { value: 'staking', label: 'Staking (locked)' },
  { value: 'vault', label: 'Vault / yield' },
  { value: 'borrow', label: 'Borrowing (you owe)' },
  { value: 'other', label: 'Other' },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.value, k.label])) as Record<DefiKind, string>;

function Form({ position, onClose, onSaved }: { position: DefiPosition | null; onClose: () => void; onSaved: (v: DefiView) => void }) {
  const p = position;
  const [protocol, setProtocol] = useState(p?.protocol ?? '');
  const [kind, setKind] = useState<DefiKind>(p?.kind ?? 'lending');
  const [network, setNetwork] = useState(p?.network ?? '');
  const [assets, setAssets] = useState(p?.assets ?? '');
  const [value, setValue] = useState(p ? String(p.valueNzd) : '');
  const [valuedOn, setValuedOn] = useState(p?.valuedOn ?? '');
  const [count, setCount] = useState(p?.countInNetWorth ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.crypto.saveDefi(p?.id ?? null, { protocol, kind, network, assets, valueNzd: Number(value) || 0, valuedOn: valuedOn || null, countInNetWorth: count, notes: p?.notes ?? '' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      setBusy(false);
    }
  }

  return (
    <Dialog title={p ? 'Edit DeFi position' : 'Add a DeFi position'} onClose={onClose}>
      <div className="form-grid crypto-form">
        <label>
          Protocol
          <input value={protocol} maxLength={60} placeholder="e.g. Aave" onChange={(e) => setProtocol(e.target.value)} />
        </label>
        <label>
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as DefiKind)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </label>
        <label>
          Network (optional)
          <input value={network} maxLength={30} placeholder="e.g. Ethereum" onChange={(e) => setNetwork(e.target.value)} />
        </label>
        <label>
          Assets (optional)
          <input value={assets} maxLength={60} placeholder="e.g. ETH/USDC" onChange={(e) => setAssets(e.target.value)} />
        </label>
        <label>
          {kind === 'borrow' ? 'Amount owed (NZD)' : 'Value now (NZD)'}
          <input type="number" min={0} step="0.01" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          <span className="muted small">From the protocol’s dashboard. It isn’t read from the chain.</span>
        </label>
        <label>
          Valued on
          <input type="date" value={valuedOn} onChange={(e) => setValuedOn(e.target.value)} />
        </label>
        <label className="span-2 payslip-check">
          <input type="checkbox" checked={count} onChange={(e) => setCount(e.target.checked)} />
          <span>Count it in my net worth</span>
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="row gap modal-actions">
        <button type="button" className="btn primary" disabled={busy || !protocol.trim() || value.trim() === ''} onClick={() => void save()}>
          {p ? 'Save changes' : 'Add'}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

export function DefiPositions({ view, onChange, onNote }: { view: DefiView; onChange: (v: DefiView) => void; onNote: (m: string) => void }) {
  const [dialog, setDialog] = useState<{ position: DefiPosition | null } | null>(null);
  return (
    <div>
      {view.positions.length ? (
        <ul className="hh-rows">
          {view.positions.map((p) => (
            <li key={p.id} className="hh-row-wrap">
              <span>
                {p.protocol}
                <span className="muted small">
                  {' '}· {KIND_LABEL[p.kind]}
                  {p.assets ? ` · ${p.assets}` : ''}
                  {p.network ? ` · ${p.network}` : ''}
                  {p.countInNetWorth ? '' : ' · not in net worth'}
                </span>
              </span>
              <span className={'money' + (p.kind === 'borrow' ? ' hh-owes' : '')}>{p.kind === 'borrow' ? `−${formatNzd(p.valueNzd)}` : formatNzd(p.valueNzd)}</span>
              <span className="payslip-actions">
                <button type="button" className="link-btn" onClick={() => setDialog({ position: p })}>
                  Edit
                </button>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() =>
                    window.confirm(`Delete the ${p.protocol} position?`) &&
                    void api.crypto.removeDefi(p.id).then((v) => {
                      onChange(v);
                      onNote('Position deleted.');
                    })
                  }
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No DeFi positions yet. Add what you have in lending, pools, vaults or locked staking, and anything you’ve borrowed.</p>
      )}
      {view.positions.length ? <p className="small">In net worth: <strong className="money">{formatNzd(view.netNzd)}</strong></p> : null}
      <button type="button" className="btn small" onClick={() => setDialog({ position: null })}>
        + Add a position
      </button>
      {dialog ? (
        <Form
          position={dialog.position}
          onClose={() => setDialog(null)}
          onSaved={(v) => {
            onChange(v);
            setDialog(null);
            onNote('DeFi positions saved.');
          }}
        />
      ) : null}
    </div>
  );
}
