/**
 * KiwiSaver rules for the KiwiSaver calculator (KAN-59). NEVER invent: copied from IRD, with
 * sources and the date checked. The calculator applies today's rules to every future year,
 * except the enacted default rate step to 4% from 1 April 2028 (KAN-89).
 */

/** ESCT (employer superannuation contribution tax) bands from 1 April 2025, on the employee's
 * yearly salary or wages plus the employer's gross contributions. */
export const ESCT_BANDS: readonly { upTo: number; rate: number }[] = [
  { upTo: 18_720, rate: 0.105 },
  { upTo: 64_200, rate: 0.175 },
  { upTo: 93_720, rate: 0.3 },
  { upTo: 216_000, rate: 0.33 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.39 },
];

/** Government contribution from 1 July 2025: 25c per $1 the member puts in (1 July – 30 June),
 * up to $260.72, for members aged 16–65 with yearly taxable income of $180,000 or less. */
export const GOVERNMENT_CONTRIBUTION = {
  perDollar: 0.25,
  maxPerYear: 260.72,
  /** What IRD says to put in (1 July – 30 June) for the full amount. */
  contributeForFull: 1_042.86,
  incomeLimit: 180_000,
  minAge: 16,
  /** Paid until the member can withdraw at 65. */
  maxAge: 65,
} as const;

/**
 * Default employee rate and employer minimum by tax year (by the year it starts), as enacted
 * (KAN-89): 3% to 31 March 2026, 3.5% from 1 April 2026, 4% from 1 April 2028 (Taxation
 * (Budget Measures) Act 2025; IRD "KiwiSaver changes"). The employee rate choices after 2028
 * aren't published yet.
 */
export const KIWISAVER_DEFAULT_RATE_STEPS: readonly { fromTaxYear: number; ratePct: number }[] = [
  { fromTaxYear: 2028, ratePct: 4 },
  { fromTaxYear: 2026, ratePct: 3.5 },
  { fromTaxYear: 0, ratePct: 3 },
];

export function kiwiSaverDefaultRatePct(taxYearStart: number): number {
  return (KIWISAVER_DEFAULT_RATE_STEPS.find((s) => taxYearStart >= s.fromTaxYear) ?? KIWISAVER_DEFAULT_RATE_STEPS[KIWISAVER_DEFAULT_RATE_STEPS.length - 1]).ratePct;
}

export const KIWISAVER_CHANGES_SOURCE = { label: 'IRD — KiwiSaver changes', url: 'https://www.ird.govt.nz/kiwisaver-changes' } as const;

/** Age KiwiSaver savings can be withdrawn. */
export const KIWISAVER_WITHDRAWAL_AGE = 65;

export const KIWISAVER_RULES_CHECKED_ON = '2026-10-16';
export const KIWISAVER_RULES_SOURCES = [
  {
    label: 'IRD — Getting the KiwiSaver government contribution',
    url: 'https://www.ird.govt.nz/kiwisaver/kiwisaver-individuals/growing-my-kiwisaver-account/getting-the-kiwisaver-government-contribution',
  },
  { label: 'IRD — Get ready for new ESCT and FBT changes (ESCT bands from 1 April 2025)', url: 'https://www.ird.govt.nz/pages/campaigns/get-ready-for-new-esct-and-fbt-changes' },
  { label: 'IRD — IR340 PAYE deduction tables, April 2026 (ESCT bands)', url: 'https://www.ird.govt.nz/-/media/project/ir/home/documents/forms-and-guides/ir300---ir399/ir340/ir340-apr-2026.pdf' },
  { label: 'IRD — Employer contributions to KiwiSaver', url: 'https://www.ird.govt.nz/kiwisaver/kiwisaver-employers/contributions-and-deductions/employer-contributions-to-kiwisaver-and-complying-funds' },
] as const;

export function esctRate(salaryPlusEmployer: number): number {
  return (ESCT_BANDS.find((b) => salaryPlusEmployer <= b.upTo) ?? ESCT_BANDS[ESCT_BANDS.length - 1]).rate;
}
