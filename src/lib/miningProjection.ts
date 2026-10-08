/**
 * GoMining mining projection (model, not a forecast).
 *
 * Month by month, using the same per-TH formula as the Portfolio page
 * (calcPerThSatDay: Net sat/TH/day = PR + GBP − C1 − C2, discount on C1 and C2):
 *   1. Daily net BTC for each tranche of TH at its own efficiency (W/TH), × days in a month.
 *   2. BTC → NZD at today's BTC/NZD, grown by the BTC price change the user sets.
 *   3. After the month: add the TH bought this month (a fixed amount, and/or rewards
 *      reinvested at the user's price per TH), at the efficiency the user sets for new TH.
 * Efficiency upgrades lower W/TH a little every month, for all TH (existing and added),
 * until MINING_MIN_WTH (12 W/TH, the lowest GoMining offers). The monthly upgrade cost is
 * charged only while some TH is still above that floor.
 *
 * Inputs that are not the user's own come from live GoMining / BTC feeds; when a feed is
 * missing the projection is not produced (never invents a reward).
 */

import { calcPerThSatDay, PERIOD_DAYS } from './gominingEarnings';

const SATS_PER_BTC = 1e8;

/** Lowest energy efficiency a GoMining miner can be upgraded to (W/TH). */
export const MINING_MIN_WTH = 12;
const DAYS_PER_MONTH = PERIOD_DAYS.month;

export type MiningRewardsTo = 'crypto' | 'cash' | 'reinvest';

export type MiningProjectionInput = {
  months: number;
  /** Current miners. */
  miners: Array<{ th: number; wth: number | null }>;
  /** Live pool reward BTC per TH per day. */
  poolBtcPerThDay: number;
  /** GoBTC Pay sat per TH per day (0 when the feed has none). */
  gbpSatPerThDay: number;
  /** BTC/USD used for fee conversion (manual override or GoMining payout course). */
  btcUsd: number;
  /** BTC/NZD for the NZD value of rewards. */
  btcNzd: number;
  kWhCostUsd: number;
  discountPct: number;
  /** Yearly change in BTC price, % (the projection's crypto return). */
  btcPriceChangePctYear: number;
  /** Yearly change in pool reward per TH, % (network growth usually makes this negative). */
  rewardChangePctYear: number;
  /** TH bought at the end of every month. */
  addThPerMonth: number;
  /** TH bought once, at the end of month 1. */
  addThOnce: number;
  /** W/TH of TH added; null = the fleet's current average. */
  newThWth: number | null;
  /** NZD per TH: prices bought TH and converts reinvested rewards into TH. */
  thPriceNzd: number | null;
  /** W/TH taken off every month by upgrades (0 = none), down to MINING_MIN_WTH. */
  wthDropPerMonth: number;
  /** NZD spent on upgrades each month while W/TH is still above the floor. */
  upgradeCostPerMonthNzd: number;
  rewardsTo: MiningRewardsTo;
};

export type MiningMonth = {
  monthIndex: number;
  th: number;
  /** TH-weighted average W/TH during the month. */
  avgWth: number | null;
  netSatPerThDay: number;
  rewardBtc: number;
  rewardNzd: number;
  /** NZD spent on TH (fixed purchases) and upgrades this month. */
  spendNzd: number;
  /** NZD of rewards turned into TH this month. */
  reinvestedNzd: number;
  thAdded: number;
};

export type MiningProjection = {
  start: { th: number; avgWth: number | null; dailyNetBtc: number; monthlyNetBtc: number; monthlyNetNzd: number };
  months: MiningMonth[];
  totals: {
    rewardBtc: number;
    rewardNzd: number;
    spendNzd: number;
    reinvestedNzd: number;
    endTh: number;
    endAvgWth: number | null;
    /** Rewards with no added TH, no upgrade and no reinvesting (same price and reward changes). */
    baselineRewardNzd: number;
    /** rewardNzd − baselineRewardNzd. */
    increaseNzd: number;
    lastMonthRewardNzd: number;
  };
  notes: string[];
};

type Tranche = { th: number; wth: number | null };

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function avgWth(tranches: Tranche[]): number | null {
  let th = 0;
  let w = 0;
  for (const t of tranches) {
    if (t.wth == null || !(t.th > 0)) continue;
    th += t.th;
    w += t.th * t.wth;
  }
  return th > 0 ? w / th : null;
}

function totalTh(tranches: Tranche[]): number {
  return tranches.reduce((s, t) => s + (t.th > 0 ? t.th : 0), 0);
}

/** Daily net BTC for a fleet at a given BTC/USD and pool reward. */
function dailyNetBtc(tranches: Tranche[], input: MiningProjectionInput, btcUsd: number, poolBtc: number): number {
  let sat = 0;
  for (const t of tranches) {
    if (!(t.th > 0)) continue;
    const parts = calcPerThSatDay({
      energyEfficiencyWth: t.wth,
      discountPct: input.discountPct,
      btcUsd,
      kWhCostUsd: input.kWhCostUsd,
      poolIncomeBtcPerTh: poolBtc,
      goBtcPaySatPerTh: input.gbpSatPerThDay,
    });
    sat += (parts.netSat ?? 0) * t.th;
  }
  return sat / SATS_PER_BTC;
}

function run(input: MiningProjectionInput, withChanges: boolean): { months: MiningMonth[]; tranches: Tranche[] } {
  const startAvg = avgWth(input.miners);
  const tranches: Tranche[] = input.miners.filter((m) => m.th > 0).map((m) => ({ th: m.th, wth: m.wth ?? startAvg }));
  const newWth = input.newThWth ?? startAvg;
  const priceG = 1 + input.btcPriceChangePctYear / 100;
  const rewardG = 1 + input.rewardChangePctYear / 100;
  const months: MiningMonth[] = [];

  for (let m = 1; m <= input.months; m += 1) {
    const years = (m - 1) / 12;
    let spendNzd = 0;
    const btcUsd = input.btcUsd * priceG ** years;
    const btcNzd = input.btcNzd * priceG ** years;
    const poolBtc = input.poolBtcPerThDay * rewardG ** years;
    const th = totalTh(tranches);
    const dailyBtc = dailyNetBtc(tranches, input, btcUsd, poolBtc);
    const rewardBtc = dailyBtc * DAYS_PER_MONTH;
    const rewardNzd = rewardBtc * btcNzd;
    const fleetAvg = avgWth(tranches);

    let thAdded = 0;
    let reinvestedNzd = 0;
    if (withChanges) {
      const fixed = input.addThPerMonth + (m === 1 ? input.addThOnce : 0);
      if (fixed > 0) {
        thAdded += fixed;
        if (input.thPriceNzd != null && input.thPriceNzd > 0) spendNzd += fixed * input.thPriceNzd;
      }
      if (input.rewardsTo === 'reinvest' && rewardNzd > 0 && input.thPriceNzd != null && input.thPriceNzd > 0) {
        reinvestedNzd = rewardNzd;
        thAdded += rewardNzd / input.thPriceNzd;
      }
      if (thAdded > 0) tranches.push({ th: thAdded, wth: newWth == null ? null : Math.max(MINING_MIN_WTH, newWth) });
      // Upgrades at the end of the month: lower W/TH for every tranche, not below the floor.
      if (input.wthDropPerMonth > 0 && tranches.some((t) => t.wth != null && t.wth > MINING_MIN_WTH)) {
        for (const t of tranches) {
          if (t.wth != null) t.wth = Math.max(MINING_MIN_WTH, t.wth - input.wthDropPerMonth);
        }
        spendNzd += Math.max(0, input.upgradeCostPerMonthNzd);
      }
    }

    months.push({
      monthIndex: m,
      th: round(th, 4),
      avgWth: fleetAvg == null ? null : round(fleetAvg, 2),
      netSatPerThDay: th > 0 ? round((dailyBtc * SATS_PER_BTC) / th, 2) : 0,
      rewardBtc: round(rewardBtc, 8),
      rewardNzd: round(rewardNzd, 2),
      spendNzd: round(spendNzd, 2),
      reinvestedNzd: round(reinvestedNzd, 2),
      thAdded: round(thAdded, 4),
    });
  }
  return { months, tranches };
}

export function projectMining(input: MiningProjectionInput): MiningProjection {
  const withPlan = run(input, true);
  const baseline = run(input, false);
  const startTranches = input.miners.filter((m) => m.th > 0);
  const startDaily = dailyNetBtc(
    startTranches.map((t) => ({ th: t.th, wth: t.wth ?? avgWth(input.miners) })),
    input,
    input.btcUsd,
    input.poolBtcPerThDay,
  );
  const sum = (ms: MiningMonth[], k: keyof MiningMonth) => ms.reduce((s, x) => s + Number(x[k] ?? 0), 0);
  const rewardNzd = round(sum(withPlan.months, 'rewardNzd'), 2);
  const baselineRewardNzd = round(sum(baseline.months, 'rewardNzd'), 2);
  const endAvg = avgWth(withPlan.tranches);
  const notes: string[] = [];
  if (input.rewardsTo === 'reinvest' && !(input.thPriceNzd != null && input.thPriceNzd > 0)) {
    notes.push('Set a price per TH to reinvest rewards; until then rewards are not turned into TH.');
  }
  if ((input.addThPerMonth > 0 || input.addThOnce > 0) && !(input.thPriceNzd != null && input.thPriceNzd > 0)) {
    notes.push('No price per TH is set, so added TH has no cost in this projection.');
  }
  if (withPlan.months.some((m) => m.rewardNzd < 0)) {
    notes.push('Fees are more than the pool reward in some months, so those months show a loss.');
  }
  return {
    start: {
      th: round(totalTh(startTranches), 4),
      avgWth: avgWth(input.miners) == null ? null : round(avgWth(input.miners)!, 2),
      dailyNetBtc: round(startDaily, 8),
      monthlyNetBtc: round(startDaily * DAYS_PER_MONTH, 8),
      monthlyNetNzd: round(startDaily * DAYS_PER_MONTH * input.btcNzd, 2),
    },
    months: withPlan.months,
    totals: {
      rewardBtc: round(sum(withPlan.months, 'rewardBtc'), 8),
      rewardNzd,
      spendNzd: round(sum(withPlan.months, 'spendNzd'), 2),
      reinvestedNzd: round(sum(withPlan.months, 'reinvestedNzd'), 2),
      endTh: round(totalTh(withPlan.tranches), 4),
      endAvgWth: endAvg == null ? null : round(endAvg, 2),
      baselineRewardNzd,
      increaseNzd: round(rewardNzd - baselineRewardNzd, 2),
      lastMonthRewardNzd: withPlan.months.at(-1)?.rewardNzd ?? 0,
    },
    notes,
  };
}
