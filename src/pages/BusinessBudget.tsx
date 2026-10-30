/**
 * One business's budget (KAN-123), separate from the personal budget: planned vs actual for each
 * category over a tax year, gross and net profit, plans per month or per year, its own
 * categories, wages paid, and putting tagged bank money in a category. Actuals fill in from sales,
 * paid bills, wages and tagged money (server/business/budget.ts); nothing here is typed as an
 * actual. Viewers see the figures only (KAN-129).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatNzd, type BudgetCategoryWriteBody } from '../api/client';
import { BusinessTabs, Dialog, FormActions, TaxYearSwitch, errorText } from '../components/business/BusinessUi';
import { useBusinessInfo } from '../components/business/useBusinessInfo';
import { profitClass, taxYearLabel, taxYearRange } from '../lib/business';
import { ROLE_NOTES, monthLabel, planInputs, planPercent, plansFromInputs, spreadEvenly, variance } from '../lib/businessBudgetView';
import { aucklandToday } from '../lib/debtModel';
import { showQuietToast } from '../lib/quietToast';
import { formatInvoiceDate } from './invoicesView';
import type { BusinessBudgetLine, BusinessBudgetView, BusinessWagePayment } from '../types';

type DialogState = { mode: 'plan'; line: BusinessBudgetLine } | { mode: 'category'; line: BusinessBudgetLine | null } | { mode: 'wage' } | null;

export function BusinessBudget() {
  const { id = '' } = useParams<{ id: string }>();
  const [year, setYear] = useState<number | null>(null);
  const info = useBusinessInfo(id, year);
  const [budget, setBudget] = useState<BusinessBudgetView | null>(null);
  const [wages, setWages] = useState<BusinessWagePayment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [reload, setReload] = useState(0);
  const today = aucklandToday();

  useEffect(() => {
    let cancelled = false;
    api.business
      .budget(id, year)
      .then((b) => {
        if (cancelled) return;
        setBudget(b);
        setError(null);
        const { start, end } = taxYearRange(b.taxYear);
        return api.business.wages(id, { from: start, to: end }).then((w) => {
          if (!cancelled) setWages(w);
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e, 'Could not load the budget.'));
      });
    return () => {
      cancelled = true;
    };
  }, [id, year, reload]);

  const refresh = () => {
    setReload((n) => n + 1);
    info.reload();
  };

  async function act(fn: () => Promise<unknown>, note: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      showQuietToast(note);
      refresh();
    } catch (e) {
      setError(errorText(e, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  const categories = useMemo(() => [...(budget?.income ?? []), ...(budget?.expenses ?? [])], [budget]);
  // Tagged bank money in this tax year that the budget can sort: not already counted elsewhere.
  const bankMoney = (info.detail?.money ?? []).filter((m) => m.kind === 'transaction' && !m.countedVia && m.amountNzd !== 0);
  const s = budget?.summary;

  return (
    <div className="stack bills-page warranties-page rentals-page business-page budget-page">
      <BusinessTabs />
      <header className="business-detail-header">
        <Link className="warranties-back" to={`/business/${encodeURIComponent(id)}`}>
          ‹ {info.name || 'Business'}
        </Link>
        <div className="business-detail-row">
          <div className="business-detail-name">
            <h2 className="page-title">Budget</h2>
          </div>
          {info.canEdit && budget ? (
            <div className="business-detail-actions">
              <button type="button" className="btn small" onClick={() => setDialog({ mode: 'wage' })}>
                + Wages paid
              </button>
              <button type="button" className="btn small primary" onClick={() => setDialog({ mode: 'category', line: null })}>
                + Category
              </button>
            </div>
          ) : null}
        </div>
        {budget ? <TaxYearSwitch year={budget.taxYear} years={budget.taxYears} onChange={setYear} /> : null}
      </header>

      {error || info.error ? <p className="auth-error" role="alert">{error ?? info.error}</p> : null}
      {!budget ? (error ? null : <p className="muted">Loading…</p>) : null}

      {budget && s ? (
        <>
          <section className="panel rental-summary business-summary" aria-label={`Profit for the ${taxYearLabel(budget.taxYear)} tax year`}>
            <dl className="rental-totals business-totals">
              <div>
                <dt>Sales</dt>
                <dd>{formatNzd(s.salesNzd)}</dd>
              </div>
              <div>
                <dt>Gross profit</dt>
                <dd>{s.grossProfitNzd == null ? '—' : formatNzd(s.grossProfitNzd)}</dd>
                <dd className="business-figure-note">{s.costOfGoodsSoldNzd == null ? 'Cost of goods sold not known yet' : `after ${formatNzd(s.costOfGoodsSoldNzd)} cost of goods sold`}</dd>
              </div>
              <div>
                <dt>Running costs</dt>
                <dd>{formatNzd(s.operatingExpensesNzd)}</dd>
                <dd className="business-figure-note">Stock bought: {formatNzd(s.stockPurchasesNzd)}</dd>
              </div>
              <div>
                <dt>Net profit</dt>
                <dd className={s.netProfitNzd == null ? undefined : profitClass(s.netProfitNzd)}>{s.netProfitNzd == null ? '—' : formatNzd(s.netProfitNzd)}</dd>
                {s.otherIncomeNzd ? <dd className="business-figure-note">incl. {formatNzd(s.otherIncomeNzd)} other income</dd> : null}
              </div>
            </dl>
            <p className="muted small">
              Planned: {formatNzd(s.plannedIncomeNzd)} in, {formatNzd(s.plannedExpensesNzd)} out. Stock you buy isn’t a running cost: its cost comes
              off gross profit as it sells.
            </p>
          </section>

          {(['income', 'expenses'] as const).map((side) => (
            <section key={side} className="panel warranty-card" aria-labelledby={`budget-${side}`}>
              <div className="rental-card-head">
                <h3 id={`budget-${side}`}>{side === 'income' ? 'Money in' : 'Money out'}</h3>
              </div>
              <div className="budget-table-wrap">
                <table className="budget-table">
                  <thead>
                    <tr>
                      <th scope="col">Category</th>
                      <th scope="col" className="num">Planned</th>
                      <th scope="col" className="num">Actual</th>
                      <th scope="col">Against plan</th>
                      {info.canEdit ? <th scope="col"><span className="sr-only">Actions</span></th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {budget[side].map((line) => {
                      const v = variance(line);
                      const pct = planPercent(line);
                      return (
                        <tr key={line.id}>
                          <th scope="row">
                            {line.name}
                            <span className="muted small budget-role-note">{line.role ? ROLE_NOTES[line.role] : 'Bank transactions you put here'}</span>
                          </th>
                          <td className="num">
                            {line.plannedNzd == null ? '—' : formatNzd(line.plannedNzd)}
                            <span className="muted small"> {line.planCadence === 'year' ? '/ year' : ''}</span>
                          </td>
                          <td className="num">{formatNzd(line.actualNzd)}</td>
                          <td>
                            {pct != null ? (
                              <span className={`budget-bar budget-bar--${v.status}`} aria-hidden="true">
                                <span style={{ width: `${Math.min(pct, 100)}%` }} />
                              </span>
                            ) : null}
                            <span className={`small budget-variance budget-variance--${v.status ?? 'none'}`}>
                              {v.diffNzd ? `${formatNzd(Math.abs(v.diffNzd))} ` : ''}
                              {v.text}
                            </span>
                          </td>
                          {info.canEdit ? (
                            <td className="budget-actions">
                              <button type="button" className="link-btn" disabled={busy} onClick={() => setDialog({ mode: 'plan', line })}>
                                Plan
                              </button>
                              <button type="button" className="link-btn" disabled={busy} onClick={() => setDialog({ mode: 'category', line })}>
                                Edit
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                    {side === 'expenses' && budget.uncategorised.expensesNzd ? (
                      <tr>
                        <th scope="row">
                          Uncategorised
                          <span className="muted small budget-role-note">Tagged bank payments not in a category</span>
                        </th>
                        <td className="num">—</td>
                        <td className="num">{formatNzd(budget.uncategorised.expensesNzd)}</td>
                        <td />
                        {info.canEdit ? <td /> : null}
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          {bankMoney.length && info.canEdit ? (
            <section className="panel warranty-card" aria-labelledby="budget-bank">
              <div className="rental-card-head">
                <h3 id="budget-bank">Tagged bank money</h3>
              </div>
              <p className="muted small">Put each tagged transaction in a category. Deposits left out count as other income; payments left out stay uncategorised.</p>
              <ul className="rental-entries">
                {bankMoney.map((m) => (
                  <li key={m.id} className="rental-entry">
                    <div className="rental-entry-what">
                      <span>{m.description}</span>
                      <span className="muted small">{formatInvoiceDate(m.date)}</span>
                    </div>
                    <span className={'rental-entry-amount' + (m.amountNzd < 0 ? ' rental-entry-amount--out' : '')}>{formatNzd(m.amountNzd)}</span>
                    <span className="rental-entry-actions">
                      <label>
                        <span className="sr-only">Category for {m.description}</span>
                        <select
                          value={m.businessCategoryId ?? ''}
                          disabled={busy}
                          onChange={(e) => void act(() => api.business.setTransactionCategory(id, m.id, e.target.value || null), 'Category saved.')}
                        >
                          <option value="">Uncategorised</option>
                          {categories
                            .filter((c) => (m.amountNzd > 0 ? c.kind === 'income' : c.kind === 'expense'))
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="panel warranty-card" aria-labelledby="budget-wages">
            <div className="rental-card-head">
              <h3 id="budget-wages">Wages paid</h3>
              <span className="money">{formatNzd(wages.reduce((t, w) => t + w.amountNzd, 0))}</span>
            </div>
            {wages.length === 0 ? (
              <p className="muted small">No wages recorded this tax year. Record the gross pay each time you pay someone; it fills in the Wages category.</p>
            ) : (
              <ul className="rental-entries">
                {wages.map((w) => (
                  <li key={w.id} className="rental-entry">
                    <div className="rental-entry-what">
                      <span>{w.employeeName || 'Wages'}</span>
                      <span className="muted small">
                        {formatInvoiceDate(w.date)}
                        {w.notes ? ` · ${w.notes}` : ''}
                      </span>
                    </div>
                    <span className="rental-entry-amount rental-entry-amount--out">{formatNzd(w.amountNzd)}</span>
                    <span className="rental-entry-actions">
                      {info.canEdit ? (
                        <button type="button" className="link-btn" disabled={busy} onClick={() => void act(() => api.business.removeWage(w.id), 'Wages removed.', `Remove ${formatNzd(w.amountNzd)} paid to ${w.employeeName || 'this person'}?`)}>
                          Delete
                        </button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      {dialog?.mode === 'plan' && budget ? <PlanDialog line={dialog.line} taxYear={budget.taxYear} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); showQuietToast('Plan saved.'); refresh(); }} /> : null}
      {dialog?.mode === 'category' ? (
        <CategoryForm
          businessId={id}
          line={dialog.line}
          onClose={() => setDialog(null)}
          onDone={(note) => {
            setDialog(null);
            showQuietToast(note);
            refresh();
          }}
        />
      ) : null}
      {dialog?.mode === 'wage' && info.detail ? (
        <WageForm
          businessId={id}
          employees={info.detail.employees.map((e) => ({ id: e.id, name: e.name }))}
          today={today}
          onClose={() => setDialog(null)}
          onSaved={(note) => {
            setDialog(null);
            showQuietToast(note);
            refresh();
          }}
        />
      ) : null}
      <p className="muted small business-foot">Actuals count each dollar once, on the day it was paid, the same as Profit &amp; loss. Plans are yours to set.</p>
    </div>
  );
}

function PlanDialog({ line, taxYear, onClose, onSaved }: { line: BusinessBudgetLine; taxYear: number; onClose: () => void; onSaved: () => void }) {
  const [inputs, setInputs] = useState<Record<string, string>>(() => planInputs(line, taxYear));
  const [spread, setSpread] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = (p: string) => (line.planCadence === 'year' ? `the ${taxYearLabel(Number(p))} tax year` : monthLabel(p));
  const parsed = plansFromInputs(inputs, label);
  const hint = 'error' in parsed ? parsed.error : null;
  const months = line.months.map((m) => m.month);

  async function save() {
    if ('error' in parsed) return;
    setBusy(true);
    setError(null);
    try {
      await api.business.setBudgetPlans(line.id, parsed.plans);
      onSaved();
    } catch (e) {
      setError(errorText(e, 'Could not save the plan.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Plan for ${line.name}`} onClose={onClose}>
      {line.planCadence === 'year' ? (
        <div className="form-grid warranty-form">
          <label>
            {taxYearLabel(taxYear)} tax year (NZD)
            <input inputMode="decimal" value={inputs[String(taxYear)] ?? ''} placeholder="Not planned" onChange={(e) => setInputs({ [String(taxYear)]: e.target.value })} />
          </label>
        </div>
      ) : (
        <>
          <div className="budget-spread">
            <label>
              Spread a year total evenly
              <input inputMode="decimal" value={spread} placeholder="e.g. 12000" onChange={(e) => setSpread(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn small"
              disabled={!spread.trim() || !Number.isFinite(Number(spread)) || Number(spread) < 0}
              onClick={() => setInputs(spreadEvenly(Number(spread), months))}
            >
              Fill months
            </button>
          </div>
          <div className="budget-plan-grid">
            {line.months.map((m) => (
              <label key={m.month}>
                <span>
                  {monthLabel(m.month)}
                  <span className="muted small"> · actual {formatNzd(m.actualNzd)}</span>
                </span>
                <input inputMode="decimal" value={inputs[m.month] ?? ''} placeholder="—" onChange={(e) => setInputs({ ...inputs, [m.month]: e.target.value })} />
              </label>
            ))}
          </div>
        </>
      )}
      <p className="muted small">Leave a box blank for no plan. To plan by the year instead, change it with Edit.</p>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions busy={busy} hint={hint} saveLabel={busy ? 'Saving…' : 'Save plan'} onSave={() => void save()} onClose={onClose} />
    </Dialog>
  );
}

function CategoryForm({ businessId, line, onClose, onDone }: { businessId: string; line: BusinessBudgetLine | null; onClose: () => void; onDone: (note: string) => void }) {
  const [d, setD] = useState<BudgetCategoryWriteBody>(() => ({ name: line?.name ?? '', kind: line?.kind ?? 'expense', planCadence: line?.planCadence ?? 'month' }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cadenceChange = line != null && line.planCadence !== d.planCadence && line.plannedNzd != null;

  async function run(fn: () => Promise<unknown>, note: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone(note);
    } catch (e) {
      setError(errorText(e, 'Could not save the category.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title={line ? `Edit ${line.name}` : 'Add category'} onClose={onClose}>
      <div className="form-grid warranty-form">
        <label>
          Name
          <input value={d.name} maxLength={60} onChange={(e) => setD({ ...d, name: e.target.value })} />
        </label>
        <label>
          Money
          <select value={d.kind} disabled={Boolean(line?.role)} onChange={(e) => setD({ ...d, kind: e.target.value === 'income' ? 'income' : 'expense' })}>
            <option value="expense">Out (a cost)</option>
            <option value="income">In (income)</option>
          </select>
        </label>
        <label>
          Plan
          <select value={d.planCadence} onChange={(e) => setD({ ...d, planCadence: e.target.value === 'year' ? 'year' : 'month' })}>
            <option value="month">Month by month</option>
            <option value="year">One amount for the tax year</option>
          </select>
        </label>
      </div>
      {line?.role ? <p className="muted small">{ROLE_NOTES[line.role]}, so it can be renamed but not deleted.</p> : null}
      {cadenceChange ? <p className="muted small" role="status">Changing how it’s planned clears its current plan.</p> : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions
        busy={busy}
        hint={d.name.trim() ? null : 'Add a name'}
        saveLabel={busy ? 'Saving…' : 'Save category'}
        onSave={() => void run(() => (line ? api.business.updateBudgetCategory(line.id, d) : api.business.createBudgetCategory(businessId, d)), `${d.name.trim()} saved.`)}
        onClose={onClose}
      />
      {line && !line.role ? (
        <p className="small">
          <button
            type="button"
            className="link-btn business-menu-danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete ${line.name}? Its plan goes, and its bank transactions become uncategorised.`)) void run(() => api.business.removeBudgetCategory(line.id), `${line.name} deleted.`);
            }}
          >
            Delete category
          </button>
        </p>
      ) : null}
    </Dialog>
  );
}

function WageForm({ businessId, employees, today, onClose, onSaved }: {
  businessId: string;
  employees: { id: string; name: string }[];
  today: string;
  onClose: () => void;
  onSaved: (note: string) => void;
}) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? '');
  const [name, setName] = useState('');
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(amount);
  const hint = !employeeId && !name.trim() ? 'Pick an employee or enter who was paid' : !amount.trim() || !Number.isFinite(n) || n <= 0 ? 'Enter the gross amount paid' : date > today ? 'Record wages once they’re paid' : null;

  async function save() {
    if (hint) return;
    setBusy(true);
    setError(null);
    try {
      await api.business.createWage(businessId, { employeeId: employeeId || null, employeeName: employeeId ? '' : name.trim(), date, amountNzd: n, transactionId: null, notes: notes.trim() });
      onSaved(`${formatNzd(n)} wages recorded.`);
    } catch (e) {
      setError(errorText(e, 'Could not record the wages.'));
      setBusy(false);
    }
  }

  return (
    <Dialog title="Wages paid" onClose={onClose}>
      <div className="form-grid warranty-form">
        <label>
          Paid to
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
            <option value="">Someone else…</option>
          </select>
        </label>
        {employeeId ? null : (
          <label>
            Name
            <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label>
          Paid on
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Gross amount (NZD)
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>
          Notes
          <input value={notes} maxLength={1000} placeholder="e.g. fortnight to 12 Oct" onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <p className="muted small">A record only: nothing is paid from KoruLedger, and PAYE isn’t worked out here.</p>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <FormActions busy={busy} hint={hint} saveLabel={busy ? 'Saving…' : 'Record wages'} onSave={() => void save()} onClose={onClose} />
    </Dialog>
  );
}
