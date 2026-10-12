/**
 * Axis helpers for the History chart.
 */
import { axisTickKey, type ChartResolution } from '../components/AssetLineChart';
import { isMoneyHidden, MONEY_MASK } from './privacy';

export function parseAt(at: string): number {
  const t = Date.parse(at.length === 7 ? `${at}-01T00:00:00` : at.length === 10 ? `${at}T00:00:00` : at);
  return Number.isFinite(t) ? t : 0;
}

export function axisLabel(at: string, resolution: ChartResolution): string {
  try {
    if (resolution === 'month') {
      const d = new Date(parseAt(at));
      return new Intl.DateTimeFormat('en-NZ', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(d);
    }
    return new Intl.DateTimeFormat('en-NZ', {
      timeZone: 'Pacific/Auckland',
      day: 'numeric',
      month: 'short',
    }).format(new Date(at.includes('T') || at.length > 10 ? at : `${at}T12:00:00+13:00`));
  } catch {
    return at.slice(0, 10);
  }
}

/**
 * A YYYY-MM bucket read as a UTC date. parseAt reads it as local midnight, which
 * in New Zealand is still the previous month in UTC.
 */
export function monthLabel(at: string, month: 'short' | 'long'): string {
  const [y, m] = at.slice(0, 7).split('-').map(Number);
  return new Intl.DateTimeFormat('en-NZ', { month, year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function compactNzd(n: number): string {
  if (isMoneyHidden()) return MONEY_MASK;
  return axisTickKey(n);
}
