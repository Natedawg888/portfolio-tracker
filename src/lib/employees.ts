/**
 * Business employees (KAN-84 follow-up). Pure helpers shared by the API and the business page:
 * pay rate and frequency labels, the next pay date rolled forward from the one entered, and the
 * bank account masked for lists. Records only: nothing is paid, and no PAYE is worked out here.
 */

export const PAY_UNITS = [
  { value: 'hour', label: 'an hour', short: '/hr' },
  { value: 'day', label: 'a day', short: '/day' },
  { value: 'week', label: 'a week', short: '/wk' },
  { value: 'fortnight', label: 'a fortnight', short: '/fn' },
  { value: 'month', label: 'a month', short: '/mth' },
  { value: 'year', label: 'a year', short: '/yr' },
] as const;
export type PayUnit = (typeof PAY_UNITS)[number]['value'];

export const PAY_FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'four_weekly', label: 'Every four weeks' },
  { value: 'monthly', label: 'Monthly' },
] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number]['value'];

export const isPayUnit = (v: unknown): v is PayUnit => typeof v === 'string' && PAY_UNITS.some((u) => u.value === v);
export const isPayFrequency = (v: unknown): v is PayFrequency => typeof v === 'string' && PAY_FREQUENCIES.some((f) => f.value === v);

export const payFrequencyLabel = (v: string) => PAY_FREQUENCIES.find((f) => f.value === v)?.label ?? 'Fortnightly';

/** "$28.50/hr", or "" with no rate. */
export function payRateText(rate: number | null, unit: string, money: (n: number) => string): string {
  if (rate == null) return '';
  return `${money(rate)}${PAY_UNITS.find((u) => u.value === unit)?.short ?? ''}`;
}

const DAY = 86_400_000;
const toTime = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const toYmd = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The same day next month, or the month's last day when it is shorter (31 Jan → 28 Feb). */
function addMonths(ymd: string, months: number, day: number): string {
  const [y, m] = ymd.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/**
 * The next pay day on or after today, from the pay date entered and how often they're paid.
 * A date still to come is returned as it is. Monthly pay keeps the entered day of the month.
 */
export function nextPayDate(entered: string | null, frequency: PayFrequency, today: string): string | null {
  if (!entered || !/^\d{4}-\d{2}-\d{2}$/.test(entered)) return null;
  if (entered >= today) return entered;
  if (frequency === 'monthly') {
    const day = Number(entered.slice(8, 10));
    let n = 1;
    let next = addMonths(entered, n, day);
    while (next < today) next = addMonths(entered, ++n, day);
    return next;
  }
  const step = (frequency === 'weekly' ? 7 : frequency === 'fortnightly' ? 14 : 28) * DAY;
  const behind = toTime(today) - toTime(entered);
  return toYmd(toTime(entered) + Math.ceil(behind / step) * step);
}

/** "12-••••-•••••23-00": bank and suffix stay readable, the rest is hidden. */
export function maskBankAccount(value: string): string {
  const parts = value.split('-');
  if (parts.length !== 4) return value ? '••••' : '';
  const [bank, branch, account, suffix] = parts;
  return `${bank}-${'•'.repeat(branch.length)}-${'•'.repeat(Math.max(0, account.length - 2))}${account.slice(-2)}-${suffix}`;
}
