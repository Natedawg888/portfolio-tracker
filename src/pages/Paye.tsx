import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, formatNzd } from '../api/client';
import { InfoTip } from '../components/InfoTip';
import { isMoneyHidden } from '../lib/privacy';
import { beginPageRead, commitPageRead, readPageCache } from '../lib/pageDataCache';
import {
  buildTaxCode,
  calculatePaye,
  periodiseBreakdown,
  pickSecondaryCode,
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
import { calculatePieceRate, type OutputPayType, type PieceRatePayeOptions } from '../lib/outputPayCalc';
import { loadOutputPayPrefs, pieceUnitsPerWeek, saveOutputPayPrefs, type OutputPayPrefs } from '../lib/outputPayPrefs';
import {
  ACC_MAX_EARNINGS,
  ACC_MAX_LEVY,
  ACC_RATE,
  DONATION_TAX_CREDIT_RATE,
  IETC_ABATE_END,
  IETC_ABATE_RATE,
  IETC_FULL_ANNUAL,
  IETC_FULL_MAX_INCOME,
  IETC_MIN_INCOME,
  INCOME_TAX_BRACKETS,
  KIWISAVER_ACCOUNT_DEFAULT_EMPLOYEE_RATE,
  KIWISAVER_DEFAULT_EMPLOYEE_RATE,
  KIWISAVER_EMPLOYEE_RATE_CHOICES,
  KIWISAVER_EMPLOYEE_RATES,
  KIWISAVER_EMPLOYER_MIN_RATE,
  PAYE_DEFAULT_HOURS_PER_WEEK,
  PAYROLL_GIVING_CREDIT_RATE,
  INVESTING_CREDIT_KIND_OPTIONS,
  RATE_SOURCES,
  STUDENT_LOAN_ANNUAL_THRESHOLD,
  SCHEDULAR_SOURCES,
  STUDENT_LOAN_RATE,
  payTaxYearRates,
  type InvestingCreditKind,
  type PayTaxYearRates,
} from '../lib/payeRates';
import {
  INVESTING_CREDITS_TIP,
  KIWISAVER_CUSTOM_RATE_VALUE,
  PAYE_NET_NZ_CREDIT_LEAD,
  PAYE_NET_NZ_NAME,
  PAYE_NET_NZ_URL,
  SALARY_SACRIFICE_TIP,
  charityDonationTip,
  convertSalaryHourly,
  formatPayeTaxDay,
  ietcCreditTip,
  incomeBracketRows,
  kiwiSaverEmployeeRateOptions,
  kiwiSaverEmployerTip,
  kiwiSaverOptInTip,
  kiwiSaverRateSelection,
  payeIncludedCopy,
  payePageSubtitle,
  payeSourceLinks,
  payrollGivingTip,
  ratesInUseNote,
  salaryHourlySwitch,
  studentLoanTip,
} from '../lib/payeView';

const PAY_TYPES: { value: PayePayType; label: string }[] = [
  { value: 'salary', label: 'Salary' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'piece', label: 'Piece rate' },
  { value: 'schedular', label: 'Contract' },
  { value: 'share_of_catch', label: 'Share of catch' },
];

function isOutputPayType(t: PayePayType): t is OutputPayType {
  return t === 'piece' || t === 'schedular' || t === 'share_of_catch';
}

/** Salary period. Hourly pay has its own pay type, so "hour" is not a choice here. */
const SALARY_PERIODS: { value: PayFrequency; label: string }[] = [
  { value: 'year', label: 'Year' },
  { value: 'month', label: 'Month' },
  { value: 'fortnight', label: 'Fortnight' },
  { value: 'week', label: 'Week' },
];

const EMPLOYMENT_OPTIONS: { value: EmploymentKind; label: string }[] = [
  { value: 'primary', label: 'Main job' },
  { value: 'secondary', label: 'Second job' },
];

function PayeChoiceRow<T extends string>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
  aside,
}: {
  label: string;
  ariaLabel?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  aside?: ReactNode;
}) {
  return (
    <fieldset className="paye-choice">
      <legend className="paye-choice-legend">
        {label}
        {aside}
      </legend>
      <div className="paye-choice-row" role="radiogroup" aria-label={ariaLabel ?? label}>
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              className={'paye-choice-btn' + (active ? ' active' : '')}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function PayeToggle({
  label,
  pressed,
  onChange,
  disabled,
  controls,
  note,
  tipLabel,
  tip,
}: {
  label: string;
  pressed: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  controls?: string;
  note?: string;
  tipLabel: string;
  tip: ReactNode;
}) {
  return (
    <div className="paye-toggle">
      <button
        type="button"
        className={'paye-toggle-btn' + (pressed ? ' active' : '')}
        aria-pressed={pressed}
        aria-expanded={controls ? pressed : undefined}
        aria-controls={controls}
        disabled={disabled}
        onClick={() => onChange(!pressed)}
      >
        <span className="paye-toggle-label">{label}</span>
        <span className="paye-toggle-state" aria-hidden="true">
          {pressed ? 'On' : 'Off'}
        </span>
      </button>
      <InfoTip label={tipLabel}>{tip}</InfoTip>
      {note ? <span className="paye-toggle-note">{note}</span> : null}
    </div>
  );
}

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

/** Whole dollars stay whole. Hidden amounts use the same mask as the rest of the page. */
function bandMoney(n: number): string {
  if (isMoneyHidden()) return formatNzd(n);
  const digits = Number.isInteger(n) ? 0 : 2;
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency: 'NZD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
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

function WhatsIncluded({ open, rates }: { open: boolean; rates: PayTaxYearRates }) {
  const brackets = incomeBracketRows(INCOME_TAX_BRACKETS);
  const sources = payeSourceLinks(RATE_SOURCES, SCHEDULAR_SOURCES);
  return (
    <div id="paye-included" className="paye-included" hidden={!open}>
      <p>{payeIncludedCopy()}</p>
      <p>
        {PAYE_NET_NZ_CREDIT_LEAD}{' '}
        <a href={PAYE_NET_NZ_URL} target="_blank" rel="noreferrer">
          {PAYE_NET_NZ_NAME}
        </a>
        .
      </p>
      <div>
        <h3>
          Income tax
          <InfoTip label="About these income tax rates">
            Marginal rates on annual income for this tax year. ACC earners’ levy is charged separately, below.
          </InfoTip>
        </h3>
        <div className="paye-bracket-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Income (annual)</th>
                <th style={{ textAlign: 'right' }}>Tax rate</th>
              </tr>
            </thead>
            <tbody>
              {brackets.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td style={{ textAlign: 'right' }}>{row.rate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p>
        {ratesInUseNote(
          {
            accRate: ACC_RATE,
            accMaxEarnings: ACC_MAX_EARNINGS,
            accMaxLevy: ACC_MAX_LEVY,
            accountDefaultEmployeeRate: KIWISAVER_ACCOUNT_DEFAULT_EMPLOYEE_RATE,
            statutoryEmployeeRates: KIWISAVER_EMPLOYEE_RATES,
            statutoryMinimumEmployeeRate: KIWISAVER_DEFAULT_EMPLOYEE_RATE,
            statutoryFrom: formatPayeTaxDay(rates.start),
            minimumWageAdultHourly: rates.minimumWageAdultHourly,
            holidayPayPaygRate: rates.holidayPayPaygRate,
          },
          money,
        )}{' '}
        Full notes in <code>docs/PAYE_RATES.md</code>.
      </p>
      <div>
        <h3>Sources</h3>
        <ul className="paye-sources muted small">
          {sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SalaryResult({
  result,
  periods,
}: {
  result: NonNullable<ReturnType<typeof calculatePaye>>;
  periods: ReturnType<typeof periodiseBreakdown>;
}) {
  return (
    <>
      <div className="panel-heading">
        <h2>Take-home pay</h2>
        <span className="muted small">Tax code · {result.taxCode}</span>
      </div>
      <p className="paye-result-figure">
        <span className="hero-value">{money(result.takeHome)}</span>
        <span className="muted">/ year</span>
      </p>
      <p className="muted small paye-result-meta">
        {money(periods.takeHome.week)}/wk · {money(periods.takeHome.month)}/mo
      </p>
      <p className="muted small paye-result-meta">
        Annual gross {money(result.annualGross)}
        {result.annualPackage !== result.annualGross
          ? ` (package ${money(result.annualPackage)})`
          : ''}
        {' · '}Effective PAYE rate {pct(result.effectiveTaxRate)}
        {result.ietcApplied ? ` · IETC ${money(result.ietcCredit)}` : ''}
        {result.charityCredit > 0 ? ` · Donation tax credit ${money(result.charityCredit)}` : ''}
        {result.extraCreditsTotal > 0 ? ` · Investing credits ${money(result.extraCreditsTotal)}` : ''}
      </p>
      {result.extraCredits.length > 0 && result.extraCreditsTotal > 0 && (
        <ul className="muted small paye-result-list">
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
        <ul className="muted small paye-result-list">
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </>
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
  // null until the user opens or closes the list. Credits that arrive before that show the list.
  const [investingPref, setInvestingPref] = useState<boolean | null>(null);
  const investingOpen = investingPref ?? extraCreditDrafts.length > 0;
  const [includedOpen, setIncludedOpen] = useState(false);

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

  const salaryPeriod: PayFrequency = frequency === 'hour' ? 'year' : frequency;

  const employmentTaxCode = useMemo(() => {
    if (payType === 'piece') {
      return calculatePieceRate(
        {
          ratePerUnit: Number(outputPrefs.pieceRate) || 0,
          unitsPerWeek: pieceUnitsPerWeek(outputPrefs),
          hoursPerWeek: Number(outputPrefs.pieceHours) || 0,
          holidayPayWithWages: outputPrefs.holidayPay,
        },
        payeOptions,
        rates,
      ).paye.taxCode;
    }
    if (result) return result.taxCode;
    return buildTaxCode({
      employment,
      studentLoan,
      ietcApplied: false,
      secondaryCode:
        employment === 'secondary' ? pickSecondaryCode(Number(secondaryTotal) || 0).code : null,
    });
  }, [payType, outputPrefs, payeOptions, rates, result, employment, studentLoan, secondaryTotal]);

  const ksRateOptions = [
    ...kiwiSaverEmployeeRateOptions(KIWISAVER_EMPLOYEE_RATE_CHOICES),
    { value: KIWISAVER_CUSTOM_RATE_VALUE, label: 'Custom' },
  ];
  const ksListed = kiwiSaverRateSelection(ksRate, KIWISAVER_EMPLOYEE_RATE_CHOICES);
  const ksRateValue = ksCustom ? KIWISAVER_CUSTOM_RATE_VALUE : ksListed.value;

  function selectEmployeeRate(next: string) {
    if (next === KIWISAVER_CUSTOM_RATE_VALUE) {
      setKsCustom(true);
      return;
    }
    setKsCustom(false);
    setKsRate(next);
  }

  function selectPayType(next: PayePayType) {
    if (next === payType) return;
    const fields = {
      amount,
      frequency: payType === 'hourly' ? ('hour' as const) : salaryPeriod,
      hoursPerWeek,
    };
    // Salary ↔ Hourly converts. Other switches do not copy this amount anywhere.
    const converted = salaryHourlySwitch(payType, next, fields);
    if (converted) {
      setAmount(converted.amount);
      setFrequency(converted.frequency);
    } else if (payType === 'hourly') {
      // Park the shared amount as an annual salary so a later Salary view
      // does not treat the hourly rate as yearly pay. Output prefs stay as saved.
      const parked = convertSalaryHourly('hourly', fields);
      setAmount(parked.amount);
      setFrequency(parked.frequency);
    } else if (next === 'hourly') {
      const parked = convertSalaryHourly('salary', fields);
      setAmount(parked.amount);
      setFrequency(parked.frequency);
    } else if (next === 'salary' && frequency === 'hour') {
      setFrequency('year');
    }
    setPayType(next);
  }

  return (
    <div className="stack paye-page">
      <header className="paye-intro">
        <h2 className="page-title">Take-home pay</h2>
        <p className="paye-subtitle">{payePageSubtitle(rates.start, rates.end)}</p>
        <button
          type="button"
          className="paye-included-toggle"
          aria-expanded={includedOpen}
          aria-controls="paye-included"
          onClick={() => setIncludedOpen((open) => !open)}
        >
          What&apos;s included <span aria-hidden="true">{includedOpen ? '▴' : '▾'}</span>
        </button>
        <WhatsIncluded open={includedOpen} rates={rates} />
      </header>

      <div className="paye-layout">
      <div className="paye-inputs">
      <section className="panel">
        <PayeChoiceRow
          label="Pay type"
          value={payType}
          options={PAY_TYPES}
          onChange={selectPayType}
        />

        {payType === 'salary' && (
          <div className="form-grid">
            <label>
              Gross income
              <input
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 75000"
              />
            </label>
            <div className="paye-period">
              <span className="paye-field-label" id="paye-period-label">
                Period
              </span>
              <div className="segmented" role="group" aria-labelledby="paye-period-label">
                {SALARY_PERIODS.map((period) => (
                  <button
                    key={period.value}
                    type="button"
                    className={'segmented-btn' + (salaryPeriod === period.value ? ' active' : '')}
                    aria-pressed={salaryPeriod === period.value}
                    onClick={() => setFrequency(period.value)}
                  >
                    {period.label}
                  </button>
                ))}
              </div>
            </div>
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
          </div>
        )}

        {payType === 'hourly' && (
          <div className="form-grid">
            <label>
              Hourly rate
              <input
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 32"
              />
            </label>
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
          </div>
        )}

        {outputType && (
          <OutputPayInputs payType={outputType} prefs={outputPrefs} set={setOutput} rates={rates} />
        )}

        {showPayeSections && (
          <PayeChoiceRow
            label="Employment"
            ariaLabel={`Employment, tax code ${employmentTaxCode}`}
            value={employment}
            options={EMPLOYMENT_OPTIONS}
            onChange={setEmployment}
            aside={<span className="paye-tax-code"> · tax code {employmentTaxCode}</span>}
          />
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
        <div className="paye-toggle-list">
          <PayeToggle
            label="KiwiSaver"
            pressed={kiwiSaverOptIn}
            onChange={setKiwiSaverOptIn}
            controls="paye-kiwisaver"
            tipLabel="About KiwiSaver"
            tip={kiwiSaverOptInTip(KIWISAVER_ACCOUNT_DEFAULT_EMPLOYEE_RATE)}
          />
        </div>
        <div id="paye-kiwisaver" className="paye-reveal" hidden={!kiwiSaverOptIn}>
          <PayeChoiceRow
            label="Your rate"
            ariaLabel="KiwiSaver employee rate"
            value={ksRateValue}
            options={ksRateOptions}
            onChange={selectEmployeeRate}
          />
          {ksRateValue === KIWISAVER_CUSTOM_RATE_VALUE && (
            <div className="form-grid">
              <label htmlFor="paye-ks-custom">
                Custom rate %
                <input
                  id="paye-ks-custom"
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={ksRate}
                  onChange={(e) => setKsRate(e.target.value)}
                />
              </label>
            </div>
          )}
          <div className="form-grid">
            <div className="paye-field">
              <span className="paye-field-label">
                <label htmlFor="paye-ks-employer">Employer %</label>
                <InfoTip label="About the employer KiwiSaver rate">
                  {kiwiSaverEmployerTip({
                    minimumRate: KIWISAVER_EMPLOYER_MIN_RATE,
                    statutoryFrom: formatPayeTaxDay(rates.start),
                  })}
                </InfoTip>
              </span>
              <input
                id="paye-ks-employer"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={ksEmployerRate}
                onChange={(e) => setKsEmployerRate(e.target.value)}
              />
            </div>
          </div>
          <div className="paye-toggle-list">
            <PayeToggle
              label="Salary sacrifice"
              pressed={salarySacrifice}
              onChange={setSalarySacrifice}
              tipLabel="About salary sacrifice"
              tip={SALARY_SACRIFICE_TIP}
            />
          </div>
        </div>
      </section>

      <section className="panel">
        <h3>Deductions</h3>
        <div className="paye-toggle-list">
          <PayeToggle
            label="Student loan"
            pressed={studentLoan}
            onChange={setStudentLoan}
            tipLabel="About the student loan deduction"
            tip={studentLoanTip(
              { rate: STUDENT_LOAN_RATE, annualThreshold: STUDENT_LOAN_ANNUAL_THRESHOLD },
              bandMoney,
            )}
          />
          <PayeToggle
            label="Payroll giving"
            pressed={payrollGivingOn}
            onChange={setPayrollGivingOn}
            controls="paye-payroll"
            tipLabel="About payroll giving"
            tip={payrollGivingTip(PAYROLL_GIVING_CREDIT_RATE)}
          />
        </div>
        <div id="paye-payroll" className="paye-reveal" hidden={!payrollGivingOn}>
          <div className="form-grid">
            <label htmlFor="paye-payroll-amount">
              Annual donations
              <input
                id="paye-payroll-amount"
                type="number"
                min={0}
                step="any"
                value={payrollGivingAnnual}
                onChange={(e) => setPayrollGivingAnnual(e.target.value)}
              />
            </label>
          </div>
        </div>
      </section>

      <section className="panel">
        <h3>Tax credits</h3>
        <div className="paye-toggle-list">
          <PayeToggle
            label="IETC"
            pressed={ietc}
            onChange={setIetc}
            disabled={employment === 'secondary'}
            note={employment === 'secondary' ? 'Main job only' : undefined}
            tipLabel="About the independent earner tax credit"
            tip={ietcCreditTip(
              {
                minIncome: IETC_MIN_INCOME,
                fullMaxIncome: IETC_FULL_MAX_INCOME,
                abateEnd: IETC_ABATE_END,
                fullAnnual: IETC_FULL_ANNUAL,
                abateRate: IETC_ABATE_RATE,
              },
              bandMoney,
            )}
          />
          <PayeToggle
            label="Charity donations"
            pressed={charityDonationsOn}
            onChange={setCharityDonationsOn}
            controls="paye-charity"
            tipLabel="About the charity donation tax credit"
            tip={charityDonationTip(DONATION_TAX_CREDIT_RATE)}
          />
        </div>
        <div id="paye-charity" className="paye-reveal" hidden={!charityDonationsOn}>
          <div className="form-grid">
            <label className="span-2" htmlFor="paye-charity-amount">
              Annual donations
              <input
                id="paye-charity-amount"
                type="number"
                min={0}
                step="any"
                value={charityDonationsAnnual}
                onChange={(e) => setCharityDonationsAnnual(e.target.value)}
              />
            </label>
            <CharityLinksFromBudget />
          </div>
        </div>

        <div className="paye-disclosure">
          <button
            type="button"
            className="paye-disclosure-btn"
            aria-expanded={investingOpen}
            aria-controls="paye-investing"
            onClick={() => setInvestingPref((open) => !(open ?? extraCreditDrafts.length > 0))}
          >
            Investing credits
            <span className="paye-toggle-state">
              {extraCreditDrafts.length === 0 ? 'None' : extraCreditDrafts.length}
            </span>
            <span aria-hidden="true">{investingOpen ? '▴' : '▾'}</span>
          </button>
          <InfoTip label="About investing credits">{INVESTING_CREDITS_TIP}</InfoTip>
          <button
            type="button"
            className="btn small primary"
            onClick={() => {
              setInvestingPref(true);
              setExtraCreditDrafts((prev) => [
                ...prev,
                {
                  id: newCreditId(),
                  kind: 'imputation',
                  label: '',
                  annualAmount: '0',
                },
              ]);
            }}
          >
            Add credit
          </button>
        </div>
        <div id="paye-investing" className="paye-reveal" hidden={!investingOpen}>
          {extraCreditDrafts.length === 0 && (
            <p className="muted small paye-reveal-empty">None yet.</p>
          )}
          {extraCreditDrafts.map((draft) => {
            const meta = INVESTING_CREDIT_KIND_OPTIONS.find((o) => o.kind === draft.kind);
            const resolved = result?.extraCredits.find((c) => c.id === draft.id);
            const kindId = `paye-credit-kind-${draft.id}`;
            const amountId = `paye-credit-amount-${draft.id}`;
            return (
              <div key={draft.id} className="form-grid paye-credit-row">
                <div className="paye-field">
                  <span className="paye-field-label">
                    <label htmlFor={kindId}>Credit type</label>
                    {meta ? <InfoTip label={`About ${meta.label}`}>{meta.hint}</InfoTip> : null}
                  </span>
                  <select
                    id={kindId}
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
                </div>
                <label htmlFor={amountId}>
                  Annual credit (NZD)
                  <input
                    id={amountId}
                    type="number"
                    min={0}
                    step="any"
                    value={draft.annualAmount}
                    onChange={(e) =>
                      setExtraCreditDrafts((prev) =>
                        prev.map((row) =>
                          row.id === draft.id ? { ...row, annualAmount: e.target.value } : row,
                        ),
                      )
                    }
                  />
                </label>
                {draft.kind === 'other_investing' && (
                  <label className="span-2" htmlFor={`paye-credit-label-${draft.id}`}>
                    Label
                    <input
                      id={`paye-credit-label-${draft.id}`}
                      type="text"
                      value={draft.label}
                      placeholder="e.g. Māori authority credit"
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
                <div className="span-2 paye-credit-actions">
                  <span className="muted small">
                    {resolved && resolved.credit > 0
                      ? `Applied ${money(resolved.credit)}/yr`
                      : 'Year-end'}
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
        </div>
      </section>

      </>
      )}
      </div>

      <aside
        className="paye-result panel hero-card"
        aria-live="polite"
        aria-atomic="true"
        aria-label="Take-home result"
      >
        {outputType ? (
          <OutputPayResults
            part="summary"
            payType={outputType}
            prefs={outputPrefs}
            payeOptions={payeOptions}
            rates={rates}
          />
        ) : result && periods ? (
          <SalaryResult result={result} periods={periods} />
        ) : (
          <p className="muted paye-result-empty">
            Enter a gross income above to calculate take-home pay.
          </p>
        )}
      </aside>
      </div>

      {result && periods && (
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
      )}

      {outputType && (
        <>
          <OutputPayResults
            part="breakdown"
            payType={outputType}
            prefs={outputPrefs}
            payeOptions={payeOptions}
            rates={rates}
          />
          <SavedPaySources
            payType={outputType}
            prefs={outputPrefs}
            setPrefs={setOutputPrefs}
            payeOptions={payeOptions}
            rates={rates}
            onLoadPayType={selectPayType}
          />
        </>
      )}
    </div>
  );
}
