/**
 * Debts the signed-in user records. Figures stay blank until they are entered.
 * Payoff timeline, "What if I paid…" and debt-to-income use those figures only,
 * through the same payoff maths the server uses (src/lib/debtModel.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, formatNzd } from '../api/client';
import { beginPageRead, commitPageRead, invalidateAfterDebtEdit, readPageCache } from '../lib/pageDataCache';
import { usePageCacheValue } from '../lib/usePageCache';
import { MIN_INCOME_FOR_RATIOS_NZD } from '../lib/incomeThreshold';
import { showQuietToast } from '../lib/quietToast';
import { aucklandToday, monthBounds } from '../lib/debtModel';
import { debtsOverview } from '../lib/debtView';
import { DebtsSummary } from '../components/debts/DebtsSummary';
import { DebtCard, type DebtFormField } from '../components/debts/DebtCard';
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

type DebtsBundle = {
  rows: DebtPerson[];
  summary: DebtSummary;
  /** Sum of repayments dated this Auckland month; null if they could not be loaded. */
  repaidThisMonth: number | null;
};

/** Edit-form field ids, so a "+ …" prompt on a card can focus the right input. */
const FIELD_IDS: Record<DebtFormField, string> = {
  productKind: 'debt-field-kind',
  interestRate: 'debt-field-rate',
  minimumPayment: 'debt-field-minimum',
  actualPayment: 'debt-field-actual',
};

const DEBTS_KEY = 'debts';

export function Debts() {
  const initialDebts = readPageCache<DebtsBundle>(DEBTS_KEY);
  const cachedDebts = usePageCacheValue<DebtsBundle>(DEBTS_KEY);
  const [bundle, setBundle] = useState<DebtsBundle | null>(initialDebts ?? null);
  const shown = bundle ?? cachedDebts ?? null;
  const rows = shown?.rows ?? [];
  const summary = shown?.summary ?? null;
  const [error, setError] = useState<string | null>(null);
  const showingRef = useRef(shown != null);
  useEffect(() => {
    showingRef.current = shown != null;
  }, [shown]);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [focusField, setFocusField] = useState<DebtFormField | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [today] = useState(() => aucklandToday());
  const thisMonth = monthBounds(today);

  const load = useCallback(async () => {
    const stamp = beginPageRead(DEBTS_KEY);
    const bounds = monthBounds(aucklandToday());
    const [people, sum, repaid] = await Promise.all([
      api.debts.people(),
      api.debts.summary(),
      bounds
        ? api.debts
            .repayments({ from: bounds.from, to: bounds.to })
            .then((list) => list.reduce((s, r) => s + Number(r.amountNzd || 0), 0))
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    const next: DebtsBundle = { rows: people, summary: sum, repaidThisMonth: repaid };
    if (!commitPageRead(stamp, next)) return;
    setBundle(next);
    setError(null);
  }, []);

  // A "+ Kind / + Interest rate / …" prompt opens the form on that field.
  useEffect(() => {
    if (!showForm) return;
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const el = focusField ? document.getElementById(FIELD_IDS[focusField]) : null;
    (el ?? formRef.current?.querySelector<HTMLElement>('input, select'))?.focus({ preventScroll: true });
  }, [showForm, focusField, editingId]);

  useEffect(() => {
    let cancelled = false;
    load().catch((err: Error) => {
      if (cancelled) return;
      if (showingRef.current || readPageCache<DebtsBundle>(DEBTS_KEY) != null) {
        showQuietToast('Could not refresh debts — showing last data.', { kind: 'warn' });
        return;
      }
      setError(err.message);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setFocusField(null);
    setForm(emptyForm());
    setShowForm(true);
    setMsg(null);
  }

  function openEdit(debt: DebtPerson, field: DebtFormField | null = null) {
    setEditingId(debt.id);
    setForm(formFromDebt(debt));
    setFocusField(field);
    setShowForm(true);
    setMsg(null);
  }

  async function logRepayment(debt: DebtPerson, amount: number, date: string): Promise<boolean> {
    setMsg(null);
    setSaving(true);
    try {
      const r = await api.debts.addRepayment(debt.id, { amountNzd: amount, date, notes: null, transactionId: null });
      setMsg(`Logged ${formatNzd(amount)} to ${debt.name} · balance now ${formatNzd(r.person.outstandingNzd)}.`);
      invalidateAfterDebtEdit();
      await load();
      return true;
    } catch (err) {
      setMsg((err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function savePayment(debt: DebtPerson, amount: number): Promise<boolean> {
    setMsg(null);
    setSaving(true);
    try {
      await api.debts.updatePerson(debt.id, { actualPaymentNzd: amount });
      setMsg(`Saved a ${formatNzd(amount)} monthly payment for ${debt.name}.`);
      invalidateAfterDebtEdit();
      await load();
      return true;
    } catch (err) {
      setMsg((err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
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
      invalidateAfterDebtEdit();
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
      invalidateAfterDebtEdit();
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const incomeMonth = formatYearMonth(summary?.incomeMonth);
  const overview = debtsOverview(rows, today);

  return (
    <div className="budget-page">
      <header className="debts-header">
        <div>
          <h2 className="page-title">Debts</h2>
          <p className="muted small debts-header-line">A personal record of what you owe. Not advice to borrow or repay.</p>
        </div>
        <div className="debts-header-actions">
          <button
            type="button"
            className="btn small ghost"
            aria-expanded={howOpen}
            aria-controls={howOpen ? 'debts-how' : undefined}
            onClick={() => setHowOpen((o) => !o)}
          >
            How payoff works <span aria-hidden="true">{howOpen ? '▴' : '▾'}</span>
          </button>
          <button type="button" className="btn small primary" onClick={openCreate}>
            {showForm && !editingId ? 'Adding a debt' : 'Add debt'}
          </button>
        </div>
      </header>

      {howOpen ? (
        <section id="debts-how" className="card debts-how" aria-label="How payoff works">
          <div>
            <h3>Interest</h3>
            <p>
              Monthly: balance × annual rate ÷ 12, added on the 1st of each month. Yearly: balance × annual rate, added
              on 1 January. Nothing is added for periods before a rate was saved.
            </p>
          </div>
          <div>
            <h3>Payoff date</h3>
            <p>
              Uses only the debt’s balance, rate and actual monthly payment, starting next month. Blank until a payment
              is entered (and a rate, if interest recurs). If the payment doesn’t cover the interest, it says the debt
              doesn’t pay down.
            </p>
          </div>
          <div>
            <h3>Debt-to-income</h3>
            <p>
              Actual payment ÷ income recorded in {incomeMonth}
              {summary?.recordedIncomeNzd != null ? ` (${formatNzd(summary.recordedIncomeNzd)})` : ''}. Hidden when the
              payment is blank or that income is under {formatNzd(MIN_INCOME_FOR_RATIOS_NZD)}.
            </p>
          </div>
        </section>
      ) : null}

      {shown != null && rows.length > 0 ? (
        <DebtsSummary
          overview={overview}
          repaidThisMonth={shown.repaidThisMonth ?? null}
          monthLabel={thisMonth ? formatYearMonth(thisMonth.yearMonth) : 'this month'}
        />
      ) : null}

      {error && <p className="warn">{error}</p>}
      {msg && <div className="banner" role="status">{msg}</div>}

      {showForm && (
        <form ref={formRef} className="form-grid panel" onSubmit={onSubmit} style={{ marginBottom: '1rem' }}>
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
              id={FIELD_IDS.productKind}
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
              id={FIELD_IDS.interestRate}
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
              id={FIELD_IDS.minimumPayment}
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
              id={FIELD_IDS.actualPayment}
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
            <span className="muted small">A label for your records only. It doesn’t change interest, payoff or any total.</span>
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

      {shown == null && !error ? (
        <p className="muted">Loading debts…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No debts yet. Add one when you want a balance recorded.</p>
      ) : (
        <div className="debt-list">
          {rows.map((debt) => (
            <DebtCard
              key={debt.id}
              debt={debt}
              todayYmd={today}
              incomeMonthLabel={formatYearMonth(debt.incomeMonth ?? summary?.incomeMonth)}
              busy={saving}
              onLogRepayment={(amount, date) => logRepayment(debt, amount, date)}
              onSavePayment={(amount) => savePayment(debt, amount)}
              onEdit={(field) => openEdit(debt, field ?? null)}
              onDelete={() => void onDelete(debt)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
