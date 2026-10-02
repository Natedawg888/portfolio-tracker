/**
 * Bitcoin network hashrate (EH/s) — fallback input for GoMining Academy pool formula.
 *
 * Prefer GoMining’s own pool income (see gominingIncome.ts). Use network EH/s only when
 * that feed is unavailable, matching Academy:
 *   Pool BTC/day ≈ (TH / (networkEH/s × 1e6)) × dailyIssuance
 *   https://academy.gomining.com/articles/gomining-roi-calculator-2026
 *
 * Sources (never invent):
 *   1. mempool.space currentHashrate (H/s) ÷ 1e18 → EH/s
 *   2. blockchain.info /stats hash_rate (GH/s) ÷ 1e9 → EH/s
 */

export type NetworkHashrateStatus = 'ok' | 'unavailable';

export type NetworkHashrateSource =
  | 'mempool.space'
  | 'blockchain.info'
  | 'stub';

export interface NetworkHashrateQuote {
  networkHashrateEhs: number | null;
  status: NetworkHashrateStatus;
  source: NetworkHashrateSource;
  asOf: string | null;
  message: string | null;
}

const CACHE_MS = 60_000;
const FETCH_MS = 12_000;
const UA = 'PortfolioTracker/1.0 (local NZD portfolio; +https://localhost)';

const MEMPOOL_URL = 'https://mempool.space/api/v1/mining/hashrate/3d';
const BLOCKCHAIN_STATS_URL = 'https://api.blockchain.info/stats';

let cache: { at: number; quote: NetworkHashrateQuote } | null = null;

function positiveNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function unavailable(asOf: string, message: string): NetworkHashrateQuote {
  return {
    networkHashrateEhs: null,
    status: 'unavailable',
    source: 'stub',
    asOf,
    message,
  };
}

async function fetchJson(
  url: string,
  label: string,
): Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      const snippet = text.replace(/\s+/g, ' ').slice(0, 160);
      return {
        ok: false,
        detail: `${label} HTTP ${res.status}${snippet ? `: ${snippet}` : ''}`,
      };
    }
    try {
      return { ok: true, data: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, detail: `${label} returned non-JSON` };
    }
  } catch (err) {
    return {
      ok: false,
      detail: `${label} fetch failed: ${(err as Error).message}`,
    };
  }
}

async function fetchMempool(): Promise<
  | { ok: true; ehs: number }
  | { ok: false; detail: string }
> {
  const r = await fetchJson(MEMPOOL_URL, 'mempool.space');
  if (!r.ok) return r;
  const data = r.data as { currentHashrate?: number };
  const hs = positiveNum(data.currentHashrate);
  if (hs == null) return { ok: false, detail: 'mempool.space missing currentHashrate' };
  // currentHashrate is H/s; 1 EH/s = 1e18 H/s
  return { ok: true, ehs: hs / 1e18 };
}

async function fetchBlockchainStats(): Promise<
  | { ok: true; ehs: number }
  | { ok: false; detail: string }
> {
  const r = await fetchJson(BLOCKCHAIN_STATS_URL, 'blockchain.info');
  if (!r.ok) return r;
  const data = r.data as { hash_rate?: number };
  const ghs = positiveNum(data.hash_rate);
  if (ghs == null) return { ok: false, detail: 'blockchain.info missing hash_rate' };
  // API docs: hash_rate in GH/s; 1 EH/s = 1e9 GH/s
  return { ok: true, ehs: ghs / 1e9 };
}

export async function fetchNetworkHashrate(
  force = false,
): Promise<NetworkHashrateQuote> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return cache.quote;
  }

  const asOf = new Date().toISOString();
  const errors: string[] = [];

  const primary = await fetchMempool();
  if (primary.ok) {
    const quote: NetworkHashrateQuote = {
      networkHashrateEhs: primary.ehs,
      status: 'ok',
      source: 'mempool.space',
      asOf,
      message: `Live network hashrate · ${primary.ehs.toFixed(2)} EH/s (mempool.space)`,
    };
    cache = { at: Date.now(), quote };
    return quote;
  }
  errors.push(primary.detail);

  const fb = await fetchBlockchainStats();
  if (fb.ok) {
    const quote: NetworkHashrateQuote = {
      networkHashrateEhs: fb.ehs,
      status: 'ok',
      source: 'blockchain.info',
      asOf,
      message: `Live network hashrate · ${fb.ehs.toFixed(2)} EH/s (blockchain.info stats)`,
    };
    cache = { at: Date.now(), quote };
    return quote;
  }
  errors.push(fb.detail);

  const quote = unavailable(
    asOf,
    `${errors.join(' · ')} — network EH/s unavailable (never invent).`,
  );
  cache = { at: Date.now(), quote };
  return quote;
}

export function clearNetworkHashrateCache(): void {
  cache = null;
}
