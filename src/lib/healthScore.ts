/**
 * Financial health score (KAN-55). Educational, not financial advice.
 *
 * 0–100 from five checks on the user's own data (complete months before today):
 *   savings rate     (income − spending) ÷ income          full marks at 20%+     weight 25
 *   emergency fund   cash ÷ average monthly spending        full marks at 6 months weight 25
 *   debt             (personal + card debt) ÷ yearly income  full marks with none,  weight 20
 *                    no marks at 50% of a year's income (mortgages are not counted)
 *   investing        (Investments transfers + KiwiSaver) ÷ income   full at 10%+    weight 15
 *   consistency      months where income beat spending ÷ months with activity     weight 15
 * A check without enough data is left out and the weights of the rest are scaled up.
 * Fewer than three checks → no score, only what to record.
 */

export type HealthCheckKey = 'savingsRate' | 'emergencyFund' | 'debt' | 'investing' | 'consistency';

export const HEALTH_WEIGHTS: Record<HealthCheckKey, number> = {
  savingsRate: 25,
  emergencyFund: 25,
  debt: 20,
  investing: 15,
  consistency: 15,
};

export const HEALTH_LABELS: Record<HealthCheckKey, string> = {
  savingsRate: 'Savings rate',
  emergencyFund: 'Emergency fund',
  debt: 'Debt',
  investing: 'Investing',
  consistency: 'Spending under income',
};

export type HealthBand = 'strong' | 'good' | 'fair' | 'needs_attention';

export const HEALTH_BAND_LABELS: Record<HealthBand, string> = {
  strong: 'Strong',
  good: 'Good',
  fair: 'Fair',
  needs_attention: 'Needs attention',
};

export type HealthInput = {
  windowMonths: number;
  /** One entry per complete month, oldest first. */
  months: Array<{ incomeNzd: number; spendingNzd: number }>;
  /** Positive bank balances (cash on hand). */
  cashNzd: number;
  /** Personal debts (Debts page) outstanding. */
  personalDebtNzd: number;
  /** Credit card / loan account balances owed (positive number). */
  cardDebtNzd: number;
  /** Money moved to the Investments category over the window. */
  investedNzd: number;
  /** KiwiSaver contributions over the window. */
  kiwiSaverNzd: number;
};

export type HealthCheck = {
  key: HealthCheckKey;
  label: string;
  /** 0–100, or null when there isn't enough data. */
  score: number | null;
  weight: number;
  /** The figure behind the score, for display. */
  value: number | null;
  /** How `value` reads: percent, months, or ratio of yearly income. */
  unit: 'percent' | 'months' | 'share';
  explanation: string;
  /** One thing that would raise this check, when it isn't full. */
  tip: string | null;
};

export type HealthScore = {
  score: number | null;
  band: HealthBand | null;
  summary: string;
  checks: HealthCheck[];
  windowMonths: number;
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function pct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

function money(n: number): string {
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 0 }).format(n);
}

export function bandFor(score: number): HealthBand {
  if (score >= 80) return 'strong';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'needs_attention';
}

export function computeHealthScore(input: HealthInput): HealthScore {
  const months = input.months;
  const income = months.reduce((s, m) => s + Math.max(0, m.incomeNzd), 0);
  const spending = months.reduce((s, m) => s + Math.max(0, m.spendingNzd), 0);
  const active = months.filter((m) => m.incomeNzd !== 0 || m.spendingNzd !== 0);
  const w = input.windowMonths;
  const checks: HealthCheck[] = [];

  // Savings rate.
  if (income > 0) {
    const rate = (income - spending) / income;
    const score = Math.round(clamp01(rate / 0.2) * 100);
    checks.push({
      key: 'savingsRate', label: HEALTH_LABELS.savingsRate, score, weight: HEALTH_WEIGHTS.savingsRate, value: rate, unit: 'percent',
      explanation: rate >= 0
        ? `You kept ${pct(rate)} of your income over the last ${w} months.`
        : `You spent ${pct(-rate)} more than you earned over the last ${w} months.`,
      tip: score < 100 ? 'Keeping 20% of income gets full marks — a bill or subscription you no longer use is a quick start.' : null,
    });
  } else {
    checks.push({
      key: 'savingsRate', label: HEALTH_LABELS.savingsRate, score: null, weight: HEALTH_WEIGHTS.savingsRate, value: null, unit: 'percent',
      explanation: `No income is recorded in the last ${w} months.`, tip: 'Record income on Budget to score this.',
    });
  }

  // Emergency fund.
  const avgSpend = spending / w;
  if (avgSpend > 0) {
    const covered = Math.max(0, input.cashNzd) / avgSpend;
    const score = Math.round(clamp01(covered / 6) * 100);
    checks.push({
      key: 'emergencyFund', label: HEALTH_LABELS.emergencyFund, score, weight: HEALTH_WEIGHTS.emergencyFund, value: covered, unit: 'months',
      explanation: `Your cash (${money(input.cashNzd)}) would cover about ${Math.round(covered * 10) / 10} months of your usual spending (${money(avgSpend)} a month).`,
      tip: score < 100 ? 'Six months of spending in cash gets full marks; three months is a common first goal.' : null,
    });
  } else {
    checks.push({
      key: 'emergencyFund', label: HEALTH_LABELS.emergencyFund, score: null, weight: HEALTH_WEIGHTS.emergencyFund, value: null, unit: 'months',
      explanation: `No spending is recorded in the last ${w} months, so months of cover can't be worked out.`, tip: 'Record spending on Budget to score this.',
    });
  }

  // Debt (mortgages excluded).
  const debt = Math.max(0, input.personalDebtNzd) + Math.max(0, input.cardDebtNzd);
  const yearlyIncome = income > 0 ? (income / w) * 12 : 0;
  if (debt === 0) {
    checks.push({
      key: 'debt', label: HEALTH_LABELS.debt, score: 100, weight: HEALTH_WEIGHTS.debt, value: 0, unit: 'share',
      explanation: 'No personal or credit card debt is recorded. Mortgages are not counted here.', tip: null,
    });
  } else if (yearlyIncome > 0) {
    const share = debt / yearlyIncome;
    const score = Math.round((1 - clamp01(share / 0.5)) * 100);
    checks.push({
      key: 'debt', label: HEALTH_LABELS.debt, score, weight: HEALTH_WEIGHTS.debt, value: share, unit: 'share',
      explanation: `You owe ${money(debt)} in personal and card debt — ${pct(share)} of a year's income. Mortgages are not counted.`,
      tip: score < 100 ? 'Paying down the highest-interest debt first raises this fastest.' : null,
    });
  } else {
    checks.push({
      key: 'debt', label: HEALTH_LABELS.debt, score: null, weight: HEALTH_WEIGHTS.debt, value: null, unit: 'share',
      explanation: `You owe ${money(debt)}, but no income is recorded to compare it with.`, tip: 'Record income on Budget to score this.',
    });
  }

  // Investing.
  if (income > 0) {
    const invested = Math.max(0, input.investedNzd) + Math.max(0, input.kiwiSaverNzd);
    const share = invested / income;
    const score = Math.round(clamp01(share / 0.1) * 100);
    checks.push({
      key: 'investing', label: HEALTH_LABELS.investing, score, weight: HEALTH_WEIGHTS.investing, value: share, unit: 'percent',
      explanation: invested > 0
        ? `${money(invested)} went to investments and KiwiSaver over the last ${w} months — ${pct(share)} of income.`
        : `Nothing went to the Investments budget category or KiwiSaver in the last ${w} months.`,
      tip: score < 100 ? 'Putting 10% of income into investments or KiwiSaver gets full marks.' : null,
    });
  } else {
    checks.push({
      key: 'investing', label: HEALTH_LABELS.investing, score: null, weight: HEALTH_WEIGHTS.investing, value: null, unit: 'percent',
      explanation: `No income is recorded in the last ${w} months.`, tip: 'Record income on Budget to score this.',
    });
  }

  // Consistency.
  if (active.length > 0) {
    const good = active.filter((m) => m.incomeNzd > m.spendingNzd).length;
    const share = good / active.length;
    checks.push({
      key: 'consistency', label: HEALTH_LABELS.consistency, score: Math.round(share * 100), weight: HEALTH_WEIGHTS.consistency, value: share, unit: 'percent',
      explanation: `Income was more than spending in ${good} of ${active.length} month${active.length === 1 ? '' : 's'}.`,
      tip: share < 1 ? 'Every month with spending under income gets full marks.' : null,
    });
  } else {
    checks.push({
      key: 'consistency', label: HEALTH_LABELS.consistency, score: null, weight: HEALTH_WEIGHTS.consistency, value: null, unit: 'percent',
      explanation: `No income or spending is recorded in the last ${w} months.`, tip: 'Record income and spending on Budget to score this.',
    });
  }

  const scored = checks.filter((c) => c.score != null);
  if (scored.length < 3) {
    return {
      score: null,
      band: null,
      summary: `Not enough data for a score yet. Record income and spending on Budget for a few months (${scored.length} of 5 checks can be worked out).`,
      checks,
      windowMonths: w,
    };
  }
  const weightSum = scored.reduce((s, c) => s + c.weight, 0);
  const score = Math.round(scored.reduce((s, c) => s + (c.score as number) * c.weight, 0) / weightSum);
  const band = bandFor(score);
  const best = [...scored].sort((a, b) => (b.score as number) - (a.score as number))[0];
  const worst = [...scored].sort((a, b) => (a.score as number) - (b.score as number))[0];
  const summary =
    best.key === worst.key || (worst.score as number) >= 90
      ? 'Every check is in good shape.'
      : `Strongest: ${best.label.toLowerCase()}. Most room to improve: ${worst.label.toLowerCase()}.`;
  return { score, band, summary, checks, windowMonths: w };
}
