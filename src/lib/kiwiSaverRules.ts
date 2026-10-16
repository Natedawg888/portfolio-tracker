/**
 * KiwiSaver rules for the KiwiSaver calculator (KAN-59). NEVER invent: copied from IRD, with
 * sources and the date checked. The calculator applies today's rules to every future year.
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
