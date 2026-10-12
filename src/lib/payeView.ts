/**
 * PAYE page view copy. Formats tax-year dates and rate tables the page already
 * loads from payeRates.ts. Nothing here invents a rate or a dollar figure.
 */

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
