/**
 * PAYE page view copy. Formats tax-year dates and rate tables the page already
 * loads from payeRates.ts. Nothing here invents a rate or a dollar figure.
 *
 * Salary ↔ Hourly conversion uses annualise / toPeriods from the PAYE engine
 * and keeps full precision (no cent rounding).
 */
import { annualise, toPeriods, type PayFrequency } from './payeCalc';
import type { PayePayType } from './payePrefs';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * '2026-04-01' → '1 April 2026', the same day-month-year style as PAYE_TAX_YEAR_LABEL.
 * An unrecognised value is returned unchanged.
 */
export function formatPayeTaxDay(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return ymd;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return ymd;
  const day = Number(match[3]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return ymd;
  return `${day} ${month} ${match[1]}`;
}

/** One subtitle line. Start and end come from the tax-year record, not a hardcoded label. */
export function payePageSubtitle(startYmd: string, endYmd: string): string {
  return `NZ PAYE estimate · tax year ${formatPayeTaxDay(startYmd)} – ${formatPayeTaxDay(endYmd)} · IRD rates`;
}

/**
 * The "What's included" panel: what is calculated, annual model vs weekly tables,
 * and that investing credits count at year end. No dollar amounts.
 */
export const PAYE_INCLUDED_SENTENCES = [
  'Estimates take-home from gross: income tax, ACC, KiwiSaver, student loan, IETC, payroll giving, charity donation tax credits (IR526), and investing credits (imputation, RWT, PIE and foreign). Piece rate, contract (schedular) and share of catch use the same tax year.',
  'The estimate is an annual progressive model, so IRD weekly and fortnightly tables can differ slightly.',
  'Investing credits count at year end on your tax assessment, not as a payday PAYE deduction.',
] as const;

export function payeIncludedCopy(): string {
  return PAYE_INCLUDED_SENTENCES.join(' ');
}

/** Kept in the "What's included" panel. Feature set inspired by paye.net.nz. */
export const PAYE_NET_NZ_URL = 'https://www.paye.net.nz/calculator/';
export const PAYE_NET_NZ_NAME = 'paye.net.nz';
export const PAYE_NET_NZ_CREDIT_LEAD = 'Feature set inspired by';
export const PAYE_NET_NZ_CREDIT = `${PAYE_NET_NZ_CREDIT_LEAD} ${PAYE_NET_NZ_NAME}`;

export type TaxBracketLike = { upTo: number; rate: number };

export type IncomeBracketRow = { label: string; rate: string };

/** Bracket labels for the income-tax table. Bands and rates are the caller's. */
export function incomeBracketRows(brackets: readonly TaxBracketLike[]): IncomeBracketRow[] {
  return brackets.map((bracket, index) => {
    const prev = index === 0 ? 0 : brackets[index - 1].upTo;
    const label =
      bracket.upTo === Number.POSITIVE_INFINITY
        ? `Over $${prev.toLocaleString('en-NZ')}`
        : `$${prev === 0 ? '0' : (prev + 1).toLocaleString('en-NZ')} – $${bracket.upTo.toLocaleString('en-NZ')}`;
    return { label, rate: `${(bracket.rate * 100).toFixed(1)}%` };
  });
}

export type RateSourceLike = { label: string; url: string };

/** Rate sources, then schedular sources. Every link is kept, in that order. */
export function payeSourceLinks<A extends RateSourceLike, B extends RateSourceLike>(
  rateSources: readonly A[],
  schedularSources: readonly B[],
): Array<A | B> {
  return [...rateSources, ...schedularSources];
}

export type RatesInUseFigures = {
  accRate: number;
  accMaxEarnings: number;
  accMaxLevy: number;
  accountDefaultEmployeeRate: number;
  statutoryEmployeeRates: readonly number[];
  statutoryMinimumEmployeeRate: number;
  /** When the statutory KiwiSaver rates apply, formatted from the tax year. */
  statutoryFrom: string;
  minimumWageAdultHourly: number;
  holidayPayPaygRate: number;
};

/** The ACC / KiwiSaver / minimum-wage note. Figures are passed in; money() formats them. */
export function ratesInUseNote(figures: RatesInUseFigures, money: (n: number) => string): string {
  const accPct = (figures.accRate * 100).toFixed(2);
  const holidayPct = Math.round(figures.holidayPayPaygRate * 100);
  const choices = figures.statutoryEmployeeRates.map((rate) => `${rate}%`).join(', ');
  return (
    `ACC ${accPct}% on liable earnings up to ${money(figures.accMaxEarnings)} ` +
    `(max levy ${money(figures.accMaxLevy)}). KiwiSaver employee rate saved for this account ` +
    `(starting choice ${figures.accountDefaultEmployeeRate}%). Statutory rates from ${figures.statutoryFrom}: ` +
    `${choices} (IRD minimum ${figures.statutoryMinimumEmployeeRate}%). Adult minimum wage ` +
    `${money(figures.minimumWageAdultHourly)}/h; holiday pay with wages ${holidayPct}%; ` +
    `schedular withholding from IRD's IR330C.`
  );
}

export type SalaryHourlyInput = {
  amount: string;
  frequency: PayFrequency;
  hoursPerWeek: string;
};

export type SalaryHourlyState = {
  amount: string;
  frequency: PayFrequency;
};

/**
 * Salary → hourly is annual ÷ weeks ÷ hours. Hourly → salary is the annual
 * figure, shown per year. The amount string is the full JS number, not cents,
 * so 55000 at 40 hours converts to hourly and back to "55000".
 * Blank or non-numeric amounts stay blank. Hours fall through to annualise.
 */
export function convertSalaryHourly(
  from: 'salary' | 'hourly',
  fields: SalaryHourlyInput,
): SalaryHourlyState {
  const frequency: PayFrequency = from === 'salary' ? 'hour' : 'year';
  const raw = fields.amount.trim();
  const amount = Number(raw);
  if (!raw || !Number.isFinite(amount)) return { amount: '', frequency };
  const hours = Number(fields.hoursPerWeek);
  if (from === 'salary') {
    const period: PayFrequency = fields.frequency === 'hour' ? 'year' : fields.frequency;
    const annual = annualise(amount, period, hours);
    return { amount: String(toPeriods(annual, hours).hour), frequency };
  }
  return { amount: String(annualise(amount, 'hour', hours)), frequency };
}

/**
 * Convert the shared amount only when moving between Salary and Hourly.
 * Piece, contract, and share of catch do not read `amount` — those fields
 * stay on their own saved prefs.
 */
export function salaryHourlySwitch(
  from: PayePayType,
  to: PayePayType,
  fields: SalaryHourlyInput,
): SalaryHourlyState | null {
  if (from === 'salary' && to === 'hourly') return convertSalaryHourly('salary', fields);
  if (from === 'hourly' && to === 'salary') return convertSalaryHourly('hourly', fields);
  return null;
}

/** Activity name for the contract dropdown: the SCHEDULAR_ACTIVITIES label without the parenthetical detail. */
export function schedularActivityShortName(label: string): string {
  const withoutDetail = label.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const comma = withoutDetail.indexOf(',');
  if (comma >= 8) return withoutDetail.slice(0, comma).trim();
  return withoutDetail;
}

/** "Activity · rate %" using that activity's own rate. */
export function schedularActivityOptionLabel(activity: { label: string; rate: number }): string {
  const pct = Math.round(activity.rate * 1000) / 10;
  return `${schedularActivityShortName(activity.label)} · ${pct}%`;
}

/**
 * Cents per dollar from a fractional rate. 0.13 → "13c", 0.175 → "17.5c",
 * 1/3 → "33.33c". The rate is the caller's.
 */
export function centsPerDollar(rate: number): string {
  const cents = Math.round(rate * 10000) / 100;
  const text = Number.isInteger(cents) ? String(cents) : cents.toFixed(2).replace(/0$/, '');
  return `${text}c`;
}

export type KiwiSaverRateOption = { value: string; label: string };

/** One radio per employee rate passed in. No rate is added. */
export function kiwiSaverEmployeeRateOptions(rates: readonly number[]): KiwiSaverRateOption[] {
  return rates.map((rate) => ({ value: String(rate), label: `${rate}%` }));
}

/** Radiogroup value for a percent that is not one of the statutory choices. */
export const KIWISAVER_CUSTOM_RATE_VALUE = 'custom';

/**
 * Which employee-rate radio is selected from the amount string alone.
 * A number that equals one of the choices selects that choice. A blank or
 * any other percent selects custom. The page still forces custom when the
 * user has chosen it, even if the typed number matches a choice.
 */
export function kiwiSaverRateSelection(
  rate: string,
  choices: readonly number[],
): { value: string; custom: boolean } {
  const n = Number(rate);
  const match = choices.find((choice) => choice === n);
  if (rate.trim() !== '' && Number.isFinite(n) && match !== undefined) {
    return { value: String(match), custom: false };
  }
  return { value: KIWISAVER_CUSTOM_RATE_VALUE, custom: true };
}

export function kiwiSaverOptInTip(startingRate: number): string {
  return (
    `Employee contribution is gross pay times the rate you choose. ` +
    `${startingRate}% is the starting rate when this account has not saved one. ` +
    `The rate is saved for this account. Not advice.`
  );
}

export function kiwiSaverEmployerTip(figures: { minimumRate: number; statutoryFrom: string }): string {
  return (
    `Statutory minimum ${figures.minimumRate}% from ${figures.statutoryFrom}. ` +
    `The employer pays it, so it is not deducted from take-home unless salary sacrifice is on.`
  );
}

/** No dollar figure. Salary sacrifice is a package split, not a new rate. */
export const SALARY_SACRIFICE_TIP =
  'The amount you enter is the package, including employer KiwiSaver. Taxable gross is that package divided by (1 + the employer rate).';

export function studentLoanTip(
  figures: { rate: number; annualThreshold: number },
  money: (n: number) => string,
): string {
  const pct = Math.round(figures.rate * 1000) / 10;
  const label = `${pct}%`;
  return (
    `${label} of primary pay over ${money(figures.annualThreshold)} a year. ` +
    `On a second job, ${label} of all gross, with no threshold.`
  );
}

export function payrollGivingTip(creditRate: number): string {
  return (
    `Tax credit is ${centsPerDollar(creditRate)} per dollar donated, and cannot exceed the tax portion of PAYE. ` +
    `The donation comes off take-home each pay.`
  );
}

export type IetcTipFigures = {
  minIncome: number;
  fullMaxIncome: number;
  abateEnd: number;
  fullAnnual: number;
  abateRate: number;
};

/**
 * IETC wording. Full credit runs from the minimum to the full-credit cap.
 * It then abates until the end income, where the credit is nothing.
 * Figures and the money formatter are the caller's — this does not look up rates.
 */
export function ietcCreditTip(figures: IetcTipFigures, money: (n: number) => string): string {
  const fullFrom = money(figures.minIncome);
  const fullTo = money(figures.fullMaxIncome);
  const end = money(figures.abateEnd);
  return (
    `Independent earner tax credit. Full credit ${money(figures.fullAnnual)} a year from ${fullFrom} to ${fullTo}. ` +
    `Abates from ${fullTo} to ${end} at ${centsPerDollar(figures.abateRate)} per dollar above ${fullTo}. ` +
    `Nothing from ${end}. Main job only, tax code ME or ME SL.`
  );
}

export function charityDonationTip(creditRate: number): string {
  return (
    `Donations to approved donees outside payroll giving. ` +
    `Credit is ${centsPerDollar(creditRate)} per dollar, capped at the same share of taxable income. ` +
    `Claim after year end with receipts. The gift is not taken off salary again.`
  );
}

/**
 * Kept behind the investing-credits ⓘ. No dollar amount: credits are entered,
 * not calculated.
 */
export const INVESTING_CREDITS_TIP =
  'IRD has no payday PAYE investing-credit field. Imputation, RWT, PIE, and foreign tax credits offset tax on the annual assessment (a refund or less tax to pay). Enter annual NZD from statements or myIR. Amounts are not invented. Credits you apply are saved. Income auto-fills only when a savings-interest or dividend record names a credit kind and a positive amount.';
