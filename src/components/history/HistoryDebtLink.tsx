/**
 * Debt in one line, linking to the Debts page. Snapshot net worth already
 * subtracts debt, so this is context, not another figure to deduct.
 */
import { Link } from 'react-router-dom';
import { formatNzd } from '../../api/client';

export function HistoryDebtLink({
  year,
  outstandingNzd,
  repaidNzd,
}: {
  year: number;
  outstandingNzd: number;
  repaidNzd: number;
}) {
  return (
    <Link to="/debts" className="card debt-link-card">
      <span>
        Debt <strong className="money">{formatNzd(outstandingNzd)}</strong>
        {' · already subtracted above'}
        {repaidNzd !== 0 ? ` · ${formatNzd(repaidNzd)} repaid in ${year}` : ''}
      </span>
      <span className="debt-link-go">
        Debts <span aria-hidden="true">→</span>
      </span>
    </Link>
  );
}
