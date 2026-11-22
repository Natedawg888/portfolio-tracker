/**
 * FIF income (KAN-92). Worked examples from IRD IR461 (April 2026).
 * Run: npm run test:fif
 */
import {
  applyFifOverride,
  classifyFif,
  fifDeMinimisNzd,
  fifInterestIncome,
  fifTaxYearForDate,
  fifThreshold,
  fifYear,
  quickSaleAdjustment,
  type FifInterestYear,
} from './fifCalc.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

const interest = (over: Partial<FifInterestYear>): FifInterestYear => ({
  id: 'x', label: 'X', openingValueNzd: 0, openingUnits: 0, closingValueNzd: null, trades: [], distributionsNzd: 0, ...over,
});

// Threshold, set per tax year.
eq(fifDeMinimisNzd(2026), 50_000, '2026/27 threshold is $50,000');
eq(fifDeMinimisNzd(2030), 50_000, 'an unlisted year falls back to $50,000');
eq(fifTaxYearForDate('2027-03-31'), 2026, '31 March 2027 is in 2026/27');
eq(fifTaxYearForDate('2027-04-01'), 2027, '1 April 2027 starts 2027/28');

// $49,999 all year: not FIF, dividends taxed as received.
let t = fifThreshold([{ costNzd: 49_999, heldFrom: null, heldTo: null }], 2026);
eq(t.applies, false, '$49,999 all year is under the threshold');
eq(t.peakCostNzd, 49_999, 'peak is the cost');
let y = fifYear({
  taxYearStart: 2026,
  spans: [{ costNzd: 49_999, heldFrom: null, heldTo: null }],
  interests: [interest({ openingValueNzd: 80_000, distributionsNzd: 1_200 })],
});
eq(y.method, null, 'under the threshold no method applies');
eq(y.fifIncomeNzd, 0, 'under the threshold there is no FIF income');
eq(y.dividendsTaxableNzd, 1_200, 'under the threshold dividends are taxable income');

// Exactly $50,000 isn't over it.
eq(fifThreshold([{ costNzd: 50_000, heldFrom: null, heldTo: null }], 2026).applies, false, '$50,000 exactly is not over');

// Briefly over: $30k all year, plus $25k held 1–15 July.
t = fifThreshold(
  [
    { costNzd: 30_000, heldFrom: null, heldTo: null },
    { costNzd: 25_000, heldFrom: '2026-07-01', heldTo: '2026-07-15' },
  ],
  2026,
);
eq(t.applies, true, 'over $50,000 for two weeks applies the rules');
eq(t.peakCostNzd, 55_000, 'peak is $55,000');
eq(t.peakCostDate, '2026-07-01', 'peak reached on 1 July');
y = fifYear({
  taxYearStart: 2026,
  spans: [
    { costNzd: 30_000, heldFrom: null, heldTo: null },
    { costNzd: 25_000, heldFrom: '2026-07-01', heldTo: '2026-07-15' },
  ],
  interests: [interest({ openingValueNzd: 40_000, distributionsNzd: 900 })],
});
eq(y.method, 'fdr', 'FIF applies for the whole year once crossed');
eq(y.fifIncomeNzd, 2_000, 'FDR on the $40,000 opening value is $2,000');
eq(y.dividendsTaxableNzd, 0, 'dividends are not taxed separately under FIF');

// A sale the day before a buy doesn't stack the two costs.
t = fifThreshold(
  [
    { costNzd: 30_000, heldFrom: null, heldTo: '2026-08-31' },
    { costNzd: 30_000, heldFrom: '2026-09-01', heldTo: null },
  ],
  2026,
);
eq(t.peakCostNzd, 30_000, 'sold 31 August, bought 1 September: never $60,000');
// Spans outside the year don't count.
eq(fifThreshold([{ costNzd: 60_000, heldFrom: '2027-04-01', heldTo: null }], 2026).applies, false, 'bought after the year');
eq(fifThreshold([{ costNzd: 60_000, heldFrom: null, heldTo: '2026-03-31' }], 2026).applies, false, 'sold before the year');

// FDR: opening $100,000 → $5,000.
eq(fifInterestIncome(interest({ openingValueNzd: 100_000 })).fdrIncomeNzd, 5_000, 'FDR is 5% of the opening value');

// IR461 quick-sale example: 10,000 at $200,000; buy 5,000 for $110,000 (1 Oct); sell 4,000 for
// $100,000 (1 Dec); buy 2,000 for $44,000 (23 Dec). Peak differential 2,000, average cost $22,
// peak holding amount $2,200, actual gain $12,000 → adjustment $2,200, FIF income $12,200.
const ir461 = interest({
  openingValueNzd: 200_000,
  openingUnits: 10_000,
  closingValueNzd: 254_000,
  trades: [
    { date: '2026-12-23', kind: 'buy', units: 2_000, amountNzd: 44_000 },
    { date: '2026-10-01', kind: 'buy', units: 5_000, amountNzd: 110_000 },
    { date: '2026-12-01', kind: 'sell', units: 4_000, amountNzd: 100_000 },
  ],
});
const qs = quickSaleAdjustment(ir461.openingUnits, ir461.trades);
eq(qs.peakUnits, 15_000, 'peak is 15,000');
eq(qs.closingUnits, 13_000, 'closing is 13,000');
eq(qs.peakHoldingDifferential, 2_000, 'peak holding differential is 2,000');
eq(qs.averageCostNzd, 22, 'average cost is $22');
eq(qs.peakHoldingAmountNzd, 2_200, 'peak holding amount is $2,200');
eq(qs.actualGainNzd, 12_000, 'actual gain is $12,000');
eq(qs.adjustmentNzd, 2_200, 'quick-sale adjustment is the lesser, $2,200');
eq(fifInterestIncome(ir461).fdrIncomeNzd, 12_200, 'FIF income is $10,000 + $2,200');

// The actual gain is the lesser when it's smaller.
eq(
  quickSaleAdjustment(0, [
    { date: '2026-05-01', kind: 'buy', units: 1_000, amountNzd: 20_000 },
    { date: '2026-06-01', kind: 'sell', units: 1_000, amountNzd: 20_300 },
  ]).adjustmentNzd,
  300,
  'a $300 gain is less than the $1,000 peak holding amount',
);
// A quick-sale loss adds nothing.
eq(
  quickSaleAdjustment(0, [
    { date: '2026-05-01', kind: 'buy', units: 1_000, amountNzd: 20_000 },
    { date: '2026-06-01', kind: 'sell', units: 1_000, amountNzd: 15_000 },
  ]).adjustmentNzd,
  0,
  'a quick-sale loss gives no adjustment',
);
// Selling opening shares with no purchase isn't a quick sale.
eq(
  quickSaleAdjustment(1_000, [{ date: '2026-06-01', kind: 'sell', units: 500, amountNzd: 30_000 }]).adjustmentNzd,
  0,
  'selling only opening shares has no adjustment',
);
// A sale before the purchase isn't matched to it.
eq(
  quickSaleAdjustment(1_000, [
    { date: '2026-05-01', kind: 'sell', units: 500, amountNzd: 30_000 },
    { date: '2026-06-01', kind: 'buy', units: 500, amountNzd: 10_000 },
  ]).actualGainNzd,
  0,
  'a sale that comes before the purchase is not a quick sale',
);

// CV gain per the formula: (closing + proceeds + distributions) − (opening + costs).
const cvGain = fifInterestIncome(
  interest({
    openingValueNzd: 100_000,
    closingValueNzd: 105_000,
    distributionsNzd: 2_000,
    trades: [
      { date: '2026-06-01', kind: 'buy', units: 100, amountNzd: 10_000 },
      { date: '2026-09-01', kind: 'sell', units: 50, amountNzd: 6_000 },
    ],
  }),
);
eq(cvGain.cvIncomeNzd, 3_000, '(105,000 + 6,000 + 2,000) − (100,000 + 10,000) = 3,000');
eq(fifInterestIncome(interest({ openingValueNzd: 100_000 })).cvIncomeNzd, null, 'CV needs the closing value');

// IR461 Bill Murphy example: FDR $15,000; CV +2,000 +10,000 −20,000 = −8,000, reduced to 0.
y = fifYear({
  taxYearStart: 2026,
  spans: [{ costNzd: 300_000, heldFrom: null, heldTo: null }],
  interests: [
    interest({ id: 'a', openingValueNzd: 100_000, closingValueNzd: 102_000 }),
    interest({ id: 'b', openingValueNzd: 100_000, closingValueNzd: 110_000 }),
    interest({ id: 'c', openingValueNzd: 100_000, closingValueNzd: 80_000 }),
  ],
});
eq(y.fdrTotalNzd, 15_000, 'Bill Murphy FDR is $15,000');
eq(y.cvRawTotalNzd, -8_000, 'Bill Murphy CV is −$8,000');
eq(y.cvTotalNzd, 0, 'a CV loss is reduced to zero');
eq(y.method, 'cv', 'the lower method, CV, is chosen');
eq(y.fifIncomeNzd, 0, 'FIF income is $0 under CV');

// FDR is chosen when it's lower.
y = fifYear({
  taxYearStart: 2026,
  spans: [{ costNzd: 100_000, heldFrom: null, heldTo: null }],
  interests: [interest({ openingValueNzd: 100_000, closingValueNzd: 130_000 })],
});
eq(y.method, 'fdr', 'FDR $5,000 beats CV $30,000');
eq(y.fifIncomeNzd, 5_000, 'FIF income is the FDR amount');
// Unknown closing value: CV can't be compared, FDR is used.
y = fifYear({
  taxYearStart: 2026,
  spans: [{ costNzd: 100_000, heldFrom: null, heldTo: null }],
  interests: [interest({ openingValueNzd: 100_000 })],
});
eq(y.cvTotalNzd, null, 'CV is unknown without a closing value');
eq(y.method, 'fdr', 'FDR is used when CV is unknown');

// Classification: ASX-listed Australian holdings are exempt and stay out of the threshold.
eq(classifyFif('BHP', 'ASX'), 'asx_exempt', 'ASX exchange is exempt');
eq(classifyFif('BHP.AX', null), 'asx_exempt', '.AX suffix is exempt');
eq(classifyFif('SKS.ASX.CBA', null), 'asx_exempt', 'Sharesies ASX id is exempt');
eq(classifyFif('AIR', 'NZX'), 'nz', 'NZX is not a FIF');
eq(classifyFif('FPH.NZ', null), 'nz', '.NZ suffix is not a FIF');
eq(classifyFif('SKS.FUND.SVOO', null), 'nz_fund', 'Sharesies fund is a PIE');
eq(classifyFif('AAPL', 'NASDAQ'), 'fif', 'NASDAQ is a FIF');
eq(classifyFif('VOO', null), 'fif', 'no exchange defaults to FIF');
const holdings = [
  { symbol: 'AAPL', exchange: 'NASDAQ', costNzd: 30_000 },
  { symbol: 'BHP', exchange: 'ASX', costNzd: 40_000 },
];
t = fifThreshold(
  holdings.filter((h) => classifyFif(h.symbol, h.exchange) === 'fif').map((h) => ({ costNzd: h.costNzd, heldFrom: null, heldTo: null })),
  2026,
);
eq(t.peakCostNzd, 30_000, 'the ASX holding is left out of the cost total');
eq(t.applies, false, '$30,000 foreign + $40,000 ASX is under the threshold');

// User override (KAN-92): count or leave out a holding when the automatic class is wrong.
eq(applyFifOverride('fif', null), 'fif', 'no override keeps the automatic class');
eq(applyFifOverride('fif', 'exempt'), 'user_exempt', 'a foreign holding marked not a FIF');
eq(applyFifOverride('asx_exempt', 'fif'), 'fif', 'an ASX company without a franking account counts');
eq(applyFifOverride('nz', 'exempt'), 'nz', 'marking an NZ share exempt changes nothing');

console.log('fifCalc.test.ts ok');
