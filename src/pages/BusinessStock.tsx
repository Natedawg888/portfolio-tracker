/**
 * One business's stock (KAN-119): figures at cost and sell price, the paginated on-hand chart
 * (amber at or below the reorder level, red at 0), item, purchase and write-off dialogs, and the
 * stock take. A stock take saves each counted item as a recount, which sets on-hand to the count
 * at the end of that day; blank rows are left alone. Archiving is the only delete.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, formatNzd } from '../api/client';
import { BusinessTabs, errorText } from '../components/business/BusinessUi';
import { BatchForm, DamageForm, ItemDetail, ItemForm } from '../components/business/StockForms';
import type { StockItemView } from '../lib/stock';
import {
  STOCK_SORTS,
  barPercent,
  barScale,
  filterSortStock,
  formatQty,
  levelLabel,
  pageCount,
  pageOf,
  stockTakeRows,
  stockTakeSummary,
  type StockSort,
} from '../lib/stockView';
import { aucklandToday } from '../lib/debtModel';
import { showQuietToast } from '../lib/quietToast';

type DialogState =
  | { mode: 'add' }
  | { mode: 'edit'; id: string }
  | { mode: 'view'; id: string }
  | { mode: 'batch'; id: string }
  | { mode: 'damage'; id: string }
  | null;

export function BusinessStock() {
  const { id = '' } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [name, setName] = useState('');
  const [items, setItems] = useState<StockItemView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<StockSort>('level');
  const [page, setPage] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [reload, setReload] = useState(0);
  const taking = searchParams.get('take') === '1';
  const today = aucklandToday();

  useEffect(() => {
    let cancelled = false;
    api.business
      .stock(id, true)
      .then((list) => {
        if (cancelled) return;
        setItems(list);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e, 'Could not load stock.'));
      });
    return () => {
      cancelled = true;
    };
  }, [id, reload]);

  useEffect(() => {
    api.business
      .get(id)
      .then((d) => setName(d.business.name || 'Unnamed business'))
      .catch(() => setName(''));
  }, [id]);

  const active = useMemo(() => (items ?? []).filter((i) => i.onChart), [items]);
  const archived = useMemo(() => (items ?? []).filter((i) => !i.onChart), [items]);
  const shown = useMemo(() => filterSortStock(showArchived ? archived : active, query, sort), [active, archived, showArchived, query, sort]);
  const pages = pageCount(shown.length);
  const onPage = pageOf(shown, page);
  const scale = barScale(onPage);
  const current = dialog && dialog.mode !== 'add' ? (items ?? []).find((i) => i.id === dialog.id) ?? null : null;

  const atCost = active.reduce<number | null>((s, i) => (i.position.valueNzd == null ? s : (s ?? 0) + i.position.valueNzd), null);
  const atSell = active.reduce<number | null>((s, i) => (i.position.sellValueNzd == null ? s : (s ?? 0) + i.position.sellValueNzd), null);
  const needs = active.filter((i) => i.position.level === 'low' || i.position.level === 'out' || i.position.level === 'oversold').length;

  function setTaking(on: boolean) {
    const next = new URLSearchParams(searchParams);
    if (on) next.set('take', '1');
    else next.delete('take');
    setSearchParams(next, { replace: true });
  }

  /** Swaps a saved item into the list so the open dialog shows it without a reload. */
  function replaced(saved: StockItemView) {
    setItems((list) => (list ? (list.some((i) => i.id === saved.id) ? list.map((i) => (i.id === saved.id ? saved : i)) : [...list, saved]) : [saved]));
  }

  async function act(fn: () => Promise<StockItemView>, note: string, after: DialogState) {
    setBusy(true);
    setError(null);
    try {
      replaced(await fn());
      showQuietToast(note);
      setDialog(after);
    } catch (e) {
      setError(errorText(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack bills-page warranties-page rentals-page business-page stock-page">
      <BusinessTabs />
      <header className="business-detail-header">
        <Link className="warranties-back" to={`/business/${encodeURIComponent(id)}`}>
          ‹ {name || 'Business'}
        </Link>
        <div className="business-detail-row">
          <div className="business-detail-name">
            <h2 className="page-title">Stock</h2>
          </div>
          {items && !taking ? (
            <div className="business-detail-actions">
              <button type="button" className="btn small" disabled={!active.length} onClick={() => setTaking(true)}>
                Stock take
              </button>
              <button type="button" className="btn small primary" onClick={() => setDialog({ mode: 'add' })}>
                + Item
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {error ? <p className="auth-error" role="alert">{error}</p> : null}

      {!items ? (
        error ? null : <p className="muted">Loading…</p>
      ) : taking ? (
        <StockTake
          items={filterSortStock(active, '', 'name')}
          today={today}
          onCancel={() => setTaking(false)}
          onDone={(note) => {
            showQuietToast(note);
            setTaking(false);
            setReload((n) => n + 1);
          }}
        />
      ) : (
        <>
          <section className="panel rental-summary business-summary" aria-label="Stock figures">
            <dl className="rental-totals business-totals">
              <div>
                <dt>Items</dt>
                <dd>{active.length}</dd>
              </div>
              <div>
                <dt>Needs reordering</dt>
                <dd className={needs ? 'stock-needs' : undefined}>{needs}</dd>
              </div>
              <div>
                <dt>Value at cost</dt>
                <dd>{atCost == null ? '—' : formatNzd(atCost)}</dd>
              </div>
              <div>
                <dt>Value at sell price</dt>
                <dd>{atSell == null ? '—' : formatNzd(atSell)}</dd>
              </div>
            </dl>
          </section>

          <section className="panel warranty-card stock-chart-card" aria-labelledby="stock-chart-title">
            <div className="rental-card-head">
              <h3 id="stock-chart-title">{showArchived ? 'Archived items' : 'On hand'}</h3>
              {archived.length || showArchived ? (
                <button type="button" className="link-btn small" onClick={() => { setShowArchived((s) => !s); setPage(0); }}>
                  {showArchived ? 'Back to stock' : `Archived (${archived.length})`}
                </button>
              ) : null}
            </div>

            {active.length === 0 && !showArchived ? (
              <div className="stock-empty">
                <p className="muted">No stock items yet. Add what you buy and sell, then record each purchase as it arrives. On-hand is worked out from those.</p>
                <button type="button" className="btn small primary" onClick={() => setDialog({ mode: 'add' })}>
                  + Add your first item
                </button>
              </div>
            ) : (
              <>
                <div className="stock-toolbar">
                  <label>
                    <span className="sr-only">Search stock</span>
                    <input type="search" value={query} placeholder="Search name or SKU" onChange={(e) => { setQuery(e.target.value); setPage(0); }} />
                  </label>
                  <label>
                    <span className="sr-only">Sort</span>
                    <select value={sort} onChange={(e) => { setSort(e.target.value as StockSort); setPage(0); }}>
                      {STOCK_SORTS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {shown.length === 0 ? (
                  <p className="muted small">{query ? `Nothing matches “${query.trim()}”.` : 'No archived items.'}</p>
                ) : (
                  <ul className="stock-bars" aria-label="Stock on hand">
                    {onPage.map((i) => {
                      const p = i.position;
                      const mark = i.reorderLevel == null ? null : barPercent(i.reorderLevel, scale);
                      return (
                        <li key={i.id}>
                          <button type="button" className={`stock-bar stock-bar--${p.level}`} onClick={() => setDialog({ mode: 'view', id: i.id })}>
                            <span className="stock-bar-name">
                              {i.name}
                              {i.sku ? <span className="muted small"> {i.sku}</span> : null}
                            </span>
                            <span className="stock-bar-track" aria-hidden="true">
                              <span className="stock-bar-fill" style={{ width: `${barPercent(p.onHand, scale)}%` }} />
                              {mark != null && mark > 0 ? <span className="stock-bar-mark" style={{ left: `${mark}%` }} /> : null}
                            </span>
                            <span className="stock-bar-qty">{formatQty(p.onHand, i.unit)}</span>
                            <span className="stock-bar-level small">{levelLabel(p.level)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {pages > 1 ? (
                  <nav className="stock-pager" aria-label="Stock pages">
                    <button type="button" className="btn small" disabled={page <= 0} onClick={() => setPage((n) => n - 1)}>
                      ‹ Previous
                    </button>
                    <span className="muted small" aria-live="polite">
                      Page {Math.min(page, pages - 1) + 1} of {pages}
                    </span>
                    <button type="button" className="btn small" disabled={page >= pages - 1} onClick={() => setPage((n) => n + 1)}>
                      Next ›
                    </button>
                  </nav>
                ) : null}
              </>
            )}
          </section>
        </>
      )}

      {dialog?.mode === 'add' ? (
        <ItemForm businessId={id} item={null} onClose={() => setDialog(null)} onSaved={(saved, note) => { replaced(saved); showQuietToast(note); setDialog({ mode: 'view', id: saved.id }); }} />
      ) : null}
      {dialog?.mode === 'edit' && current ? (
        <ItemForm businessId={id} item={current} onClose={() => setDialog({ mode: 'view', id: current.id })} onSaved={(saved, note) => { replaced(saved); showQuietToast(note); setDialog({ mode: 'view', id: saved.id }); }} />
      ) : null}
      {dialog?.mode === 'batch' && current ? (
        <BatchForm item={current} today={today} onClose={() => setDialog({ mode: 'view', id: current.id })} onSaved={(saved, note) => { replaced(saved); showQuietToast(note); setDialog({ mode: 'view', id: saved.id }); }} />
      ) : null}
      {dialog?.mode === 'damage' && current ? (
        <DamageForm item={current} today={today} onClose={() => setDialog({ mode: 'view', id: current.id })} onSaved={(saved, note) => { replaced(saved); showQuietToast(note); setDialog({ mode: 'view', id: saved.id }); }} />
      ) : null}
      {dialog?.mode === 'view' && current ? (
        <ItemDetail
          item={current}
          busy={busy}
          onClose={() => setDialog(null)}
          onEdit={() => setDialog({ mode: 'edit', id: current.id })}
          onBatch={() => setDialog({ mode: 'batch', id: current.id })}
          onDamage={() => setDialog({ mode: 'damage', id: current.id })}
          onArchive={() => {
            if (!window.confirm(`Archive ${current.name}? It leaves the chart and new sales; its history is kept and you can restore it.`)) return;
            void act(() => api.business.archiveStockItem(current.id), `${current.name} archived.`, null);
          }}
          onRestore={() => void act(() => api.business.restoreStockItem(current.id), `${current.name} restored.`, { mode: 'view', id: current.id })}
          onRemoveEntry={(kind, entryId, label) => {
            if (!window.confirm(`Remove “${label}”? On-hand and average cost are worked out again without it.`)) return;
            void act(
              () => (kind === 'batch' ? api.business.removeStockBatch(entryId) : api.business.removeStockAdjustment(entryId)),
              'Removed.',
              { mode: 'view', id: current.id },
            );
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Count every item and enter what's there. Differences show as you type, with their cost at the
 * average cost. Saving records one recount per counted item, all with the same date and reason.
 */
function StockTake({ items, today, onCancel, onDone }: {
  items: StockItemView[];
  today: string;
  onCancel: () => void;
  onDone: (note: string) => void;
}) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState('Stock take');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = stockTakeRows(items, counts);
  const summary = stockTakeSummary(rows, counts);
  const hint = summary.invalid.length
    ? `Check the count for ${summary.invalid.join(', ')}`
    : summary.counted === 0
      ? 'Enter at least one count'
      : !reason.trim()
        ? 'Add a reason'
        : date > today
          ? 'The date can’t be in the future'
          : null;

  async function save() {
    if (hint) return;
    setBusy(true);
    setError(null);
    const toSave = rows.filter((r) => r.counted != null);
    let saved = 0;
    try {
      for (const r of toSave) {
        await api.business.addStockAdjustment(r.item.id, { kind: 'recount', date, countedQuantity: r.counted!, reason: reason.trim() });
        saved++;
      }
      onDone(`Stock take saved: ${saved} item${saved === 1 ? '' : 's'} counted, ${summary.changed} changed.`);
    } catch (e) {
      // Recounts saved so far stand; say which one stopped it so the rest can be retried.
      const failed = toSave[saved]?.item.name ?? 'an item';
      setError(`${errorText(e, 'Could not save.')} Saved ${saved} of ${toSave.length}; stopped at ${failed}.`);
      setBusy(false);
    }
  }

  return (
    <section className="panel warranty-card stock-take" aria-labelledby="stock-take-title">
      <div className="rental-card-head">
        <h3 id="stock-take-title">Stock take</h3>
        <span className="muted small">
          {summary.counted} of {summary.total} counted
        </span>
      </div>
      <p className="muted small">
        Count what’s on the shelf and enter it. Leave an item blank to skip it. Each count replaces on-hand as at the end of the date below; anything
        sold or received later that day should be entered before you save.
      </p>
      <div className="form-grid warranty-form stock-take-meta">
        <label>
          Counted on
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Reason
          <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>

      <div className="stock-take-table-wrap">
        <table className="stock-take-table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className="num">Expected</th>
              <th scope="col" className="num">Counted</th>
              <th scope="col" className="num">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const inputId = `count-${r.item.id}`;
              const diffClass = r.difference == null || r.difference === 0 ? '' : r.difference < 0 ? ' stock-diff--down' : ' stock-diff--up';
              return (
                <tr key={r.item.id}>
                  <th scope="row">
                    <label htmlFor={inputId}>{r.item.name}</label>
                    {r.item.sku ? <span className="muted small"> {r.item.sku}</span> : null}
                  </th>
                  <td className="num">{formatQty(r.expected, r.item.unit)}</td>
                  <td className="num">
                    <input
                      id={inputId}
                      className="stock-count-input"
                      inputMode="decimal"
                      value={counts[r.item.id] ?? ''}
                      placeholder="—"
                      aria-invalid={summary.invalid.includes(r.item.name) || undefined}
                      onChange={(e) => setCounts((c) => ({ ...c, [r.item.id]: e.target.value }))}
                    />
                  </td>
                  <td className={`num${diffClass}`}>
                    {r.difference == null ? '' : r.difference === 0 ? 'Matches' : `${r.difference > 0 ? '+' : '−'}${formatQty(Math.abs(r.difference), r.item.unit)}`}
                    {r.differenceNzd ? <span className="muted small stock-diff-cost"> {r.differenceNzd > 0 ? '+' : '−'}{formatNzd(Math.abs(r.differenceNzd))}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {summary.counted ? (
        <p className="small" role="status">
          {summary.changed === 0 ? 'Every count matches.' : `${summary.changed} item${summary.changed === 1 ? '' : 's'} differ`}
          {summary.netNzd ? `: ${summary.netNzd < 0 ? 'stock missing' : 'extra stock found'} worth ${formatNzd(Math.abs(summary.netNzd))} at cost.` : summary.changed ? '.' : ''}
        </p>
      ) : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="row gap modal-actions warranty-form-actions">
        <button type="button" className="btn primary" disabled={busy || hint != null} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save stock take'}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {hint ? <span className="muted small warranty-save-hint">{hint}</span> : null}
      </div>
    </section>
  );
}
