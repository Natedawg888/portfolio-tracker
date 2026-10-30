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
import { EmployeeForm, employeeDraft } from '../components/business/EmployeeForm';
import { DeleteBusinessConfirm } from '../components/business/DeleteBusiness';
import { maskBankAccount, payFrequencyLabel, payRateText } from '../lib/employees';
import { AssetForm, MovementForm, assetDraft } from '../components/business/AssetForms';
import { WhatItOwns } from '../components/business/WhatItOwns';
import { BusinessActivity } from '../components/business/BusinessActivity';
import { ClientMeetings } from '../components/business/ClientMeetings';
import { StockCard } from '../components/business/StockCard';
import { BusinessPeople } from '../components/business/BusinessPeople';
import { useAuth } from '../auth/AuthContext';
import { MoreMenu } from '../components/MoreMenu';
import { showQuietToast } from '../lib/quietToast';
import { formatInvoiceDate } from './invoicesView';
import { aucklandToday } from '../lib/debtModel';
import type { BusinessAsset, BusinessDetail as Detail, BusinessEmployee, BusinessMoneyItem, InvoiceClient } from '../types';

type DialogState =
  | { mode: 'edit' }
  | { mode: 'add-asset'; preset?: { category: AssetCategory; name: string } }
  | { mode: 'edit-asset'; asset: BusinessAsset }
  | { mode: 'move'; asset: BusinessAsset }
  | { mode: 'add-client' }
  | { mode: 'edit-client'; client: InvoiceClient }
  | { mode: 'add-employee' }
  | { mode: 'edit-employee'; employee: BusinessEmployee }
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
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<Detail | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
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

  async function restore() {
    await act(() => api.business.restore(id), 'Restored. It’s back on Business.');
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
  // KAN-129: an accountant edits the books; a viewer only reads. Invoices, clients, meetings,
  // tagging and the net worth switch use the owner's own pages and money, so they stay theirs.
  const role = data.access?.role ?? 'owner';
  const isOwner = role === 'owner';
  const canEdit = role !== 'viewer';
  const details = [b.industry, b.nzbn ? `NZBN ${b.nzbn}` : null, b.gstRegistered ? `GST ${b.gstNumber}` : null].filter(Boolean).join(' · ');

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
            {b.archivedAt ? null : (
              <>
                <Link className="btn small" to={`/business/${encodeURIComponent(b.id)}/profit-loss`}>
                  Profit &amp; loss
                </Link>
                {b.gstRegistered ? (
                  <Link className="btn small" to={`/business/${encodeURIComponent(b.id)}/gst`}>
                    GST
                  </Link>
                ) : null}
                {isOwner ? (
                  <Link className="btn small primary" to={`/business/invoices/new?business=${encodeURIComponent(b.id)}`} aria-label={`New invoice for ${name}`}>
                    + Invoice
                  </Link>
                ) : null}
              </>
            )}
            {canEdit ? (
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
                  {b.archivedAt && isOwner ? (
                    <button type="button" role="menuitem" className="btn small business-menu-item" onClick={() => { close(); void restore(); }}>
                      Restore business
                    </button>
                  ) : null}
                  {!isOwner || (b.archivedAt && hasInvoices) ? null : (
                    <button
                      type="button"
                      role="menuitem"
                      className="btn small business-menu-item business-menu-danger"
                      aria-describedby={hasInvoices ? 'biz-delete-reason' : undefined}
                      onClick={() => { close(); setConfirmDelete(true); }}
                    >
                      Delete business…
                    </button>
                  )}
                  {isOwner && hasInvoices && !b.archivedAt ? (
                    <p id="biz-delete-reason" className="muted small business-menu-reason">
                      Has {invoiceWord}: you can archive it
                    </p>
                  ) : null}
                </>
              )}
            </MoreMenu>
            ) : null}
          </div>
        </div>
        <TaxYearSwitch year={data.taxYear} years={data.taxYears} onChange={setYear} />
        <nav className="business-books-nav" aria-label={`${name}’s books`}>
          {[
            ['stock', 'Stock'],
            ['sales', 'Sales'],
            ['suppliers', 'Suppliers & bills'],
            ['budget', 'Budget'],
          ].map(([path, label]) => (
            <Link key={path} className="btn small ghost" to={`/business/${encodeURIComponent(b.id)}/${path}`}>
              {label}
            </Link>
          ))}
        </nav>
        <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void onLogo(e)} />
      </header>

      {isOwner ? null : (
        <section className="panel business-role-note" role="status">
          <p>
            {role === 'accountant'
              ? 'You’re this business’s accountant: you can read and edit its books. Invoices, clients and meetings stay with the owner for now.'
              : 'You can view this business’s books but not change them.'}
          </p>
        </section>
      )}

      {b.archivedAt ? (
        <section className="panel business-archived-note" role="status">
          <p>
            <strong>Archived {formatInvoiceDate(aucklandToday(new Date(b.archivedAt)))}.</strong> Hidden from Business, your net worth and the invoice and
            client pickers. Everything is kept.
          </p>
          {isOwner ? (
            <button type="button" className="btn small" disabled={busy} onClick={() => void restore()}>
              Restore business
            </button>
          ) : null}
        </section>
      ) : null}

      {confirmDelete ? (
        <DeleteBusinessConfirm
          id={id}
          name={name}
          invoiceCount={data.invoices.length}
          onCancel={() => setConfirmDelete(false)}
          onDone={(message, archived) => {
            showQuietToast(message);
            if (archived) {
              setConfirmDelete(false);
              load();
            } else navigate('/business');
          }}
        />
      ) : null}

      {error ? <p className="auth-error" role="alert">{error}</p> : null}

      <section className="panel rental-summary business-summary" aria-label="This tax year">
        <BusinessFigures totals={t} assetsLabel="Business value" assetsNote={b.archivedAt ? 'Not counted while archived' : netWorthNote(b.countInNetWorth)} />
        {data.invoiceFigures.outstandingCount || data.invoiceFigures.paidNzd ? (
          <p className="small business-invoice-figures">
            <span>
              <strong>{formatNzd(data.invoiceFigures.outstandingNzd)}</strong> owed on {data.invoiceFigures.outstandingCount}{' '}
              {data.invoiceFigures.outstandingCount === 1 ? 'invoice' : 'invoices'}
            </span>
            {data.invoiceFigures.overdueCount ? (
              <span className="pnl-overdue">
                <strong>{formatNzd(data.invoiceFigures.overdueNzd)}</strong> overdue ({data.invoiceFigures.overdueCount})
              </span>
            ) : null}
            <span>
              <strong>{formatNzd(data.invoiceFigures.paidNzd)}</strong> paid this tax year
            </span>
          </p>
        ) : null}
        {b.archivedAt || !isOwner ? null : (
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
        )}
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
        {canEdit ? <TypeNote type={b.type} name={name} busy={busy} onChange={async (type) => {
          await api.business.update(id, { ...businessBody(b), type });
          showQuietToast(`${name} is now a ${businessTypeLabel(type).toLowerCase()}.`);
          load();
        }} /> : null}
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
        ownerTools={isOwner}
        readOnly={!canEdit}
      />

      <StockCard businessId={id} archived={b.archivedAt != null || !canEdit} />

      {isOwner ? <ClientMeetings businessId={id} businessName={b.name} archived={b.archivedAt != null} clients={data.clients} onClientsChanged={load} /> : null}

      <BusinessActivity
        businessId={id}
        businessName={b.name}
        taxYear={data.taxYear}
        invoices={data.invoices}
        money={data.money}
        records={data.records ?? []}
        busy={busy}
        act={act}
        onTag={() => setDialog({ mode: 'tag' })}
        ownerTools={isOwner}
      />

      {b.clientsEnabled ? (
        <section className="panel warranty-card" aria-labelledby="biz-clients">
          <div className="rental-card-head">
            <h3 id="biz-clients">Clients</h3>
            <div className="rental-card-actions">
              {isOwner ? (
              <button type="button" className="btn small ghost" disabled={busy} aria-label={`Add a client to ${name}`} onClick={() => setDialog({ mode: 'add-client' })}>
                + Client
              </button>
              ) : null}
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
                      {isOwner ? <Link to={`/business/clients/${c.id}`}>{c.name}</Link> : c.name}
                      {c.status === 'inactive' ? <span className="muted small"> · Inactive</span> : null}
                    </span>
                    <span className="muted small">{[c.contactPerson, c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details'}</span>
                  </div>
                  <span className="rental-entry-amount rental-entry-amount--out">
                    {formatNzd(c.billedNzd)}
                    {c.outstandingNzd > 0 ? <span className="muted small"> · {formatNzd(c.outstandingNzd)} owed</span> : null}
                  </span>
                  <span className="rental-entry-actions">
                    {isOwner ? (
                      <button type="button" className="link-btn" disabled={busy} aria-label={`Edit ${c.name}`} onClick={() => setDialog({ mode: 'edit-client', client: c })}>
                        Edit
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="panel warranty-card" aria-labelledby="biz-employees">
        <div className="rental-card-head">
          <h3 id="biz-employees">Employees</h3>
          <div className="rental-card-actions">
            {canEdit ? (
              <button type="button" className="btn small ghost" disabled={busy} aria-label={`Add an employee to ${name}`} onClick={() => setDialog({ mode: 'add-employee' })}>
                + Employee
              </button>
            ) : null}
          </div>
        </div>
        {data.employees.length === 0 ? (
          <p className="muted small">No employees yet. Keep their contact details, bank account, pay rate and pay day here.</p>
        ) : (
          <ul className="rental-entries">
            {data.employees.map((e) => {
              const rate = payRateText(e.payRateNzd, e.payUnit, formatNzd);
              return (
                <li key={e.id} className={'rental-entry business-employee' + (e.status === 'inactive' ? ' is-inactive' : '')}>
                  <div className="rental-entry-what">
                    <span>
                      {e.name}
                      {e.role ? <span className="muted"> · {e.role}</span> : null}
                      {e.status === 'inactive' ? <span className="muted small"> · No longer works here</span> : null}
                    </span>
                    <span className="muted small">{[e.email, e.phone].filter(Boolean).join(' · ') || 'No contact details'}</span>
                    {e.bankAccount ? (
                      <span className="muted small">
                        Bank <span className="business-employee-bank">{maskBankAccount(e.bankAccount)}</span>
                      </span>
                    ) : null}
                    {e.contract ? (
                      <span className="small">
                        <a href={e.contract.url} target="_blank" rel="noreferrer" download={e.contract.name} aria-label={`${e.name}’s contract: ${e.contract.name}`}>
                          Contract
                        </a>
                        <span className="muted"> · {e.contract.name}</span>
                      </span>
                    ) : null}
                  </div>
                  <span className="rental-entry-amount rental-entry-amount--out business-employee-pay">
                    {rate || <span className="muted small">No rate</span>}
                    <span className="muted small">
                      {payFrequencyLabel(e.payFrequency)}
                      {e.status === 'active' && e.nextPayDate ? ` · next ${formatInvoiceDate(e.nextPayDate)}` : ''}
                    </span>
                  </span>
                  <span className="rental-entry-actions">
                    {canEdit ? (
                    <>
                    <button type="button" className="link-btn" disabled={busy} aria-label={`Edit ${e.name}`} onClick={() => setDialog({ mode: 'edit-employee', employee: e })}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="link-btn"
                      disabled={busy}
                      aria-label={`Delete ${e.name}`}
                      onClick={() => void act(() => api.business.removeEmployee(e.id), `${e.name} deleted.`, `Delete ${e.name}? Their contact, bank and pay details${e.contract ? ', and their contract,' : ''} are removed.`)}
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

      <BusinessPeople key={id} businessId={id} businessName={b.name} myUserId={user?.id ?? null} />

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
      {dialog?.mode === 'add-employee' || dialog?.mode === 'edit-employee' ? (
        <EmployeeForm
          title={dialog.mode === 'add-employee' ? 'Add employee' : `Edit ${dialog.employee.name}`}
          initial={employeeDraft(dialog.mode === 'edit-employee' ? dialog.employee : null)}
          contract={dialog.mode === 'edit-employee' ? dialog.employee.contract : null}
          onClose={() => setDialog(null)}
          onSave={async (body, file, removeContract) => {
            const employee =
              dialog.mode === 'edit-employee' ? await api.business.updateEmployee(dialog.employee.id, body) : await api.business.createEmployee(id, body);
            let note = `${body.name} saved.`;
            // The employee is saved first; a contract that fails to upload doesn't undo that.
            try {
              if (file) await api.business.uploadContract(employee.id, file.data, file.name);
              else if (removeContract) await api.business.removeContract(employee.id);
            } catch (e) {
              note = `${note} The contract ${file ? 'didn’t upload' : 'wasn’t removed'}: ${errorText(e, 'try again from Edit')}.`;
            }
            await saved(note);
          }}
        />
      ) : null}
      {dialog?.mode === 'produce' ? <ProduceDialog businessId={id} onLinked={load} onClose={() => setDialog(null)} /> : null}
      {dialog?.mode === 'tag' || (isOwner && tagFromLink && dialog == null) ? <TagDialog year={data.taxYear} businessId={id} onTagged={load} onClose={closeTag} /> : null}
      <p className="muted small business-foot">Totals cover the tax year (1 April – 31 March). Values are the ones you enter. General information, not tax advice.</p>
    </div>
  );
}
