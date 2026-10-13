import { isYmd } from '../lib/invoiceCalc';
import { WARRANTY_LENGTHS, daysLeft, warrantyEndDate } from '../lib/warranty';

/**
 * Warranties page view helpers. Header (phase 1): subtitle and status words.
 * Add form (phase 2): cover end date, the live cover line, and why Save is off. Counts come from the list response.
 * Active, expiring, and expired are disjoint: active is not inside the
 * expiring window. A missing or negative count is shown as zero.
 */

export type WarrantyTotals = {
  active: number;
  expiring: number;
  expired: number;
};

function wholeCount(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function countLabel(n: number, word: string): string {
  return `${wholeCount(n)} ${word}`;
}

/**
 * "{active} covered · {expiring} ending in {n} days · {expired} expired".
 * "Covered" is totals.active only, so it does not include warranties that are
 * also ending soon. The day count is expiringSoonDays from the list.
 */
export function warrantiesSubtitle(totals: WarrantyTotals, expiringSoonDays: number): string {
  const days = wholeCount(expiringSoonDays);
  const dayLabel = days === 1 ? '1 day' : `${days} days`;
  return `${countLabel(totals.active, 'covered')} · ${countLabel(totals.expiring, 'ending')} in ${dayLabel} · ${countLabel(totals.expired, 'expired')}`;
}

/** Status words shown on the page (text, not colour alone). */
export const WARRANTY_STATUS_LABELS = { active: 'Covered', expiring: 'Ending soon', expired: 'Expired' } as const;

/** Header subtitle: a short line before the first warranty, then the counts. */
export function warrantiesHeaderLine(itemCount: number, totals: WarrantyTotals, expiringSoonDays: number): string {
  return itemCount > 0 ? warrantiesSubtitle(totals, expiringSoonDays) : 'What you bought, and when the cover ends';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "8 Oct 2027". */
export function longDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Time left in plain words: "N days left" under 60 days, "N months left" under
 * 2 years, otherwise "N.N years left"; "Ends today"; "Ended N days ago".
 */
export function timeLeftText(endsOn: string, today: string): string {
  const left = daysLeft(endsOn, today);
  if (left === 0) return 'Ends today';
  if (left < 0) return `Ended ${plural(-left, 'day')} ago`;
  if (left < 60) return `${plural(left, 'day')} left`;
  if (left < 730) return `${plural(Math.floor(left / 30.4375), 'month')} left`;
  return `${(left / 365.25).toFixed(1)} years left`;
}

/** One-tap cover lengths: the shared presets plus Custom. */
export const COVER_OPTIONS = [...WARRANTY_LENGTHS.map((l) => ({ value: String(l.months), label: l.label })), { value: 'custom', label: 'Custom' }];

export type CoverChoice = {
  /** Months as a string from COVER_OPTIONS, or 'custom'. */
  cover: string;
  customBy: 'months' | 'date';
  customMonths: string;
  /** Custom end date (last day of cover). */
  endsOn: string;
};

/** Last day of cover from the bought-on date and the cover choice; '' when it can't be worked out yet. */
export function coverEndDate(startsOn: string, c: CoverChoice): string {
  if (!isYmd(startsOn)) return '';
  if (c.cover !== 'custom') return warrantyEndDate(startsOn, Number(c.cover));
  if (c.customBy === 'date') return isYmd(c.endsOn) ? c.endsOn : '';
  const months = Number(c.customMonths);
  return Number.isInteger(months) && months >= 1 && months <= 600 ? warrantyEndDate(startsOn, months) : '';
}

/** "Covered until 8 Oct 2027 · 1.0 years left", or "Cover ended 1 Mar 2025 · Ended 590 days ago". */
export function coverLine(endsOn: string, today: string): string {
  const left = daysLeft(endsOn, today);
  return `${left < 0 ? 'Cover ended' : 'Covered until'} ${longDate(endsOn)} · ${timeLeftText(endsOn, today)}`;
}

/** Why Save is off, shown next to the button; null when the form can be saved. */
export function saveBlocker(f: { itemName: string; startsOn: string; price: string } & CoverChoice): string | null {
  if (!f.itemName.trim()) return 'Add what it is to save';
  if (!isYmd(f.startsOn)) return 'Add the date you bought it';
  const end = coverEndDate(f.startsOn, f);
  if (!end) return f.customBy === 'date' ? 'Pick the day cover ends' : 'Enter cover length in whole months (1–600)';
  if (end < f.startsOn) return 'Cover can’t end before you bought it';
  const price = f.price.trim();
  if (price && !(Number(price) >= 0)) return 'Price must be 0 or more';
  return null;
}

/** Cover choice for an existing warranty: a preset when the dates match one, else its end date. */
export function coverChoiceFor(startsOn: string, endsOn: string): CoverChoice {
  const preset = WARRANTY_LENGTHS.find((l) => warrantyEndDate(startsOn, l.months) === endsOn);
  return preset
    ? { cover: String(preset.months), customBy: 'months', customMonths: '', endsOn }
    : { cover: 'custom', customBy: 'date', customMonths: '', endsOn };
}
