/**
 * GoMining digital miner estimated NZD value from public primary marketplace pricing.
 *
 * Source (unauthenticated):
 *   GET https://api.gomining.com/api/nft-collection/find-all-generative
 *   Fallback: https://gomining.com/api/nft-collection/find-all-generative
 *
 * Each collection row exposes power (TH), energyEfficiency (W/TH), priceUsdt, priceGmt.
 * USD/TH = priceUsdt / power for the matched EE + power tier; or EE-interpolated
 * between live generative bands; or **linearly extrapolated** from live band
 * usd/TH vs EE when miner EE is outside primary shop bands (Nathan-approved estimate).
 * NZD = USD × (BTC/NZD ÷ BTC/USD) from fetchBtcFx (never invent FX).
 *
 * Primary generative bands (verified 2026-10-01): **12 and 15 W/TH only**.
 * Out-of-band miners (~19–23 W/TH) use live 12/15 usd/TH anchors → linear fit vs EE
 * → labelled `gomining_extrapolated` / “estimate extrapolated from primary 12/15 W/TH”.
 * Anchors are always live — never hardcoded fake $/TH.
 *
 * This is replacement-cost / primary generative list (or extrapolated estimate) —
 * NOT authenticated secondary P2P comps. Label source clearly.
 *
 * Docs: https://docs.gomining.com/en/product/miners/marketplace
 *       https://docs.gomining.com/en/product/ai/mcp-server (get_marketplace_pricing)
 */

import { fetchBtcFx, type BtcFxQuote } from './btc.ts';
import type { QuoteResult } from '../../src/types/index.ts';

export interface GenerativeCollection {
  id: number;
  power: number;
  energyEfficiency: number;
  priceUsdt: number;
  priceGmt: number | null;
}

export interface MarketplaceCollectionsQuote {
  collections: GenerativeCollection[];
  status: 'ok' | 'unavailable';
  source: 'gomining_api' | 'gomining_com_proxy' | 'stub';
  asOf: string | null;
  message: string | null;
}

export type MinerMatchMode =
  | 'exact_ee'
  | 'ee_interpolated'
  | 'ee_extrapolated'
  | 'ee_unknown_default_15'
  | 'none';

export type MinerEstimateFailureCode =
  | 'no_hashrate'
  | 'market_down'
  | 'fx_down'
  | 'ee_out_of_band'
  | 'no_match';

export interface MinerValueEstimate {
  estimatedValueNzd: number | null;
  estimatedValueUsd: number | null;
  usdPerTh: number | null;
  nzdPerTh: number | null;
  matchedCollectionId: number | null;
  matchedPower: number | null;
  matchedEnergyEfficiency: number | null;
  usdNzdRate: number | null;
  availableEeBands: number[];
  matchMode: MinerMatchMode;
  failureCode: MinerEstimateFailureCode | null;
  status: 'ok' | 'unavailable' | 'stubbed';
  /** Exact/interpolated primary → gomining; out-of-band linear fit → gomining_extrapolated */
  source: 'gomining' | 'gomining_extrapolated';
  asOf: string | null;
  message: string | null;
  fx: BtcFxQuote | null;
}

const CACHE_MS = 60_000;
const FETCH_MS = 12_000;
const UA = 'PortfolioTracker/1.0 (local NZD portfolio; +https://localhost)';
/** Exact EE band tolerance (W/TH). */
const EE_EXACT_TOL = 0.5;

const PRIMARY_URL =
  'https://api.gomining.com/api/nft-collection/find-all-generative';
const FALLBACK_URL =
  'https://gomining.com/api/nft-collection/find-all-generative';

let collectionsCache: { at: number; quote: MarketplaceCollectionsQuote } | null =
  null;

function positiveNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function uniqueSortedEe(collections: GenerativeCollection[]): number[] {
  return [...new Set(collections.map((c) => c.energyEfficiency))].sort(
    (a, b) => a - b,
  );
}

function parseCollections(payload: unknown): GenerativeCollection[] {
  const root = payload as {
    data?: { array?: unknown[] };
    array?: unknown[];
  };
  const arr = root?.data?.array ?? root?.array;
  if (!Array.isArray(arr)) return [];
  const out: GenerativeCollection[] = [];
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const power = positiveNum(r.power);
    const priceUsdt = positiveNum(r.priceUsdt);
    const ee = positiveNum(r.energyEfficiency);
    const idRaw = r.id;
    const id =
      typeof idRaw === 'number' && Number.isFinite(idRaw)
        ? idRaw
        : typeof idRaw === 'string' && Number.isFinite(Number(idRaw))
          ? Number(idRaw)
          : null;
    if (power == null || priceUsdt == null || ee == null || id == null) continue;
    const priceGmt = positiveNum(r.priceGmt);
    out.push({
      id,
      power,
      energyEfficiency: ee,
      priceUsdt,
      priceGmt,
    });
  }
  return out;
}

async function fetchCollectionsUrl(
  url: string,
  label: string,
): Promise<
  | { ok: true; collections: GenerativeCollection[] }
  | { ok: false; detail: string }
> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': UA,
      },
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return { ok: false, detail: `${label} returned non-JSON` };
    }
    const collections = parseCollections(parsed);
    if (collections.length === 0) {
      return { ok: false, detail: `${label} returned no usable collections` };
    }
    return { ok: true, collections };
  } catch (err) {
    return {
      ok: false,
      detail: `${label} fetch failed: ${(err as Error).message}`,
    };
  }
}

export async function fetchGenerativeCollections(
  force = false,
): Promise<MarketplaceCollectionsQuote> {
  if (!force && collectionsCache && Date.now() - collectionsCache.at < CACHE_MS) {
    return collectionsCache.quote;
  }

  const asOf = new Date().toISOString();
  const errors: string[] = [];

  const primary = await fetchCollectionsUrl(PRIMARY_URL, 'api.gomining.com');
  if (primary.ok) {
    const bands = uniqueSortedEe(primary.collections);
    const quote: MarketplaceCollectionsQuote = {
      collections: primary.collections,
      status: 'ok',
      source: 'gomining_api',
      asOf,
      message: `Live primary generative marketplace · ${primary.collections.length} collections · EE bands ${bands.join(', ')} W/TH (nft-collection/find-all-generative)`,
    };
    collectionsCache = { at: Date.now(), quote };
    return quote;
  }
  errors.push(primary.detail);

  const fallback = await fetchCollectionsUrl(FALLBACK_URL, 'gomining.com proxy');
  if (fallback.ok) {
    const bands = uniqueSortedEe(fallback.collections);
    const quote: MarketplaceCollectionsQuote = {
      collections: fallback.collections,
      status: 'ok',
      source: 'gomining_com_proxy',
      asOf,
      message: `Live primary generative marketplace via gomining.com · ${fallback.collections.length} collections · EE bands ${bands.join(', ')} W/TH`,
    };
    collectionsCache = { at: Date.now(), quote };
    return quote;
  }
  errors.push(fallback.detail);

  const quote: MarketplaceCollectionsQuote = {
    collections: [],
    status: 'unavailable',
    source: 'stub',
    asOf,
    message: `${errors.join(' · ')} — marketplace pricing unavailable (never invent).`,
  };
  collectionsCache = { at: Date.now(), quote };
  return quote;
}

/** Closest power tier within a filtered pool (log distance). */
export function closestByPower(
  pool: GenerativeCollection[],
  hashrateThs: number,
): GenerativeCollection | null {
  if (!pool.length || !(hashrateThs > 0)) return null;
  let best: GenerativeCollection | null = null;
  let bestDist = Infinity;
  for (const c of pool) {
    const d = Math.abs(Math.log(c.power) - Math.log(hashrateThs));
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

export interface CollectionMatch {
  mode: MinerMatchMode;
  /** Collection used for exact / unknown-default match; null when interpolated. */
  collection: GenerativeCollection | null;
  /** Resolved USD/TH (exact from collection or interpolated between live bands). */
  usdPerTh: number | null;
  matchedPower: number | null;
  matchedEnergyEfficiency: number | null;
  /** For interpolated: lower/upper band collections. */
  lower: GenerativeCollection | null;
  upper: GenerativeCollection | null;
  availableEeBands: number[];
  reason: string | null;
}

/**
 * Match primary generative pricing for a miner.
 *
 * Rules (anchors always from live generative collections — never hardcode $/TH):
 * 1. Exact EE (±0.5 W/TH) → closest power in that band.
 * 2. Miner EE strictly between min/max live bands → linear interpolate usd/TH
 *    between nearest lower & higher EE bands (each at closest power).
 * 3. Miner EE unknown → 15 W/TH band (current generative floor) if present, else all.
 * 4. Miner EE outside all bands (e.g. 21.85 when only 12/15 exist) → linear
 *    **extrapolate** usd/TH vs EE from the two extreme live bands at closest power
 *    (same line as interpolate, extended). Labelled ee_extrapolated.
 *    If extrapolated usd/TH ≤ 0 or fewer than 2 bands → none.
 */
export function matchCollectionPricing(
  collections: GenerativeCollection[],
  hashrateThs: number,
  energyEfficiencyWth: number | null | undefined,
): CollectionMatch {
  const availableEeBands = uniqueSortedEe(collections);
  const empty: CollectionMatch = {
    mode: 'none',
    collection: null,
    usdPerTh: null,
    matchedPower: null,
    matchedEnergyEfficiency: null,
    lower: null,
    upper: null,
    availableEeBands,
    reason: null,
  };

  if (!collections.length || !(hashrateThs > 0)) {
    return { ...empty, reason: 'No collections or invalid hashrate.' };
  }

  const eeKnown =
    energyEfficiencyWth != null &&
    Number.isFinite(energyEfficiencyWth) &&
    energyEfficiencyWth > 0;

  if (!eeKnown) {
    const ee15 = collections.filter((c) => Math.abs(c.energyEfficiency - 15) < 0.05);
    const pool = ee15.length ? ee15 : collections;
    const best = closestByPower(pool, hashrateThs);
    if (!best) {
      return { ...empty, reason: 'No generative collection for unknown-EE default.' };
    }
    return {
      mode: 'ee_unknown_default_15',
      collection: best,
      usdPerTh: best.priceUsdt / best.power,
      matchedPower: best.power,
      matchedEnergyEfficiency: best.energyEfficiency,
      lower: null,
      upper: null,
      availableEeBands,
      reason: null,
    };
  }

  const ee = energyEfficiencyWth as number;

  // 1) Exact band
  const exactPool = collections.filter(
    (c) => Math.abs(c.energyEfficiency - ee) <= EE_EXACT_TOL,
  );
  if (exactPool.length) {
    const best = closestByPower(exactPool, hashrateThs);
    if (!best) {
      return { ...empty, reason: `No power tier in EE≈${ee} band.` };
    }
    return {
      mode: 'exact_ee',
      collection: best,
      usdPerTh: best.priceUsdt / best.power,
      matchedPower: best.power,
      matchedEnergyEfficiency: best.energyEfficiency,
      lower: null,
      upper: null,
      availableEeBands,
      reason: null,
    };
  }

  // 2) Interpolate only when EE is strictly inside [minBand, maxBand]
  const minBand = availableEeBands[0];
  const maxBand = availableEeBands[availableEeBands.length - 1];
  if (
    availableEeBands.length >= 2 &&
    ee > minBand + EE_EXACT_TOL &&
    ee < maxBand - EE_EXACT_TOL
  ) {
    const lowerEe = [...availableEeBands].reverse().find((b) => b < ee);
    const upperEe = availableEeBands.find((b) => b > ee);
    if (lowerEe != null && upperEe != null) {
      const lower = closestByPower(
        collections.filter((c) => Math.abs(c.energyEfficiency - lowerEe) < 0.05),
        hashrateThs,
      );
      const upper = closestByPower(
        collections.filter((c) => Math.abs(c.energyEfficiency - upperEe) < 0.05),
        hashrateThs,
      );
      if (lower && upper) {
        const usdLow = lower.priceUsdt / lower.power;
        const usdHigh = upper.priceUsdt / upper.power;
        const t = (ee - lowerEe) / (upperEe - lowerEe);
        const usdPerTh = usdLow + t * (usdHigh - usdLow);
        return {
          mode: 'ee_interpolated',
          collection: null,
          usdPerTh,
          matchedPower: closestByPower([lower, upper], hashrateThs)?.power ?? lower.power,
          matchedEnergyEfficiency: ee,
          lower,
          upper,
          availableEeBands,
          reason: null,
        };
      }
    }
  }

  // 3) Outside live generative EE bands — extrapolate usd/TH vs EE from live band medians
  if (availableEeBands.length >= 2) {
    const eeLow = availableEeBands[0]!;
    const eeHigh = availableEeBands[availableEeBands.length - 1]!;
    const usdLow = medianUsdPerThForBand(collections, eeLow);
    const usdHigh = medianUsdPerThForBand(collections, eeHigh);
    const lower = closestByPower(
      collections.filter((c) => Math.abs(c.energyEfficiency - eeLow) < 0.05),
      hashrateThs,
    );
    const upper = closestByPower(
      collections.filter((c) => Math.abs(c.energyEfficiency - eeHigh) < 0.05),
      hashrateThs,
    );
    if (usdLow != null && usdHigh != null && eeHigh !== eeLow) {
      const fit = linearUsdPerThFromEeBands(ee, eeLow, usdLow, eeHigh, usdHigh);
      if (fit) {
        return {
          mode: 'ee_extrapolated',
          collection: null,
          usdPerTh: fit.usdPerTh,
          matchedPower:
            closestByPower(
              [lower, upper].filter(Boolean) as GenerativeCollection[],
              hashrateThs,
            )?.power ?? lower?.power ?? null,
          matchedEnergyEfficiency: ee,
          lower,
          upper,
          availableEeBands,
          reason: fit.fit === 'log_linear' ? 'log_linear_fallback' : null,
        };
      }
      const bandList = availableEeBands.join(', ');
      return {
        ...empty,
        reason: `Could not extrapolate usd/TH for EE ${ee} from live median band prices (${bandList} W/TH).`,
      };
    }
  }

  const bandList = availableEeBands.join(', ') || 'none';
  return {
    ...empty,
    reason: `Miner EE ${ee} W/TH is outside primary generative bands (${bandList} W/TH) and could not extrapolate (need ≥2 live EE bands with prices). Set manual estimatedValueNzd or use MCP search_secondary_marketplace.`,
  };
}

/** @deprecated Prefer matchCollectionPricing; kept for callers expecting a single collection. */
export function matchCollection(
  collections: GenerativeCollection[],
  hashrateThs: number,
  energyEfficiencyWth: number | null | undefined,
): GenerativeCollection | null {
  const m = matchCollectionPricing(collections, hashrateThs, energyEfficiencyWth);
  return m.collection;
}

function baseUnavailable(
  asOf: string,
  partial: Partial<MinerValueEstimate> & {
    status: MinerValueEstimate['status'];
    message: string;
    failureCode: MinerEstimateFailureCode;
  },
): MinerValueEstimate {
  return {
    estimatedValueNzd: null,
    estimatedValueUsd: null,
    usdPerTh: null,
    nzdPerTh: null,
    matchedCollectionId: null,
    matchedPower: null,
    matchedEnergyEfficiency: null,
    usdNzdRate: null,
    availableEeBands: [],
    matchMode: 'none',
    fx: null,
    source: 'gomining',
    asOf,
    ...partial,
  };
}

export async function estimateMinerValueNzd(opts: {
  hashrateThs: number;
  energyEfficiencyWth?: number | null;
  force?: boolean;
}): Promise<MinerValueEstimate> {
  const asOf = new Date().toISOString();
  const hashrate = Number(opts.hashrateThs);
  if (!Number.isFinite(hashrate) || hashrate <= 0) {
    return baseUnavailable(asOf, {
      status: 'unavailable',
      failureCode: 'no_hashrate',
      message: 'Hashrate required for marketplace estimate (never invent).',
    });
  }

  const [market, fx] = await Promise.all([
    fetchGenerativeCollections(opts.force ?? false),
    fetchBtcFx(opts.force ?? false),
  ]);

  const bands = uniqueSortedEe(market.collections);

  if (market.status !== 'ok' || market.collections.length === 0) {
    return baseUnavailable(asOf, {
      status: 'stubbed',
      failureCode: 'market_down',
      availableEeBands: bands,
      asOf: market.asOf ?? asOf,
      message: market.message ?? 'Marketplace unavailable — estimated value stubbed.',
      fx,
    });
  }

  if (fx.status !== 'ok' || fx.btcUsd == null || fx.btcNzd == null) {
    return baseUnavailable(asOf, {
      status: 'stubbed',
      failureCode: 'fx_down',
      availableEeBands: bands,
      asOf: market.asOf ?? asOf,
      message: `Marketplace OK (EE bands ${bands.join(', ') || '—'} W/TH) but BTC FX unavailable (${fx.message ?? 'no FX'}) — cannot convert USD→NZD (never invent).`,
      fx,
    });
  }

  const matched = matchCollectionPricing(
    market.collections,
    hashrate,
    opts.energyEfficiencyWth,
  );

  if (matched.mode === 'none' || matched.usdPerTh == null || !(matched.usdPerTh > 0)) {
    const ee = opts.energyEfficiencyWth;
    const outOfBand =
      ee != null &&
      Number.isFinite(ee) &&
      bands.length > 0 &&
      (ee < bands[0] - EE_EXACT_TOL || ee > bands[bands.length - 1] + EE_EXACT_TOL);
    return baseUnavailable(asOf, {
      status: 'unavailable',
      failureCode: outOfBand ? 'ee_out_of_band' : 'no_match',
      availableEeBands: bands,
      asOf: market.asOf ?? asOf,
      message:
        matched.reason ??
        (ee != null && Number.isFinite(ee)
          ? `No primary generative match for EE ${ee} (available: ${bands.join(', ') || 'none'} W/TH). Enter manual estimatedValueNzd — never invent.`
          : 'No matching generative collection for hashrate/EE.'),
      fx,
    });
  }

  const usdPerTh = matched.usdPerTh;
  const estimatedUsd = hashrate * usdPerTh;
  const usdNzdRate = fx.btcNzd / fx.btcUsd;
  const estimatedNzd = estimatedUsd * usdNzdRate;
  const nzdPerTh = usdPerTh * usdNzdRate;

  let message: string;
  const valueSource: MinerValueEstimate['source'] =
    matched.mode === 'ee_extrapolated' ? 'gomining_extrapolated' : 'gomining';
  if (matched.mode === 'exact_ee' && matched.collection) {
    const c = matched.collection;
    message = `Primary generative list · collection ${c.id} (${c.power} TH @ ${c.energyEfficiency} W/TH, $${c.priceUsdt.toFixed(2)}) · $${usdPerTh.toFixed(4)}/TH × ${hashrate} TH · USD→NZD via BTC FX (${fx.source})`;
  } else if (matched.mode === 'ee_interpolated' && matched.lower && matched.upper) {
    message = `Primary generative EE-interpolated · miner EE ${opts.energyEfficiencyWth} between live bands ${matched.lower.energyEfficiency} ($${((matched.lower.priceUsdt / matched.lower.power)).toFixed(4)}/TH) and ${matched.upper.energyEfficiency} ($${((matched.upper.priceUsdt / matched.upper.power)).toFixed(4)}/TH) → $${usdPerTh.toFixed(4)}/TH × ${hashrate} TH · USD→NZD via BTC FX (${fx.source}) — still primary list, not secondary P2P`;
  } else if (matched.mode === 'ee_extrapolated') {
    const eeLow = bands[0];
    const eeHigh = bands[bands.length - 1];
    const usdLow = eeLow != null ? medianUsdPerThForBand(market.collections, eeLow) : null;
    const usdHigh = eeHigh != null ? medianUsdPerThForBand(market.collections, eeHigh) : null;
    const fitNote =
      matched.reason === 'log_linear_fallback'
        ? 'log-linear fallback (linear crossed ≤0)'
        : 'linear usd/TH vs EE';
    message = `Estimate extrapolated from primary ${eeLow}/${eeHigh} W/TH · live median $${usdLow?.toFixed(4) ?? '—'}/TH @ ${eeLow} and $${usdHigh?.toFixed(4) ?? '—'}/TH @ ${eeHigh} → ${fitNote} → $${usdPerTh.toFixed(4)}/TH × ${hashrate} TH @ EE ${opts.energyEfficiencyWth} · USD→NZD via BTC FX (${fx.source}) — not secondary P2P`;
  } else if (matched.mode === 'ee_unknown_default_15' && matched.collection) {
    const c = matched.collection;
    message = `Primary generative list · EE unknown→${c.energyEfficiency} W/TH band · collection ${c.id} (${c.power} TH, $${c.priceUsdt.toFixed(2)}) · $${usdPerTh.toFixed(4)}/TH × ${hashrate} TH · USD→NZD via BTC FX (${fx.source})`;
  } else {
    message = `Primary generative · $${usdPerTh.toFixed(4)}/TH × ${hashrate} TH · USD→NZD via BTC FX (${fx.source})`;
  }

  return {
    estimatedValueNzd: estimatedNzd,
    estimatedValueUsd: estimatedUsd,
    usdPerTh,
    nzdPerTh,
    matchedCollectionId: matched.collection?.id ?? null,
    matchedPower: matched.matchedPower,
    matchedEnergyEfficiency: matched.matchedEnergyEfficiency,
    usdNzdRate,
    availableEeBands: bands,
    matchMode: matched.mode,
    failureCode: null,
    status: 'ok',
    source: valueSource,
    asOf: market.asOf ?? asOf,
    message,
    fx,
  };
}

/** QuoteProvider-compatible result for asset key GOMINING:miner:<id> — needs hashrate via estimateMinerValueNzd. */
export function estimateToQuoteResult(
  assetKey: string,
  estimate: MinerValueEstimate,
): QuoteResult {
  return {
    assetKey,
    currency: 'NZD',
    price: estimate.estimatedValueNzd,
    status:
      estimate.status === 'ok'
        ? 'ok'
        : estimate.status === 'stubbed'
          ? 'stubbed'
          : 'unavailable',
    source: estimate.source,
    asOf: estimate.asOf,
    message: estimate.message,
  };
}



/** Median usd/TH within one EE band (live collections only). */
export function medianUsdPerThForBand(
  collections: GenerativeCollection[],
  eeBand: number,
): number | null {
  const vals = collections
    .filter((c) => Math.abs(c.energyEfficiency - eeBand) < 0.05)
    .map((c) => c.priceUsdt / c.power)
    .filter((u) => u > 0 && Number.isFinite(u))
    .sort((a, b) => a - b);
  if (!vals.length) return null;
  return vals[Math.floor(vals.length / 2)]!;
}

/**
 * Linear usd/TH vs EE using two live band anchors (interpolate or extrapolate).
 * If linear ≤ 0 (high EE), fall back to log-linear from the same live anchors
 * so the estimate stays positive without inventing non-live numbers.
 */
export function linearUsdPerThFromEeBands(
  ee: number,
  eeLow: number,
  usdLow: number,
  eeHigh: number,
  usdHigh: number,
): { usdPerTh: number; fit: 'linear' | 'log_linear' } | null {
  if (
    !(eeHigh > eeLow) ||
    !(usdLow > 0) ||
    !(usdHigh > 0) ||
    !Number.isFinite(ee) ||
    !Number.isFinite(usdLow) ||
    !Number.isFinite(usdHigh)
  ) {
    return null;
  }
  const t = (ee - eeLow) / (eeHigh - eeLow);
  const linear = usdLow + t * (usdHigh - usdLow);
  if (linear > 0 && Number.isFinite(linear)) {
    return { usdPerTh: linear, fit: 'linear' };
  }
  // log-linear keeps positivity when the straight line crosses ≤0
  const logUsd =
    Math.log(usdLow) + t * (Math.log(usdHigh) - Math.log(usdLow));
  const usdPerTh = Math.exp(logUsd);
  if (!(usdPerTh > 0) || !Number.isFinite(usdPerTh)) return null;
  return { usdPerTh, fit: 'log_linear' };
}

/** Test helper */
export function clearGoMiningMarketplaceCache(): void {
  collectionsCache = null;
}
