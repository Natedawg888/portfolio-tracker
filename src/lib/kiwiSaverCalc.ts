/**
 * KiwiSaver calculator (KAN-59). Illustrative only: the return is the user's assumption, not a
 * prediction, and today's rules (kiwiSaverRules.ts, payeRates.ts) are applied to every year.
 *
 * Year by year from the current age to 65, in the dollars of each year (nominal):
 *   - salary rises with inflation plus any growth above it;
 *   - you put in salary × your rate, plus any extra (extra keeps pace with inflation);
 *   - your employer puts in salary × their rate, less ESCT at the band for salary + employer
 *     contribution;
 *   - the government adds 25c per $1 you put in, up to $260.72, while you're 16–64 and earn
 *     $180,000 or less (those dollar amounts stay as they are, as the law has them);
 *   - each month the balance grows at the monthly rate of the yearly return, then that month's
 *     contributions go in; the government contribution goes in at the end of the year.
 * Results are also shown in today's dollars (divided by inflation over the years).
 */
import { GOVERNMENT_CONTRIBUTION, KIWISAVER_WITHDRAWAL_AGE, esctRate } from './kiwiSaverRules';

export type KiwiSaverCalcInput = {
  age: number;
  balance: number;
  salary: number;
  /** % a year above inflation. */
  salaryGrowthPct: number;
  employeeRatePct: number;
  employerRatePct: number;
  /** Extra you put in a year, today's dollars. */
  extraPerYear: number;
  /** Yearly return after fees and tax, %. */
  returnPct: number;
  inflationPct: number;
};

export type KiwiSaverYear = {
  age: number;
  /** End-of-year balance, that year's dollars. */
  balance: number;
  /** End-of-year balance, today's dollars. */
  balanceToday: number;
  you: number;
  employer: number;
  esct: number;
  government: number;
};

export type KiwiSaverCalcResult = {
  years: number;
  atWithdrawal: number;
  atWithdrawalToday: number;
  totals: { you: number; employer: number; esct: number; government: number; growth: number; startingBalance: number };
  firstYear: { you: number; employerGross: number; esct: number; esctRatePct: number; employer: number; government: number; governmentFull: boolean; governmentNote: string | null };
  rows: KiwiSaverYear[];
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function calculateKiwiSaver(input: KiwiSaverCalcInput): KiwiSaverCalcResult | null {
  const years = Math.max(0, Math.floor(KIWISAVER_WITHDRAWAL_AGE - input.age));
  if (years === 0) return null;
  const i = input.inflationPct / 100;
  const g = input.salaryGrowthPct / 100;
  const rm = (1 + input.returnPct / 100) ** (1 / 12) - 1;
  let balance = Math.max(0, input.balance);
  const totals = { you: 0, employer: 0, esct: 0, government: 0 };
  const rows: KiwiSaverYear[] = [];
  let firstYear: KiwiSaverCalcResult['firstYear'] | null = null;

  for (let y = 0; y < years; y++) {
    const age = input.age + y;
    const salary = Math.max(0, input.salary) * ((1 + i) * (1 + g)) ** y;
    const you = salary * (input.employeeRatePct / 100) + Math.max(0, input.extraPerYear) * (1 + i) ** y;
    const employerGross = salary * (input.employerRatePct / 100);
    const rate = employerGross > 0 ? esctRate(salary + employerGross) : 0;
    const esct = employerGross * rate;
    const employer = employerGross - esct;
    const eligible = age >= GOVERNMENT_CONTRIBUTION.minAge && age < GOVERNMENT_CONTRIBUTION.maxAge && salary <= GOVERNMENT_CONTRIBUTION.incomeLimit;
    const government = eligible ? Math.min(you * GOVERNMENT_CONTRIBUTION.perDollar, GOVERNMENT_CONTRIBUTION.maxPerYear) : 0;

    for (let m = 0; m < 12; m++) {
      balance = balance * (1 + rm) + (you + employer) / 12;
    }
    balance += government;
    totals.you += you;
    totals.employer += employer;
    totals.esct += esct;
    totals.government += government;
    rows.push({ age: age + 1, balance: r2(balance), balanceToday: r2(balance / (1 + i) ** (y + 1)), you: r2(you), employer: r2(employer), esct: r2(esct), government: r2(government) });
    if (y === 0) {
      const needed = GOVERNMENT_CONTRIBUTION.contributeForFull;
      firstYear = {
        you: r2(you),
        employerGross: r2(employerGross),
        esct: r2(esct),
        esctRatePct: r2(rate * 100),
        employer: r2(employer),
        government: r2(government),
        governmentFull: government >= GOVERNMENT_CONTRIBUTION.maxPerYear - 0.005,
        governmentNote: !eligible
          ? salary > GOVERNMENT_CONTRIBUTION.incomeLimit
            ? `No government contribution on income over $${GOVERNMENT_CONTRIBUTION.incomeLimit.toLocaleString('en-NZ')}.`
            : `The government contribution is for members aged ${GOVERNMENT_CONTRIBUTION.minAge} to ${GOVERNMENT_CONTRIBUTION.maxAge}.`
          : government < GOVERNMENT_CONTRIBUTION.maxPerYear - 0.005
            ? `Put in $${needed.toLocaleString('en-NZ', { minimumFractionDigits: 2 })} a year (1 July – 30 June) to get the full $${GOVERNMENT_CONTRIBUTION.maxPerYear}.`
            : null,
      };
    }
  }
  const contributed = totals.you + totals.employer + totals.government;
  return {
    years,
    atWithdrawal: r2(balance),
    atWithdrawalToday: r2(balance / (1 + i) ** years),
    totals: {
      you: r2(totals.you),
      employer: r2(totals.employer),
      esct: r2(totals.esct),
      government: r2(totals.government),
      growth: r2(balance - Math.max(0, input.balance) - contributed),
      startingBalance: r2(Math.max(0, input.balance)),
    },
    firstYear: firstYear!,
    rows,
  };
}
