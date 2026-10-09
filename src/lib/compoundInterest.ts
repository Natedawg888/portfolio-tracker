/**
 * Compound interest calculator (KAN-57). Pure maths on what the user types; no data is read.
 *
 * Interest compounds n times a year at r (nominal yearly rate). Contributions are paid p times
 * a year, at the start or end of each contribution period. When n ≠ p, interest is credited
 * between payments at the equivalent rate per contribution period, so the result matches the
 * nominal compounding exactly:
 *   rate per contribution period  i = (1 + r/n)^(n/p) − 1
 * The balance is stepped one contribution period at a time; contributions can rise once a year.
 * Time that doesn't fill a whole contribution period still earns interest (no payment).
 *
 * Tax and fees, each contribution period, in this order:
 *   1. interest for the period. Tax on returns (PIR / RWT %) is taken each time interest is
 *      credited, i.e. interest compounds at rate × (1 − tax); the tax shown is the difference
 *      from the untaxed interest on the same balance. Losses aren't taxed.
 *   2. the management fee (% a year of the balance) ÷ periods a year
 *   3. the fixed fee ($ a month or a year) spread over the periods
 * The balance never goes below zero.
 */

/** NZ tax rates on returns, for the preset list. */
export const RETURN_TAX_PRESETS = [
  { label: 'No tax', pct: 0 },
  { label: 'PIE fund — PIR 10.5%', pct: 10.5 },
  { label: 'PIE fund — PIR 17.5%', pct: 17.5 },
  { label: 'PIE fund — PIR 28%', pct: 28 },
  { label: 'Interest — RWT 10.5%', pct: 10.5 },
  { label: 'Interest — RWT 17.5%', pct: 17.5 },
  { label: 'Interest — RWT 30%', pct: 30 },
  { label: 'Interest — RWT 33%', pct: 33 },
  { label: 'Interest — RWT 39%', pct: 39 },
] as const;

export const COMPOUNDING = { daily: 365, weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, yearly: 1 } as const;
export const CONTRIBUTION_FREQ = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, yearly: 1 } as const;

export type Compounding = keyof typeof COMPOUNDING;
export type ContributionFrequency = keyof typeof CONTRIBUTION_FREQ;

export const FREQ_LABELS: Record<Compounding, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

export type CompoundInput = {
  principal: number;
  /** Nominal yearly rate, % (may be negative). */
  ratePct: number;
  compounding: Compounding;
  contribution: number;
  contributionFrequency: ContributionFrequency;
  /** Pay at the start of each period (true) or the end (false). */
  contributeAtStart: boolean;
  /** Contributions go up this % at the start of each new year. */
  contributionIncreasePct: number;
  years: number;
  months: number;
  /** Tax on returns, % of the interest earned (0 = none). */
  taxPct?: number;
  /** Management fee, % of the balance a year. */
  feePctYear?: number;
  /** Fixed fee in dollars, charged every `fixedFeePer`. */
  fixedFee?: number;
  fixedFeePer?: 'month' | 'year';
};

export type CompoundYear = {
  /** Year number; the last row may be part of a year. */
  year: number;
  /** Months since the start. */
  months: number;
  balance: number;
  contributed: number;
  /** Interest after tax and fees, so far. */
  interest: number;
  tax: number;
  fees: number;
};

export type CompoundResult = {
  futureValue: number;
  /** Starting amount + every contribution. */
  totalContributed: number;
  /** Growth after tax and fees: futureValue − totalContributed. */
  totalInterest: number;
  /** Interest before tax and fees. */
  grossInterest: number;
  totalTax: number;
  totalFees: number;
  /** Effective yearly rate from the compounding: (1 + r/n)^n − 1. */
  effectiveAnnualRatePct: number;
  rows: CompoundYear[];
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function effectiveAnnualRate(ratePct: number, compounding: Compounding): number {
  const n = COMPOUNDING[compounding];
  return (1 + ratePct / 100 / n) ** n - 1;
}

export function calculateCompound(input: CompoundInput): CompoundResult {
  const r = input.ratePct / 100;
  const n = COMPOUNDING[input.compounding];
  const p = CONTRIBUTION_FREQ[input.contributionFrequency];
  const totalMonths = Math.max(0, Math.round(input.years * 12 + input.months));
  const totalYears = totalMonths / 12;
  const periodRate = (1 + r / n) ** (n / p) - 1;
  const periods = Math.floor(totalYears * p + 1e-9);
  const leftoverYears = totalYears - periods / p;
  const growth = 1 + input.contributionIncreasePct / 100;

  let balance = Math.max(0, input.principal);
  let contributed = balance;
  let gross = 0;
  let tax = 0;
  let fees = 0;
  const taxRate = Math.min(1, Math.max(0, (input.taxPct ?? 0) / 100));
  const feeRate = Math.max(0, (input.feePctYear ?? 0) / 100);
  const fixedPerYear = Math.max(0, input.fixedFee ?? 0) * (input.fixedFeePer === 'month' ? 12 : 1);
  const rNet = r > 0 ? r * (1 - taxRate) : r;
  const netPeriodRate = (1 + rNet / n) ** (n / p) - 1;
  /** Grow the balance for `years` of time (one period, or a part period), then take tax and fees. */
  const grow = (years: number, grossRate: number, netRate: number) => {
    const interest = balance * grossRate;
    const net = balance * netRate;
    gross += interest;
    tax += Math.max(0, interest - net);
    balance += net;
    const fee = Math.min(balance, balance * feeRate * years + fixedPerYear * years);
    fees += fee;
    balance -= fee;
  };
  const rows: CompoundYear[] = [];
  const pushRow = (monthsSoFar: number) => {
    rows.push({
      year: Math.ceil(monthsSoFar / 12),
      months: monthsSoFar,
      balance: round2(balance),
      contributed: round2(contributed),
      interest: round2(balance - contributed),
      tax: round2(tax),
      fees: round2(fees),
    });
  };

  for (let k = 1; k <= periods; k += 1) {
    const yearIndex = Math.floor((k - 1) / p); // 0 in year 1
    const pay = Math.max(0, input.contribution) * growth ** yearIndex;
    if (input.contributeAtStart) {
      balance += pay;
      contributed += pay;
    }
    grow(1 / p, periodRate, netPeriodRate);
    if (!input.contributeAtStart) {
      balance += pay;
      contributed += pay;
    }
    if (k % p === 0) pushRow((k / p) * 12);
  }
  // Part of a period left over: interest only.
  if (leftoverYears > 1e-9) grow(leftoverYears, (1 + r / n) ** (n * leftoverYears) - 1, (1 + rNet / n) ** (n * leftoverYears) - 1);
  if (totalMonths % 12 !== 0 || rows.length === 0) pushRow(totalMonths);

  return {
    futureValue: round2(balance),
    totalContributed: round2(contributed),
    totalInterest: round2(balance - contributed),
    grossInterest: round2(gross),
    totalTax: round2(tax),
    totalFees: round2(fees),
    effectiveAnnualRatePct: Math.round(effectiveAnnualRate(input.ratePct, input.compounding) * 1e6) / 1e4,
    rows,
  };
}
