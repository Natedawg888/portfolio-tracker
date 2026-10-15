/**
 * Retirement calculator (KAN-58). Pure maths on what the user types; no data is read.
 * Illustrative only: returns are assumptions, not predictions.
 *
 * Everything is in today's dollars. Returns are entered as nominal rates and turned into real
 * rates with inflation: real = (1 + nominal) / (1 + inflation) − 1. Contributions are in today's
 * dollars too, so they keep pace with inflation; the yearly increase is on top of inflation.
 *
 * Saving (current age → retirement age), month by month:
 *   balance grows at the monthly real pre-retirement return, then that month's contribution is
 *   added (contributions are spread evenly across the year and rise once a year).
 * Spending (retirement age → "plan until" age), month by month:
 *   the month's withdrawal (yearly income wanted − other yearly income, ÷ 12) comes out at the
 *   start of the month, then the rest grows at the monthly real retirement return. The money
 *   runs out when a withdrawal can't be paid in full.
 * Target:
 *   - "amount": a lump sum at retirement, as entered;
 *   - "income": the lump sum that pays the withdrawal every month until the "plan until" age,
 *     i.e. the present value of an annuity due at the retirement return.
 * Extra needed: the extra contribution per period that closes the gap, found by running the
 * saving phase with a contribution of 1 (the saving balance is linear in the contribution).
 */

export const CONTRIBUTION_PERIODS = { weekly: 52, fortnightly: 26, monthly: 12, yearly: 1 } as const;
export type ContributionPeriod = keyof typeof CONTRIBUTION_PERIODS;

export type RetirementInput = {
  currentAge: number;
  retirementAge: number;
  /** Age the money should last until. */
  planUntilAge: number;
  currentSavings: number;
  contribution: number;
  contributionPeriod: ContributionPeriod;
  /** Contributions rise this % a year above inflation (0 = they keep pace with inflation). */
  contributionIncreasePct: number;
  /** Yearly return before retirement, after fees and tax (nominal %). */
  returnBeforePct: number;
  /** Yearly return during retirement, after fees and tax (nominal %). */
  returnDuringPct: number;
  inflationPct: number;
  targetKind: 'amount' | 'income';
  /** Lump sum wanted at retirement, today's dollars (targetKind 'amount'). */
  targetAmount: number;
  /** Yearly income wanted in retirement, today's dollars (targetKind 'income'). */
  targetIncome: number;
  /** Yearly income from elsewhere in retirement (e.g. NZ Super), today's dollars. */
  otherIncome: number;
};

export type RetirementYear = { age: number; balance: number; contributed: number };

export type RetirementResult = {
  yearsToRetirement: number;
  /** Balance at retirement, today's dollars. */
  atRetirement: number;
  /** Balance at retirement in the dollars of that year (before inflation is taken out). */
  atRetirementNominal: number;
  /** Savings today plus every contribution, today's dollars. */
  totalContributed: number;
  /** Lump sum needed at retirement, today's dollars. */
  target: number;
  /** atRetirement − target; negative = short. */
  gap: number;
  onTrack: boolean;
  /** Extra per contribution period (today's dollars, rising like the contribution) to reach the target; 0 when on track. */
  extraNeeded: number;
  /** Yearly withdrawal used in the spending phase (income wanted − other income), today's dollars. */
  yearlyDraw: number;
  /** Age the money runs out, or null if it lasts to the "plan until" age. */
  runsOutAge: number | null;
  /** End-of-year balances from the current age to the "plan until" age, today's dollars. */
  rows: RetirementYear[];
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function realRate(nominalPct: number, inflationPct: number): number {
  return (1 + nominalPct / 100) / (1 + inflationPct / 100) - 1;
}

const monthly = (yearly: number) => (1 + yearly) ** (1 / 12) - 1;

/** Saving phase: balance at retirement (today's dollars) for a given contribution per period. */
function saveUp(input: RetirementInput, contribution: number, record?: (month: number, balance: number, contributed: number) => void) {
  const months = Math.max(0, Math.round((input.retirementAge - input.currentAge) * 12));
  const rm = monthly(realRate(input.returnBeforePct, input.inflationPct));
  const growth = 1 + input.contributionIncreasePct / 100;
  const perMonth = (contribution * CONTRIBUTION_PERIODS[input.contributionPeriod]) / 12;
  let balance = Math.max(0, input.currentSavings);
  let contributed = balance;
  for (let m = 1; m <= months; m += 1) {
    const pay = perMonth * growth ** Math.floor((m - 1) / 12);
    balance = balance * (1 + rm) + pay;
    contributed += pay;
    record?.(m, balance, contributed);
  }
  return { balance, contributed, months };
}

export function calculateRetirement(input: RetirementInput): RetirementResult {
  const spendMonths = Math.max(0, Math.round((input.planUntilAge - input.retirementAge) * 12));
  const rr = monthly(realRate(input.returnDuringPct, input.inflationPct));
  const yearlyDraw = Math.max(0, input.targetKind === 'income' ? input.targetIncome - input.otherIncome : 0);
  const draw = yearlyDraw / 12;

  const target =
    input.targetKind === 'amount'
      ? Math.max(0, input.targetAmount)
      : draw === 0 || spendMonths === 0
        ? 0
        : rr === 0
          ? draw * spendMonths
          : draw * ((1 - (1 + rr) ** -spendMonths) / rr) * (1 + rr);

  const rows: RetirementYear[] = [];
  const startAge = input.currentAge;
  const save = saveUp(input, Math.max(0, input.contribution), (m, balance, contributed) => {
    if (m % 12 === 0) rows.push({ age: startAge + m / 12, balance: round2(balance), contributed: round2(contributed) });
  });
  if (save.months % 12 !== 0) rows.push({ age: input.retirementAge, balance: round2(save.balance), contributed: round2(save.contributed) });

  // Spending phase (income target only; an amount target has no withdrawal to model).
  let balance = save.balance;
  let runsOutAge: number | null = null;
  for (let m = 1; m <= spendMonths; m += 1) {
    if (draw > 0) {
      if (balance < draw - 0.005) {
        runsOutAge = Math.round((input.retirementAge + (m - 1) / 12) * 10) / 10;
        balance = 0;
      } else {
        balance -= draw;
      }
    }
    balance *= 1 + rr;
    if (m % 12 === 0) rows.push({ age: input.retirementAge + m / 12, balance: round2(balance), contributed: round2(save.contributed) });
    if (runsOutAge != null) {
      // Show zero for the rest of the plan.
      for (let y = Math.floor(m / 12) + 1; y <= Math.floor(spendMonths / 12); y += 1) {
        rows.push({ age: input.retirementAge + y, balance: 0, contributed: round2(save.contributed) });
      }
      break;
    }
  }

  const gap = save.balance - target;
  const perUnit = saveUp({ ...input, currentSavings: 0 }, 1).balance;
  const extraNeeded = gap >= 0 || perUnit <= 0 ? 0 : -gap / perUnit;
  const years = save.months / 12;

  return {
    yearsToRetirement: Math.round(years * 10) / 10,
    atRetirement: round2(save.balance),
    atRetirementNominal: round2(save.balance * (1 + input.inflationPct / 100) ** years),
    totalContributed: round2(save.contributed),
    target: round2(target),
    gap: round2(gap),
    onTrack: gap >= 0,
    extraNeeded: Math.ceil(extraNeeded * 100) / 100,
    yearlyDraw: round2(yearlyDraw),
    runsOutAge,
    rows,
  };
}
