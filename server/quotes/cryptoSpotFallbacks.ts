/**
 * Public spot USD fallbacks when CoinGecko 429s/fails.
 * Order (caller-owned): Coinbase USD spot → Kraken USD ticker → FX USD→NZD.
 * Never invents prices. Ambiguous exchange symbols (e.g. GMT ≠ GoMining) are skipped.
 *
 * Docs:
 * - https://docs.cloud.coinbase.com/sign-in-with-coinbase/docs/api-prices
 * - https://docs.kraken.com/api/docs/rest-api/get-ticker-information
 */
import type { QuoteSource } from '../../src/types/index.ts';
import { fetchFxToNzd } from './fx.ts';

const UA = 'PortfolioTracker/1.0 (local NZD portfolio; +https://localhost)';
const FETCH_MS = 12_000;

/** Tickers whose Coinbase/Kraken USD product is a different asset than our KNOWN_CRYPTO id. */
const SPOT_SYMBOL_BLOCKED = new Set([
  // Coinbase/Kraken "GMT" is STEPN / Green Metaverse Token — not GoMining (gmt-token).
  'GMT',
]);

/** Display ticker → exchange base for USD spot (CRO/Cronos kept). */
const SPOT_BASE_OVERRIDE: Record<string, string> = {
  CRONOS: 'CRO',
  XBT: 'BTC',
};

/** Kraken public pair query param (altname). BTC is XBT on Kraken. */
const KRAKEN_PAIR_OVERRIDE: Record<string, string> = {
  BTC: 'XBTUSD',
  XBT: 'XBTUSD',
  DOGE: 'XDGUSD', // Kraken uses XDG for Dogecoin
};

export type SpotUsdResult =
  | { ok: true; usd: number; venue: 'coinbase' | 'kraken'; detail: string }
  | { ok: false; detail: string };

export type SpotNzdResult =
  | {
      ok: true;
      nzd: number;
      usd: number;
      /** USD→NZD rate applied to `usd`. */
      fxRate: number;
      source: QuoteSource;
      message: string;
    }
  | { ok: false; detail: string };

function positiveNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function friendlyHttp(label: string, status: number): string {
  if (status === 429) {
    return `${label} rate limit — try another venue or wait briefly.`;
  }
  if (status === 404) return `${label}: pair not found`;
  if (status >= 500) return `${label}: temporarily unavailable (HTTP ${status})`;
  return `${label}: HTTP ${status}`;
}

async function fetchJson(
  url: string,
  label: string,
): Promise<
  | { ok: true; data: unknown }
  | { ok: false; detail: string; status: number | null }
> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        detail: friendlyHttp(label, res.status),
        status: res.status,
      };
    }
    try {
      return { ok: true, data: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, detail: `${label} returned non-JSON`, status: res.status };
    }
  } catch (err) {
    return {
      ok: false,
      detail: `${label} fetch failed: ${(err as Error).message}`,
      status: null,
    };
  }
}

/** Base symbol for public USD spot, or null if blocked/invalid. */
export function spotBaseSymbol(rawTicker: string): string | null {
  const t = rawTicker.trim().toUpperCase();
  if (!t) return null;
  if (SPOT_SYMBOL_BLOCKED.has(t)) return null;
  const base = SPOT_BASE_OVERRIDE[t] ?? t;
  if (SPOT_SYMBOL_BLOCKED.has(base)) return null;
  if (!/^[A-Z0-9]{2,12}$/.test(base)) return null;
  return base;
}

export async function fetchCoinbaseUsdSpot(
  rawTicker: string,
): Promise<SpotUsdResult> {
  const base = spotBaseSymbol(rawTicker);
  if (!base) {
    return {
      ok: false,
      detail: `Coinbase USD spot skipped for ${rawTicker.trim().toUpperCase() || '?'} (ambiguous or unsupported symbol)`,
    };
  }
  const url = `https://api.coinbase.com/v2/prices/${encodeURIComponent(`${base}-USD`)}/spot`;
  const r = await fetchJson(url, `Coinbase ${base}-USD`);
  if (!r.ok) return { ok: false, detail: r.detail };
  const amount = positiveNum(
    (r.data as { data?: { amount?: string } }).data?.amount,
  );
  if (amount == null) {
    return { ok: false, detail: `Coinbase ${base}-USD returned no amount` };
  }
  return {
    ok: true,
    usd: amount,
    venue: 'coinbase',
    detail: `Coinbase ${base}-USD spot`,
  };
}

export async function fetchKrakenUsdSpot(
  rawTicker: string,
): Promise<SpotUsdResult> {
  const base = spotBaseSymbol(rawTicker);
  if (!base) {
    return {
      ok: false,
      detail: `Kraken USD spot skipped for ${rawTicker.trim().toUpperCase() || '?'} (ambiguous or unsupported symbol)`,
    };
  }
  const pair = KRAKEN_PAIR_OVERRIDE[base] ?? `${base}USD`;
  const url = `https://api.kraken.com/0/public/Ticker?pair=${encodeURIComponent(pair)}`;
  const r = await fetchJson(url, `Kraken ${pair}`);
  if (!r.ok) return { ok: false, detail: r.detail };
  const body = r.data as {
    error?: string[];
    result?: Record<string, { c?: string[] }>;
  };
  const errs = (body.error ?? []).filter(Boolean);
  if (errs.length > 0) {
    return { ok: false, detail: `Kraken ${pair}: ${errs.join('; ')}` };
  }
  const rows = body.result ?? {};
  const keys = Object.keys(rows);
  if (keys.length === 0) {
    return { ok: false, detail: `Kraken ${pair}: empty result` };
  }
  // Prefer exact altname match when present; else first row (Kraken renames e.g. XXBTZUSD).
  const row = rows[pair] ?? rows[keys[0]!]!;
  const last = positiveNum(row.c?.[0]);
  if (last == null) {
    return { ok: false, detail: `Kraken ${pair}: no last trade price` };
  }
  return {
    ok: true,
    usd: last,
    venue: 'kraken',
    detail: `Kraken ${pair} last trade`,
  };
}

/**
 * Coinbase USD → Kraken USD → Frankfurter/existing FX → NZD.
 * Returns unavailable-style failure detail; never invents.
 */
export async function fetchSpotUsdThenNzd(
  rawTicker: string,
): Promise<SpotNzdResult> {
  const notes: string[] = [];
  let usd: number | null = null;
  let venue: 'coinbase' | 'kraken' | null = null;

  const cb = await fetchCoinbaseUsdSpot(rawTicker);
  if (cb.ok) {
    usd = cb.usd;
    venue = 'coinbase';
    notes.push(cb.detail);
  } else {
    notes.push(cb.detail);
    const kr = await fetchKrakenUsdSpot(rawTicker);
    if (kr.ok) {
      usd = kr.usd;
      venue = 'kraken';
      notes.push(kr.detail);
    } else {
      notes.push(kr.detail);
    }
  }

  if (usd == null || venue == null) {
    return {
      ok: false,
      detail: `Public USD spot unavailable — ${notes.join(' · ')}`,
    };
  }

  const fx = await fetchFxToNzd('USD', false);
  if (fx.status !== 'ok' || fx.rate == null) {
    return {
      ok: false,
      detail: `${venue} USD ${usd} ok but USD→NZD FX failed (${fx.message ?? 'unavailable'}) — not inventing NZD`,
    };
  }

  const nzd = usd * fx.rate;
  if (!Number.isFinite(nzd) || nzd <= 0) {
    return { ok: false, detail: 'USD×FX produced non-positive NZD — discarded' };
  }

  const source: QuoteSource =
    venue === 'coinbase' ? 'coinbase+frankfurter' : 'kraken+frankfurter';
  // frankfurter label covers btc_fx_ratio fallback inside fetchFxToNzd too
  const fxNote =
    fx.source === 'frankfurter'
      ? `Frankfurter USD→NZD ${fx.rate}`
      : fx.source === 'btc_fx_ratio'
        ? `BTC FX ratio USD→NZD ${fx.rate}`
        : `USD→NZD ${fx.rate} (${fx.source})`;

  const venueNote =
    venue === 'coinbase'
      ? notes.find((n) => n.startsWith('Coinbase')) ?? 'Coinbase USD spot'
      : notes.find((n) => n.startsWith('Kraken')) ?? 'Kraken USD spot';

  return {
    ok: true,
    nzd,
    usd,
    fxRate: fx.rate,
    source,
    message: `Live NZD via ${venueNote} × ${fxNote}`,
  };
}
