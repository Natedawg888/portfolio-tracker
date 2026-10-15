/**
 * Household take-home pay (KAN-79). Each member who opts in is worked out on their own with the
 * PAYE engine (NZ taxes people individually), and the household figures are the sum.
 * Owners and adults see each opted-in member; viewers see household totals only. Members who
 * haven't opted in are never shown. Amounts follow Hide amounts through formatNzd.
 */
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { api, formatNzd } from '../../api/client';
import type { HouseholdPayFigures, HouseholdPayInputs, HouseholdPayeView, HouseholdWhatIfChange, HouseholdWhatIfResult } from '../../types';
import { PAYE_PREFS_STORAGE_KEY, loadPayePrefs } from '../../lib/payePrefs';
import { payTaxYearRates } from '../../lib/payeRates';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

const COLUMNS: { key: keyof HouseholdPayFigures; label: string }[] = [
  { key: 'grossNzd', label: 'Gross' },
  { key: 'payeNzd', label: 'PAYE' },
  { key: 'accNzd', label: 'ACC levy' },
  { key: 'kiwiSaverNzd', label: 'KiwiSaver' },
  { key: 'studentLoanNzd', label: 'Student loan' },
  { key: 'netNzd', label: 'Take-home' },
];

const FREQUENCIES: { value: HouseholdPayInputs['frequency']; label: string }[] = [
  { value: 'year', label: 'a year' },
  { value: 'month', label: 'a month' },
  { value: 'fortnight', label: 'a fortnight' },
  { value: 'week', label: 'a week' },
  { value: 'hour', label: 'an hour' },
];

/** Gross … take-home for one person or the household, a year. */
function Figures({ f, title }: { f: HouseholdPayFigures; title?: string }) {
  return (
    <dl className="hh-pay-figures" aria-label={title}>
      {COLUMNS.map((c) => (
        <div key={c.key} className={c.key === 'netNzd' ? 'hh-pay-net' : undefined}>
          <dt>{c.label}</dt>
          <dd className="money">{formatNzd(c.key === 'grossNzd' || c.key === 'netNzd' || f[c.key] === 0 ? f[c.key] : -f[c.key])}</dd>
        </div>
      ))}
    </dl>
  );
}

/** PAYE page inputs saved on this device, if the person has used it here. */
function fromPayePage(): HouseholdPayInputs | null {
  try {
    if (!localStorage.getItem(PAYE_PREFS_STORAGE_KEY)) return null;
  } catch {
    return null;
  }
  const p = loadPayePrefs();
  if (p.payType !== 'salary' && p.payType !== 'hourly') return null;
  return {
    amount: Number(p.amount) || 0,
    frequency: p.payType === 'hourly' ? 'hour' : p.frequency === 'hour' ? 'year' : p.frequency,
    hoursPerWeek: Number(p.hoursPerWeek) || 40,
    employment: p.employment,
    secondaryTotalAnnualIncome: Number(p.secondaryTotal) || 0,
    otherAnnualGross: Number(p.otherAnnual) || 0,
    kiwiSaverOptIn: p.kiwiSaverOptIn,
    kiwiSaverEmployeeRatePct: Number(p.ksRate) || 0,
    kiwiSaverEmployerRatePct: Number(p.ksEmployerRate) || 0,
    salarySacrifice: p.salarySacrifice,
    studentLoan: p.studentLoan,
    ietc: p.ietc,
  };
}

function blankInputs(): HouseholdPayInputs {
  const r = payTaxYearRates();
  return {
    amount: 0,
    frequency: 'year',
    hoursPerWeek: 40,
    employment: 'primary',
    secondaryTotalAnnualIncome: 0,
    otherAnnualGross: 0,
    kiwiSaverOptIn: true,
    kiwiSaverEmployeeRatePct: r.kiwiSaverDefaultEmployeeRate,
    kiwiSaverEmployerRatePct: r.kiwiSaverEmployerMinRate,
    salarySacrifice: false,
    studentLoan: false,
    ietc: true,
  };
}

type Draft = Record<keyof HouseholdPayInputs, string | boolean>;
const toDraft = (i: HouseholdPayInputs): Draft => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, typeof v === 'boolean' ? v : String(v)])) as Draft;

/** Your opt-in: what you share and how it's worked out. */
function MyPay({ view, onSaved, onNote }: { view: HouseholdPayeView; onSaved: (v: HouseholdPayeView) => void; onNote: (m: string) => void }) {
  const id = useId();
  const mine = view.mine;
  const [editing, setEditing] = useState(false);
  const [useSalary, setUseSalary] = useState(mine.inputs != null || !mine.optedIn);
  const [includeSources, setIncludeSources] = useState(mine.includePaySources);
  const [d, setD] = useState<Draft>(() => toDraft(mine.inputs ?? blankInputs()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deviceInputs = fromPayePage();
  const ksRates = payTaxYearRates().kiwiSaverEmployeeRates;
  const set = (k: keyof HouseholdPayInputs, v: string | boolean) => setD((prev) => ({ ...prev, [k]: v }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const inputs = useSalary
      ? (Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === 'boolean' || k === 'frequency' || k === 'employment' ? v : Number(v) || 0])) as unknown as HouseholdPayInputs)
      : null;
    setBusy(true);
    try {
      const v = await api.household.setMyPay({ inputs, includePaySources: includeSources });
      onSaved(v);
      setEditing(false);
      onNote(mine.optedIn ? 'Your shared pay is updated.' : 'You’re sharing your pay with the household.');
    } catch (err) {
      setError(errText(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setBusy(true);
    try {
      onSaved(await api.household.clearMyPay());
      setEditing(false);
      onNote('You’ve stopped sharing your pay.');
    } catch (err) {
      setError(errText(err, 'Could not stop sharing.'));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="hh-block">
        <h4>Your pay</h4>
        <p className="muted small">
          {mine.optedIn
            ? 'You share your pay with the household. Adults see your figures; viewers see only the household total.'
            : 'Your pay is private. Share it to include it in the household’s take-home. Adults will see your figures; viewers see only the total.'}
        </p>
        <div className="hh-pay-actions">
          {view.active ? (
            <button type="button" className="btn primary" onClick={() => setEditing(true)}>
              {mine.optedIn ? 'Change what I share' : 'Share my pay'}
            </button>
          ) : null}
          {mine.optedIn ? (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void stop()}>
              Stop sharing
            </button>
          ) : null}
        </div>
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
      </div>
    );
  }

  const num = (k: keyof HouseholdPayInputs, label: string, opts: { step?: string; max?: number } = {}) => (
    <div className="hh-pay-field">
      <label htmlFor={`${id}-${k}`}>{label}</label>
      <input id={`${id}-${k}`} type="number" min={0} max={opts.max} step={opts.step ?? '0.01'} inputMode="decimal" value={String(d[k])} onChange={(e) => set(k, e.target.value)} />
    </div>
  );
  const check = (k: keyof HouseholdPayInputs, label: string) => (
    <label className="hh-share-item">
      <input type="checkbox" checked={d[k] === true} onChange={(e) => set(k, e.target.checked)} />
      <span>{label}</span>
    </label>
  );

  return (
    <form className="hh-block hh-pay-form" onSubmit={save}>
      <h4>Your pay</h4>
      <p className="muted small">Saved with your household, not on this device. Worked out with the same calculator as the PAYE page. Payroll giving and investing credits aren’t included.</p>
      {deviceInputs ? (
        <button type="button" className="link-btn hh-edit" onClick={() => { setUseSalary(true); setD(toDraft(deviceInputs)); }}>
          Fill in from my PAYE page
        </button>
      ) : null}
      <label className="hh-share-item">
        <input type="checkbox" checked={useSalary} onChange={(e) => setUseSalary(e.target.checked)} />
        <span>Salary or wages</span>
      </label>
      {useSalary ? (
        <fieldset className="hh-pay-fields">
          <legend className="sr-only">Salary or wages</legend>
          <div className="hh-pay-row">
            {num('amount', 'Pay before tax (NZD)')}
            <div className="hh-pay-field">
              <label htmlFor={`${id}-frequency`}>Paid</label>
              <select id={`${id}-frequency`} value={String(d.frequency)} onChange={(e) => set('frequency', e.target.value)}>
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            {num('hoursPerWeek', 'Hours a week', { step: '0.5', max: 168 })}
          </div>
          <div className="hh-pay-field">
            <label htmlFor={`${id}-employment`}>This job is</label>
            <select id={`${id}-employment`} value={String(d.employment)} onChange={(e) => set('employment', e.target.value)}>
              <option value="primary">My main job</option>
              <option value="secondary">A second job (secondary tax code)</option>
            </select>
          </div>
          {d.employment === 'secondary' ? (
            <div className="hh-pay-row">
              {num('secondaryTotalAnnualIncome', 'Total yearly income, all jobs')}
              {num('otherAnnualGross', 'Yearly pay from other jobs')}
            </div>
          ) : null}
          {check('kiwiSaverOptIn', 'KiwiSaver')}
          {d.kiwiSaverOptIn === true ? (
            <div className="hh-pay-row">
              <div className="hh-pay-field">
                <label htmlFor={`${id}-ks`}>My contribution</label>
                <select id={`${id}-ks`} value={String(d.kiwiSaverEmployeeRatePct)} onChange={(e) => set('kiwiSaverEmployeeRatePct', e.target.value)}>
                  {[...new Set([...ksRates, Number(d.kiwiSaverEmployeeRatePct)])].filter((r) => r > 0).sort((a, b) => a - b).map((r) => (
                    <option key={r} value={String(r)}>{r}%</option>
                  ))}
                </select>
              </div>
              {num('kiwiSaverEmployerRatePct', 'Employer (%)', { step: '0.5', max: 100 })}
            </div>
          ) : null}
          {check('studentLoan', 'Student loan')}
          {d.employment === 'primary' ? check('ietc', 'Independent earner tax credit (IETC) on my tax code') : null}
        </fieldset>
      ) : null}
      {mine.paySourceCount > 0 ? (
        <label className="hh-share-item">
          <input type="checkbox" checked={includeSources} onChange={(e) => setIncludeSources(e.target.checked)} />
          <span>Include my saved pay sources ({mine.paySourceCount})</span>
        </label>
      ) : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="hh-pay-actions">
        <button type="submit" className="btn primary" disabled={busy}>
          {mine.optedIn ? 'Save' : 'Share my pay'}
        </button>
        <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Owners and adults: try a change for one member and see the household's take-home. */
function WhatIf({ view }: { view: HouseholdPayeView }) {
  const id = useId();
  const [memberId, setMemberId] = useState(view.members[0]?.memberId ?? '');
  const [kind, setKind] = useState<HouseholdWhatIfChange['kind']>('hours');
  const [value, setValue] = useState('');
  const [result, setResult] = useState<HouseholdWhatIfResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ksRates = payTaxYearRates(view.taxYear).kiwiSaverEmployeeRates;
  if (!view.members.length) return null;

  async function run(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number(value);
    const change: HouseholdWhatIfChange =
      kind === 'stop' ? { kind } : kind === 'hours' ? { kind, hoursPerWeek: n } : kind === 'salary' ? { kind, annualNzd: n } : { kind, ratePct: n };
    try {
      setResult(await api.household.payWhatIf(memberId, view.taxYear, change));
    } catch (err) {
      setResult(null);
      setError(errText(err, 'Could not work that out.'));
    }
  }

  const change = result ? result.after.netNzd - result.before.netNzd : 0;
  return (
    <form className="hh-block hh-pay-form" onSubmit={run}>
      <h4>What if…</h4>
      <div className="hh-pay-row">
        <div className="hh-pay-field">
          <label htmlFor={`${id}-who`}>Who</label>
          <select id={`${id}-who`} value={memberId} onChange={(e) => { setMemberId(e.target.value); setResult(null); }}>
            {view.members.map((m) => (
              <option key={m.memberId} value={m.memberId}>{m.name}</option>
            ))}
          </select>
        </div>
        <div className="hh-pay-field">
          <label htmlFor={`${id}-kind`}>Change</label>
          <select id={`${id}-kind`} value={kind} onChange={(e) => { setKind(e.target.value as HouseholdWhatIfChange['kind']); setValue(''); setResult(null); }}>
            <option value="hours">Works different hours</option>
            <option value="salary">Earns a different salary</option>
            <option value="kiwisaver">Changes KiwiSaver rate</option>
            <option value="stop">Stops work</option>
          </select>
        </div>
        {kind === 'hours' || kind === 'salary' ? (
          <div className="hh-pay-field">
            <label htmlFor={`${id}-value`}>{kind === 'hours' ? 'Hours a week' : 'Salary a year (NZD)'}</label>
            <input id={`${id}-value`} type="number" min={0} step={kind === 'hours' ? '0.5' : '1'} inputMode="decimal" required value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        ) : null}
        {kind === 'kiwisaver' ? (
          <div className="hh-pay-field">
            <label htmlFor={`${id}-value`}>New rate</label>
            <select id={`${id}-value`} required value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Choose</option>
              {ksRates.map((r) => (
                <option key={r} value={String(r)}>{r}%</option>
              ))}
              <option value="0">None (not contributing)</option>
            </select>
          </div>
        ) : null}
      </div>
      <div className="hh-pay-actions">
        <button type="submit" className="btn">Work it out</button>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {result ? (
        <div className="hh-pay-whatif" aria-live="polite">
          <p>
            <strong>{result.description}:</strong> household take-home goes from <span className="money">{formatNzd(result.before.netNzd)}</span> to{' '}
            <span className="money">{formatNzd(result.after.netNzd)}</span> a year.
          </p>
          <p className={'small ' + (change < 0 ? 'hh-owes' : 'muted')}>
            {change === 0
              ? 'No change.'
              : `${change < 0 ? 'Down' : 'Up'} ${formatNzd(Math.abs(result.netChangePerPeriod.month))} a month · ${formatNzd(Math.abs(result.netChangePerPeriod.fortnight))} a fortnight · ${formatNzd(Math.abs(result.netChangePerPeriod.week))} a week.`}
          </p>
          {result.notes.map((n) => (
            <p key={n} className="muted small">{n}</p>
          ))}
        </div>
      ) : null}
    </form>
  );
}

export function HouseholdPaye({ onNote, onBudgetFeedChange }: { onNote: (msg: string) => void; onBudgetFeedChange: () => void }) {
  const [view, setView] = useState<HouseholdPayeView | null>(null);
  const [year, setYear] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const yearId = useId();

  const load = useCallback((y?: number) => {
    api.household.paye(y).then(setView).catch((e: unknown) => setError(errText(e, 'Could not load household pay.')));
  }, []);
  useEffect(() => load(year), [load, year]);

  // Saving reloads in the year being viewed.
  const saved = (v: HouseholdPayeView) => {
    if (year && v.taxYear !== year) load(year);
    else setView(v);
  };

  if (!view) {
    return (
      <section className="panel" aria-labelledby="hh-pay-title">
        <h3 id="hh-pay-title">Household take-home pay</h3>
        {error ? <p className="auth-error" role="alert">{error}</p> : <p className="muted">Loading…</p>}
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="hh-pay-title">
      <div className="hh-head">
        <h3 id="hh-pay-title">Household take-home pay</h3>
      </div>
      <p className="muted small">
        Each person is taxed on their own pay in New Zealand, so everyone is worked out separately with the PAYE calculator and added up. Only people who choose to share their pay are included.
      </p>
      <div className="hh-pay-field hh-pay-year">
        <label htmlFor={yearId}>Tax year</label>
        <select id={yearId} value={view.taxYear} onChange={(e) => setYear(Number(e.target.value))}>
          {view.years.map((y) => (
            <option key={y.startYear} value={y.startYear}>
              {y.startYear}/{String((y.startYear + 1) % 100).padStart(2, '0')}
              {y.current ? ' (this year)' : ''}
            </option>
          ))}
        </select>
        <span className="muted small">{view.years.find((y) => y.startYear === view.taxYear)?.label}</span>
      </div>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}

      <div className="hh-shared">
        {view.includedCount === 0 ? (
          <p className="muted small">No one is sharing their pay yet.</p>
        ) : (
          <div className="hh-block">
            <h4>Household, a year</h4>
            <p className="muted small">
              {view.includedCount === 1 ? 'One person shares their pay.' : `${view.includedCount} people share their pay.`}
            </p>
            <Figures f={view.totals} title="Household totals a year" />
            <ul className="hh-pay-periods" aria-label="Household take-home per period">
              <li><span>Week</span><span className="money">{formatNzd(view.netPerPeriod.week)}</span></li>
              <li><span>Fortnight</span><span className="money">{formatNzd(view.netPerPeriod.fortnight)}</span></li>
              <li><span>Month</span><span className="money">{formatNzd(view.netPerPeriod.month)}</span></li>
              <li><span>Year</span><span className="money">{formatNzd(view.netPerPeriod.year)}</span></li>
            </ul>
          </div>
        )}

        {view.canSeeMembers && view.members.length ? (
          <div className="hh-block">
            <h4>Each person, a year</h4>
            {view.members.map((m) => (
              <div key={m.memberId} className="hh-pay-member">
                <h5>
                  {m.name}
                  {m.isMe ? ' (you)' : ''}
                </h5>
                {m.lines.length > 1 || m.lines[0]?.kind !== 'salary'
                  ? m.lines.map((l) => (
                      <p key={l.label} className="muted small">
                        {l.label}
                        {l.taxCode ? ` · tax code ${l.taxCode}` : ''}
                        {l.onPaye ? '' : ' · not taxed through payroll (gross and amount received only)'}
                      </p>
                    ))
                  : m.lines[0]?.taxCode ? <p className="muted small">Tax code {m.lines[0].taxCode}</p> : null}
                <Figures f={m.totals} title={`${m.name} a year`} />
              </div>
            ))}
          </div>
        ) : null}
        {!view.canSeeMembers && view.includedCount > 0 ? <p className="muted small">As a viewer you see the household total only.</p> : null}

        <MyPay key={`${view.mine.optedIn}-${view.taxYear}`} view={view} onSaved={saved} onNote={onNote} />

        {view.canSeeMembers ? <WhatIf key={view.taxYear} view={view} /> : null}

        {view.canEdit ? (
          <div className="hh-block">
            <h4>Budget</h4>
            <label className="hh-share-item">
              <input
                type="checkbox"
                checked={view.feedBudget}
                onChange={(e) =>
                  void api.household
                    .setPayFeedBudget(e.target.checked)
                    .then((v) => {
                      saved(v);
                      onBudgetFeedChange();
                      onNote(v.feedBudget ? 'Take-home pay now shows as money in for shared budgets.' : 'Take-home pay no longer shows on shared budgets.');
                    })
                    .catch((err: unknown) => setError(errText(err, 'Could not change this.')))
                }
              />
              <span>Use this year’s combined take-home as money in for shared budgets</span>
            </label>
          </div>
        ) : null}

        <div className="hh-block">
          <h4>Tax credits worth checking</h4>
          <p className="muted small">For information only. KoruLedger doesn’t decide who is eligible or give tax advice; check with Inland Revenue.</p>
          <ul className="hh-pay-links small">
            <li>
              <a href="https://www.ird.govt.nz/income-tax/income-tax-for-individuals/individual-tax-credits/independent-earner-tax-credit-ietc" target="_blank" rel="noreferrer">
                Independent earner tax credit (IETC)
              </a>{' '}
              — for some people earning between $24,000 and $70,000 who don’t get certain other payments.
            </li>
            <li>
              <a href="https://www.ird.govt.nz/working-for-families" target="_blank" rel="noreferrer">
                Working for Families
              </a>{' '}
              — payments for families with dependent children. See{' '}
              <a href="https://www.ird.govt.nz/working-for-families/eligibility" target="_blank" rel="noreferrer">
                who can get it
              </a>
              .
            </li>
            <li>
              <a href="https://www.ird.govt.nz/income-tax/income-tax-for-individuals/individual-tax-credits" target="_blank" rel="noreferrer">
                Other individual tax credits
              </a>{' '}
              (Inland Revenue).
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
