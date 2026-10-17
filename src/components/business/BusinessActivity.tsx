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
import type { BusinessMoneyItem, InvoiceSummary } from '../../types';

const signed = (n: number) => `${n < 0 ? '−' : '+'}${formatNzd(Math.abs(n))}`;

function countedNote(m: BusinessMoneyItem): string {
  if (m.countedVia === 'invoice') return 'Counted through its invoice payment';
  if (m.countedVia === 'income') return 'Counted through the income row linked to it';
  return m.kind === 'income' ? 'Income' : m.amountNzd < 0 ? 'Cost' : 'Money in';
}

type Row = { date: string; key: string } & ({ type: 'invoice'; inv: InvoiceSummary } | { type: 'money'; m: BusinessMoneyItem });

export function BusinessActivity({ businessId, businessName, taxYear, invoices, money, busy, act, onTag }: {
  businessId: string;
  businessName: string;
  taxYear: number;
  invoices: InvoiceSummary[];
  money: BusinessMoneyItem[];
  busy: boolean;
  act: (fn: () => Promise<unknown>, note: string) => Promise<void>;
  onTag: () => void;
}) {
  const { start, end } = taxYearRange(taxYear);
  const rows: Row[] = [
    ...invoices.filter((i) => i.issueDate >= start && i.issueDate <= end).map((inv): Row => ({ type: 'invoice', inv, date: inv.issueDate, key: `inv:${inv.id}` })),
    ...money.map((m): Row => ({ type: 'money', m, date: m.date, key: `${m.kind}:${m.id}` })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  const name = businessName || 'this business';

  return (
    <section className="panel warranty-card" aria-labelledby="biz-activity">
      <div className="rental-card-head">
        <h3 id="biz-activity">Money in and out</h3>
        <div className="rental-card-actions">
          <Link className="btn small ghost" to={`/business/invoices/new?business=${encodeURIComponent(businessId)}`} aria-label={`New invoice for ${name}`}>
            + Invoice
          </Link>
          <button type="button" className="btn small ghost" disabled={busy} aria-label={`Tag transactions from Budget to ${name}`} onClick={onTag}>
            Tag transactions from Budget
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="business-activity-empty">
          <p>
            <strong>Nothing yet this tax year</strong>
          </p>
          <p className="muted small">Invoices and tagged transactions appear here together, and a deposit that pays an invoice is only counted once.</p>
        </div>
      ) : (
        <ul className="rental-entries">
          {rows.map((r) =>
            r.type === 'invoice' ? (
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
                  {r.m.kind === 'income' && r.m.countedVia === 'invoice' ? null : (
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
      {invoices.length > 0 ? (
        <p className="small">
          <Link to={`/business/invoices?business=${encodeURIComponent(businessId)}`}>All invoices for {name}</Link>
        </p>
      ) : null}
    </section>
  );
}
