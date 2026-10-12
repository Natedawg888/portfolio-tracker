/**
 * KiwiSaver header, balance-card, holdings, and side-column view rules.
 * Missing fields are omitted or shown as —. Nothing here is estimated.
 * Holdings cost and return % are derived only when both recorded inputs exist
 * (balance − returns, then returns / cost). They are display-only, not stored.
 * Side-column cards only repeat figures the account or ledger already has.
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
import { formatSignedPct } from '../lib/portfolioView';

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

/** Recorded allocations within this of 100% are treated as a full bar (rounding). */
const ALLOCATION_TOLERANCE = 0.05;

export type KiwiSaverHoldingInput = {
  fundName: string;
  allocationPct?: number | null;
  balanceNzd?: number | null;
  returnsNzd?: number | null;
  shares?: number | null;
  symbol?: string | null;
  currency?: string | null;
  fundId?: string | null;
  logo?: string | null;
};

export type KiwiSaverHoldingRow = {
  key: string;
  name: string;
  ticker: string;
  symbol: string | null;
  allocationPct: number | null;
  allocationLabel: string;
  balanceNzd: number | null;
  returnsNzd: number | null;
  /** balance − returns, only when both were recorded. */
  costNzd: number | null;
  /** returns / cost × 100, only when cost > 0. */
  returnPct: number | null;
  shares: number | null;
  unitsLabel: string | null;
  currency: string | null;
  logo: string | null;
};

export type KiwiSaverHoldingFact = {
  label: string;
  text: string;
  tone: 'up' | 'down' | 'flat' | null;
};

export type KiwiSaverAllocationSegment = {
  key: string;
  name: string;
  /** Recorded percent. Not renormalised to the mix. */
  pct: number;
  label: string;
};

export type KiwiSaverAllocationView =
  | {
      kind: 'bar';
      segments: KiwiSaverAllocationSegment[];
      gapPct: number | null;
      gapLabel: string | null;
    }
  | { kind: 'overflow'; sum: number; sumLabel: string }
  | { kind: 'none' };

export type KiwiSaverHoldingGap = 'allocation' | 'balance';

function finiteNumber(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

/** "60%", "17.5%", "—". The recorded figure, rounded to cents of a percent. */
export function kiwiSaverAllocationLabel(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  const rounded = Math.round(pct * 100) / 100;
  if (Object.is(rounded, -0) || rounded === 0) return '0%';
  if (Number.isInteger(rounded)) return `${rounded}%`;
  return `${rounded.toFixed(2).replace(/0$/, '')}%`;
}

/** Icon letters: ticker after the last dot, else the first four letters of the name. */
export function kiwiSaverHoldingTicker(fund: {
  symbol?: string | null;
  fundName?: string | null;
}): string {
  const symbol = present(fund.symbol);
  if (symbol) {
    const parts = symbol.split('.');
    return parts[parts.length - 1] || symbol;
  }
  const name = present(fund.fundName);
  return (name ?? '?').slice(0, 4).toUpperCase();
}

/** Units the provider recorded. Null when the figure was not sent. */
export function kiwiSaverUnitsLabel(shares: number | null | undefined): string | null {
  if (typeof shares !== 'number' || !Number.isFinite(shares)) return null;
  const rounded = Math.round(shares * 10000) / 10000;
  const negative = rounded < 0;
  const [whole, frac] = Math.abs(rounded).toString().split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = frac ? `${withCommas}.${frac}` : withCommas;
  return negative ? `-${body}` : body;
}

/**
 * Cost basis from two recorded figures. Missing either one stays null —
 * the balance alone is not a cost.
 */
export function kiwiSaverHoldingCost(
  balanceNzd: number | null | undefined,
  returnsNzd: number | null | undefined,
): number | null {
  const balance = finiteNumber(balanceNzd);
  const returns = finiteNumber(returnsNzd);
  if (balance == null || returns == null) return null;
  return Math.round((balance - returns) * 100) / 100;
}

/** Percent only when a positive cost was derived. A missing cost is not zero. */
export function kiwiSaverHoldingReturnPct(
  costNzd: number | null,
  returnsNzd: number | null,
): number | null {
  if (costNzd == null || returnsNzd == null) return null;
  if (!Number.isFinite(costNzd) || !Number.isFinite(returnsNzd) || costNzd <= 0) return null;
  return (returnsNzd / costNzd) * 100;
}

/** Positive amounts get a plus. Zero and negative are left to the money formatter. */
export function kiwiSaverSignedMoney(n: number, formatMoney: (n: number) => string): string {
  if (!Number.isFinite(n)) return '—';
  if (n > 0) return `+${formatMoney(n)}`;
  return formatMoney(n);
}

function toneOf(n: number | null): 'up' | 'down' | 'flat' | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (n > 0) return 'up';
  if (n < 0) return 'down';
  return 'flat';
}

export function kiwiSaverHoldingRows(funds: KiwiSaverHoldingInput[]): KiwiSaverHoldingRow[] {
  const rows: KiwiSaverHoldingRow[] = [];
  funds.forEach((fund, index) => {
    const name = present(fund.fundName);
    if (!name) return;
    const allocationPct = finiteNumber(fund.allocationPct);
    const balanceNzd = finiteNumber(fund.balanceNzd);
    const returnsNzd = finiteNumber(fund.returnsNzd);
    const shares = finiteNumber(fund.shares);
    const costNzd = kiwiSaverHoldingCost(balanceNzd, returnsNzd);
    const symbol = present(fund.symbol);
    const fundId = present(fund.fundId);
    const currency = present(fund.currency);
    const keyBase = fundId ? `id:${fundId}` : symbol ? `sym:${symbol}` : `name:${name}`;
    rows.push({
      key: `${keyBase}:${index}`,
      name,
      ticker: kiwiSaverHoldingTicker(fund),
      symbol,
      allocationPct,
      allocationLabel: kiwiSaverAllocationLabel(allocationPct),
      balanceNzd,
      returnsNzd,
      costNzd,
      returnPct: kiwiSaverHoldingReturnPct(costNzd, returnsNzd),
      shares,
      unitsLabel: kiwiSaverUnitsLabel(shares),
      currency,
      logo: present(fund.logo),
    });
  });
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const allocA = a.row.allocationPct ?? Number.NEGATIVE_INFINITY;
      const allocB = b.row.allocationPct ?? Number.NEGATIVE_INFINITY;
      if (allocA !== allocB) return allocB - allocA;
      const balA = a.row.balanceNzd ?? Number.NEGATIVE_INFINITY;
      const balB = b.row.balanceNzd ?? Number.NEGATIVE_INFINITY;
      if (balA !== balB) return balB - balA;
      const byName = a.row.name.localeCompare(b.row.name);
      if (byName !== 0) return byName;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

/**
 * Bar from recorded allocation percents only.
 * Balances are never turned into a percent. A remainder is "Not recorded",
 * not a guessed fund. Percents that do not fit in 0–100 stay off the bar.
 */
export function kiwiSaverAllocationView(rows: KiwiSaverHoldingRow[]): KiwiSaverAllocationView {
  const eligible = rows.filter((row) => row.allocationPct != null && row.allocationPct >= 0);
  if (!eligible.some((row) => (row.allocationPct as number) > 0)) return { kind: 'none' };
  const sum = eligible.reduce((total, row) => total + (row.allocationPct as number), 0);
  const overflows =
    sum > 100 + ALLOCATION_TOLERANCE ||
    eligible.some((row) => (row.allocationPct as number) > 100 + ALLOCATION_TOLERANCE);
  if (overflows) return { kind: 'overflow', sum, sumLabel: kiwiSaverAllocationLabel(sum) };
  const segments = eligible.map((row) => ({
    key: row.key,
    name: row.name,
    pct: row.allocationPct as number,
    label: row.allocationLabel,
  }));
  const gap = 100 - sum;
  const hasGap = gap > ALLOCATION_TOLERANCE;
  return {
    kind: 'bar',
    segments,
    gapPct: hasGap ? gap : null,
    gapLabel: hasGap ? `Not recorded ${kiwiSaverAllocationLabel(gap)}` : null,
  };
}

/** The Return column exists only when some holding has a recorded return. */
export function kiwiSaverHoldingsShowReturns(rows: Array<{ returnsNzd: number | null }>): boolean {
  return rows.some((row) => row.returnsNzd != null);
}

/**
 * Compact-row return: the percent when cost was derived, otherwise the
 * recorded dollar return. "—" when this holding has no recorded return.
 */
export function kiwiSaverHoldingReturnLabel(
  row: { returnsNzd: number | null; returnPct: number | null },
  formatMoney: (n: number) => string,
): { text: string; tone: 'up' | 'down' | 'flat' | null } {
  if (row.returnPct != null && Number.isFinite(row.returnPct)) {
    return { text: formatSignedPct(row.returnPct), tone: toneOf(row.returnPct) };
  }
  if (row.returnsNzd != null && Number.isFinite(row.returnsNzd)) {
    return { text: kiwiSaverSignedMoney(row.returnsNzd, formatMoney), tone: toneOf(row.returnsNzd) };
  }
  return { text: '—', tone: null };
}

/** Expanded facts. Missing recorded figures are —. Currency is only shown when it is not NZD. */
export function kiwiSaverHoldingFacts(
  row: {
    symbol: string | null;
    unitsLabel: string | null;
    costNzd: number | null;
    returnsNzd: number | null;
    returnPct: number | null;
    currency: string | null;
  },
  formatMoney: (n: number) => string,
): KiwiSaverHoldingFact[] {
  const facts: KiwiSaverHoldingFact[] = [
    { label: 'Symbol', text: row.symbol ?? '—', tone: null },
    { label: 'Units', text: row.unitsLabel ?? '—', tone: null },
    { label: 'Cost', text: row.costNzd == null ? '—' : formatMoney(row.costNzd), tone: null },
    {
      label: 'Returns',
      text: row.returnsNzd == null ? '—' : kiwiSaverSignedMoney(row.returnsNzd, formatMoney),
      tone: toneOf(row.returnsNzd),
    },
    {
      label: 'Return',
      text: row.returnPct == null ? '—' : formatSignedPct(row.returnPct),
      tone: toneOf(row.returnPct),
    },
  ];
  const currency = row.currency?.trim().toUpperCase() ?? '';
  if (currency && currency !== 'NZD') facts.push({ label: 'Currency', text: currency, tone: null });
  return facts;
}

/**
 * Add prompts only for a manual/CSV scheme, and only for allocation or value,
 * which the existing fund-mix form can record. Read-only provider rows stay —.
 */
export function kiwiSaverHoldingGaps(
  row: { allocationPct: number | null; balanceNzd: number | null },
  editable: boolean,
): KiwiSaverHoldingGap[] {
  if (!editable) return [];
  const gaps: KiwiSaverHoldingGap[] = [];
  if (row.allocationPct == null) gaps.push('allocation');
  if (row.balanceNzd == null) gaps.push('balance');
  return gaps;
}

export function kiwiSaverHoldingsEmpty(input: {
  hasScheme: boolean;
  dataSource: 'akahu' | 'manual' | 'csv' | 'other' | null;
}): { message: string; offerAdd: boolean } {
  if (!input.hasScheme) return { message: 'Select a scheme to see holdings.', offerAdd: false };
  if (input.dataSource === 'akahu') return { message: 'No fund mix from Akahu yet.', offerAdd: false };
  if (input.dataSource === 'manual' || input.dataSource === 'csv') {
    return { message: 'No fund mix recorded.', offerAdd: true };
  }
  return { message: 'No fund mix recorded.', offerAdd: false };
}

/** Shown when no scheme is selected. Not a dollar estimate. */
export const KIWISAVER_GOVERNMENT_UNAVAILABLE =
  'Government contribution is not tracked as a separate field. Nothing here is estimated.';

const NO_LEDGER_NOTE = 'No contribution rows were recorded.';

export type KiwiSaverSideAddId = 'invested' | 'scheme' | 'provider' | 'pir' | 'observed';

export type KiwiSaverSideFact = {
  key: string;
  label: string;
  text: string;
  tone: 'up' | 'down' | 'flat' | null;
  wide: boolean;
};

export type KiwiSaverSideCard = {
  id: 'contributions' | 'government' | 'scheme' | 'sync';
  title: string;
  tipLabel: string;
  /** Long copy for the ⓘ. Null when there is nothing further to say. */
  tip: string | null;
  value: string;
  valueTone: 'up' | 'down' | 'flat' | null;
  /** Word beside the value. Colour is never the only signal. */
  status: string | null;
  summary: string | null;
  /** Null when the card has nothing to expand. */
  expanderLabel: string | null;
  details: KiwiSaverSideFact[];
  adds: Array<{ id: KiwiSaverSideAddId; label: string }>;
};

export type KiwiSaverSideAccount = {
  name: string | null;
  schemeName: string | null;
  provider: string | null;
  pir: number | null;
  dataSource: 'akahu' | 'manual' | 'csv' | 'other' | null;
  dataSourceLabel: string | null;
  notes: string | null;
  observedAt: string | null;
  amountInvestedNzd: number | null;
  activityStatus: string | null;
  activityNote: string | null;
  governmentContributionNzd: number | null;
  governmentContributionStatus: string | null;
  governmentContributionNote: string | null;
};

export type KiwiSaverSideActivityItem = {
  id?: string | null;
  date: string;
  description?: string | null;
  amountNzd: number;
  txnType?: string | null;
};

export type KiwiSaverSideInput = {
  account: KiwiSaverSideAccount | null;
  /** True only while the scheme list itself is still loading. */
  accountPending: boolean;
  activity: {
    /** False while the ledger for this scheme has not come back yet. */
    loaded: boolean;
    status: string | null;
    note: string | null;
    items: KiwiSaverSideActivityItem[];
  };
  /** Manual/CSV entry is open. Read-only provider rows stay without Add. */
  editable: boolean;
  syncing: boolean;
  hasAkahuAccount: boolean;
  akahuConfigured: boolean | null;
};

function noteText(value: string | null | undefined): string | null {
  return present(value);
}

function activityDateLabel(date: string): string {
  const trimmed = date.trim();
  const day = kiwiSaverPointDate(trimmed);
  if (day) return shortDate(day);
  return trimmed || '—';
}

function recordedActivity(items: KiwiSaverSideActivityItem[]): KiwiSaverSideActivityItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => Number.isFinite(item.amountNzd))
    .sort((a, b) => {
      const aKey = kiwiSaverPointDate(a.item.date.trim()) ?? '';
      const bKey = kiwiSaverPointDate(b.item.date.trim()) ?? '';
      if (aKey !== bKey) return aKey < bKey ? 1 : -1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

function contributionStatus(status: string | null): string {
  if (status === 'empty' || status === 'ok') return 'None recorded';
  if (status === 'unavailable') return 'Unavailable';
  return 'Not recorded';
}

function formattedWhen(
  iso: string | null | undefined,
  formatTime: (iso: string) => string,
): string | null {
  const raw = present(iso);
  if (!raw) return null;
  const formatted = formatTime(raw).trim();
  if (!formatted || formatted === '—') return null;
  return formatted;
}

function contributionsCard(
  input: KiwiSaverSideInput,
  formatMoney: (n: number) => string,
): KiwiSaverSideCard {
  const base = {
    id: 'contributions' as const,
    title: 'Contributions',
    tipLabel: 'About contributions',
    valueTone: null,
    expanderLabel: null,
    details: [] as KiwiSaverSideFact[],
    adds: [] as KiwiSaverSideCard['adds'],
  };
  if (!input.activity.loaded) {
    return { ...base, tip: null, value: '—', status: 'Checking', summary: null };
  }
  const items = recordedActivity(input.activity.items);
  const note = noteText(input.activity.note) ?? noteText(input.account?.activityNote);
  if (items.length > 0) {
    const latest = items[0];
    const dateLabel = activityDateLabel(latest.date);
    const details = items.map((item, index) => {
      const description = present(item.description);
      const txn = present(item.txnType);
      const amount = kiwiSaverSignedMoney(item.amountNzd, formatMoney);
      const text = [description, txn && txn !== description ? txn : null, amount]
        .filter((part): part is string => part != null)
        .join(' · ');
      return {
        key: present(item.id) ?? `${item.date}:${index}`,
        label: activityDateLabel(item.date),
        text,
        tone: toneOf(item.amountNzd),
        wide: true,
      };
    });
    return {
      ...base,
      tip: note,
      value: kiwiSaverSignedMoney(latest.amountNzd, formatMoney),
      valueTone: toneOf(latest.amountNzd),
      status: 'Latest',
      summary: dateLabel === '—' ? `${items.length} recorded` : `${items.length} recorded · ${dateLabel}`,
      expanderLabel: 'Details',
      details,
    };
  }
  const invested = finiteNumber(input.account?.amountInvestedNzd);
  if (invested != null) {
    return {
      ...base,
      tip: note ?? NO_LEDGER_NOTE,
      value: formatMoney(invested),
      status: "You've put in",
      summary: null,
    };
  }
  return {
    ...base,
    tip: note,
    value: '—',
    status: contributionStatus(input.activity.status ?? input.account?.activityStatus ?? null),
    summary: null,
    adds:
      input.editable
        ? [{ id: 'invested', label: 'Add amount invested' }]
        : [],
  };
}

function governmentCard(
  input: KiwiSaverSideInput,
  formatMoney: (n: number) => string,
): KiwiSaverSideCard {
  const account = input.account;
  const note = noteText(account?.governmentContributionNote) ?? KIWISAVER_GOVERNMENT_UNAVAILABLE;
  const amount = finiteNumber(account?.governmentContributionNzd);
  const base = {
    id: 'government' as const,
    title: 'Government contribution',
    tipLabel: 'About the government contribution',
    tip: note,
    valueTone: null,
    summary: null,
    expanderLabel: null,
    details: [] as KiwiSaverSideFact[],
    adds: [] as KiwiSaverSideCard['adds'],
  };
  if (input.accountPending && !account) {
    return { ...base, tip: null, value: '—', status: 'Checking' };
  }
  if (amount != null) {
    return { ...base, value: formatMoney(amount), status: 'Recorded' };
  }
  const status = present(account?.governmentContributionStatus);
  return {
    ...base,
    value: '—',
    status: status === 'unavailable' || status == null ? 'Unavailable' : 'Not recorded',
  };
}

function schemeCard(input: KiwiSaverSideInput): KiwiSaverSideCard {
  const base = {
    id: 'scheme' as const,
    title: 'Scheme',
    tipLabel: 'About this scheme',
    tip: null,
    valueTone: null,
    expanderLabel: null,
    details: [] as KiwiSaverSideFact[],
    adds: [] as KiwiSaverSideCard['adds'],
  };
  if (input.accountPending && !input.account) {
    return { ...base, value: '—', status: 'Checking', summary: null };
  }
  const account = input.account;
  if (!account) {
    return {
      ...base,
      value: '—',
      status: 'Not recorded',
      summary: null,
      adds: input.editable
        ? [
            { id: 'scheme', label: 'Add scheme' },
            { id: 'provider', label: 'Add provider' },
            { id: 'pir', label: 'Add PIR' },
          ]
        : [],
    };
  }
  const scheme = kiwiSaverSchemeLabel(account);
  const storedScheme = present(account.schemeName);
  const provider = present(account.provider);
  const pir = kiwiSaverPirLabel(account.pir);
  const summaryParts: string[] = [];
  if (!provider) summaryParts.push('Provider —');
  else if (provider.toLowerCase() !== (scheme ?? '').toLowerCase()) summaryParts.push(provider);
  summaryParts.push(pir ?? 'PIR —');
  const notes = noteText(account.notes);
  const adds: KiwiSaverSideCard['adds'] = [];
  if (input.editable && !storedScheme) adds.push({ id: 'scheme', label: 'Add scheme' });
  if (input.editable && !provider) adds.push({ id: 'provider', label: 'Add provider' });
  if (input.editable && !pir) adds.push({ id: 'pir', label: 'Add PIR' });
  const source = present(account.dataSourceLabel);
  return {
    ...base,
    value: scheme ?? '—',
    status: source,
    summary: summaryParts.join(' · '),
    expanderLabel: notes ? 'Notes' : null,
    details: notes ? [{ key: 'notes', label: 'Notes', text: notes, tone: null, wide: true }] : [],
    adds,
  };
}

function syncCard(
  input: KiwiSaverSideInput,
  formatTime: (iso: string) => string,
): KiwiSaverSideCard {
  const tip = `${KIWISAVER_READONLY_NOTE} ${kiwiSaverSyncNote({
    hasAkahuAccount: input.hasAkahuAccount,
    akahuConfigured: input.akahuConfigured,
  })}`;
  const base = {
    id: 'sync' as const,
    title: 'Sync',
    tipLabel: 'About KiwiSaver sync',
    tip,
    valueTone: null,
    expanderLabel: null,
    details: [] as KiwiSaverSideFact[],
    adds: [] as KiwiSaverSideCard['adds'],
  };
  if (input.syncing) {
    return { ...base, value: 'Syncing…', status: 'In progress', summary: null };
  }
  const account = input.account;
  if (input.accountPending && !account && input.akahuConfigured === null) {
    return { ...base, value: '—', status: 'Checking', summary: null };
  }
  const when = formattedWhen(account?.observedAt, formatTime);
  const source = present(account?.dataSourceLabel);
  if (when) {
    const value =
      account?.dataSource === 'akahu'
        ? 'Synced'
        : account?.dataSource === 'manual' || account?.dataSource === 'csv'
          ? 'Saved'
          : 'Recorded';
    return { ...base, value, status: source, summary: when };
  }
  return {
    ...base,
    value: '—',
    status: 'Not recorded',
    summary: source,
    adds: input.editable ? [{ id: 'observed', label: 'Add date' }] : [],
  };
}

/**
 * Compact side-column cards. Long notes stay in `tip` or `details`.
 * Add is offered only for a manual/CSV scheme, and only for a fact the form records.
 * A missing figure is —. Government contribution is never estimated.
 */
export function kiwiSaverSideCards(
  input: KiwiSaverSideInput,
  formatMoney: (n: number) => string,
  formatTime: (iso: string) => string,
): KiwiSaverSideCard[] {
  return [
    contributionsCard(input, formatMoney),
    governmentCard(input, formatMoney),
    schemeCard(input),
    syncCard(input, formatTime),
  ];
}
