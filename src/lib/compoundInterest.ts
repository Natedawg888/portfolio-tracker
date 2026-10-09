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
 */

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
};

export type CompoundYear = {
  /** Year number; the last row may be part of a year. */
  year: number;
  /** Months since the start. */
  months: number;
  balance: number;
  contributed: number;
  interest: number;
};

export type CompoundResult = {
  futureValue: number;
  /** Starting amount + every contribution. */
  totalContributed: number;
  totalInterest: number;
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
  const rows: CompoundYear[] = [];
  const pushRow = (monthsSoFar: number) => {
    rows.push({
      year: Math.ceil(monthsSoFar / 12),
      months: monthsSoFar,
      balance: round2(balance),
      contributed: round2(contributed),
      interest: round2(balance - contributed),
    });
  };

  for (let k = 1; k <= periods; k += 1) {
    const yearIndex = Math.floor((k - 1) / p); // 0 in year 1
    const pay = Math.max(0, input.contribution) * growth ** yearIndex;
    if (input.contributeAtStart) {
      balance += pay;
      contributed += pay;
    }
    balance *= 1 + periodRate;
    if (!input.contributeAtStart) {
      balance += pay;
      contributed += pay;
    }
    if (k % p === 0) pushRow((k / p) * 12);
  }
  // Part of a period left over: interest only.
  if (leftoverYears > 1e-9) balance *= (1 + r / n) ** (n * leftoverYears);
  if (totalMonths % 12 !== 0 || rows.length === 0) pushRow(totalMonths);

  return {
    futureValue: round2(balance),
    totalContributed: round2(contributed),
    totalInterest: round2(balance - contributed),
    effectiveAnnualRatePct: Math.round(effectiveAnnualRate(input.ratePct, input.compounding) * 1e6) / 1e4,
    rows,
  };
}
