/**
 * In-memory stale-while-revalidate cache for page API payloads.
 *
 * Financial figures stay in memory only. The cache is scoped to the signed-in
 * user and is cleared on sign-out, on a 401, and whenever the user id changes.
 * Responses are raw API data so money masking still happens at render time.
 *
 * A small module is enough here: pages already own their fetch and render, and
 * a query library would replace that rather than wrap it.
 */

export type PageReadStamp = {
  storageKey: string;
  token: number;
  epoch: number;
  id: number;
};

type Entry = {
  data: unknown;
  token: number;
};

let activeUserId: string | null = null;
let userEpoch = 0;
let readSeq = 0;
const entries = new Map<string, Entry>();
const tokens = new Map<string, number>();
const latestRead = new Map<string, number>();
/** Highest read id that has stored data for this key. Older results must not replace it. */
const committedRead = new Map<string, number>();
/** Reads that have begun and not yet committed or been abandoned. */
const inflight = new Map<string, number>();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

/** Re-render when a commit, invalidation, or clear changes what readPageCache returns. */
export function subscribePageCache(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function storageKey(logicalKey: string): string {
  return `${userEpoch}:${logicalKey}`;
}

function logicalKey(stored: string): string | null {
  const prefix = `${userEpoch}:`;
  if (!stored.startsWith(prefix)) return null;
  return stored.slice(prefix.length);
}

/** Drop every entry and reject in-flight writes. Call on sign-out and 401. */
export function clearPageCache(): void {
  userEpoch += 1;
  entries.clear();
  tokens.clear();
  latestRead.clear();
  committedRead.clear();
  inflight.clear();
  emit();
}

/**
 * Bind the cache to the signed-in user. A different id drops the previous
 * user's entries before the next paint can read them.
 */
export function syncPageCacheUser(userId: string | null): void {
  if (activeUserId === userId) return;
  activeUserId = userId;
  clearPageCache();
}

export function readPageCache<T>(key: string): T | undefined {
  const entry = entries.get(storageKey(key));
  if (!entry) return undefined;
  return entry.data as T;
}

function endInflight(stamp: PageReadStamp): void {
  if (stamp.epoch !== userEpoch) return;
  const n = inflight.get(stamp.storageKey) ?? 0;
  if (n <= 1) inflight.delete(stamp.storageKey);
  else inflight.set(stamp.storageKey, n - 1);
}

/** Capture a stamp before an await so a later invalidation can ignore the result. */
export function beginPageRead(key: string): PageReadStamp {
  const stored = storageKey(key);
  const id = ++readSeq;
  latestRead.set(stored, id);
  inflight.set(stored, (inflight.get(stored) ?? 0) + 1);
  return {
    storageKey: stored,
    token: tokens.get(stored) ?? 0,
    epoch: userEpoch,
    id,
  };
}

/**
 * Store data when this read has not been invalidated and no newer read has
 * already stored. A slower read still fills an empty slot after the page
 * unmounts or a return visit starts another read. Only the newest read
 * returns true, so an older caller does not treat itself as the active one.
 * Empty payloads are stored; a miss is a missing entry, not an empty list.
 */
export function commitPageRead<T>(stamp: PageReadStamp, data: T): boolean {
  endInflight(stamp);
  if (stamp.epoch !== userEpoch) return false;
  if ((tokens.get(stamp.storageKey) ?? 0) !== stamp.token) return false;
  const storedId = committedRead.get(stamp.storageKey) ?? 0;
  if (stamp.id < storedId) return false;
  entries.set(stamp.storageKey, { data, token: stamp.token });
  committedRead.set(stamp.storageKey, stamp.id);
  emit();
  return latestRead.get(stamp.storageKey) === stamp.id;
}

/** The read failed or was dropped. Lets a later synchronous write proceed. */
export function abandonPageRead(stamp: PageReadStamp): void {
  endInflight(stamp);
}

/**
 * Synchronous write after the caller already holds fresh data.
 * Skipped while a read for this key is still running, so it cannot replace
 * that read's result or cancel its commit.
 */
export function writePageCache<T>(key: string, data: T): boolean {
  if ((inflight.get(storageKey(key)) ?? 0) > 0) return false;
  return commitPageRead(beginPageRead(key), data);
}

export function invalidatePageCache(match: (logicalKey: string) => boolean): void {
  const prefix = `${userEpoch}:`;
  for (const stored of [...entries.keys(), ...tokens.keys(), ...latestRead.keys()]) {
    if (!stored.startsWith(prefix)) continue;
    const logical = logicalKey(stored);
    if (!logical || !match(logical)) continue;
    entries.delete(stored);
    latestRead.delete(stored);
    committedRead.delete(stored);
    tokens.set(stored, (tokens.get(stored) ?? 0) + 1);
  }
  emit();
}

function matchesPrefix(key: string, prefix: string): boolean {
  if (prefix.startsWith('=')) return key === prefix.slice(1);
  return key === prefix || key.startsWith(`${prefix}:`);
}

export type FinancialScope =
  | 'dashboard'
  | 'savings'
  | 'debts'
  | 'spending'
  | 'portfolio'
  | 'projections'
  | 'kiwisaver'
  | 'yearly'
  | 'dividends'
  | 'paye'
  | 'categories'
  | 'charts'
  | 'economy'
  | 'value-search'
  | 'collectable-types'
  | 'asset-classes';

const SCOPE_PREFIXES: Record<FinancialScope, readonly string[]> = {
  dashboard: ['dashboard'],
  savings: ['savings-goals'],
  debts: ['debts'],
  spending: ['spending'],
  portfolio: ['=portfolio', 'news-page', 'cycle-mix'],
  projections: ['projections'],
  kiwisaver: ['kiwisaver'],
  yearly: ['yearly'],
  dividends: ['dividends'],
  paye: ['paye'],
  categories: ['categories'],
  charts: ['chart'],
  economy: ['economy', 'news'],
  'value-search': ['value-search'],
  'collectable-types': ['collectable-types'],
  'asset-classes': ['asset-classes'],
};

/** Drop cached payloads affected by a create, update, or delete. */
export function invalidateFinancial(...scopes: FinancialScope[]): void {
  const prefixes = scopes.flatMap((scope) => SCOPE_PREFIXES[scope]);
  invalidatePageCache((key) => prefixes.some((prefix) => matchesPrefix(key, prefix)));
}

/** Budget edits also change the portfolio net-worth summary. */
export function invalidateAfterBudgetEdit(): void {
  invalidateFinancial('spending', 'dashboard', 'debts', 'yearly', 'paye', 'projections', 'portfolio');
}

/** Debt edits also change the portfolio net-worth summary. */
export function invalidateAfterDebtEdit(): void {
  invalidateFinancial('debts', 'dashboard', 'spending', 'yearly', 'projections', 'portfolio');
}

/** KiwiSaver edits also change the portfolio net-worth summary. */
export function invalidateAfterKiwiSaverEdit(): void {
  invalidateFinancial('kiwisaver', 'dashboard', 'projections', 'portfolio');
}

const ALL_FINANCIAL_SCOPES = Object.keys(SCOPE_PREFIXES) as FinancialScope[];

/** Bank link or unlink can change balances across the app. */
export function invalidateAfterAkahuLinkChange(): void {
  invalidateFinancial(...ALL_FINANCIAL_SCOPES);
  invalidatePageCache((key) => key === 'settings:akahu');
}

export function txnSyncChanged(result: {
  ok?: boolean;
  inserted?: number;
  updated?: number;
  merged?: number;
}): boolean {
  if (result.ok === false) return false;
  return (result.inserted ?? 0) > 0 || (result.updated ?? 0) > 0 || (result.merged ?? 0) > 0;
}

export function portfolioSyncChanged(result: {
  ok?: boolean;
  stocksUpserted?: number;
  cryptoUpserted?: number;
  stocksDeleted?: number;
  cryptoDeleted?: number;
  cashAccountsUpserted?: number;
  kiwisaverFunds?: number;
  kiwisaverBalanceSynced?: boolean;
}): boolean {
  if (result.ok === false) return false;
  return (
    (result.stocksUpserted ?? 0) > 0 ||
    (result.cryptoUpserted ?? 0) > 0 ||
    (result.stocksDeleted ?? 0) > 0 ||
    (result.cryptoDeleted ?? 0) > 0 ||
    (result.cashAccountsUpserted ?? 0) > 0 ||
    (result.kiwisaverFunds ?? 0) > 0 ||
    result.kiwisaverBalanceSynced === true
  );
}

/** Scopes to drop when a bank or portfolio sync actually wrote rows. */
export function invalidateAfterExternalSync(): void {
  invalidateFinancial(
    'dashboard',
    'spending',
    'portfolio',
    'kiwisaver',
    'yearly',
    'dividends',
    'debts',
    'paye',
    'projections',
    'charts',
    'collectable-types',
  );
}
