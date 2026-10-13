/**
 * Mortgage calculator (KAN-56), opened from a button on the PAYE page. Pure maths on
 * what the user types (src/lib/mortgageCalc.ts); the share of take-home pay uses the
 * PAYE result on the page, when there is one. Inputs are remembered in this browser only.
 */
import { useEffect, useId, useState } from 'react';
import { formatNzd } from '../api/client';
import {
  REPAYMENT_FREQ,
  REPAYMENT_LABELS,
  calculateMortgage,
  mortgageInputError,
  shareOfTakeHome,
  type RepaymentFrequency,
} from '../lib/mortgageCalc';

const STORAGE_KEY = 'portfolio-tracker-mortgage-calculator';

type Fields = { principal: string; ratePct: string; years: string; frequency: RepaymentFrequency };
const DEFAULTS: Fields = { principal: '', ratePct: '', years: '30', frequency: 'fortnightly' };

function readFields(): Fields {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Fields> | null;
    if (!raw) return DEFAULTS;
    return {
      principal: typeof raw.principal === 'string' ? raw.principal : DEFAULTS.principal,
      ratePct: typeof raw.ratePct === 'string' ? raw.ratePct : DEFAULTS.ratePct,
      years: typeof raw.years === 'string' ? raw.years : DEFAULTS.years,
      frequency: raw.frequency && raw.frequency in REPAYMENT_FREQ ? raw.frequency : DEFAULTS.frequency,
    };
  } catch {
    return DEFAULTS;
  }
}

const PER: Record<RepaymentFrequency, string> = { weekly: 'week', fortnightly: 'fortnight', monthly: 'month' };

export function MortgageCalculator({ id, takeHomeYear }: { id: string; takeHomeYear: number | null }) {
  const [f, setF] = useState<Fields>(readFields);
  const headingId = useId();
  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setF((prev) => ({ ...prev, [k]: v }));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
    } catch {
      /* storage blocked: inputs just aren't remembered */
    }
  }, [f]);

  const input = { principal: Number(f.principal), ratePct: f.ratePct.trim() === '' ? NaN : Number(f.ratePct), years: Number(f.years) };
  const started = f.principal.trim() !== '' || f.ratePct.trim() !== '';
  const error = mortgageInputError(input);
  const result = calculateMortgage({ ...input, frequency: f.frequency });
  const share = result ? shareOfTakeHome(result.perYear, takeHomeYear) : null;

  return (
    <section id={id} className="panel mortgage-calc" aria-labelledby={headingId}>
      <h3 id={headingId}>Mortgage calculator</h3>
      <p className="muted small">Uses only the numbers you enter. A table loan with the same repayment every time.</p>
      <div className="form-grid">
        <label>
          Loan amount (NZD)
          <input type="number" min={0} step="any" inputMode="decimal" value={f.principal} placeholder="e.g. 600000" onChange={(e) => set('principal', e.target.value)} />
        </label>
        <label>
          Interest rate (% a year)
          <input type="number" min={0} max={30} step="0.01" inputMode="decimal" value={f.ratePct} placeholder="e.g. 5.5" onChange={(e) => set('ratePct', e.target.value)} />
        </label>
        <label>
          Term (years)
          <input type="number" min={1} max={50} step={1} inputMode="numeric" value={f.years} onChange={(e) => set('years', e.target.value)} />
        </label>
        <label>
          Repayments
          <select value={f.frequency} onChange={(e) => set('frequency', e.target.value as RepaymentFrequency)}>
            {(Object.keys(REPAYMENT_FREQ) as RepaymentFrequency[]).map((k) => (
              <option key={k} value={k}>
                {REPAYMENT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mortgage-result" aria-live="polite">
        {result ? (
          <>
            <p className="mortgage-figure">
              <span className="money">{formatNzd(result.repayment)}</span>
              <span className="muted"> a {PER[f.frequency]}</span>
            </p>
            <dl className="mortgage-totals">
              <div>
                <dt>Total interest</dt>
                <dd className="money">{formatNzd(result.totalInterest)}</dd>
              </div>
              <div>
                <dt>Total repaid</dt>
                <dd className="money">{formatNzd(result.totalRepaid)}</dd>
              </div>
              <div>
                <dt>Repayments</dt>
                <dd>{result.repayments.toLocaleString('en-NZ')}</dd>
              </div>
            </dl>
            {share != null ? (
              <p className="small">
                That’s <strong>{share}%</strong> of the take-home pay above ({formatNzd(result.perYear)} of{' '}
                {formatNzd(takeHomeYear)} a year).
              </p>
            ) : null}
            <p className="muted tiny">An estimate. Your bank rounds and adjusts the last repayment, so its figure can differ by a few cents.</p>
          </>
        ) : started && error ? (
          <p className="muted small">{error}</p>
        ) : (
          <p className="muted small">Enter the loan amount and interest rate to see the repayments.</p>
        )}
      </div>
    </section>
  );
}
