/**
 * GoMining mining projection: adding TH, better efficiency, reinvesting rewards.
 * Run: npm run test:mining-projection
 */
import { calcPerThSatDay, PERIOD_DAYS } from './gominingEarnings.ts';
import { MINING_MIN_WTH, projectMining, type MiningProjectionInput } from './miningProjection.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
function near(a: number, b: number, msg: string, tol = 0.01): void {
  if (Math.abs(a - b) > tol) throw new Error(`FAIL: ${msg} (got ${a}, expected ${b})`);
}

const base: MiningProjectionInput = {
  months: 12,
  miners: [{ th: 100, wth: 20 }],
  poolBtcPerThDay: 0.0000006, // 60 sat/TH/day
  gbpSatPerThDay: 0,
  btcUsd: 100_000,
  btcNzd: 170_000,
  kWhCostUsd: 0.05,
  discountPct: 10,
  btcPriceChangePctYear: 0,
  rewardChangePctYear: 0,
  addThPerMonth: 0,
  addThOnce: 0,
  newThWth: null,
  thPriceNzd: null,
  wthDropPerMonth: 0,
  upgradeCostPerMonthNzd: 0,
  rewardsTo: 'crypto',
};

// Matches the Portfolio formula: (PR − C1 − C2) × TH × days.
{
  const p = calcPerThSatDay({ energyEfficiencyWth: 20, discountPct: 10, btcUsd: 100_000, kWhCostUsd: 0.05, poolIncomeBtcPerTh: 0.0000006, goBtcPaySatPerTh: 0 });
  const monthlyBtc = ((p.netSat ?? 0) * 100 * PERIOD_DAYS.month) / 1e8;
  const r = projectMining(base);
  near(r.start.monthlyNetBtc, monthlyBtc, 'start monthly BTC = formula × TH × days', 1e-8);
  near(r.months[0].rewardNzd, monthlyBtc * 170_000, 'NZD at BTC/NZD');
  near(r.months[11].rewardNzd, r.months[0].rewardNzd, 'flat with no changes');
  near(r.totals.increaseNzd, 0, 'no plan = no increase');
  near(r.totals.endTh, 100, 'TH unchanged');
}

// Lowering W/TH every month cuts electricity, so rewards rise — down to 12 W/TH.
{
  const r = projectMining({ ...base, wthDropPerMonth: 1, upgradeCostPerMonthNzd: 40 });
  assert(MINING_MIN_WTH === 12, 'floor is 12 W/TH');
  assert(r.months[0].avgWth === 20 && r.months[1].avgWth === 19 && r.months[2].avgWth === 18, 'W/TH drops 1 a month');
  assert(r.months[11].avgWth === 12, 'stops at 12 W/TH');
  assert(r.months.every((m) => (m.avgWth ?? 0) >= 12), 'never below 12');
  assert(r.months[3].rewardNzd > r.months[2].rewardNzd, 'each upgrade raises the monthly reward');
  assert(r.totals.increaseNzd > 0, 'upgrades beat the baseline');
  near(r.months[0].spendNzd, 40, 'upgrade cost while improving');
  near(r.months[8].spendNzd, 0, 'no upgrade cost once at 12 W/TH (20 → 12 takes 8 months)');
  near(r.totals.spendNzd, 8 * 40, '8 months of upgrade cost');
  near(r.totals.endAvgWth ?? 0, 12, 'ends at the floor');
  const half = projectMining({ ...base, wthDropPerMonth: 0.5 });
  assert(half.months[11].avgWth === 14.5, '20 − 11 × 0.5');
  const atFloor = projectMining({ ...base, miners: [{ th: 100, wth: 12 }], wthDropPerMonth: 1, upgradeCostPerMonthNzd: 40 });
  near(atFloor.totals.spendNzd, 0, 'already at 12 W/TH: nothing to upgrade or pay');
  near(atFloor.totals.increaseNzd, 0, 'and no increase');
  const newTh = projectMining({ ...base, addThOnce: 50, newThWth: 18, wthDropPerMonth: 1 });
  near(newTh.totals.endAvgWth ?? 0, 12, 'added TH improves too and stops at 12');
}

// Adding TH every month.
{
  const r = projectMining({ ...base, addThPerMonth: 10, thPriceNzd: 30 });
  near(r.totals.endTh, 220, '100 + 12 × 10 TH');
  near(r.months[0].spendNzd, 300, '10 TH × $30');
  assert(r.months[1].rewardNzd > r.months[0].rewardNzd, 'more TH, more reward next month');
  const once = projectMining({ ...base, addThOnce: 50, newThWth: 15, thPriceNzd: 30 });
  near(once.totals.endTh, 150, 'one-off 50 TH');
  near(once.months[1].avgWth ?? 0, (100 * 20 + 50 * 15) / 150, 'weighted W/TH after adding efficient TH');
}

// Reinvesting compounds.
{
  const kept = projectMining({ ...base, thPriceNzd: 30, rewardsTo: 'crypto' });
  const reinvest = projectMining({ ...base, thPriceNzd: 30, rewardsTo: 'reinvest' });
  assert(reinvest.totals.endTh > 100, 'reinvested rewards buy TH');
  assert(reinvest.totals.rewardNzd > kept.totals.rewardNzd, 'reinvesting grows rewards');
  near(reinvest.totals.reinvestedNzd, reinvest.totals.rewardNzd, 'all rewards reinvested');
  const noPrice = projectMining({ ...base, rewardsTo: 'reinvest' });
  assert(noPrice.notes.some((n) => n.includes('price per TH')), 'reinvest needs a TH price');
}

// Reward per TH falling (network growth) and BTC price changes.
{
  const falling = projectMining({ ...base, rewardChangePctYear: -30 });
  assert(falling.months[11].rewardNzd < falling.months[0].rewardNzd, 'lower reward per TH over time');
  const rising = projectMining({ ...base, btcPriceChangePctYear: 20 });
  assert(rising.months[11].rewardNzd > rising.months[0].rewardNzd, 'higher BTC price lifts NZD rewards');
}

console.log('mining projection tests ok');
