/**
 * Payslip check (KAN-78): what the PAYE calculator expects for one payslip's period and tax code,
 * compared with what the payslip shows. Rates come from payeRates.ts for the pay date, including a
 * mid-year change in force that day; a year without loaded rates isn't checked. Educational only: payroll uses IRD's period
 * tables, which round, so small differences are expected and allowed for.
 *
 * Checked: PAYE (income tax after IETC), ACC earners' levy (or PAYE including ACC, when the
 * payslip shows them together), KiwiSaver employee contribution, and student loan.
 * Tax code ND is 45% tax plus ACC on every dollar, with no ACC earnings cap (IR335).
 */
import { calcAcc, calcIetc, calcIncomeTax } from './payeCalc';
import { NON_DECLARATION_TAX_RATE, ratesForPayDate, taxYearForDate } from './payeRates';

export type PayslipFrequency = 'weekly' | 'fortnightly' | 'four_weekly' | 'monthly' | 'other';
export const PERIODS_PER_YEAR: Record<Exclude<PayslipFrequency, 'other'>, number> = { weekly: 52, fortnightly: 26, four_weekly: 13, monthly: 12 };
export const FREQUENCY_LABEL: Record<PayslipFrequency, string> = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  four_weekly: 'Four-weekly',
  monthly: 'Monthly',
  other: 'Other',
};

export type PayslipFigures = {
  payDate: string;
  frequency: PayslipFrequency;
  taxCode: string;
  grossNzd: number;
  payeNzd: number;
  /** null when the payslip includes ACC in PAYE. */
  accNzd: number | null;
  kiwiSaverEmployeeNzd: number;
  /** The member's KiwiSaver rate, when known. */
  kiwiSaverRatePct: number | null;
  studentLoanNzd: number;
};

export type CheckItem = { key: 'paye' | 'acc' | 'paye_acc' | 'kiwisaver' | 'student_loan'; label: string; actual: number; expected: number; difference: number; ok: boolean; note?: string };
export type PayslipCheck =
  | { status: 'checked'; allOk: boolean; taxYear: number; items: CheckItem[]; tolerance: string; notes: string[] }
  | { status: 'not_checked'; reason: string };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** $1, or 1% of the expected amount when that's bigger. */
export const tolerance = (expected: number) => Math.max(1, Math.abs(expected) * 0.01);

/** "M", "ME SL", "s", "SH SL", "ND" … → parts, or null for codes the check doesn't cover. */
export function parseTaxCode(raw: string): { base: 'M' | 'ME' | 'SB' | 'S' | 'SH' | 'ST' | 'SA' | 'ND'; studentLoan: boolean } | null {
  if (/^\s*ND\s*$/i.test(raw)) return { base: 'ND', studentLoan: false };
  const m = /^\s*(ME|M|SB|SH|ST|SA|S)\s*(SL)?\s*$/i.exec(raw);
  return m ? { base: m[1].toUpperCase() as 'M', studentLoan: !!m[2] } : null;
}

export function checkPayslip(p: PayslipFigures): PayslipCheck {
  if (p.frequency === 'other') return { status: 'not_checked', reason: 'Only weekly, fortnightly, four-weekly and monthly pay can be checked.' };
  const code = parseTaxCode(p.taxCode);
  if (!code) return { status: 'not_checked', reason: p.taxCode.trim() ? `Tax code ${p.taxCode.trim().toUpperCase()} isn’t covered by the check (M, ME, SB, S, SH, ST and SA, with or without SL, and ND are).` : 'Add the tax code to check this payslip.' };
  const taxYear = taxYearForDate(p.payDate);
  const rates = ratesForPayDate(p.payDate);
  if (!rates) return { status: 'not_checked', reason: 'PAYE rates for that tax year aren’t loaded.' };
  if (!(p.grossNzd > 0)) return { status: 'not_checked', reason: 'Add the gross pay to check this payslip.' };

  const ppy = PERIODS_PER_YEAR[p.frequency];
  const annual = p.grossNzd * ppy;
  const notes: string[] = [];
  let tax: number;
  if (code.base === 'M' || code.base === 'ME') {
    const ietc = code.base === 'ME' ? calcIetc(annual, rates) : 0;
    tax = Math.max(0, calcIncomeTax(annual, rates) - ietc) / ppy;
    if (code.base === 'ME' && ietc === 0) {
      notes.push(
        rates.ietc
          ? `Tax code ME gives the independent earner tax credit only on yearly pay of $${rates.ietc.minIncome.toLocaleString('en-NZ')}–$${rates.ietc.abateEnd.toLocaleString('en-NZ')}; at this pay it adds nothing.`
          : `The independent earner tax credit isn’t loaded for ${rates.label}, so none is included.`,
      );
    }
  } else if (code.base === 'ND') {
    tax = p.grossNzd * NON_DECLARATION_TAX_RATE;
    notes.push(`Tax code ND takes 45% tax plus the ACC earners’ levy (${r2(rates.accRate * 100)}%) on all pay, with no ACC earnings cap (IRD IR335 Employer’s guide).`);
  } else {
    const row = rates.secondaryTaxCodes.find((s) => s.code === code.base);
    tax = p.grossNzd * (row?.rate ?? 0);
  }
  // ND has no ACC earnings cap; payroll levies every dollar and IRD squares up at year end.
  const acc = code.base === 'ND' ? p.grossNzd * rates.accRate : calcAcc(annual, rates) / ppy;
  const items: CheckItem[] = [];
  const add = (key: CheckItem['key'], label: string, actual: number, expected: number, note?: string) => {
    const e = r2(expected);
    const d = r2(actual - e);
    items.push({ key, label, actual: r2(actual), expected: e, difference: d, ok: Math.abs(d) <= tolerance(e), ...(note ? { note } : {}) });
  };
  if (p.accNzd == null) add('paye_acc', 'PAYE (including ACC levy)', p.payeNzd, tax + acc);
  else {
    add('paye', 'PAYE', p.payeNzd, tax);
    add('acc', 'ACC earners’ levy', p.accNzd, acc);
  }

  // Student loan: per-period threshold on a main job; every dollar on a secondary code.
  const sl = code.studentLoan
    ? code.base === 'M' || code.base === 'ME'
      ? Math.max(0, p.grossNzd - rates.studentLoanAnnualThreshold / ppy) * rates.studentLoanRate
      : p.grossNzd * rates.studentLoanRate
    : 0;
  if (code.studentLoan || p.studentLoanNzd > 0) add('student_loan', 'Student loan', p.studentLoanNzd, sl, code.studentLoan ? undefined : 'The tax code has no SL, so no student loan deduction is expected.');

  // KiwiSaver: the given rate, or whichever standard rate it matches.
  if (p.kiwiSaverEmployeeNzd > 0 || p.kiwiSaverRatePct) {
    if (p.kiwiSaverRatePct) add('kiwisaver', `KiwiSaver (${p.kiwiSaverRatePct}%)`, p.kiwiSaverEmployeeNzd, (p.grossNzd * p.kiwiSaverRatePct) / 100);
    else {
      const match = rates.kiwiSaverEmployeeRates.find((r) => Math.abs(p.kiwiSaverEmployeeNzd - (p.grossNzd * r) / 100) <= tolerance((p.grossNzd * r) / 100));
      if (match) add('kiwisaver', `KiwiSaver (${match}%)`, p.kiwiSaverEmployeeNzd, (p.grossNzd * match) / 100);
      else {
        const nearest = [...rates.kiwiSaverEmployeeRates].sort((a, b) => Math.abs(p.kiwiSaverEmployeeNzd - (p.grossNzd * a) / 100) - Math.abs(p.kiwiSaverEmployeeNzd - (p.grossNzd * b) / 100))[0];
        add('kiwisaver', `KiwiSaver (nearest rate ${nearest}%)`, p.kiwiSaverEmployeeNzd, (p.grossNzd * nearest) / 100, `Doesn’t match any of the ${rates.label} rates (${rates.kiwiSaverEmployeeRates.join('%, ')}%).`);
      }
    }
  }
  notes.push('Payroll uses IRD’s period tables, which round, so a difference of up to $1 (or 1%) is treated as matching.');
  return { status: 'checked', allOk: items.every((i) => i.ok), taxYear, items, tolerance: 'up to $1 or 1%', notes };
}

/** Pay dates for one source, oldest first → gaps longer than about one and a half periods. */
export function missingPeriods(payDates: string[], frequency: PayslipFrequency): { after: string; before: string }[] {
  if (frequency === 'other') return [];
  const days = { weekly: 7, fortnightly: 14, four_weekly: 28, monthly: 30.4 }[frequency];
  const sorted = [...new Set(payDates)].sort();
  const gaps: { after: string; before: string }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = (Date.parse(`${sorted[i]}T00:00:00Z`) - Date.parse(`${sorted[i - 1]}T00:00:00Z`)) / 86_400_000;
    if (gap > days * 1.5) gaps.push({ after: sorted[i - 1], before: sorted[i] });
  }
  return gaps;
}
