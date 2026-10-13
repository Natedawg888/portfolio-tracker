/**
 * Invoices list (KAN-71): header, totals, filters, the invoice table, CSV export and saved clients.
 * With no invoices, a three-step checklist replaces the totals, filters, and empty clients card.
 * Each row has a status badge and a ⋯ menu. Mark paid opens the invoice page's payment dialog.
 * Visibility, badges, and which actions apply come from invoicesView.
 * Amounts, statuses, and dates come from the list response. Missing values show —.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatNzd } from '../api/client';
import { beginPageRead, commitPageRead, readPageCache } from '../lib/pageDataCache';
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from '../lib/invoiceCalc';
import type { BusinessProfile, Invoice, InvoiceClient, InvoiceListResponse, InvoiceSummary } from '../types';
import { InvoicePaymentDialog } from '../components/InvoicePaymentDialog';
import { MoreMenu } from '../components/MoreMenu';
import { InvoiceStatusBadge } from '../components/InvoicePreview';
import {
  BUSINESS_SETTINGS_HREF,
  INVOICE_MISSING,
  INVOICE_TOTALS,
  formatInvoiceDate,
  invoiceBalanceAmount,
  invoiceDateCell,
  invoiceRowActions,
  invoiceRowConfirm,
  invoiceRowMenuLabel,
  invoiceSetupSteps,
  invoiceTextCell,
  invoiceTotalAmount,
  invoicesChrome,
  visibleInvoiceCount,
  type BusinessDetails,
} from './invoicesView';

const STATUS_FILTERS: Array<{ value: '' | InvoiceStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  ...(Object.entries(INVOICE_STATUS_LABELS) as [InvoiceStatus, string][]).map(([value, label]) => ({ value, label })),
];

type ClientForm = { name: string; email: string; address: string; reference: string };

function ClientsPanel({ clients, onChange }: { clients: InvoiceClient[]; onChange: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<ClientForm>({ name: '', email: '', address: '', reference: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function start(c: InvoiceClient | null) {
    setEditing(c ? c.id : 'new');
    setForm(c ? { name: c.name, email: c.email, address: c.address, reference: c.reference } : { name: '', email: '', address: '', reference: '' });
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (editing === 'new') await api.invoices.createClient(form);
      else if (editing) await api.invoices.updateClient(editing, form);
      setEditing(null);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the client.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: InvoiceClient) {
    if (!window.confirm(`Remove ${c.name} from saved clients? Invoices keep their copy of the details.`)) return;
    try {
      await api.invoices.removeClient(c.id);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the client.');
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <h3>Clients</h3>
        <button type="button" className="btn small" onClick={() => start(null)}>
          Add client
        </button>
      </div>
      {editing ? (
        <div className="form-grid" style={{ marginTop: '0.5rem' }}>
          <label>
            Name
            <input value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Email
            <input type="email" value={form.email} maxLength={254} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="span-2">
            Address
            <textarea rows={2} value={form.address} maxLength={400} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </label>
          <label>
            Reference (optional)
            <input value={form.reference} maxLength={80} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </label>
          <div className="row gap" style={{ alignItems: 'end' }}>
            <button type="button" className="btn small primary" disabled={busy || !form.name.trim()} onClick={() => void save()}>
              Save client
            </button>
            <button type="button" className="btn small" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {clients.length === 0 ? (
        <p className="muted small">No saved clients yet. Add one here or while writing an invoice.</p>
      ) : (
        <div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Reference</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.email || <span className="muted">—</span>}</td>
                  <td>{c.reference || <span className="muted">—</span>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn small" onClick={() => start(c)}>
                      Edit
                    </button>{' '}
                    <button type="button" className="btn small danger" onClick={() => void remove(c)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FirstInvoicePanel({
  business,
  clientCount,
  onCreated,
}: {
  business: BusinessDetails | null;
  clientCount: number;
  onCreated: (client: InvoiceClient) => void;
}) {
  const steps = invoiceSetupSteps({ business, clientCount });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) nameRef.current?.focus();
  }, [adding]);

  async function saveClient(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.invoices.createClient({
        name: trimmed,
        email: email.trim(),
        address: '',
        reference: '',
      });
      setAdding(false);
      setName('');
      setEmail('');
      onCreated(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the client.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel invoice-start" aria-labelledby="invoice-start-title">
      <h3 id="invoice-start-title">Send your first invoice</h3>
      <ol className="invoice-steps">
        {steps.map((step, index) => (
          <li key={step.id} className={'invoice-step' + (step.done ? ' invoice-step--done' : '')}>
            <span className="invoice-step-mark" aria-hidden="true">
              {step.done ? '✓' : index + 1}
            </span>
            <div>
              <p className="invoice-step-title">
                {step.title}
                <span className="invoice-step-status">{step.done ? 'Done' : 'To do'}</span>
              </p>
              {step.id === 'business' && step.promptLead ? (
                <p className="invoice-step-action">
                  {step.promptLead} <Link to={BUSINESS_SETTINGS_HREF}>Settings → Business</Link>.
                </p>
              ) : null}
              {step.id === 'invoice' ? (
                <p className="invoice-step-action">
                  <Link className="btn small primary" to="/invoices/new">
                    Create the invoice
                  </Link>
                </p>
              ) : null}
              {step.id === 'client' && !step.done ? (
                adding ? (
                  <form className="form-grid invoice-step-form" onSubmit={(event) => void saveClient(event)}>
                    <label>
                      Name
                      <input
                        ref={nameRef}
                        value={name}
                        maxLength={120}
                        required
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <label>
                      Email (optional)
                      <input
                        type="email"
                        value={email}
                        maxLength={254}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </label>
                    <div className="row gap" style={{ alignItems: 'end' }}>
                      <button type="submit" className="btn small primary" disabled={busy || !name.trim()}>
                        Save client
                      </button>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => {
                          setAdding(false);
                          setError(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                    {error ? <p className="auth-error span-2" role="alert">{error}</p> : null}
                  </form>
                ) : (
                  <p className="invoice-step-action">
                    <button type="button" className="btn small" onClick={() => setAdding(true)}>
                      Add client
                    </button>
                  </p>
                )
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DashOr({ value }: { value: string }) {
  return value === INVOICE_MISSING ? <span className="muted">{INVOICE_MISSING}</span> : <>{value}</>;
}

function MoneyOrDash({ amount }: { amount: number | null }) {
  return amount == null ? <span className="muted">{INVOICE_MISSING}</span> : <>{formatNzd(amount)}</>;
}

function InvoiceRowMenu({
  inv,
  busy,
  onMarkPaid,
  onCommand,
}: {
  inv: InvoiceSummary;
  busy: boolean;
  onMarkPaid: (inv: InvoiceSummary) => void;
  onCommand: (inv: InvoiceSummary, action: 'mark-sent' | 'void' | 'duplicate' | 'delete') => void;
}) {
  const id = typeof inv.id === 'string' ? inv.id.trim() : '';
  if (!id) return <span className="muted">{INVOICE_MISSING}</span>;
  const actions = invoiceRowActions({
    storedStatus: inv.storedStatus,
    balanceNzd: inv.balanceNzd,
    paidNzd: inv.paidNzd,
  });
  return (
    <div className="invoice-row-menu">
      <MoreMenu menu label={invoiceRowMenuLabel(inv.number)}>
        {(close) =>
          actions.map((action) => {
            const className = 'btn small invoice-menu-item' + (action.danger ? ' danger' : '');
            if (action.id === 'open') {
              return (
                <Link key={action.id} role="menuitem" tabIndex={-1} className={className} to={`/invoices/${id}`} onClick={close}>
                  {action.label}
                </Link>
              );
            }
            if (action.id === 'edit') {
              return (
                <Link key={action.id} role="menuitem" tabIndex={-1} className={className} to={`/invoices/${id}/edit`} onClick={close}>
                  {action.label}
                </Link>
              );
            }
            if (action.id === 'pdf') {
              return (
                <a key={action.id} role="menuitem" tabIndex={-1} className={className} href={api.invoices.pdfUrl(id)} download onClick={close}>
                  {action.label}
                </a>
              );
            }
            if (action.id === 'markPaid') {
              return (
                <button
                  key={action.id}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={className}
                  disabled={busy}
                  onClick={() => {
                    close();
                    onMarkPaid(inv);
                  }}
                >
                  {action.label}
                </button>
              );
            }
            const command = action.id === 'markSent' ? 'mark-sent' : action.id;
            return (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={className}
                disabled={busy}
                onClick={() => {
                  close();
                  onCommand(inv, command);
                }}
              >
                {action.label}
              </button>
            );
          })
        }
      </MoreMenu>
    </div>
  );
}

const INVOICES_LIST_KEY = 'invoices:list';
const INVOICES_CLIENTS_KEY = 'invoices:clients';
const INVOICES_BUSINESS_KEY = 'invoices:business';

/** Which filters (and reload) a list response belongs to. */
function invoicesRequestKey(status: string, clientId: string, from: string, to: string, reload: number): string {
  return `${status}\0${clientId}\0${from}\0${to}\0${reload}`;
}

export function Invoices() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'' | InvoiceStatus>('');
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // The unfiltered list, clients and business details from this session show at
  // once (filters start empty); fresh responses replace them.
  const [cached] = useState(() => ({
    list: readPageCache<InvoiceListResponse>(INVOICES_LIST_KEY),
    clients: readPageCache<InvoiceClient[]>(INVOICES_CLIENTS_KEY),
    business: readPageCache<{ profile: BusinessProfile | null }>(INVOICES_BUSINESS_KEY),
  }));
  const [data, setData] = useState<InvoiceListResponse | null>(cached.list ?? null);
  const [appliedKey, setAppliedKey] = useState<string | null>(cached.list ? invoicesRequestKey('', '', '', '', 0) : null);
  const [catalogCount, setCatalogCount] = useState<number | null>(cached.list?.invoices.length ?? null);
  const [clients, setClients] = useState<InvoiceClient[]>(cached.clients ?? []);
  const [clientsSettled, setClientsSettled] = useState(cached.clients != null);
  const [business, setBusiness] = useState<BusinessProfile | null>(cached.business?.profile ?? null);
  const [businessSettled, setBusinessSettled] = useState(cached.business != null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [reload, setReload] = useState(0);

  const filtersActive = Boolean(status || clientId || from || to);
  const requestKey = invoicesRequestKey(status, clientId, from, to, reload);

  useEffect(() => {
    let cancelled = false;
    const unfiltered = !status && !clientId && !from && !to;
    const stamp = unfiltered ? beginPageRead(INVOICES_LIST_KEY) : null;
    api.invoices
      .list({ status, clientId, from, to })
      .then((d) => {
        if (stamp && !commitPageRead(stamp, d)) return;
        if (!cancelled) {
          setData(d);
          setAppliedKey(requestKey);
          setError(null);
          if (!status && !clientId && !from && !to) setCatalogCount(d.invoices.length);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load invoices.');
      });
    return () => {
      cancelled = true;
    };
  }, [status, clientId, from, to, reload, requestKey]);

  useEffect(() => {
    let cancelled = false;
    const stamp = beginPageRead(INVOICES_CLIENTS_KEY);
    api.invoices
      .clients()
      .then((c) => {
        if (!commitPageRead(stamp, c)) return;
        if (!cancelled) {
          setClients(c);
          setClientsSettled(true);
        }
      })
      .catch(() => {
        if (!cancelled) setClientsSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    const stamp = beginPageRead(INVOICES_BUSINESS_KEY);
    api.invoices
      .business()
      .then((profile) => {
        if (!commitPageRead(stamp, { profile })) return;
        if (!cancelled) {
          setBusiness(profile);
          setBusinessSettled(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBusiness(null);
          setBusinessSettled(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const invoiceCount = visibleInvoiceCount({
    filteredCount: data ? data.invoices.length : null,
    catalogCount,
    filtersActive,
    responseCurrent: appliedKey === requestKey,
  });
  const chrome =
    data != null && invoiceCount != null
      ? invoicesChrome({
          invoiceCount,
          clientCount: clients.length,
          taxYearStart: data.totals.taxYearStart,
        })
      : null;
  const checklistReady = Boolean(chrome?.showChecklist && clientsSettled && businessSettled);
  const t = data?.totals;

  async function openMarkPaid(inv: InvoiceSummary) {
    const id = inv.id.trim();
    if (!id) return;
    setError(null);
    setNotice(null);
    setRowBusy(true);
    try {
      const full = await api.invoices.get(id);
      const owing = full.storedStatus === 'sent' && typeof full.balanceNzd === 'number' && Number.isFinite(full.balanceNzd) && full.balanceNzd > 0;
      if (!owing) {
        setNotice('This invoice is no longer awaiting payment.');
        setReload((n) => n + 1);
        return;
      }
      setPaymentInvoice(full);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the payment.');
    } finally {
      setRowBusy(false);
    }
  }

  async function runRowCommand(inv: InvoiceSummary, action: 'mark-sent' | 'void' | 'duplicate' | 'delete') {
    const id = inv.id.trim();
    if (!id) return;
    if (action !== 'duplicate') {
      const message = invoiceRowConfirm(action === 'mark-sent' ? 'markSent' : action, {
        number: inv.number,
        storedStatus: inv.storedStatus,
      });
      if (!message || !window.confirm(message)) return;
    }
    setRowBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (action === 'delete') {
        await api.invoices.remove(id);
        setReload((n) => n + 1);
        return;
      }
      const next = await api.invoices.action(id, action);
      if (action === 'duplicate') {
        if (next.id) navigate(`/invoices/${next.id}/edit`);
        return;
      }
      setNotice(action === 'void' ? 'Invoice voided. It stays in your records.' : 'Marked as sent.');
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setRowBusy(false);
    }
  }

  function onClientCreated(client: InvoiceClient) {
    setClients((prev) => (prev.some((c) => c.id === client.id) ? prev : [...prev, client]));
    setClientsSettled(true);
    setReload((n) => n + 1);
  }

  return (
    <div className="stack invoices-page">
      <header className="invoices-header">
        <div>
          <h2 className="page-title">Invoices</h2>
          {chrome?.subtitle ? <p className="muted small invoices-header-line">{chrome.subtitle}</p> : null}
        </div>
        <div className="invoices-header-actions">
          {chrome?.showCsv ? (
            <a className="btn" href={api.invoices.csvUrl()} download>
              Export CSV
            </a>
          ) : null}
          <Link className="btn primary" to="/invoices/new">
            + New invoice
          </Link>
        </div>
      </header>

      {!data && error ? <p className="auth-error" role="alert">{error}</p> : null}
      {!data && !error ? <p className="muted">Loading invoices…</p> : null}
      {chrome?.showChecklist && !checklistReady ? <p className="muted">Loading invoices…</p> : null}

      {checklistReady ? (
        <FirstInvoicePanel business={business} clientCount={clients.length} onCreated={onClientCreated} />
      ) : null}

      {chrome?.showTotals && t ? (
        <section className="invoice-totals-row" aria-label="Invoice totals">
          {INVOICE_TOTALS.map((card) => {
            const value = t[card.field];
            return (
              <div className="card" key={card.id}>
                <p className="eyebrow">{card.label}</p>
                <p className={`stat-value${card.id === 'overdue' && value > 0 ? ' budget-over-text' : ''}`}>{formatNzd(value)}</p>
                {card.id === 'paidTaxYear' && t.taxYearStart?.trim() ? (
                  <p className="muted small">Since {formatInvoiceDate(t.taxYearStart)}</p>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      {chrome?.showFilters && data ? (
        <section className="panel">
          <div className="form-grid">
            <label>
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value as '' | InvoiceStatus)}>
                {STATUS_FILTERS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Client
              <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">All clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Issued from
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              Issued to
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          {notice ? (
            <p className="banner" role="status">
              {notice}
            </p>
          ) : null}
          {data.invoices.length === 0 ? (
            <p className="muted" style={{ marginTop: '0.75rem' }}>
              No invoices match these filters.
            </p>
          ) : (
            <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Client</th>
                    <th>Issued</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>Balance</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        {inv.id ? (
                          <Link to={`/invoices/${inv.id}`}>
                            <DashOr value={invoiceTextCell(inv.number)} />
                          </Link>
                        ) : (
                          <DashOr value={invoiceTextCell(inv.number)} />
                        )}
                      </td>
                      <td>
                        <DashOr value={invoiceTextCell(inv.clientName)} />
                      </td>
                      <td>
                        <DashOr value={invoiceDateCell(inv.issueDate)} />
                      </td>
                      <td>
                        <DashOr value={invoiceDateCell(inv.dueDate)} />
                      </td>
                      <td>
                        <InvoiceStatusBadge status={inv.status} />
                      </td>
                      <td className="money" style={{ textAlign: 'right' }}>
                        <MoneyOrDash amount={invoiceTotalAmount(inv.totalNzd)} />
                      </td>
                      <td className="money" style={{ textAlign: 'right' }}>
                        <MoneyOrDash amount={invoiceBalanceAmount(inv.status, inv.balanceNzd)} />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <InvoiceRowMenu
                          inv={inv}
                          busy={rowBusy}
                          onMarkPaid={(row) => void openMarkPaid(row)}
                          onCommand={(row, action) => void runRowCommand(row, action)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {chrome?.showClients && clientsSettled ? (
        <ClientsPanel clients={clients} onChange={() => setReload((n) => n + 1)} />
      ) : null}

      {paymentInvoice ? (
        <InvoicePaymentDialog
          invoice={paymentInvoice}
          onClose={() => setPaymentInvoice(null)}
          onDone={(next) => {
            setPaymentInvoice(null);
            setNotice(next.status === 'paid' ? 'Payment recorded. The invoice is paid.' : 'Payment recorded.');
            setReload((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
}
