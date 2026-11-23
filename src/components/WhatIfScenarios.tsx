/**
 * Scenario tool (KAN-32), the "What if…" tab on Projections. Starts from one of four examples
 * (save $200 more a month, salary up 5%, mortgage rates up 1%, invest $500 a month) or any mix,
 * and shows what it does to savings, investments, debt and net worth over the period, using the
 * user's own projection (GET /api/projections/scenario). A pay rise is turned into extra take-home
 * pay with the PAYE rules (calculatePaye) before it's sent. Nothing is saved.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, formatNzd } from '../api/client';
import { annualise } from '../lib/payeCalc';
import { extraTakeHomeMonthly } from '../lib/whatIf';
import { PAYE_PREFS_STORAGE_KEY, loadPayePrefs } from '../lib/payePrefs';

type Result = Awaited<ReturnType<typeof api.projections.scenario>>;

/** Yearly pay from the PAYE page on this device, if it has one. */
function payeSalary(): number | null {
  try {
    if (!localStorage.getItem(PAYE_PREFS_STORAGE_KEY)) return null;
  } catch {
    return null;
  }
  const p = loadPayePrefs();
  const amount = Number(p.amount);
  if (!(amount > 0) || (p.payType !== 'salary' && p.payType !== 'hourly')) return null;
  return Math.round(annualise(amount, p.payType === 'hourly' ? 'hour' : p.frequency, Number(p.hoursPerWeek) || 40));
}

const EXAMPLES = [
  { id: 'save', label: 'Save $200 more a month', set: { extraSaving: '200', raise: '', mortgage: '', invest: '' } },
  { id: 'raise', label: 'Salary up 5%', set: { extraSaving: '', raise: '5', mortgage: '', invest: '' } },
  { id: 'mortgage', label: 'Mortgage rates up 1%', set: { extraSaving: '', raise: '', mortgage: '1', invest: '' } },
  { id: 'invest', label: 'Invest $500 a month', set: { extraSaving: '', raise: '', mortgage: '', invest: '500' } },
] as const;

const signed = (n: number) => (n > 0 ? `+${formatNzd(n)}` : n < 0 ? `−${formatNzd(-n)}` : formatNzd(0));

export function WhatIfScenarios() {
  const [months, setMonths] = useState(60);
  const [f, setF] = useState({ extraSaving: '200', raise: '', mortgage: '', invest: '' });
  const [salary, setSalary] = useState(() => String(payeSalary() ?? ''));
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const extraIncome = useMemo(() => extraTakeHomeMonthly(Number(salary), Number(f.raise) || 0), [salary, f.raise]);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      setError(null);
      api.projections
        .scenario({ months, extraSaving: Number(f.extraSaving) || 0, extraIncome, invest: Number(f.invest) || 0, mortgageRate: Number(f.mortgage) || 0 })
        .then(setResult)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not run the scenario.'))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [months, f, extraIncome]);

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const rows: { label: string; key: 'savingsEndNzd' | 'investmentsEndNzd' | 'debtEndNzd' | 'netWorthEndNzd' }[] = [
    { label: 'Savings (cash)', key: 'savingsEndNzd' },
    { label: 'Investments', key: 'investmentsEndNzd' },
    { label: 'Debt owed', key: 'debtEndNzd' },
    { label: 'Net worth', key: 'netWorthEndNzd' },
  ];

  return (
    <section className="panel whatif" aria-labelledby="whatif-title" aria-busy={loading}>
      <h3 id="whatif-title">What if…</h3>
      <p className="muted small">Change one thing and see what it does to your own projection. Start from an example or mix them.</p>
      <div className="row gap whatif-examples" role="group" aria-label="Examples">
        {EXAMPLES.map((e) => (
          <button key={e.id} type="button" className="btn small ghost" onClick={() => setF({ ...e.set })}>
            {e.label}
          </button>
        ))}
      </div>
      <div className="form-grid">
        <label>
          Save more each month (NZD)
          <input type="number" step="any" inputMode="decimal" value={f.extraSaving} onChange={(e) => set('extraSaving', e.target.value)} />
        </label>
        <label>
          Invest each month (NZD)
          <input type="number" min={0} step="any" inputMode="decimal" value={f.invest} onChange={(e) => set('invest', e.target.value)} />
          <span className="muted small">Moved from savings into shares & funds.</span>
        </label>
        <label>
          Pay rise (%)
          <input type="number" step="0.5" inputMode="decimal" value={f.raise} onChange={(e) => set('raise', e.target.value)} />
        </label>
        <label>
          Salary a year (NZD)
          <input type="number" min={0} step="any" inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} />
          <span className="muted small">{extraIncome ? `${formatNzd(extraIncome)} more take-home a month after tax, ACC and KiwiSaver.` : 'Used to work out the take-home of a pay rise.'}</span>
        </label>
        <label>
          Mortgage rate change (% points)
          <input type="number" step="0.25" inputMode="decimal" value={f.mortgage} onChange={(e) => set('mortgage', e.target.value)} />
          <span className="muted small">Applies to mortgages in Debts; payments stay the same.</span>
        </label>
        <label>
          Over
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            <option value={12}>1 year</option>
            <option value={60}>5 years</option>
            <option value={120}>10 years</option>
            <option value={240}>20 years</option>
          </select>
        </label>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {result ? (
        <div className="table-wrap">
          <table className="data-table whatif-table">
            <thead>
              <tr>
                <th scope="col">In {months / 12 === 1 ? '1 year' : `${months / 12} years`}</th>
                <th scope="col" className="money">As now</th>
                <th scope="col" className="money">What if</th>
                <th scope="col" className="money">Difference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{r.label}</th>
                  <td className="money">{formatNzd(result.baseline[r.key])}</td>
                  <td className="money">{formatNzd(result.scenario[r.key])}</td>
                  <td className="money">{signed(result.difference[r.key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {result?.notes.map((n) => (
        <p key={n} className="muted small">
          {n}
        </p>
      ))}
    </section>
  );
}
