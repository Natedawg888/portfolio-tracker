/**
 * Settings → Business (KAN-71): the top of an invoice as clients will see it, from the
 * unsaved form. Same layout, classes and wording as InvoicePreview and the PDF
 * (server/invoices/pdf.ts). Missing details show as marked placeholders, which the real
 * invoice leaves out.
 */
import type { BusinessProfile } from '../types';

function Missing({ children }: { children: string }) {
  return (
    <span className="biz-preview-missing">
      <span className="sr-only">Missing: </span>
      {children}
    </span>
  );
}

export function BusinessHeaderPreview({ profile: biz, nextNumber }: { profile: BusinessProfile; nextNumber: string | null }) {
  const title = biz.gstRegistered ? 'Tax invoice' : 'Invoice';
  const number = nextNumber ?? `${biz.invoicePrefix.trim() || 'INV-'}…`;
  const addressLines = biz.address
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return (
    <article className="invoice-paper biz-preview-paper" aria-label={`Preview: ${title} ${number}`}>
      <header className="invoice-paper-head">
        <div>
          <h3 className="invoice-paper-title">{title}</h3>
          <div className="invoice-paper-muted">{number}</div>
        </div>
        <div className="invoice-paper-from">
          {biz.businessName.trim() ? <strong>{biz.businessName}</strong> : <Missing>Your name or business name</Missing>}
          {addressLines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
          {biz.email.trim() ? <div>{biz.email}</div> : <div><Missing>Email</Missing></div>}
          {biz.phone.trim() ? <div>{biz.phone}</div> : null}
          {biz.gstRegistered ? (
            biz.gstNumber.trim() ? <div>GST No. {biz.gstNumber}</div> : <div><Missing>GST number</Missing></div>
          ) : null}
          {biz.nzbn.trim() ? <div>NZBN {biz.nzbn}</div> : null}
        </div>
      </header>
      {biz.gstRegistered ? (
        <p className="invoice-paper-note">Totals show GST at 15% and the total including GST.</p>
      ) : null}
      <section className="invoice-paper-section">
        <div className="invoice-paper-label">How to pay</div>
        {biz.bankAccount.trim() ? <div>Bank account: {biz.bankAccount}</div> : <div><Missing>Bank account</Missing></div>}
        <div>Please use {number} as the reference.</div>
      </section>
    </article>
  );
}
