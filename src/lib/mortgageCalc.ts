/**
 * Mortgage calculator (KAN-56). Pure maths on what the user types; nothing is read.
 *
 * A standard NZ table loan: the same repayment every period, interest charged each
 * period at the yearly rate ÷ periods a year, and the loan paid off at the end of
 * the term.
 *   i = rate / periods a year,  N = years × periods a year
 *   repayment = P × i / (1 − (1 + i)^−N)   (P / N when the rate is 0)
 * Banks round and adjust the final payment, so their figure can differ by cents.
 */

export const REPAYMENT_FREQ = { weekly: 52, fortnightly: 26, monthly: 12 } as const;
export type RepaymentFrequency = keyof typeof REPAYMENT_FREQ;

export const REPAYMENT_LABELS: Record<RepaymentFrequency, string> = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
};

export type MortgageInput = {
  principal: number;
  /** Yearly rate, %. */
  ratePct: number;
  years: number;
  frequency: RepaymentFrequency;
};

export type MortgageResult = {
  /** Each repayment, rounded to cents. */
  repayment: number;
  repayments: number;
  totalRepaid: number;
  totalInterest: number;
  /** The same repayments over a year. */
  perYear: number;
};

export const LIMITS = { maxPrincipal: 100_000_000, maxRatePct: 30, maxYears: 50 } as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Why the inputs can't be calculated yet, or null when they can. */
export function mortgageInputError(input: { principal: number; ratePct: number; years: number }): string | null {
  if (!(input.principal > 0)) return 'Enter the loan amount.';
  if (input.principal > LIMITS.maxPrincipal) return 'Enter a loan amount under $100 million.';
  if (!Number.isFinite(input.ratePct) || input.ratePct < 0 || input.ratePct > LIMITS.maxRatePct) return 'Enter an interest rate from 0% to 30%.';
  if (!Number.isInteger(input.years) || input.years < 1 || input.years > LIMITS.maxYears) return 'Enter a term of 1 to 50 whole years.';
  return null;
}

export function calculateMortgage(input: MortgageInput): MortgageResult | null {
  if (mortgageInputError(input)) return null;
  const perYearCount = REPAYMENT_FREQ[input.frequency];
  const n = input.years * perYearCount;
  const i = input.ratePct / 100 / perYearCount;
  const exact = i === 0 ? input.principal / n : (input.principal * i) / (1 - (1 + i) ** -n);
  const totalRepaid = exact * n;
  return {
    repayment: round2(exact),
    repayments: n,
    totalRepaid: round2(totalRepaid),
    totalInterest: round2(totalRepaid - input.principal),
    perYear: round2(exact * perYearCount),
  };
}

/** Yearly repayments as a share of yearly take-home pay, as a whole percent; null without both. */
export function shareOfTakeHome(perYear: number, takeHomeYear: number | null | undefined): number | null {
  if (takeHomeYear == null || !(takeHomeYear > 0) || !(perYear > 0)) return null;
  return Math.round((perYear / takeHomeYear) * 100);
}
