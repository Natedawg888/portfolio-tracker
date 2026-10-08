/**
 * The invoice as the client sees it (KAN-71). Same layout as the PDF: used for the
 * editor's live preview, the invoice page and the public share link.
 * Amounts go through formatNzd, so they are masked when amounts are hidden.
 */
import { formatNzd } from '../api/client';
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from '../lib/invoiceCalc';
import type { PublicInvoice } from '../types';

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <span className={`invoice-status invoice-status-${status}`}>{INVOICE_STATUS_LABELS[status]}</span>;
}

function formatDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd || '—';
  return new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

function qty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10000) / 10000);
}

function Lines({ text }: { text: string }) {
  return (
    <>
      {text
        .split('\n')
        .filter((l) => l.trim())
        .map((l, i) => (
          <div key={i}>{l}</div>
        ))}
    </>
  );
}

export function InvoicePreview({ invoice: inv, money = formatNzd }: { invoice: PublicInvoice; money?: (n: number) => string }) {
  const biz = inv.business;
  return (
    <article className="invoice-paper" aria-label={`${inv.title} ${inv.number}`}>
      <header className="invoice-paper-head">
        <div>
          <h2 className="invoice-paper-title">{inv.title}</h2>
          <div className="invoice-paper-muted">{inv.number || 'No number yet'}</div>
          {inv.status === 'void' ? <div className="invoice-paper-void">VOID</div> : null}
          {inv.status === 'draft' ? <div className="invoice-paper-draft">Draft</div> : null}
        </div>
        <div className="invoice-paper-from">
          <strong>{biz.businessName || 'Your business name'}</strong>
          <Lines text={biz.address} />
          {biz.email ? <div>{biz.email}</div> : null}
          {biz.phone ? <div>{biz.phone}</div> : null}
          {biz.gstRegistered && biz.gstNumber ? <div>GST No. {biz.gstNumber}</div> : null}
          {biz.nzbn ? <div>NZBN {biz.nzbn}</div> : null}
        </div>
      </header>

      <section className="invoice-paper-parties">
        <div>
          <div className="invoice-paper-label">Bill to</div>
          <strong>{inv.clientName || '—'}</strong>
          <Lines text={inv.clientAddress} />
          {inv.clientEmail ? <div>{inv.clientEmail}</div> : null}
          {inv.clientReference ? <div className="invoice-paper-muted">Ref: {inv.clientReference}</div> : null}
        </div>
        <dl className="invoice-paper-meta">
          <dt>Invoice number</dt>
          <dd>{inv.number || '—'}</dd>
          <dt>Issue date</dt>
          <dd>{formatDate(inv.issueDate)}</dd>
          <dt>Due date</dt>
          <dd>{inv.dueDate === inv.issueDate ? 'On receipt' : formatDate(inv.dueDate)}</dd>
          {inv.reference ? (
            <>
              <dt>Reference / PO</dt>
              <dd>{inv.reference}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <div className="invoice-paper-table-wrap">
        <table className="invoice-paper-table">
          <thead>
            <tr>
              <th>Description</th>
              <th className="num">Qty</th>
              <th>Unit</th>
              <th className="num">{inv.gstMode === 'inclusive' ? 'Rate (incl. GST)' : 'Rate'}</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="invoice-paper-muted">
                  No lines yet.
                </td>
              </tr>
            ) : (
              inv.lines.map((l) => (
                <tr key={l.id}>
                  <td className="desc">{l.description || '—'}</td>
                  <td className="num">{qty(l.quantity)}</td>
                  <td className="invoice-paper-muted">{l.unit}</td>
                  <td className="num">{money(l.rate)}</td>
                  <td className="num">{money(l.lineTotalNzd)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <dl className="invoice-paper-totals">
        {inv.gstMode === 'none' ? (
          <>
            <dt className="strong">Total</dt>
            <dd className="strong">{money(inv.totalNzd)}</dd>
          </>
        ) : (
          <>
            <dt>Subtotal (excl. GST)</dt>
            <dd>{money(inv.subtotalNzd)}</dd>
            <dt>GST 15%</dt>
            <dd>{money(inv.gstNzd)}</dd>
            <dt className="strong">Total (incl. GST)</dt>
            <dd className="strong">{money(inv.totalNzd)}</dd>
          </>
        )}
        {inv.withholdingNzd > 0 ? (
          <>
            <dt>Less withholding tax ({inv.withholdingRatePct}%)</dt>
            <dd>−{money(inv.withholdingNzd)}</dd>
            <dt className="strong">Amount due</dt>
            <dd className="strong">{money(inv.amountDueNzd)}</dd>
          </>
        ) : null}
        {inv.paidNzd > 0 ? (
          <>
            <dt>Paid</dt>
            <dd>−{money(inv.paidNzd)}</dd>
            <dt className="strong">Balance due</dt>
            <dd className="strong">{money(inv.balanceNzd)}</dd>
          </>
        ) : null}
      </dl>
      {inv.withholdingNzd > 0 ? (
        <p className="invoice-paper-note">
          Withholding tax is on the GST-exclusive amount and is paid to Inland Revenue by the payer.
        </p>
      ) : null}
      {inv.gstMode === 'inclusive' ? <p className="invoice-paper-note">Prices include GST.</p> : null}
      {inv.status !== 'draft' && inv.status !== 'void' ? (
        <p className="invoice-paper-note">Status: {INVOICE_STATUS_LABELS[inv.status]}</p>
      ) : null}

      <section className="invoice-paper-section">
        <div className="invoice-paper-label">How to pay</div>
        {biz.bankAccount ? <div>Bank account: {biz.bankAccount}</div> : null}
        <div>Please use {inv.number || 'the invoice number'} as the reference.</div>
        <Lines text={inv.paymentInstructions} />
      </section>
      {inv.notes ? (
        <section className="invoice-paper-section">
          <div className="invoice-paper-label">Notes</div>
          <Lines text={inv.notes} />
        </section>
      ) : null}
    </article>
  );
}
