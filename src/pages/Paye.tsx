import { useEffect, useMemo, useState } from 'react';
import { api, formatNzd } from '../api/client';
import { beginPageRead, commitPageRead, readPageCache } from '../lib/pageDataCache';
import {
  calculatePaye,
  periodiseBreakdown,
  type EmploymentKind,
  type ExtraTaxCreditInput,
  type PayFrequency,
} from '../lib/payeCalc';
import {
  investingCreditsFromPortfolioIncome,
  mergePortfolioInvestingCredits,
  PAYE_TAX_YEAR_END,
  PAYE_TAX_YEAR_START,
  type PortfolioIncomeLike,
} from '../lib/payeInvestingFromPortfolio';
import {
  loadPayePrefs,
  savePayePrefs,
  type PayePayType,
  type CharityDonationLink,
  type PersistedCreditDraft,
} from '../lib/payePrefs';
import { charityLinksTotal } from '../lib/charityPayeLink';
import { OutputPayInputs, OutputPayResults, SavedPaySources } from '../components/OutputPay';
import type { OutputPayType, PieceRatePayeOptions } from '../lib/outputPayCalc';
import { loadOutputPayPrefs, saveOutputPayPrefs, type OutputPayPrefs } from '../lib/outputPayPrefs';
import {
  ACC_MAX_EARNINGS,
  ACC_MAX_LEVY,
  ACC_RATE,
  DONATION_TAX_CREDIT_RATE,
  INCOME_TAX_BRACKETS,
  KIWISAVER_ACCOUNT_DEFAULT_EMPLOYEE_RATE,
  KIWISAVER_DEFAULT_EMPLOYEE_RATE,
  KIWISAVER_EMPLOYEE_RATE_CHOICES,
  KIWISAVER_EMPLOYEE_RATES,
  KIWISAVER_EMPLOYER_MIN_RATE,
  PAYE_DEFAULT_HOURS_PER_WEEK,
  PAYE_TAX_YEAR_LABEL,
  INVESTING_CREDIT_KIND_OPTIONS,
  RATE_SOURCES,
  STUDENT_LOAN_ANNUAL_THRESHOLD,
  SCHEDULAR_SOURCES,
  STUDENT_LOAN_RATE,
  payTaxYearRates,
  type InvestingCreditKind,
} from '../lib/payeRates';

const PAY_TYPES: { value: PayePayType; label: string }[] = [
  { value: 'salary', label: 'Salary / wages' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'piece', label: 'Piece rate (employee)' },
  { value: 'schedular', label: 'Contract (schedular)' },
  { value: 'share_of_catch', label: 'Share of catch' },
];

function isOutputPayType(t: PayePayType): t is OutputPayType {
  return t === 'piece' || t === 'schedular' || t === 'share_of_catch';
}

/** Salary frequencies; hourly pay has its own pay type. */
const FREQUENCIES: { value: PayFrequency; label: string }[] = [
  { value: 'week', label: 'Weekly' },
  { value: 'fortnight', label: 'Fortnightly' },
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Yearly' },
];

const PERIOD_COLS: { key: 'hour' | 'week' | 'fortnight' | 'month' | 'year'; label: string }[] = [
  { key: 'hour', label: 'Hour' },
  { key: 'week', label: 'Week' },
  { key: 'fortnight', label: 'Fortnight' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
];


type PeriodRow = {
  label: string;
  amounts: { hour: number; week: number; fortnight: number; month: number; year: number };
  deduct: boolean;
};

function breakdownRows(
  result: NonNullable<ReturnType<typeof calculatePaye>>,
  periods: ReturnType<typeof periodiseBreakdown>,
  kiwiSaverOptIn: boolean,
): PeriodRow[] {
  const rows: PeriodRow[] = [
    { label: 'Gross pay', amounts: periods.gross, deduct: false },
    { label: 'Income tax', amounts: periods.incomeTax, deduct: true },
    { label: 'ACC earners’ levy', amounts: periods.acc, deduct: true },
    { label: 'PAYE (tax + ACC − credits)', amounts: periods.paye, deduct: true },
  ];
  if (result.ietcCredit > 0) {
    rows.push({ label: 'IETC credit', amounts: periods.ietc, deduct: false });
  }
  if (result.charityCredit > 0) {
    rows.push({ label: 'Donation tax credit', amounts: periods.charityCredit, deduct: false });
  }
  if (result.extraCreditsTotal > 0) {
    rows.push({ label: 'Investing credits', amounts: periods.extraCredits, deduct: false });
  }
  if (result.kiwiSaverEmployee > 0 || kiwiSaverOptIn) {
    rows.push({ label: 'KiwiSaver (employee)', amounts: periods.kiwiSaver, deduct: true });
  }
  if (kiwiSaverOptIn) {
    rows.push({ label: 'KiwiSaver (employer)', amounts: periods.employerKs, deduct: false });
  }
  if (result.studentLoan > 0) {
    rows.push({ label: 'Student loan', amounts: periods.studentLoan, deduct: true });
  }
  if (result.payrollGivingDonation > 0) {
    rows.push({ label: 'Payroll giving', amounts: periods.payrollGiving, deduct: true });
  }
  rows.push({ label: 'Take-home pay', amounts: periods.takeHome, deduct: false });
  return rows;
}

type CreditDraft = PersistedCreditDraft;

function newCreditId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function draftsToExtraCredits(drafts: CreditDraft[]): ExtraTaxCreditInput[] {
  return drafts.map((d) => ({
    id: d.id,
    kind: d.kind,
    label: d.label.trim() || undefined,
    annualAmount: Number(d.annualAmount) || 0,
  }));
}

function money(n: number): string {
  return formatNzd(n);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function CharityLinksFromBudget() {
  const [links, setLinks] = useState<CharityDonationLink[]>(() => loadPayePrefs().charityLinks);
  useEffect(() => {
    const refresh = () => setLinks(loadPayePrefs().charityLinks);
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  if (links.length === 0) {
    return (
      <p className="muted small span-2">
        Tip: on <strong>Budget</strong>, set a spend category to <strong>Charity</strong> to upload a
        receipt and link it here.
      </p>
    );
  }
  const total = charityLinksTotal();
  return (
    <div className="span-2 charity-links-panel">
      <h4 className="charity-links-title">From Budget (Charity)</h4>
      <p className="muted small">
        Linked donations: {formatNzd(total)} · keep receipts for myIR / IR526.
      </p>
      <ul className="charity-links-list">
        {links.map((l) => (
          <li key={l.txnId}>
            <span className="muted small">{l.date}</span>{' '}
            {l.description || 'Donation'}{' '}
            <span className="money">{formatNzd(l.amountNzd)}</span>
            {l.receiptUrl ? (
              <>
                {' · '}
                <a href={l.receiptUrl} target="_blank" rel="noreferrer">
                  Receipt
                </a>
              </>
            ) : (
              <span className="muted small"> · no receipt</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Paye() {

  const initial = useMemo(() => loadPayePrefs(), []);
  const rates = payTaxYearRates();

  const [payType, setPayType] = useState<PayePayType>(initial.payType);
  const [outputPrefs, setOutputPrefs] = useState<OutputPayPrefs>(() => loadOutputPayPrefs());
  useEffect(() => saveOutputPayPrefs(outputPrefs), [outputPrefs]);
  const setOutput = <K extends keyof OutputPayPrefs>(key: K, value: OutputPayPrefs[K]) =>
    setOutputPrefs((prev) => ({ ...prev, [key]: value }));
  const outputType = isOutputPayType(payType) ? payType : null;
  // Contractors and share fishers are not on PAYE: no KiwiSaver / PAYE deductions sections.
  const showPayeSections = outputType == null || outputType === 'piece';

  const [amount, setAmount] = useState(initial.amount);
  const [frequency, setFrequency] = useState<PayFrequency>(initial.frequency);
  const [hoursPerWeek, setHoursPerWeek] = useState(initial.hoursPerWeek);
  const [employment, setEmployment] = useState<EmploymentKind>(initial.employment);
  const [secondaryTotal, setSecondaryTotal] = useState(initial.secondaryTotal);
  const [otherAnnual, setOtherAnnual] = useState(initial.otherAnnual);

  const [kiwiSaverOptIn, setKiwiSaverOptIn] = useState(initial.kiwiSaverOptIn);
  const [ksRate, setKsRate] = useState(() => {
    const cached = readPageCache<{ employeeRatePct: number }>('paye:ks-rate');
    return cached ? String(cached.employeeRatePct) : initial.ksRate;
  });
  const [ksCustom, setKsCustom] = useState(() => {
    const cached = readPageCache<{ employeeRatePct: number }>('paye:ks-rate');
    if (!cached) return initial.ksCustom;
    return !KIWISAVER_EMPLOYEE_RATE_CHOICES.some((choice) => choice === cached.employeeRatePct);
  });
  const [ksRateReady, setKsRateReady] = useState(
    () => readPageCache<{ employeeRatePct: number }>('paye:ks-rate') != null,
  );
  const [ksEmployerRate, setKsEmployerRate] = useState(initial.ksEmployerRate);
  const [salarySacrifice, setSalarySacrifice] = useState(initial.salarySacrifice);

  const [studentLoan, setStudentLoan] = useState(initial.studentLoan);
  const [ietc, setIetc] = useState(initial.ietc);
  const [payrollGivingOn, setPayrollGivingOn] = useState(initial.payrollGivingOn);
  const [payrollGivingAnnual, setPayrollGivingAnnual] = useState(initial.payrollGivingAnnual);
  const [charityDonationsOn, setCharityDonationsOn] = useState(initial.charityDonationsOn);
  const [charityDonationsAnnual, setCharityDonationsAnnual] = useState(
    initial.charityDonationsAnnual,
  );
  const [extraCreditDrafts, setExtraCreditDrafts] = useState<CreditDraft[]>(() => {
    const rows = readPageCache<PortfolioIncomeLike[]>('paye:income');
    if (!rows) return initial.extraCredits;
    return mergePortfolioInvestingCredits(initial.extraCredits, investingCreditsFromPortfolioIncome(rows));
  });
  const [showSources, setShowSources] = useState(false);

  // Persist last inputs (incl. investing + charity credits) and re-apply on next load.
  // Preserve charityLinks written from Budget so we do not wipe receipt links.
  useEffect(() => {
    const existing = loadPayePrefs();
    savePayePrefs({
      payType,
      amount,
      frequency,
      hoursPerWeek,
      employment,
      secondaryTotal,
      otherAnnual,
      kiwiSaverOptIn,
      ksRate,
      ksCustom,
      ksEmployerRate,
      salarySacrifice,
      studentLoan,
      ietc,
      payrollGivingOn,
      payrollGivingAnnual,
      charityDonationsOn,
      charityDonationsAnnual,
      charityLinks: existing.charityLinks,
      extraCredits: extraCreditDrafts,
    });
  }, [
    payType,
    amount,
    frequency,
    hoursPerWeek,
    employment,
    secondaryTotal,
    otherAnnual,
    kiwiSaverOptIn,
    ksRate,
    ksCustom,
    ksEmployerRate,
    salarySacrifice,
    studentLoan,
    ietc,
    payrollGivingOn,
    payrollGivingAnnual,
    charityDonationsOn,
    charityDonationsAnnual,
    extraCreditDrafts,
  ]);

  // Saved employee rate for this account. The statutory minimum is the starting choice when none is saved.
  useEffect(() => {
    let cancelled = false;
    const stamp = beginPageRead('paye:ks-rate');
    api.settings
      .getKiwiSaverEmployeeRate()
      .then((row) => {
        if (cancelled) return;
        const rate = row.employeeRatePct;
        if (!commitPageRead(stamp, { employeeRatePct: rate })) return;
        const offered = KIWISAVER_EMPLOYEE_RATE_CHOICES.some((choice) => choice === rate);
        setKsRate(String(rate));
        setKsCustom(!offered);
        setKsRateReady(true);
      })
      .catch(() => {
        if (!cancelled) setKsRateReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ksRateReady) return;
    const rate = Number(ksRate);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100) return;
    const handle = window.setTimeout(() => {
      void api.settings.setKiwiSaverEmployeeRate(rate).catch(() => {
        /* keep the rate on screen; the next change tries again */
      });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [ksRate, ksRateReady]);

  // Auto-fill only from real savings-interest/dividend income records or transactions.
  // Plain income without explicit credit wording → add nothing (never invent RWT).
  useEffect(() => {
    let cancelled = false;
    const stamp = beginPageRead('paye:income');
    api.income
      .list({ from: PAYE_TAX_YEAR_START, to: PAYE_TAX_YEAR_END })
      .then((rows) => {
        if (cancelled) return;
        if (!commitPageRead(stamp, rows)) return;
        const suggested = investingCreditsFromPortfolioIncome(rows);
        setExtraCreditDrafts((prev) => mergePortfolioInvestingCredits(prev, suggested));
      })
      .catch(() => {
        /* leave persisted / manual credits as-is */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hours = Number(hoursPerWeek) || PAYE_DEFAULT_HOURS_PER_WEEK;
  const amountNum = Number(amount);
  const hasIncome = Number.isFinite(amountNum) && amountNum > 0;

  const employeeRatePct = ksCustom
    ? Number(ksRate) || 0
    : Number(ksRate) || KIWISAVER_ACCOUNT_DEFAULT_EMPLOYEE_RATE;

  const effectiveFrequency: PayFrequency =
    payType === 'hourly' ? 'hour' : frequency === 'hour' ? 'year' : frequency;

  // Everything the PAYE engine needs except the pay amount; shared with piece rate.
  const payeOptions = useMemo<PieceRatePayeOptions>(
    () => ({
      employment,
      secondaryTotalAnnualIncome: Number(secondaryTotal) || 0,
      otherAnnualGross: Number(otherAnnual) || 0,
      kiwiSaverOptIn,
      kiwiSaverEmployeeRatePct: employeeRatePct,
      kiwiSaverEmployerRatePct: Number(ksEmployerRate) || KIWISAVER_EMPLOYER_MIN_RATE,
      salarySacrifice: kiwiSaverOptIn && salarySacrifice,
      studentLoan,
      ietc,
      payrollGivingAnnual: payrollGivingOn ? Number(payrollGivingAnnual) || 0 : 0,
      charityDonationsAnnual: charityDonationsOn ? Number(charityDonationsAnnual) || 0 : 0,
      extraCredits: draftsToExtraCredits(extraCreditDrafts),
    }),
    [
      employment,
      secondaryTotal,
      otherAnnual,
      kiwiSaverOptIn,
      employeeRatePct,
      ksEmployerRate,
      salarySacrifice,
      studentLoan,
      ietc,
      payrollGivingOn,
      payrollGivingAnnual,
      charityDonationsOn,
      charityDonationsAnnual,
      extraCreditDrafts,
    ],
  );

  const result = useMemo(() => {
    if (!hasIncome || outputType) return null;
    return calculatePaye({
      ...payeOptions,
      amount: amountNum,
      frequency: effectiveFrequency,
      hoursPerWeek: hours,
    });
  }, [hasIncome, outputType, amountNum, effectiveFrequency, hours, payeOptions]);

  const periods = result ? periodiseBreakdown(result, hours) : null;

  return (
    <div className="stack paye-page">
      <section className="panel">
        <div className="panel-heading">
          <h2 className="page-title">PAYE</h2>
          <span className="muted small">{PAYE_TAX_YEAR_LABEL}</span>
        </div>
        <p className="page-lead">
          Estimate NZ take-home pay from gross — income tax, ACC, KiwiSaver, student loan, IETC,
          payroll giving, charity donation tax credits (IR526), and investing credits (imputation /
          RWT / PIE / foreign). Applied credits are restored on load; only real savings-interest or
          dividend income/transactions can auto-fill investing credits (no $0 placeholders). Rates from IRD
          for the current tax year (never invented). Feature set inspired by{' '}
          <a href="https://www.paye.net.nz/calculator/" target="_blank" rel="noreferrer">
            paye.net.nz
          </a>
          ; UI matches this app. Annual progressive model — IRD weekly tables can differ slightly.
          Paid by output? Choose piece rate, contract (schedular) or share of catch.
        </p>

        <div className="form-grid">
          <label>
            Pay type
            <select
              value={payType}
              onChange={(e) => {
                const next = e.target.value as PayePayType;
                setPayType(next);
                if (next === 'salary' && frequency === 'hour') setFrequency('year');
              }}
            >
              {PAY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {outputType == null && (
          <label>
            {payType === 'hourly' ? 'Hourly rate' : 'Gross income'}
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={payType === 'hourly' ? 'e.g. 32' : 'e.g. 75000'}
            />
          </label>
          )}
          {payType === 'salary' && (
          <label>
            Frequency
            <select
              value={effectiveFrequency}
              onChange={(e) => setFrequency(e.target.value as PayFrequency)}
            >
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          )}
          {outputType == null && (
          <label>
            Hours / week
            <input
              type="number"
              min={1}
              max={168}
              step={0.5}
              value={hoursPerWeek}
              onChange={(e) => setHoursPerWeek(e.target.value)}
            />
          </label>
          )}
          {showPayeSections && (
          <label>
            Employment
            <select
              value={employment}
              onChange={(e) => setEmployment(e.target.value as EmploymentKind)}
            >
              <option value="primary">Primary (main job)</option>
              <option value="secondary">Secondary</option>
            </select>
          </label>
          )}
        </div>

        {outputType && (
          <OutputPayInputs payType={outputType} prefs={outputPrefs} set={setOutput} rates={rates} />
        )}

        {showPayeSections && employment === 'secondary' && (
          <div className="form-grid" style={{ marginTop: '0.75rem' }}>
            <label className="span-2">
              Estimated annual income from <strong>all</strong> sources
              <input
                type="number"
                min={0}
                step="any"
                value={secondaryTotal}
                onChange={(e) => setSecondaryTotal(e.target.value)}
              />
              <span className="muted small">Picks secondary tax code SB / S / SH / ST / SA.</span>
            </label>
            <label className="span-2">
              Annual gross from other (primary) job(s)
              <input
                type="number"
                min={0}
                step="any"
                value={otherAnnual}
                onChange={(e) => setOtherAnnual(e.target.value)}
              />
              <span className="muted small">
                Used for ACC headroom (max liable earnings {money(ACC_MAX_EARNINGS)}).
              </span>
            </label>
          </div>
        )}
      </section>

      {showPayeSections && (
      <>
      <section className="panel">
        <h3>KiwiSaver</h3>
        <label className="field checkbox-field" style={{ marginTop: '0.5rem' }}>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={kiwiSaverOptIn}
              onChange={(e) => setKiwiSaverOptIn(e.target.checked)}
            />
            Opt in to KiwiSaver
          </label>
        </label>
        {kiwiSaverOptIn && (
          <div className="form-grid">
            <label className="span-2">
              Employee contribution
              <div className="row gap" style={{ marginTop: 0 }}>
                {KIWISAVER_EMPLOYEE_RATE_CHOICES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={
                      'btn small' + (!ksCustom && Number(ksRate) === r ? ' primary' : '')
                    }
                    onClick={() => {
                      setKsCustom(false);
                      setKsRate(String(r));
                    }}
                  >
                    {r}%
                  </button>
                ))}
                <button
                  type="button"
                  className={'btn small' + (ksCustom ? ' primary' : '')}
                  onClick={() => setKsCustom(true)}
                >
                  Custom
                </button>
              </div>
            </label>
            {ksCustom && (
              <label>
                Custom employee %
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={ksRate}
                  onChange={(e) => setKsRate(e.target.value)}
                />
              </label>
            )}
            <label>
              Employer rate %
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={ksEmployerRate}
                onChange={(e) => setKsEmployerRate(e.target.value)}
              />
              <span className="muted small">
                Statutory minimum {KIWISAVER_EMPLOYER_MIN_RATE}% from 1 Apr 2026 (not deducted from
                take-home unless salary sacrifice). Your employee rate is saved for this account.{' '}
                {KIWISAVER_ACCOUNT_DEFAULT_EMPLOYEE_RATE}% is the starting choice. The contribution
                is the gross pay you enter times that rate. Not advice.
              </span>
            </label>
            <label className="field checkbox-field span-2">
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={salarySacrifice}
                  onChange={(e) => setSalarySacrifice(e.target.checked)}
                />
                Salary sacrifice (package includes employer KiwiSaver)
              </label>
            </label>
          </div>
        )}
      </section>

      <section className="panel">
        <h3>Other deductions & credits</h3>
        <div className="form-grid">
          <label className="field checkbox-field">
            <label className="inline-check">
              <input
                type="checkbox"
                checked={studentLoan}
                onChange={(e) => setStudentLoan(e.target.checked)}
              />
              Student loan (SL)
            </label>
            <span className="muted small">
              {pct(STUDENT_LOAN_RATE)} over {money(STUDENT_LOAN_ANNUAL_THRESHOLD)}/yr (primary);
              flat {pct(STUDENT_LOAN_RATE)} on secondary.
            </span>
          </label>
          <label className="field checkbox-field">
            <label className="inline-check">
              <input
                type="checkbox"
                checked={ietc}
                onChange={(e) => setIetc(e.target.checked)}
                disabled={employment === 'secondary'}
              />
              Independent Earner Tax Credit (IETC)
            </label>
            <span className="muted small">
              Up to $520/yr when primary income is $24,000–$69,999 and you qualify. Uses ME / ME SL.
            </span>
          </label>
          <label className="field checkbox-field">
            <label className="inline-check">
              <input
                type="checkbox"
                checked={payrollGivingOn}
                onChange={(e) => setPayrollGivingOn(e.target.checked)}
              />
              Payroll giving
            </label>
          </label>
          {payrollGivingOn && (
            <label>
              Annual payroll donations
              <input
                type="number"
                min={0}
                step="any"
                value={payrollGivingAnnual}
                onChange={(e) => setPayrollGivingAnnual(e.target.value)}
              />
              <span className="muted small">
                Tax credit = {(DONATION_TAX_CREDIT_RATE * 100).toFixed(2)}¢ per $1 donated (capped at
                tax portion of PAYE). Deducted from take-home each pay.
              </span>
            </label>
          )}
          <label className="field checkbox-field">
            <label className="inline-check">
              <input
                type="checkbox"
                checked={charityDonationsOn}
                onChange={(e) => setCharityDonationsOn(e.target.checked)}
              />
              Charity donation tax credit (IR526)
            </label>
            <span className="muted small">
              Donations to approved donees <strong>outside</strong> payroll giving. Claim after
              year-end with receipts — do not double-count payroll giving.
            </span>
          </label>
          {charityDonationsOn && (
            <>
              <label>
                Annual charity donations (outside payroll)
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={charityDonationsAnnual}
                  onChange={(e) => setCharityDonationsAnnual(e.target.value)}
                />
                <span className="muted small">
                  Credit = min(1/3 of donations, 1/3 of taxable income). Does not re-deduct the gift
                  from salary take-home (already given).
                </span>
              </label>
              <CharityLinksFromBudget />
            </>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h3>Investing credits</h3>
          <button
            type="button"
            className="btn small primary"
            onClick={() =>
              setExtraCreditDrafts((prev) => [
                ...prev,
                {
                  id: newCreditId(),
                  kind: 'imputation',
                  label: '',
                  annualAmount: '0',
                },
              ])
            }
          >
            Add credit
          </button>
        </div>
        <p className="muted small" style={{ marginTop: '0.35rem' }}>
          IRD has <strong>no payday PAYE “investing credit”</strong> field. Imputation, RWT, PIE,
          and foreign tax credits from investments offset tax on your <em>annual assessment</em>{' '}
          (refund / less tax to pay). Enter annual NZD from statements or myIR — we do not invent
          amounts. Credits you apply are <strong>persisted</strong>; portfolio/income only
          auto-fills from savings interest or dividends only when a real income/transaction record
          explicitly names a credit kind with positive NZD (no $0 rows).
        </p>
        {extraCreditDrafts.length === 0 && (
          <p className="muted small" style={{ marginTop: '0.65rem' }}>
            No investing credits yet. Use <strong>Add credit</strong> for imputation, RWT, PIE,
            foreign tax, or other investing-related NZD — or record savings-interest/dividend credit
            NZD under Income with that wording so it can auto-fill.
          </p>
        )}
        {extraCreditDrafts.map((draft) => {
          const meta = INVESTING_CREDIT_KIND_OPTIONS.find((o) => o.kind === draft.kind);
          const resolved = result?.extraCredits.find((c) => c.id === draft.id);
          return (
            <div
              key={draft.id}
              className="form-grid"
              style={{
                marginTop: '0.85rem',
                paddingTop: '0.75rem',
                borderTop: '1px solid var(--border)',
              }}
            >
              <label>
                Credit type
                <select
                  value={draft.kind}
                  onChange={(e) => {
                    const kind = e.target.value as InvestingCreditKind;
                    setExtraCreditDrafts((prev) =>
                      prev.map((row) =>
                        row.id === draft.id
                          ? {
                              ...row,
                              kind,
                              label: kind === 'other_investing' ? row.label : '',
                            }
                          : row,
                      ),
                    );
                  }}
                >
                  {INVESTING_CREDIT_KIND_OPTIONS.map((o) => (
                    <option key={o.kind} value={o.kind}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Annual credit (NZD)
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={draft.annualAmount}
                  onChange={(e) =>
                    setExtraCreditDrafts((prev) =>
                      prev.map((row) =>
                        row.id === draft.id
                          ? { ...row, annualAmount: e.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </label>
              {draft.kind === 'other_investing' && (
                <label className="span-2">
                  Label
                  <input
                    type="text"
                    value={draft.label}
                    placeholder="e.g. Māori authority credit / other"
                    onChange={(e) =>
                      setExtraCreditDrafts((prev) =>
                        prev.map((row) =>
                          row.id === draft.id ? { ...row, label: e.target.value } : row,
                        ),
                      )
                    }
                  />
                </label>
              )}
              <div className="span-2 row gap" style={{ marginTop: 0, justifyContent: 'space-between' }}>
                <span className="muted small">
                  {meta?.hint}
                  {resolved && resolved.credit > 0
                    ? ` · Applied ${money(resolved.credit)}/yr (assessment / year-end)`
                    : ''}
                </span>
                <button
                  type="button"
                  className="btn small danger"
                  onClick={() =>
                    setExtraCreditDrafts((prev) => prev.filter((row) => row.id !== draft.id))
                  }
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </section>

      </>
      )}

      {outputType == null && !hasIncome && (
        <section className="panel">
          <p className="muted" style={{ margin: 0 }}>
            Enter a gross income above to calculate take-home pay.
          </p>
        </section>
      )}

      {result && periods && (
        <>
          <section className="panel hero-card">
            <div className="panel-heading">
              <h2>Take-home pay</h2>
              <span className="muted small">Tax code · {result.taxCode}</span>
            </div>
            <div className="row gap" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '1.75rem' }}>{money(result.takeHome)}</strong>
              <span className="muted">/ year</span>
              <span className="muted small">
                · {money(periods.takeHome.week)}/wk · {money(periods.takeHome.month)}/mo
              </span>
            </div>
            <p className="muted small" style={{ marginTop: '0.65rem' }}>
              Annual gross {money(result.annualGross)}
              {result.annualPackage !== result.annualGross
                ? ` (package ${money(result.annualPackage)})`
                : ''}
              {' · '}Effective PAYE rate {pct(result.effectiveTaxRate)}
              {result.ietcApplied ? ` · IETC ${money(result.ietcCredit)}` : ''}
              {result.charityCredit > 0
                ? ` · Donation tax credit ${money(result.charityCredit)}`
                : ''}
              {result.extraCreditsTotal > 0
                ? ` · Investing credits ${money(result.extraCreditsTotal)}`
                : ''}
            </p>
            {result.extraCredits.length > 0 && result.extraCreditsTotal > 0 && (
              <ul className="muted small" style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem' }}>
                {result.extraCredits
                  .filter((c) => c.credit > 0)
                  .map((c) => (
                    <li key={c.id}>
                      {c.label}: {money(c.credit)}/yr
                      {' · assessment / year-end'}
                    </li>
                  ))}
              </ul>
            )}
            {result.notes.length > 0 && (
              <ul className="muted small" style={{ margin: '0.75rem 0 0', paddingLeft: '1.1rem' }}>
                {result.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h3>Breakdown</h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ marginTop: '0.75rem' }}>
                <thead>
                  <tr>
                    <th>Item</th>
                    {PERIOD_COLS.map((c) => (
                      <th key={c.key} style={{ textAlign: 'right' }}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {breakdownRows(result, periods, kiwiSaverOptIn).map((row) => (
                    <tr key={row.label}>
                      <td>
                        {row.label}
                        {row.deduct ? <span className="muted"> (−)</span> : null}
                      </td>
                      {PERIOD_COLS.map((c) => (
                        <td
                          key={c.key}
                          className={
                            row.label === 'Take-home pay'
                              ? 'money amt-in'
                              : row.deduct
                                ? 'money amt-out'
                                : 'money'
                          }
                          style={{ textAlign: 'right' }}
                        >
                          {money(row.amounts[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small" style={{ marginTop: '0.75rem' }}>
              Employer KiwiSaver is paid by the employer (shown for reference). Month ≠ 2 ×
              fortnight because year ÷ 12 vs year ÷ 26.
            </p>
          </section>
        </>
      )}

      {outputType && (
        <>
          <OutputPayResults payType={outputType} prefs={outputPrefs} payeOptions={payeOptions} rates={rates} />
          <SavedPaySources
            payType={outputType}
            prefs={outputPrefs}
            setPrefs={setOutputPrefs}
            payeOptions={payeOptions}
            rates={rates}
            onLoadPayType={setPayType}
          />
        </>
      )}

      <section className="panel">
        <div className="panel-heading">
          <h3>Rates in use</h3>
          <button
            type="button"
            className="btn small"
            onClick={() => setShowSources((s) => !s)}
          >
            {showSources ? 'Hide sources' : 'Show sources'}
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ marginTop: '0.5rem' }}>
            <thead>
              <tr>
                <th>Income (annual)</th>
                <th style={{ textAlign: 'right' }}>Tax rate</th>
              </tr>
            </thead>
            <tbody>
              {INCOME_TAX_BRACKETS.map((b, i) => {
                const prev = i === 0 ? 0 : INCOME_TAX_BRACKETS[i - 1].upTo;
                const label =
                  b.upTo === Number.POSITIVE_INFINITY
                    ? `Over $${prev.toLocaleString('en-NZ')}`
                    : `$${prev === 0 ? '0' : (prev + 1).toLocaleString('en-NZ')} – $${b.upTo.toLocaleString('en-NZ')}`;
                return (
                  <tr key={b.upTo}>
                    <td>{label}</td>
                    <td style={{ textAlign: 'right' }}>{(b.rate * 100).toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: '0.75rem' }}>
          ACC {(ACC_RATE * 100).toFixed(2)}% on liable earnings up to {money(ACC_MAX_EARNINGS)}{' '}
          (max levy {money(ACC_MAX_LEVY)}). KiwiSaver employee rate saved for this account{' '}
          (starting choice {KIWISAVER_ACCOUNT_DEFAULT_EMPLOYEE_RATE}%). Statutory rates from 1 April
          2026: {KIWISAVER_EMPLOYEE_RATES.map((r) => `${r}%`).join(', ')} (IRD minimum{' '}
          {KIWISAVER_DEFAULT_EMPLOYEE_RATE}%). Adult minimum wage {money(rates.minimumWageAdultHourly)}/h;
          holiday pay with wages {Math.round(rates.holidayPayPaygRate * 100)}%; schedular withholding from IRD&apos;s
          IR330C. Full notes in{' '}
          <code>docs/PAYE_RATES.md</code>.
        </p>
        {showSources && (
          <ul className="muted small" style={{ marginTop: '0.75rem', paddingLeft: '1.1rem' }}>
            {[...RATE_SOURCES, ...SCHEDULAR_SOURCES].map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
