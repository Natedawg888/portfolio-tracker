/**
 * Persist Frankfurter FX→NZD rates for forex holdings (asset_key FX:USD etc.).
 * Never invents rates — unavailable stays unavailable.
 */
import type { Database } from 'sql.js';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { fetchFxToNzd, prefetchFxToNzd } from './fx.ts';

export function forexAssetKey(currency: string): string {
  return `FX:${currency.trim().toUpperCase()}`;
}

const STALE_MS = 15 * 60_000;

export function persistFxQuote(
  db: Database,
  currency: string,
  quote: {
    rate: number | null;
    status: string;
    source: string;
    asOf: string | null;
    message: string | null;
  },
): void {
  const assetKey = forexAssetKey(currency);
  const now = quote.asOf ?? new Date().toISOString();
  run(
    db,
    `INSERT INTO price_quotes (id, asset_key, currency, price, status, source, as_of, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(asset_key) DO UPDATE SET
       price=excluded.price, status=excluded.status, source=excluded.source,
       as_of=excluded.as_of, notes=excluded.notes, currency=excluded.currency`,
    [
      newId('q'),
      assetKey,
      'NZD',
      quote.rate,
      quote.status === 'ok' ? 'ok' : 'unavailable',
      quote.source,
      now,
      quote.message,
    ],
  );
}

/** Ensure FX quotes exist for currencies held as forex (fetch if missing/stale). */
export async function ensureForexQuotesPersisted(
  db: Database,
  force = false,
): Promise<void> {
  const rows = queryAll<{ asset: string | null }>(
    db,
    `SELECT DISTINCT asset FROM holdings WHERE asset_class = 'forex' AND asset IS NOT NULL`,
  );
  const currencies = [
    ...new Set(
      rows
        .map((r) => (r.asset ?? '').trim().toUpperCase())
        .filter((c) => c && c !== 'NZD'),
    ),
  ];
  if (currencies.length === 0) return;

  const needFetch: string[] = [];
  for (const c of currencies) {
    if (force) {
      needFetch.push(c);
      continue;
    }
    const key = forexAssetKey(c);
    const q = queryOne(db, 'SELECT status, as_of FROM price_quotes WHERE asset_key = ?', [key]);
    if (!q || q.status !== 'ok') {
      needFetch.push(c);
      continue;
    }
    const asOf = q.as_of ? Date.parse(String(q.as_of)) : NaN;
    if (!Number.isFinite(asOf) || Date.now() - asOf > STALE_MS) {
      needFetch.push(c);
    }
  }

  if (needFetch.length === 0) return;
  const map = await prefetchFxToNzd(needFetch, force);
  for (const [c, fx] of map) {
    persistFxQuote(db, c, {
      rate: fx.rate,
      status: fx.status,
      source: fx.source,
      asOf: fx.asOf,
      message: fx.message,
    });
  }
}

/** Refresh one currency from Frankfurter (or USD BTC-FX fallback). */
export async function refreshForexCurrency(
  db: Database,
  currency: string,
  force = true,
): Promise<{
  currency: string;
  assetKey: string;
  rate: number | null;
  status: string;
  source: string;
  asOf: string | null;
  message: string | null;
}> {
  const c = currency.trim().toUpperCase();
  const fx = await fetchFxToNzd(c, force);
  persistFxQuote(db, c, {
    rate: fx.rate,
    status: fx.status,
    source: fx.source,
    asOf: fx.asOf,
    message: fx.message,
  });
  return {
    currency: c,
    assetKey: forexAssetKey(c),
    rate: fx.rate,
    status: fx.status,
    source: fx.source,
    asOf: fx.asOf,
    message: fx.message,
  };
}
