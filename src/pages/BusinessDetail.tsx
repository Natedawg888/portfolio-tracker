/**
 * One business (KAN-84): its details and logo, income / expenses / net for the selected NZ tax
 * year, an educational GST-collected estimate when GST registered, its assets and their
 * movements, its clients (when switched on), its invoices, and the transactions and income
 * tagged to it. Totals come from the server, which counts each dollar once.
 */
import { useEffect, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatNzd } from '../api/client';
import { ASSET_CATEGORIES, IRD_GST_URL, businessTypeLabel, movementKindLabel } from '../lib/business';
import { BusinessFigures, BusinessMark, BusinessTabs, Dialog, TaxYearSwitch, errorText } from '../components/business/BusinessUi';
import { BusinessForm, businessBody } from '../components/business/BusinessForm';
import { ClientForm, clientBody } from '../components/business/ClientForm';
import { AssetForm, MovementForm, assetDraft } from '../components/business/AssetForms';
import { InvoiceStatusBadge } from '../components/InvoicePreview';
import { formatInvoiceDate } from './invoicesView';
import type { BusinessAsset, BusinessDetail as Detail, BusinessMoneyItem, InvoiceClient } from '../types';

type DialogState =
  | { mode: 'edit' }
  | { mode: 'add-asset' }
  | { mode: 'edit-asset'; asset: BusinessAsset }
  | { mode: 'move'; asset: BusinessAsset }
  | { mode: 'add-client' }
  | { mode: 'edit-client'; client: InvoiceClient }
  | { mode: 'tag' }
  | { mode: 'produce' }
  | null;

const signed = (n: number) => `${n < 0 ? '−' : '+'}${formatNzd(Math.abs(n))}`;

function countedNote(m: BusinessMoneyItem): string {
  if (m.countedVia === 'invoice') return 'Counted through its invoice payment';
  if (m.countedVia === 'income') return 'Counted through the income row linked to it';
  return m.kind === 'income' ? 'Income' : m.amountNzd < 0 ? 'Expense' : 'Income';
}

function TagDialog({ year, businessId, onTagged, onClose }: { year: number; businessId: string; onTagged: () => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<BusinessMoneyItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tagged, setTagged] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      api.business
        .candidates(year, q)
        .then((list) => {
          if (!cancelled) setItems(list);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(errorText(e, 'Could not load transactions.'));
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [year, q]);

  async function tag(m: BusinessMoneyItem) {
    setError(null);
    try {
      await api.business.tag(m.kind, m.id, businessId);
      setTagged((prev) => new Set(prev).add(`${m.kind}:${m.id}`));
      onTagged();
    } catch (e) {
      setError(errorText(e, 'Could not tag it.'));
    }
  }

  return (
    <Dialog title="Tag money to this business" onClose={onClose}>
      <p className="muted small">
        Bank transactions and income rows in this tax year that aren’t tagged to a business. Invoice payments are already
        counted, so they aren’t listed.
      </p>
      <label className="business-search">
        Search
        <input value={q} maxLength={80} placeholder="Payee or description" autoFocus onChange={(e) => setQ(e.target.value)} />
      </label>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {items == null ? <p className="muted">Loading…</p> : null}
      {items && items.length === 0 ? <p className="muted">Nothing to tag{q ? ' that matches' : ''}.</p> : null}
      {items && items.length > 0 ? (
        <ul className="rental-entries business-money">
          {items.map((m) => {
            const key = `${m.kind}:${m.id}`;
            return (
              <li key={key} className="rental-entry">
                <div className="rental-entry-what">
                  <span>{m.description}</span>
                  <span className="muted small">
                    {formatInvoiceDate(m.date)} · {m.kind === 'income' ? 'Income row' : 'Bank'}
                  </span>
                </div>
                <span className={'rental-entry-amount' + (m.amountNzd < 0 ? ' rental-entry-amount--out' : '')}>{signed(m.amountNzd)}</span>
                <span className="rental-entry-actions">
                  {tagged.has(key) ? (
                    <span className="muted small">Tagged</span>
                  ) : (
                    <button type="button" className="link-btn" onClick={() => void tag(m)}>
                      Tag
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="row gap modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

function ProduceDialog({ businessId, onLinked, onClose }: { businessId: string; onLinked: () => void; onClose: () => void }) {
  const [items, setItems] = useState<Detail['produce'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.business
      .produceCandidates()
      .then(setItems)
      .catch((e: unknown) => setError(errorText(e, 'Could not load commodities.')));
  }, []);

  async function link(id: string) {
    setError(null);
    try {
      await api.business.linkProduce(id, businessId);
      setLinked((prev) => new Set(prev).add(id));
      onLinked();
    } catch (e) {
      setError(errorText(e, 'Could not link it.'));
    }
  }

  return (
    <Dialog title="Link produce from Commodities" onClose={onClose}>
      <p className="muted small">
        Commodities you hold for this business, like honey or wool. Their value stays on Portfolio → Commodities, where it
        counts in net worth once.
      </p>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {items == null && !error ? <p className="muted">Loading…</p> : null}
      {items && items.length === 0 ? (
        <p className="muted">
          No commodities to link. <Link to="/portfolio#commodities">Add one on Portfolio</Link> first.
        </p>
      ) : null}
      {items && items.length > 0 ? (
        <ul className="rental-entries business-money">
          {items.map((c) => (
            <li key={c.id} className="rental-entry">
              <div className="rental-entry-what">
                <span>{c.name}</span>
                <span className="muted small">
                  {c.quantity} {c.unit}
                </span>
              </div>
              <span className="rental-entry-amount rental-entry-amount--out">{c.valueNzd == null ? '—' : formatNzd(c.valueNzd)}</span>
              <span className="rental-entry-actions">
                {linked.has(c.id) ? (
                  <span className="muted small">Linked</span>
                ) : (
                  <button type="button" className="link-btn" onClick={() => void link(c.id)}>
                    Link
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="row gap modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

function AssetRow({ a, busy, onEdit, onMove, onDelete, onUndo }: {
  a: BusinessAsset;
  busy: boolean;
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => void;
  onUndo: (movementId: string) => void;
}) {
  const detail = [
    a.animalType,
    a.tag,
    a.location,
    a.category === 'beehives' && a.status !== 'active' ? (a.status === 'dead' ? 'Dead' : 'Sold') : null,
    a.valueNzd != null && a.valueMode === 'per_unit' ? `${formatNzd(a.valueNzd)} each` : null,
    a.valuedOn ? `valued ${formatInvoiceDate(a.valuedOn)}` : null,
    a.costNzd != null ? `cost ${formatNzd(a.costNzd)}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <li className="rental-entry business-asset">
      <div className="rental-entry-what">
        <span>
          {a.name} <span className="muted">· {a.quantity}{a.unit ? ` ${a.unit}` : ''}</span>
        </span>
        {detail ? <span className="muted small">{detail}</span> : null}
        {a.notes ? <span className="muted small">{a.notes}</span> : null}
        {a.movements.length > 0 ? (
          <details className="business-movements">
            <summary className="small">
              {a.movements.length} {a.movements.length === 1 ? 'change' : 'changes'}
            </summary>
            <ul>
              {a.movements.map((m) => (
                <li key={m.id} className="small">
                  {formatInvoiceDate(m.date)} · {movementKindLabel(m.kind)} {m.quantity}
                  {m.amountNzd != null ? ` · ${formatNzd(m.amountNzd)}` : ''}
                  {m.notes ? ` · ${m.notes}` : ''}{' '}
                  <button type="button" className="link-btn" disabled={busy} onClick={() => onUndo(m.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <span className="rental-entry-amount rental-entry-amount--out">{a.currentValueNzd == null ? '—' : formatNzd(a.currentValueNzd)}</span>
      <span className="rental-entry-actions">
        <button type="button" className="link-btn" disabled={busy} onClick={onMove}>
          Record change
        </button>
        <button type="button" className="link-btn" disabled={busy} onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="link-btn" disabled={busy} onClick={onDelete}>
          Delete
        </button>
      </span>
    </li>
  );
}

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

export function BusinessDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<Detail | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [businesses, setBusinesses] = useState<Detail['business'][]>([]);
  const [reload, setReload] = useState(0);
  const load = () => setReload((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    api.business
      .get(id, year)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e, 'Could not load this business.'));
      });
    return () => {
      cancelled = true;
    };
  }, [id, year, reload]);

  useEffect(() => {
    api.business
      .list()
      .then((l) => setBusinesses(l.businesses))
      .catch(() => setBusinesses([]));
  }, [id]);

  async function act(fn: () => Promise<unknown>, note: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      await fn();
      setMsg(note);
      load();
    } catch (e) {
      setError(errorText(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  async function saved(note: string) {
    setDialog(null);
    setMsg(note);
    load();
  }

  async function onLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setError('Logo must be 4 MB or smaller.');
      return;
    }
    await act(async () => api.business.setLogo(id, await readImage(file)), 'Logo updated.');
  }

  if (!data) {
    return (
      <div className="stack business-page">
        <BusinessTabs />
        {error ? <p className="auth-error" role="alert">{error}</p> : <p className="muted">Loading…</p>}
      </div>
    );
  }

  const b = data.business;
  const t = data.totals;
  const today = data.today;
  const grouped = ASSET_CATEGORIES.map((c) => ({ ...c, assets: data.assets.filter((a) => a.category === c.value) })).filter((g) => g.assets.length > 0);
  const sub = [businessTypeLabel(b.type), b.industry, b.nzbn ? `NZBN ${b.nzbn}` : null, b.gstRegistered ? `GST ${b.gstNumber}` : null]
    .filter(Boolean)
    .join(' · ');
  const others = businesses.length ? businesses : [b];

  return (
    <div className="stack bills-page warranties-page rentals-page business-page">
      <BusinessTabs />
      <header className="warranties-header">
        <div className="business-detail-title">
          <BusinessMark name={b.name} logoUrl={b.logoUrl} />
          <div>
            <Link className="warranties-back" to="/business">
              ‹ All businesses
            </Link>
            <h2 className="page-title">{b.name || 'Unnamed business'}</h2>
            <p className="muted small">{sub}</p>
            <TaxYearSwitch year={data.taxYear} years={data.taxYears} onChange={setYear} />
          </div>
        </div>
        <div className="warranties-header-actions">
          <button type="button" className="btn small" disabled={busy} onClick={() => setDialog({ mode: 'edit' })}>
            Edit details
          </button>
          <label className="btn small business-logo-btn">
            {b.logoUrl ? 'Change logo' : 'Add logo'}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => void onLogo(e)} />
          </label>
          {b.logoUrl ? (
            <button type="button" className="link-btn" disabled={busy} onClick={() => void act(() => api.business.removeLogo(id), 'Logo removed.')}>
              Remove logo
            </button>
          ) : null}
        </div>
      </header>

      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {msg ? <p className="banner">{msg}</p> : null}

      <section className="panel rental-summary" aria-label="This tax year">
        <BusinessFigures totals={t} />
        {t.outstandingNzd > 0 ? <p className="muted small">{formatNzd(t.outstandingNzd)} still owed on sent invoices.</p> : null}
        {t.gstCollectedEstimateNzd != null ? (
          <p className="muted small business-gst">
            GST in that income, estimated at 3/23: <strong>{formatNzd(t.gstCollectedEstimateNzd)}</strong>. This is a rough
            guide only. It ignores zero-rated and exempt sales and the GST you can claim on expenses. It isn’t a GST return or
            tax advice. See{' '}
            <a href={IRD_GST_URL} target="_blank" rel="noreferrer">
              IRD’s GST guidance
            </a>
            .
          </p>
        ) : null}
        {!b.countInNetWorth ? <p className="muted small">This business’s assets aren’t counted in net worth (Edit details to change).</p> : null}
      </section>

      <section className="panel warranty-card" aria-labelledby="biz-assets">
        <div className="rental-card-head">
          <h3 id="biz-assets">Assets</h3>
          <div className="rental-card-actions">
            <button type="button" className="btn small" disabled={busy} onClick={() => setDialog({ mode: 'add-asset' })}>
              + Asset
            </button>
          </div>
        </div>
        {grouped.length === 0 ? (
          <p className="muted small">Add livestock, beehives, equipment, vehicles, stock or anything else the business owns.</p>
        ) : (
          grouped.map((g) => (
            <div key={g.value} className="business-asset-group">
              <h4 className="eyebrow">{g.label}</h4>
              <ul className="rental-entries">
                {g.assets.map((a) => (
                  <AssetRow
                    key={a.id}
                    a={a}
                    busy={busy}
                    onEdit={() => setDialog({ mode: 'edit-asset', asset: a })}
                    onMove={() => setDialog({ mode: 'move', asset: a })}
                    onDelete={() =>
                      void act(() => api.business.removeAsset(a.id), `${a.name} deleted.`, `Delete ${a.name} and its ${a.movements.length} recorded changes?`)
                    }
                    onUndo={(movementId) =>
                      void act(() => api.business.removeMovement(movementId), 'Change removed.', 'Remove this change? The count goes back.')
                    }
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section className="panel warranty-card" aria-labelledby="biz-produce">
        <div className="rental-card-head">
          <h3 id="biz-produce">Produce held</h3>
          <div className="rental-card-actions">
            <button type="button" className="btn small" disabled={busy} onClick={() => setDialog({ mode: 'produce' })}>
              + Link commodity
            </button>
          </div>
        </div>
        {data.produce.length === 0 ? (
          <p className="muted small">Link commodities like honey or wool that you hold for this business.</p>
        ) : (
          <>
            <ul className="rental-entries">
              {data.produce.map((c) => (
                <li key={c.id} className="rental-entry">
                  <div className="rental-entry-what">
                    <span>{c.name}</span>
                    <span className="muted small">
                      {c.quantity} {c.unit}
                    </span>
                  </div>
                  <span className="rental-entry-amount rental-entry-amount--out">{c.valueNzd == null ? '—' : formatNzd(c.valueNzd)}</span>
                  <span className="rental-entry-actions">
                    <button type="button" className="link-btn" disabled={busy} onClick={() => void act(() => api.business.linkProduce(c.id, null), `${c.name} unlinked.`)}>
                      Unlink
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <p className="muted small">
              Valued on <Link to="/portfolio#commodities">Portfolio → Commodities</Link> and counted in net worth there, not in this
              business’s assets.
            </p>
          </>
        )}
      </section>

      {b.clientsEnabled ? (
        <section className="panel warranty-card" aria-labelledby="biz-clients">
          <div className="rental-card-head">
            <h3 id="biz-clients">Clients</h3>
            <div className="rental-card-actions">
              <button type="button" className="btn small" disabled={busy} onClick={() => setDialog({ mode: 'add-client' })}>
                + Client
              </button>
            </div>
          </div>
          {data.clients.length === 0 ? (
            <p className="muted small">No clients yet. Invoices can pick a client from this list.</p>
          ) : (
            <ul className="rental-entries">
              {data.clients.map((c) => (
                <li key={c.id} className="rental-entry">
                  <div className="rental-entry-what">
                    <span>
                      <Link to={`/business/clients/${c.id}`}>{c.name}</Link>
                      {c.status === 'inactive' ? <span className="muted small"> · Inactive</span> : null}
                    </span>
                    <span className="muted small">
                      {[c.contactPerson, c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details'}
                    </span>
                  </div>
                  <span className="rental-entry-amount rental-entry-amount--out">
                    {formatNzd(c.billedNzd)}
                    {c.outstandingNzd > 0 ? <span className="muted small"> · {formatNzd(c.outstandingNzd)} owed</span> : null}
                  </span>
                  <span className="rental-entry-actions">
                    <button type="button" className="link-btn" disabled={busy} onClick={() => setDialog({ mode: 'edit-client', client: c })}>
                      Edit
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="panel warranty-card" aria-labelledby="biz-invoices">
        <div className="rental-card-head">
          <h3 id="biz-invoices">Invoices</h3>
          <div className="rental-card-actions">
            <Link className="btn small" to={`/business/invoices/new?business=${encodeURIComponent(b.id)}`}>
              + Invoice
            </Link>
            {data.invoices.length > 0 ? (
              <Link className="link-btn" to={`/business/invoices?business=${encodeURIComponent(b.id)}`}>
                All invoices
              </Link>
            ) : null}
          </div>
        </div>
        {data.invoices.length === 0 ? (
          <p className="muted small">No invoices yet.</p>
        ) : (
          <ul className="rental-entries">
            {data.invoices.slice(0, 5).map((inv) => (
              <li key={inv.id} className="rental-entry">
                <div className="rental-entry-what">
                  <span>
                    <Link to={`/business/invoices/${inv.id}`}>{inv.number}</Link> · {inv.clientName || 'No client'}
                  </span>
                  <span className="muted small">
                    {formatInvoiceDate(inv.issueDate)} · <InvoiceStatusBadge status={inv.status} />
                  </span>
                </div>
                <span className="rental-entry-amount rental-entry-amount--out">{formatNzd(inv.totalNzd)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel warranty-card" aria-labelledby="biz-money">
        <div className="rental-card-head">
          <h3 id="biz-money">Money in and out</h3>
          <div className="rental-card-actions">
            <button type="button" className="btn small" disabled={busy} onClick={() => setDialog({ mode: 'tag' })}>
              + Tag transactions
            </button>
          </div>
        </div>
        <p className="muted small">
          Tag bank transactions and income to this business. Invoice payments are counted automatically, and a deposit
          linked to one isn’t counted again.
        </p>
        {data.money.length === 0 ? (
          <p className="muted small">Nothing tagged in this tax year.</p>
        ) : (
          <ul className="rental-entries">
            {data.money.map((m) => (
              <li key={`${m.kind}:${m.id}`} className="rental-entry">
                <div className="rental-entry-what">
                  <span>{m.description}</span>
                  <span className="muted small">
                    {formatInvoiceDate(m.date)} · {countedNote(m)}
                  </span>
                </div>
                <span className={'rental-entry-amount' + (m.amountNzd < 0 || m.countedVia ? ' rental-entry-amount--out' : '')}>{signed(m.amountNzd)}</span>
                <span className="rental-entry-actions">
                  {m.kind === 'income' && m.countedVia === 'invoice' ? null : (
                    <button type="button" className="link-btn" disabled={busy} onClick={() => void act(() => api.business.tag(m.kind, m.id, null), 'Untagged.')}>
                      Untag
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel warranty-card">
        <h3>Delete this business</h3>
        <p className="muted small">
          Deletes its assets, their changes and its clients. Tagged transactions and income stay in Budget and Income,
          untagged. A business with invoices can’t be deleted, because invoices are kept on record.
        </p>
        <div>
          <button
            type="button"
            className="btn small"
            disabled={busy || data.invoices.length > 0}
            onClick={() =>
              void (async () => {
                if (!window.confirm(`Delete ${b.name || 'this business'}? This can’t be undone.`)) return;
                setBusy(true);
                try {
                  await api.business.remove(id);
                  navigate('/business');
                } catch (e) {
                  setError(errorText(e, 'Could not delete it.'));
                  setBusy(false);
                }
              })()
            }
          >
            Delete business
          </button>
        </div>
      </section>

      {dialog?.mode === 'edit' ? (
        <BusinessForm
          title={`Edit ${b.name || 'business'}`}
          initial={businessBody(b)}
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            await api.business.update(id, body);
            await saved('Details saved.');
          }}
        />
      ) : null}
      {dialog?.mode === 'add-asset' || dialog?.mode === 'edit-asset' ? (
        <AssetForm
          title={dialog.mode === 'add-asset' ? 'Add asset' : `Edit ${dialog.asset.name}`}
          initial={assetDraft(dialog.mode === 'edit-asset' ? dialog.asset : null, today)}
          today={today}
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            if (dialog.mode === 'edit-asset') await api.business.updateAsset(dialog.asset.id, body);
            else await api.business.createAsset(id, body);
            await saved(`${body.name} saved.`);
          }}
        />
      ) : null}
      {dialog?.mode === 'move' ? (
        <MovementForm
          asset={dialog.asset}
          today={today}
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            const next = await api.business.addMovement(dialog.asset.id, body);
            await saved(`${movementKindLabel(body.kind)} recorded. ${next.name} is now ${next.quantity}${next.unit ? ` ${next.unit}` : ''}.`);
          }}
        />
      ) : null}
      {dialog?.mode === 'add-client' || dialog?.mode === 'edit-client' ? (
        <ClientForm
          title={dialog.mode === 'add-client' ? 'Add client' : `Edit ${dialog.client.name}`}
          initial={clientBody(dialog.mode === 'edit-client' ? dialog.client : null, id)}
          businesses={others}
          onClose={() => setDialog(null)}
          onSave={async (body) => {
            if (dialog.mode === 'edit-client') await api.invoices.updateClient(dialog.client.id, body);
            else await api.invoices.createClient(body);
            await saved(`${body.name} saved.`);
          }}
        />
      ) : null}
      {dialog?.mode === 'produce' ? <ProduceDialog businessId={id} onLinked={load} onClose={() => setDialog(null)} /> : null}
      {dialog?.mode === 'tag' ? <TagDialog year={data.taxYear} businessId={id} onTagged={load} onClose={() => setDialog(null)} /> : null}
      <p className="warranties-cga">
        Totals run over the tax year, 1 April to 31 March. Asset values are the ones you enter. General information, not tax
        advice.
      </p>
    </div>
  );
}
