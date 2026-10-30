/**
 * One business → "Money in and out": invoices issued in the tax year (with their status) and the
 * transactions and income tagged to the business, in one list, newest first. Totals come from the
 * server; an item already counted through an invoice payment or linked income says so.
 */
import { Link } from 'react-router-dom';
import { api, formatNzd } from '../../api/client';
import { taxYearRange } from '../../lib/business';
import { formatInvoiceDate } from '../../pages/invoicesView';
import { InvoiceStatusBadge } from '../InvoicePreview';
import type { BusinessMoneyItem, BusinessRecordItem, InvoiceSummary } from '../../types';

const signed = (n: number) => `${n < 0 ? '−' : '+'}${formatNzd(Math.abs(n))}`;

function countedNote(m: BusinessMoneyItem): string {
  if (m.countedVia === 'invoice') return 'Counted through its invoice payment';
  if (m.countedVia === 'income') return 'Counted through the income row linked to it';
  if (m.countedVia === 'sale') return 'Counted through the sale linked to it';
  if (m.countedVia === 'bill') return 'Counted through the supplier bill it paid';
  if (m.countedVia === 'wage') return 'Counted through the wages it paid';
  return m.kind === 'income' ? 'Income' : m.amountNzd < 0 ? 'Cost' : 'Money in';
}

type Row = { date: string; key: string } & ({ type: 'invoice'; inv: InvoiceSummary } | { type: 'money'; m: BusinessMoneyItem } | { type: 'record'; r: BusinessRecordItem });

const RECORD_PAGE: Record<BusinessRecordItem['kind'], { path: string; note: string }> = {
  sale: { path: 'sales', note: 'Sale' },
  bill: { path: 'suppliers', note: 'Supplier bill paid' },
  wage: { path: 'budget', note: 'Wages paid' },
};

export function BusinessActivity({ businessId, businessName, taxYear, invoices, money, records = [], busy, act, onTag, ownerTools = true, invoiceTools = 'edit' }: {
  businessId: string;
  businessName: string;
  taxYear: number;
  invoices: InvoiceSummary[];
  money: BusinessMoneyItem[];
  /** Sales, paid bills and wages (KAN-123), each linking to its page. */
  records?: BusinessRecordItem[];
  busy: boolean;
  act: (fn: () => Promise<unknown>, note: string) => Promise<void>;
  onTag: () => void;
  /** Invoices and tagging use the owner's own pages and money, so they're the owner's (KAN-129). */
  ownerTools?: boolean;
  /** Invoices (KAN-129): an accountant adds and opens them, a viewer only opens them. */
  invoiceTools?: 'edit' | 'view';
}) {
  const { start, end } = taxYearRange(taxYear);
  const rows: Row[] = [
    ...invoices.filter((i) => i.issueDate >= start && i.issueDate <= end).map((inv): Row => ({ type: 'invoice', inv, date: inv.issueDate, key: `inv:${inv.id}` })),
    ...money.map((m): Row => ({ type: 'money', m, date: m.date, key: `${m.kind}:${m.id}` })),
    ...records.map((r): Row => ({ type: 'record', r, date: r.date, key: `${r.kind}:${r.id}` })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  const name = businessName || 'this business';

  return (
    <section className="panel warranty-card" aria-labelledby="biz-activity">
      <div className="rental-card-head">
        <h3 id="biz-activity">Money in and out</h3>
        <div className="rental-card-actions">
          {invoiceTools === 'edit' ? (
            <Link className="btn small ghost" to={`/business/invoices/new?business=${encodeURIComponent(businessId)}`} aria-label={`New invoice for ${name}`}>
              + Invoice
            </Link>
          ) : null}
          {ownerTools ? (
            <button type="button" className="btn small ghost" disabled={busy} aria-label={`Tag transactions from Budget to ${name}`} onClick={onTag}>
              Tag transactions from Budget
            </button>
          ) : null}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="business-activity-empty">
          <p>
            <strong>Nothing yet this tax year</strong>
          </p>
          <p className="muted small">Invoices, sales, paid bills, wages and tagged transactions appear here together. Each dollar is counted once: a deposit that pays an invoice or a sale, or a payment for a bill or wages, isn’t added again.</p>
        </div>
      ) : (
        <ul className="rental-entries">
          {rows.map((r) =>
            r.type === 'record' ? (
              <li key={r.key} className="rental-entry">
                <div className="rental-entry-what">
                  <span>
                    <Link to={`/business/${encodeURIComponent(businessId)}/${RECORD_PAGE[r.r.kind].path}`}>{r.r.description}</Link>
                  </span>
                  <span className="muted small">
                    {formatInvoiceDate(r.r.date)} · {RECORD_PAGE[r.r.kind].note}
                  </span>
                </div>
                <span className={'rental-entry-amount' + (r.r.amountNzd < 0 ? ' rental-entry-amount--out' : '')}>{signed(r.r.amountNzd)}</span>
                <span className="rental-entry-actions" />
              </li>
            ) : r.type === 'invoice' ? (
              <li key={r.key} className="rental-entry">
                <div className="rental-entry-what">
                  <span>
                    <Link to={`/business/invoices/${r.inv.id}`}>Invoice {r.inv.number}</Link> · {r.inv.clientName || 'No client'}
                  </span>
                  <span className="muted small">
                    {formatInvoiceDate(r.inv.issueDate)} · <InvoiceStatusBadge status={r.inv.status} />
                  </span>
                </div>
                <span className="rental-entry-amount rental-entry-amount--out">{formatNzd(r.inv.totalNzd)}</span>
                <span className="rental-entry-actions" />
              </li>
            ) : (
              <li key={r.key} className="rental-entry">
                <div className="rental-entry-what">
                  <span>{r.m.description}</span>
                  <span className="muted small">
                    {formatInvoiceDate(r.m.date)} · {countedNote(r.m)}
                  </span>
                </div>
                <span className={'rental-entry-amount' + (r.m.amountNzd < 0 || r.m.countedVia ? ' rental-entry-amount--out' : '')}>{signed(r.m.amountNzd)}</span>
                <span className="rental-entry-actions">
                  {!ownerTools || (r.m.kind === 'income' && r.m.countedVia === 'invoice') ? null : (
                    <button
                      type="button"
                      className="link-btn"
                      disabled={busy}
                      aria-label={`Untag ${r.m.description} from ${name}`}
                      onClick={() => void act(() => api.business.tag(r.m.kind, r.m.id, null), 'Untagged.')}
                    >
                      Untag
                    </button>
                  )}
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      {invoices.length > 0 && ownerTools ? (
        <p className="small">
          <Link to={`/business/invoices?business=${encodeURIComponent(businessId)}`}>All invoices for {name}</Link>
        </p>
      ) : null}
    </section>
  );
}
