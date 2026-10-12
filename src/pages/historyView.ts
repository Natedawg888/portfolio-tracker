/**
 * History page view rules. Figures come from stored snapshots and the live
 * holdings list. Nothing here invents a balance or rewrites a snapshot.
 */

/** A stored non-positive quantity. Null and blank are "not recorded", not closed. */
export function isStoredNonPositive(qty: unknown): boolean {
  if (qty == null || qty === '') return false;
  const n = typeof qty === 'number' ? qty : typeof qty === 'string' ? Number(qty) : Number.NaN;
  return Number.isFinite(n) && n <= 0;
}

export function historySnapshotCaption(count: number): string {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const noun = n === 1 ? 'snapshot' : 'snapshots';
  return `${n} ${noun} · from real snapshots only`;
}

export type HistoryYearChange = {
  /** Last stored total minus the first. The sign is the direction. */
  amount: number;
  direction: 'up' | 'down' | 'flat';
};

/**
 * Change from the first total to the last. `totals` is the year's snapshots in
 * taken-at order. Fewer than two finite ends has no change to show.
 */
export function historyYearChange(totals: number[]): HistoryYearChange | null {
  if (totals.length < 2) return null;
  const first = totals[0];
  const last = totals[totals.length - 1];
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  const amount = last - first;
  const direction = amount > 0 ? 'up' : amount < 0 ? 'down' : 'flat';
  return { amount, direction };
}

export type SnapshotHoldingValue = {
  id: string;
  label?: string;
  valueNzd: number;
};

export type LiveHoldingQuantity = {
  id: string;
  assetClass?: string;
  symbol?: string | null;
  name?: string | null;
  shares?: number | null;
  amount?: number | null;
  costBasisNzd?: number | null;
};

export type CostAtCloseMatch = {
  holdingId: string;
  label: string;
  valueNzd: number;
  costNzd: number;
};

const ONE_CENT = 0.01;

function closedQuantity(live: LiveHoldingQuantity): unknown {
  if (live.assetClass === 'crypto') return live.amount;
  return live.shares;
}

function matchLabel(snapshot: SnapshotHoldingValue, live: LiveHoldingQuantity): string {
  const label = snapshot.label?.trim();
  if (label) return label;
  const symbol = live.symbol?.trim();
  if (symbol) return symbol;
  const name = live.name?.trim();
  if (name) return name;
  return snapshot.id;
}

/**
 * Snapshot holding lines whose stored value is the live cost of a closed position.
 * A position is closed only when its quantity was stored and is not positive.
 * A null share count stays off this list (that holding is still a cost-basis line).
 * The returned value is the stored snapshot value, not a replacement.
 */
export function closedAtCostMatches(
  snapshotHoldings: SnapshotHoldingValue[],
  liveHoldings: LiveHoldingQuantity[],
): CostAtCloseMatch[] {
  const liveById = new Map(liveHoldings.map((h) => [h.id, h]));
  const matches: CostAtCloseMatch[] = [];
  for (const holding of snapshotHoldings) {
    const live = liveById.get(holding.id);
    if (!live || !isStoredNonPositive(closedQuantity(live))) continue;
    const cost = live.costBasisNzd;
    const value = Number(holding.valueNzd);
    if (cost == null || !Number.isFinite(cost) || cost <= 0 || !Number.isFinite(value)) continue;
    if (Math.abs(value - cost) > ONE_CENT) continue;
    matches.push({
      holdingId: holding.id,
      label: matchLabel(holding, live),
      valueNzd: value,
      costNzd: cost,
    });
  }
  return matches;
}

function uniqueLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of labels) {
    const trimmed = label.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function listLabels(labels: string[]): string {
  if (labels.length <= 3) return labels.join(', ');
  return `${labels.slice(0, 3).join(', ')} +${labels.length - 3} more`;
}

/** Clause for one snapshot. Null when nothing on it was valued at a closed cost. */
export function costFlagClause(labels: string[]): string | null {
  const unique = uniqueLabels(labels);
  if (unique.length === 0) return null;
  return `${listLabels(unique)} valued at cost. Stored value unchanged.`;
}

/** One line under the chart. Names come from the matches; the totals stay stored. */
export function costFlagChartNote(labels: string[]): string | null {
  const unique = uniqueLabels(labels);
  if (unique.length === 0) return null;
  return `${listLabels(unique)} valued at cost on a stored snapshot. Marked points keep that stored total.`;
}

export type CostFlagIndex = {
  /** takenAt → clause for that snapshot. */
  byTakenAt: Map<string, string>;
  labels: string[];
};

export function costFlagIndex(
  snapshots: Array<{ takenAt: string; holdings?: SnapshotHoldingValue[] | null }>,
  liveHoldings: LiveHoldingQuantity[],
): CostFlagIndex {
  const byTakenAt = new Map<string, string>();
  const labels: string[] = [];
  for (const snapshot of snapshots) {
    const matches = closedAtCostMatches(snapshot.holdings ?? [], liveHoldings);
    for (const match of matches) labels.push(match.label);
    const clause = costFlagClause(matches.map((match) => match.label));
    if (clause) byTakenAt.set(snapshot.takenAt, clause);
  }
  return { byTakenAt, labels: uniqueLabels(labels) };
}

export type SnapshotChartPoint = {
  at: string;
  value: number;
  flagged?: boolean;
  flagNote?: string;
  /** Original snapshot time, so a bucketed point can still name that reading. */
  takenAt?: string;
};

/** Chart point for one stored snapshot value. The number is copied through. */
export function snapshotPoint(takenAt: string, value: number, flagNote: string | null): SnapshotChartPoint {
  if (!flagNote) return { at: takenAt, value };
  return { at: takenAt, value, flagged: true, flagNote, takenAt };
}

export type HistoryPointResolution = 'day' | 'month';

/** Auckland date, plus the clock when `at` is a real timestamp. A bucket key stays a date, with no clock. */
export function historyPointWhen(at: string, resolution: HistoryPointResolution = 'day'): string | null {
  if (resolution === 'month' || /^\d{4}-\d{2}$/.test(at)) {
    const month = at.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return null;
    const d = new Date(`${month}-01T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('en-NZ', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(d);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) {
    const d = new Date(`${at}T12:00:00+13:00`);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('en-NZ', {
      timeZone: 'Pacific/Auckland',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(d);
  }
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

/**
 * Accessible name for a chart point. Null when the time or value cannot be read.
 * `flagClause` is appended only when this point's snapshot matched a closed cost.
 */
export function historyPointAriaLabel(
  at: string,
  value: number,
  formatValue: (n: number) => string,
  seriesLabel: string,
  flagClause: string | null,
  resolution: HistoryPointResolution = 'day',
): string | null {
  if (!Number.isFinite(value)) return null;
  const when = historyPointWhen(at, resolution);
  if (!when) return null;
  const base = `${seriesLabel}, ${when}, ${formatValue(value)}`;
  return flagClause ? `${base}. ${flagClause}` : base;
}
