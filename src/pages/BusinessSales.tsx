/**
 * One business's sales (KAN-123): the tax year's sales with their totals, cost of goods sold and
 * gross profit; recording a sale of stock items (prices default to each item's sell price); and
 * receipts, uploaded or issued (numbered, with a PDF). An issued receipt locks the sale: it can
 * only be deleted. Viewers see the list only (KAN-129).
 */
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatNzd } from '../api/client';
import { BusinessTabs, Dialog, FormActions, TaxYearSwitch, errorText } from '../components/business/BusinessUi';
import { useBusinessInfo } from '../components/business/useBusinessInfo';
import { readFile } from '../components/warranties/receiptFile';
import { taxYearRange } from '../lib/business';
import { aucklandToday } from '../lib/debtModel';
import { showQuietToast } from '../lib/quietToast';
import { blankLine, draftLines, draftTotal, incomeNote, itemOptions, receiptLabel, saleBody, saleDraft, saleHint, type SaleDraft, type SaleItemOption } from '../lib/salesView';
import { formatInvoiceDate } from './invoicesView';
import type { BusinessSale } from '../types';

export function BusinessSales() {
  const { id = '' } = useParams<{ id: string }>();
  const [year, setYear] = useState<number | null>(null);
  const info = useBusinessInfo(id, year);
  const taxYear = info.detail?.taxYear ?? null;
  const [sales, setSales] = useState<BusinessSale[] | null>(null);
  const [items, setItems] = useState<SaleItemOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ sale: BusinessSale | null } | null>(null);
  const [reload, setReload] = useState(0);
  const today = aucklandToday();

  useEffect(() => {
    if (taxYear == null) return;
    let cancelled = false;
    const { start, end } = taxYearRange(taxYear);
    api.business
      .sales(id, { from: start, to: end })
      .then((list) => {
        if (cancelled) return;
        setSales(list);
        setError(null);
      })
      .catch((e: unknown) => !cancelled && setError(errorText(e, 'Could not load sales.')));
    return () => {
      cancelled = true;
    };
  }, [id, taxYear, reload]);

  useEffect(() => {
    api.business
      .stock(id, true)
      .then((list) => setItems(list.map((i) => ({ id: i.id, name: i.name, sellPriceNzd: i.sellPriceNzd, archived: !i.onChart }))))
      .catch(() => setItems([]));
  }, [id]);

  const totals = useMemo(() => {
    const list = sales ?? [];
    const cost = list.some((s) => s.costNzd == null) ? null : list.reduce((t, s) => t + (s.costNzd ?? 0), 0);
    const total = list.reduce((t, s) => t + s.totalNzd, 0);
    return { count: list.length, total, cost, gross: cost == null ? null : total - cost };
  }, [sales]);

  async function act(fn: () => Promise<unknown>, note: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      showQuietToast(note);
      setReload((n) => n + 1);
      info.reload();
    } catch (e) {
      setError(errorText(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  async function upload(sale: BusinessSale, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await act(async () => api.business.uploadSaleReceipt(sale.id, await readFile(file), file.name), 'Receipt attached.');
  }

  return (
    <div className="stack bills-page warranties-page rentals-page business-page sales-page">
      <BusinessTabs />
      <header className="business-detail-header">
        <Link className="warranties-back" to={`/business/${encodeURIComponent(id)}`}>
          ‹ {info.name || 'Business'}
        </Link>
        <div className="business-detail-row">
          <div className="business-detail-name">
            <h2 className="page-title">Sales</h2>
          </div>
          {info.canEdit ? (
            <div className="business-detail-actions">
              <button type="button" className="btn small primary" disabled={!items.some((i) => !i.archived)} onClick={() => setForm({ sale: null })}>
                + Sale
              </button>
            </div>
          ) : null}
        </div>
        {info.detail ? <TaxYearSwitch year={info.detail.taxYear} years={info.detail.taxYears} onChange={setYear} /> : null}
      </header>

      {error || info.error ? <p className="auth-error" role="alert">{error ?? info.error}</p> : null}

      <section className="panel rental-summary business-summary" aria-label="Sales this tax year">
        <dl className="rental-totals business-totals">
          <div>
            <dt>Sales</dt>
            <dd>{totals.count}</dd>
          </div>
          <div>
            <dt>Sold for</dt>
            <dd>{formatNzd(totals.total)}</dd>
          </div>
          <div>
            <dt>Cost of goods sold</dt>
            <dd>{totals.cost == null ? '—' : formatNzd(totals.cost)}</dd>
          </div>
          <div>
            <dt>Gross profit</dt>
            <dd>{totals.gross == null ? '—' : formatNzd(totals.gross)}</dd>
          </div>
        </dl>
        {totals.cost == null && totals.count ? <p className="muted small">Some items were sold before any purchase was recorded, so their cost isn’t known yet.</p> : null}
      </section>

      <section className="panel warranty-card" aria-labelledby="sales-title">
        <div className="rental-card-head">
          <h3 id="sales-title">Sales</h3>
        </div>
        {sales == null ? (
          error ? null : <p className="muted">Loading…</p>
        ) : sales.length === 0 ? (
          <div className="stock-empty">
            <p className="muted">
              {items.some((i) => !i.archived)
                ? 'No sales this tax year. Record what you sell and stock on hand goes down to match.'
                : 'Add stock items on the Stock page first; sales are made from them.'}
            </p>
            {!items.some((i) => !i.archived) ? (
              <Link className="btn small" to={`/business/${encodeURIComponent(id)}/stock`}>
                Go to Stock
              </Link>
            ) : null}
          </div>
        ) : (
          <ul className="rental-entries sales-list">
            {sales.map((s) => {
              const issued = s.receipt?.kind === 'issued';
              return (
                <li key={s.id} className="rental-entry sale-entry">
                  <div className="rental-entry-what">
                    <span>
                      {formatInvoiceDate(s.date)}
                      {s.clientName ? ` · ${s.clientName}` : ''}
                    </span>
                    <span className="muted small">{s.lines.map((l) => `${l.quantity} × ${l.description}`).join(', ')}</span>
                    <span className="muted small">
                      {receiptLabel(s)} · {incomeNote(s)}
                      {s.grossProfitNzd != null ? ` · ${formatNzd(s.grossProfitNzd)} gross profit` : ''}
                    </span>
                  </div>
                  <span className="rental-entry-amount">{formatNzd(s.totalNzd)}</span>
                  <span className="rental-entry-actions sale-actions">
                    {s.receipt?.kind === 'issued' ? (
                      <a href={s.receipt.pdfUrl} target="_blank" rel="noreferrer">
                        PDF
                      </a>
                    ) : null}
                    {s.receipt?.kind === 'uploaded' ? (
                      <a href={s.receipt.url} target="_blank" rel="noreferrer" aria-label={`Receipt for the sale on ${formatInvoiceDate(s.date)}`}>
                        Receipt
                      </a>
                    ) : null}
                    {info.canEdit ? (
                      <>
                        {!issued ? (
                          <button type="button" className="link-btn" disabled={busy} onClick={() => setForm({ sale: s })}>
                            Edit
                          </button>
                        ) : null}
                        {!s.receipt ? (
                          <>
                            <button type="button" className="link-btn" disabled={busy} onClick={() => void act(() => api.business.issueReceipt(s.id), 'Receipt issued.', 'Issue a numbered receipt? The sale can’t be changed after that.')}>
                              Issue receipt
                            </button>
                            <label className="link-btn sale-upload">
                              Upload receipt
                              <input type="file" className="sr-only" accept="application/pdf,image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={(e) => void upload(s, e)} />
                            </label>
                          </>
                        ) : null}
                        {s.receipt?.kind === 'uploaded' ? (
                          <button type="button" className="link-btn" disabled={busy} onClick={() => void act(() => api.business.removeSaleReceipt(s.id), 'Receipt removed.')}>
                            Remove receipt
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="link-btn"
                          disabled={busy}
                          onClick={() => void act(() => api.business.removeSale(s.id), 'Sale deleted. Its stock is back on hand.', `Delete this sale${issued ? ` and receipt ${s.receipt?.kind === 'issued' ? s.receipt.number : ''}` : ''}? Its stock goes back on hand.`)}
                        >
                          Delete
                        </button>
                      </>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {form && info.detail ? (
        <SaleForm
          businessId={id}
          sale={form.sale}
          items={itemOptions(items, form.sale)}
          clients={info.detail.clients.map((c) => ({ id: c.id, name: c.name }))}
          gstRegistered={info.detail.business.gstRegistered}
          today={today}
          onClose={() => setForm(null)}
          onSaved={(note) => {
            setForm(null);
            showQuietToast(note);
            setReload((n) => n + 1);
            info.reload();
          }}
        />
      ) : null}
      <p className="muted small business-foot">
        A sale is income on its date, unless it’s linked to an invoice (the invoice’s payments count instead). Prices are what you charged
        {info.detail?.business.gstRegistered ? ', including GST' : ''}.
      </p>
    </div>
  );
}

function SaleForm({ businessId, sale, items, clients, gstRegistered, today, onClose, onSaved }: {
  businessId: string;
  sale: BusinessSale | null;
  items: SaleItemOption[];
  clients: { id: string; name: string }[];
  gstRegistered: boolean;
  today: string;
  onClose: () => void;
  onSaved: (note: string) => void;
}) {
  const [draft, setDraft] = useState<SaleDraft>(() => saleDraft(sale, today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const lines = draftLines(draft, byId);
  const total = draftTotal(draft, byId);
  const hint = saleHint(draft, byId, today);
  const setLine = (i: number, patch: Partial<SaleDraft['lines'][number]>) => setDraft((d) => ({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  async function save() {
    if (hint) return;
    setBusy(true);
    setError(null);
    try {
      if (sale) await api.business.updateSale(sale.id, saleBody(draft));
      else await api.business.createSale(businessId, saleBody(draft));
      onSaved(sale ? 'Sale saved.' : `Sale of ${formatNzd(total)} recorded.`);
    } catch (e) {
      setError(errorText(e, 'Could not save the sale.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={sale ? 'Edit sale' : 'Record a sale'} onClose={onClose}>
      <div className="form-grid warranty-form">
        <label>
          Date
          <input type="date" value={draft.date} max={today} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
        </label>
        <label>
          Client (optional)
          <select value={draft.clientId} onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}>
            <option value="">No client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="sale-lines">
        <legend>Items sold</legend>
        {draft.lines.map((l, i) => {
          const view = lines[i];
          return (
            <div key={i} className="sale-line">
              <label>
                <span className="sr-only">Item {i + 1}</span>
                <select value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value })}>
                  <option value="">Pick an item</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                      {it.archived ? ' (archived)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">Quantity for line {i + 1}</span>
                <input inputMode="decimal" value={l.quantity} placeholder="Qty" onChange={(e) => setLine(i, { quantity: e.target.value })} />
              </label>
              <label>
                <span className="sr-only">Price each for line {i + 1}</span>
                <input
                  inputMode="decimal"
                  value={l.price}
                  placeholder={view.item?.sellPriceNzd != null ? String(view.item.sellPriceNzd) : 'Price'}
                  onChange={(e) => setLine(i, { price: e.target.value })}
                />
              </label>
              <span className="sale-line-total">{view.totalNzd == null ? '—' : formatNzd(view.totalNzd)}</span>
              <button
                type="button"
                className="link-btn"
                disabled={draft.lines.length === 1}
                aria-label={`Remove line ${i + 1}`}
                onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))}
              >
                Remove
              </button>
            </div>
          );
        })}
        <button type="button" className="btn small ghost" disabled={draft.lines.length >= 100} onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, blankLine()] }))}>
          + Another item
        </button>
        <p className="muted small">Leave the price blank to use the item’s sell price{gstRegistered ? ' (prices include GST)' : ''}.</p>
      </fieldset>

      <label className="form-grid warranty-form">
        Notes
        <textarea rows={2} maxLength={2000} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
      </label>
      <p className="sale-form-total" aria-live="polite">
        Total <strong>{formatNzd(total)}</strong>
        {gstRegistered && total > 0 ? <span className="muted small"> · includes {formatNzd(Math.round(((total * 3) / 23) * 100) / 100)} GST</span> : null}
      </p>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions busy={busy} hint={hint} saveLabel={busy ? 'Saving…' : sale ? 'Save sale' : 'Record sale'} onSave={() => void save()} onClose={onClose} />
    </Dialog>
  );
}
