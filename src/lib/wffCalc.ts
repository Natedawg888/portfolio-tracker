/**
 * Working for Families estimate (KAN-79), from the rates in payeRates.ts only.
 *
 * - Family income is the principal caregiver's and partner's income before tax.
 * - Family tax credit (FTC): eldest + each other dependent child, less abatement above the threshold.
 * - In-work tax credit (IWTC): families in paid work, not on a main benefit; takes whatever
 *   abatement is left after the FTC is used up.
 * - Minimum family tax credit (MFTC): tops income after income tax up to a guaranteed amount,
 *   for families in paid work for enough hours, not on a main benefit.
 * - Best Start: per child under 3, worked out month by month across the tax year; abated
 *   separately above its own threshold, except a child's 1st year when born before the date the
 *   rules changed.
 * - Instalments are the yearly amount ÷ 52, rounded down (IRD).
 *
 * An estimate for a full year in the circumstances given. Shared care, foster care, orphan's and
 * unsupported child's benefits, and mid-year changes aren't modelled.
 */
import type { WffRates } from './payeRates';

export type WffChild = { /** 'YYYY-MM' */ birthMonth: string };
export type WffInput = {
  /** First day of the tax year, 'YYYY-04-01'. */
  taxYearStart: string;
  familyIncome: number;
  /** Income tax on the family income (no ACC), for the minimum family tax credit. */
  familyIncomeTax: number;
  couple: boolean;
  children: WffChild[];
  inPaidWork: boolean;
  /** Combined hours a week in paid work (both partners). */
  hoursPerWeek: number;
  mainBenefit: boolean;
};
export type WffAmounts = { ftc: number; iwtc: number; mftc: number; bestStart: number; total: number };
export type WffResult = {
  annual: WffAmounts;
  weekly: WffAmounts;
  /** What abatement took off each credit, a year. */
  abated: { ftc: number; iwtc: number; bestStart: number };
  /** Full amounts before abatement, a year. */
  full: { ftc: number; iwtc: number; bestStart: number };
  dependentChildren: number;
  bestStartChildren: number;
  notes: string[];
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const weekly = (annual: number) => Math.floor(annual / 52);

function monthIndex(ym: string): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  if (!m) return null;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? Number(m[1]) * 12 + (mo - 1) : null;
}

export function estimateWff(input: WffInput, rates: WffRates): WffResult {
  const notes: string[] = [];
  const start = monthIndex(input.taxYearStart)!;
  const end = start + 11;
  const income = Math.max(0, input.familyIncome);
  const kids = input.children.map((c) => monthIndex(c.birthMonth)).filter((m): m is number => m != null && m <= end);

  // Dependent children: born by the end of the tax year and under 18 when it starts.
  const dependants = kids.filter((b) => start - b < 18 * 12);
  const n = dependants.length;
  if (kids.some((b) => start - b >= 16 * 12 && start - b < 18 * 12)) notes.push('Children aged 16 or 17 count only if they’re still financially dependent (for example, at school).');
  if (dependants.some((b) => b > start)) notes.push('A child born during the year is counted for the whole year here; IRD pays from the birth.');

  // Family tax credit, then in-work tax credit, share one abatement.
  const abatement = Math.max(0, income - rates.abatementThreshold) * rates.abatementRate;
  const ftcFull = n > 0 ? rates.ftcEldestAnnual + (n - 1) * rates.ftcSubsequentAnnual : 0;
  const ftc = Math.max(0, ftcFull - abatement);
  const leftover = Math.max(0, abatement - ftcFull);
  const iwtcEligible = n > 0 && input.inPaidWork && !input.mainBenefit;
  const iwtcFull = iwtcEligible ? rates.iwtcAnnual + Math.max(0, n - 3) * rates.iwtcPerExtraChildAnnual : 0;
  const iwtc = Math.max(0, iwtcFull - leftover);
  if (n > 0 && !iwtcEligible) notes.push(input.mainBenefit ? 'The in-work tax credit isn’t paid while the family gets a main benefit.' : 'The in-work tax credit needs income from paid work.');
  if (iwtcFull > 0 && rates.iwtcNote) notes.push(rates.iwtcNote);

  // Minimum family tax credit.
  const hoursNeeded = input.couple ? rates.mftcHoursCouple : rates.mftcHoursSole;
  const afterTax = income - Math.max(0, input.familyIncomeTax);
  let mftc = 0;
  if (n > 0 && input.inPaidWork && !input.mainBenefit && afterTax < rates.mftcGuaranteedAfterTax) {
    if (input.hoursPerWeek >= hoursNeeded) mftc = rates.mftcGuaranteedAfterTax - afterTax;
    else notes.push(`The minimum family tax credit needs at least ${hoursNeeded} hours a week of paid work ${input.couple ? 'between you' : ''}`.trim() + '.');
  }

  // Best Start, month by month.
  let untested = 0;
  let tested = 0;
  let testedMonths = 0;
  const changeOn = rates.bestStartTestedFromBirthOn ? monthIndex(rates.bestStartTestedFromBirthOn) : null;
  for (let m = start; m <= end; m++) {
    let anyTested = false;
    for (const b of kids) {
      const age = m - b;
      if (age < 0 || age >= 36) continue;
      const firstYearFree = age < 12 && (changeOn == null || b < changeOn);
      if (firstYearFree) untested += rates.bestStartAnnual / 12;
      else {
        tested += rates.bestStartAnnual / 12;
        anyTested = true;
      }
    }
    if (anyTested) testedMonths += 1;
  }
  const bsAbatement = Math.max(0, income - rates.bestStartThreshold) * rates.bestStartAbatementRate * (testedMonths / 12);
  const bestStartFull = untested + tested;
  const bestStart = untested + Math.max(0, tested - bsAbatement);
  const bestStartChildren = kids.filter((b) => end - b >= 0 && start - b < 36).length;

  const annual = { ftc: r2(ftc), iwtc: r2(iwtc), mftc: r2(mftc), bestStart: r2(bestStart), total: 0 };
  annual.total = r2(annual.ftc + annual.iwtc + annual.mftc + annual.bestStart);
  const wk = { ftc: weekly(annual.ftc), iwtc: weekly(annual.iwtc), mftc: weekly(annual.mftc), bestStart: weekly(annual.bestStart), total: 0 };
  wk.total = wk.ftc + wk.iwtc + wk.mftc + wk.bestStart;
  return {
    annual,
    weekly: wk,
    abated: { ftc: r2(ftcFull - ftc), iwtc: r2(iwtcFull - iwtc), bestStart: r2(bestStartFull - bestStart) },
    full: { ftc: r2(ftcFull), iwtc: r2(iwtcFull), bestStart: r2(bestStartFull) },
    dependentChildren: n,
    bestStartChildren,
    notes,
  };
}
