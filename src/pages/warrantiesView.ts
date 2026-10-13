import { isYmd } from '../lib/invoiceCalc';
import { daysBetween } from '../lib/recurring';
import { WARRANTY_LENGTHS, daysLeft, warrantyEndDate, type WarrantyStatus } from '../lib/warranty';

/**
 * Warranties page view helpers. Header (phase 1): subtitle and status words.
 * Add form (phase 2): cover end date, the live cover line, and why Save is off.
 * Cards (phase 3): progress, the facts lines, sorting, and the status filter. Counts come from the list response.
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

type CardWarranty = {
  itemName: string;
  retailer: string;
  priceNzd: number | null;
  startsOn: string;
  endsOn: string;
  status: WarrantyStatus;
  receiptUrl: string | null;
  purchase: { receiptUrl: string | null } | null;
};

/** "Noel Leeming · $1,299.00", one of them, or "No store or price added". */
export function storePriceLine(w: Pick<CardWarranty, 'retailer' | 'priceNzd'>, money: (n: number) => string): string {
  const parts = [w.retailer.trim(), w.priceNzd != null ? money(w.priceNzd) : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No store or price added';
}

/**
 * "Bought 9 Oct 2026 · 11 months left · Ends 8 Oct 2027"; once ended,
 * "Bought 2 Mar 2024 · Ended 1 Mar 2025 · 591 days ago".
 */
export function datesLine(w: Pick<CardWarranty, 'startsOn' | 'endsOn'>, today: string): string {
  const left = daysLeft(w.endsOn, today);
  const bought = `Bought ${longDate(w.startsOn)}`;
  if (left < 0) return `${bought} · Ended ${longDate(w.endsOn)} · ${plural(-left, 'day')} ago`;
  if (left === 0) return `${bought} · Ends today, ${longDate(w.endsOn)}`;
  return `${bought} · ${timeLeftText(w.endsOn, today)} · Ends ${longDate(w.endsOn)}`;
}

/**
 * Days of cover used, counting both the first and last day: a 1-year warranty is
 * 365 days. Before cover starts nothing is used; after it ends all of it is.
 */
export function coverProgress(w: Pick<CardWarranty, 'startsOn' | 'endsOn'>, today: string): { used: number; total: number; percent: number; label: string } {
  const total = Math.max(1, daysBetween(w.startsOn, w.endsOn) + 1);
  const used = Math.min(total, Math.max(0, daysBetween(w.startsOn, today) + 1));
  return { used, total, percent: Math.round((used / total) * 1000) / 10, label: `${used} of ${total} days used` };
}

/** Soonest end date first; expired at the bottom, most recently ended first. */
export function sortWarranties<T extends Pick<CardWarranty, 'endsOn' | 'status' | 'itemName'>>(items: ReadonlyArray<T>): T[] {
  return [...items].sort((a, b) => {
    const ax = a.status === 'expired' ? 1 : 0;
    const bx = b.status === 'expired' ? 1 : 0;
    if (ax !== bx) return ax - bx;
    const byEnd = ax ? b.endsOn.localeCompare(a.endsOn) : a.endsOn.localeCompare(b.endsOn);
    return byEnd || a.itemName.localeCompare(b.itemName);
  });
}

export type WarrantyFilter = 'all' | WarrantyStatus;

/** Filter options with counts: "All 6", "Covered 3", "Ending soon 1", "Expired 2". */
export function filterOptions(items: ReadonlyArray<Pick<CardWarranty, 'status'>>): Array<{ value: WarrantyFilter; label: string }> {
  const count = (s: WarrantyStatus) => items.filter((i) => i.status === s).length;
  return [
    { value: 'all', label: `All ${items.length}` },
    { value: 'active', label: `${WARRANTY_STATUS_LABELS.active} ${count('active')}` },
    { value: 'expiring', label: `${WARRANTY_STATUS_LABELS.expiring} ${count('expiring')}` },
    { value: 'expired', label: `${WARRANTY_STATUS_LABELS.expired} ${count('expired')}` },
  ];
}

export function filterWarranties<T extends Pick<CardWarranty, 'status'>>(items: ReadonlyArray<T>, filter: WarrantyFilter): T[] {
  return filter === 'all' ? [...items] : items.filter((i) => i.status === filter);
}

/** "No warranties ending soon." for an empty filter. */
export function emptyFilterText(filter: Exclude<WarrantyFilter, 'all'>): string {
  return { active: 'No warranties covered for more than 60 days.', expiring: 'No warranties ending soon.', expired: 'No expired warranties.' }[filter];
}

/** The warranty's own receipt, else the linked purchase's. */
export function receiptFor(w: Pick<CardWarranty, 'receiptUrl' | 'purchase'>): string | null {
  return w.receiptUrl ?? w.purchase?.receiptUrl ?? null;
}
