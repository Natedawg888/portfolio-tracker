/**
 * One debt: chips and balance, Log repayment + ⋯ (Edit / Delete), the payoff
 * timeline (or the does-not-pay-down warning, or a prompt for missing figures),
 * "What if I paid…", and a Details expander that hides blank fields.
 */
import { useId, useState, type FormEvent } from 'react';
import { formatNzd } from '../../api/client';
import { incomeTooLowForRatios } from '../../lib/incomeThreshold';
import { scheduleFor } from '../../lib/debtView';
import type { DebtPerson, DebtProductKind } from '../../types';
import { MoreMenu } from '../MoreMenu';
import { PaymentSlider } from './PaymentSlider';
import { PayoffTimeline } from './PayoffTimeline';

/** Edit-form fields a "+ …" prompt can jump to. */
export type DebtFormField = 'productKind' | 'interestRate' | 'minimumPayment' | 'actualPayment';

const PRODUCT_LABELS: Record<DebtProductKind, string> = {
  credit_card: 'Credit card',
  personal_loan: 'Personal loan',
  student_loan: 'Student loan',
  car_loan: 'Car loan',
  mortgage: 'Mortgage',
  bnpl: 'BNPL',
};

function rateText(rate: number): string {
  return `${Math.round(rate * 1000) / 1000}%`;
}

function interestChip(d: DebtPerson): { text: string; warn: boolean } {
  const rate = d.interestRatePercent;
  if (d.interestPeriod && rate == null) return { text: 'Rate not set', warn: true };
  if (d.interestPeriod && rate != null && rate > 0) {
    return { text: `${rateText(rate)} per year, ${d.interestPeriod === 'month' ? 'monthly' : 'yearly'}`, warn: false };
  }
  return { text: '0% interest', warn: false };
}

function termText(months: number): string {
  const whole = Math.max(0, Math.trunc(months));
  const y = Math.floor(whole / 12);
  const m = whole % 12;
  const parts: string[] = [];
  if (y) parts.push(`${y} year${y === 1 ? '' : 's'}`);
  if (m || !y) parts.push(`${m} month${m === 1 ? '' : 's'}`);
  return parts.join(' ');
}

export function DebtCard({
  debt,
  todayYmd,
  incomeMonthLabel,
  busy,
  onLogRepayment,
  onSavePayment,
  onEdit,
  onDelete,
}: {
  debt: DebtPerson;
  todayYmd: string;
  incomeMonthLabel: string;
  busy: boolean;
  onLogRepayment: (amount: number, date: string) => Promise<boolean>;
  onSavePayment: (amount: number) => Promise<boolean>;
  onEdit: (field?: DebtFormField) => void;
  onDelete: () => void;
}) {
  const ids = { details: useId(), log: useId(), pay: useId() };
  const [logOpen, setLogOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const chip = interestChip(debt);
  const owing = debt.outstandingNzd > 0;
  const schedule = scheduleFor(debt);
  const missingPayment = owing && debt.actualPaymentNzd == null;

  return (
    <article className="card debt-card" aria-labelledby={`${ids.details}-name`}>
      <header className="debt-card-head">
        <div className="debt-card-title">
          <h3 id={`${ids.details}-name`}>{debt.name}</h3>
          <div className="debt-chips">
            {debt.productKind ? <span className="debt-chip">{PRODUCT_LABELS[debt.productKind]}</span> : null}
            <span className="debt-chip">{debt.kind === 'corporation' ? 'Corporation' : 'Person'}</span>
            <span className={'debt-chip' + (chip.warn ? ' debt-chip--warn' : '')}>{chip.text}</span>
          </div>
        </div>
        <p className="debt-card-balance money">
          {formatNzd(debt.outstandingNzd)}
          <span className="budget-figure-note">balance</span>
        </p>
      </header>

      <div className="debt-card-actions">
        {owing ? (
          <button
            type="button"
            className="btn small primary"
            aria-expanded={logOpen}
            aria-controls={logOpen ? ids.log : undefined}
            onClick={() => setLogOpen((o) => !o)}
          >
            Log repayment
          </button>
        ) : null}
        <MoreMenu label={`More actions for ${debt.name}`}>
          {(close) => (
            <>
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  close();
                  onEdit();
                }}
              >
                Edit debt
              </button>
              <button
                type="button"
                className="btn small danger"
                disabled={busy}
                onClick={() => {
                  close();
                  onDelete();
                }}
              >
                Delete debt
              </button>
            </>
          )}
        </MoreMenu>
      </div>

      {logOpen ? (
        <LogRepaymentForm
          id={ids.log}
          name={debt.name}
          todayYmd={todayYmd}
          busy={busy}
          onCancel={() => setLogOpen(false)}
          onSave={async (amount, date) => {
            if (await onLogRepayment(amount, date)) setLogOpen(false);
          }}
        />
      ) : null}

      {!owing ? (
        <p className="debt-paid-off">
          <span aria-hidden="true">✓ </span>Paid off
        </p>
      ) : missingPayment ? (
        <MissingPaymentPrompt
          debt={debt}
          inputId={ids.pay}
          busy={busy}
          onSave={onSavePayment}
          onEdit={onEdit}
        />
      ) : schedule.kind === 'does_not_pay_down' ? (
        <p className="debt-warning" role="note">
          <span aria-hidden="true">⚠ </span>
          {debt.projectionText ?? 'At your current repayment rate: this debt does not pay down.'}
        </p>
      ) : schedule.kind === 'blank' ? (
        <div className="debt-prompt">
          <p>Add the interest rate to see when {debt.name} is paid off.</p>
          <button type="button" className="btn small" onClick={() => onEdit('interestRate')}>
            + Interest rate
          </button>
        </div>
      ) : (
        <PayoffTimeline payments={schedule.payments} fullPayment={debt.actualPaymentNzd ?? 0} todayYmd={todayYmd} />
      )}

      {owing && debt.actualPaymentNzd != null && debt.actualPaymentNzd > 0 ? (
        <PaymentSlider debt={debt} todayYmd={todayYmd} />
      ) : null}

      <DetailsExpander
        id={ids.details}
        debt={debt}
        open={detailsOpen}
        onToggle={() => setDetailsOpen((o) => !o)}
        incomeMonthLabel={incomeMonthLabel}
      />
    </article>
  );
}

function LogRepaymentForm({
  id,
  name,
  todayYmd,
  busy,
  onSave,
  onCancel,
}: {
  id: string;
  name: string;
  todayYmd: string;
  busy: boolean;
  onSave: (amount: number, date: string) => Promise<void>;
  onCancel: () => void;
}) {
  const amountId = useId();
  const dateId = useId();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayYmd);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter an amount greater than 0.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '2026-10-01') {
      setError('Pick a date on or after 1 Oct 2026.');
      return;
    }
    setError(null);
    void onSave(Math.round(n * 100) / 100, date);
  }

  return (
    <form
      id={id}
      className="plan-editor debt-log-form"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="plan-editor-row">
        <label htmlFor={amountId}>Repayment to {name} (NZD)</label>
        <input
          id={amountId}
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={busy}
          autoFocus
        />
        <label htmlFor={dateId}>Date</label>
        <input
          id={dateId}
          type="date"
          min="2026-10-01"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="btn small primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save repayment'}
        </button>
        <button type="button" className="btn small ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error ? (
        <p className="plan-editor-error" role="alert">{error}</p>
      ) : null}
    </form>
  );
}

function MissingPaymentPrompt({
  debt,
  inputId,
  busy,
  onSave,
  onEdit,
}: {
  debt: DebtPerson;
  inputId: string;
  busy: boolean;
  onSave: (amount: number) => Promise<boolean>;
  onEdit: (field?: DebtFormField) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const missing: Array<{ field: DebtFormField; label: string }> = [];
  if (!debt.productKind) missing.push({ field: 'productKind', label: '+ Kind' });
  if (debt.interestRatePercent == null) missing.push({ field: 'interestRate', label: '+ Interest rate' });
  if (debt.minimumPaymentNzd == null) missing.push({ field: 'minimumPayment', label: '+ Minimum payment' });

  return (
    <div className="debt-prompt">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(value);
          if (!value.trim() || !Number.isFinite(n) || n < 0) {
            setError('Enter a monthly payment of 0 or more.');
            return;
          }
          setError(null);
          void onSave(Math.round(n * 100) / 100);
        }}
      >
        <label htmlFor={inputId}>Add a monthly payment to see when {debt.name} is paid off</label>
        <div className="plan-editor-row">
          <input
            id={inputId}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="NZD per month"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="btn small primary" disabled={busy}>
            Save
          </button>
        </div>
        {error ? (
          <p className="plan-editor-error" role="alert">{error}</p>
        ) : null}
      </form>
      {missing.length > 0 ? (
        <div className="debt-missing-buttons">
          {missing.map((m) => (
            <button key={m.field} type="button" className="btn small ghost" onClick={() => onEdit(m.field)}>
              {m.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DetailsExpander({
  id,
  debt,
  open,
  onToggle,
  incomeMonthLabel,
}: {
  id: string;
  debt: DebtPerson;
  open: boolean;
  onToggle: () => void;
  incomeMonthLabel: string;
}) {
  const rows: Array<{ label: string; value: string }> = [];
  if (debt.minimumPaymentNzd != null) rows.push({ label: 'Minimum payment', value: `${formatNzd(debt.minimumPaymentNzd)} a month` });
  if (debt.actualPaymentNzd != null) rows.push({ label: 'Actual payment', value: `${formatNzd(debt.actualPaymentNzd)} a month` });
  if (debt.interestPeriod) {
    rows.push({
      label: 'Interest schedule',
      value: debt.interestPeriod === 'month' ? 'Added at the start of each month' : 'Added on 1 January each year',
    });
  }
  if ((debt.interestChargedNzd ?? 0) > 0) rows.push({ label: 'Interest added', value: formatNzd(debt.interestChargedNzd) });
  if (debt.interestPaidNzd != null) rows.push({ label: 'Interest paid', value: formatNzd(debt.interestPaidNzd) });
  if (debt.actualPaymentNzd != null) {
    const income = debt.recordedIncomeNzd ?? null;
    let value: string;
    if (income == null) value = `— no income recorded in ${incomeMonthLabel}`;
    else if (incomeTooLowForRatios(income)) value = `— only ${formatNzd(income)} income recorded in ${incomeMonthLabel}`;
    else if (debt.debtToIncome == null || !Number.isFinite(debt.debtToIncome)) value = '—';
    else value = new Intl.NumberFormat('en-NZ', { style: 'percent', maximumFractionDigits: 1 }).format(debt.debtToIncome);
    rows.push({ label: 'Debt-to-income', value });
  }
  if (debt.remainingTermMonths != null) rows.push({ label: 'Remaining term', value: termText(debt.remainingTermMonths) });
  if ((debt.repaidTotalNzd ?? 0) > 0) rows.push({ label: 'Repaid (all time)', value: formatNzd(debt.repaidTotalNzd) });
  if (debt.notes) rows.push({ label: 'Notes', value: debt.notes });

  if (rows.length === 0) return null;
  return (
    <div className="debt-details">
      <button
        type="button"
        className="debt-link-button"
        aria-expanded={open}
        aria-controls={open ? `${id}-details` : undefined}
        onClick={onToggle}
      >
        Details <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open ? (
        <dl id={`${id}-details`} className="debt-details-list">
          {rows.map((r) => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
