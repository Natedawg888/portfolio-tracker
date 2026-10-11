/**
 * One summary card: Money in, Money out, Net, Budget used, a month-progress bar,
 * an optional insight line and a "How this works" expander.
 */
import { useState } from 'react';
import { formatNzd } from '../../api/client';
import { useMoneyHidden } from '../../lib/privacy';
import type { BudgetUsed, MonthProgress, SpendInsight } from '../../lib/budgetView';

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export function BudgetSummary({
  moneyInNzd,
  moneyOutNzd,
  used,
  progress,
  insight,
  floorLabel,
}: {
  /** Null when income could not be loaded; never shown as $0. */
  moneyInNzd: number | null;
  moneyOutNzd: number;
  used: BudgetUsed;
  progress: MonthProgress;
  insight: SpendInsight | null;
  floorLabel: string;
}) {
  const [howOpen, setHowOpen] = useState(false);
  const moneyHidden = useMoneyHidden();
  const net = moneyInNzd == null ? null : moneyInNzd - moneyOutNzd;

  return (
    <section className="card budget-summary" aria-label="This month in numbers">
      <dl className="budget-summary-figures">
        <div>
          <dt>Money in</dt>
          <dd className="money">{formatNzd(moneyInNzd)}</dd>
        </div>
        <div>
          <dt>Money out</dt>
          <dd className="money">{formatNzd(moneyOutNzd)}</dd>
        </div>
        <div>
          <dt>Net this month</dt>
          <dd className={'money' + (net != null && net < 0 ? ' budget-net-negative' : '')}>
            {formatNzd(net)}
            {net != null && net < 0 && !moneyHidden ? (
              <span className="budget-figure-note"> more out than in</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Budget used</dt>
          {used ? (
            <dd className={'money' + (used.fraction > 1 ? ' budget-over-text' : '')}>
              {moneyHidden ? formatNzd(used.spent) : pct(used.fraction)}
              <span className="budget-figure-note">
                {' '}
                {formatNzd(used.spent)} of {formatNzd(used.planned)}
                {used.fraction > 1 ? ' · over plan' : ''}
              </span>
            </dd>
          ) : (
            <dd>
              —<span className="budget-figure-note"> no plans this month</span>
            </dd>
          )}
        </div>
      </dl>

      <div className="budget-month-progress">
        <div
          className="budget-month-progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress.fraction * 100)}
          aria-label="Month progress"
        >
          <span style={{ width: pct(progress.fraction) }} />
        </div>
        <p className="muted small">
          {progress.state === 'current'
            ? `${pct(progress.fraction)} of the month gone`
            : progress.state === 'past'
              ? 'Month complete'
              : 'Month not started'}
        </p>
      </div>

      {insight ? (
        <p className="budget-insight">
          <strong>{insight.largest.name}</strong> is your biggest spend ({formatNzd(insight.largest.spend)}) and has no plan
          · {formatNzd(insight.unplannedTotal)} spent without a plan this month.
        </p>
      ) : null}

      <button
        type="button"
        className="budget-how-toggle"
        aria-expanded={howOpen}
        aria-controls="budget-how-body"
        onClick={() => setHowOpen((o) => !o)}
      >
        How this works <span aria-hidden="true">{howOpen ? '▴' : '▾'}</span>
      </button>
      {howOpen ? (
        <ul id="budget-how-body" className="budget-how-body">
          <li>
            Months follow the Auckland calendar. Transactions are kept from {floorLabel}. Banks sync through Akahu; add
            cards Akahu can’t see (Nexo, GoMining…) by hand with “+ Add”.
          </li>
          <li>
            <strong>Money in</strong> is income received: income you add, bank credits in an income category, and paid
            dividends from Portfolio once they have an NZD value. A linked bank credit is counted once.
          </li>
          <li>
            <strong>Money out</strong> is spending: outflows in spending categories plus uncategorised outflows. Transfers
            are left out. For debt, only repayments count, never the balance you owe.
          </li>
          <li>
            <strong>Budget used</strong> compares spending in categories that have a plan with the total planned.
          </li>
          <li>Debt balances lower net worth on the Dashboard; they don’t count as spending here.</li>
        </ul>
      ) : null}
    </section>
  );
}
