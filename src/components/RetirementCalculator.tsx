/**
 * Retirement calculator (KAN-58), the third mode on Projections. Pure maths on what the user
 * types (src/lib/retirementCalc.ts); illustrative, not advice. Inputs are remembered in this
 * browser only, as a convenience.
 */
import { useEffect, useMemo, useState } from 'react';
import { formatNzd } from '../api/client';
import { AssetLineChart, type LineSeries } from './AssetLineChart';
import { CONTRIBUTION_PERIODS, calculateRetirement, type ContributionPeriod } from '../lib/retirementCalc';

const STORAGE_KEY = 'portfolio-tracker-retirement-calculator';

const PERIOD_LABELS: Record<ContributionPeriod, string> = { weekly: 'Week', fortnightly: 'Fortnight', monthly: 'Month', yearly: 'Year' };
const PERIOD_WORD: Record<ContributionPeriod, string> = { weekly: 'a week', fortnightly: 'a fortnight', monthly: 'a month', yearly: 'a year' };

type Fields = {
  currentAge: string;
  retirementAge: string;
  planUntilAge: string;
  currentSavings: string;
  contribution: string;
  contributionPeriod: ContributionPeriod;
  contributionIncreasePct: string;
  returnBeforePct: string;
  returnDuringPct: string;
  inflationPct: string;
  targetKind: 'income' | 'amount';
  targetIncome: string;
  otherIncome: string;
  targetAmount: string;
};

const DEFAULTS: Fields = {
  currentAge: '30',
  retirementAge: '65',
  planUntilAge: '90',
  currentSavings: '20000',
  contribution: '300',
  contributionPeriod: 'monthly',
  contributionIncreasePct: '0',
  returnBeforePct: '6',
  returnDuringPct: '4',
  inflationPct: '2',
  targetKind: 'income',
  targetIncome: '50000',
  otherIncome: '0',
  targetAmount: '750000',
};

function loadFields(): Fields {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const o = JSON.parse(raw) as Partial<Fields>;
    return {
      ...DEFAULTS,
      ...Object.fromEntries(Object.entries(o).filter(([k, v]) => k in DEFAULTS && typeof v === typeof DEFAULTS[k as keyof Fields])),
      contributionPeriod: o.contributionPeriod && o.contributionPeriod in CONTRIBUTION_PERIODS ? o.contributionPeriod : DEFAULTS.contributionPeriod,
      targetKind: o.targetKind === 'amount' ? 'amount' : 'income',
    };
  } catch {
    return DEFAULTS;
  }
}

function num(text: string, min: number, max: number): number {
  const n = Number(text);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
}

/** First of the month, `years` from now: chart x positions for each age. */
function yearsAhead(years: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + Math.round(years * 12));
  return d.toISOString().slice(0, 10);
}

export function RetirementCalculator({ startingAmountNzd }: { startingAmountNzd?: number | null }) {
  const [f, setF] = useState<Fields>(loadFields);
  const [thisYear] = useState(() => new Date().getFullYear());
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
    } catch {
      /* private mode: nothing remembered */
    }
  }, [f]);
  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setF((prev) => ({ ...prev, [k]: v }));

  const currentAge = Math.floor(num(f.currentAge, 15, 100));
  const retirementAge = Math.max(currentAge, Math.floor(num(f.retirementAge, 15, 100)));
  const planUntilAge = Math.max(retirementAge, Math.floor(num(f.planUntilAge, 15, 120)));
  const ageNote =
    num(f.retirementAge, 0, 200) < currentAge
      ? 'Retirement age is before your current age, so this treats you as retiring now.'
      : num(f.planUntilAge, 0, 200) < retirementAge
        ? 'The “money lasts until” age is before retirement, so it is treated as your retirement age.'
        : null;

  const result = useMemo(
    () =>
      calculateRetirement({
        currentAge,
        retirementAge,
        planUntilAge,
        currentSavings: num(f.currentSavings, 0, 1e12),
        contribution: num(f.contribution, 0, 1e10),
        contributionPeriod: f.contributionPeriod,
        contributionIncreasePct: num(f.contributionIncreasePct, 0, 50),
        returnBeforePct: num(f.returnBeforePct, -50, 50),
        returnDuringPct: num(f.returnDuringPct, -50, 50),
        inflationPct: num(f.inflationPct, -10, 50),
        targetKind: f.targetKind,
        targetIncome: num(f.targetIncome, 0, 1e9),
        otherIncome: num(f.otherIncome, 0, 1e9),
        targetAmount: num(f.targetAmount, 0, 1e12),
      }),
    [f, currentAge, retirementAge, planUntilAge],
  );

  const series: LineSeries[] = useMemo(() => {
    const start = { at: yearsAhead(0), value: num(f.currentSavings, 0, 1e12) };
    const out: LineSeries[] = [
      {
        key: 'balance',
        label: 'Savings (today’s dollars)',
        colour: '#3d9a6a',
        points: [start, ...result.rows.map((r) => ({ at: yearsAhead(r.age - currentAge), value: r.balance }))],
      },
    ];
    if (result.target > 0 && retirementAge > currentAge) {
      out.push({
        key: 'target',
        label: 'Target at retirement',
        colour: '#4a8fd4',
        dashed: true,
        points: [
          { at: yearsAhead(0), value: result.target },
          { at: yearsAhead(retirementAge - currentAge), value: result.target },
        ],
      });
    }
    return out;
  }, [result, f.currentSavings, currentAge, retirementAge]);

  const retirementYear = thisYear + Math.round(result.yearsToRetirement);
  /** Chart points sit on the first of a month, `years` ahead; label them with the age then. */
  const ageLabel = (at: string) => {
    const now = new Date(yearsAhead(0));
    const then = new Date(at);
    const months = (then.getUTCFullYear() - now.getUTCFullYear()) * 12 + then.getUTCMonth() - now.getUTCMonth();
    return `Age ${currentAge + Math.round(months / 12)}`;
  };
  const income = f.targetKind === 'income';

  return (
    <div className="stack" id="retirement">
      <section className="panel proj-chart-card" aria-labelledby="retirement-heading">
        <p id="retirement-heading" className="proj-kicker">
          Savings at {retirementAge}
          {result.yearsToRetirement > 0 ? `, in ${result.yearsToRetirement} years` : ''}
        </p>
        <p className="proj-figure">{formatNzd(result.atRetirement)}</p>
        <p className="proj-breakdown">
          In today’s dollars · {formatNzd(result.atRetirementNominal)} in {retirementYear} dollars · you put in{' '}
          {formatNzd(result.totalContributed)}
        </p>
        <p className={'retire-status ' + (result.onTrack ? 'retire-status--ok' : 'retire-status--short')} aria-live="polite">
          {result.target === 0
            ? income
              ? 'Your other income covers the income you want, so these savings are extra.'
              : 'Set a target to compare against.'
            : result.onTrack
              ? `On track: ${formatNzd(result.gap)} more than the ${formatNzd(result.target)} target.`
              : `Short by ${formatNzd(-result.gap)} of the ${formatNzd(result.target)} target. Adding about ${formatNzd(result.extraNeeded)} ${PERIOD_WORD[f.contributionPeriod]} would close the gap.`}
          {income && result.yearlyDraw > 0
            ? result.runsOutAge == null
              ? ` Drawing ${formatNzd(result.yearlyDraw)} a year, the money lasts to ${planUntilAge}.`
              : ` Drawing ${formatNzd(result.yearlyDraw)} a year, the money runs out at about ${Math.floor(result.runsOutAge)}.`
            : ''}
        </p>
        {result.rows.length > 0 ? (
          <AssetLineChart
            series={series}
            title="Savings by age"
            hideTitle
            emptyHint="Nothing to plot yet."
            resolution="month"
            fullWidth
            foregroundKey="balance"
            markers={false}
            zeroBaseline
            moneyAxis
            height={280}
            xAxisLabel={ageLabel}
          />
        ) : null}
        <p className="retire-disclaimer">
          Illustrative only, not financial advice. Returns are assumptions, not promises: real returns go up and down,
          and the result can be very different.
        </p>
      </section>

      <section className="panel proj-scenario" aria-label="Retirement calculator">
        <h3 className="proj-scenario-title">Retirement calculator</h3>
        <p className="muted small proj-tagline">Uses only the numbers you enter. All amounts are in today’s dollars.</p>
        <div className="form-grid">
          <label>
            Your age
            <input type="number" min={15} max={100} step="1" inputMode="numeric" value={f.currentAge} onChange={(e) => set('currentAge', e.target.value)} />
          </label>
          <label>
            Retire at age
            <input type="number" min={15} max={100} step="1" inputMode="numeric" value={f.retirementAge} onChange={(e) => set('retirementAge', e.target.value)} />
            <span className="muted small">NZ Super and KiwiSaver withdrawals start at 65.</span>
          </label>
          <label>
            Money lasts until age
            <input type="number" min={15} max={120} step="1" inputMode="numeric" value={f.planUntilAge} onChange={(e) => set('planUntilAge', e.target.value)} />
          </label>
          <label>
            Savings today (NZD)
            <input type="number" min={0} step="any" inputMode="decimal" value={f.currentSavings} onChange={(e) => set('currentSavings', e.target.value)} />
            {startingAmountNzd != null && startingAmountNzd > 0 ? (
              <button type="button" className="btn small ghost" style={{ alignSelf: 'flex-start' }} onClick={() => set('currentSavings', String(Math.round(startingAmountNzd)))}>
                Use my assets today ({formatNzd(startingAmountNzd)})
              </button>
            ) : null}
          </label>
          <label>
            You add (NZD)
            <input type="number" min={0} step="any" inputMode="decimal" value={f.contribution} onChange={(e) => set('contribution', e.target.value)} />
            <span className="muted small">Include KiwiSaver from you, your employer and the government if they go to these savings.</span>
          </label>
          <label>
            Every
            <select value={f.contributionPeriod} onChange={(e) => set('contributionPeriod', e.target.value as ContributionPeriod)}>
              {(Object.keys(CONTRIBUTION_PERIODS) as ContributionPeriod[]).map((k) => (
                <option key={k} value={k}>
                  {PERIOD_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Contributions rise above inflation by (% a year)
            <input type="number" min={0} max={50} step="0.5" inputMode="decimal" value={f.contributionIncreasePct} onChange={(e) => set('contributionIncreasePct', e.target.value)} />
            <span className="muted small">0 keeps them in step with inflation.</span>
          </label>
          <label>
            Yearly return before retiring (%)
            <input type="number" min={-50} max={50} step="0.1" inputMode="decimal" value={f.returnBeforePct} onChange={(e) => set('returnBeforePct', e.target.value)} />
            <span className="muted small">After fees and tax.</span>
          </label>
          <label>
            Yearly return in retirement (%)
            <input type="number" min={-50} max={50} step="0.1" inputMode="decimal" value={f.returnDuringPct} onChange={(e) => set('returnDuringPct', e.target.value)} />
            <span className="muted small">Often lower, in a more cautious fund.</span>
          </label>
          <label>
            Inflation (% a year)
            <input type="number" min={-10} max={50} step="0.1" inputMode="decimal" value={f.inflationPct} onChange={(e) => set('inflationPct', e.target.value)} />
            <span className="muted small">The Reserve Bank aims for 1–3%.</span>
          </label>
          <label>
            Target
            <select value={f.targetKind} onChange={(e) => set('targetKind', e.target.value === 'amount' ? 'amount' : 'income')}>
              <option value="income">A yearly income in retirement</option>
              <option value="amount">An amount at retirement</option>
            </select>
          </label>
          {income ? (
            <>
              <label>
                Income you want a year (NZD)
                <input type="number" min={0} step="any" inputMode="decimal" value={f.targetIncome} onChange={(e) => set('targetIncome', e.target.value)} />
              </label>
              <label>
                Other income a year (NZD)
                <input type="number" min={0} step="any" inputMode="decimal" value={f.otherIncome} onChange={(e) => set('otherIncome', e.target.value)} />
                <span className="muted small">For example NZ Super, a pension or rent. Check current NZ Super rates with Work and Income.</span>
              </label>
            </>
          ) : (
            <label>
              Amount wanted at retirement (NZD)
              <input type="number" min={0} step="any" inputMode="decimal" value={f.targetAmount} onChange={(e) => set('targetAmount', e.target.value)} />
            </label>
          )}
        </div>
        {ageNote ? <p className="muted small">{ageNote}</p> : null}

        {result.rows.length > 0 ? (
          <details className="proj-fold">
            <summary>Year by year</summary>
            <div className="table-wrap" style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Age</th>
                    <th style={{ textAlign: 'right' }}>You put in (total)</th>
                    <th style={{ textAlign: 'right' }}>Savings</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.age}>
                      <td>
                        {r.age}
                        {r.age === retirementAge ? ' (retire)' : ''}
                      </td>
                      <td className="money" style={{ textAlign: 'right' }}>{formatNzd(r.contributed)}</td>
                      <td className="money" style={{ textAlign: 'right' }}>{formatNzd(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
        <p className="muted small" style={{ marginTop: '0.5rem' }}>
          Returns, contribution rises and inflation are steady every year here; in real life they vary. Not financial
          advice.
        </p>
      </section>
    </div>
  );
}
