/**
 * Debts summary: Total owed, Paying each month, Repaid this month, Debt-free.
 */
import { formatNzd } from '../../api/client';
import { formatMonthYear, joinNames, type DebtsOverview, type PayoffBlocker } from '../../lib/debtView';

const BLOCKER_TEXT: Record<PayoffBlocker, string> = {
  needs_payment: 'needs a monthly payment',
  needs_rate: 'needs an interest rate',
  does_not_pay_down: 'payment doesn’t cover the interest',
};

export function DebtsSummary({
  overview,
  repaidThisMonth,
  monthLabel,
}: {
  overview: DebtsOverview;
  /** Null when repayments could not be loaded. */
  repaidThisMonth: number | null;
  monthLabel: string;
}) {
  const { owingCount } = overview;
  return (
    <section className="card budget-summary debts-summary" aria-label="Debts in numbers">
      <dl className="budget-summary-figures">
        <div>
          <dt>Total owed</dt>
          <dd className="money">
            {formatNzd(overview.totalOwed)}
            <span className="budget-figure-note">
              {owingCount} debt{owingCount === 1 ? '' : 's'} with a balance
            </span>
          </dd>
        </div>
        <div>
          <dt>Paying each month</dt>
          <dd className="money">
            {owingCount === 0 ? '—' : formatNzd(overview.payingEachMonth)}
            {overview.withoutPayment.length > 0 ? (
              <span className="budget-figure-note">No payment set for {joinNames(overview.withoutPayment)}</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Repaid in {monthLabel}</dt>
          <dd className="money">{formatNzd(repaidThisMonth)}</dd>
        </div>
        <div>
          <dt>Debt-free</dt>
          <dd>
            {overview.debtFreeMonth ? formatMonthYear(overview.debtFreeMonth) : '—'}
            {overview.blockers.length > 0 ? (
              <span className="budget-figure-note">
                {overview.blockers.map((b) => `${b.name} ${BLOCKER_TEXT[b.reason]}`).join('; ')}
              </span>
            ) : overview.debtFreeMonth ? (
              <span className="budget-figure-note">last projected payment</span>
            ) : owingCount === 0 ? (
              <span className="budget-figure-note">nothing owing</span>
            ) : null}
          </dd>
        </div>
      </dl>
    </section>
  );
}
