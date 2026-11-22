/**
 * Timeline page helpers (KAN-62): date ranges, grouping by day, labels.
 */
import type { TimelineEvent, TimelineType } from '../types';

export const TIMELINE_TYPE_LABEL: Record<TimelineType, string> = {
  bank: 'Money',
  crypto: 'Crypto',
  dividend: 'Dividends',
  milestone: 'Milestones',
};

export type TimelineRange = '30d' | '90d' | '1y' | 'all';

const ymd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });

/** from / to (YYYY-MM-DD, Auckland) for a range ending today. 'all' starts in 2000. */
export function timelineRange(range: TimelineRange, now: Date): { from: string; to: string } {
  const to = ymd(now);
  if (range === 'all') return { from: '2000-01-01', to };
  const days = range === '30d' ? 30 : range === '90d' ? 90 : 365;
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days);
  return { from: start.toISOString().slice(0, 10), to };
}

/** Events grouped by date, keeping the server's order (newest first). */
export function groupByDay(events: readonly TimelineEvent[]): { date: string; events: TimelineEvent[] }[] {
  const out: { date: string; events: TimelineEvent[] }[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && last.date === e.date) last.events.push(e);
    else out.push({ date: e.date, events: [e] });
  }
  return out;
}
