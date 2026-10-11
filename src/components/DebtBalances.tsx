/**
 * Dashboard debt section: one bar per creditor, scaled to the largest outstanding
 * balance. Original loan amounts are not stored, so "paid off vs original" is not
 * shown; repaid-so-far comes from recorded repayments only.
 */
import { formatNzd } from '../api/client';
import { useMoneyHidden } from '../lib/privacy';
import { InfoTip } from './InfoTip';

export type DebtBreakdownPerson = {
  id: string;
  name: string;
  kind: 'person' | 'corporation';
  outstandingNzd: number;
  /** Sum of repayments recorded on Debts. */
  repaidTotalNzd?: number;
};

function outstanding(value: number): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

export function DebtBalances({ people, asOf }: { people: DebtBreakdownPerson[]; asOf?: string }) {
  const moneyHidden = useMoneyHidden();
  const rows = people
    .map((p) => ({ ...p, owed: outstanding(p.outstandingNzd) }))
    .sort((a, b) => b.owed - a.owed);
  const total = rows.reduce((sum, r) => sum + r.owed, 0);
  const max = Math.max(...rows.map((r) => r.owed), 0);

  return (
    <section className="panel debt-balances" aria-labelledby="debt-balances-title">
      <div className="debt-balances-head">
        <h2 id="debt-balances-title">
          Debt
          <InfoTip label="About debt">
            Outstanding NZD balances from your Debts records. Repayments reduce these balances. Debt lowers net worth; it
            is not counted as spending. Original loan amounts aren&apos;t recorded, so progress against them can&apos;t be
            shown. Manage debts on the Debts page.{asOf ? ` Updated ${asOf} NZT.` : ''}
          </InfoTip>
        </h2>
        {rows.length > 0 ? (
          <p className="debt-balances-total">
            <span className="muted small">Total owed</span> <strong className="money">{formatNzd(total)}</strong>
          </p>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="muted small">No debts recorded.</p>
      ) : (
        <ul className="debt-balances-list">
          {rows.map((r) => (
            <li key={r.id}>
              <div className="debt-balances-row">
                <span className="debt-balances-name">{r.name}</span>
                <span className="money">{formatNzd(r.owed)}</span>
              </div>
              {moneyHidden ? null : (
                <div className="debt-balances-bar" aria-hidden="true">
                  <span
                    className={r.owed > 0 ? 'debt-balances-fill debt-balances-fill--some' : 'debt-balances-fill'}
                    style={{ width: `${max > 0 ? (r.owed / max) * 100 : 0}%` }}
                  />
                </div>
              )}
              {(r.repaidTotalNzd ?? 0) > 0 ? (
                <p className="muted small debt-balances-meta">Repaid so far {formatNzd(r.repaidTotalNzd)}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
