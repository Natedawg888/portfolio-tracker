/**
 * Salary compare (KAN-23), opened from a button on the PAYE page. Runs the page's PAYE settings
 * (tax year, KiwiSaver, student loan, credits) at up to four yearly salaries and shows tax and
 * take-home side by side (src/lib/salaryCompare.ts). Salaries are remembered in this browser for
 * the signed-in account only.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { formatNzd } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { compareSalaries, parseSalaries, type SalaryCompareOptions } from '../lib/salaryCompare';

const storageKey = (userId: string | undefined) => `portfolio-tracker-salary-compare:${userId ?? 'anon'}`;

function readSalaries(userId: string | undefined, current: number | null): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(userId)) ?? 'null') as unknown;
    if (Array.isArray(raw) && raw.length === 4 && raw.every((v) => typeof v === 'string')) return raw as string[];
  } catch {
    /* storage blocked or bad data: start fresh */
  }
  const base = current && current > 0 ? Math.round(current) : 75_000;
  return [String(base), String(Math.round(base * 1.1)), '', ''];
}

const signed = (n: number) => (n > 0 ? `+${formatNzd(n)}` : n < 0 ? `−${formatNzd(-n)}` : formatNzd(0));

export function SalaryCompare({ id, options, currentSalary, taxYearLabel }: { id: string; options: SalaryCompareOptions; currentSalary: number | null; taxYearLabel: string }) {
  const { user } = useAuth();
  const headingId = useId();
  const [texts, setTexts] = useState<string[]>(() => readSalaries(user?.id, currentSalary));

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(user?.id), JSON.stringify(texts));
    } catch {
      /* storage blocked: salaries just aren't remembered */
    }
  }, [texts, user?.id]);

  const rows = useMemo(() => compareSalaries(parseSalaries(texts), options), [texts, options]);
  const setAt = (i: number, v: string) => setTexts((prev) => prev.map((t, j) => (j === i ? v : t)));

  return (
    <section id={id} className="panel salary-compare" aria-labelledby={headingId}>
      <h3 id={headingId}>Compare salaries</h3>
      <p className="muted small">
        Your settings below (KiwiSaver, student loan, tax credits) at each salary, for {taxYearLabel}. The first salary is the one the others are compared with.
      </p>
      <div className="form-grid">
        {texts.map((t, i) => (
          <label key={i}>
            {i === 0 ? 'Salary a year (NZD)' : `Compare with`}
            <input type="number" min={0} step="any" inputMode="decimal" value={t} placeholder={i === 0 ? 'e.g. 75000' : 'Optional'} onChange={(e) => setAt(i, e.target.value)} />
          </label>
        ))}
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table className="data-table salary-compare-table">
            <thead>
              <tr>
                <th scope="col">A year</th>
                {rows.map((r, i) => (
                  <th key={i} scope="col" className="money">
                    {formatNzd(r.salary)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Income tax</th>
                {rows.map((r, i) => (
                  <td key={i} className="money">{formatNzd(r.incomeTax)}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">ACC</th>
                {rows.map((r, i) => (
                  <td key={i} className="money">{formatNzd(r.acc)}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">KiwiSaver</th>
                {rows.map((r, i) => (
                  <td key={i} className="money">{formatNzd(r.kiwiSaver)}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">Student loan</th>
                {rows.map((r, i) => (
                  <td key={i} className="money">{formatNzd(r.studentLoan)}</td>
                ))}
              </tr>
              <tr>
                <th scope="row">Tax credits</th>
                {rows.map((r, i) => (
                  <td key={i} className="money">{formatNzd(r.credits)}</td>
                ))}
              </tr>
              <tr className="salary-compare-total">
                <th scope="row">Take-home</th>
                {rows.map((r, i) => (
                  <td key={i} className="money">
                    <strong>{formatNzd(r.takeHome)}</strong>
                    <span className="muted small"> · {formatNzd(r.takeHome / 26)} a fortnight</span>
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">Deductions</th>
                {rows.map((r, i) => (
                  <td key={i}>{r.deductionsPct}% of salary</td>
                ))}
              </tr>
              {rows.length > 1 ? (
                <tr>
                  <th scope="row">Compared with the first</th>
                  {rows.map((r, i) => (
                    <td key={i} className="small">
                      {r.vsBaseline ? (
                        <>
                          {signed(r.vsBaseline.takeHome)} take-home
                          {r.vsBaseline.keepPerDollarPct != null ? <> · you keep {r.vsBaseline.keepPerDollarPct}c of each extra dollar</> : null}
                        </>
                      ) : (
                        <span className="muted">Baseline</span>
                      )}
                    </td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">Enter a salary to compare.</p>
      )}
      <p className="muted small">An estimate from IRD’s published rates, not tax advice.</p>
    </section>
  );
}
