/**
 * Persist / ensure NZD metal spots in price_quotes.
 * Live source is gold-api.com when METALS_API_KEY is unset, otherwise Metals.Dev.
 * Never invents prices.
 * Never overwrites a good (ok/stale) price with unavailable/null.
 */
import { getDb, queryOne, run, newId } from '../db/index.ts';
import {
  METAL_KINDS,
  fetchMetalSpotNzd,
  metalAssetKey,
  metalsConfigured,
  clearMetalsCache,
  seedMetalsLastGoodFromPersisted,
} from './metals.ts';
import type { MetalKind, QuoteResult } from '../../src/types/index.ts';

function isUsablePriceRow(row: {
  price?: unknown;
  status?: unknown;
  as_of?: unknown;
  notes?: unknown;
  source?: unknown;
} | null): boolean {
  if (!row) return false;
  if (row.status !== 'ok' && row.status !== 'stale') return false;
  const p = row.price != null ? Number(row.price) : NaN;
  return Number.isFinite(p) && p > 0;
}

export function persistMetalQuote(
  db: Awaited<ReturnType<typeof getDb>>,
  quote: {
    assetKey: string;
    currency: string;
    price: number | null;
    status: string;
    source: string;
    asOf: string | null;
    message?: string | null;
  },
) {
  const usable =
    (quote.status === 'ok' || quote.status === 'stale') &&
    quote.price != null &&
    Number.isFinite(quote.price) &&
    quote.price > 0;

  if (!usable) {
    // Do not wipe last-good Metals.Dev spots with unavailable/null.
    const existing = queryOne(
      db,
      'SELECT price, status, notes FROM price_quotes WHERE asset_key = ?',
      [quote.assetKey],
    );
    if (isUsablePriceRow(existing)) {
      if (quote.message) {
        const prev = String(existing?.notes ?? 'Last-good Metals.Dev NZD/oz t');
        const base = prev.includes(' · live refresh:')
          ? prev.split(' · live refresh:')[0]
          : prev;
        run(db, `UPDATE price_quotes SET notes = ? WHERE asset_key = ?`, [
          `${base} · live refresh: ${quote.message}`,
          quote.assetKey,
        ]);
      }
      return;
    }
    // No prior good row — persist unavailable so UI can show the message.
  }

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
      quote.assetKey,
      quote.currency,
      quote.price,
      quote.status,
      quote.source,
      now,
      quote.message ?? null,
    ],
  );
}

/** Read last usable NZD/oz_t spots from price_quotes (ok or stale). Never invents. */
export function readDbMetalQuotes(
  db: Awaited<ReturnType<typeof getDb>>,
): Record<MetalKind, QuoteResult> | null {
  const results = {} as Record<MetalKind, QuoteResult>;
  for (const metal of METAL_KINDS) {
    const key = metalAssetKey(metal);
    const row = queryOne(
      db,
      'SELECT price, status, source, as_of, notes FROM price_quotes WHERE asset_key = ?',
      [key],
    );
    if (!isUsablePriceRow(row)) return null;
    const price = Number(row!.price);
    results[metal] = {
      assetKey: key,
      currency: 'NZD',
      price,
      status: row!.status === 'stale' ? 'stale' : 'ok',
      source: (row!.source as QuoteResult['source']) || 'metals_dev',
      asOf: (row!.as_of as string) ?? null,
      message:
        (row!.notes as string) ?? 'Cached Metals.Dev NZD/oz t from price_quotes.',
    };
  }
  return results;
}

/**
 * Prefer live/memory fetch; on unavailable, fall back to DB last-good as stale.
 * Seeds in-memory last-good from DB when present so later quota misses reuse it.
 */
export async function resolveMetalSpotNzd(
  db: Awaited<ReturnType<typeof getDb>>,
  force = false,
  opts?: { maxAgeMs?: number },
): Promise<Record<MetalKind, QuoteResult>> {
  const dbGood = readDbMetalQuotes(db);
  if (dbGood) {
    seedMetalsLastGoodFromPersisted(
      METAL_KINDS.map((metal) => ({
        metal,
        price: dbGood[metal].price as number,
        asOf: dbGood[metal].asOf,
        message: dbGood[metal].message,
        source: dbGood[metal].source,
      })),
    );
  }

  // Metals.Dev: non-force serves any usable DB row (protects the free quota).
  // gold-api.com: refetch once the row is older than the public TTL.
  // Force refresh hits the live API; last-good is still used if that call fails.
  const publicSpots = !metalsConfigured();
  const maxAgeMs =
    opts?.maxAgeMs ?? (publicSpots ? 15 * 60 * 1000 : 6 * 60 * 60 * 1000);
  const dbFresh =
    !!dbGood &&
    METAL_KINDS.every((metal) => {
      const asOf = dbGood[metal].asOf ? Date.parse(String(dbGood[metal].asOf)) : NaN;
      return Number.isFinite(asOf) && Date.now() - asOf < maxAgeMs;
    });
  if (!force && dbGood && (!publicSpots || dbFresh)) {
    return Object.fromEntries(
      METAL_KINDS.map((metal) => {
        const asOf = dbGood[metal].asOf ? Date.parse(String(dbGood[metal].asOf)) : NaN;
        const fresh = Number.isFinite(asOf) && Date.now() - asOf < maxAgeMs;
        const q = { ...dbGood[metal] };
        if (!fresh && q.status === 'ok') {
          q.status = 'stale';
          q.message = `${q.message ?? 'Metals.Dev NZD/oz t'} · cached (refresh for live)`.trim();
        }
        return [metal, q];
      }),
    ) as Record<MetalKind, QuoteResult>;
  }

  const results = await fetchMetalSpotNzd(force);
  const liveOk = METAL_KINDS.every(
    (m) =>
      (results[m].status === 'ok' || results[m].status === 'stale') &&
      results[m].price != null,
  );
  if (liveOk) return results;

  if (dbGood) {
    const reason =
      results.gold?.message ??
      'Metals.Dev unavailable — using last-good NZD/oz t from price_quotes';
    return Object.fromEntries(
      METAL_KINDS.map((metal) => [
        metal,
        {
          ...dbGood[metal],
          status: 'stale' as const,
          message: `${reason} · as of ${dbGood[metal].asOf ?? 'unknown'}`,
        } satisfies QuoteResult,
      ]),
    ) as Record<MetalKind, QuoteResult>;
  }

  return results;
}

/**
 * Fetch+persist NZD spots if missing or older than TTL.
 * METALS_API_KEY selects Metals.Dev; otherwise gold-api.com (no key).
 */
export async function ensureMetalQuotesPersisted(
  db: Awaited<ReturnType<typeof getDb>>,
  opts?: { force?: boolean; maxAgeMs?: number },
): Promise<{ configured: boolean; refreshed: boolean; okCount: number }> {
  const configured = metalsConfigured();
  const force = opts?.force === true;
  const maxAgeMs =
    opts?.maxAgeMs ?? (configured ? 6 * 60 * 60 * 1000 : 15 * 60 * 1000);
  if (!force) {
    const rows = METAL_KINDS.map((metal) => {
      const key = metalAssetKey(metal);
      return queryOne(db, 'SELECT price, status, as_of FROM price_quotes WHERE asset_key = ?', [
        key,
      ]);
    });
    const allFreshOk = rows.every((row) => {
      if (!isUsablePriceRow(row)) return false;
      const asOf = row!.as_of ? Date.parse(String(row!.as_of)) : NaN;
      if (!Number.isFinite(asOf)) return false;
      return Date.now() - asOf < maxAgeMs;
    });
    if (allFreshOk) {
      return { configured, refreshed: false, okCount: METAL_KINDS.length };
    }
  } else {
    clearMetalsCache();
  }
  const results = await resolveMetalSpotNzd(db, force);
  let okCount = 0;
  for (const metal of METAL_KINDS) {
    const q = results[metal];
    persistMetalQuote(db, q);
    if ((q.status === 'ok' || q.status === 'stale') && q.price != null) {
      okCount += 1;
    }
  }
  return { configured, refreshed: true, okCount };
}
