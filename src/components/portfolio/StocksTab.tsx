/**
 * Stocks: one row per holding (logo, name, shares · broker, 1M change, return,
 * value), sortable by value or return. A row expands to cost, gain/loss, price
 * per share, the FX line, the price chart, Edit shares and a ⋯ menu.
 * 0-share holdings sit in a collapsed "Closed positions" group.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { api, formatNzd } from '../../api/client';
import { HoldingIcon } from '../HoldingIcon';
import { HoldingPriceChart } from '../HoldingPriceChart';
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
import { formatSignedPct, holdingDomId, holdingReturn, seriesChangePct } from '../../lib/portfolioView';

type SortKey = 'value' | 'return';

/** 1M change per ticker, kept for the session so tab switches don't refetch. */
const monthChangeCache = new Map<string, Promise<number | null>>();

function monthChange(ticker: string, exchange: string | null | undefined): Promise<number | null> {
  const key = `${ticker}|${exchange ?? ''}`;
  let p = monthChangeCache.get(key);
  if (!p) {
    p = api.quotes
      .history({ assetClass: 'stock', ticker, exchange: exchange ?? null, range: '1m' })
      .then((r) => (r.status === 'ok' ? seriesChangePct(r.points) : null))
      .catch(() => null);
    monthChangeCache.set(key, p);
  }
  return p;
}

function MonthChange({ ticker, exchange }: { ticker: string; exchange?: string | null }) {
  const [pct, setPct] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void monthChange(ticker, exchange).then((v) => {
      if (live) setPct(v);
    });
    return () => {
      live = false;
    };
  }, [ticker, exchange]);
  if (pct === undefined) return <span className="muted">…</span>;
  if (pct == null) return <span className="muted">—</span>;
  return <span className={pct >= 0 ? 'return-pos' : 'return-neg'}>{formatSignedPct(pct)}</span>;
}

function broker(h: Holding): string {
  if (h.source === 'Sharesies' || h.source === 'Hatch') return h.source;
  return 'added by hand';
}

/** "44.78 USD → 79.33 NZD @ 1.78 (frankfurter)" from the holding's notes, if present. */
function fxLine(notes: string | undefined): string | null {
  const m = (notes ?? '').match(/([\d.]+\s+[A-Z]{3}\s*→\s*[\d.]+\s*NZD\s*@\s*[\d.]+(?:\s*\([^)]+\))?)/i);
  return m ? m[1] : null;
}

type Handlers = {
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateQuantity: (id: string, quantity: number) => Promise<void>;
  onSetCost: (id: string, costNzd: number) => Promise<boolean>;
};

export function StocksTab({ holdings, ...handlers }: { holdings: Holding[] } & Handlers) {
  const [sort, setSort] = useState<SortKey>('value');
  const [openId, setOpenId] = useState<string | null>(null);
  const [closedOpen, setClosedOpen] = useState(false);
  const closedId = useId();

  const open = holdings.filter((h) => Number(h.shares) > 0);
  const closed = holdings.filter((h) => !(Number(h.shares) > 0));
  const sortValue = (h: Holding) => {
    if (sort === 'value') return marketValueNzd(h) ?? -Infinity;
    const r = holdingReturn(marketValueNzd(h), displayCostBasisNzd(h));
    return r.kind === 'ok' ? r.pct : -Infinity;
  };
  const sorted = [...open].sort((a, b) => sortValue(b) - sortValue(a));

  return (
    <section className="panel" aria-labelledby="stocks-title">
      <div className="panel-heading">
        <h3 id="stocks-title">Stocks</h3>
        <div className="segmented segmented--small" role="group" aria-label="Sort stocks by">
          {(['value', 'return'] as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              className={'segmented-btn' + (sort === k ? ' active' : '')}
              aria-pressed={sort === k}
              onClick={() => setSort(k)}
            >
              {k === 'value' ? 'Value' : 'Return'}
            </button>
          ))}
        </div>
      </div>

      {open.length === 0 ? (
        <p className="muted">No stock holdings with shares yet.</p>
      ) : (
        <ul className="asset-list">
          <li className="asset-list-head" aria-hidden="true">
            <span />
            <span>Holding</span>
            <span>1M</span>
            <span>Return</span>
            <span>Value</span>
          </li>
          {sorted.map((h) => (
            <StockRow
              key={h.id}
              holding={h}
              open={openId === h.id}
              onToggle={() => setOpenId((cur) => (cur === h.id ? null : h.id))}
              {...handlers}
            />
          ))}
        </ul>
      )}

      {closed.length > 0 ? (
        <div className="closed-positions">
          <button
            type="button"
            className="debt-link-button"
            aria-expanded={closedOpen}
            aria-controls={closedOpen ? closedId : undefined}
            onClick={() => setClosedOpen((o) => !o)}
          >
            Closed positions ({closed.length}) <span aria-hidden="true">{closedOpen ? '▴' : '▾'}</span>
          </button>
          {closedOpen ? (
            <ul id={closedId} className="closed-list">
              {closed.map((h) => {
                const left = marketValueNzd(h);
                const cost = displayCostBasisNzd(h);
                return (
                  <li key={h.id}>
                    <div className="closed-list-main">
                      <strong>{displayName(h)}</strong>
                      <span className="muted small">
                        0 shares · {broker(h)}
                        {cost != null ? ` · cost recorded ${formatNzd(cost)}` : ''}
                        {left != null && left > 0 ? ` · ${formatNzd(left)} still reported` : ''}
                      </span>
                      <span className="muted small">
                        Realised result needs a sale amount, and none is recorded.
                        {h.source === 'Sharesies' || h.source === 'Hatch'
                          ? ` ${h.source} still lists this position, so it returns on each sync.`
                          : ''}
                      </span>
                    </div>
                    {h.source === 'Sharesies' || h.source === 'Hatch' ? null : (
                      <MoreMenu label={`More actions for ${displayName(h)}`}>
                        {(close) => (
                          <button
                            type="button"
                            className="btn small danger"
                            onClick={() => {
                              close();
                              handlers.onDelete(h.id);
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </MoreMenu>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function StockRow({
  holding: h,
  open,
  onToggle,
  onRefresh,
  onDelete,
  onUpdateQuantity,
  onSetCost,
}: { holding: Holding; open: boolean; onToggle: () => void } & Handlers) {
  const detailId = useId();
  const value = marketValueNzd(h);
  const cost = displayCostBasisNzd(h);
  const ret = holdingReturn(value, cost);
  const ticker = tickerFor(h);
  const shares = Number(h.shares);
  const perShare = h.unitPriceNzd ?? (value != null && shares > 0 ? value / shares : null);
  const fx = fxLine(h.notes);

  return (
    <li id={holdingDomId(h.id)} tabIndex={-1} className={'asset-row' + (open ? ' asset-row--open' : '')}>
      <button
        type="button"
        className="asset-row-hit"
        aria-expanded={open}
        aria-controls={open ? detailId : undefined}
        onClick={onToggle}
      >
        <HoldingIcon ticker={ticker} assetClass="stock" iconUrl={h.logoUrl} />
        <span className="asset-row-name">
          <span className="asset-row-title">{displayName(h)}</span>
          <span className="muted small">
            {formatAmount(h.shares, 4)} shares · {broker(h)}
          </span>
        </span>
        <span className="asset-row-num small">
          <span className="sr-only">1 month change: </span>
          <MonthChange ticker={ticker} exchange={h.exchange} />
        </span>
        <span className="asset-row-num small">
          <span className="sr-only">Return: </span>
          {ret.kind === 'ok' ? (
            <span className={ret.pct >= 0 ? 'return-pos' : 'return-neg'}>{formatSignedPct(ret.pct)}</span>
          ) : ret.kind === 'no_cost' ? (
            <span className="muted">no cost</span>
          ) : (
            '—'
          )}
        </span>
        <span className="asset-row-value money">{formatNzd(value)}</span>
      </button>
      {open ? (
        <div id={detailId} className="asset-row-detail">
          <dl className="asset-row-facts">
            <div>
              <dt>Cost</dt>
              <dd>
                {cost != null ? (
                  formatNzd(cost)
                ) : (
                  <AddCostButton name={displayName(h)} onSave={(c) => onSetCost(h.id, c)} />
                )}
              </dd>
            </div>
            <div>
              <dt>Gain / loss</dt>
              <dd className={ret.kind === 'ok' ? (ret.returnNzd >= 0 ? 'return-pos' : 'return-neg') : undefined}>
                {ret.kind === 'ok' ? `${ret.returnNzd > 0 ? '+' : ''}${formatNzd(ret.returnNzd)}` : '—'}
              </dd>
            </div>
            <div>
              <dt>Price per share</dt>
              <dd>{formatNzd(perShare)}</dd>
            </div>
            {fx ? (
              <div className="asset-row-fact-wide">
                <dt>FX conversion</dt>
                <dd>{fx}</dd>
              </div>
            ) : null}
          </dl>
          <HoldingPriceChart assetClass="stock" ticker={ticker} exchange={h.exchange} />
          <div className="asset-row-actions">
            <EditShares holding={h} onSave={onUpdateQuantity} />
            <MoreMenu label={`More actions for ${displayName(h)}`}>
              {(close) => (
                <>
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
        </div>
      ) : null}
    </li>
  );
}

function EditShares({
  holding,
  onSave,
}: {
  holding: Holding;
  onSave: (id: string, quantity: number) => Promise<void>;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(holding.shares ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      setError('Shares must be 0 or more.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(holding.id, n);
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="btn small ghost"
        onClick={() => {
          setValue(String(holding.shares ?? ''));
          setEditing(true);
        }}
      >
        Edit shares
      </button>
    );
  }
  return (
    <form className="add-cost-form" onSubmit={submit}>
      <label htmlFor={id}>Shares</label>
      <input id={id} type="number" step="any" min={0} value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} autoFocus />
      <button type="submit" className="btn small primary" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className="btn small ghost" disabled={busy} onClick={() => setEditing(false)}>
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
