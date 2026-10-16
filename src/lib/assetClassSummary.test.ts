/**
 * Settings asset-class groups and contents lines. Run: npm run test:settings-categories
 */
import { assetClassGroup, classContents, contentsText, hiddenText, orderInGroup } from './assetClassSummary.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

eq(assetClassGroup('cash'), 'accounts', 'cash is an account');
eq(assetClassGroup('real_estate'), 'owned', 'property is owned');
eq(assetClassGroup('bonds'), 'investments', 'anything else is an investment');
eq(
  orderInGroup('owned', [{ key: 'art' }, { key: 'real_estate' }, { key: 'stone' }, { key: 'vehicles' }, { key: 'collectable' }, { key: 'stock' }])
    .map((o) => o.key)
    .join(','),
  'real_estate,vehicles,collectable,art,stone',
  'owned order',
);

const money = (n: number) => `$${n.toFixed(2)}`;
const nw = {
  cashNzd: 1200.5,
  stocksNzd: 115.61,
  cryptoNzd: null,
  realEstateNzd: 240000,
  realEstateEquityNzd: 240000,
  counts: { accounts: 2 },
  holdings: [
    { assetClass: 'stock' },
    { assetClass: 'stock' },
    { assetClass: 'stock' },
    { assetClass: 'real_estate' },
    { assetClass: 'crypto' },
    { assetClass: 'defi' },
  ],
};
eq(contentsText(classContents(nw, 'stock')!, money), '3 holdings · $115.61', 'stocks line');
eq(contentsText(classContents(nw, 'real_estate')!, money), '1 property · $240000.00', 'property line');
eq(contentsText(classContents(nw, 'cash')!, money), '$1200.50 NZD cash', 'cash line from an older server: NZD cash, no account count');
const withCash = { ...nw, counts: { accounts: 3, cashAccounts: 2 } };
eq(contentsText(classContents(withCash, 'cash')!, money), '2 accounts · $1200.50', 'cash line counts only the accounts behind the cash figure');
eq(hiddenText(classContents(withCash, 'cash')!, money), '2 accounts worth $1200.50', 'hidden note for cash with a count');
eq(contentsText(classContents({ ...nw, counts: { accounts: 1, cashAccounts: 0 } }, 'cash')!, money), 'Nothing added', 'only a card: no cash accounts');
eq(hiddenText(classContents(nw, 'stock')!, money), '3 holdings worth $115.61', 'hidden note');
eq(hiddenText(classContents(nw, 'crypto')!, money), '2 holdings', 'hidden note without a quote');
eq(hiddenText(classContents(nw, 'cash')!, money), '$1200.50 NZD cash', 'hidden note for cash');
eq(contentsText(classContents(nw, 'crypto')!, money), '2 holdings', 'no quote: count only, wallets and DeFi counted');
eq(contentsText(classContents(nw, 'art')!, money), 'Nothing added', 'empty class');
eq(contentsText(classContents({ ...nw, bondsNzd: 5000, holdings: [{ assetClass: 'bond' }] }, 'bonds')!, money), '1 holding · $5000.00', 'bonds line');
eq(classContents(null, 'stock'), null, 'no summary yet');
eq(classContents({ counts: { accounts: 0 } }, 'stock'), null, 'older summary without holdings');

console.log('assetClassSummary.test.ts ok');

