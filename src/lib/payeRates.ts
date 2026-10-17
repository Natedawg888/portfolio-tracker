/**
 * NZ PAYE / ACC / KiwiSaver / student loan / IETC / payroll-giving rates.
 *
 * NEVER invent rates. All figures below are copied from IRD (or ACC via IRD)
 * sources listed in docs/PAYE_RATES.md. Update that doc when IRD publishes
 * new tax-year tables.
 *
 * Applied period for this build: pay dates 1 April 2026 – 31 March 2027
 * (current as of Oct 2026 / Pacific/Auckland).
 */

/** Tax year label shown in UI */
export const PAYE_TAX_YEAR_LABEL = '1 April 2026 – 31 March 2027';

export const PAYE_WEEKS_PER_YEAR = 52;
export const PAYE_FORTNIGHTS_PER_YEAR = 26;
export const PAYE_MONTHS_PER_YEAR = 12;
export const PAYE_DEFAULT_HOURS_PER_WEEK = 40;

/** Progressive income-tax brackets (income tax only — ACC is separate). */
export type TaxBracket = {
  /** Inclusive upper bound of this band; Infinity for top band */
  upTo: number;
  /** Marginal rate as a fraction (e.g. 0.105) */
  rate: number;
};

/**
 * Individual income-tax rates from 1 April 2025 (still current for 2026/27).
 * Source: https://www.ird.govt.nz/income-tax/income-tax-for-individuals/tax-codes-and-tax-rates-for-individuals/tax-rates-for-individuals
 */
export const INCOME_TAX_BRACKETS: readonly TaxBracket[] = [
  { upTo: 15_600, rate: 0.105 },
  { upTo: 53_500, rate: 0.175 },
  { upTo: 78_100, rate: 0.3 },
  { upTo: 180_000, rate: 0.33 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.39 },
] as const;

/**
 * Secondary tax codes & rates (before ACC).
 * Source: same IRD tax-rates-for-individuals page.
 */
export const SECONDARY_TAX_CODES = [
  { code: 'SB', upTo: 15_600, rate: 0.105 },
  { code: 'S', upTo: 53_500, rate: 0.175 },
  { code: 'SH', upTo: 78_100, rate: 0.3 },
  { code: 'ST', upTo: 180_000, rate: 0.33 },
  { code: 'SA', upTo: Number.POSITIVE_INFINITY, rate: 0.39 },
] as const;

/**
 * ACC earners' levy — 1 April 2026 to 31 March 2027.
 * Source: https://www.ird.govt.nz/income-tax/income-tax-for-individuals/acc-clients-and-carers/acc-earners-levy-rates
 */
export const ACC_RATE = 0.0175; // $1.75 per $100
export const ACC_MAX_EARNINGS = 156_641;
export const ACC_MAX_LEVY = 2_741.22; // published max; equals ACC_MAX_EARNINGS * ACC_RATE

/**
 * KiwiSaver employee deduction rates from pay dates on/after 1 April 2026.
 * Default / minimum employee rate is 3.5%. Employer minimum also 3.5%.
 * Sources: IR340 Apr 2026; IRD "Taxation bill now in effect" (31 Mar 2026);
 * Payroll Calculations & Business Rules Spec 2026.
 */
export const KIWISAVER_EMPLOYEE_RATES = [3.5, 4, 6, 8, 10] as const;
export const KIWISAVER_DEFAULT_EMPLOYEE_RATE = 3.5;
export const KIWISAVER_EMPLOYER_MIN_RATE = 3.5;
/**
 * Starting employee rate when this account has not saved one.
 * The page states the statutory minimum is 3.5% from 1 April 2026, so that rate is the start.
 */
export const KIWISAVER_ACCOUNT_DEFAULT_EMPLOYEE_RATE = KIWISAVER_DEFAULT_EMPLOYEE_RATE;
/** Buttons on the PAYE page. The starting choice is the statutory minimum. */
export const KIWISAVER_EMPLOYEE_RATE_CHOICES = KIWISAVER_EMPLOYEE_RATES;

/**
 * Student loan — NZ-based borrowers.
 * Annual threshold frozen at $24,128; repayment rate 12%.
 * IRD labels “2026 tax year” as 1 Apr 2025 – 31 Mar 2026; payroll spec keeps
 * the same threshold for subsequent years while the freeze applies.
 * Sources:
 * https://www.ird.govt.nz/student-loans/living-in-new-zealand-with-a-student-loan/repaying-my-student-loan-when-i-earn-salary-or-wages
 * IRD Payroll Calculations & Business Rules Spec 2026
 */
export const STUDENT_LOAN_RATE = 0.12;
export const STUDENT_LOAN_ANNUAL_THRESHOLD = 24_128;
export const STUDENT_LOAN_WEEKLY_THRESHOLD = 464;
export const STUDENT_LOAN_FORTNIGHTLY_THRESHOLD = 928;
export const STUDENT_LOAN_FOUR_WEEKLY_THRESHOLD = 1_856;
export const STUDENT_LOAN_MONTHLY_THRESHOLD = 2_010.66;

/**
 * Independent Earner Tax Credit (IETC) — thresholds from 31 July 2024.
 * Max $520/year ($10/week); abates 13c per $1 over $66,000; $0 at $70,000+.
 * Source: https://www.ird.govt.nz/income-tax/income-tax-for-individuals/individual-tax-credits/independent-earner-tax-credit-ietc
 */
export const IETC_MIN_INCOME = 24_000;
export const IETC_FULL_MAX_INCOME = 66_000;
export const IETC_ABATE_END = 70_000;
export const IETC_FULL_ANNUAL = 520;
export const IETC_ABATE_RATE = 0.13;
const IETC_2024 = {
  minIncome: IETC_MIN_INCOME,
  fullMaxIncome: IETC_FULL_MAX_INCOME,
  abateEnd: IETC_ABATE_END,
  fullAnnual: IETC_FULL_ANNUAL,
  abateRate: IETC_ABATE_RATE,
} as const;

/**
 * Payroll giving donation tax credit = 33.33 cents per dollar donated.
 * Credit may not exceed the tax portion of PAYE for the period.
 * Source: https://www.ird.govt.nz/roles/employees/payroll-giving-as-an-employee
 * IR617 Payroll giving guide
 */
export const PAYROLL_GIVING_CREDIT_RATE = 1 / 3;

/**
 * Donation tax credit (charity / donee orgs) claimed via IR526 — NOT payroll giving.
 * 33.33c per $1 of eligible donations ($5+), capped at 1/3 of taxable income.
 * Do not double-claim payroll-giving donations. Source: IRD donation tax credits.
 */
export const DONATION_TAX_CREDIT_RATE = 1 / 3;

/**
 * Non-declaration (ND) tax code: the income tax part only (KAN-97). Payroll also takes the
 * year's ACC earners' levy on every dollar, with no maximum liable earnings (squared up at year
 * end), so the whole ND deduction is 45% + ACC: 46.75% in 2026/27, 46.67% in 2025/26.
 * Use nonDeclarationRate(rates) for the whole deduction. Source: IRD IR335 Employer's guide.
 */
export const NON_DECLARATION_TAX_RATE = 0.45;

export const RATE_SOURCES = [
  {
    label: 'IRD — Tax rates for individuals',
    url: 'https://www.ird.govt.nz/income-tax/income-tax-for-individuals/tax-codes-and-tax-rates-for-individuals/tax-rates-for-individuals',
  },
  {
    label: 'IRD — About tax codes (PAYE incl. ACC table)',
    url: 'https://www.ird.govt.nz/income-tax/income-tax-for-individuals/tax-codes-and-tax-rates-for-individuals/about-tax-codes',
  },
  {
    label: 'IRD — ACC earners’ levy rates',
    url: 'https://www.ird.govt.nz/income-tax/income-tax-for-individuals/acc-clients-and-carers/acc-earners-levy-rates',
  },
  {
    label: 'IRD — Student loan repayments (salary/wages)',
    url: 'https://www.ird.govt.nz/student-loans/living-in-new-zealand-with-a-student-loan/repaying-my-student-loan-when-i-earn-salary-or-wages',
  },
  {
    label: 'IRD — Independent earner tax credit (IETC)',
    url: 'https://www.ird.govt.nz/income-tax/income-tax-for-individuals/individual-tax-credits/independent-earner-tax-credit-ietc',
  },
  {
    label: 'IRD — Payroll giving as an employee',
    url: 'https://www.ird.govt.nz/roles/employees/payroll-giving-as-an-employee',
  },
  {
    label: 'IRD — About donation tax credits (charity / IR526)',
    url: 'https://www.ird.govt.nz/income-tax/income-tax-for-individuals/individual-tax-credits/donation-tax-credits/about-donation-tax-credits',
  },
  {
    label: 'IRD — IR340 weekly/fortnightly tax tables Apr 2026',
    url: 'https://www.ird.govt.nz/-/media/project/ir/home/documents/forms-and-guides/ir300---ir399/ir340/ir340-apr-2026.pdf',
  },
  {
    label: 'IRD — Payroll Calculations & Business Rules Spec 2026',
    url: 'https://www.ird.govt.nz/-/media/project/ir/home/documents/digital-service-providers/software-providers/payroll-calculations-business-rules-specifications/payroll-calculations-and-business-rules-specification.pdf',
  },
  {
    label: 'IRD — Using the right RWT rate',
    url: 'https://www.ird.govt.nz/income-tax/withholding-taxes/resident-withholding-tax-rwt/using-the-right-rwt-tax-rate',
  },
  {
    label: 'IRD — End-of-year PIE calculation',
    url: 'https://www.ird.govt.nz/income-tax/income-tax-for-individuals/types-of-individual-income/portfolio-investment-entity-income-for-individuals/end-of-year-pie-calculation',
  },
  {
    label: 'IRD — Tax for NZ residents (foreign tax credits)',
    url: 'https://www.ird.govt.nz/international-tax/individuals/tax-for-new-zealand-tax-residents',
  },
] as const;

/**
 * Investing-related tax credits (annual assessment — NOT a payday PAYE field).
 *
 * IRD employer PAYE tables / tax codes have no "investing credit" deduction.
 * Credits from investments (imputation, RWT, PIE, foreign tax) appear on the
 * income-tax assessment and can reduce tax to pay or increase a refund.
 * The PAYE tab lets you enter annual NZD amounts from statements so estimated
 * take-home reflects those credits. Do not invent amounts.
 *
 * RWT rate bands (interest) from 31 July 2024 — reference only; credit = tax
 * already withheld (enter NZD from bank/broker statements):
 *   ≤$15,600 → 10.5%; $15,601–$53,500 → 17.5%; $53,501–$78,100 → 30%;
 *   $78,101–$180,000 → 33%; $180,001+ → 39%. Default without chosen rate: 33%.
 *   No IRD number: 45%. Dividend RWT rate: 33% (offset by imputation credits).
 * Source: https://www.ird.govt.nz/income-tax/withholding-taxes/resident-withholding-tax-rwt/using-the-right-rwt-tax-rate
 */
export const RWT_INTEREST_RATES = [
  { upTo: 15_600, rate: 0.105 },
  { upTo: 53_500, rate: 0.175 },
  { upTo: 78_100, rate: 0.3 },
  { upTo: 180_000, rate: 0.33 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.39 },
] as const;
export const RWT_DIVIDEND_RATE = 0.33;
export const RWT_NO_IRD_RATE = 0.45;
export const RWT_DEFAULT_INTEREST_RATE = 0.33;

/** PIR options for multi-rate PIEs (reference; PIE credit amount is user-entered). */
export const PIE_PIR_RATES = [0, 0.105, 0.175, 0.28] as const;

/**
 * Kinds of investing credits the PAYE tab can model.
 * All amounts are user-entered NZD from IRD/broker/bank statements — no invented formulas.
 */
export const INVESTING_CREDIT_KIND_OPTIONS = [
  {
    kind: 'imputation',
    label: 'Imputation credits (NZ dividends)',
    hint: 'Credits attached to NZ company/unit-trust dividends for tax the company already paid. Enter the annual total from dividend statements. Offsets tax on assessment; may also reduce RWT withheld on the dividend. Not a payday PAYE field.',
  },
  {
    kind: 'rwt',
    label: 'RWT credits (interest / dividends)',
    hint: 'Resident withholding tax already deducted by your bank or fund. Enter annual RWT from statements / myIR investment income. Credits offset income tax on assessment. Not deducted again from salary PAYE.',
  },
  {
    kind: 'pie',
    label: 'PIE tax credit (year-end)',
    hint: 'If your multi-rate PIE used a PIR higher than correct, IRD’s year-end PIE calculation can create a PIE credit (offsets income tax / refund). Enter the credit NZD from your assessment or estimate — not auto-calculated here.',
  },
  {
    kind: 'foreign',
    label: 'Foreign tax credit (overseas investing)',
    hint: 'Tax paid overseas on foreign investment income may qualify for a foreign tax credit (capped at NZ tax on that income). Enter claimable NZD from IR3 / IR1261 workings. Not a payday PAYE field.',
  },
  {
    kind: 'other_investing',
    label: 'Other investing credit',
    hint: 'Any other investment-related tax credit (NZD). Label it; amount is yours — not an IRD published payroll rate.',
  },
] as const;

export type InvestingCreditKind = (typeof INVESTING_CREDIT_KIND_OPTIONS)[number]['kind'];

/** @deprecated alias — same catalog as INVESTING_CREDIT_KIND_OPTIONS */
export const TAX_CREDIT_KIND_OPTIONS = INVESTING_CREDIT_KIND_OPTIONS;
export type TaxCreditKind = InvestingCreditKind;

/**
 * Adult minimum wage (hourly, before tax) — 1 April 2026 to 31 March 2027.
 * Minimum Wage Order 2026: $23.50 → $23.95. Starting-out / training rate $19.16 (80% of adult).
 * Source: https://www.employment.govt.nz/news-and-updates/minimum-wage-is-increasing-on-1-april-2026
 */
export const MINIMUM_WAGE_ADULT_HOURLY = 23.95;
export const MINIMUM_WAGE_STARTING_OUT_HOURLY = 19.16;

/**
 * Holiday pay paid with each pay ("pay as you go"): 8% of gross earnings.
 * Allowed for fixed-term (≤12 months) or intermittent / irregular work, e.g. seasonal piece work.
 * Source: https://www.employment.govt.nz/pay-and-hours/pay-and-wages/leave-and-holiday-pay/pay-as-you-go-annual-holiday-payments
 */
export const HOLIDAY_PAY_PAYG_RATE = 0.08;

/** GST rate (15%). Source: https://www.ird.govt.nz/gst */
export const GST_RATE = 0.15;

/**
 * Schedular payment activities and standard withholding rates (tax code WT).
 * Copied from IRD IR330C "Tax rate notification for contractors" (January 2024), page 3.
 * Source: https://www.ird.govt.nz/-/media/project/ir/home/documents/forms-and-guides/ir300---ir399/ir330c/ir330c-2024.pdf
 *
 * Withholding is on the GST-exclusive amount when the contractor is GST registered.
 * Resident contractors may elect their own rate (not below 10%; 15% for non-residents /
 * temporary visa holders), or use a tailored rate certificate (IR23BS), which can be lower.
 */
export const SCHEDULAR_ELECTED_MIN_RATE = 0.1;
export const SCHEDULAR_ELECTED_MIN_RATE_NON_RESIDENT = 0.15;
export const SCHEDULAR_NO_NOTIFICATION_RATE = 0.45;

export type SchedularActivity = {
  /** IR330C activity number. */
  number: number;
  label: string;
  /** Standard rate as a fraction. */
  rate: number;
};

/**
 * Activities most relevant to output-paid work. The full IR330C table has 27 rows;
 * the rows below are the ones this tool offers, plus voluntary schedular payments.
 */
export const SCHEDULAR_ACTIVITIES: readonly SchedularActivity[] = [
  { number: 3, label: 'Agricultural, horticultural or viticultural contracts (labour on fruit crops, orchards, vegetables or vineyards)', rate: 0.15 },
  { number: 2, label: 'Agricultural contracts on farming land', rate: 0.15 },
  { number: 23, label: 'Shearing or droving', rate: 0.15 },
  { number: 13, label: 'Forestry or bush work, or flax planting or cutting', rate: 0.15 },
  { number: 12, label: 'Fishing boat work for profit-share (supply of labour only)', rate: 0.2 },
  { number: 8, label: 'Labour-only contracts in the building industry', rate: 0.2 },
  { number: 5, label: 'Cleaning premises (not residential), plant, vehicles, furniture', rate: 0.2 },
  { number: 15, label: 'Gardening, grass or hedge cutting, weed or vermin destruction (for a business)', rate: 0.2 },
  { number: 19, label: 'Labour hire arrangement', rate: 0.2 },
  { number: 20, label: 'Caretaking / guard, mail contracting, milk delivery, refuse removal, school transport', rate: 0.15 },
  { number: 21, label: 'Sales of eels, greenstone, sphagnum moss, whitebait, wild deer / pigs / goats (not retail)', rate: 0.25 },
  { number: 25, label: 'Voluntary schedular payments (agreed in writing, e.g. courier or trades not listed)', rate: 0.2 },
] as const;

export const SCHEDULAR_SOURCES = [
  {
    label: 'IRD — IR330C Tax rate notification for contractors (Jan 2024)',
    url: 'https://www.ird.govt.nz/-/media/project/ir/home/documents/forms-and-guides/ir300---ir399/ir330c/ir330c-2024.pdf',
  },
  {
    label: 'IRD — Deductions from payments to contractors',
    url: 'https://www.ird.govt.nz/income-tax/withholding-taxes/schedular-payments/making-schedular-payments/deductions-from-payments-to-contractors',
  },
  {
    label: 'Employment NZ — Minimum wage from 1 April 2026',
    url: 'https://www.employment.govt.nz/news-and-updates/minimum-wage-is-increasing-on-1-april-2026',
  },
  {
    label: 'Employment NZ — Paying annual holidays pay-as-you-go (8%)',
    url: 'https://www.employment.govt.nz/pay-and-hours/pay-and-wages/leave-and-holiday-pay/pay-as-you-go-annual-holiday-payments',
  },
] as const;

/**
 * Working for Families tax credits (KAN-79). Family income = the principal caregiver's and
 * partner's income before tax. Abatement comes off the family tax credit first, then the
 * in-work tax credit; Best Start abates separately. Instalments are the yearly amount ÷ 52,
 * rounded down.
 */
export type WffRates = {
  /** Where the figures were copied from, and when they were checked. */
  sources: readonly { label: string; url: string }[];
  checkedOn: string;
  ftcEldestAnnual: number;
  ftcSubsequentAnnual: number;
  abatementThreshold: number;
  abatementRate: number;
  /** In-work tax credit for 1–3 children, and each child after the 3rd. */
  iwtcAnnual: number;
  iwtcPerExtraChildAnnual: number;
  /** Shown with the estimate, e.g. a temporary rate. */
  iwtcNote: string | null;
  /** Minimum family tax credit: family income after income tax is topped up to this. */
  mftcGuaranteedAfterTax: number;
  mftcHoursSole: number;
  mftcHoursCouple: number;
  bestStartAnnual: number;
  bestStartThreshold: number;
  bestStartAbatementRate: number;
  /** Children born on or after this date are income-tested from birth; earlier births aren't in their 1st year. */
  bestStartTestedFromBirthOn: string | null;
};

/**
 * 1 April 2026 – 31 March 2027. Checked 16 Oct 2026 against IRD's payment pages and the
 * IR271 "Working for Families weekly payments 2027" chart (April 2026).
 */
export const WFF_2026: WffRates = {
  sources: [
    { label: 'IRD — Family tax credit', url: 'https://www.ird.govt.nz/working-for-families/types/family-tax-credit' },
    { label: 'IRD — In-work tax credit', url: 'https://www.ird.govt.nz/working-for-families/types/in-work-tax-credit' },
    { label: 'IRD — Minimum family tax credit', url: 'https://www.ird.govt.nz/working-for-families/types/minimum-family-tax-credit' },
    { label: 'IRD — Best Start', url: 'https://www.ird.govt.nz/working-for-families/types/best-start' },
    { label: 'IRD — IR271 Working for Families weekly payments 2027', url: 'https://www.ird.govt.nz/-/media/project/ir/home/documents/forms-and-guides/ir200---ir299/ir271/ir271-2027.pdf' },
  ],
  checkedOn: '2026-10-16',
  ftcEldestAnnual: 7_921,
  ftcSubsequentAnnual: 6_454,
  abatementThreshold: 44_900,
  abatementRate: 0.275,
  iwtcAnnual: 7_670,
  iwtcPerExtraChildAnnual: 780,
  iwtcNote:
    'The in-work tax credit is temporarily $147 a week from 1 April 2026. It goes back to $97 a week ($5,070 a year) after 31 March 2027, or sooner if 91 petrol stays under $3 a litre for 4 weeks.',
  mftcGuaranteedAfterTax: 36_604,
  mftcHoursSole: 20,
  mftcHoursCouple: 30,
  bestStartAnnual: 4_041,
  bestStartThreshold: 79_000,
  bestStartAbatementRate: 0.21,
  bestStartTestedFromBirthOn: '2026-04-01',
};

/**
 * Per-tax-year rates for the pay tools. Keyed by the calendar year the tax year starts
 * (2026 = 1 April 2026 – 31 March 2027). Add a new entry when IRD / Employment NZ publish
 * the next year's figures; the calculators read only from here (KAN-22 / KAN-70).
 */
export type PayTaxYearRates = {
  startYear: number;
  label: string;
  start: string;
  end: string;
  minimumWageAdultHourly: number;
  minimumWageStartingOutHourly: number;
  holidayPayPaygRate: number;
  gstRate: number;
  incomeTaxBrackets: readonly TaxBracket[];
  secondaryTaxCodes: readonly { code: string; upTo: number; rate: number }[];
  accRate: number;
  accMaxEarnings: number;
  accMaxLevy: number;
  /** KiwiSaver employee rates offered for this year; the default is the statutory minimum. */
  kiwiSaverEmployeeRates: readonly number[];
  kiwiSaverDefaultEmployeeRate: number;
  kiwiSaverEmployerMinRate: number;
  studentLoanRate: number;
  studentLoanAnnualThreshold: number;
  ietc: { minIncome: number; fullMaxIncome: number; abateEnd: number; fullAnnual: number; abateRate: number };
  /** Working for Families (KAN-79). null = not loaded for this year (the estimate shows a dash). */
  wff: WffRates | null;
  schedularActivities: readonly SchedularActivity[];
  schedularElectedMinRate: number;
  schedularNoNotificationRate: number;
};

export const PAY_TAX_YEARS: Readonly<Record<number, PayTaxYearRates>> = {
  2026: {
    startYear: 2026,
    label: PAYE_TAX_YEAR_LABEL,
    start: '2026-04-01',
    end: '2027-03-31',
    minimumWageAdultHourly: MINIMUM_WAGE_ADULT_HOURLY,
    minimumWageStartingOutHourly: MINIMUM_WAGE_STARTING_OUT_HOURLY,
    holidayPayPaygRate: HOLIDAY_PAY_PAYG_RATE,
    gstRate: GST_RATE,
    incomeTaxBrackets: INCOME_TAX_BRACKETS,
    secondaryTaxCodes: SECONDARY_TAX_CODES,
    accRate: ACC_RATE,
    accMaxEarnings: ACC_MAX_EARNINGS,
    accMaxLevy: ACC_MAX_LEVY,
    kiwiSaverEmployeeRates: KIWISAVER_EMPLOYEE_RATES,
    kiwiSaverDefaultEmployeeRate: KIWISAVER_DEFAULT_EMPLOYEE_RATE,
    kiwiSaverEmployerMinRate: KIWISAVER_EMPLOYER_MIN_RATE,
    studentLoanRate: STUDENT_LOAN_RATE,
    studentLoanAnnualThreshold: STUDENT_LOAN_ANNUAL_THRESHOLD,
    ietc: IETC_2024,
    wff: WFF_2026,
    schedularActivities: SCHEDULAR_ACTIVITIES,
    schedularElectedMinRate: SCHEDULAR_ELECTED_MIN_RATE,
    schedularNoNotificationRate: SCHEDULAR_NO_NOTIFICATION_RATE,
  },
  /**
   * 1 April 2025 – 31 March 2026 (KAN-79). Sources (checked 15 Oct 2026), also in docs/PAYE_RATES.md:
   * - Income tax and secondary codes: IRD tax rates for individuals, "From 1 April 2025" (same bands as 2026/27).
   * - ACC earners' levy: IRD ACC earners' levy rates, 1 Apr 2025 – 31 Mar 2026: 1.67%, max earnings $152,790, max levy $2,551.59.
   * - KiwiSaver: default / employer minimum 3% until the 3.5% change on pay days from 1 April 2026 (IRD "KiwiSaver changes", 2025).
   * - Student loan: "2026 tax year" threshold $24,128 at 12% (IRD student loan repayments page).
   * - IETC: thresholds from 31 July 2024 (IRD IETC page).
   * - Minimum wage from 1 April 2025: adult $23.50, starting-out $18.80 (Employment NZ previous minimum wage rates).
   */
  2025: {
    startYear: 2025,
    label: '1 April 2025 – 31 March 2026',
    start: '2025-04-01',
    end: '2026-03-31',
    minimumWageAdultHourly: 23.5,
    minimumWageStartingOutHourly: 18.8,
    holidayPayPaygRate: HOLIDAY_PAY_PAYG_RATE,
    gstRate: GST_RATE,
    incomeTaxBrackets: INCOME_TAX_BRACKETS,
    secondaryTaxCodes: SECONDARY_TAX_CODES,
    accRate: 0.0167,
    accMaxEarnings: 152_790,
    accMaxLevy: 2_551.59,
    kiwiSaverEmployeeRates: [3, 4, 6, 8, 10],
    kiwiSaverDefaultEmployeeRate: 3,
    kiwiSaverEmployerMinRate: 3,
    studentLoanRate: STUDENT_LOAN_RATE,
    studentLoanAnnualThreshold: STUDENT_LOAN_ANNUAL_THRESHOLD,
    ietc: IETC_2024,
    // Not loaded: IRD's 2025/26 chart (IR271 July 2025) doesn't state the yearly family tax credit amounts.
    wff: null,
    schedularActivities: SCHEDULAR_ACTIVITIES,
    schedularElectedMinRate: SCHEDULAR_ELECTED_MIN_RATE,
    schedularNoNotificationRate: SCHEDULAR_NO_NOTIFICATION_RATE,
  },
};

/** Tax years with published rates, newest first (for year pickers). */
export const PAY_TAX_YEAR_OPTIONS: readonly PayTaxYearRates[] = Object.values(PAY_TAX_YEARS).sort((a, b) => b.startYear - a.startYear);

/** The tax year (by start year) a date falls in; NZ tax years run 1 April – 31 March. */
export function taxYearForDate(ymd: string): number {
  const [y, m] = ymd.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

export const CURRENT_PAY_TAX_YEAR = 2026;

/** Rates for a tax year, or the current year when that year has no config yet. */
export function payTaxYearRates(startYear: number = CURRENT_PAY_TAX_YEAR): PayTaxYearRates {
  return PAY_TAX_YEARS[startYear] ?? PAY_TAX_YEARS[CURRENT_PAY_TAX_YEAR];
}

/** Whole ND deduction rate for a tax year: 45% income tax + that year's ACC earners' levy. */
export function nonDeclarationRate(rates: PayTaxYearRates = payTaxYearRates()): number {
  return NON_DECLARATION_TAX_RATE + rates.accRate;
}
