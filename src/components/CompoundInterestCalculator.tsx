/**
 * Compound interest calculator (KAN-57), in the Calculators section of Projections.
 * Pure maths on what the user types (src/lib/compoundInterest.ts). Inputs are remembered in
 * this browser only, as a convenience.
 */
import { useEffect, useMemo, useState } from 'react';
import { formatNzd } from '../api/client';
import { AssetLineChart, type LineSeries } from './AssetLineChart';
import {
  calculateCompound,
  COMPOUNDING,
  CONTRIBUTION_FREQ,
  FREQ_LABELS,
  RETURN_TAX_PRESETS,
  type Compounding,
  type ContributionFrequency,
} from '../lib/compoundInterest';

const STORAGE_KEY = 'portfolio-tracker-compound-calculator';

const CONTRIBUTION_LABELS: Record<ContributionFrequency, string> = {
  weekly: 'Week',
  fortnightly: 'Fortnight',
  monthly: 'Month',
  quarterly: 'Quarter',
  yearly: 'Year',
};

type Fields = {
  principal: string;
  ratePct: string;
  compounding: Compounding;
  contribution: string;
  contributionFrequency: ContributionFrequency;
  contributeAtStart: boolean;
  contributionIncreasePct: string;
  years: string;
  months: string;
  /** Index into RETURN_TAX_PRESETS, or 'custom'. */
  taxPreset: string;
  taxPct: string;
  feePctYear: string;
  fixedFee: string;
  fixedFeePer: 'month' | 'year';
};

const DEFAULTS: Fields = {
  principal: '10000',
  ratePct: '5',
  compounding: 'monthly',
  contribution: '200',
  contributionFrequency: 'monthly',
  contributeAtStart: false,
  contributionIncreasePct: '0',
  years: '10',
  months: '0',
  taxPreset: '0',
  taxPct: '',
  feePctYear: '0',
  fixedFee: '0',
  fixedFeePer: 'month',
};

function loadFields(): Fields {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const o = JSON.parse(raw) as Partial<Fields>;
    return {
      ...DEFAULTS,
      ...Object.fromEntries(Object.entries(o).filter(([k, v]) => k in DEFAULTS && typeof v === typeof DEFAULTS[k as keyof Fields])),
      compounding: o.compounding && o.compounding in COMPOUNDING ? o.compounding : DEFAULTS.compounding,
      contributionFrequency:
        o.contributionFrequency && o.contributionFrequency in CONTRIBUTION_FREQ ? o.contributionFrequency : DEFAULTS.contributionFrequency,
      fixedFeePer: o.fixedFeePer === 'year' ? 'year' : 'month',
    };
  } catch {
    return DEFAULTS;
  }
}

function num(text: string, min: number, max: number): number {
  const n = Number(text);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
}

function addMonths(months: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function CompoundInterestCalculator({ startingAmountNzd }: { startingAmountNzd?: number | null }) {
  const [f, setF] = useState<Fields>(loadFields);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
    } catch {
      /* private mode: nothing remembered */
    }
  }, [f]);
  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setF((prev) => ({ ...prev, [k]: v }));

  const taxPct =
    f.taxPreset === 'custom' ? num(f.taxPct, 0, 100) : (RETURN_TAX_PRESETS[Number(f.taxPreset)]?.pct ?? 0);
  const result = useMemo(
    () =>
      calculateCompound({
        taxPct,
        feePctYear: num(f.feePctYear, 0, 20),
        fixedFee: num(f.fixedFee, 0, 1e7),
        fixedFeePer: f.fixedFeePer,
        principal: num(f.principal, 0, 1e12),
        ratePct: num(f.ratePct, -50, 100),
        compounding: f.compounding,
        contribution: num(f.contribution, 0, 1e10),
        contributionFrequency: f.contributionFrequency,
        contributeAtStart: f.contributeAtStart,
        contributionIncreasePct: num(f.contributionIncreasePct, 0, 500),
        years: Math.floor(num(f.years, 0, 100)),
        months: Math.floor(num(f.months, 0, 11)),
      }),
    [f, taxPct],
  );

  const series: LineSeries[] = useMemo(() => {
    const start = { at: addMonths(0), balance: num(f.principal, 0, 1e12) };
    const pts = [start, ...result.rows.map((r) => ({ at: addMonths(r.months), balance: r.balance }))];
    const contrib = [{ at: start.at, value: start.balance }, ...result.rows.map((r) => ({ at: addMonths(r.months), value: r.contributed }))];
    return [
      { key: 'balance', label: 'Balance', colour: '#3d9a6a', points: pts.map((p) => ({ at: p.at, value: p.balance })) },
      { key: 'contributed', label: 'You put in', colour: '#4a8fd4', points: contrib },
    ];
  }, [result, f.principal]);

  const years = Math.floor(num(f.years, 0, 100));
  const months = Math.floor(num(f.months, 0, 11));
  const span = `${years ? `${years} year${years === 1 ? '' : 's'}` : ''}${years && months ? ' ' : ''}${months ? `${months} month${months === 1 ? '' : 's'}` : ''}` || 'no time';

  return (
    <section className="panel" id="compound-interest" aria-labelledby="compound-heading">
      <h3 id="compound-heading">Compound interest calculator</h3>
      <p className="section-desc">
        What a starting amount and regular contributions grow to when interest is added to the balance and then earns
        interest itself. Uses only the numbers you enter — not a forecast or advice.
      </p>
      <div className="form-grid">
        <label>
          Starting amount (NZD)
          <input type="number" min={0} step="any" inputMode="decimal" value={f.principal} onChange={(e) => set('principal', e.target.value)} />
          {startingAmountNzd != null && startingAmountNzd > 0 ? (
            <button type="button" className="btn small ghost" style={{ alignSelf: 'flex-start' }} onClick={() => set('principal', String(Math.round(startingAmountNzd)))}>
              Use my assets today ({formatNzd(startingAmountNzd)})
            </button>
          ) : null}
        </label>
        <label>
          Yearly interest rate (%)
          <input type="number" min={-50} max={100} step="0.1" inputMode="decimal" value={f.ratePct} onChange={(e) => set('ratePct', e.target.value)} />
        </label>
        <label>
          Interest compounds
          <select value={f.compounding} onChange={(e) => set('compounding', e.target.value as Compounding)}>
            {(Object.keys(COMPOUNDING) as Compounding[]).map((k) => (
              <option key={k} value={k}>
                {FREQ_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Regular contribution (NZD)
          <input type="number" min={0} step="any" inputMode="decimal" value={f.contribution} onChange={(e) => set('contribution', e.target.value)} />
        </label>
        <label>
          Contribution every
          <select value={f.contributionFrequency} onChange={(e) => set('contributionFrequency', e.target.value as ContributionFrequency)}>
            {(Object.keys(CONTRIBUTION_FREQ) as ContributionFrequency[]).map((k) => (
              <option key={k} value={k}>
                {CONTRIBUTION_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Contributions go up each year by (%)
          <input type="number" min={0} max={500} step="1" inputMode="decimal" value={f.contributionIncreasePct} onChange={(e) => set('contributionIncreasePct', e.target.value)} />
        </label>
        <label>
          Years
          <input type="number" min={0} max={100} step="1" inputMode="numeric" value={f.years} onChange={(e) => set('years', e.target.value)} />
        </label>
        <label>
          Months
          <input type="number" min={0} max={11} step="1" inputMode="numeric" value={f.months} onChange={(e) => set('months', e.target.value)} />
        </label>
        <label>
          Tax on returns
          <select value={f.taxPreset} onChange={(e) => set('taxPreset', e.target.value)}>
            {RETURN_TAX_PRESETS.map((t, i) => (
              <option key={t.label} value={String(i)}>
                {t.label}
              </option>
            ))}
            <option value="custom">Your own rate</option>
          </select>
          <span className="muted small">PIE funds use your PIR; bank interest uses your RWT rate.</span>
        </label>
        {f.taxPreset === 'custom' ? (
          <label>
            Tax rate (%)
            <input type="number" min={0} max={100} step="0.5" inputMode="decimal" value={f.taxPct} onChange={(e) => set('taxPct', e.target.value)} />
          </label>
        ) : null}
        <label>
          Management fee (% a year)
          <input type="number" min={0} max={20} step="0.05" inputMode="decimal" value={f.feePctYear} onChange={(e) => set('feePctYear', e.target.value)} />
          <span className="muted small">Taken off the balance, e.g. a fund&apos;s 0.5% a year.</span>
        </label>
        <label>
          Fixed fee (NZD)
          <input type="number" min={0} step="any" inputMode="decimal" value={f.fixedFee} onChange={(e) => set('fixedFee', e.target.value)} />
        </label>
        <label>
          Fixed fee every
          <select value={f.fixedFeePer} onChange={(e) => set('fixedFeePer', e.target.value === 'year' ? 'year' : 'month')}>
            <option value="month">Month</option>
            <option value="year">Year</option>
          </select>
        </label>
        <label className="field checkbox-field">
          <label className="inline-check">
            <input type="checkbox" checked={f.contributeAtStart} onChange={(e) => set('contributeAtStart', e.target.checked)} />
            Contribute at the start of each period
          </label>
          <span className="muted small">Paying at the start earns one more period of interest each time.</span>
        </label>
      </div>

      <div className="grid cards" style={{ marginTop: '1rem' }}>
        <div className="card">
          <p className="eyebrow">After {span}</p>
          <p className="stat-value">{formatNzd(result.futureValue)}</p>
        </div>
        <div className="card">
          <p className="eyebrow">You put in</p>
          <p className="stat-value">{formatNzd(result.totalContributed)}</p>
        </div>
        <div className="card">
          <p className="eyebrow">{result.totalTax > 0 || result.totalFees > 0 ? 'Interest after tax and fees' : 'Interest earned'}</p>
          <p className="stat-value">{formatNzd(result.totalInterest)}</p>
          <p className="muted small">Effective yearly rate {result.effectiveAnnualRatePct}% before tax and fees</p>
        </div>
        {result.totalTax > 0 || result.totalFees > 0 ? (
          <div className="card">
            <p className="eyebrow">Tax and fees</p>
            <p className="stat-value">{formatNzd(result.totalTax + result.totalFees)}</p>
            <p className="muted small">
              Tax {formatNzd(result.totalTax)} · fees {formatNzd(result.totalFees)} · interest before them {formatNzd(result.grossInterest)}
            </p>
          </div>
        ) : null}
      </div>

      {result.rows.length > 0 ? (
        <>
          <AssetLineChart series={series} title="Balance over time (NZD)" emptyHint="Nothing to plot yet." resolution="month" fullWidth foregroundKey="balance" />
          <div className="table-wrap" style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Year</th>
                  <th style={{ textAlign: 'right' }}>You put in</th>
                  <th style={{ textAlign: 'right' }}>Interest (net)</th>
                  {result.totalTax > 0 ? <th style={{ textAlign: 'right' }}>Tax</th> : null}
                  {result.totalFees > 0 ? <th style={{ textAlign: 'right' }}>Fees</th> : null}
                  <th style={{ textAlign: 'right' }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.months}>
                    <td>{r.months % 12 === 0 ? r.year : `${Math.floor(r.months / 12)}y ${r.months % 12}m`}</td>
                    <td className="money" style={{ textAlign: 'right' }}>{formatNzd(r.contributed)}</td>
                    <td className="money" style={{ textAlign: 'right' }}>{formatNzd(r.interest)}</td>
                    {result.totalTax > 0 ? <td className="money" style={{ textAlign: 'right' }}>{formatNzd(r.tax)}</td> : null}
                    {result.totalFees > 0 ? <td className="money" style={{ textAlign: 'right' }}>{formatNzd(r.fees)}</td> : null}
                    <td className="money" style={{ textAlign: 'right' }}>{formatNzd(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      <p className="muted small" style={{ marginTop: '0.5rem' }}>
        Tax is taken each time interest is credited; fees come off the balance each period. Tax and fees are
        totals so far in the table. Not tax advice — check your PIR or RWT rate with IRD.
      </p>
    </section>
  );
}
