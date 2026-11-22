/**
 * Donations page helpers (KAN-25): the add/edit form and the tax-year picker.
 * Figures come from GET /api/donations/summary (server/donations/model.ts); nothing is counted here.
 */
import type { Donation, DonationTaxYearTotals, DonationWriteBody } from '../types';

export type DonationFields = { date: string; recipient: string; amount: string; notes: string; evidenceUrl: string };

export function emptyDonationFields(today: string): DonationFields {
  return { date: today, recipient: '', amount: '', notes: '', evidenceUrl: '' };
}

export function fieldsFromDonation(d: Donation): DonationFields {
  return { date: d.date, recipient: d.recipient, amount: String(d.amountNzd), notes: d.notes ?? '', evidenceUrl: d.evidenceUrl ?? '' };
}

/** The body to send, or the first problem to show. Mirrors the server's checks. */
export function donationBodyFromFields(f: DonationFields): { ok: true; body: DonationWriteBody & { date: string; recipient: string; amountNzd: number } } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return { ok: false, error: 'Choose the date you gave.' };
  const recipient = f.recipient.trim();
  if (!recipient) return { ok: false, error: 'Who did you give to?' };
  const amount = Number(f.amount.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter an amount over $0.' };
  const url = f.evidenceUrl.trim();
  if (url && !/^https?:\/\//i.test(url)) return { ok: false, error: 'The receipt link must start with http:// or https://.' };
  return {
    ok: true,
    body: { date: f.date, recipient, amountNzd: Math.round(amount * 100) / 100, notes: f.notes.trim() || null, evidenceUrl: url || null },
  };
}

/** "2026/27" for a tax year named by its end year (the donations API's key). */
export function donationYearLabel(endYear: number): string {
  return `${endYear - 1}/${String(endYear % 100).padStart(2, '0')}`;
}

/** What to say under the totals for a year. */
export function donationYearNotes(y: DonationTaxYearTotals): string[] {
  const out: string[] = [];
  if (y.belowMinimumCount > 0) {
    out.push(`${y.belowMinimumCount === 1 ? '1 gift was' : `${y.belowMinimumCount} gifts were`} under $${y.minimumDonationNzd}, so ${y.belowMinimumCount === 1 ? 'it isn’t' : 'they aren’t'} counted for the credit.`);
  }
  if (y.eligibleCapApplied && y.eligibleCapNzd != null) {
    out.push(`Eligible gifts are capped at $${y.eligibleCapNzd.toLocaleString('en-NZ')} a year from the 2027/28 tax year.`);
  }
  return out;
}
