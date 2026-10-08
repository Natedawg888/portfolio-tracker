/**
 * Invoices list (KAN-71): totals, filters, the invoice table, CSV export and saved clients.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatNzd } from '../api/client';
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from '../lib/invoiceCalc';
import type { InvoiceClient, InvoiceListResponse } from '../types';
import { InvoiceStatusBadge } from '../components/InvoicePreview';

function formatDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ymd
    : new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

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

export function Invoices() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'' | InvoiceStatus>('');
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<InvoiceListResponse | null>(null);
  const [clients, setClients] = useState<InvoiceClient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.invoices
      .list({ status, clientId, from, to })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load invoices.');
      });
    return () => {
      cancelled = true;
    };
  }, [status, clientId, from, to, reload]);

  useEffect(() => {
    let cancelled = false;
    api.invoices
      .clients()
      .then((c) => {
        if (!cancelled) setClients(c);
      })
      .catch(() => {
        /* the list still works without saved clients */
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const t = data?.totals;
  const filtered = Boolean(status || clientId || from || to);

  return (
    <div className="stack invoices-page">
      <section className="panel">
        <div className="panel-heading">
          <h2 className="page-title">Invoices</h2>
          <div className="row gap" style={{ marginTop: 0 }}>
            <a className="btn small" href={api.invoices.csvUrl()} download>
              Export CSV
            </a>
            <button type="button" className="btn small primary" onClick={() => navigate('/invoices/new')}>
              New invoice
            </button>
          </div>
        </div>
        <p className="page-lead">
          Create, send and keep track of invoices. Your name, bank account and GST details come from{' '}
          <Link to="/settings?tab=business">Settings → Business</Link>.
        </p>
        <div className="invoice-totals-row" style={{ marginTop: '0.75rem' }}>
          <div className="card">
            <p className="eyebrow">Outstanding</p>
            <p className="stat-value">{t ? formatNzd(t.outstandingNzd) : '—'}</p>
          </div>
          <div className="card">
            <p className="eyebrow">Overdue</p>
            <p className={`stat-value${t && t.overdueNzd > 0 ? ' budget-over-text' : ''}`}>{t ? formatNzd(t.overdueNzd) : '—'}</p>
          </div>
          <div className="card">
            <p className="eyebrow">Paid this month</p>
            <p className="stat-value">{t ? formatNzd(t.paidThisMonthNzd) : '—'}</p>
          </div>
          <div className="card">
            <p className="eyebrow">Paid this tax year</p>
            <p className="stat-value">{t ? formatNzd(t.paidTaxYearNzd) : '—'}</p>
            {t ? <p className="muted small">Since {formatDate(t.taxYearStart)}</p> : null}
          </div>
        </div>
      </section>

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
        {!data ? (
          <p className="muted">Loading invoices…</p>
        ) : data.invoices.length === 0 ? (
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            {filtered ? 'No invoices match these filters.' : 'No invoices yet. Start with New invoice.'}
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
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <Link to={`/invoices/${inv.id}`}>{inv.number}</Link>
                    </td>
                    <td>{inv.clientName || <span className="muted">—</span>}</td>
                    <td>{formatDate(inv.issueDate)}</td>
                    <td>{formatDate(inv.dueDate)}</td>
                    <td>
                      <InvoiceStatusBadge status={inv.status} />
                    </td>
                    <td className="money" style={{ textAlign: 'right' }}>
                      {formatNzd(inv.totalNzd)}
                    </td>
                    <td className="money" style={{ textAlign: 'right' }}>
                      {inv.status === 'draft' || inv.status === 'void' ? <span className="muted">—</span> : formatNzd(inv.balanceNzd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ClientsPanel clients={clients} onChange={() => setReload((n) => n + 1)} />
    </div>
  );
}
