/**
 * One business (KAN-84): header with its logo, type and tax year; money in, costs, profit and
 * what it owns for the selected NZ tax year, with the net worth switch; what it owns (assets and
 * produce); its clients (when switched on); and its invoices and tagged money in one list.
 * Totals come from the server, which counts each dollar once.
 */
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, formatNzd } from '../api/client';
import { IRD_GST_URL, businessTypeLabel, movementKindLabel, netWorthNote, type AssetCategory } from '../lib/business';
import { BusinessFigures, BusinessMark, BusinessTabs, Dialog, NetWorthSwitch, TaxYearSwitch, TypeNote, errorText } from '../components/business/BusinessUi';
import { BusinessForm, businessBody } from '../components/business/BusinessForm';
import { ClientForm, clientBody } from '../components/business/ClientForm';
import { AssetForm, MovementForm, assetDraft } from '../components/business/AssetForms';
import { WhatItOwns } from '../components/business/WhatItOwns';
import { BusinessActivity } from '../components/business/BusinessActivity';
import { MoreMenu } from '../components/MoreMenu';
import { ConfirmInline } from '../components/security/ConfirmInline';
import { showQuietToast } from '../lib/quietToast';
import { formatInvoiceDate } from './invoicesView';
import type { BusinessAsset, BusinessDetail as Detail, BusinessMoneyItem, InvoiceClient } from '../types';

type DialogState =
  | { mode: 'edit' }
  | { mode: 'add-asset'; preset?: { category: AssetCategory; name: string } }
  | { mode: 'edit-asset'; asset: BusinessAsset }
  | { mode: 'move'; asset: BusinessAsset }
  | { mode: 'add-client' }
  | { mode: 'edit-client'; client: InvoiceClient }
  | { mode: 'tag' }
  | { mode: 'produce' }
  | null;

const signed = (n: number) => `${n < 0 ? '−' : '+'}${formatNzd(Math.abs(n))}`;

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<Detail | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<Detail['business'][]>([]);
  const [reload, setReload] = useState(0);
  const logoInput = useRef<HTMLInputElement>(null);
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

  // Setup steps on the Overview link here with ?tag=1 to open the tag picker.
  const tagFromLink = searchParams.get('tag') === '1';
  function closeTag() {
    setDialog(null);
    if (tagFromLink) {
      const next = new URLSearchParams(searchParams);
      next.delete('tag');
      setSearchParams(next, { replace: true });
    }
  }

  async function act(fn: () => Promise<unknown>, note: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      showQuietToast(note);
      load();
    } catch (e) {
      setError(errorText(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  async function saved(note: string) {
    setDialog(null);
    showQuietToast(note);
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
  const name = b.name || 'Unnamed business';
  const others = businesses.length ? businesses : [b];
  const hasInvoices = data.invoices.length > 0;
  const invoiceWord = `${data.invoices.length} invoice${data.invoices.length === 1 ? '' : 's'}`;
  const details = [b.industry, b.nzbn ? `NZBN ${b.nzbn}` : null, b.gstRegistered ? `GST ${b.gstNumber}` : null].filter(Boolean).join(' · ');

  async function deleteBusiness() {
    setBusy(true);
    setDeleteError(null);
    try {
      await api.business.remove(id);
      showQuietToast(`${name} deleted.`);
      navigate('/business');
    } catch (e) {
      setDeleteError(errorText(e, 'Could not delete it.'));
      setBusy(false);
    }
  }

  return (
    <div className="stack bills-page warranties-page rentals-page business-page">
      <BusinessTabs />
      <header className="business-detail-header">
        <Link className="warranties-back" to="/business">
          ‹ All businesses
        </Link>
        <div className="business-detail-row">
          {b.logoUrl ? (
            <BusinessMark name={b.name} logoUrl={b.logoUrl} />
          ) : (
            <button type="button" className="business-mark business-mark--slot" aria-label={`Add a logo for ${name}`} disabled={busy} onClick={() => logoInput.current?.click()}>
              <span aria-hidden="true">{(b.name.trim()[0] ?? '?').toUpperCase()}</span>
            </button>
          )}
          <div className="business-detail-name">
            <h2 className="page-title">{name}</h2>
            <p className="business-detail-sub">
              <span className="business-type-chip">{businessTypeLabel(b.type)}</span>
              {details ? <span className="muted small">{details}</span> : null}
            </p>
          </div>
          <div className="business-detail-actions">
            <Link className="btn small primary" to={`/business/invoices/new?business=${encodeURIComponent(b.id)}`} aria-label={`New invoice for ${name}`}>
              + Invoice
            </Link>
            <MoreMenu label={`More actions for ${name}`} menu>
              {(close) => (
                <>
                  <button type="button" role="menuitem" className="btn small business-menu-item" onClick={() => { close(); setDialog({ mode: 'edit' }); }}>
                    Edit details
                  </button>
                  <button type="button" role="menuitem" className="btn small business-menu-item" onClick={() => { close(); logoInput.current?.click(); }}>
                    {b.logoUrl ? 'Change logo' : 'Add logo'}
                  </button>
                  {b.logoUrl ? (
                    <button type="button" role="menuitem" className="btn small business-menu-item" onClick={() => { close(); void act(() => api.business.removeLogo(id), 'Logo removed.'); }}>
                      Remove logo
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    className="btn small business-menu-item business-menu-danger"
                    disabled={hasInvoices}
                    aria-describedby={hasInvoices ? 'biz-delete-reason' : undefined}
                    onClick={() => { close(); setDeleteError(null); setConfirmDelete(true); }}
                  >
                    Delete business…
                  </button>
                  {hasInvoices ? (
                    <p id="biz-delete-reason" className="muted small business-menu-reason">
                      Has {invoiceWord}, which are kept on record
                    </p>
                  ) : null}
                </>
              )}
            </MoreMenu>
          </div>
        </div>
        <TaxYearSwitch year={data.taxYear} years={data.taxYears} onChange={setYear} />
        <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void onLogo(e)} />
      </header>

      {confirmDelete ? (
        <ConfirmInline
          title={`Delete ${name}?`}
          confirmLabel="Delete business"
          confirmAriaLabel={`Delete ${name}`}
          cancelLabel="Keep it"
          tone="danger"
          focus="cancel"
          busy={busy}
          error={deleteError}
          onConfirm={() => void deleteBusiness()}
          onCancel={() => setConfirmDelete(false)}
        >
          <p>
            <strong>Removed:</strong> its assets and their history, its clients, and its logo.
          </p>
          <p>
            <strong>Kept:</strong> transactions and income tagged to it stay in Budget and Income, and produce stays on Portfolio, all untagged. This can’t be undone.
          </p>
        </ConfirmInline>
      ) : null}

      {error ? <p className="auth-error" role="alert">{error}</p> : null}

      <section className="panel rental-summary business-summary" aria-label="This tax year">
        <BusinessFigures totals={t} assetsLabel="Business value" assetsNote={netWorthNote(b.countInNetWorth)} />
        <NetWorthSwitch
          on={b.countInNetWorth}
          busy={busy}
          name={b.name}
          onChange={(on) =>
            void act(
              () => api.business.update(id, { ...businessBody(b), countInNetWorth: on }),
              on ? `${name}’s assets now count in your net worth.` : `${name}’s assets no longer count in your net worth.`,
            )
          }
        />
        {t.outstandingNzd > 0 ? <p className="muted small">{formatNzd(t.outstandingNzd)} still owed on sent invoices.</p> : null}
        {t.gstCollectedEstimateNzd != null ? (
          <p className="muted small business-gst">
            GST in that money in, estimated at 3/23: <strong>{formatNzd(t.gstCollectedEstimateNzd)}</strong>. A rough guide only: it
            ignores zero-rated and exempt sales and the GST you can claim on costs. See{' '}
            <a href={IRD_GST_URL} target="_blank" rel="noreferrer">
              IRD’s GST guidance
            </a>
            .
          </p>
        ) : null}
        <TypeNote type={b.type} name={name} busy={busy} onChange={async (type) => {
          await api.business.update(id, { ...businessBody(b), type });
          showQuietToast(`${name} is now a ${businessTypeLabel(type).toLowerCase()}.`);
          load();
        }} />
      </section>

      <WhatItOwns
        businessId={id}
        businessName={b.name}
        assets={data.assets}
        produce={data.produce}
        assetsTotal={t.assetsNzd}
        today={today}
        busy={busy}
        act={act}
        onEditAsset={(a, preset) => setDialog(a ? { mode: 'edit-asset', asset: a } : { mode: 'add-asset', preset })}
        onMoveAsset={(a) => setDialog({ mode: 'move', asset: a })}
        onLinkExisting={() => setDialog({ mode: 'produce' })}
        onChanged={(note) => void saved(note)}
      />

      <BusinessActivity
        businessId={id}
        businessName={b.name}
        taxYear={data.taxYear}
        invoices={data.invoices}
        money={data.money}
        busy={busy}
        act={act}
        onTag={() => setDialog({ mode: 'tag' })}
      />

      {b.clientsEnabled ? (
        <section className="panel warranty-card" aria-labelledby="biz-clients">
          <div className="rental-card-head">
            <h3 id="biz-clients">Clients</h3>
            <div className="rental-card-actions">
              <button type="button" className="btn small ghost" disabled={busy} aria-label={`Add a client to ${name}`} onClick={() => setDialog({ mode: 'add-client' })}>
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
                    <span className="muted small">{[c.contactPerson, c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details'}</span>
                  </div>
                  <span className="rental-entry-amount rental-entry-amount--out">
                    {formatNzd(c.billedNzd)}
                    {c.outstandingNzd > 0 ? <span className="muted small"> · {formatNzd(c.outstandingNzd)} owed</span> : null}
                  </span>
                  <span className="rental-entry-actions">
                    <button type="button" className="link-btn" disabled={busy} aria-label={`Edit ${c.name}`} onClick={() => setDialog({ mode: 'edit-client', client: c })}>
                      Edit
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

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
          initial={
            dialog.mode === 'edit-asset'
              ? assetDraft(dialog.asset, today)
              : { ...assetDraft(null, today), ...(dialog.preset ? { category: dialog.preset.category, name: dialog.preset.name } : {}) }
          }
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
      {dialog?.mode === 'tag' || (tagFromLink && dialog == null) ? <TagDialog year={data.taxYear} businessId={id} onTagged={load} onClose={closeTag} /> : null}
      <p className="muted small business-foot">Totals cover the tax year (1 April – 31 March). Values are the ones you enter. General information, not tax advice.</p>
    </div>
  );
}
