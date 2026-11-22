/**
 * Salary compare (KAN-23): the same PAYE settings run at several yearly salaries, side by side.
 * Every figure is calculatePaye for the chosen tax year; nothing else is estimated. The first
 * salary is the baseline: each other row shows what changes, and how much of each extra dollar
 * you keep (the effective marginal take-home rate).
 */
import { calculatePaye, type PayeInput } from './payeCalc';

export type SalaryCompareOptions = Omit<PayeInput, 'amount' | 'frequency' | 'hoursPerWeek'>;

export type SalaryCompareRow = {
  salary: number;
  incomeTax: number;
  acc: number;
  kiwiSaver: number;
  studentLoan: number;
  /** IETC, payroll giving and other credits that lower PAYE. */
  credits: number;
  takeHome: number;
  /** Total deductions ÷ salary, %. */
  deductionsPct: number;
  /** Null on the baseline row. */
  vsBaseline: { salary: number; takeHome: number; keepPerDollarPct: number | null } | null;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Yearly salaries from text boxes: blanks and non-positive values dropped, at most 4. */
export function parseSalaries(texts: readonly string[]): number[] {
  return texts
    .map((t) => Number(t.replace(/[$,\s]/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 4);
}

export function compareSalaries(salaries: readonly number[], options: SalaryCompareOptions): SalaryCompareRow[] {
  const rows: SalaryCompareRow[] = [];
  for (const salary of salaries) {
    const b = calculatePaye({ ...options, amount: salary, frequency: 'year', hoursPerWeek: 40 });
    const credits = b.ietcCredit + b.payrollGivingCredit + b.charityCredit + b.extraCreditsTotal;
    const deductions = b.incomeTax + b.acc + b.kiwiSaverEmployee + b.studentLoan - credits;
    const base = rows[0];
    rows.push({
      salary: r2(salary),
      incomeTax: r2(b.incomeTax),
      acc: r2(b.acc),
      kiwiSaver: r2(b.kiwiSaverEmployee),
      studentLoan: r2(b.studentLoan),
      credits: r2(credits),
      takeHome: r2(b.takeHome),
      deductionsPct: salary > 0 ? r2((deductions / salary) * 100) : 0,
      vsBaseline: base
        ? {
            salary: r2(salary - base.salary),
            takeHome: r2(b.takeHome - base.takeHome),
            keepPerDollarPct: salary !== base.salary ? r2(((b.takeHome - base.takeHome) / (salary - base.salary)) * 100) : null,
          }
        : null,
    });
  }
  return rows;
}
