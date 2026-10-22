/**
 * Business → Clients (KAN-84). Without a client id: every client, by business, with what was
 * billed and what is still owed. With one (/business/clients/:clientId): that client's details,
 * invoices, total billed, amount outstanding and last payment.
 *
 * Client details are the user's own records under the NZ Privacy Act 2020; they are exported
 * with the account and deleted with it, and never shared with a household.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatNzd } from '../api/client';
import { BusinessTabs, errorText } from '../components/business/BusinessUi';
import { ClientForm, clientBody } from '../components/business/ClientForm';
import { InvoiceStatusBadge } from '../components/InvoicePreview';
import { formatInvoiceDate } from './invoicesView';
import { dayLabel, timeSpan } from '../lib/calendarView';
import type { BusinessCard, BusinessClientView, BusinessMeeting, InvoiceClient } from '../types';

function MeetingRows({ meetings }: { meetings: BusinessMeeting[] }) {
  return (
    <ul className="rental-entries">
      {meetings.map((m) => (
        <li key={m.id} className="rental-entry">
          <div className="rental-entry-what">
            <span>{m.title}</span>
            <span className="muted small">
              {dayLabel(m.date)} · {timeSpan(m)}
              {m.status !== 'scheduled' ? ` · ${m.status === 'done' ? 'Done' : 'Cancelled'}` : ''}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ClientView({ clientId, businesses }: { clientId: string; businesses: BusinessCard[] }) {
  const [view, setView] = useState<BusinessClientView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.business
      .client(clientId)
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e, 'Could not load this client.'));
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, reload]);

  if (!view) return error ? <p className="auth-error" role="alert">{error}</p> : <p className="muted">Loading…</p>;
  const c = view.client;
  const contact = [c.contactPerson, c.email, c.phone].filter(Boolean);
  return (
    <>
      <header className="warranties-header">
        <div>
          <Link className="warranties-back" to="/business/clients">
            ‹ All clients
          </Link>
          <h2 className="page-title">{c.name}</h2>
          <p className="muted small">
            {view.businessName ? `${view.businessName} · ` : ''}
            {c.status === 'inactive' ? 'Inactive' : 'Active'}
          </p>
        </div>
        <div className="warranties-header-actions">
          <button type="button" className="btn small" onClick={() => setEditing(true)}>
            Edit
          </button>
          {c.businessId ? (
            <>
              <Link className="btn small" to={`/calendar?new=1&business=${encodeURIComponent(c.businessId)}&client=${encodeURIComponent(c.id)}`}>
                + Meeting
              </Link>
              <Link className="btn small primary" to={`/business/invoices/new?business=${encodeURIComponent(c.businessId)}&client=${encodeURIComponent(c.id)}`}>
                + Invoice
              </Link>
            </>
          ) : null}
        </div>
      </header>
      <section className="panel rental-summary">
        <dl className="rental-totals">
          <div>
            <dt>Total billed</dt>
            <dd>{formatNzd(view.billedNzd)}</dd>
          </div>
          <div>
            <dt>Outstanding</dt>
            <dd className={view.outstandingNzd > 0 ? 'rental-net--loss' : undefined}>{formatNzd(view.outstandingNzd)}</dd>
          </div>
          <div>
            <dt>Last payment</dt>
            <dd>{view.lastPayment ? `${formatNzd(view.lastPayment.amountNzd)} on ${formatInvoiceDate(view.lastPayment.date)}` : '—'}</dd>
          </div>
        </dl>
        <p className="muted small">Billed counts sent invoices; void ones and drafts are left out.</p>
      </section>
      <section className="panel warranty-card">
        <h3>Details</h3>
        <p className="small">{contact.length ? contact.join(' · ') : <span className="muted">No contact details.</span>}</p>
        {c.address ? <p className="small business-pre">{c.address}</p> : null}
        {c.reference ? <p className="muted small">Reference on invoices: {c.reference}</p> : null}
        {c.notes ? <p className="muted small business-pre">{c.notes}</p> : null}
      </section>
      <section className="panel warranty-card">
        <h3>Meetings</h3>
        {view.meetings.next.length === 0 && view.meetings.past.length === 0 ? (
          <p className="muted small">No meetings with this client yet.</p>
        ) : null}
        {view.meetings.next.length > 0 ? (
          <>
            <p className="muted small">Next</p>
            <MeetingRows meetings={view.meetings.next} />
          </>
        ) : null}
        {view.meetings.past.length > 0 ? (
          <>
            <p className="muted small">Past</p>
            <MeetingRows meetings={view.meetings.past} />
          </>
        ) : null}
        <p className="small">
          <Link to="/calendar">Open the calendar</Link>
        </p>
      </section>
      <section className="panel warranty-card">
        <h3>Invoices</h3>
        {view.invoices.length === 0 ? (
          <p className="muted small">No invoices for this client yet.</p>
        ) : (
          <ul className="rental-entries">
            {view.invoices.map((inv) => (
              <li key={inv.id} className="rental-entry">
                <div className="rental-entry-what">
                  <span>
                    <Link to={`/business/invoices/${inv.id}`}>{inv.number}</Link>
                  </span>
                  <span className="muted small">
                    {formatInvoiceDate(inv.issueDate)} · <InvoiceStatusBadge status={inv.status} />
                  </span>
                </div>
                <span className="rental-entry-amount rental-entry-amount--out">
                  {formatNzd(inv.totalNzd)}
                  {inv.balanceNzd > 0 && inv.storedStatus === 'sent' ? <span className="muted small"> · {formatNzd(inv.balanceNzd)} owed</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {editing ? (
        <ClientForm
          title={`Edit ${c.name}`}
          initial={clientBody(c, c.businessId ?? '')}
          businesses={businesses}
          onClose={() => setEditing(false)}
          onSave={async (body) => {
            await api.invoices.updateClient(c.id, body);
            setEditing(false);
            setReload((n) => n + 1);
          }}
        />
      ) : null}
    </>
  );
}

export function BusinessClients() {
  const { clientId } = useParams<{ clientId: string }>();
  const [businesses, setBusinesses] = useState<BusinessCard[] | null>(null);
  const [clients, setClients] = useState<InvoiceClient[] | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.business.list(), api.invoices.clients()])
      .then(([l, c]) => {
        if (cancelled) return;
        setBusinesses(l.businesses);
        setClients(c);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e, 'Could not load clients.'));
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  if (clientId) {
    return (
      <div className="stack bills-page warranties-page rentals-page business-page">
        <BusinessTabs />
        <ClientView clientId={clientId} businesses={businesses ?? []} />
      </div>
    );
  }

  const withClients = (businesses ?? []).filter((b) => b.clientsEnabled);
  const shown = (clients ?? []).filter((c) => showInactive || c.status !== 'inactive');
  const inactiveCount = (clients ?? []).filter((c) => c.status === 'inactive').length;
  const defaultId = withClients.find((b) => b.isDefault)?.id ?? withClients[0]?.id ?? '';

  return (
    <div className="stack bills-page warranties-page rentals-page business-page">
      <BusinessTabs />
      <header className="warranties-header">
        <div>
          <h2 className="page-title">Clients</h2>
          <p className="muted small">Who you invoice. Client details stay in your account and aren’t shared with your household.</p>
        </div>
        {withClients.length > 0 ? (
          <div className="warranties-header-actions">
            <button type="button" className="btn small primary" onClick={() => setAdding(true)}>
              + Add client
            </button>
          </div>
        ) : null}
      </header>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {!clients && !error ? <p className="muted">Loading clients…</p> : null}
      {businesses && withClients.length === 0 ? (
        <section className="panel warranties-empty">
          <h3>No client lists yet</h3>
          <p>
            {businesses.length === 0 ? (
              <>
                <Link to="/business">Add a business</Link> first; each business can keep its own clients.
              </>
            ) : (
              'Client lists are switched off for your businesses. Turn one on in a business’s details.'
            )}
          </p>
        </section>
      ) : null}
      {inactiveCount > 0 ? (
        <label className="rental-money-toggle small">
          <span>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show {inactiveCount} inactive
          </span>
        </label>
      ) : null}
      {withClients.map((b) => {
        const mine = shown.filter((c) => c.businessId === b.id);
        return (
          <section key={b.id} className="panel warranty-card" aria-label={b.name}>
            <h3>
              <Link to={`/business/${b.id}`}>{b.name || 'Unnamed business'}</Link>
            </h3>
            {mine.length === 0 ? (
              <p className="muted small">No clients{showInactive ? '' : ' (active)'}.</p>
            ) : (
              <ul className="rental-entries">
                {mine.map((c) => (
                  <li key={c.id} className="rental-entry">
                    <div className="rental-entry-what">
                      <span>
                        <Link to={`/business/clients/${c.id}`}>{c.name}</Link>
                        {c.status === 'inactive' ? <span className="muted small"> · Inactive</span> : null}
                      </span>
                      <span className="muted small">{[c.contactPerson, c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details'}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {adding ? (
        <ClientForm
          title="Add client"
          initial={clientBody(null, defaultId)}
          businesses={withClients}
          onClose={() => setAdding(false)}
          onSave={async (body) => {
            await api.invoices.createClient(body);
            setAdding(false);
            setReload((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
}
