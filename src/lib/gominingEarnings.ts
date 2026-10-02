/**
 * GoMining digital-miner earnings estimate (model, not market price).
 *
 * Official in-app formulas (sat per 1 TH/s per day), verified 2026-10-01 vs screenshots:
 *
 *   Net sat/TH/day = PR + GBP − C1 − C2
 *
 * Electricity C1 (sat/TH/day, after discount):
 *   C1 = (0.05 × 24 × EE / BTC_USD / 1000) × 1e8 × (1 − Discount%)
 *   (kWh $0.05 as shown in app, or API-implied / settings override)
 *
 * Service C2 (sat/TH/day, after discount):
 *   C2 = (0.0089 / BTC_USD) × 1e8 × (1 − Discount%)
 *
 * Discount % applies to **both** Electricity (C1) and Service (C2), not service only.
 * User sets combined VIP + Service-button + solo discount in app settings.
 *
 * Pool Reward (PR): live GoMining income API only — never invent sat/TH.
 *   poolIncomeBtcPerTh × TH  (from nft-income-aggregation totalIncomePerThToday)
 *
 * GoBTC Pay (GBP): bonus sat/TH when API exposes it; else 0 with note.
 *   In-app: “GoBTC Pay reward” — launches gradually; often ~0 today.
 *
 * Portfolio totals = per-TH figures × miner TH (computing power).
 *
 * Docs:
 *   https://docs.gomining.com/en/product/miners/about
 *   https://docs.gomining.com/en/product/miners/maintenance-fees-and-discounts
 *   https://docs.gomining.com/en/product/miners/rewards
 *
 * Periods (linear scale of the daily model):
 *   day = ×1, week = ×7, month = ×(365.25/12), year = ×365.25
 */

/** Documented GoMining service fee: USD per TH per day. */
export const GOMINING_SERVICE_USD_PER_TH_DAY = 0.0089;

/**
 * App-default data-centre kWh (screenshot / API c1 implies $0.05).
 * Docs also publish a $0.05–$0.07 range; we default to the app’s $0.05.
 */
export const GOMINING_DEFAULT_KWH_USD = 0.05;

/**
 * Bitcoin daily issuance until next halving: 3.125 BTC/block × ~144 blocks/day.
 * Protocol constant — Academy network-share fallback only.
 */
export const BTC_DAILY_ISSUANCE_DEFAULT = 3.125 * 144; // 450

const SATS_PER_BTC = 1e8;

/** Calendar-day multipliers from the daily estimate (documented approximations). */
export const PERIOD_DAYS = {
  day: 1,
  week: 7,
  month: 365.25 / 12, // ~30.4375
  year: 365.25,
} as const;

export type EarningsPeriod = keyof typeof PERIOD_DAYS;

export interface EarningsPeriodSlice {
  days: number;
  /** Net BTC for period if daily net known; else null */
  netBtc: number | null;
  /** Pool BTC for period if daily pool known */
  poolBtc: number | null;
  /** Maintenance USD after discount for period */
  maintenanceUsd: number | null;
  /** Fiat conversions from netBtc (or poolBtc fallback) — null if FX unavailable */
  netUsd: number | null;
  netNzd: number | null;
  poolUsd: number | null;
  poolNzd: number | null;
}

export type EarningsPeriods = Record<EarningsPeriod, EarningsPeriodSlice>;

/** Real BTC FX only — never invent. Null sides stay null. */
export interface BtcFxRates {
  btcUsd: number | null;
  btcNzd: number | null;
  source?: string | null;
  asOf?: string | null;
  status?: 'ok' | 'unavailable' | 'stubbed';
  message?: string | null;
}

function fiatFromBtc(btc: number | null, rate: number | null): number | null {
  if (btc == null || rate == null || !(rate > 0)) return null;
  return btc * rate;
}

export function scalePeriods(
  netBtcPerDay: number | null,
  poolRewardBtcPerDay: number | null,
  maintenanceUsdAfterDiscount: number | null,
  fx?: BtcFxRates | null,
): EarningsPeriods {
  const usd = fx?.btcUsd ?? null;
  const nzd = fx?.btcNzd ?? null;
  const out = {} as EarningsPeriods;
  for (const key of Object.keys(PERIOD_DAYS) as EarningsPeriod[]) {
    const days = PERIOD_DAYS[key];
    const netBtc = netBtcPerDay != null ? netBtcPerDay * days : null;
    const poolBtc = poolRewardBtcPerDay != null ? poolRewardBtcPerDay * days : null;
    out[key] = {
      days,
      netBtc,
      poolBtc,
      maintenanceUsd:
        maintenanceUsdAfterDiscount != null ? maintenanceUsdAfterDiscount * days : null,
      netUsd: fiatFromBtc(netBtc, usd),
      netNzd: fiatFromBtc(netBtc, nzd),
      poolUsd: fiatFromBtc(poolBtc, usd),
      poolNzd: fiatFromBtc(poolBtc, nzd),
    };
  }
  return out;
}

export type EarningsDisplayCurrency = 'BTC' | 'USD' | 'NZD' | 'ALL';

export function formatEarningsAmount(
  slice: EarningsPeriodSlice,
  currency: 'BTC' | 'USD' | 'NZD',
  preferNet: boolean,
): string {
  if (currency === 'BTC') {
    const btc = preferNet ? slice.netBtc : slice.poolBtc ?? slice.netBtc;
    return btc == null ? '—' : `${formatBtc(btc)} BTC`;
  }
  if (currency === 'USD') {
    const shown = preferNet ? (slice.netUsd ?? slice.poolUsd) : slice.poolUsd;
    return shown == null
      ? '—'
      : `$${shown.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
  }
  const shown = preferNet ? (slice.netNzd ?? slice.poolNzd) : slice.poolNzd;
  return shown == null
    ? '—'
    : `NZ$${shown.toLocaleString('en-NZ', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

export interface GoMiningNetworkParams {
  /** BTC/USD — required to express C1/C2 in sat; never invent. Prefer GoMining course. */
  btcUsd: number | null;
  /**
   * Live GoMining pool gross USD/TH/day (preferred for Pool Reward / PR).
   * From nft-income-aggregation totalIncomePerThToday — never invent.
   */
  poolIncomeUsdPerTh: number | null;
  /**
   * Live GoMining pool gross BTC/TH/day (preferred).
   * Usually usdPerTh ÷ GoMining btcCourseInUsd from the same snapshot.
   */
  poolIncomeBtcPerTh: number | null;
  /**
   * GoBTC Pay bonus BTC/TH/day when API exposes it; else null → treated as 0.
   */
  goBtcPayBtcPerTh: number | null;
  /**
   * GoBTC Pay bonus sat/TH/day (convenience); else null → 0.
   */
  goBtcPaySatPerTh: number | null;
  /**
   * Network hashrate in EH/s — Academy fallback for pool reward when GoMining
   * income feed is unavailable; never invent.
   */
  networkHashrateEhs: number | null;
  /** Override daily BTC issuance; null → protocol default 450. */
  dailyBtcIssuance: number | null;
  /** Electricity $/kWh; null → app default 0.05 (or caller may pass API-implied). */
  kWhCostUsd: number | null;
}

export interface GoMiningMinerEarningsInput {
  hashrateThs: number;
  energyEfficiencyWth: number | null;
  /** Combined maintenance discount 0–100 (VIP + Service button + solo). */
  discountPct: number;
  network: GoMiningNetworkParams;
  /** Live BTC/USD + BTC/NZD — never invent; optional for fiat display */
  fx?: BtcFxRates | null;
}

export type EarningsPartStatus = 'ok' | 'stubbed' | 'unavailable';

export interface GoMiningEarningsEstimate {
  label: 'estimate';
  /** Combined discount applied to C1 and C2 (0–1 fraction used in math). */
  discountPct: number;
  discountFraction: number;
  kWhCostUsd: number;
  kWhCostSource: 'settings' | 'docs_default';
  dailyBtcIssuance: number;
  dailyBtcIssuanceSource: 'settings' | 'protocol_default';

  electricityUsdPerDay: number | null;
  electricityUsdStatus: EarningsPartStatus;
  electricityUsdMessage: string | null;

  serviceUsdPerDay: number | null;
  serviceUsdStatus: EarningsPartStatus;
  serviceUsdMessage: string | null;

  maintenanceUsdPerDay: number | null;
  maintenanceUsdAfterDiscount: number | null;
  maintenanceUsdStatus: EarningsPartStatus;

  electricityBtcPerDay: number | null;
  serviceBtcPerDay: number | null;
  maintenanceBtcPerDay: number | null;
  maintenanceBtcAfterDiscount: number | null;
  maintenanceBtcStatus: EarningsPartStatus;
  maintenanceBtcMessage: string | null;

  /** Per-TH sat breakdown (matches GoMining app Reward panel). */
  poolRewardSatPerTh: number | null;
  goBtcPaySatPerTh: number;
  goBtcPayStatus: EarningsPartStatus;
  goBtcPayMessage: string | null;
  /** C1 after discount, sat/TH/day */
  electricitySatPerThAfterDiscount: number | null;
  /** C2 after discount, sat/TH/day */
  serviceSatPerThAfterDiscount: number | null;
  /** Net sat/TH/day = PR + GBP − C1 − C2 */
  netSatPerTh: number | null;

  poolRewardBtcPerDay: number | null;
  goBtcPayBtcPerDay: number;
  poolRewardStatus: EarningsPartStatus;
  poolRewardMessage: string | null;
  /** How pool BTC was derived when status ok. */
  poolRewardSource: 'gomining_income' | 'network_share' | null;

  netBtcPerDay: number | null;
  netBtcStatus: EarningsPartStatus;
  netBtcMessage: string | null;

  /** Short human summary for cards */
  summary: string;
  /** Day / week / month / year scaled from daily estimate */
  periods: EarningsPeriods;
}

function finiteOrNull(n: unknown): number | null {
  if (n == null || n === '') return null;
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

export function clampDiscountPct(pct: number | null | undefined): number {
  const n = Number(pct);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

/**
 * Pure per-TH sat formulas matching the GoMining app (before × TH).
 * Returns null parts when required inputs missing — never invents PR.
 */
export function calcPerThSatDay(params: {
  energyEfficiencyWth: number | null;
  discountPct: number;
  btcUsd: number | null;
  kWhCostUsd: number;
  poolIncomeBtcPerTh: number | null;
  goBtcPaySatPerTh?: number | null;
}): {
  prSat: number | null;
  gbpSat: number;
  c1Sat: number | null;
  c2Sat: number | null;
  netSat: number | null;
} {
  const disc = 1 - clampDiscountPct(params.discountPct) / 100;
  const btc = finiteOrNull(params.btcUsd);
  const ee = finiteOrNull(params.energyEfficiencyWth);
  const gbpSat = Math.max(0, finiteOrNull(params.goBtcPaySatPerTh) ?? 0);

  let c1Sat: number | null = null;
  let c2Sat: number | null = null;
  if (btc != null && btc > 0) {
    c2Sat = (GOMINING_SERVICE_USD_PER_TH_DAY / btc) * SATS_PER_BTC * disc;
    if (ee != null && ee >= 0) {
      // C1 = (kWh × 24 × EE / BTC / 1000) × 1e8 × (1 − Discount%)
      c1Sat =
        ((params.kWhCostUsd * 24 * ee) / btc / 1000) * SATS_PER_BTC * disc;
    }
  }

  const poolBtc = finiteOrNull(params.poolIncomeBtcPerTh);
  const prSat =
    poolBtc != null && poolBtc > 0 ? poolBtc * SATS_PER_BTC : null;

  let netSat: number | null = null;
  if (prSat != null && c1Sat != null && c2Sat != null) {
    netSat = prSat + gbpSat - c1Sat - c2Sat;
  }

  return { prSat, gbpSat, c1Sat, c2Sat, netSat };
}

/**
 * Pure earnings estimate. Missing EE → electricity stubbed; missing GoMining pool
 * income and network EH/s → pool/net stubbed. Never fabricates BTC/USD, sat/TH, or EH/s.
 *
 * Net = (PR + GBP − C1 − C2) × TH   with C1/C2 already discount-adjusted.
 */
export function estimateMinerEarnings(input: GoMiningMinerEarningsInput): GoMiningEarningsEstimate {
  const th = Number(input.hashrateThs);
  const ee = finiteOrNull(input.energyEfficiencyWth);
  const discountPct = clampDiscountPct(input.discountPct);
  const discountFraction = discountPct / 100;
  const kWhFromSettings = finiteOrNull(input.network.kWhCostUsd);
  const kWhCostUsd = kWhFromSettings ?? GOMINING_DEFAULT_KWH_USD;
  const kWhCostSource = kWhFromSettings != null ? 'settings' : 'docs_default';
  const issuanceFromSettings = finiteOrNull(input.network.dailyBtcIssuance);
  const dailyBtcIssuance = issuanceFromSettings ?? BTC_DAILY_ISSUANCE_DEFAULT;
  const dailyBtcIssuanceSource =
    issuanceFromSettings != null ? 'settings' : 'protocol_default';
  const manualBtcUsd = finiteOrNull(input.network.btcUsd);
  const liveBtcUsd = finiteOrNull(input.fx?.btcUsd);
  // Prefer caller-supplied (GoMining course or manual) for C1/C2; else live FX.
  const btcUsd = manualBtcUsd ?? liveBtcUsd;
  const fxForDisplay: BtcFxRates | null = input.fx
    ? {
        btcUsd: input.fx.btcUsd ?? manualBtcUsd,
        btcNzd: input.fx.btcNzd ?? null,
        source: input.fx.source,
        asOf: input.fx.asOf,
        status: input.fx.status,
      }
    : manualBtcUsd != null
      ? { btcUsd: manualBtcUsd, btcNzd: null, source: 'manual', status: 'ok' }
      : null;
  const networkEhs = finiteOrNull(input.network.networkHashrateEhs);
  const poolIncomeBtcPerTh = finiteOrNull(input.network.poolIncomeBtcPerTh);
  const poolIncomeUsdPerTh = finiteOrNull(input.network.poolIncomeUsdPerTh);

  const gbpSatRaw = finiteOrNull(input.network.goBtcPaySatPerTh);
  const gbpBtcRaw = finiteOrNull(input.network.goBtcPayBtcPerTh);
  let goBtcPaySatPerTh = 0;
  let goBtcPayStatus: EarningsPartStatus = 'stubbed';
  let goBtcPayMessage: string | null =
    'GoBTC Pay not in income API — GBP = 0 (in-app reward; never invent)';
  if (gbpSatRaw != null && gbpSatRaw >= 0) {
    goBtcPaySatPerTh = gbpSatRaw;
    goBtcPayStatus = 'ok';
    goBtcPayMessage = null;
  } else if (gbpBtcRaw != null && gbpBtcRaw >= 0) {
    goBtcPaySatPerTh = gbpBtcRaw * SATS_PER_BTC;
    goBtcPayStatus = 'ok';
    goBtcPayMessage = null;
  }

  const base: Omit<
    GoMiningEarningsEstimate,
    | 'summary'
    | 'periods'
    | 'electricityUsdPerDay'
    | 'electricityUsdStatus'
    | 'electricityUsdMessage'
    | 'serviceUsdPerDay'
    | 'serviceUsdStatus'
    | 'serviceUsdMessage'
    | 'maintenanceUsdPerDay'
    | 'maintenanceUsdAfterDiscount'
    | 'maintenanceUsdStatus'
    | 'electricityBtcPerDay'
    | 'serviceBtcPerDay'
    | 'maintenanceBtcPerDay'
    | 'maintenanceBtcAfterDiscount'
    | 'maintenanceBtcStatus'
    | 'maintenanceBtcMessage'
    | 'poolRewardSatPerTh'
    | 'goBtcPaySatPerTh'
    | 'goBtcPayStatus'
    | 'goBtcPayMessage'
    | 'electricitySatPerThAfterDiscount'
    | 'serviceSatPerThAfterDiscount'
    | 'netSatPerTh'
    | 'poolRewardBtcPerDay'
    | 'goBtcPayBtcPerDay'
    | 'poolRewardStatus'
    | 'poolRewardMessage'
    | 'poolRewardSource'
    | 'netBtcPerDay'
    | 'netBtcStatus'
    | 'netBtcMessage'
  > = {
    label: 'estimate',
    discountPct,
    discountFraction,
    kWhCostUsd,
    kWhCostSource,
    dailyBtcIssuance,
    dailyBtcIssuanceSource,
  };

  const emptyPeriods = () => scalePeriods(null, null, null, fxForDisplay);

  if (!Number.isFinite(th) || th <= 0) {
    return {
      ...base,
      electricityUsdPerDay: null,
      electricityUsdStatus: 'unavailable',
      electricityUsdMessage: 'Hashrate (TH/s) required',
      serviceUsdPerDay: null,
      serviceUsdStatus: 'unavailable',
      serviceUsdMessage: 'Hashrate (TH/s) required',
      maintenanceUsdPerDay: null,
      maintenanceUsdAfterDiscount: null,
      maintenanceUsdStatus: 'unavailable',
      electricityBtcPerDay: null,
      serviceBtcPerDay: null,
      maintenanceBtcPerDay: null,
      maintenanceBtcAfterDiscount: null,
      maintenanceBtcStatus: 'unavailable',
      maintenanceBtcMessage: 'Hashrate (TH/s) required',
      poolRewardSatPerTh: null,
      goBtcPaySatPerTh,
      goBtcPayStatus,
      goBtcPayMessage,
      electricitySatPerThAfterDiscount: null,
      serviceSatPerThAfterDiscount: null,
      netSatPerTh: null,
      poolRewardBtcPerDay: null,
      goBtcPayBtcPerDay: (goBtcPaySatPerTh / SATS_PER_BTC) * Math.max(th, 0),
      poolRewardStatus: 'unavailable',
      poolRewardMessage: 'Hashrate (TH/s) required',
      poolRewardSource: null,
      netBtcPerDay: null,
      netBtcStatus: 'unavailable',
      netBtcMessage: 'Hashrate (TH/s) required',
      summary: 'Estimate unavailable — enter hashrate',
      periods: emptyPeriods(),
    };
  }

  // Service USD always computable from TH (docs constant).
  const serviceUsdPerDayGross = GOMINING_SERVICE_USD_PER_TH_DAY * th;
  const serviceUsdPerDay = serviceUsdPerDayGross * (1 - discountFraction);

  let electricityUsdPerDayGross: number | null = null;
  let electricityUsdPerDay: number | null = null;
  let electricityUsdStatus: EarningsPartStatus = 'stubbed';
  let electricityUsdMessage: string | null =
    'Energy efficiency (W/TH) missing — electricity stubbed';
  if (ee != null && ee >= 0) {
    // (kWh × 24 / 1000) × W/TH × TH = kWh/day × $/kWh
    electricityUsdPerDayGross = ((kWhCostUsd * 24) / 1000) * ee * th;
    electricityUsdPerDay = electricityUsdPerDayGross * (1 - discountFraction);
    electricityUsdStatus = 'ok';
    electricityUsdMessage = null;
  }

  let maintenanceUsdPerDay: number | null = null;
  let maintenanceUsdAfterDiscount: number | null = null;
  let maintenanceUsdStatus: EarningsPartStatus = 'stubbed';
  if (electricityUsdPerDayGross != null) {
    maintenanceUsdPerDay = electricityUsdPerDayGross + serviceUsdPerDayGross;
    // Discount on both C1 and C2 (same as × (1 − d) on the sum).
    maintenanceUsdAfterDiscount = maintenanceUsdPerDay * (1 - discountFraction);
    maintenanceUsdStatus = 'ok';
  }

  let electricityBtcPerDay: number | null = null;
  let serviceBtcPerDay: number | null = null;
  let maintenanceBtcPerDay: number | null = null;
  let maintenanceBtcAfterDiscount: number | null = null;
  let maintenanceBtcStatus: EarningsPartStatus = 'unavailable';
  let maintenanceBtcMessage: string | null = 'BTC/USD not set — maintenance in BTC stubbed';

  let electricitySatPerThAfterDiscount: number | null = null;
  let serviceSatPerThAfterDiscount: number | null = null;

  if (btcUsd != null && btcUsd > 0) {
    const serviceBtcGross = serviceUsdPerDayGross / btcUsd;
    serviceBtcPerDay = serviceBtcGross * (1 - discountFraction);
    serviceSatPerThAfterDiscount =
      (GOMINING_SERVICE_USD_PER_TH_DAY / btcUsd) * SATS_PER_BTC * (1 - discountFraction);
    if (electricityUsdPerDayGross != null && ee != null) {
      const elecBtcGross = electricityUsdPerDayGross / btcUsd;
      electricityBtcPerDay = elecBtcGross * (1 - discountFraction);
      maintenanceBtcPerDay = elecBtcGross + serviceBtcGross;
      maintenanceBtcAfterDiscount = maintenanceBtcPerDay * (1 - discountFraction);
      electricitySatPerThAfterDiscount =
        ((kWhCostUsd * 24 * ee) / btcUsd / 1000) * SATS_PER_BTC * (1 - discountFraction);
      maintenanceBtcStatus = 'ok';
      maintenanceBtcMessage = null;
    } else {
      maintenanceBtcStatus = 'stubbed';
      maintenanceBtcMessage =
        'Energy efficiency missing — only service fee convertible to BTC';
    }
  }

  let poolRewardBtcPerDay: number | null = null;
  let poolRewardSatPerTh: number | null = null;
  let poolRewardStatus: EarningsPartStatus = 'unavailable';
  let poolRewardMessage: string | null =
    'GoMining pool income unavailable and network EH/s not set — pool reward stubbed (never invent)';
  let poolRewardSource: 'gomining_income' | 'network_share' | null = null;

  // Preferred: GoMining official daily pool payouts per TH (income aggregation).
  if (poolIncomeBtcPerTh != null && poolIncomeBtcPerTh > 0) {
    poolRewardBtcPerDay = poolIncomeBtcPerTh * th;
    poolRewardSatPerTh = poolIncomeBtcPerTh * SATS_PER_BTC;
    poolRewardStatus = 'ok';
    poolRewardSource = 'gomining_income';
    poolRewardMessage = null;
  } else if (
    poolIncomeUsdPerTh != null &&
    poolIncomeUsdPerTh > 0 &&
    btcUsd != null &&
    btcUsd > 0
  ) {
    const btcPerTh = poolIncomeUsdPerTh / btcUsd;
    poolRewardBtcPerDay = btcPerTh * th;
    poolRewardSatPerTh = btcPerTh * SATS_PER_BTC;
    poolRewardStatus = 'ok';
    poolRewardSource = 'gomining_income';
    poolRewardMessage = null;
  } else if (networkEhs != null && networkEhs > 0) {
    // Fallback: Academy share-of-network (only when GoMining income missing).
    const networkThs = networkEhs * 1e6; // 1 EH/s = 1e6 TH/s
    poolRewardBtcPerDay = (th / networkThs) * dailyBtcIssuance;
    poolRewardSatPerTh = (poolRewardBtcPerDay / th) * SATS_PER_BTC;
    poolRewardStatus = 'ok';
    poolRewardSource = 'network_share';
    poolRewardMessage =
      'Pool via Academy network-share fallback (GoMining income feed unavailable)';
  }

  const goBtcPayBtcPerDay = (goBtcPaySatPerTh / SATS_PER_BTC) * th;

  let netBtcPerDay: number | null = null;
  let netSatPerTh: number | null = null;
  let netBtcStatus: EarningsPartStatus = 'unavailable';
  let netBtcMessage: string | null = null;

  // Net = PR + GBP − C1 − C2  (C1/C2 already after discount)
  if (
    poolRewardBtcPerDay != null &&
    maintenanceBtcAfterDiscount != null &&
    electricitySatPerThAfterDiscount != null &&
    serviceSatPerThAfterDiscount != null &&
    poolRewardSatPerTh != null
  ) {
    netSatPerTh =
      poolRewardSatPerTh +
      goBtcPaySatPerTh -
      electricitySatPerThAfterDiscount -
      serviceSatPerThAfterDiscount;
    netBtcPerDay = (netSatPerTh / SATS_PER_BTC) * th;
    // Equivalent: pool + gbp − maintenanceAfterDiscount
    // (keep sat path as source of truth to match app rounding intent)
    netBtcStatus = 'ok';
    netBtcMessage = null;
  } else if (poolRewardBtcPerDay != null && maintenanceBtcStatus !== 'ok') {
    netBtcStatus = 'stubbed';
    netBtcMessage =
      'Pool reward ok but maintenance BTC incomplete (need BTC/USD + energy efficiency)';
  } else if (maintenanceBtcAfterDiscount != null && poolRewardStatus !== 'ok') {
    netBtcStatus = 'stubbed';
    netBtcMessage =
      'Maintenance ok but pool reward stubbed (need GoMining pool income or network EH/s)';
  } else {
    netBtcStatus = 'unavailable';
    netBtcMessage =
      'Need GoMining pool income (or network EH/s) + BTC/USD + energy efficiency for net estimate';
  }

  const summaryParts: string[] = [];
  if (netBtcPerDay != null && netSatPerTh != null) {
    summaryParts.push(
      `~${netSatPerTh.toFixed(4)} sat/TH net · ${formatBtc(netBtcPerDay)} BTC/day (est.)`,
    );
  } else if (poolRewardBtcPerDay != null) {
    summaryParts.push(`~${formatBtc(poolRewardBtcPerDay)} BTC/day pool (est.)`);
  }
  if (maintenanceUsdAfterDiscount != null) {
    summaryParts.push(
      `maint. ~$${maintenanceUsdAfterDiscount.toFixed(4)}/day` +
        (discountPct > 0 ? ` (−${discountPct}% on C1+C2)` : ''),
    );
  } else if (serviceUsdPerDay != null && electricityUsdStatus === 'stubbed') {
    summaryParts.push(`service ~$${serviceUsdPerDay.toFixed(4)}/day · EE needed`);
  }
  if (goBtcPayStatus !== 'ok') {
    summaryParts.push('GBP=0');
  } else if (goBtcPaySatPerTh > 0) {
    summaryParts.push(`GBP ${goBtcPaySatPerTh.toFixed(4)} sat/TH`);
  }
  if (summaryParts.length === 0) {
    summaryParts.push('Estimate stubbed — set EE / network params');
  }

  return {
    ...base,
    electricityUsdPerDay,
    electricityUsdStatus,
    electricityUsdMessage,
    serviceUsdPerDay,
    serviceUsdStatus: 'ok',
    serviceUsdMessage: null,
    maintenanceUsdPerDay,
    maintenanceUsdAfterDiscount,
    maintenanceUsdStatus,
    electricityBtcPerDay,
    serviceBtcPerDay,
    maintenanceBtcPerDay,
    maintenanceBtcAfterDiscount,
    maintenanceBtcStatus,
    maintenanceBtcMessage,
    poolRewardSatPerTh,
    goBtcPaySatPerTh,
    goBtcPayStatus,
    goBtcPayMessage,
    electricitySatPerThAfterDiscount,
    serviceSatPerThAfterDiscount,
    netSatPerTh,
    poolRewardBtcPerDay,
    goBtcPayBtcPerDay,
    poolRewardStatus,
    poolRewardMessage,
    poolRewardSource,
    netBtcPerDay,
    netBtcStatus,
    netBtcMessage,
    summary: summaryParts.join(' · '),
    periods: scalePeriods(netBtcPerDay, poolRewardBtcPerDay, maintenanceUsdAfterDiscount, fxForDisplay),
  };
}

export function formatBtc(n: number, digits = 8): string {
  if (!Number.isFinite(n)) return '—';
  const s = n.toFixed(digits);
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** Aggregate section totals from per-miner estimates. */
export function aggregateMinerEarnings(
  estimates: GoMiningEarningsEstimate[],
  fx?: BtcFxRates | null,
): {
  netBtcPerDay: number | null;
  maintenanceUsdAfterDiscount: number | null;
  poolRewardBtcPerDay: number | null;
  goBtcPayBtcPerDay: number;
  anyCompleteNet: boolean;
  periods: EarningsPeriods;
} {
  let net = 0;
  let maint = 0;
  let pool = 0;
  let gbp = 0;
  let hasNet = false;
  let hasMaint = false;
  let hasPool = false;
  for (const e of estimates) {
    if (e.netBtcPerDay != null) {
      net += e.netBtcPerDay;
      hasNet = true;
    }
    if (e.maintenanceUsdAfterDiscount != null) {
      maint += e.maintenanceUsdAfterDiscount;
      hasMaint = true;
    }
    if (e.poolRewardBtcPerDay != null) {
      pool += e.poolRewardBtcPerDay;
      hasPool = true;
    }
    gbp += e.goBtcPayBtcPerDay ?? 0;
  }
  const netBtcPerDay = hasNet ? net : null;
  const maintenanceUsdAfterDiscount = hasMaint ? maint : null;
  const poolRewardBtcPerDay = hasPool ? pool : null;
  return {
    netBtcPerDay,
    maintenanceUsdAfterDiscount,
    poolRewardBtcPerDay,
    goBtcPayBtcPerDay: gbp,
    anyCompleteNet: hasNet,
    periods: scalePeriods(netBtcPerDay, poolRewardBtcPerDay, maintenanceUsdAfterDiscount, fx),
  };
}
