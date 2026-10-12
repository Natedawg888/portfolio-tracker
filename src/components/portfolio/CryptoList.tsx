/**
 * Crypto holdings as a list: icon, name, quantity, NZD rate used, value.
 * Zero-quantity lines sit behind "+N empty holdings". Manual ones can be
 * removed; Sharesies/Hatch ones come back on each sync, so they're only grouped.
 */
import { useId, useState, type FormEvent } from 'react';
import { formatNzd } from '../../api/client';
import { HoldingIcon } from '../HoldingIcon';
import { MoreMenu } from '../MoreMenu';
import { AddCostButton } from './AddCostButton';
import {
  displayCostBasisNzd,
  displayName,
  formatAmount,
  marketValueNzd,
  tickerFor,
  type Holding,
} from '../../lib/holdingDisplay';
import { formatSignedPct, holdingDomId, holdingReturn } from '../../lib/portfolioView';

const isSynced = (h: Holding) => h.source === 'Sharesies' || h.source === 'Hatch';

export function CryptoList({
  holdings,
  onRefresh,
  onDelete,
  onSetCost,
  onUpdateQuantity,
}: {
  holdings: Holding[];
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onSetCost: (id: string, costNzd: number) => Promise<boolean>;
  onUpdateQuantity: (id: string, quantity: number) => Promise<void>;
}) {
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const emptyId = useId();
  const held = holdings
    .filter((h) => Number(h.amount) > 0)
    .sort((a, b) => (marketValueNzd(b) ?? -1) - (marketValueNzd(a) ?? -1));
  const empty = holdings.filter((h) => !(Number(h.amount) > 0));

  return (
    <>
      {held.length === 0 ? (
        <p className="muted">No crypto holdings with a balance.</p>
      ) : (
        <ul className="asset-list asset-list--crypto">
          <li className="asset-list-head" aria-hidden="true">
            <span />
            <span>Holding</span>
            <span>Rate (NZD)</span>
            <span>Return</span>
            <span>Value</span>
          </li>
          {held.map((h) => {
            const value = marketValueNzd(h);
            const cost = displayCostBasisNzd(h);
            const ret = holdingReturn(value, cost);
            const qty = Number(h.amount);
            const rate = h.unitPriceNzd ?? (value != null && qty > 0 ? value / qty : null);
            return (
              <li key={h.id} id={holdingDomId(h.id)} tabIndex={-1} className="asset-row">
                <div className="asset-row-hit asset-row-static">
                  <HoldingIcon ticker={tickerFor(h)} assetClass="crypto" iconUrl={h.logoUrl} />
                  <span className="asset-row-name">
                    <span className="asset-row-title">{displayName(h)}</span>
                    <span className="muted small">
                      {formatAmount(qty)} {(h.asset ?? '').toUpperCase()}
                      {isSynced(h) ? ` · ${h.source}` : ''}
                    </span>
                  </span>
                  <span className="asset-row-num small">
                    <span className="sr-only">Rate used: </span>
                    {rate == null ? '—' : formatNzd(rate)}
                  </span>
                  <span className="asset-row-num small">
                    <span className="sr-only">Return: </span>
                    {ret.kind === 'ok' ? (
                      <span className={ret.pct >= 0 ? 'return-pos' : 'return-neg'}>{formatSignedPct(ret.pct)}</span>
                    ) : ret.kind === 'no_cost' ? (
                      <AddCostButton name={displayName(h)} onSave={(c) => onSetCost(h.id, c)} />
                    ) : (
                      '—'
                    )}
                  </span>
                  <span className="asset-row-value money">{formatNzd(value)}</span>
                  <MoreMenu label={`More actions for ${displayName(h)}`}>
                    {(close) => (
                      <>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => {
                            close();
                            setEditingId(h.id);
                          }}
                        >
                          Edit amount
                        </button>
                        <button
                          type="button"
                          className="btn small"
                          onClick={() => {
                            close();
                            onRefresh(h.id);
                          }}
                        >
                          Refresh value
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
                {editingId === h.id ? (
                  <EditAmount holding={h} onSave={onUpdateQuantity} onClose={() => setEditingId(null)} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {empty.length > 0 ? (
        <div className="closed-positions">
          <button
            type="button"
            className="debt-link-button"
            aria-expanded={emptyOpen}
            aria-controls={emptyOpen ? emptyId : undefined}
            onClick={() => setEmptyOpen((o) => !o)}
          >
            {emptyOpen ? 'Hide' : `+${empty.length}`} empty holding{empty.length === 1 ? '' : 's'}{' '}
            <span aria-hidden="true">{emptyOpen ? '▴' : '▾'}</span>
          </button>
          {emptyOpen ? (
            <ul id={emptyId} className="closed-list">
              {empty.map((h) => {
                const cost = displayCostBasisNzd(h);
                return (
                  <li key={h.id}>
                    <div className="closed-list-main">
                      <strong>{displayName(h)}</strong>
                      <span className="muted small">
                        0 {(h.asset ?? '').toUpperCase()}
                        {cost != null ? ` · cost recorded ${formatNzd(cost)}` : ''}
                        {isSynced(h)
                          ? ` · ${h.source} still lists it, so it returns on each sync`
                          : ''}
                      </span>
                    </div>
                    {isSynced(h) ? null : (
                      <button type="button" className="btn small danger" onClick={() => onDelete(h.id)}>
                        Remove<span className="sr-only"> {displayName(h)}</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function EditAmount({
  holding,
  onSave,
  onClose,
}: {
  holding: Holding;
  onSave: (id: string, quantity: number) => Promise<void>;
  onClose: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(String(holding.amount ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      setError('Amount must be 0 or more.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(holding.id, n);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="add-cost-form asset-row-detail"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onClose();
      }}
    >
      <label htmlFor={id}>Amount of {(holding.asset ?? '').toUpperCase() || displayName(holding)}</label>
      <input id={id} type="number" step="any" min={0} value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} autoFocus />
      <button type="submit" className="btn small primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className="btn small ghost" disabled={busy} onClick={onClose}>
        Cancel
      </button>
      {error ? (
        <span className="add-cost-error" role="alert">
          {error}
        </span>
      ) : null}
    </form>
  );
}
