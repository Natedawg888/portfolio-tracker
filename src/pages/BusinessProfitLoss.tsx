/**
 * Profit & loss for one business (KAN-126): a tax year or a custom period; income and expenses
 * by category with what each line is made of; net profit; income vs expenses by month; and the
 * invoices still owed. Totals come from the server and match the business page for a tax year.
 * Part of the Business plan: without it the server answers 402 and this shows what it adds.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api, formatNzd } from '../api/client';
import { BusinessTabs, TaxYearSwitch, errorText } from '../components/business/BusinessUi';
import { BusinessPlanNote } from '../components/business/BusinessPlanNote';
import { MonthlyMoneyChart } from '../components/business/MonthlyMoneyChart';
import { BUSINESS_PLAN_REQUIRED, profitClass, taxYearLabel } from '../lib/business';
import { customPeriodError } from '../lib/profitLossView';
import { formatInvoiceDate } from './invoicesView';
import type { ProfitLoss, ProfitLossLine } from '../types';

type Period = { kind: 'year'; taxYear: number | null } | { kind: 'custom'; from: string; to: string };

const SOURCE_NOTE: Record<ProfitLossLine['source'], string> = {
  invoice: 'payments on your invoices',
  income: 'income tagged to this business',
  bank: 'bank transactions tagged to this business',
};

function Lines({ title, lines, total, empty }: { title: string; lines: ProfitLossLine[]; total: number; empty: string }) {
  return (
    <section className="panel warranty-card pnl-section" aria-labelledby={`pnl-${title}`}>
      <div className="rental-card-head">
        <h3 id={`pnl-${title}`}>{title}</h3>
        <span className="money">{formatNzd(total)}</span>
      </div>
      {lines.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <table className="pnl-table">
          <thead className="sr-only">
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={`${l.source}:${l.label}`}>
                <th scope="row">
                  {l.label}
                  <span className="muted small pnl-line-note">
                    {l.count} {l.count === 1 ? 'item' : 'items'} · {SOURCE_NOTE[l.source]}
                  </span>
                </th>
                <td className="num">{formatNzd(l.amountNzd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function BusinessProfitLoss() {
  const { id = '' } = useParams<{ id: string }>();
  const [period, setPeriod] = useState<Period>({ kind: 'year', taxYear: null });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<ProfitLoss | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.business
      .profitLoss(id, period.kind === 'year' ? { taxYear: period.taxYear } : { from: period.from, to: period.to })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLocked(false);
        setError(null);
        // Seed the custom inputs once, from the first period shown.
        setFrom((f) => f || d.start);
        setTo((t) => t || d.end);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === BUSINESS_PLAN_REQUIRED) setLocked(true);
        else setError(errorText(e, 'Could not load the profit & loss.'));
      });
    return () => {
      cancelled = true;
    };
  }, [id, period]);

  const customHint = customPeriodError(from, to);
  const backTo = `/business/${encodeURIComponent(id)}`;

  return (
    <div className="stack bills-page warranties-page rentals-page business-page pnl-page">
      <BusinessTabs />
      <header className="business-detail-header">
        <Link className="warranties-back" to={backTo}>
          ‹ {data?.businessName || 'Business'}
        </Link>
        <div className="business-detail-row">
          <div className="business-detail-name">
            <h2 className="page-title">Profit &amp; loss</h2>
            {data ? (
              <p className="muted small">
                {period.kind === 'year' && data.taxYear ? `${taxYearLabel(data.taxYear)} tax year · ` : ''}
                {formatInvoiceDate(data.start)} to {formatInvoiceDate(data.end)}
              </p>
            ) : null}
          </div>
        </div>
        {!locked ? (
          <div className="pnl-period">
            <div className="segmented" role="group" aria-label="Period">
              <button type="button" className={`segmented-btn${period.kind === 'year' ? ' active' : ''}`} aria-pressed={period.kind === 'year'} onClick={() => setPeriod({ kind: 'year', taxYear: data?.taxYear ?? null })}>
                Tax year
              </button>
              <button
                type="button"
                className={`segmented-btn${period.kind === 'custom' ? ' active' : ''}`}
                aria-pressed={period.kind === 'custom'}
                onClick={() => !customHint && setPeriod({ kind: 'custom', from, to })}
              >
                Custom
              </button>
            </div>
            {period.kind === 'year' && data ? (
              <TaxYearSwitch year={data.taxYear ?? data.taxYears[0]} years={data.taxYears} onChange={(y) => setPeriod({ kind: 'year', taxYear: y })} />
            ) : (
              <form
                className="pnl-custom"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!customHint) setPeriod({ kind: 'custom', from, to });
                }}
              >
                <label>
                  From
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label>
                  To
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </label>
                <button type="submit" className="btn small" disabled={customHint != null}>
                  Show
                </button>
                {customHint ? <span className="muted small">{customHint}</span> : null}
              </form>
            )}
          </div>
        ) : null}
      </header>

      {locked ? <BusinessPlanNote /> : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {!data && !locked && !error ? <p className="muted">Loading…</p> : null}

      {data && !locked ? (
        <>
          <section className="panel rental-summary business-summary" aria-label="Totals for the period">
            <dl className="rental-totals business-totals business-totals--three">
              <div>
                <dt>Income</dt>
                <dd>{formatNzd(data.incomeNzd)}</dd>
              </div>
              <div>
                <dt>Expenses</dt>
                <dd>{formatNzd(data.expensesNzd)}</dd>
              </div>
              <div>
                <dt>Net profit</dt>
                <dd className={profitClass(data.netNzd)}>{formatNzd(data.netNzd)}</dd>
              </div>
            </dl>
          </section>

          <section className="panel warranty-card">
            <MonthlyMoneyChart months={data.months} title="Income vs expenses by month" />
          </section>

          <div className="pnl-columns">
            <Lines title="Income" lines={data.income} total={data.incomeNzd} empty="No income tagged to this business in the period." />
            <Lines
              title="Expenses"
              lines={data.expenses}
              total={data.expensesNzd}
              empty="No expenses tagged to this business in the period. Tag bank debits on the business page to see them here."
            />
          </div>

          <section className="panel warranty-card pnl-invoices" aria-labelledby="pnl-invoices-title">
            <div className="rental-card-head">
              <h3 id="pnl-invoices-title">Invoices</h3>
              <Link className="btn small" to={`/business/invoices?business=${encodeURIComponent(id)}`}>
                Open invoices
              </Link>
            </div>
            <dl className="rental-totals business-totals business-totals--three">
              <div>
                <dt>Outstanding</dt>
                <dd>{formatNzd(data.invoices.outstandingNzd)}</dd>
                <dd className="business-figure-note">
                  {data.invoices.outstandingCount} {data.invoices.outstandingCount === 1 ? 'invoice' : 'invoices'}
                </dd>
              </div>
              <div>
                <dt>Overdue</dt>
                <dd className={data.invoices.overdueCount ? 'pnl-overdue' : undefined}>{formatNzd(data.invoices.overdueNzd)}</dd>
                <dd className="business-figure-note">
                  {data.invoices.overdueCount} {data.invoices.overdueCount === 1 ? 'invoice' : 'invoices'}
                </dd>
              </div>
              <div>
                <dt>Paid in the period</dt>
                <dd>{formatNzd(data.invoices.paidNzd)}</dd>
              </div>
            </dl>
          </section>

          <p className="muted small">
            Each dollar is counted once: an invoice payment and the bank deposit it matches count as one. Transfers between your own accounts are left out.
            Employee pay counts when its bank payment is tagged to the business.
          </p>
        </>
      ) : null}
    </div>
  );
}
