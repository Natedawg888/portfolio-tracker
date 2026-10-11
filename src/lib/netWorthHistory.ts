/**
 * Net worth history for the Dashboard sparkline, from valuation_snapshots.
 *
 * One point per Pacific/Auckland day (the latest snapshot that day). "Accessible"
 * is total minus KiwiSaver, read from the snapshot's own class breakdown; a
 * snapshot without that breakdown has no accessible figure and is left out
 * rather than guessed.
 */

export type NetWorthView = 'total' | 'accessible';
export type HistoryRange = '1M' | '6M' | '1Y' | 'All';

export const HISTORY_RANGES: HistoryRange[] = ['1M', '6M', '1Y', 'All'];

export const NET_WORTH_VIEW_STORAGE_KEY = 'portfolio-tracker-net-worth-view';

export type SnapshotLike = {
  takenAt: string;
  totalNzd: number;
  breakdown?: { byClass?: Record<string, number | null> } | null;
};

export type HistoryPoint = {
  /** Auckland calendar day, YYYY-MM-DD. */
  date: string;
  value: number;
};

export function aucklandDate(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Total minus KiwiSaver. KiwiSaver null means none is held, so nothing is taken off. */
export function accessibleOf(totalNzd: number, kiwiSaverNzd: number | null | undefined): number {
  return totalNzd - (kiwiSaverNzd ?? 0);
}

function snapshotValue(s: SnapshotLike, view: NetWorthView): number | null {
  const total = Number(s.totalNzd);
  if (!Number.isFinite(total)) return null;
  if (view === 'total') return total;
  const byClass = s.breakdown?.byClass;
  if (!byClass || !('kiwiSaver' in byClass)) return null;
  const ks = byClass.kiwiSaver;
  if (ks != null && !Number.isFinite(Number(ks))) return null;
  return accessibleOf(total, ks == null ? null : Number(ks));
}

export function dailySeries(snapshots: SnapshotLike[], view: NetWorthView): HistoryPoint[] {
  const latest = new Map<string, { ms: number; value: number }>();
  for (const s of snapshots) {
    const date = aucklandDate(s.takenAt);
    const value = snapshotValue(s, view);
    if (!date || value == null) continue;
    const ms = Date.parse(s.takenAt);
    const prev = latest.get(date);
    if (!prev || ms >= prev.ms) latest.set(date, { ms, value });
  }
  return [...latest.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, { value }]) => ({ date, value }));
}

const RANGE_MONTHS: Record<Exclude<HistoryRange, 'All'>, number> = { '1M': 1, '6M': 6, '1Y': 12 };

/** First day of the range, YYYY-MM-DD, or null for All. Month ends clamp (31 Mar − 1M = 28/29 Feb). */
export function rangeStart(range: HistoryRange, today: string): string | null {
  if (range === 'All') return null;
  const [y, m, d] = today.split('-').map(Number);
  const months = y * 12 + (m - 1) - RANGE_MONTHS[range];
  const year = Math.floor(months / 12);
  const month = (months % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

export function pointsInRange(series: HistoryPoint[], range: HistoryRange, today: string): HistoryPoint[] {
  const start = rangeStart(range, today);
  return start == null ? series : series.filter((p) => p.date >= start);
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const RANGE_PHRASE: Record<Exclude<HistoryRange, 'All'>, string> = {
  '1M': 'since last month',
  '6M': 'over 6 months',
  '1Y': 'over the past year',
};

export type HistoryDelta = {
  amount: number;
  /** "since last month" when history reaches back that far, else "since 8 Oct". */
  phrase: string;
  from: string;
};

/**
 * Change from the first to the last point. The range phrase is only used when the
 * first point is within 3 days of the range start; otherwise the actual first date
 * is named, so a week of history never reads as "since last month".
 */
export function historyDelta(points: HistoryPoint[], range: HistoryRange, today: string): HistoryDelta | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const start = rangeStart(range, today);
  const phrase =
    range !== 'All' && start != null && Math.abs(dayDiff(start, first.date)) <= 3
      ? RANGE_PHRASE[range]
      : `since ${shortDate(first.date)}`;
  return { amount: last.value - first.value, phrase, from: first.date };
}

export function shortDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function readNetWorthView(): NetWorthView {
  try {
    return localStorage.getItem(NET_WORTH_VIEW_STORAGE_KEY) === 'accessible' ? 'accessible' : 'total';
  } catch {
    return 'total';
  }
}

export function saveNetWorthView(view: NetWorthView): void {
  try {
    localStorage.setItem(NET_WORTH_VIEW_STORAGE_KEY, view);
  } catch {
    /* private mode / blocked storage */
  }
}
