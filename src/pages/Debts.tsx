/**
 * Debts the signed-in user records. Figures stay blank until they are entered.
 * Payoff text and debt-to-income are calculated from those figures only.
 */
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, formatNzd } from '../api/client';
import type {
  DebtCreditorKind,
  DebtInterestPeriod,
  DebtPerson,
  DebtProductKind,
  DebtSummary,
} from '../types';

const PRODUCT_OPTIONS: Array<{ value: DebtProductKind; label: string }> = [
  { value: 'credit_card', label: 'Credit card' },
  { value: 'personal_loan', label: 'Personal loan' },
  { value: 'student_loan', label: 'Student loan' },
  { value: 'car_loan', label: 'Car loan' },
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'bnpl', label: 'BNPL' },
];

type FormState = {
  name: string;
  kind: DebtCreditorKind;
  productKind: DebtProductKind | '';
  outstanding: string;
  isLoan: boolean;
  interestPeriod: '' | DebtInterestPeriod;
  interestRate: string;
  minimumPayment: string;
  actualPayment: string;
  remainingTerm: string;
  interestPaid: string;
  notes: string;
};

function emptyForm(): FormState {
  return {
    name: '',
    kind: 'person',
    productKind: '',
    outstanding: '',
    isLoan: false,
    interestPeriod: '',
    interestRate: '',
    minimumPayment: '',
    actualPayment: '',
    remainingTerm: '',
    interestPaid: '',
    notes: '',
  };
}

function formFromDebt(debt: DebtPerson): FormState {
  return {
    name: debt.name,
    kind: debt.kind === 'corporation' ? 'corporation' : 'person',
    productKind: debt.productKind ?? '',
    outstanding: String(debt.outstandingNzd),
    isLoan: debt.isLoan === true,
    interestPeriod: debt.interestPeriod ?? '',
    interestRate: debt.interestRatePercent == null ? '' : String(debt.interestRatePercent),
    minimumPayment: debt.minimumPaymentNzd == null ? '' : String(debt.minimumPaymentNzd),
    actualPayment: debt.actualPaymentNzd == null ? '' : String(debt.actualPaymentNzd),
    remainingTerm: debt.remainingTermMonths == null ? '' : String(debt.remainingTermMonths),
    interestPaid: debt.interestPaidNzd == null ? '' : String(debt.interestPaidNzd),
    notes: debt.notes ?? '',
  };
}

function productLabel(kind: DebtProductKind | null | undefined): string {
  return PRODUCT_OPTIONS.find((option) => option.value === kind)?.label ?? 'Kind not set';
}

function moneyOrBlank(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return formatNzd(n);
}

function formatRate(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const rounded = Math.round(n * 1000) / 1000;
  return `${rounded}% per year`;
}

function formatTerm(months: number | null | undefined): string {
  if (months == null || !Number.isFinite(months)) return '—';
  const whole = Math.max(0, Math.trunc(months));
  const years = Math.floor(whole / 12);
  const rem = whole % 12;
  const parts: string[] = [];
  if (years === 1) parts.push('1 year');
  else if (years > 1) parts.push(`${years} years`);
  if (rem === 1) parts.push('1 month');
  else if (rem > 1) parts.push(`${rem} months`);
  if (parts.length === 0) return '0 months';
  return parts.join(' ');
}

function formatDti(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return new Intl.NumberFormat('en-NZ', { style: 'percent', maximumFractionDigits: 1 }).format(ratio);
}

function scheduleLabel(period: DebtInterestPeriod | null | undefined): string {
  if (period === 'month') return 'Monthly, at the start of each month';
  if (period === 'year') return 'Yearly, at the start of each year';
  return 'Does not recur';
}

function formatYearMonth(ym: string | null | undefined): string {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return 'this month';
  const [y, m] = ym.split('-').map(Number);
  return new Intl.DateTimeFormat('en-NZ', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function optionalAmount(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return 'invalid';
  return n;
}

function optionalMonths(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) return 'invalid';
  return n;
}

export function Debts() {
  const [rows, setRows] = useState<DebtPerson[]>([]);
  const [summary, setSummary] = useState<DebtSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const load = useCallback(async () => {
    const [people, sum] = await Promise.all([api.debts.people(), api.debts.summary()]);
    setRows(people);
    setSummary(sum);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.debts
      .people()
      .then(async (people) => {
        const sum = await api.debts.summary();
        if (cancelled) return;
        setRows(people);
        setSummary(sum);
        setError(null);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
    setMsg(null);
  }

  function openEdit(debt: DebtPerson) {
    setEditingId(debt.id);
    setForm(formFromDebt(debt));
    setShowForm(true);
    setMsg(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const name = form.name.trim();
    if (!name) {
      setMsg('Enter a name for this debt.');
      return;
    }
    const outstanding = optionalAmount(form.outstanding);
    if (outstanding == null || outstanding === 'invalid') {
      setMsg('Enter the balance you owe, or 0 if it is paid off.');
      return;
    }
    const interestRate = optionalAmount(form.interestRate);
    if (interestRate === 'invalid' || (typeof interestRate === 'number' && interestRate > 100)) {
      setMsg('Interest rate is the annual percent you enter, from 0 to 100, or leave it blank.');
      return;
    }
    const minimumPayment = optionalAmount(form.minimumPayment);
    const actualPayment = optionalAmount(form.actualPayment);
    const interestPaid = optionalAmount(form.interestPaid);
    if (minimumPayment === 'invalid' || actualPayment === 'invalid' || interestPaid === 'invalid') {
      setMsg('Payments and interest paid must be blank or a non-negative NZD amount.');
      return;
    }
    const remainingTerm = optionalMonths(form.remainingTerm);
    if (remainingTerm === 'invalid') {
      setMsg('Remaining term is a whole number of months, or blank.');
      return;
    }
    const body = {
      name,
      kind: form.kind,
      notes: form.notes.trim() || null,
      outstandingNzd: outstanding,
      productKind: form.productKind || null,
      isLoan: form.isLoan,
      interestPeriod: form.interestPeriod || null,
      interestRatePercent: interestRate,
      minimumPaymentNzd: minimumPayment,
      actualPaymentNzd: actualPayment,
      remainingTermMonths: remainingTerm,
      interestPaidNzd: interestPaid,
    };
    setSaving(true);
    try {
      if (editingId) {
        await api.debts.updatePerson(editingId, body);
        setMsg(`Saved ${name}.`);
      } else {
        await api.debts.createPerson(body);
        setMsg(`Added ${name}.`);
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm());
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(debt: DebtPerson) {
    if (!window.confirm(`Delete this debt?\n\n${debt.name}`)) return;
    setMsg(null);
    setSaving(true);
    try {
      await api.debts.deletePerson(debt.id);
      if (editingId === debt.id) {
        setEditingId(null);
        setShowForm(false);
        setForm(emptyForm());
      }
      setMsg(`Deleted ${debt.name}.`);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const incomeMonth = formatYearMonth(summary?.incomeMonth);

  return (
    <div className="budget-page">
      <h2 className="page-title">Debts</h2>
      <p className="section-desc">
        Record credit cards, personal loans, student loans, car loans, mortgages, and BNPL.
        Balance, interest rate, payments, remaining term, and interest paid stay blank until you
        enter them. This is a personal record, not a recommendation to borrow or repay.
      </p>
      <p className="section-desc">
        A debt can be marked as a loan or left unmarked. If interest recurs, choose monthly or
        yearly. Monthly interest is added to that debt at the start of each month. Yearly interest
        is added at the start of each year, on 1 January. The amount added is your balance times
        the annual percent you entered, divided by 12 for a monthly schedule, or the full annual
        percent for a yearly schedule. Nothing is added for a period that passed before a rate was
        saved.
      </p>
      <p className="section-desc">
        The payoff line uses only that debt&apos;s balance, annual rate, and actual monthly payment.
        If the payment does not cover the interest, the line says the debt does not pay down.
        Debt-to-income divides the actual payment by income you recorded in {incomeMonth}. It stays
        blank when that income is missing, or when the actual payment is blank.
        {summary?.recordedIncomeNzd != null
          ? ` Income recorded in ${incomeMonth}: ${formatNzd(summary.recordedIncomeNzd)}.`
          : ` No income is recorded for ${incomeMonth}.`}
      </p>

      {error && <p className="warn">{error}</p>}
      {msg && <p className="muted">{msg}</p>}

      <div className="row gap" style={{ marginBottom: '0.75rem' }}>
        <button type="button" className="btn primary" onClick={openCreate}>
          {showForm && !editingId ? 'Adding a debt' : 'Add debt'}
        </button>
      </div>

      {showForm && (
        <form className="form-grid panel" onSubmit={onSubmit} style={{ marginBottom: '1rem' }}>
          <h3 className="span-2">{editingId ? 'Edit debt' : 'Add debt'}</h3>
          <label>
            Name
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </label>
          <label>
            Kind
            <select
              value={form.productKind}
              onChange={(e) =>
                setForm({ ...form, productKind: e.target.value as DebtProductKind | '' })
              }
            >
              <option value="">Not set</option>
              {PRODUCT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Creditor type
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as DebtCreditorKind })}
            >
              <option value="person">Person</option>
              <option value="corporation">Corporation</option>
            </select>
          </label>
          <label>
            Balance (NZD)
            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={form.outstanding}
              onChange={(e) => setForm({ ...form, outstanding: e.target.value })}
              required
            />
          </label>
          <label>
            Interest rate (% per year)
            <input
              type="number"
              step="0.001"
              min="0"
              max="100"
              inputMode="decimal"
              value={form.interestRate}
              onChange={(e) => setForm({ ...form, interestRate: e.target.value })}
              placeholder="Blank if unknown"
            />
          </label>
          <label>
            Interest schedule
            <select
              value={form.interestPeriod}
              onChange={(e) =>
                setForm({
                  ...form,
                  interestPeriod: e.target.value as '' | DebtInterestPeriod,
                })
              }
            >
              <option value="">Does not recur</option>
              <option value="month">Monthly, at the start of the month</option>
              <option value="year">Yearly, at the start of the year</option>
            </select>
          </label>
          <label>
            Minimum payment (NZD per month)
            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={form.minimumPayment}
              onChange={(e) => setForm({ ...form, minimumPayment: e.target.value })}
              placeholder="Blank if unknown"
            />
          </label>
          <label>
            Actual payment (NZD per month)
            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={form.actualPayment}
              onChange={(e) => setForm({ ...form, actualPayment: e.target.value })}
              placeholder="Blank if unknown"
            />
          </label>
          <label>
            Remaining term (months)
            <input
              type="number"
              step="1"
              min="0"
              inputMode="numeric"
              value={form.remainingTerm}
              onChange={(e) => setForm({ ...form, remainingTerm: e.target.value })}
              placeholder="Blank if unknown"
            />
          </label>
          <label>
            Interest paid (NZD)
            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={form.interestPaid}
              onChange={(e) => setForm({ ...form, interestPaid: e.target.value })}
              placeholder="Blank if unknown"
            />
          </label>
          <label className="span-2">
            Notes (optional)
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <label className="field checkbox-field span-2">
            <span className="inline-check">
              <input
                type="checkbox"
                checked={form.isLoan}
                onChange={(e) => setForm({ ...form, isLoan: e.target.checked })}
              />
              Mark as a loan
            </span>
          </label>
          <div className="span-2 row gap">
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save debt' : 'Add debt'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
                setForm(emptyForm());
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="muted">Loading debts…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No debts yet. Add one when you want a balance recorded.</p>
      ) : (
        <div className="debt-list">
          {rows.map((debt) => (
            <article key={debt.id} className="card">
              <h3>
                {debt.name}{' '}
                <span className="muted small">
                  {productLabel(debt.productKind)} · {debt.kind === 'corporation' ? 'Corporation' : 'Person'}
                </span>
              </h3>
              <dl className="debt-facts">
                <div>
                  <dt>Balance</dt>
                  <dd className="money">{formatNzd(debt.outstandingNzd)}</dd>
                </div>
                <div>
                  <dt>Interest rate</dt>
                  <dd>{formatRate(debt.interestRatePercent)}</dd>
                </div>
                <div>
                  <dt>Minimum payment</dt>
                  <dd className="money">{moneyOrBlank(debt.minimumPaymentNzd)}</dd>
                </div>
                <div>
                  <dt>Actual payment</dt>
                  <dd className="money">{moneyOrBlank(debt.actualPaymentNzd)}</dd>
                </div>
                <div>
                  <dt>Remaining term</dt>
                  <dd>{formatTerm(debt.remainingTermMonths)}</dd>
                </div>
                <div>
                  <dt>Interest paid</dt>
                  <dd className="money">{moneyOrBlank(debt.interestPaidNzd)}</dd>
                </div>
                <div>
                  <dt>Debt-to-income</dt>
                  <dd>{formatDti(debt.debtToIncome)}</dd>
                </div>
                <div>
                  <dt>Loan</dt>
                  <dd>{debt.isLoan ? 'Marked as a loan' : 'Not marked as a loan'}</dd>
                </div>
                <div>
                  <dt>Interest schedule</dt>
                  <dd>{scheduleLabel(debt.interestPeriod)}</dd>
                </div>
                <div>
                  <dt>Interest added</dt>
                  <dd className="money">{formatNzd(debt.interestChargedNzd ?? 0)}</dd>
                </div>
              </dl>
              {debt.projectionText ? (
                <p className="debt-projection">{debt.projectionText}</p>
              ) : (
                <p className="debt-projection muted small">
                  The payoff line stays blank until an actual payment is entered, and until an
                  annual percent is entered when interest recurs.
                </p>
              )}
              {debt.notes ? <p className="muted small">{debt.notes}</p> : null}
              <div className="row gap">
                <button type="button" className="btn small" onClick={() => openEdit(debt)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn small danger"
                  disabled={saving}
                  onClick={() => onDelete(debt)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
