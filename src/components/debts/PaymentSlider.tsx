/**
 * "What if I paid…" — a preview only. Recalculates months left and the last
 * payment month with the same payoff maths as the card; never saves.
 */
import { useId, useState } from 'react';
import { formatNzd } from '../../api/client';
import { paymentSliderRange, projectedPaymentMonth, sliderPayment } from '../../lib/debtModel';
import { formatMonthYear, scheduleFor, type DebtFigures } from '../../lib/debtView';

export function PaymentSlider({ debt, todayYmd }: { debt: DebtFigures; todayYmd: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const current = debt.actualPaymentNzd ?? 0;
  const range = paymentSliderRange({
    currentPayment: current,
    balance: debt.outstandingNzd,
    annualRatePercent: debt.interestRatePercent ?? null,
    interestPeriod: debt.interestPeriod ?? null,
  });
  if (!range) return null;

  const payment = sliderPayment(current, range, offset);
  const base = scheduleFor(debt);
  const preview = scheduleFor(debt, payment);
  const baseMonths = base.kind === 'schedule' ? base.totalMonths : null;

  let result: string;
  if (preview.kind !== 'schedule') {
    result = `At ${formatNzd(payment)} a month this debt does not pay down.`;
  } else {
    const n = preview.totalMonths;
    const last = formatMonthYear(projectedPaymentMonth(todayYmd, n));
    let compare = '';
    if (offset !== 0 && baseMonths != null) {
      const diff = baseMonths - n;
      compare =
        diff > 0
          ? ` · ${diff} month${diff === 1 ? '' : 's'} sooner than at ${formatNzd(current)}`
          : diff < 0
            ? ` · ${-diff} month${diff === -1 ? '' : 's'} later than at ${formatNzd(current)}`
            : ` · same end month as at ${formatNzd(current)}`;
    } else if (offset !== 0) {
      compare = ` · at ${formatNzd(current)} it doesn’t pay down`;
    }
    result = `${n} payment${n === 1 ? '' : 's'} · last payment ${last}${compare}`;
  }

  return (
    <div className="payment-slider">
      <button
        type="button"
        className="debt-link-button"
        aria-expanded={open}
        aria-controls={open ? `${id}-body` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        What if I paid… <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open ? (
        <div id={`${id}-body`} className="payment-slider-body">
          <div className="payment-slider-head">
            <label htmlFor={id}>Monthly payment to {debt.name}</label>
            <strong className="money">{formatNzd(payment)}</strong>
          </div>
          <input
            id={id}
            type="range"
            min={range.minOffset}
            max={range.maxOffset}
            step={1}
            value={offset}
            aria-valuetext={`${formatNzd(payment)} a month`}
            onChange={(e) => setOffset(Number(e.target.value))}
          />
          <p className="payment-slider-result" aria-live="polite">
            {result}
          </p>
          <p className="muted small payment-slider-foot">
            Preview only — nothing is saved.{' '}
            {offset !== 0 ? (
              <button type="button" className="debt-link-button" onClick={() => setOffset(0)}>
                Reset to {formatNzd(current)}
              </button>
            ) : null}
          </p>
        </div>
      ) : null}
    </div>
  );
}
