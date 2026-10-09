/**
 * Warranty dates (KAN-61). Pure helpers shared by the API and the Warranties page.
 * Dates are YYYY-MM-DD in Pacific/Auckland.
 */
import { addCadence, daysBetween } from './recurring.ts';

/** Warranties ending within this many days are "expiring soon". */
export const EXPIRING_SOON_DAYS = 60;

export type WarrantyStatus = 'active' | 'expiring' | 'expired';

/** Common warranty lengths offered when adding one; "custom" means pick an end date. */
export const WARRANTY_LENGTHS = [
  { months: 6, label: '6 months' },
  { months: 12, label: '1 year' },
  { months: 24, label: '2 years' },
  { months: 36, label: '3 years' },
  { months: 60, label: '5 years' },
] as const;

/**
 * Last day of cover for a warranty that starts on `start` and runs `months` months:
 * the day before the same date `months` later (1 year from 9 Oct 2026 ends 8 Oct 2027).
 */
export function warrantyEndDate(start: string, months: number): string {
  const after = addCadence(start, 'monthly', months);
  const d = new Date(`${after}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Days of cover left counting today; 0 on the last day, negative once expired. */
export function daysLeft(endsOn: string, today: string): number {
  return daysBetween(today, endsOn);
}

export function warrantyStatus(endsOn: string, today: string, soonDays = EXPIRING_SOON_DAYS): WarrantyStatus {
  const left = daysLeft(endsOn, today);
  if (left < 0) return 'expired';
  return left <= soonDays ? 'expiring' : 'active';
}

/** Short text for the page: "Ends today", "12 days left", "Expired 3 days ago". */
export function daysLeftText(endsOn: string, today: string): string {
  const left = daysLeft(endsOn, today);
  if (left === 0) return 'Ends today';
  if (left === 1) return '1 day left';
  if (left > 1) return `${left} days left`;
  return left === -1 ? 'Expired yesterday' : `Expired ${-left} days ago`;
}
