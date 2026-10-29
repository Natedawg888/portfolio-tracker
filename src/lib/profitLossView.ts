/**
 * Profit & loss page helpers (KAN-126): chart axis ticks and labels, and the period a custom
 * range asks for. Pure.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Oct' for '2026-10'. */
export const monthShort = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1];
/** 'Oct 2026' for '2026-10'. */
export const monthLong = (m: string) => `${monthShort(m)} ${m.slice(0, 4)}`;

/** $0, $950, $1k, $2.5k, $1.2m: axis labels only (values elsewhere are exact). */
export function compactNzd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}m`;
  if (n >= 1000) return `$${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k`;
  return `$${Math.round(n)}`;
}

/** A round axis top at or above `max`, in 1/2/2.5/5 × 10ⁿ steps (about four of them). */
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag;
  const top = Math.ceil(max / step - 1e-9) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step * 100) / 100);
}

/** A custom period is valid when both dates are set, in order, within three years. */
export function customPeriodError(from: string, to: string): string | null {
  if (!from || !to) return 'Pick both dates';
  if (to < from) return 'The end is before the start';
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 3 * 366) return 'Pick three years or less';
  return null;
}
