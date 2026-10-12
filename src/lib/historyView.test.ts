/**
 * History page view logic. Run: npm run test:history
 */
import {
  adjacentYears,
  assetClassLabel,
  bucketCount,
  chartClassKeys,
  classLabel,
  costValuedSoldFlags,
  costValuedBadge,
  costValuedSoldSentence,
  costValuedWarning,
  flagsForSeries,
  holdingOrder,
  holdingsByClass,
  snapshotYears,
  TOP_HOLDINGS,
  yearHeadline,
} from './historyView.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}

const years = snapshotYears([
  { takenAt: '2024-06-01T00:00:00Z' },
  // 1 Jan 2026 01:00 NZDT.
  { takenAt: '2025-12-31T12:00:00Z' },
  // 31 Dec 2024 23:00 NZDT, still 2024 in Auckland.
  { takenAt: '2024-12-31T10:00:00Z' },
  { takenAt: '2026-10-01T00:00:00Z' },
  { takenAt: 'not a date' },
]);
eq(years.join(','), '2024,2026', 'distinct Auckland years, sorted, bad dates dropped');

eq(adjacentYears([2022, 2024, 2026], 2024).prev, 2022, 'prev skips the empty 2023');
eq(adjacentYears([2022, 2024, 2026], 2024).next, 2026, 'next skips the empty 2025');
eq(adjacentYears([2020, 2022, 2026, 2028], 2024).prev, 2022, 'prev is the nearest earlier year');
eq(adjacentYears([2020, 2022, 2026, 2028], 2024).next, 2026, 'next is the nearest later year');
eq(adjacentYears([2022, 2026], 2024).prev, 2022, 'selected year without snapshots still finds prev');
eq(adjacentYears([2022, 2026], 2024).next, 2026, 'selected year without snapshots still finds next');
eq(adjacentYears([2026], 2026).prev, null, 'no earlier year');
eq(adjacentYears([2026], 2026).next, null, 'no later year');
eq(adjacentYears([], 2026).prev, null, 'no snapshots at all');

eq(yearHeadline([]), null, 'no snapshots, no headline');

const one = yearHeadline([{ takenAt: '2026-03-01T00:00:00Z', totalNzd: 500 }]);
eq(one?.latest.totalNzd, 500, 'single snapshot is the latest');
eq(one?.changeNzd, null, 'single snapshot has no change');
eq(one?.changePct, null, 'single snapshot has no pct');

const up = yearHeadline([
  { takenAt: '2026-01-05T00:00:00Z', totalNzd: 1000 },
  { takenAt: '2026-05-05T00:00:00Z', totalNzd: 400 },
  { takenAt: '2026-09-05T00:00:00Z', totalNzd: 1250 },
]);
eq(up?.first.takenAt, '2026-01-05T00:00:00Z', 'first is the earliest');
eq(up?.latest.totalNzd, 1250, 'latest is the last, not the max');
eq(up?.changeNzd, 250, 'change is latest minus first');
eq(up?.changePct, 25, 'pct of the first total');

const down = yearHeadline([
  { takenAt: '2026-01-05T00:00:00Z', totalNzd: 2000 },
  { takenAt: '2026-09-05T00:00:00Z', totalNzd: 1500 },
]);
eq(down?.changeNzd, -500, 'negative change');
eq(down?.changePct, -25, 'negative pct');

const fromZero = yearHeadline([
  { takenAt: '2026-01-05T00:00:00Z', totalNzd: 0 },
  { takenAt: '2026-09-05T00:00:00Z', totalNzd: 300 },
]);
eq(fromZero?.changeNzd, 300, 'change from zero still shown');
eq(fromZero?.changePct, null, 'zero base has no pct');

const fromDebt = yearHeadline([
  { takenAt: '2026-01-05T00:00:00Z', totalNzd: -1000 },
  { takenAt: '2026-09-05T00:00:00Z', totalNzd: -500 },
]);
eq(fromDebt?.changeNzd, 500, 'paying down debt is a positive change');
eq(fromDebt?.changePct, null, 'negative base has no pct');

const classKeys = chartClassKeys([
  {
    breakdown: {
      byClass: {
        total: 100, assets: 120, cryptoWallets: 5, realEstateEquity: 50, crypto: 10, stocks: 20,
        kiwiSaver: 30, debt: 20, gomining: null, zzNew: 1,
      },
    },
  },
  { breakdown: { byClass: { realEstate: 400, realEstateMortgage: 350 } } },
  {},
]);
eq(classKeys.join(','), 'kiwiSaver,stocks,crypto,realEstate,realEstateMortgage,debt,zzNew', 'class lines skip total, assets, wallets, equity and null classes; known ones first, unknown last');
eq(classLabel('cashLiabilities'), 'Cash liabilities (credit cards)', 'credit card label');
eq(classLabel('realEstate'), 'Property', 'property label');
eq(classLabel('gomining'), 'GoMining miners', 'miners label');
eq(classLabel('zzNew'), 'zzNew', 'unknown class keeps its key');
eq(assetClassLabel('gomining_miner'), 'GoMining miners', 'holding class maps to the same name as its byClass key');
eq(assetClassLabel('real_estate'), 'Property', 'real estate holding class reads as Property');
eq(assetClassLabel('stone'), 'Stones', 'stone holding class');

const order = holdingOrder([
  { breakdown: { holdings: [{ id: 'old', label: 'Old fund', valueNzd: 9_999 }] } },
  {
    breakdown: {
      holdings: [
        { id: 'a', label: 'A', valueNzd: 10 },
        { id: 'b', label: 'B', valueNzd: 600 },
        { id: 'c', label: 'C', valueNzd: 50 },
        { id: 'd', label: 'D', valueNzd: 4_000 },
        { id: 'e', label: 'E', valueNzd: 70 },
        { id: 'f', label: 'F', valueNzd: 300 },
      ],
    },
  },
]);
eq(order.slice(0, TOP_HOLDINGS).join(','), 'd,b,f,e,c', 'top 5 by value in the latest snapshot, not earlier ones');
eq(order.join(','), 'd,b,f,e,c,a,old', 'holdings missing from the latest snapshot come after');

eq(bucketCount([{ points: [{ at: '2026-10' }] }, { points: [{ at: '2026-10' }] }]), 1, 'two lines in the same month are one bucket');
eq(bucketCount([{ points: [{ at: '2026-10-01' }, { at: '2026-10-02' }] }, { points: [] }]), 2, 'two days are two buckets');
eq(bucketCount([]), 0, 'nothing to plot');

const live = [
  { id: 'tsla', assetClass: 'stock', shares: 0, costBasisNzd: 914.45 },
  { id: 'aapl', assetClass: 'stock', shares: 3, costBasisNzd: 500 },
  { id: 'eth', assetClass: 'crypto', amount: 0, costBasisNzd: 200 },
  { id: 'manual', assetClass: 'stock', shares: null, costBasisNzd: 300 },
];
const snap = (takenAt: string, holdings: { id: string; label: string; valueNzd: number }[]) => ({ takenAt, breakdown: { holdings } });
const flags = costValuedSoldFlags(
  [
    snap('2026-10-01T00:00:00Z', [{ id: 'tsla', label: 'TSLA', valueNzd: 914.45 }]),
    snap('2026-10-02T00:00:00Z', [{ id: 'tsla', label: 'TSLA', valueNzd: 1.37 }]),
    snap('2026-10-03T00:00:00Z', [{ id: 'aapl', label: 'AAPL', valueNzd: 500 }]),
    snap('2026-10-04T00:00:00Z', [{ id: 'gone', label: 'GONE', valueNzd: 914.45 }, { id: 'manual', label: 'MAN', valueNzd: 300 }]),
    snap('2026-10-05T00:00:00Z', [{ id: 'tsla', label: 'TSLA', valueNzd: 914.455 }, { id: 'eth', label: 'ETH', valueNzd: 200 }]),
  ],
  live,
);
eq(flags.get('2026-10-01T00:00:00Z')?.[0].label, 'TSLA', 'TSLA at 0 shares valued at its 914.45 cost is flagged');
eq(flags.get('2026-10-01T00:00:00Z')?.[0].valueNzd, 914.45, 'flag carries the stored value');
eq(flags.has('2026-10-02T00:00:00Z'), false, 'TSLA valued at 1.37 is not at cost');
eq(flags.has('2026-10-03T00:00:00Z'), false, 'a holding with shares still held is not flagged');
eq(flags.has('2026-10-04T00:00:00Z'), false, 'a holding not in the live list, or with no share count, is not flagged');
eq(flags.get('2026-10-05T00:00:00Z')?.length, 2, 'within a cent counts, and sold crypto is flagged too');
eq(flags.size, 2, 'only the at-cost snapshots are flagged');

const both = flags.get('2026-10-05T00:00:00Z')!;
eq(flagsForSeries('net', both).length, 2, 'net worth shows every flag');
eq(flagsForSeries('class:stocks', both).map((f) => f.label).join(), 'TSLA', 'stocks line shows the stock flag only');
eq(flagsForSeries('class:crypto', both).map((f) => f.label).join(), 'ETH', 'crypto line shows the crypto flag only');
eq(flagsForSeries('hold:tsla', both).map((f) => f.label).join(), 'TSLA', 'holding line shows its own flag');
eq(flagsForSeries('class:cash', both).length, 0, 'other classes show no flag');

eq(
  costValuedSoldSentence(flags.get('2026-10-01T00:00:00Z')!, (n) => `$${n.toFixed(2)}`),
  'Includes TSLA $914.45 valued at cost although 0 shares are held. Net worth is overstated by about $914.45.',
  'flag sentence names the holding, value and overstatement',
);

const money = (n: number) => `$${n.toFixed(2)}`;
eq(costValuedBadge(both[0]), '0 shares · valued at cost', 'stock badge says shares');
eq(costValuedBadge(both[1]), '0 held · valued at cost', 'crypto badge says held');
eq(
  costValuedWarning(both, money),
  'TSLA and ETH counted at cost though you hold none — net worth is overstated by $1114.45.',
  'warning names every holding and sums what they add',
);
eq(costValuedWarning([both[0]], money).startsWith('TSLA counted'), true, 'one holding needs no "and"');

const groups = holdingsByClass([
  { id: 'a', label: 'AAPL', assetClass: 'stock', valueNzd: 100 },
  { id: 'k', label: 'Milford', assetClass: 'kiwisaver', valueNzd: 500 },
  { id: 'm', label: 'MSFT', assetClass: 'stock', valueNzd: 450 },
  { id: 'x', label: 'Broken', assetClass: 'stock', valueNzd: Number.NaN },
  { id: 'g', label: 'Miner', assetClass: 'gomining_miner', valueNzd: -20 },
]);
eq(groups.map((g) => g.label).join(), 'Stocks,KiwiSaver,GoMining miners', 'classes sorted by total, readable names');
eq(groups[0].classKey, 'stocks', 'group carries the chart class key');
eq(groups[0].totalNzd, 550, 'class total sums its holdings, skipping non-numbers');
eq(groups[0].holdings.map((h) => h.label).join(), 'MSFT,AAPL', 'holdings sorted by value');
eq(groups[2].totalNzd, -20, 'negative totals kept');
eq(holdingsByClass([]).length, 0, 'no holdings, no groups');

console.log('historyView: ok');
