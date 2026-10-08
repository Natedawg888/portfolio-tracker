/**
 * Read-only invoice from a share link (KAN-71). No sign-in and no app chrome:
 * the page shows this one invoice and a PDF download, nothing else.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { InvoicePreview } from '../components/InvoicePreview';
import type { PublicInvoice as PublicInvoiceData } from '../types';

/** Amounts are always shown here: the hide-amounts switch belongs to the signed-in owner. */
function money(n: number): string {
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(n);
}

export function PublicInvoice() {
  const { token = '' } = useParams<{ token: string }>();
  const [inv, setInv] = useState<PublicInvoiceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.invoices
      .publicView(token)
      .then((d) => {
        if (!cancelled) {
          setInv(d);
          document.title = `${d.title} ${d.number}${d.business.businessName ? ` · ${d.business.businessName}` : ''}`;
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'This invoice link is not valid.');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <main className="public-invoice-page stack invoices-page">
      {error ? (
        <section className="panel">
          <h2>Invoice not available</h2>
          <p className="muted">{error}</p>
        </section>
      ) : !inv ? (
        <p className="muted">Loading invoice…</p>
      ) : (
        <>
          <div className="row gap" style={{ justifyContent: 'flex-end' }}>
            <a className="btn primary" href={api.invoices.publicPdfUrl(token)} download>
              Download PDF
            </a>
          </div>
          <InvoicePreview invoice={inv} money={money} />
        </>
      )}
    </main>
  );
}
