/**
 * Crypto cost basis and gains (KAN-47). Figures worked by hand. Run: npm run test:crypto
 */
import { computeGains, cryptoTaxYear, isIncomeOnReceipt, needsValue, suggestKinds, yearSummary, type LedgerTxn } from './cryptoGains.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}
let n = 0;
const t = (date: string, kind: LedgerTxn['kind'], asset: string, amount: number, nzdValue: number | null, extra: Partial<LedgerTxn> = {}): LedgerTxn => ({
  id: `t${++n}`, date, kind, asset, amount, nzdValue, feeNzd: 0, ...extra,
});

// Buy 1 ETH for $3,000 (+ $10 fee), then 1 ETH for $5,000; sell 1.5 ETH for $9,000 (− $15 fee).
const ledger = [
  t('2025-05-01', 'buy', 'eth', 1, 3000, { feeNzd: 10 }),
  t('2025-08-01', 'buy', 'ETH', 1, 5000),
  t('2025-11-01', 'sell', 'ETH', 1.5, 9000, { feeNzd: 15 }),
];

// FIFO: cost = 3,010 + half of 5,000 = 5,510; proceeds 8,985; gain 3,475. Left: 0.5 ETH costing 2,500.
let g = computeGains(ledger, 'fifo');
eq(g.disposals[0].costNzd, 5510, 'FIFO cost');
eq(g.disposals[0].proceedsNzd, 8985, 'proceeds net of fee');
eq(g.disposals[0].gainNzd, 3475, 'FIFO gain');
eq(g.positions[0].quantity, 0.5, 'FIFO left');
eq(g.positions[0].costNzd, 2500, 'FIFO cost left');

// WAC: pool 2 ETH costing 8,010 (4,005 each); 1.5 × 4,005 = 6,007.50; gain 2,977.50. Left 0.5 costing 2,002.50.
g = computeGains(ledger, 'wac');
eq(g.disposals[0].costNzd, 6007.5, 'WAC cost');
eq(g.disposals[0].gainNzd, 2977.5, 'WAC gain');
eq(g.positions[0].costNzd, 2002.5, 'WAC cost left');
eq(g.positions[0].avgCostNzd, 4005, 'WAC unit cost');

// Staking rewards: income at receipt, and their cost is that value when later sold.
g = computeGains(
  [t('2025-06-01', 'staking_reward', 'SOL', 2, 400), t('2025-07-01', 'staking_reward', 'SOL', 1, 250), t('2026-05-01', 'sell', 'SOL', 3, 900)],
  'fifo',
);
eq(g.income.length, 2, 'two rewards');
eq(g.disposals[0].costNzd, 650, 'rewards cost = value received');
eq(g.disposals[0].gainNzd, 250, 'gain on rewards');
eq(yearSummary(g, 2025).incomeNzd, 650, '2025/26 staking income');
eq(yearSummary(g, 2025).realisedNzd, 0, 'no sale in 2025/26');
eq(yearSummary(g, 2026).realisedNzd, 250, 'sale in 2026/27');

// Swap: give 0.5 BTC (worth $40,000), receive 10 ETH costing $40,000.
g = computeGains(
  [t('2025-04-10', 'buy', 'BTC', 1, 60000), t('2025-09-01', 'swap', 'BTC', 0.5, 40000, { toAsset: 'ETH', toAmount: 10 }), t('2025-10-01', 'sell', 'ETH', 5, 25000)],
  'fifo',
);
eq(g.disposals[0].gainNzd, 10000, 'swap is a disposal: 40,000 − 30,000');
eq(g.disposals[1].costNzd, 20000, 'swapped-in ETH costs what was given');
eq(g.positions.find((p) => p.asset === 'BTC')?.quantity, 0.5, 'BTC left');
eq(g.positions.find((p) => p.asset === 'ETH')?.costNzd, 20000, 'ETH left cost');

// Transfers and DeFi deposits don't change anything.
g = computeGains([t('2025-04-10', 'buy', 'ETH', 2, 6000), t('2025-05-01', 'transfer_out', 'ETH', 2, null), t('2025-05-02', 'defi_deposit', 'ETH', 1, null)], 'fifo');
eq(g.disposals.length, 0, 'no disposal');
eq(g.positions[0].quantity, 2, 'still 2 ETH');
eq(g.missingValue.length, 0, 'transfers need no value');

// Missing values and selling more than held are flagged, not guessed.
g = computeGains([t('2025-04-10', 'buy', 'ADA', 100, null), t('2025-05-01', 'sell', 'ADA', 150, 120)], 'fifo');
eq(g.missingValue.length, 1, 'buy without value flagged');
eq(g.shortfalls[0], 'ADA', 'oversold flagged');
eq(g.disposals[0].shortfall, 50, '50 more than held');
eq(computeGains([t('2025-04-10', 'buy', 'ADA', 100, null)], 'fifo').positions[0].costIncomplete, true, 'cost incomplete without a value');
eq(computeGains([t('2025-04-10', 'buy', 'ADA', 100, 50)], 'fifo').positions[0].costIncomplete, false, 'complete with one');

// Network fee paid in ETH: a disposal with no proceeds.
g = computeGains([t('2025-04-10', 'buy', 'ETH', 1, 4000), t('2025-04-11', 'fee', 'ETH', 0.01, 0)], 'fifo');
eq(g.disposals[0].gainNzd, -40, 'fee: cost of the ETH used');

// Airdrops (KAN-86, IRD Airdrops): by default not income and nil cost; taxable on receipt → like staking.
g = computeGains([t('2025-06-01', 'airdrop', 'ARB', 100, 150), t('2026-05-01', 'sell', 'ARB', 100, 400, { feeNzd: 5 })], 'fifo');
eq(g.income.length, 0, 'airdrop not income by default');
eq(yearSummary(g, 2025).incomeNzd, 0, 'airdrop year income 0');
eq(g.disposals[0].costNzd, 0, 'airdrop costs nil');
eq(g.disposals[0].gainNzd, 395, 'sale gain = proceeds − fee − 0');
eq(yearSummary(g, 2026).realisedNzd, 395, 'airdrop sale still in the gains');
g = computeGains([t('2025-06-01', 'airdrop', 'ARB', 100, null)], 'fifo');
eq(g.missingValue.length, 0, 'non-taxable airdrop needs no value');
eq(g.positions[0].costIncomplete, false, 'its nil cost is known');
eq(g.positions[0].costNzd, 0, 'held at nil cost');
g = computeGains([t('2025-06-01', 'airdrop', 'ARB', 100, 150, { taxableOnReceipt: true }), t('2026-05-01', 'sell', 'ARB', 100, 400, { feeNzd: 5 })], 'wac');
eq(g.income.length, 1, 'taxable airdrop is income');
eq(yearSummary(g, 2025).incomeNzd, 150, 'income = NZD value at receipt');
eq(g.disposals[0].costNzd, 150, 'cost = value at receipt');
eq(g.disposals[0].gainNzd, 245, 'sale gain uses that cost');
eq(computeGains([t('2025-06-01', 'airdrop', 'ARB', 100, null, { taxableOnReceipt: true })], 'fifo').missingValue.length, 1, 'taxable airdrop needs a value');
eq(computeGains([t('2025-06-01', 'staking_reward', 'SOL', 1, 250, { taxableOnReceipt: false })], 'fifo').income[0]?.nzdValue, 250, 'the flag never affects staking');
eq(isIncomeOnReceipt({ kind: 'airdrop' }), false, 'helper: airdrop');
eq(isIncomeOnReceipt({ kind: 'airdrop', taxableOnReceipt: true }), true, 'helper: taxable airdrop');
eq(needsValue({ kind: 'airdrop' }), false, 'helper: airdrop needs no value');

// Tax years.
eq(cryptoTaxYear('2026-03-31'), 2025, '31 March');
eq(cryptoTaxYear('2026-04-01'), 2026, '1 April');

// Import suggestions.
const own = ['0xOwn2'];
const s = suggestKinds(
  [
    { ref: 'a', hash: 'h1', date: '2025-05-01', direction: 'out', asset: 'ETH', amount: 1, counterparty: '0xown2' },
    { ref: 'b', hash: 'h2', date: '2025-05-02', direction: 'out', asset: 'USDC', amount: 100, counterparty: '0xdex' },
    { ref: 'c', hash: 'h2', date: '2025-05-02', direction: 'in', asset: 'ETH', amount: 0.03, counterparty: '0xdex' },
    { ref: 'd', hash: 'h3', date: '2025-06-01', direction: 'in', asset: 'POL', amount: 1, counterparty: '0xvalidator' },
    { ref: 'e', hash: 'h4', date: '2025-07-01', direction: 'in', asset: 'POL', amount: 1, counterparty: '0xvalidator' },
    { ref: 'f', hash: 'h5', date: '2025-08-01', direction: 'in', asset: 'POL', amount: 1, counterparty: '0xvalidator' },
    { ref: 'g', hash: 'h6', date: '2025-08-02', direction: 'in', asset: 'ETH', amount: 1, counterparty: '0xexchange' },
  ],
  own,
);
eq(s.get('a')?.kind, 'transfer_out', 'to own wallet');
eq(s.get('b')?.kind, 'swap', 'swap leg');
eq(s.get('b')?.pairRef, 'c', 'paired');
eq(s.get('d')?.kind, 'staking_reward', 'regular payments → staking');
eq(s.get('d')?.confident, false, 'staking is a suggestion');
eq(s.get('g')?.kind, 'buy', 'other incoming → buy?');

console.log('cryptoGains.test.ts ok');
