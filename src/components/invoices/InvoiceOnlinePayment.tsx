/**
 * Invoice page: send the invoice to Stripe or Paddle for online payment, show the pay link, and
 * check its status now (KAN-73). Webhooks usually mark it paid within a minute on their own.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Invoice, InvoiceProviderLink, PaymentIntegrations } from '../../types';

export function InvoiceOnlinePayment({ invoice, onChanged }: { invoice: Invoice; onChanged: () => void }) {
  const [link, setLink] = useState<InvoiceProviderLink | null>(null);
  const [info, setInfo] = useState<PaymentIntegrations | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api.integrations.invoiceLink(invoice.id), api.integrations.status()])
      .then(([l, s]) => {
        setLink(l.link);
        setInfo(s);
      })
      .catch(() => {});
  }, [invoice.id]);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.');
    } finally {
      setBusy(false);
    }
  };

  const connected = (['stripe', 'paddle'] as const).filter((p) => info?.[p].connected);
  if (!link && (!connected.length || invoice.storedStatus !== 'sent' || invoice.balanceNzd <= 0)) return null;
  const name = (p: 'stripe' | 'paddle') => (p === 'stripe' ? 'Stripe' : 'Paddle');
  return (
    <section className="panel" aria-labelledby="online-pay-title">
      <h3 id="online-pay-title">Online payment</h3>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {link ? (
        <>
          <p className="small">
            In {name(link.provider)} · {link.status === 'paid' ? 'paid' : link.status === 'void' ? 'void' : link.status === 'failed' ? 'a payment failed' : 'waiting for payment'}
            {link.paymentUrl ? (
              <>
                {' '}·{' '}
                <a href={link.paymentUrl} target="_blank" rel="noreferrer">
                  Payment link
                </a>
              </>
            ) : null}
          </p>
          {link.status !== 'paid' && link.status !== 'void' ? (
            <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => api.integrations.syncInvoice(invoice.id))}>
              {busy ? 'Checking…' : 'Check now'}
            </button>
          ) : null}
        </>
      ) : (
        <>
          <p className="muted small">Create this invoice in your payment provider so the client can pay online. It’s marked paid here when they do.</p>
          <div className="row gap">
            {connected.map((p) => (
              <button key={p} type="button" className="btn small primary" disabled={busy} onClick={() => void run(() => api.integrations.pushInvoice(invoice.id, p))}>
                {busy ? 'Creating…' : `Create in ${name(p)}`}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
