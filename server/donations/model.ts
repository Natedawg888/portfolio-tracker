/**
 * Donation ledger figures. Amounts are NZD. Dates are calendar dates
 * (YYYY-MM-DD). Nothing here is stored on a transaction or a receipt file.
 *
 * Tax year (Pacific/Auckland calendar dates, no time of day):
 *   An NZ tax year runs from 1 April through 31 March.
 *   It is labelled by the year it ends.
 *   The 2027 tax year is 2026-04-01 through 2027-03-31.
 *   A date in April–December belongs to the tax year ending the next 31 March.
 *   A date in January–March belongs to the tax year ending that 31 March.
 *
 * Totals for one tax year, from donations whose date falls in that year:
 *   totalAmountNzd = sum of amountNzd, rounded to cents.
 *   eligibleAmountNzd = sum of amountNzd where amountNzd >= 5.
 *   Donations under $5 are not added together to reach $5.
 *   belowMinimumAmountNzd = sum of amountNzd where amountNzd < 5.
 *   estimatedTaxCreditNzd = floor(eligible cents / 3) / 100.
 *   IRD works the credit to 2 decimal places without rounding up, so a part
 *   cent is dropped: $200.00 gives $66.66, not $66.67. The division is done
 *   on integer cents so no floating-point error can push it over a cent.
 *   The one-third is taken once on the summed eligible amount, not by
 *   truncating each donation's third and adding those.
 *
 * The credit is an estimate of the IRD donation tax credit (IR526):
 *   33.33 cents per dollar (one third) of donations of $5 or more.
 *   Source: https://www.ird.govt.nz/income-tax/income-tax-for-individuals/individual-tax-credits/donation-tax-credits/about-donation-tax-credits
 *   IRD also caps the credit at one third of taxable income. Taxable income
 *   is not stored here, so that cap is not applied (incomeCapApplied is false).
 *   Payroll giving is already credited each pay and is not part of this estimate.
 *   Approved-donee status is not checked. A receipt is required to claim;
 *   this estimate does not look at evidenceUrl or receiptTransactionId.
 *
 * Amounts are rounded to cents before they are stored. The $5 test uses that
 * cent amount. 4.995 NZD is stored as 5.00 and counts. 4.994 NZD is stored
 * as 4.99 and does not.
 */

import type { DonationSummary, DonationTaxYearTotals } from '../../src/types/index.ts';
import { isIsoDate, roundMoney } from '../debts/model.ts';

export const DONATION_TAX_CREDIT_MINIMUM_NZD = 5;
export const DONATION_TAX_CREDIT_RATE_LABEL = '1/3' as const;

export const DONATION_TAX_YEAR_NOTE =
  'An NZ tax year runs from 1 April through 31 March and is labelled by the year it ends. The 2027 tax year is 2026-04-01 through 2027-03-31. A date on or after 1 April belongs to the tax year that ends the following 31 March.';

export const DONATION_TAX_CREDIT_ESTIMATE_NOTE =
  'Estimate only. The IRD donation tax credit is one third of donations of $5 or more to an approved donee (33.33 cents per $1), claimed after year-end on IR526 with receipts. estimatedTaxCreditNzd is eligibleAmountNzd divided by 3, worked to 2 decimal places without rounding up, as IRD does ($200 gives $66.66). Donations under $5 stay in totalAmountNzd and are not added together to reach $5. IRD also caps the credit at one third of taxable income. Taxable income is not stored here, so that cap is not applied. Payroll giving is already credited each pay and is not part of this estimate. Approved-donee status and whether a receipt is linked are not checked.';

export type DonationInput = {
  date: string;
  recipient: string;
  amountNzd: number;
  notes: string | null;
  evidenceUrl: string | null;
  receiptTransactionId: string | null;
};

export type DonationAmount = {
  date: string;
  amountNzd: number;
};

export type NzTaxYear = {
  taxYear: number;
  taxYearStart: string;
  taxYearEnd: string;
};

function cents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100);
}

export function nzTaxYearBounds(taxYear: number): NzTaxYear {
  return {
    taxYear,
    taxYearStart: `${taxYear - 1}-04-01`,
    taxYearEnd: `${taxYear}-03-31`,
  };
}

/** Tax year containing this calendar date, or null when the date is not YYYY-MM-DD. */
export function nzTaxYearForDate(iso: string): NzTaxYear | null {
  if (!isIsoDate(iso)) return null;
  const [y, m] = iso.split('-').map(Number);
  const taxYear = m >= 4 ? y + 1 : y;
  return nzTaxYearBounds(taxYear);
}

export function summarizeTaxYear(rows: DonationAmount[], taxYear: number): DonationTaxYearTotals {
  let totalCents = 0;
  let eligibleCents = 0;
  let belowCents = 0;
  let count = 0;
  let eligibleCount = 0;
  let belowCount = 0;
  for (const row of rows) {
    const year = nzTaxYearForDate(row.date);
    if (!year || year.taxYear !== taxYear) continue;
    const amountCents = cents(row.amountNzd);
    count += 1;
    totalCents += amountCents;
    if (amountCents >= DONATION_TAX_CREDIT_MINIMUM_NZD * 100) {
      eligibleCount += 1;
      eligibleCents += amountCents;
    } else if (amountCents > 0) {
      belowCount += 1;
      belowCents += amountCents;
    }
  }
  return {
    ...nzTaxYearBounds(taxYear),
    count,
    totalAmountNzd: totalCents / 100,
    eligibleCount,
    eligibleAmountNzd: eligibleCents / 100,
    belowMinimumCount: belowCount,
    belowMinimumAmountNzd: belowCents / 100,
    estimatedTaxCreditNzd: Math.floor(eligibleCents / 3) / 100,
    estimateLabel: 'estimate',
    minimumDonationNzd: DONATION_TAX_CREDIT_MINIMUM_NZD,
    creditRate: DONATION_TAX_CREDIT_RATE_LABEL,
    incomeCapApplied: false,
  };
}

export function donationSummary(
  rows: DonationAmount[],
  asOf: string,
  taxYear: number | null,
): DonationSummary {
  const current = nzTaxYearForDate(asOf);
  if (!current) {
    throw new Error('asOf must be YYYY-MM-DD');
  }
  const selectedYear = taxYear ?? current.taxYear;
  const yearSet = new Set<number>([current.taxYear, selectedYear]);
  for (const row of rows) {
    const year = nzTaxYearForDate(row.date);
    if (year) yearSet.add(year.taxYear);
  }
  const years = [...yearSet]
    .sort((a, b) => b - a)
    .map((year) => summarizeTaxYear(rows, year));
  const selected = years.find((year) => year.taxYear === selectedYear) ?? summarizeTaxYear(rows, selectedYear);
  return {
    currency: 'NZD',
    timezone: 'Pacific/Auckland',
    asOf,
    currentTaxYear: current.taxYear,
    taxYear: selectedYear,
    estimateLabel: 'estimate',
    estimateNote: DONATION_TAX_CREDIT_ESTIMATE_NOTE,
    taxYearNote: DONATION_TAX_YEAR_NOTE,
    minimumDonationNzd: DONATION_TAX_CREDIT_MINIMUM_NZD,
    creditRate: DONATION_TAX_CREDIT_RATE_LABEL,
    incomeCapApplied: false,
    selected,
    years,
  };
}

function asBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

function hasKey(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function parseDate(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: false, error: 'date is required' };
  if (typeof raw !== 'string' || !isIsoDate(raw.trim())) {
    return { ok: false, error: 'date must be YYYY-MM-DD' };
  }
  return { ok: true, value: raw.trim() };
}

function parseRecipient(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'recipient is required' };
  const recipient = raw.trim();
  if (!recipient) return { ok: false, error: 'recipient is required' };
  if (recipient.length > 200) return { ok: false, error: 'recipient is too long' };
  return { ok: true, value: recipient };
}

function parseAmount(raw: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim()
        ? Number(raw.trim())
        : Number.NaN;
  if (!Number.isFinite(n)) return { ok: false, error: 'amountNzd must be a positive number' };
  const value = roundMoney(n);
  if (!(value > 0)) return { ok: false, error: 'amountNzd must be a positive number' };
  return { ok: true, value };
}

function parseNotes(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: 'notes must be a string or null' };
  const notes = raw.trim();
  if (notes.length > 2000) return { ok: false, error: 'notes is too long' };
  return { ok: true, value: notes || null };
}

function parseEvidenceUrl(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: 'evidenceUrl must be an http(s) URL or blank' };
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > 2000) return { ok: false, error: 'evidenceUrl is too long' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: 'evidenceUrl must be an http(s) URL or blank' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'evidenceUrl must be an http(s) URL or blank' };
  }
  return { ok: true, value };
}

function parseReceiptTransactionId(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') {
    return { ok: false, error: 'receiptTransactionId must be a string or null' };
  }
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > 200 || /\s/.test(value)) {
    return { ok: false, error: 'receiptTransactionId must be a string or null' };
  }
  return { ok: true, value };
}

export function parseTaxYearQuery(
  raw: unknown,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string' || !/^\d{4}$/.test(raw.trim())) {
    return { ok: false, error: 'taxYear must be a four-digit year' };
  }
  const year = Number(raw.trim());
  if (year < 1900 || year > 2200) return { ok: false, error: 'taxYear must be from 1900 to 2200' };
  return { ok: true, value: year };
}

export function parseCreateDonation(
  body: unknown,
): { ok: true; value: DonationInput } | { ok: false; error: string } {
  const b = asBody(body);
  const date = parseDate(b.date);
  if (!date.ok) return date;
  const recipient = parseRecipient(b.recipient);
  if (!recipient.ok) return recipient;
  const amount = parseAmount(b.amountNzd);
  if (!amount.ok) return amount;
  const notes = hasKey(b, 'notes') ? parseNotes(b.notes) : { ok: true as const, value: null };
  if (!notes.ok) return notes;
  const evidenceUrl = hasKey(b, 'evidenceUrl')
    ? parseEvidenceUrl(b.evidenceUrl)
    : { ok: true as const, value: null };
  if (!evidenceUrl.ok) return evidenceUrl;
  const receiptTransactionId = hasKey(b, 'receiptTransactionId')
    ? parseReceiptTransactionId(b.receiptTransactionId)
    : { ok: true as const, value: null };
  if (!receiptTransactionId.ok) return receiptTransactionId;
  return {
    ok: true,
    value: {
      date: date.value,
      recipient: recipient.value,
      amountNzd: amount.value,
      notes: notes.value,
      evidenceUrl: evidenceUrl.value,
      receiptTransactionId: receiptTransactionId.value,
    },
  };
}

export function parsePatchDonation(
  body: unknown,
): { ok: true; value: Partial<DonationInput> } | { ok: false; error: string } {
  const b = asBody(body);
  const patch: Partial<DonationInput> = {};
  if (hasKey(b, 'date')) {
    const date = parseDate(b.date);
    if (!date.ok) return date;
    patch.date = date.value;
  }
  if (hasKey(b, 'recipient')) {
    const recipient = parseRecipient(b.recipient);
    if (!recipient.ok) return recipient;
    patch.recipient = recipient.value;
  }
  if (hasKey(b, 'amountNzd')) {
    const amount = parseAmount(b.amountNzd);
    if (!amount.ok) return amount;
    patch.amountNzd = amount.value;
  }
  if (hasKey(b, 'notes')) {
    const notes = parseNotes(b.notes);
    if (!notes.ok) return notes;
    patch.notes = notes.value;
  }
  if (hasKey(b, 'evidenceUrl')) {
    const evidenceUrl = parseEvidenceUrl(b.evidenceUrl);
    if (!evidenceUrl.ok) return evidenceUrl;
    patch.evidenceUrl = evidenceUrl.value;
  }
  if (hasKey(b, 'receiptTransactionId')) {
    const receiptTransactionId = parseReceiptTransactionId(b.receiptTransactionId);
    if (!receiptTransactionId.ok) return receiptTransactionId;
    patch.receiptTransactionId = receiptTransactionId.value;
  }
  return { ok: true, value: patch };
}
