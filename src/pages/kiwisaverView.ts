/**
 * KiwiSaver header and balance-card view rules.
 * Missing fields are omitted — nothing here is estimated.
 * Run: npm run test:kiwisaver
 */
import {
  aucklandDate,
  historyDelta,
  pointsInRange,
  rangeStart,
  shortDate,
  type HistoryPoint,
  type HistoryRange,
} from '../lib/netWorthHistory';

export type KiwiSaverHeaderSource = {
  name: string | null;
  /** Null on Akahu rows (`scheme_name` is not stored). */
  schemeName: string | null;
  provider: string | null;
  observedAt: string | null;
  pir: number | null;
};

export type KiwiSaverHeaderPart =
  | { kind: 'scheme'; text: string }
  | { kind: 'provider'; text: string }
  | { kind: 'synced'; text: string }
  | { kind: 'pir'; text: string };

/** Moved off the page into the ⓘ next to the sync time. */
export const KIWISAVER_READONLY_NOTE =
  'KiwiSaver via Akahu; synced provider data is read-only. Never scrape. Never store passwords.';

function present(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Scheme slot: stored scheme name when the provider sent one.
 * Akahu leaves `scheme_name` null, so the account name fills that slot.
 */
export function kiwiSaverSchemeLabel(source: {
  name: string | null;
  schemeName: string | null;
}): string | null {
  return present(source.schemeName) ?? present(source.name);
}

export function kiwiSaverPirLabel(pir: number | null): string | null {
  if (typeof pir !== 'number' || !Number.isFinite(pir)) return null;
  return `PIR ${pir}%`;
}

/** Parts of "[scheme] · [provider] · synced [time] · PIR [rate]", nulls dropped. */
export function kiwiSaverHeaderParts(
  source: KiwiSaverHeaderSource | null,
  formatTime: (iso: string) => string,
): KiwiSaverHeaderPart[] {
  if (!source) return [];
  const parts: KiwiSaverHeaderPart[] = [];
  const scheme = kiwiSaverSchemeLabel(source);
  if (scheme) parts.push({ kind: 'scheme', text: scheme });
  const provider = present(source.provider);
  if (provider) parts.push({ kind: 'provider', text: provider });
  const observedAt = present(source.observedAt);
  if (observedAt) {
    const formatted = formatTime(observedAt).trim();
    if (formatted && formatted !== '—') {
      parts.push({ kind: 'synced', text: `synced ${formatted}` });
    }
  }
  const pir = kiwiSaverPirLabel(source.pir);
  if (pir) parts.push({ kind: 'pir', text: pir });
  return parts;
}

export function kiwiSaverHeaderSubline(
  source: KiwiSaverHeaderSource | null,
  formatTime: (iso: string) => string,
): string {
  return kiwiSaverHeaderParts(source, formatTime)
    .map((part) => part.text)
    .join(' · ');
}

/** Same sentences the page used under the old intro, picked from real status. */
export function kiwiSaverSyncNote(input: {
  hasAkahuAccount: boolean;
  akahuConfigured: boolean | null;
}): string {
  if (input.hasAkahuAccount) {
    return 'Akahu KiwiSaver connected — auto-resync on open updates the connected provider account.';
  }
  if (input.akahuConfigured === true) {
    return 'Akahu configured — auto-resync on open updates Sharesies KS only. Bank-held schemes stay manual.';
  }
  if (input.akahuConfigured === false) {
    return 'Akahu not configured on the API server — Sharesies sync unavailable; bank-held manual/CSV still works.';
  }
  return 'Checking Akahu…';
}

/** Sync now is for an Akahu connection or an Akahu scheme, not a manual-only page. */
export function showKiwiSaverSyncButton(input: {
  hasAkahuScheme: boolean;
  akahuConnected: boolean;
}): boolean {
  return input.hasAkahuScheme || input.akahuConnected;
}

/** One scheme is shown directly. The picker is only for a choice. */
export function showKiwiSaverSchemePicker(schemeCount: number): boolean {
  return schemeCount > 1;
}

/** KiwiSaver chart ranges. 6M stays a dashboard range and is not offered here. */
export const KIWISAVER_HISTORY_RANGES = ['1M', '3M', '1Y', 'All'] as const;
export type KiwiSaverHistoryRange = (typeof KIWISAVER_HISTORY_RANGES)[number];

export type KiwiSaverHistoryInput = { at: string; balanceNzd: number };

/**
 * Auckland calendar day for a recorded point.
 * A YYYY-MM-DD key is already an Auckland day (Akahu sync). Timestamps are converted.
 */
export function kiwiSaverPointDate(at: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at;
  return aucklandDate(at);
}

/** One point per Auckland day, last recorded value that day. Missing days are left out. */
export function kiwiSaverHistoryPoints(points: KiwiSaverHistoryInput[]): HistoryPoint[] {
  const sorted = [...points].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const byDate = new Map<string, number>();
  for (const point of sorted) {
    const date = kiwiSaverPointDate(point.at);
    if (!date || !Number.isFinite(point.balanceNzd)) continue;
    byDate.set(date, point.balanceNzd);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, value]) => ({ date, value }));
}

function orderedPoints(points: HistoryPoint[]): HistoryPoint[] {
  return [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * A range toggle is shown only when the first recorded point is on or before
 * that range's start. All is shown whenever there is at least one point.
 */
export function kiwiSaverVisibleRanges(points: HistoryPoint[], today: string): KiwiSaverHistoryRange[] {
  if (points.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return [];
  const first = orderedPoints(points)[0].date;
  return KIWISAVER_HISTORY_RANGES.filter((range) => {
    const start = rangeStart(range, today);
    return start == null || first <= start;
  });
}

/**
 * Keep an explicit choice when that range is visible. Otherwise the shortest
 * visible range that actually contains a point (so a covered-but-empty 1M
 * does not open on a blank chart).
 */
export function kiwiSaverActiveRange(
  points: HistoryPoint[],
  visible: KiwiSaverHistoryRange[],
  selected: KiwiSaverHistoryRange | null,
  today: string,
): KiwiSaverHistoryRange {
  if (selected && visible.includes(selected)) return selected;
  const ordered = orderedPoints(points);
  for (const range of visible) {
    if (pointsInRange(ordered, range, today).length > 0) return range;
  }
  return 'All';
}

export type KiwiSaverChange = {
  /** Last point minus first point in the range. */
  amount: number;
  direction: 'up' | 'down' | 'flat';
  arrow: '▲' | '▼' | '■';
  /** Absolute amount, already formatted. The arrow carries the direction. */
  amountLabel: string;
  /** Auckland day of the first point in the range, YYYY-MM-DD. */
  since: string;
  sinceLabel: string;
  /** "▲ $10.00 since 1 Oct 2026" */
  text: string;
};

/** No line when the range has fewer than two real points. */
export function kiwiSaverChangeLine(
  points: HistoryPoint[],
  range: HistoryRange,
  today: string,
  formatMoney: (n: number) => string,
): KiwiSaverChange | null {
  const delta = historyDelta(pointsInRange(orderedPoints(points), range, today), range, today);
  if (!delta) return null;
  const direction = delta.amount > 0 ? 'up' : delta.amount < 0 ? 'down' : 'flat';
  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '■';
  const amountLabel = formatMoney(Math.abs(delta.amount));
  const sinceLabel = shortDate(delta.from);
  return {
    amount: delta.amount,
    direction,
    arrow,
    amountLabel,
    since: delta.from,
    sinceLabel,
    text: `${arrow} ${amountLabel} since ${sinceLabel}`,
  };
}

export type KiwiSaverSplit = {
  investedPct: number;
  returnsPct: number;
};

/**
 * Contributions vs growth as shares of the balance.
 * Omitted when either figure is missing, or when a share is negative
 * (a loss is not a portion of the balance).
 */
export function kiwiSaverSplit(
  balanceNzd: number,
  amountInvestedNzd: number | null,
  returnsNzd: number | null,
): KiwiSaverSplit | null {
  if (returnsNzd == null || amountInvestedNzd == null) return null;
  if (!Number.isFinite(balanceNzd) || balanceNzd <= 0) return null;
  if (!Number.isFinite(amountInvestedNzd) || !Number.isFinite(returnsNzd)) return null;
  if (amountInvestedNzd < 0 || returnsNzd < 0) return null;
  return {
    investedPct: (amountInvestedNzd / balanceNzd) * 100,
    returnsPct: (returnsNzd / balanceNzd) * 100,
  };
}

/** Whole-number labels. When the raw shares sum to 100, the labels do too. */
export function kiwiSaverSplitLabels(split: KiwiSaverSplit): { invested: number; returns: number } {
  const invested = Math.round(split.investedPct);
  const returns = Math.round(split.returnsPct);
  const rawSum = split.investedPct + split.returnsPct;
  if (Math.abs(rawSum - 100) > 0.05) return { invested, returns };
  if (invested + returns === 100) return { invested, returns };
  if (split.investedPct >= split.returnsPct) return { invested, returns: 100 - invested };
  return { invested: 100 - returns, returns };
}

/** Accessible name for one chart point: Auckland date and the exact recorded value. */
export function kiwiSaverPointAriaLabel(
  at: string,
  balanceNzd: number,
  formatValue: (n: number) => string,
): string | null {
  const date = kiwiSaverPointDate(at);
  if (!date || !Number.isFinite(balanceNzd)) return null;
  return `${shortDate(date)}, ${formatValue(balanceNzd)}`;
}
