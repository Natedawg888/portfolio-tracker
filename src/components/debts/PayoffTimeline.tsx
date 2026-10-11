/**
 * "N payments left · last payment Mon YYYY" and one block per remaining payment.
 * A final payment smaller than a full one gets a smaller, dimmer block and its amount.
 */
import { formatNzd } from '../../api/client';
import { projectedPaymentMonth } from '../../lib/debtModel';
import { formatMonthYear } from '../../lib/debtView';

/** Above this many payments the blocks get too small to read; text only. */
const MAX_TIMELINE_BLOCKS = 48;

export function PayoffTimeline({
  payments,
  fullPayment,
  todayYmd,
}: {
  payments: number[];
  fullPayment: number;
  todayYmd: string;
}) {
  const count = payments.length;
  if (count === 0) return null;
  const final = payments[count - 1];
  const partialFinal = final < fullPayment - 0.005;
  const lastMonth = formatMonthYear(projectedPaymentMonth(todayYmd, count));

  return (
    <div className="payoff-timeline">
      <p className="payoff-timeline-text">
        <strong>
          {count} payment{count === 1 ? '' : 's'} left
        </strong>{' '}
        · last payment {lastMonth}
        {partialFinal ? <span className="muted"> · Final payment {formatNzd(final)}</span> : null}
      </p>
      {count <= MAX_TIMELINE_BLOCKS ? (
        <div className="payoff-blocks" aria-hidden="true">
          {payments.map((_, i) => (
            <span
              key={i}
              className={'payoff-block' + (i === count - 1 && partialFinal ? ' payoff-block--partial' : '')}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
