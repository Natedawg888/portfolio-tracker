import { useId } from 'react';
import { Link } from 'react-router-dom';
import { formatNzd } from '../../api/client';
import type { RecurringItem } from '../../types';
import { seriesColour } from '../AssetLineChart';
import { MoreMenu } from '../MoreMenu';
import {
  billInitial,
  cadenceLine,
  dueInfo,
  monthlyNote,
  paidDate,
  possiblePaymentText,
  relativeDay,
} from '../../pages/billsView';

export function BillCard({
  bill,
  today,
  colourIndex,
  creditor,
  busy,
  onTogglePause,
  onEdit,
  onRemove,
  onLink,
}: {
  bill: RecurringItem;
  today: string;
  /** Active bills share their calendar dot colour; paused and cancelled have none. */
  colourIndex: number | undefined;
  creditor: { name: string; outstandingNzd: number } | null;
  busy: boolean;
  onTogglePause: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onLink: (transactionId: string) => void;
}) {
  const titleId = useId();
  const active = bill.status === 'active';
  const due = dueInfo(bill, today);
  const perMonth = monthlyNote(bill, formatNzd);
  const match = bill.possiblePayment;

  return (
    <article className={'card bills-card' + (active ? '' : ' bills-card--inactive')} aria-labelledby={titleId}>
      <div className="bills-card-head">
        <span
          className="bills-icon"
          aria-hidden="true"
          style={colourIndex != null ? { background: seriesColour(colourIndex) } : undefined}
        >
          {billInitial(bill.name)}
        </span>
        <div className="bills-card-title">
          <h4 id={titleId}>{bill.name}</h4>
          <p className="bills-card-sub">
            {cadenceLine(bill)}
            {!active ? <span className="bills-chip">{bill.status === 'paused' ? 'Paused' : 'Cancelled'}</span> : null}
          </p>
        </div>
        <p className="bills-card-amount">
          <span className="money">{formatNzd(bill.amountNzd)}</span>
          {perMonth ? <span className="bills-card-permonth">{perMonth}</span> : null}
        </p>
      </div>

      <dl className="bills-card-dates">
        <div>
          <dt>Next due</dt>
          <dd>
            {due ? (
              <>
                {due.date} ·{' '}
                <span className={due.soon ? 'bills-soon' : 'bills-when'}>{relativeDay(due.daysAway)}</span>
                {due.soon ? <span className="bills-chip bills-chip--soon">Due soon</span> : null}
              </>
            ) : (
              <span className="muted">—</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Last paid</dt>
          <dd>
            {bill.lastPaidDate ? (
              <>
                {paidDate(bill.lastPaidDate, today)} · <span className="money">{formatNzd(bill.lastPaidNzd)}</span>
              </>
            ) : (
              <span className="muted">—</span>
            )}
          </dd>
        </div>
      </dl>

      {match ? (
        <div className="bills-inline-suggest">
          <p>{possiblePaymentText(match, today, formatNzd)}</p>
          <button type="button" className="btn small" disabled={busy} onClick={() => onLink(match.transactionId)}>
            Link payment
          </button>
        </div>
      ) : null}

      {creditor ? (
        <Link to="/debts" className="bills-creditor">
          You also owe {creditor.name} <span className="money">{formatNzd(creditor.outstandingNzd)}</span>
          <span aria-hidden="true"> ›</span>
        </Link>
      ) : null}

      <div className="bills-card-actions">
        <button type="button" className="btn small" disabled={busy} onClick={onTogglePause}>
          {active ? 'Pause' : 'Resume'}
        </button>
        <MoreMenu menu label={`More actions for ${bill.name}`}>
          {(close) => (
            <>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="btn small"
                onClick={() => {
                  close();
                  onEdit();
                }}
              >
                Edit
              </button>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="btn small danger"
                disabled={busy}
                onClick={() => {
                  close();
                  onRemove();
                }}
              >
                Remove
              </button>
            </>
          )}
        </MoreMenu>
      </div>
    </article>
  );
}
