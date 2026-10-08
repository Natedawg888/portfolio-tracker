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

/** Capture a stamp before an await so a later invalidation can ignore the result. */
export function beginPageRead(key: string): PageReadStamp {
  const stored = storageKey(key);
  const id = ++readSeq;
  latestRead.set(stored, id);
  return {
    storageKey: stored,
    token: tokens.get(stored) ?? 0,
    epoch: userEpoch,
    id,
  };
}

/** Store data only when this read is still the latest one for the same user. */
export function commitPageRead<T>(stamp: PageReadStamp, data: T): boolean {
  if (stamp.epoch !== userEpoch) return false;
  if ((tokens.get(stamp.storageKey) ?? 0) !== stamp.token) return false;
  if (latestRead.get(stamp.storageKey) !== stamp.id) return false;
  entries.set(stamp.storageKey, { data, token: stamp.token });
  return true;
}

/** Synchronous write after the caller already holds fresh data. */
export function writePageCache<T>(key: string, data: T): boolean {
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
    tokens.set(stored, (tokens.get(stored) ?? 0) + 1);
  }
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
  portfolio: ['=portfolio', 'news-page'],
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
