/**
 * Scenario tool helper (KAN-32): a pay rise as extra take-home pay, with the PAYE rules.
 */
import { calculatePaye } from './payeCalc';
import { payTaxYearRates } from './payeRates';

/** Extra take-home a month from a pay rise, with the default PAYE settings (KiwiSaver at the default rate). */
export function extraTakeHomeMonthly(salary: number, raisePct: number, studentLoan = false): number {
  if (!(salary > 0) || !raisePct) return 0;
  const rates = payTaxYearRates();
  const opts = {
    employment: 'primary' as const,
    secondaryTotalAnnualIncome: 0,
    otherAnnualGross: 0,
    kiwiSaverOptIn: true,
    kiwiSaverEmployeeRatePct: rates.kiwiSaverDefaultEmployeeRate,
    kiwiSaverEmployerRatePct: rates.kiwiSaverEmployerMinRate,
    salarySacrifice: false,
    studentLoan,
    ietc: true,
    payrollGivingAnnual: 0,
    frequency: 'year' as const,
    hoursPerWeek: 40,
  };
  const before = calculatePaye({ ...opts, amount: salary }).takeHome;
  const after = calculatePaye({ ...opts, amount: salary * (1 + raisePct / 100) }).takeHome;
  return Math.round(((after - before) / 12) * 100) / 100;
}

