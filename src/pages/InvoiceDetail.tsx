/**
 * One invoice (KAN-71): preview, send, share link, payments and history.
 *
 * Sending: the user previews the email, then
 *  - opens it in their own email app (mailto: with the share link — no attachment possible), or
 *  - shares the PDF through the device share sheet (Web Share API, where supported), or
 *  - when the server has email set up, sends it from the app with the PDF attached.
 * After the first two the app asks whether it went, and only then records it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatNzd } from '../api/client';
import { InvoicePreview, InvoiceStatusBadge } from '../components/InvoicePreview';
import { mailtoHref } from '../lib/invoiceShare';
import type { Invoice } from '../types';

function formatDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ymd
    : new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat('en-NZ', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Pacific/Auckland' }).format(d);
}

function todayNz(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function errText(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt('Copy this:', text);
    return false;
  }
}

const CHANNEL_LABEL = { resend: 'Sent from the app', email_app: 'Sent from your email app', share: 'Shared from your device' } as const;

function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-overlay" role="presentation" onClick={(e) => (e.target === e.currentTarget ? onClose() : undefined)}>
      <div className={`modal-dialog${wide ? ' modal-dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="btn small modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SendDialog({
  invoice,
  kind,
  onClose,
  onDone,
}: {
  invoice: Invoice;
  kind: 'invoice' | 'reminder';
  onClose: () => void;
  onDone: (inv: Invoice, note: string) => void;
}) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [includeLink, setIncludeLink] = useState(true);
  const [link, setLink] = useState<string | null>(invoice.shareUrl);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askedChannel, setAskedChannel] = useState<'email_app' | 'share' | null>(null);
  const pdfFile = useRef<File | null>(null);
  const [canSharePdf, setCanSharePdf] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.invoices
      .emailDraft(invoice.id, kind)
      .then((d) => {
        if (cancelled) return;
        setTo(d.to.join(', '));
        setSubject(d.subject);
        setMessage(d.message);
        setEmailEnabled(d.emailEnabled);
        setProblem(d.problem);
        setReady(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errText(e, 'Could not prepare the email.'));
      });
    // Fetch the PDF now, so the share sheet can open straight from the button press.
    fetch(api.invoices.pdfUrl(invoice.id), { credentials: 'include' })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) return;
        const file = new File([blob], `${invoice.title === 'Tax invoice' ? 'Tax-invoice' : 'Invoice'}-${invoice.number}.pdf`, { type: 'application/pdf' });
        pdfFile.current = file;
        setCanSharePdf(typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }));
      })
      .catch(() => {
        /* share sheet just won't be offered */
      });
    return () => {
      cancelled = true;
    };
  }, [invoice.id, invoice.number, invoice.title, kind]);

  const recipients = to
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  async function ensureLink(): Promise<string | null> {
    if (!includeLink) return null;
    if (link) return link;
    const shared = await api.invoices.share(invoice.id);
    setLink(shared.shareUrl);
    return shared.shareUrl;
  }

  function bodyWith(l: string | null): string {
    return l ? `${message}\n\nView or download the invoice: ${l}` : message;
  }

  async function openEmailApp() {
    setError(null);
    try {
      const l = await ensureLink();
      window.location.href = mailtoHref(recipients, subject, bodyWith(l));
      setAskedChannel('email_app');
    } catch (e) {
      setError(errText(e, 'Could not create the share link.'));
    }
  }

  async function sharePdf() {
    setError(null);
    const file = pdfFile.current;
    if (!file) return;
    try {
      const l = includeLink ? link : null;
      await navigator.share({ files: [file], title: subject, text: bodyWith(l) });
      setAskedChannel('share');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(errText(e, 'Could not open the share sheet.'));
    }
  }

  async function confirmSent() {
    if (!askedChannel) return;
    setBusy(true);
    setError(null);
    try {
      const inv = await api.invoices.recordSend(invoice.id, {
        kind,
        channel: askedChannel,
        to: askedChannel === 'email_app' ? recipients : [],
        subject,
      });
      onDone(inv, kind === 'reminder' ? 'Reminder recorded.' : 'Invoice marked as sent.');
    } catch (e) {
      setError(errText(e, 'Could not record the send.'));
      setBusy(false);
    }
  }

  async function sendFromApp() {
    if (!window.confirm(`Send this ${kind === 'reminder' ? 'reminder' : 'invoice'} to ${recipients.join(', ')} now?`)) return;
    setBusy(true);
    setError(null);
    try {
      const inv = await api.invoices.send(invoice.id, { kind, to: recipients, subject, message, includeLink });
      onDone(inv, `Sent to ${recipients.join(', ')}.`);
    } catch (e) {
      setError(errText(e, 'Could not send.'));
      setBusy(false);
    }
  }

  const title = kind === 'reminder' ? `Send a reminder for ${invoice.number}` : `Send ${invoice.number}`;

  if (askedChannel) {
    return (
      <Dialog title={title} onClose={onClose}>
        <p>Did you send it?</p>
        <p className="muted small">
          {kind === 'invoice'
            ? 'Saying yes marks the invoice as sent and adds it to the history. You won’t be able to edit it after that.'
            : 'Saying yes adds the reminder to the history.'}
        </p>
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        <div className="row gap modal-actions">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void confirmSent()}>
            Yes, I sent it
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setAskedChannel(null)}>
            Not yet
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={title} onClose={onClose} wide>
      {!ready && !error ? <p className="muted">Preparing…</p> : null}
      {problem ? <p className="banner">{problem}</p> : null}
      {ready ? (
        <div className="form-grid">
          <label className="span-2">
            To
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.co.nz, accounts@example.co.nz" />
          </label>
          <label className="span-2">
            Subject
            <input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className="span-2">
            Message
            <textarea rows={8} value={message} maxLength={5000} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <label className="field checkbox-field span-2">
            <label className="inline-check">
              <input type="checkbox" checked={includeLink} onChange={(e) => setIncludeLink(e.target.checked)} />
              Include a link to view and download the invoice
            </label>
            <span className="muted small">
              {link
                ? `Link: ${link}`
                : 'A read-only link is created when you open your email app. You can turn it off on the invoice page at any time.'}
            </span>
          </label>
        </div>
      ) : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {ready ? (
        <>
          <div className="row gap modal-actions" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn primary" disabled={busy || Boolean(problem)} onClick={() => void openEmailApp()}>
              Open in my email app
            </button>
            {canSharePdf ? (
              <button type="button" className="btn" disabled={busy || Boolean(problem)} onClick={() => void sharePdf()}>
                Share PDF…
              </button>
            ) : null}
            <a className="btn" href={api.invoices.pdfUrl(invoice.id)} download>
              Download PDF
            </a>
            <button type="button" className="btn" onClick={() => void copyText(bodyWith(includeLink ? link : null))}>
              Copy message
            </button>
            {emailEnabled ? (
              <button type="button" className="btn" disabled={busy || Boolean(problem) || recipients.length === 0} onClick={() => void sendFromApp()}>
                Send from the app (PDF attached)
              </button>
            ) : null}
          </div>
          <p className="muted small" style={{ marginTop: '0.5rem' }}>
            Your email app can’t attach files from a link. Your client gets the invoice through the link, or attach the
            downloaded PDF yourself. On a phone, Share PDF sends the file by email, text or messaging apps.
          </p>
        </>
      ) : null}
    </Dialog>
  );
}

function PaymentDialog({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: (inv: Invoice) => void }) {
  const [date, setDate] = useState(todayNz());
  const [amount, setAmount] = useState(String(invoice.balanceNzd));
  const [method, setMethod] = useState('Bank transfer');
  const [notes, setNotes] = useState('');
  const [addToIncome, setAddToIncome] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onDone(await api.invoices.addPayment(invoice.id, { date, amountNzd: Number(amount), method, notes, addToIncome }));
    } catch (e) {
      setError(errText(e, 'Could not record the payment.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Record a payment on ${invoice.number}`} onClose={onClose}>
      <p className="muted small">Still owed: {formatNzd(invoice.balanceNzd)}</p>
      <div className="form-grid">
        <label>
          Date received
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Amount ($)
          <input type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          Method
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {['Bank transfer', 'Cash', 'Card', 'Cheque', 'Other'].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
          Note (optional)
          <input value={notes} maxLength={200} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label className="field checkbox-field span-2">
          <label className="inline-check">
            <input type="checkbox" checked={addToIncome} onChange={(e) => setAddToIncome(e.target.checked)} />
            Add to my income on Budget and Home
          </label>
          <span className="muted small">
            Tagged to this invoice. When the same deposit comes in from your bank, it’s matched so it isn’t counted twice.
          </span>
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="row gap modal-actions">
        <button type="button" className="btn primary" disabled={busy || !(Number(amount) > 0)} onClick={() => void save()}>
          Record payment
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

export function InvoiceDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'send' | 'reminder' | 'payment' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.invoices
      .get(id)
      .then((i) => {
        if (!cancelled) setInv(i);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errText(e, 'Could not load the invoice.'));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function act(fn: () => Promise<Invoice | void>, note: string | null, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const next = await fn();
      if (next) setInv(next);
      if (note) setMsg(note);
    } catch (e) {
      setError(errText(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  if (!inv) {
    return (
      <section className="panel invoices-page">
        {error ? <p className="auth-error" role="alert">{error}</p> : <p className="muted">Loading…</p>}
        <Link to="/invoices">Back to invoices</Link>
      </section>
    );
  }

  const isDraft = inv.storedStatus === 'draft';
  const isSent = inv.storedStatus === 'sent';
  const owing = isSent && inv.balanceNzd > 0;

  return (
    <div className="stack invoices-page">
      <section className="panel">
        <div className="panel-heading">
          <div className="row gap" style={{ marginTop: 0, alignItems: 'center' }}>
            <h2 className="page-title" style={{ margin: 0 }}>
              {inv.number}
            </h2>
            <InvoiceStatusBadge status={inv.status} />
          </div>
          <Link to="/invoices" className="btn small">
            All invoices
          </Link>
        </div>
        <p className="muted small">
          {inv.clientName || 'No client'} · issued {formatDate(inv.issueDate)} · due {formatDate(inv.dueDate)} · total{' '}
          {formatNzd(inv.totalNzd)}
          {isSent ? ` · ${formatNzd(inv.balanceNzd)} owing` : ''}
        </p>
        <div className="row gap" style={{ flexWrap: 'wrap' }}>
          {isDraft ? (
            <Link className="btn small" to={`/invoices/${inv.id}/edit`}>
              Edit
            </Link>
          ) : null}
          {isDraft || isSent ? (
            <button type="button" className="btn small primary" disabled={busy} onClick={() => setDialog('send')}>
              {isDraft ? 'Send…' : 'Send again…'}
            </button>
          ) : null}
          {owing ? (
            <button type="button" className={`btn small${inv.status === 'overdue' ? ' primary' : ''}`} disabled={busy} onClick={() => setDialog('reminder')}>
              Send reminder…
            </button>
          ) : null}
          {owing ? (
            <button type="button" className="btn small" disabled={busy} onClick={() => setDialog('payment')}>
              Record payment
            </button>
          ) : null}
          <a className="btn small" href={api.invoices.pdfUrl(inv.id)} download>
            Download PDF
          </a>
          {inv.storedStatus !== 'void' ? (
            inv.shareUrl ? (
              <>
                <button type="button" className="btn small" onClick={() => void copyText(inv.shareUrl!).then((ok) => setMsg(ok ? 'Share link copied.' : null))}>
                  Copy share link
                </button>
                <button
                  type="button"
                  className="btn small"
                  disabled={busy}
                  onClick={() => void act(() => api.invoices.unshare(inv.id), 'Share link turned off. The old link no longer works.', 'Turn off the share link? Anyone with the link will lose access.')}
                >
                  Turn off link
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn small"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const next = await api.invoices.share(inv.id);
                    if (next.shareUrl) await copyText(next.shareUrl);
                    return next;
                  }, 'Share link created and copied. It shows this invoice only, read-only.')
                }
              >
                Copy share link
              </button>
            )
          ) : null}
          {isDraft ? (
            <button
              type="button"
              className="btn small"
              disabled={busy}
              onClick={() => void act(() => api.invoices.action(inv.id, 'mark-sent'), 'Marked as sent.', 'Mark as sent without sending from here? You won’t be able to edit it after this.')}
            >
              Mark as sent
            </button>
          ) : null}
          <button
            type="button"
            className="btn small"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const copy = await api.invoices.action(inv.id, 'duplicate');
                navigate(`/invoices/${copy.id}/edit`);
              }, null)
            }
          >
            Duplicate
          </button>
          {isSent && inv.payments.length === 0 ? (
            <button
              type="button"
              className="btn small danger"
              disabled={busy}
              onClick={() => void act(() => api.invoices.action(inv.id, 'void'), 'Invoice voided. It stays in your records.', `Void ${inv.number}? It stays in your records but no longer counts as owed.`)}
            >
              Void
            </button>
          ) : null}
          {isDraft || inv.storedStatus === 'void' ? (
            <button
              type="button"
              className="btn small danger"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await api.invoices.remove(inv.id);
                  navigate('/invoices');
                }, null, `Delete ${isDraft ? 'draft' : 'void invoice'} ${inv.number}? This can’t be undone.`)
              }
            >
              {isDraft ? 'Delete draft' : 'Delete invoice'}
            </button>
          ) : null}
        </div>
        {msg ? <p className="banner" style={{ marginTop: '0.75rem' }}>{msg}</p> : null}
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
      </section>

      <InvoicePreview invoice={inv} />

      {isSent || inv.payments.length > 0 ? (
        <section className="panel">
          <h3>Payments</h3>
          {inv.payments.length === 0 ? (
            <p className="muted small">No payments recorded yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Note</th>
                    <th>In income</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {inv.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{formatDate(p.date)}</td>
                      <td>{p.method || '—'}</td>
                      <td>{p.notes || '—'}</td>
                      <td>{p.incomeRecordId ? 'Yes' : 'No'}</td>
                      <td className="money" style={{ textAlign: 'right' }}>
                        {formatNzd(p.amountNzd)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn small danger"
                          disabled={busy}
                          onClick={() => void act(() => api.invoices.removePayment(inv.id, p.id), 'Payment removed.', 'Remove this payment? Its income entry is removed too.')}
                        >
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
      ) : null}

      <section className="panel">
        <h3>History</h3>
        <ul className="muted small" style={{ paddingLeft: '1.1rem', margin: '0.35rem 0 0' }}>
          <li>Created {formatWhen(inv.createdAt)}</li>
          {inv.sentAt ? <li>Marked sent {formatWhen(inv.sentAt)}</li> : null}
          {inv.sends.map((s) => (
            <li key={s.id}>
              {s.kind === 'reminder' ? 'Reminder' : 'Invoice'} · {CHANNEL_LABEL[s.channel]}
              {s.recipients.length ? ` to ${s.recipients.join(', ')}` : ''} · {formatWhen(s.sentAt)}
              {s.status === 'failed' ? ` · failed: ${s.error ?? 'unknown error'}` : ''}
            </li>
          ))}
          {inv.voidedAt ? <li>Voided {formatWhen(inv.voidedAt)}</li> : null}
        </ul>
      </section>

      {dialog === 'send' || dialog === 'reminder' ? (
        <SendDialog
          invoice={inv}
          kind={dialog === 'reminder' ? 'reminder' : 'invoice'}
          onClose={() => setDialog(null)}
          onDone={(next, note) => {
            setInv(next);
            setDialog(null);
            setMsg(note);
          }}
        />
      ) : null}
      {dialog === 'payment' ? (
        <PaymentDialog
          invoice={inv}
          onClose={() => setDialog(null)}
          onDone={(next) => {
            setInv(next);
            setDialog(null);
            setMsg(next.status === 'paid' ? 'Payment recorded. The invoice is paid.' : 'Payment recorded.');
          }}
        />
      ) : null}
    </div>
  );
}
