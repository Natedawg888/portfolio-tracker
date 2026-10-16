/**
 * Historical NZD prices for the crypto ledger (KAN-47). Never invents a price.
 *
 * IRD (Convert cryptoasset values to NZD) names Yahoo Finance's cryptocurrency section as a
 * source and asks for a consistent method. So: Yahoo Finance daily close for <ASSET>-USD on the
 * day (or the nearest earlier day within 3), × the Frankfurter (European Central Bank) USD→NZD
 * rate for that day (or the nearest earlier working day within 7). Anything missing → no price,
 * and the user enters the value.
 */
const UA = 'KoruLedger/1.0 (+https://koruledger.app)';
const TIMEOUT_MS = 10_000;
const DAY = 86_400_000;

/** Wrapped / bridged tokens priced as their underlying asset. */
const SAME_AS: Record<string, string> = { WETH: 'ETH', WBTC: 'BTC', CBBTC: 'BTC', 'USDC.E': 'USDC', WPOL: 'POL', WMATIC: 'MATIC' };
/** Yahoo symbols that differ from <ASSET>-USD. */
const YAHOO_SYMBOL: Record<string, string> = { POL: 'POL28321-USD' };

export type PriceLookup = { ok: true; priceNzd: number; source: string; priceDate: string } | { ok: false; reason: string };
type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const defaultFetcher: Fetcher = (url) => fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
const cache = new Map<string, PriceLookup>();

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function priceSymbol(asset: string): string {
  const a = asset.trim().toUpperCase();
  return SAME_AS[a] ?? a;
}

async function yahooUsdClose(asset: string, date: string, fetcher: Fetcher): Promise<{ usd: number; day: string } | null> {
  const sym = YAHOO_SYMBOL[asset] ?? `${asset}-USD`;
  const end = Date.parse(`${date}T00:00:00Z`) + DAY;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${Math.floor((end - 4 * DAY) / 1000)}&period2=${Math.floor(end / 1000)}&interval=1d`;
  const res = await fetcher(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] | null } };
  const r = data.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const closes = r?.indicators?.quote?.[0]?.close ?? [];
  let best: { usd: number; day: string } | null = null;
  for (let i = 0; i < ts.length; i++) {
    const day = ymd(ts[i] * 1000);
    const c = closes[i];
    if (day <= date && typeof c === 'number' && c > 0 && (!best || day > best.day)) best = { usd: c, day };
  }
  return best;
}

async function usdToNzd(date: string, fetcher: Fetcher): Promise<number | null> {
  const start = ymd(Date.parse(`${date}T00:00:00Z`) - 7 * DAY);
  const res = await fetcher(`https://api.frankfurter.dev/v1/${start}..${date}?from=USD&to=NZD`);
  if (!res.ok) return null;
  const data = (await res.json()) as { rates?: Record<string, { NZD?: number }> };
  const days = Object.keys(data.rates ?? {})
    .filter((d) => d <= date)
    .sort();
  const last = days.at(-1);
  const rate = last ? data.rates![last]?.NZD : undefined;
  return typeof rate === 'number' && rate > 0 ? rate : null;
}

/** NZD price of one unit of `asset` on `date` ('YYYY-MM-DD'). */
export async function historicalPriceNzd(asset: string, date: string, fetcher: Fetcher = defaultFetcher): Promise<PriceLookup> {
  const sym = priceSymbol(asset);
  const key = `${sym}|${date}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let out: PriceLookup;
  try {
    const usd = await yahooUsdClose(sym, date, fetcher);
    if (!usd) out = { ok: false, reason: `No Yahoo Finance price for ${sym} on ${date}` };
    else {
      const fx = await usdToNzd(usd.day, fetcher);
      out = fx == null
        ? { ok: false, reason: `No USD→NZD rate for ${usd.day}` }
        : { ok: true, priceNzd: Math.round(usd.usd * fx * 1e6) / 1e6, source: 'yahoo+frankfurter', priceDate: usd.day };
    }
  } catch (err) {
    out = { ok: false, reason: err instanceof Error ? err.message : 'Price lookup failed' };
    return out; // don't cache network errors
  }
  cache.set(key, out);
  return out;
}

export function clearPriceCacheForTest(): void {
  cache.clear();
}
