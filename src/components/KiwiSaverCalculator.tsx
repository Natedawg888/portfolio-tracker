/**
 * KiwiSaver calculator on the KiwiSaver page (KAN-59). What your KiwiSaver could be at 65 from
 * your contributions, your employer's (after ESCT) and the government contribution, growing at
 * a return you choose. Illustrative only; today's rules apply to every year (kiwiSaverRules.ts).
 * Inputs are remembered on this device. Amounts follow Hide amounts through formatNzd.
 * The government contribution's $180,000 test is on total taxable income (KAN-99): other income
 * or an entered total can be added; with neither, salary is used and a note says so.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, formatNzd } from '../api/client';
import { AssetLineChart, type LineSeries } from './AssetLineChart';
import { calculateKiwiSaver } from '../lib/kiwiSaverCalc';
import { GOVERNMENT_CONTRIBUTION, KIWISAVER_RULES_CHECKED_ON, KIWISAVER_RULES_SOURCES, KIWISAVER_WITHDRAWAL_AGE } from '../lib/kiwiSaverRules';
import { payTaxYearRates } from '../lib/payeRates';
import { PAYE_PREFS_STORAGE_KEY, loadPayePrefs } from '../lib/payePrefs';
import { annualise } from '../lib/payeCalc';

const STORAGE_KEY = 'portfolio-tracker-kiwisaver-calculator';
type Fields = {
  age: string;
  balance: string;
  salary: string;
  salaryGrowthPct: string;
  employeeRatePct: string;
  employerRatePct: string;
  extraPerYear: string;
  otherIncome: string;
  totalIncome: string;
  returnPct: string;
  inflationPct: string;
};
const rates = payTaxYearRates();
const DEFAULTS: Fields = {
  age: '30',
  balance: '',
  salary: '',
  salaryGrowthPct: '0',
  employeeRatePct: String(rates.kiwiSaverDefaultEmployeeRate),
  employerRatePct: String(rates.kiwiSaverEmployerMinRate),
  extraPerYear: '0',
  otherIncome: '',
  totalIncome: '',
  returnPct: '5',
  inflationPct: '2',
};

function loadFields(): { fields: Fields; saved: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { fields: DEFAULTS, saved: false };
    const o = JSON.parse(raw) as Partial<Fields>;
    return { fields: { ...DEFAULTS, ...Object.fromEntries(Object.entries(o).filter(([k, v]) => k in DEFAULTS && typeof v === 'string')) }, saved: true };
  } catch {
    return { fields: DEFAULTS, saved: false };
  }
}

function num(text: string, min: number, max: number): number {
  const n = Number(text);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
}

/** Yearly salary from the PAYE page on this device, if it has one. */
function payePageSalary(): number | null {
  try {
    if (!localStorage.getItem(PAYE_PREFS_STORAGE_KEY)) return null;
  } catch {
    return null;
  }
  const p = loadPayePrefs();
  if (p.payType !== 'salary' && p.payType !== 'hourly') return null;
  const amount = Number(p.amount);
  if (!(amount > 0)) return null;
  const yearly = annualise(amount, p.payType === 'hourly' ? 'hour' : p.frequency, Number(p.hoursPerWeek) || 40);
  return Math.round(yearly);
}

function yearsAhead(years: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + Math.round(years * 12));
  return d.toISOString().slice(0, 10);
}

export function KiwiSaverCalculator({ balanceNzd }: { balanceNzd: number | null }) {
  // First visit: start from the PAYE page's pay, your saved KiwiSaver rate and your balance.
  const [start] = useState(() => {
    const { fields, saved } = loadFields();
    const paye = payePageSalary();
    return { saved, paye, fields: !saved && paye ? { ...fields, salary: String(paye) } : fields };
  });
  const { saved, paye } = start;
  const [f, setF] = useState<Fields>(start.fields);
  const [thisYear] = useState(() => new Date().getFullYear());
  const set = <K extends keyof Fields>(k: K, v: string) => setF((prev) => ({ ...prev, [k]: v }));
  // Until a balance is typed, a first visit uses the balance on this page.
  const balanceText = f.balance === '' && !saved && balanceNzd != null && balanceNzd > 0 ? String(Math.round(balanceNzd)) : f.balance;

  useEffect(() => {
    if (saved) return;
    let live = true;
    api.settings
      .getKiwiSaverEmployeeRate()
      .then((r) => {
        if (live && r.employeeRatePct > 0) setF((prev) => ({ ...prev, employeeRatePct: String(r.employeeRatePct) }));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [saved]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
    } catch {
      /* private mode: nothing remembered */
    }
  }, [f]);

  const age = Math.floor(num(f.age, 0, 100));
  const result = useMemo(
    () =>
      calculateKiwiSaver({
        age,
        balance: num(balanceText, 0, 1e9),
        salary: num(f.salary, 0, 1e8),
        salaryGrowthPct: num(f.salaryGrowthPct, 0, 20),
        employeeRatePct: num(f.employeeRatePct, 0, 100),
        employerRatePct: num(f.employerRatePct, 0, 100),
        extraPerYear: num(f.extraPerYear, 0, 1e7),
        otherIncomePerYear: num(f.otherIncome, 0, 1e9),
        taxableIncomeOverride: f.totalIncome.trim() === '' ? null : num(f.totalIncome, 0, 1e9),
        returnPct: num(f.returnPct, -20, 30),
        inflationPct: num(f.inflationPct, -5, 20),
      }),
    [f, age, balanceText],
  );

  const series: LineSeries[] = useMemo(() => {
    if (!result) return [];
    return [
      {
        key: 'balance',
        label: 'KiwiSaver (today’s dollars)',
        colour: '#3d9a6a',
        points: [{ at: yearsAhead(0), value: num(balanceText, 0, 1e9) }, ...result.rows.map((r) => ({ at: yearsAhead(r.age - age), value: r.balanceToday }))],
      },
    ];
  }, [result, balanceText, age]);
  const ageLabel = (at: string) => {
    const now = new Date(yearsAhead(0));
    const then = new Date(at);
    const months = (then.getUTCFullYear() - now.getUTCFullYear()) * 12 + then.getUTCMonth() - now.getUTCMonth();
    return `Age ${age + Math.round(months / 12)}`;
  };
  const year65 = thisYear + (result?.years ?? 0);

  return (
    <section className="panel ks-calc" aria-labelledby="ks-calc-title">
      <h3 id="ks-calc-title">KiwiSaver calculator</h3>
      <p className="muted small">What your KiwiSaver could be at {KIWISAVER_WITHDRAWAL_AGE}, from what you, your employer and the government put in, and the return you choose.</p>

      {result ? (
        <div className="ks-calc-result">
          <p className="proj-kicker">At {KIWISAVER_WITHDRAWAL_AGE}, in {result.years} {result.years === 1 ? 'year' : 'years'}</p>
          <p className="proj-figure">{formatNzd(result.atWithdrawalToday)}</p>
          <p className="proj-breakdown">
            In today’s dollars · {formatNzd(result.atWithdrawal)} in {year65} dollars
          </p>
          <dl className="hh-pay-figures ks-calc-sources">
            <div>
              <dt>Starting balance</dt>
              <dd className="money">{formatNzd(result.totals.startingBalance)}</dd>
            </div>
            <div>
              <dt>You put in</dt>
              <dd className="money">{formatNzd(result.totals.you)}</dd>
            </div>
            <div>
              <dt>Employer (after ESCT)</dt>
              <dd className="money">{formatNzd(result.totals.employer)}</dd>
            </div>
            <div>
              <dt>Government</dt>
              <dd className="money">{formatNzd(result.totals.government)}</dd>
            </div>
            <div className="hh-pay-net">
              <dt>Investment growth</dt>
              <dd className="money">{formatNzd(result.totals.growth)}</dd>
            </div>
          </dl>
          <p className="muted small">Totals are in the dollars of each year.</p>
          {result.rows.length > 1 ? (
            <AssetLineChart
              series={series}
              title="KiwiSaver by age"
              hideTitle
              emptyHint="Nothing to plot yet."
              resolution="month"
              fullWidth
              foregroundKey="balance"
              markers={false}
              zeroBaseline
              moneyAxis
              height={240}
              xAxisLabel={ageLabel}
            />
          ) : null}
          <div className="ks-calc-year1">
            <h4>This year</h4>
            <ul className="hh-rows">
              <li>
                <span>You</span>
                <span className="money">{formatNzd(result.firstYear.you)}</span>
              </li>
              <li>
                <span>
                  Employer {formatNzd(result.firstYear.employerGross)}, less ESCT at {result.firstYear.esctRatePct}%
                </span>
                <span className="money">{formatNzd(result.firstYear.employer)}</span>
              </li>
              <li>
                <span>Government contribution</span>
                <span className="money">{formatNzd(result.firstYear.government)}</span>
              </li>
            </ul>
            {result.firstYear.governmentNote ? <p className="small">{result.firstYear.governmentNote}</p> : null}
            {result.firstYear.incomeBasis === 'salary_only' && age >= GOVERNMENT_CONTRIBUTION.minAge && age < GOVERNMENT_CONTRIBUTION.maxAge ? (
              <p className="muted small">
                The ${GOVERNMENT_CONTRIBUTION.incomeLimit.toLocaleString('en-NZ')} limit is on all your taxable income, not just pay. This uses your salary
                only; add other taxable income or your total below to check it.
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="small">At {KIWISAVER_WITHDRAWAL_AGE} or over you can withdraw your KiwiSaver, so there’s nothing to project.</p>
      )}

      <div className="form-grid ks-calc-form">
        <label>
          Your age
          <input type="number" min={0} max={100} step={1} inputMode="numeric" value={f.age} onChange={(e) => set('age', e.target.value)} />
        </label>
        <label>
          KiwiSaver balance now (NZD)
          <input type="number" min={0} step="any" inputMode="decimal" value={balanceText} onChange={(e) => set('balance', e.target.value)} />
          {balanceNzd != null && balanceNzd > 0 && Math.round(balanceNzd) !== Number(balanceText) ? (
            <button type="button" className="link-btn ks-calc-use" onClick={() => set('balance', String(Math.round(balanceNzd)))}>
              Use my balance ({formatNzd(balanceNzd)})
            </button>
          ) : null}
        </label>
        <label>
          Salary or wages before tax, a year (NZD)
          <input type="number" min={0} step="any" inputMode="decimal" value={f.salary} onChange={(e) => set('salary', e.target.value)} />
          {paye && String(paye) !== f.salary ? (
            <button type="button" className="link-btn ks-calc-use" onClick={() => set('salary', String(paye))}>
              Use my PAYE page pay ({formatNzd(paye)})
            </button>
          ) : null}
        </label>
        <label>
          Other taxable income, a year (NZD)
          <input type="number" min={0} step="any" inputMode="decimal" value={f.otherIncome} placeholder="0" onChange={(e) => set('otherIncome', e.target.value)} />
          <span className="muted small">Interest, dividends, rental profit, business or a second job. Keeps pace with inflation.</span>
        </label>
        <label>
          Total taxable income this year (optional, NZD)
          <input type="number" min={0} step="any" inputMode="decimal" value={f.totalIncome} onChange={(e) => set('totalIncome', e.target.value)} />
          <span className="muted small">If you know it, e.g. after losses. Used instead of salary plus other income for the government contribution.</span>
        </label>
        <label>
          Pay rises above inflation (% a year)
          <input type="number" min={0} max={20} step="0.5" inputMode="decimal" value={f.salaryGrowthPct} onChange={(e) => set('salaryGrowthPct', e.target.value)} />
          <span className="muted small">0 keeps your pay in step with inflation.</span>
        </label>
        <label>
          Your contribution (%)
          <select value={f.employeeRatePct} onChange={(e) => set('employeeRatePct', e.target.value)}>
            {[...new Set([0, ...rates.kiwiSaverEmployeeRates, Number(f.employeeRatePct)])]
              .filter((r) => Number.isFinite(r))
              .sort((a, b) => a - b)
              .map((r) => (
                <option key={r} value={String(r)}>
                  {r === 0 ? 'Not contributing' : `${r}%`}
                </option>
              ))}
          </select>
        </label>
        <label>
          Employer contribution (%)
          <input type="number" min={0} max={100} step="0.5" inputMode="decimal" value={f.employerRatePct} onChange={(e) => set('employerRatePct', e.target.value)} />
          <span className="muted small">The minimum is {rates.kiwiSaverEmployerMinRate}% when you contribute. ESCT is taken off it.</span>
        </label>
        <label>
          Extra you put in, a year (NZD)
          <input type="number" min={0} step="any" inputMode="decimal" value={f.extraPerYear} onChange={(e) => set('extraPerYear', e.target.value)} />
          <span className="muted small">Voluntary top-ups. Counts toward the government contribution.</span>
        </label>
        <label>
          Yearly return after fees and tax (%)
          <input type="number" min={-20} max={30} step="0.1" inputMode="decimal" value={f.returnPct} onChange={(e) => set('returnPct', e.target.value)} />
          <span className="muted small">Your assumption. Conservative funds usually grow less than growth funds. Your provider’s fund update shows past returns, which don’t predict future ones.</span>
        </label>
        <label>
          Inflation (% a year)
          <input type="number" min={-5} max={20} step="0.1" inputMode="decimal" value={f.inflationPct} onChange={(e) => set('inflationPct', e.target.value)} />
          <span className="muted small">The Reserve Bank aims for 1–3%.</span>
        </label>
      </div>

      {result && result.rows.length ? (
        <details className="proj-fold">
          <summary>Year by year</summary>
          <div className="table-wrap" style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Age</th>
                  <th style={{ textAlign: 'right' }}>You</th>
                  <th style={{ textAlign: 'right' }}>Employer</th>
                  <th style={{ textAlign: 'right' }}>Government</th>
                  <th style={{ textAlign: 'right' }}>Balance (today’s $)</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.age}>
                    <td>{r.age}</td>
                    <td className="money" style={{ textAlign: 'right' }}>{formatNzd(r.you)}</td>
                    <td className="money" style={{ textAlign: 'right' }}>{formatNzd(r.employer)}</td>
                    <td className="money" style={{ textAlign: 'right' }}>{formatNzd(r.government)}</td>
                    <td className="money" style={{ textAlign: 'right' }}>{formatNzd(r.balanceToday)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      <p className="retire-disclaimer">Illustrative only, not financial advice. Returns are assumptions, not promises: real returns go up and down.</p>
      <details className="small ks-calc-rules">
        <summary>How it’s worked out</summary>
        <ul>
          <li>Your pay rises with inflation (plus any growth you set). You and your employer put in your rates of it each year.</li>
          <li>Your employer’s contribution has ESCT taken off at the rate for your pay plus their contribution (10.5%–39%, IRD bands from 1 April 2025).</li>
          <li>
            The government adds {GOVERNMENT_CONTRIBUTION.perDollar * 100}c for every $1 you put in, up to ${GOVERNMENT_CONTRIBUTION.maxPerYear} a year, if you’re {GOVERNMENT_CONTRIBUTION.minAge}–{GOVERNMENT_CONTRIBUTION.maxAge} and your annual taxable income (all of it, not just pay) is ${GOVERNMENT_CONTRIBUTION.incomeLimit.toLocaleString('en-NZ')} or less (from 1 July 2025, IRD “Getting the KiwiSaver government contribution”). A total you enter moves with your pay in later years.
          </li>
          <li>Today’s rules are used for every year. The minimum contribution rises to 4% from 1 April 2028; change your rates to see what that does. Thresholds aren’t adjusted for inflation.</li>
          <li>You can usually withdraw at {KIWISAVER_WITHDRAWAL_AGE}, or earlier for a first home or in hardship.</li>
        </ul>
        <p className="muted">
          Rules checked {KIWISAVER_RULES_CHECKED_ON}:{' '}
          {KIWISAVER_RULES_SOURCES.map((s, i) => (
            <span key={s.url}>
              {i ? ' · ' : ''}
              <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a>
            </span>
          ))}
        </p>
      </details>
    </section>
  );
}
