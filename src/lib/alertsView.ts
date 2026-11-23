/**
 * Alerts page helpers (KAN-64).
 */
import type { AlertItem } from '../types';

export const ALERT_KIND_LABEL: Record<AlertItem['kind'], string> = {
  overspend: 'Budget',
  bill_due: 'Bill',
  goal: 'Goal',
  unusual: 'Spending',
};

/** "just now", "3 h ago", "2 days ago", or the date. */
export function alertAge(iso: string, now: Date): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now';
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.floor(ms / 60_000)} min ago`;
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return iso.slice(0, 10);
}
