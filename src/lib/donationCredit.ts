/**
 * Donation tax credit (IR526): a third of the amount, worked to 2 decimal places without
 * rounding up (IRD, About donation tax credits). Shared by the PAYE page and the Donations page
 * so the two can't disagree (KAN-90, KAN-104).
 * https://www.ird.govt.nz/income-tax/income-tax-for-individuals/individual-tax-credits/donation-tax-credits/about-donation-tax-credits
 */

/** A third of `cents`, truncated to whole cents, in cents. Integer maths, so no float drift. */
export function donationCreditCents(cents: number): number {
  return Math.floor(Math.max(0, Math.round(cents)) / 3);
}

/** A third of an NZD amount, truncated to cents. $200 → $66.66, $6.60 → $2.20. */
export function donationCreditNzd(amountNzd: number): number {
  return donationCreditCents(Math.round(Math.max(0, amountNzd) * 100)) / 100;
}
