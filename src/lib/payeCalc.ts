/**
 * NZ PAYE take-home calculator (annual progressive model).
 *
 * Uses rates from payeRates.ts only, for the tax year chosen (input.taxYear; default the current year). Splits income tax and ACC (like paye.net.nz
 * feature set). IRD official weekly tables combine PAYE+ACC and use pay-period
 * rounding, so results can differ by a few dollars from IRD’s calculator.
 */

import {
  INVESTING_CREDIT_KIND_OPTIONS,
  PAYE_DEFAULT_HOURS_PER_WEEK,
  PAYE_FORTNIGHTS_PER_YEAR,
  PAYE_MONTHS_PER_YEAR,
  PAYE_WEEKS_PER_YEAR,
  DONATION_TAX_CREDIT_RATE,
  PAYROLL_GIVING_CREDIT_RATE,
  payTaxYearRates,
  type InvestingCreditKind,
  type PayTaxYearRates,
} from './payeRates';

export type PayFrequency = 'hour' | 'week' | 'fortnight' | 'month' | 'year';

export type EmploymentKind = 'primary' | 'secondary';

/**
 * User-entered investing tax credit (beyond IETC / payroll giving).
 * IRD has no payday PAYE "investing credit" field — these are assessment credits.
 */
export type ExtraTaxCreditInput = {
  id: string;
  kind: InvestingCreditKind;
  /** Optional label override (esp. other_investing). */
  label?: string;
  /** Annual NZD credit from statements / assessment. */
  annualAmount?: number;
};

export type ExtraTaxCreditResult = {
  id: string;
  kind: InvestingCreditKind;
  label: string;
  /** Annual credit applied (NZD). */
  credit: number;
  /** Always year-end / assessment for investing credits. */
  timing: 'year_end';
};

export type PayeInput = {
  /** Tax year by start year (2026 = 1 Apr 2026 – 31 Mar 2027). Omitted: the current year. */
  taxYear?: number;
  amount: number;
  frequency: PayFrequency;
  hoursPerWeek: number;
  employment: EmploymentKind;
  /** For secondary: estimated annual income from ALL sources (to pick SB/S/SH/ST/SA). */
  secondaryTotalAnnualIncome: number;
  /** For secondary: annual gross of other (primary) jobs — used for ACC remaining cap. */
  otherAnnualGross: number;
  kiwiSaverOptIn: boolean;
  kiwiSaverEmployeeRatePct: number;
  kiwiSaverEmployerRatePct: number;
  salarySacrifice: boolean;
  studentLoan: boolean;
  /** Apply IETC when eligible (primary only). */
  ietc: boolean;
  /** Annual payroll-giving donation amount (0 = off). */
  payrollGivingAnnual: number;
  /**
   * Annual charity / donee donations outside payroll (IR526).
   * Credit = min(1/3 donations, 1/3 taxable income). Not deducted from take-home
   * (money already given); only the tax credit adjusts estimated PAYE / refund.
   */
  charityDonationsAnnual?: number;
  /** Investing credits beyond IETC (imputation / RWT / PIE / foreign / other). */
  extraCredits?: ExtraTaxCreditInput[];
};

export type PayeBreakdown = {
  /** Taxable annual gross after salary-sacrifice adjustment (if any). */
  annualGross: number;
  /** Package / entered annual equivalent before sacrifice. */
  annualPackage: number;
  incomeTax: number;
  acc: number;
  ietcCredit: number;
  /**
   * PAYE after IETC + payroll-giving + extra credits applied to the tax+ACC pot
   * (floored at 0). Extra credits beyond that pot still lift take-home (refund /
   * IRD instalments).
   */
  payeNetOfCredits: number;
  payrollGivingDonation: number;
  payrollGivingCredit: number;
  /** Annual charity donations entered (outside payroll). */
  charityDonations: number;
  /** IR526 donation tax credit (1/3 donations, capped at 1/3 taxable income). */
  charityCredit: number;
  /** Sum of resolved investing credits. */
  extraCreditsTotal: number;
  extraCredits: ExtraTaxCreditResult[];
  /** Part of extra credits that exceeded PAYE after built-in credits (refund / IRD pay). */
  extraCreditsSurplus: number;
  kiwiSaverEmployee: number;
  kiwiSaverEmployer: number;
  studentLoan: number;
  takeHome: number;
  effectiveTaxRate: number;
  taxCode: string;
  secondaryCode: string | null;
  ietcApplied: boolean;
  notes: string[];
};

export type PeriodAmounts = {
  hour: number;
  week: number;
  fortnight: number;
  month: number;
  year: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function annualise(
  amount: number,
  frequency: PayFrequency,
  hoursPerWeek: number,
): number {
  const h = hoursPerWeek > 0 ? hoursPerWeek : PAYE_DEFAULT_HOURS_PER_WEEK;
  switch (frequency) {
    case 'hour':
      return amount * h * PAYE_WEEKS_PER_YEAR;
    case 'week':
      return amount * PAYE_WEEKS_PER_YEAR;
    case 'fortnight':
      return amount * PAYE_FORTNIGHTS_PER_YEAR;
    case 'month':
      return amount * PAYE_MONTHS_PER_YEAR;
    case 'year':
      return amount;
  }
}

export function toPeriods(annual: number, hoursPerWeek: number): PeriodAmounts {
  const h = hoursPerWeek > 0 ? hoursPerWeek : PAYE_DEFAULT_HOURS_PER_WEEK;
  const week = annual / PAYE_WEEKS_PER_YEAR;
  return {
    year: annual,
    month: annual / PAYE_MONTHS_PER_YEAR,
    fortnight: annual / PAYE_FORTNIGHTS_PER_YEAR,
    week,
    hour: h > 0 ? week / h : 0,
  };
}

/** Progressive income tax on annual taxable income. */
export function calcIncomeTax(annualIncome: number, rates: PayTaxYearRates = payTaxYearRates()): number {
  if (!(annualIncome > 0)) return 0;
  let tax = 0;
  let prev = 0;
  for (const b of rates.incomeTaxBrackets) {
    const slice = Math.min(annualIncome, b.upTo) - prev;
    if (slice > 0) tax += slice * b.rate;
    if (annualIncome <= b.upTo) break;
    prev = b.upTo;
  }
  return tax;
}

export function calcAcc(liableEarnings: number, rates: PayTaxYearRates = payTaxYearRates()): number {
  if (!(liableEarnings > 0)) return 0;
  if (liableEarnings >= rates.accMaxEarnings) return rates.accMaxLevy;
  return liableEarnings * rates.accRate;
}

export function calcIetc(annualIncome: number, rates: PayTaxYearRates = payTaxYearRates()): number {
  const i = rates.ietc;
  if (!i) return 0;
  if (annualIncome < i.minIncome || annualIncome >= i.abateEnd) return 0;
  if (annualIncome <= i.fullMaxIncome) return i.fullAnnual;
  return Math.max(0, i.fullAnnual - (annualIncome - i.fullMaxIncome) * i.abateRate);
}

export function pickSecondaryCode(totalAnnualIncome: number, rates: PayTaxYearRates = payTaxYearRates()): PayTaxYearRates['secondaryTaxCodes'][number] {
  const codes = rates.secondaryTaxCodes;
  for (const row of codes) {
    if (totalAnnualIncome <= row.upTo) return row;
  }
  return codes[codes.length - 1];
}

export function buildTaxCode(opts: {
  employment: EmploymentKind;
  studentLoan: boolean;
  ietcApplied: boolean;
  secondaryCode: string | null;
}): string {
  if (opts.employment === 'secondary') {
    const base = opts.secondaryCode ?? 'S';
    return opts.studentLoan ? `${base} SL` : base;
  }
  let code = opts.ietcApplied ? 'ME' : 'M';
  if (opts.studentLoan) code += ' SL';
  return code;
}


export function taxCreditKindLabel(kind: InvestingCreditKind): string {
  const row = INVESTING_CREDIT_KIND_OPTIONS.find((o) => o.kind === kind);
  return row?.label ?? kind;
}

export function resolveExtraCredit(row: ExtraTaxCreditInput): ExtraTaxCreditResult {
  const baseLabel = row.label?.trim() || taxCreditKindLabel(row.kind);
  const amount = Math.max(0, row.annualAmount ?? 0);
  return {
    id: row.id,
    kind: row.kind,
    label: baseLabel,
    credit: round2(amount),
    timing: 'year_end',
  };
}

export function calculatePaye(input: PayeInput): PayeBreakdown {
  const rates = payTaxYearRates(input.taxYear);
  const { accMaxEarnings, kiwiSaverEmployerMinRate, studentLoanRate, studentLoanAnnualThreshold } = rates;
  const ietcRates = rates.ietc;
  const notes: string[] = [...rates.yearNotes];
  const hours = input.hoursPerWeek > 0 ? input.hoursPerWeek : PAYE_DEFAULT_HOURS_PER_WEEK;
  const packageAnnual = Math.max(0, annualise(input.amount, input.frequency, hours));

  const employerRate =
    input.kiwiSaverOptIn && input.kiwiSaverEmployerRatePct > 0
      ? input.kiwiSaverEmployerRatePct / 100
      : 0;
  const employeeRate =
    input.kiwiSaverOptIn && input.kiwiSaverEmployeeRatePct > 0
      ? input.kiwiSaverEmployeeRatePct / 100
      : 0;

  let annualGross = packageAnnual;
  if (input.kiwiSaverOptIn && input.salarySacrifice && employerRate > 0 && packageAnnual > 0) {
    // Package includes employer KS → taxable gross reduced so employer % fits in package.
    annualGross = packageAnnual / (1 + employerRate);
    notes.push(
      'Salary sacrifice: taxable gross is package ÷ (1 + employer KiwiSaver rate).',
    );
  }

  let incomeTax = 0;
  let secondaryCode: string | null = null;

  if (input.employment === 'secondary') {
    const total =
      input.secondaryTotalAnnualIncome > 0
        ? input.secondaryTotalAnnualIncome
        : annualGross + Math.max(0, input.otherAnnualGross);
    const row = pickSecondaryCode(total, rates);
    secondaryCode = row.code;
    incomeTax = annualGross * row.rate;
    notes.push(
      `Secondary tax at ${row.code} (${(row.rate * 100).toFixed(1)}%) based on estimated total annual income $${Math.round(total).toLocaleString('en-NZ')}.`,
    );
  } else {
    incomeTax = calcIncomeTax(annualGross, rates);
  }

  // ACC: primary uses this job’s gross; secondary uses remaining headroom after other jobs.
  let accLiable = annualGross;
  if (input.employment === 'secondary') {
    const other = Math.max(0, input.otherAnnualGross);
    const remaining = Math.max(0, accMaxEarnings - other);
    accLiable = Math.min(annualGross, remaining);
    if (other >= accMaxEarnings) {
      notes.push('Other income already at ACC maximum — no further ACC on this secondary job.');
    }
  }
  const acc = calcAcc(accLiable, rates);

  const ietcEligible =
    input.employment === 'primary' &&
    input.ietc &&
    ietcRates != null &&
    annualGross >= ietcRates.minIncome &&
    annualGross < ietcRates.abateEnd;
  const ietcCredit = ietcEligible ? calcIetc(annualGross, rates) : 0;
  const ietcApplied = ietcCredit > 0;
  if (input.ietc && input.employment === 'primary') {
    if (!ietcRates) {
      notes.push(`IETC not applied — it is not loaded for ${rates.label}.`);
    } else if (!ietcApplied) {
      const abateCents = Math.round(ietcRates.abateRate * 10000) / 100;
      notes.push(
        `IETC not applied — full credit from $${ietcRates.minIncome.toLocaleString('en-NZ')} to $${ietcRates.fullMaxIncome.toLocaleString('en-NZ')}, ` +
          `then it abates to $${ietcRates.abateEnd.toLocaleString('en-NZ')} at ${abateCents}c per dollar above $${ietcRates.fullMaxIncome.toLocaleString('en-NZ')}.`,
      );
    }
  }
  if (input.ietc && input.employment === 'secondary') {
    notes.push('IETC applies via primary (ME) tax code only — ignored for secondary.');
  }

  const donation = Math.max(0, input.payrollGivingAnnual);
  // Credit cannot exceed the tax portion of PAYE (income tax − IETC), per IR617.
  const taxPortion = Math.max(0, incomeTax - ietcCredit);
  const payrollGivingCredit = Math.min(donation * PAYROLL_GIVING_CREDIT_RATE, taxPortion);

  // Charity / IR526 donation tax credit (outside payroll giving). Cap = lesser of
  // 1/3 donations and 1/3 taxable income. Do not double-claim payroll donations.
  const charityDonations = Math.max(0, input.charityDonationsAnnual ?? 0);
  const charityFromDonations = charityDonations * DONATION_TAX_CREDIT_RATE;
  const charityFromIncome = annualGross * DONATION_TAX_CREDIT_RATE;
  const charityCredit = Math.min(charityFromDonations, charityFromIncome);
  if (charityDonations > 0) {
    notes.push(
      'Donation tax credit (IR526) is for charity donations outside payroll giving — claim after year-end with receipts. Do not include payroll-giving amounts here.',
    );
  }

  const payeBeforeCharity = Math.max(0, incomeTax + acc - ietcCredit - payrollGivingCredit);
  const charityAppliedToPaye = Math.min(charityCredit, payeBeforeCharity);
  const charitySurplus = Math.max(0, charityCredit - charityAppliedToPaye);
  const payeAfterBuiltIn = Math.max(0, payeBeforeCharity - charityAppliedToPaye);

  const extraCredits = (input.extraCredits ?? []).map((row) => resolveExtraCredit(row));
  const extraCreditsTotal = extraCredits.reduce((s, c) => s + c.credit, 0);
  const extraAppliedToPaye = Math.min(extraCreditsTotal, payeAfterBuiltIn);
  const extraCreditsSurplus = Math.max(0, extraCreditsTotal - extraAppliedToPaye);
  const payeNetOfCredits = Math.max(0, payeAfterBuiltIn - extraAppliedToPaye);

  if (extraCreditsTotal > 0) {
    notes.push(
      'Investing credits (imputation / RWT / PIE / foreign) are not an IRD payday PAYE field — they offset tax on your annual assessment. Shown here to adjust estimated take-home / refund.',
    );
  }

  let studentLoan = 0;
  if (input.studentLoan) {
    if (input.employment === 'secondary') {
      studentLoan = annualGross * studentLoanRate;
      notes.push(`Secondary student loan: ${Math.round(studentLoanRate * 100)}% of all secondary gross (no threshold).`);
    } else {
      studentLoan = Math.max(0, annualGross - studentLoanAnnualThreshold) * studentLoanRate;
    }
  }

  const kiwiSaverEmployee = annualGross * employeeRate;
  const kiwiSaverEmployer =
    input.kiwiSaverOptIn
      ? annualGross * (employerRate > 0 ? employerRate : kiwiSaverEmployerMinRate / 100)
      : 0;
  if (input.kiwiSaverOptIn && employerRate <= 0) {
    notes.push(
      `Employer KiwiSaver shown at statutory minimum ${kiwiSaverEmployerMinRate}% (not deducted from take-home).`,
    );
  }

  // Charity + investing credit surplus (beyond PAYE) still increases annual take-home (refund).
  const takeHome =
    annualGross -
    payeNetOfCredits -
    kiwiSaverEmployee -
    studentLoan -
    donation +
    charitySurplus +
    extraCreditsSurplus;

  const effectiveTaxRate =
    annualGross > 0
      ? (incomeTax + acc - ietcCredit - payrollGivingCredit - charityCredit - extraCreditsTotal) /
        annualGross
      : 0;

  const taxCode = buildTaxCode({
    employment: input.employment,
    studentLoan: input.studentLoan,
    ietcApplied,
    secondaryCode,
  });

  return {
    annualGross: round2(annualGross),
    annualPackage: round2(packageAnnual),
    incomeTax: round2(incomeTax),
    acc: round2(acc),
    ietcCredit: round2(ietcCredit),
    payeNetOfCredits: round2(payeNetOfCredits),
    payrollGivingDonation: round2(donation),
    payrollGivingCredit: round2(payrollGivingCredit),
    charityDonations: round2(charityDonations),
    charityCredit: round2(charityCredit),
    extraCreditsTotal: round2(extraCreditsTotal),
    extraCredits,
    extraCreditsSurplus: round2(extraCreditsSurplus),
    kiwiSaverEmployee: round2(kiwiSaverEmployee),
    kiwiSaverEmployer: round2(kiwiSaverEmployer),
    studentLoan: round2(studentLoan),
    takeHome: round2(takeHome),
    effectiveTaxRate,
    taxCode,
    secondaryCode,
    ietcApplied,
    notes,
  };
}

export function periodiseBreakdown(
  b: PayeBreakdown,
  hoursPerWeek: number,
): {
  gross: PeriodAmounts;
  incomeTax: PeriodAmounts;
  acc: PeriodAmounts;
  paye: PeriodAmounts;
  ietc: PeriodAmounts;
  charityCredit: PeriodAmounts;
  extraCredits: PeriodAmounts;
  kiwiSaver: PeriodAmounts;
  employerKs: PeriodAmounts;
  studentLoan: PeriodAmounts;
  payrollGiving: PeriodAmounts;
  takeHome: PeriodAmounts;
} {
  return {
    gross: toPeriods(b.annualGross, hoursPerWeek),
    incomeTax: toPeriods(b.incomeTax, hoursPerWeek),
    acc: toPeriods(b.acc, hoursPerWeek),
    paye: toPeriods(b.payeNetOfCredits, hoursPerWeek),
    ietc: toPeriods(b.ietcCredit, hoursPerWeek),
    charityCredit: toPeriods(b.charityCredit, hoursPerWeek),
    extraCredits: toPeriods(b.extraCreditsTotal, hoursPerWeek),
    kiwiSaver: toPeriods(b.kiwiSaverEmployee, hoursPerWeek),
    employerKs: toPeriods(b.kiwiSaverEmployer, hoursPerWeek),
    studentLoan: toPeriods(b.studentLoan, hoursPerWeek),
    payrollGiving: toPeriods(b.payrollGivingDonation, hoursPerWeek),
    takeHome: toPeriods(b.takeHome, hoursPerWeek),
  };
}
