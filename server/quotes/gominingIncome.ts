/**
 * GoMining live pool income + maintenance fee rates + optional GoBTC Pay.
 *
 * Official in-app (sat/TH/day):
 *   Net = PR + GBP − C1 − C2
 *   (discount applied to both Electricity C1 and Service C2)
 *
 * Docs:
 *   https://docs.gomining.com/en/product/miners/about
 *   https://docs.gomining.com/en/product/miners/maintenance-fees-and-discounts
 *   https://docs.gomining.com/en/product/miners/rewards
 *
 * Fetches GoMining’s public aggregation of the latest daily payout / fee snapshot.
 * Never invents rates. GoBTC Pay (GBP) is included when the payload exposes it;
 * otherwise 0 with an explicit note (product is rolling out gradually).
 *
 * Fallback for Pool Reward when this feed fails: Academy share-of-network
 *   (TH / networkTH) × dailyIssuance — requires live network EH/s (see hashrate.ts).
 */

export type GoMiningIncomeStatus = 'ok' | 'unavailable';

export type GoMiningIncomeSource = 'gomining_api' | 'stub';

export interface GoMiningIncomeQuote {
  /** Gross pool income USD per TH per day (totalIncomePerThToday). */
  poolIncomeUsdPerTh: number | null;
  /** Gross pool income BTC per TH per day (usd ÷ btcCourseInUsd from same snapshot). */
  poolIncomeBtcPerTh: number | null;
  /** Satoshis per TH per day (btc × 1e8), for UI. */
  poolIncomeSatPerTh: number | null;
  /** BTC/USD used by GoMining for this payout snapshot. */
  btcCourseInUsd: number | null;
  /** Electricity: USD per TH per day per W/TH (c1ValuePerThPerWtToday). Docs: kWh×24/1000. */
  electricityUsdPerThPerWt: number | null;
  /** Service: USD per TH per day (c2ValuePerThToday). Docs: $0.0089. */
  serviceUsdPerTh: number | null;
  /** Implied kWh USD from electricity rate when present: c1 × 1000 / 24. */
  impliedKwhCostUsd: number | null;
  /**
   * GoBTC Pay bonus sat/TH/day when API exposes a field; else 0.
   * In-app label “GBP” / “GoBTC Pay reward”.
   */
  goBtcPaySatPerTh: number;
  /** GoBTC Pay BTC/TH/day (sat / 1e8). */
  goBtcPayBtcPerTh: number;
  /** Whether GBP came from API or defaulted to 0. */
  goBtcPayStatus: 'ok' | 'unavailable';
  goBtcPayMessage: string | null;
  status: GoMiningIncomeStatus;
  source: GoMiningIncomeSource;
  asOf: string | null;
  message: string | null;
  /** Raw GoMining record id when present. */
  recordId: number | null;
}

const CACHE_MS = 60_000;
const FETCH_MS = 12_000;
const UA = 'PortfolioTracker/1.0 (local NZD portfolio; +https://localhost)';
const SATS_PER_BTC = 1e8;

/** Public, unauthenticated. Empty JSON body. */
const GOMINING_INCOME_URL =
  'https://api.gomining.com/api/nft-income-aggregation/get-last';

let cache: { at: number; quote: GoMiningIncomeQuote } | null = null;

function positiveNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonNegNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Try known / plausible GoBTC Pay field names; never invent a rate. */
function parseGoBtcPay(
  data: Record<string, unknown>,
  btcCourse: number | null,
): { sat: number; btc: number; status: 'ok' | 'unavailable'; message: string | null } {
  const keysSat = [
    'goBtcPaySatPerThToday',
    'goBtcPaySatPerTh',
    'gbpSatPerThToday',
    'gbpSatPerTh',
    'goBtcPayRewardSatPerThToday',
  ];
  const keysBtc = [
    'goBtcPayBtcPerThToday',
    'goBtcPayBtcPerTh',
    'gbpBtcPerThToday',
    'gbpBtcPerTh',
  ];
  const keysUsd = [
    'goBtcPayUsdPerThToday',
    'goBtcPayUsdPerTh',
    'gbpUsdPerThToday',
    'gbpValuePerThToday',
    'totalGoBtcPayPerThToday',
  ];

  for (const k of keysSat) {
    const v = nonNegNum(data[k]);
    if (v != null) {
      return {
        sat: v,
        btc: v / SATS_PER_BTC,
        status: 'ok',
        message: `GoBTC Pay from API field ${k}`,
      };
    }
  }
  for (const k of keysBtc) {
    const v = nonNegNum(data[k]);
    if (v != null) {
      return {
        sat: v * SATS_PER_BTC,
        btc: v,
        status: 'ok',
        message: `GoBTC Pay from API field ${k}`,
      };
    }
  }
  for (const k of keysUsd) {
    const v = nonNegNum(data[k]);
    if (v != null && btcCourse != null && btcCourse > 0) {
      const btc = v / btcCourse;
      return {
        sat: btc * SATS_PER_BTC,
        btc,
        status: 'ok',
        message: `GoBTC Pay from API field ${k} (USD→BTC via btcCourseInUsd)`,
      };
    }
  }

  return {
    sat: 0,
    btc: 0,
    status: 'unavailable',
    message:
      'GoBTC Pay (GBP) not in nft-income-aggregation payload — using 0 (never invent). In-app may show a small bonus when live.',
  };
}

function unavailable(asOf: string, message: string): GoMiningIncomeQuote {
  return {
    poolIncomeUsdPerTh: null,
    poolIncomeBtcPerTh: null,
    poolIncomeSatPerTh: null,
    btcCourseInUsd: null,
    electricityUsdPerThPerWt: null,
    serviceUsdPerTh: null,
    impliedKwhCostUsd: null,
    goBtcPaySatPerTh: 0,
    goBtcPayBtcPerTh: 0,
    goBtcPayStatus: 'unavailable',
    goBtcPayMessage:
      'GoBTC Pay unavailable (income feed down) — GBP = 0 (never invent)',
    status: 'unavailable',
    source: 'stub',
    asOf,
    message,
    recordId: null,
  };
}

export async function fetchGoMiningIncome(force = false): Promise<GoMiningIncomeQuote> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return cache.quote;
  }

  const asOf = new Date().toISOString();

  try {
    const res = await fetch(GOMINING_INCOME_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': UA,
      },
      body: '{}',
      signal: AbortSignal.timeout(FETCH_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      const snippet = text.replace(/\s+/g, ' ').slice(0, 160);
      const quote = unavailable(
        asOf,
        `GoMining income HTTP ${res.status}${snippet ? `: ${snippet}` : ''} — pool reward stubbed (never invent).`,
      );
      cache = { at: Date.now(), quote };
      return quote;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      const quote = unavailable(asOf, 'GoMining income returned non-JSON — pool reward stubbed.');
      cache = { at: Date.now(), quote };
      return quote;
    }

    const root = parsed as { data?: Record<string, unknown> };
    const data = root.data;
    if (!data || typeof data !== 'object') {
      const quote = unavailable(asOf, 'GoMining income missing data — pool reward stubbed.');
      cache = { at: Date.now(), quote };
      return quote;
    }

    const poolUsd = positiveNum(data.totalIncomePerThToday);
    const btcCourse = positiveNum(data.btcCourseInUsd);
    const c1 = positiveNum(data.c1ValuePerThPerWtToday);
    const c2 = positiveNum(data.c2ValuePerThToday);
    const recordId =
      typeof data.id === 'number' && Number.isFinite(data.id) ? data.id : null;
    const createdAt =
      typeof data.createdAt === 'string' && data.createdAt ? data.createdAt : asOf;

    if (poolUsd == null) {
      const quote = unavailable(
        createdAt,
        'GoMining income missing totalIncomePerThToday — pool reward stubbed (never invent).',
      );
      cache = { at: Date.now(), quote };
      return quote;
    }

    const poolBtc =
      btcCourse != null && btcCourse > 0 ? poolUsd / btcCourse : null;
    const poolSat = poolBtc != null ? poolBtc * SATS_PER_BTC : null;
    const impliedKwh = c1 != null ? (c1 * 1000) / 24 : null;
    const gbp = parseGoBtcPay(data, btcCourse);

    const quote: GoMiningIncomeQuote = {
      poolIncomeUsdPerTh: poolUsd,
      poolIncomeBtcPerTh: poolBtc,
      poolIncomeSatPerTh: poolSat,
      btcCourseInUsd: btcCourse,
      electricityUsdPerThPerWt: c1,
      serviceUsdPerTh: c2,
      impliedKwhCostUsd: impliedKwh,
      goBtcPaySatPerTh: gbp.sat,
      goBtcPayBtcPerTh: gbp.btc,
      goBtcPayStatus: gbp.status,
      goBtcPayMessage: gbp.message,
      status: 'ok',
      source: 'gomining_api',
      asOf: createdAt,
      message: `Live GoMining pool income · ${poolSat != null ? `${poolSat.toFixed(2)} sat/TH` : `$${poolUsd.toFixed(6)}/TH`} (nft-income-aggregation)${gbp.status === 'ok' && gbp.sat > 0 ? ` · GBP ${gbp.sat.toFixed(4)} sat/TH` : ' · GBP=0'}`,
      recordId,
    };
    cache = { at: Date.now(), quote };
    return quote;
  } catch (err) {
    const quote = unavailable(
      asOf,
      `GoMining income fetch failed: ${(err as Error).message} — pool reward stubbed (never invent).`,
    );
    cache = { at: Date.now(), quote };
    return quote;
  }
}

/** Test helper — clears in-memory cache. */
export function clearGoMiningIncomeCache(): void {
  cache = null;
}
