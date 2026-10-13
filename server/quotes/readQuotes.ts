/**
 * Quotes for read requests (net worth, holdings list). Reads use the quotes already
 * stored and refresh stale ones in the background, so a page load never waits on
 * gold-api.com / Metals.Dev or Frankfurter. Concurrent refreshes share one fetch.
 *
 * A request only waits when the user holds something with no stored quote row at all
 * (a first metal or a new currency), so a value is never blank on first sight. Once a
 * row exists, even a failed one, refreshes happen in the background, so an outage
 * can't make every request wait. Metals refresh only for users who hold metals.
 */
import type { Database } from 'sql.js';
import { queryAll, queryOne } from '../db/index.ts';
import { logger } from '../lib/logger.ts';
import { ensureForexQuotesPersisted, forexAssetKey } from './forexQuotesDb.ts';
import { ensureMetalQuotesPersisted } from './metalQuotesDb.ts';
import { METAL_KINDS, metalAssetKey } from './metals.ts';

let metalsInflight: Promise<void> | null = null;
let forexInflight: Promise<void> | null = null;

/** One shared refresh per kind; errors are logged, never thrown to the caller. */
function shared(kind: 'metals' | 'forex', run: () => Promise<unknown>): Promise<void> {
  const current = kind === 'metals' ? metalsInflight : forexInflight;
  if (current) return current;
  const p = run()
    .then(() => undefined)
    .catch((err: unknown) => {
      logger.warn('quote_refresh_failed', { kind, error: err instanceof Error ? err.message : String(err) });
    })
    .finally(() => {
      if (kind === 'metals') metalsInflight = null;
      else forexInflight = null;
    });
  if (kind === 'metals') metalsInflight = p;
  else forexInflight = p;
  return p;
}

function userHoldsMetals(db: Database, userId: string): boolean {
  return Boolean(queryOne(db, `SELECT 1 AS x FROM holdings WHERE user_id = ? AND asset_class = 'metal' LIMIT 1`, [userId]));
}

function noMetalQuoteStored(db: Database): boolean {
  const keys = METAL_KINDS.map((m) => metalAssetKey(m));
  const row = queryOne<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM price_quotes WHERE asset_key IN (${keys.map(() => '?').join(',')})`,
    keys,
  );
  return Number(row?.n ?? 0) === 0;
}

/** The user's foreign currencies that have never had a quote row. */
function currenciesWithoutQuote(db: Database, userId: string): string[] {
  const rows = queryAll<{ asset: string | null }>(
    db,
    `SELECT DISTINCT asset FROM holdings WHERE user_id = ? AND asset_class = 'forex' AND asset IS NOT NULL`,
    [userId],
  );
  return rows
    .map((r) => (r.asset ?? '').trim().toUpperCase())
    .filter((c) => c && c !== 'NZD')
    .filter((c) => !queryOne(db, `SELECT 1 AS x FROM price_quotes WHERE asset_key = ?`, [forexAssetKey(c)]));
}

function userHoldsForex(db: Database, userId: string): boolean {
  return Boolean(
    queryOne(db, `SELECT 1 AS x FROM holdings WHERE user_id = ? AND asset_class = 'forex' AND UPPER(TRIM(asset)) != 'NZD' LIMIT 1`, [userId]),
  );
}

/**
 * Make stored quotes usable for this user's read: wait only for quotes never stored,
 * otherwise start a background refresh (the ensure functions skip fresh quotes).
 */
export async function quotesForRead(db: Database, userId: string): Promise<void> {
  const waits: Promise<void>[] = [];
  if (userHoldsMetals(db, userId)) {
    const refresh = shared('metals', () => ensureMetalQuotesPersisted(db));
    if (noMetalQuoteStored(db)) waits.push(refresh);
  }
  if (userHoldsForex(db, userId)) {
    const missing = currenciesWithoutQuote(db, userId).length > 0;
    const refresh = shared('forex', () => ensureForexQuotesPersisted(db));
    if (missing) waits.push(refresh);
  }
  await Promise.all(waits);
}

/** For tests: wait for any background refresh to finish. */
export async function settleQuoteRefreshes(): Promise<void> {
  await Promise.all([metalsInflight, forexInflight].filter(Boolean));
}
