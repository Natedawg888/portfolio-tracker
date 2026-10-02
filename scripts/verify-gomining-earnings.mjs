/**
 * Screenshot regression check for GoMining sat/TH formulas.
 * Expected (1 TH, EE 21.85, disc 6.06%, BTC 83415.868, PR 47.3885, GBP 0.0081):
 *   C1 ≈ 29.5280, C2 ≈ 10.0228, net ≈ 7.8458
 */
import {
  calcPerThSatDay,
  estimateMinerEarnings,
  GOMINING_DEFAULT_KWH_USD,
} from '../src/lib/gominingEarnings.ts';

const BTC = 83415.868;
const EE = 21.85;
const DISC = 6.06;
const PR_SAT = 47.3885;
const GBP_SAT = 0.0081;

const perTh = calcPerThSatDay({
  energyEfficiencyWth: EE,
  discountPct: DISC,
  btcUsd: BTC,
  kWhCostUsd: GOMINING_DEFAULT_KWH_USD,
  poolIncomeBtcPerTh: PR_SAT / 1e8,
  goBtcPaySatPerTh: GBP_SAT,
});

const est = estimateMinerEarnings({
  hashrateThs: 1,
  energyEfficiencyWth: EE,
  discountPct: DISC,
  network: {
    btcUsd: BTC,
    poolIncomeUsdPerTh: null,
    poolIncomeBtcPerTh: PR_SAT / 1e8,
    goBtcPayBtcPerTh: GBP_SAT / 1e8,
    goBtcPaySatPerTh: GBP_SAT,
    networkHashrateEhs: null,
    dailyBtcIssuance: null,
    kWhCostUsd: GOMINING_DEFAULT_KWH_USD,
  },
});

const box = estimateMinerEarnings({
  hashrateThs: 25.734,
  energyEfficiencyWth: EE,
  discountPct: DISC,
  network: {
    btcUsd: BTC,
    poolIncomeUsdPerTh: null,
    poolIncomeBtcPerTh: PR_SAT / 1e8,
    goBtcPayBtcPerTh: GBP_SAT / 1e8,
    goBtcPaySatPerTh: GBP_SAT,
    networkHashrateEhs: null,
    dailyBtcIssuance: null,
    kWhCostUsd: 0.05,
  },
});

function near(a, b, tol = 0.001) {
  return a != null && Math.abs(a - b) <= tol;
}

const report = {
  defaultKwh: GOMINING_DEFAULT_KWH_USD,
  perTh,
  estimateNetSatPerTh: est.netSatPerTh,
  estimateC1: est.electricitySatPerThAfterDiscount,
  estimateC2: est.serviceSatPerThAfterDiscount,
  mineBoxNetSat: box.netBtcPerDay != null ? box.netBtcPerDay * 1e8 : null,
  checks: {
    kwhIs005: GOMINING_DEFAULT_KWH_USD === 0.05,
    c1: near(perTh.c1Sat, 29.5280),
    c2: near(perTh.c2Sat, 10.0228),
    net: near(perTh.netSat, 7.8458),
    estNet: near(est.netSatPerTh, 7.8458),
    mineBox: near(box.netBtcPerDay != null ? box.netBtcPerDay * 1e8 : null, 201.9044, 0.01),
  },
};

console.log(JSON.stringify(report, null, 2));
const ok = Object.values(report.checks).every(Boolean);
if (!ok) {
  console.error('VERIFY FAILED vs screenshot targets');
  process.exit(1);
}
console.log('VERIFY OK — matches screenshot formulas');
