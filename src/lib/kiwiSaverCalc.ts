/**
 * KiwiSaver calculator (KAN-59). Illustrative only: the return is the user's assumption, not a
 * prediction, and today's rules (kiwiSaverRules.ts, payeRates.ts) are applied to every year,
 * except the enacted step of the default rate and employer minimum to 4% from 1 April 2028 (KAN-89):
 * given the tax year the projection starts in, a member on the default rate moves to 4% from
 * 2028/29 unless they keep their rate fixed, and the employer's rate is lifted to the minimum.
 * A member who chose a higher rate (6/8/10%) keeps it; one on a temporary reduction keeps that.
 *
 * Year by year from the current age to 65, in the dollars of each year (nominal):
 *   - salary rises with inflation plus any growth above it;
 *   - you put in salary × your rate, plus any extra (extra keeps pace with inflation);
 *   - your employer puts in salary × their rate, less ESCT at the band for salary + employer
 *     contribution;
 *   - the government adds 25c per $1 you put in, up to $260.72, while you're 16–64 and your
 *     annual taxable income is $180,000 or less (those dollar amounts stay as they are, as the law
 *     has them). Taxable income is all of it, not just pay (KAN-99, IRD "Getting the KiwiSaver
 *     government contribution"): salary plus other taxable income, or the total you enter, which
 *     then moves with your pay. With neither, salary alone is used and the result says so;
 *   - each month the balance grows at the monthly rate of the yearly return, then that month's
 *     contributions go in; the government contribution goes in at the end of the year.
 * Results are also shown in today's dollars (divided by inflation over the years).
 */
import { GOVERNMENT_CONTRIBUTION, KIWISAVER_WITHDRAWAL_AGE, esctRate, kiwiSaverDefaultRatePct } from './kiwiSaverRules';

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
  /** Other taxable income a year (interest, dividends, rental profit, business), today's dollars; keeps pace with inflation. */
  otherIncomePerYear?: number;
  /** This year's total taxable income, if known (e.g. after losses); replaces salary + other income, then moves with pay. */
  taxableIncomeOverride?: number | null;
  /** Yearly return after fees and tax, %. */
  returnPct: number;
  inflationPct: number;
  /** Tax year (by start year) the first projected year falls in. Omitted: no scheduled rate changes. */
  startTaxYear?: number;
  /** Keep the employee rate as entered even if it's the default (opt out of the 2028 step-up). */
  keepRateFixed?: boolean;
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
  /** Rates used that year (they can step up from 2028/29). */
  employeeRatePct: number;
  employerRatePct: number;
};

export type KiwiSaverCalcResult = {
  years: number;
  atWithdrawal: number;
  atWithdrawalToday: number;
  totals: { you: number; employer: number; esct: number; government: number; growth: number; startingBalance: number };
  firstYear: {
    you: number;
    employerGross: number;
    esct: number;
    esctRatePct: number;
    employer: number;
    government: number;
    governmentFull: boolean;
    governmentNote: string | null;
    /** Taxable income tested against the $180,000 limit, and where it came from. */
    taxableIncome: number;
    incomeBasis: 'entered' | 'salary_and_other' | 'salary_only';
  };
  rows: KiwiSaverYear[];
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Employee and employer rates for projection year y (KAN-89). The member is on the default when
 * their rate is the default for the start year; then it follows the default each year unless
 * kept fixed. A rate below the default (temporary reduction) or above it stays as entered. The
 * employer contributes at least the minimum for the year, except while the member is below it.
 */
export function ratesForYear(input: Pick<KiwiSaverCalcInput, 'employeeRatePct' | 'employerRatePct' | 'startTaxYear' | 'keepRateFixed'>, y: number): { employeeRatePct: number; employerRatePct: number } {
  if (input.startTaxYear == null) return { employeeRatePct: input.employeeRatePct, employerRatePct: input.employerRatePct };
  const startDefault = kiwiSaverDefaultRatePct(input.startTaxYear);
  const yearDefault = kiwiSaverDefaultRatePct(input.startTaxYear + y);
  const onDefault = !input.keepRateFixed && input.employeeRatePct === startDefault;
  const employeeRatePct = onDefault ? Math.max(input.employeeRatePct, yearDefault) : input.employeeRatePct;
  const employerRatePct =
    input.employerRatePct > 0 && employeeRatePct >= yearDefault ? Math.max(input.employerRatePct, yearDefault) : input.employerRatePct;
  return { employeeRatePct, employerRatePct };
}

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
    const payFactor = ((1 + i) * (1 + g)) ** y;
    const salary = Math.max(0, input.salary) * payFactor;
    const override = input.taxableIncomeOverride;
    const income = override != null && Number.isFinite(override) ? Math.max(0, override) * payFactor : salary + Math.max(0, input.otherIncomePerYear ?? 0) * (1 + i) ** y;
    const { employeeRatePct, employerRatePct } = ratesForYear(input, y);
    const you = salary * (employeeRatePct / 100) + Math.max(0, input.extraPerYear) * (1 + i) ** y;
    const employerGross = salary * (employerRatePct / 100);
    const rate = employerGross > 0 ? esctRate(salary + employerGross) : 0;
    const esct = employerGross * rate;
    const employer = employerGross - esct;
    const eligible = age >= GOVERNMENT_CONTRIBUTION.minAge && age < GOVERNMENT_CONTRIBUTION.maxAge && income <= GOVERNMENT_CONTRIBUTION.incomeLimit;
    const government = eligible ? Math.min(you * GOVERNMENT_CONTRIBUTION.perDollar, GOVERNMENT_CONTRIBUTION.maxPerYear) : 0;

    for (let m = 0; m < 12; m++) {
      balance = balance * (1 + rm) + (you + employer) / 12;
    }
    balance += government;
    totals.you += you;
    totals.employer += employer;
    totals.esct += esct;
    totals.government += government;
    rows.push({ age: age + 1, balance: r2(balance), balanceToday: r2(balance / (1 + i) ** (y + 1)), you: r2(you), employer: r2(employer), esct: r2(esct), government: r2(government), employeeRatePct, employerRatePct });
    if (y === 0) {
      const needed = GOVERNMENT_CONTRIBUTION.contributeForFull;
      const incomeBasis = override != null && Number.isFinite(override) ? 'entered' : (input.otherIncomePerYear ?? 0) > 0 ? 'salary_and_other' : 'salary_only';
      firstYear = {
        you: r2(you),
        employerGross: r2(employerGross),
        esct: r2(esct),
        esctRatePct: r2(rate * 100),
        employer: r2(employer),
        government: r2(government),
        governmentFull: government >= GOVERNMENT_CONTRIBUTION.maxPerYear - 0.005,
        governmentNote: !eligible
          ? income > GOVERNMENT_CONTRIBUTION.incomeLimit
            ? `No government contribution: taxable income of $${Math.round(income).toLocaleString('en-NZ')} is over $${GOVERNMENT_CONTRIBUTION.incomeLimit.toLocaleString('en-NZ')}.`
            : `The government contribution is for members aged ${GOVERNMENT_CONTRIBUTION.minAge} to ${GOVERNMENT_CONTRIBUTION.maxAge}.`
          : government < GOVERNMENT_CONTRIBUTION.maxPerYear - 0.005
            ? `Put in $${needed.toLocaleString('en-NZ', { minimumFractionDigits: 2 })} a year (1 July – 30 June) to get the full $${GOVERNMENT_CONTRIBUTION.maxPerYear}.`
            : null,
        taxableIncome: r2(income),
        incomeBasis,
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
