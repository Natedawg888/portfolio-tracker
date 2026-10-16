/**
 * Hidden asset classes leave net worth, History and Projections. Run: npm run test:settings-categories
 */
import { defaultAssetClassPrefs } from './assetClassPrefs.ts';
import { classNetNzd, hiddenClassesSentence, hiddenTotals, visibleSnapshot } from './visibleNetWorth.ts';
import { accessibleOf } from './netWorthHistory.ts';

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`FAIL: ${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

// $240k property with a $40k mortgage, $1,200.50 cash, a -$300 card, $115.62 shares, $5k KiwiSaver, $2k personal debt.
const byClass = {
  cash: 1200.5,
  cashLiabilities: -300,
  stocks: 115.62,
  crypto: 50,
  cryptoWallets: 20,
  defi: 10,
  realEstate: 240000,
  realEstateMortgage: 40000,
  realEstateEquity: 200000,
  vehicles: 15000,
  vehicleLoans: 5000,
  vehiclesEquity: 10000,
  kiwiSaver: 5000,
  debt: 2000,
  assets: 261076.12,
  total: 214076.12,
};
const all = defaultAssetClassPrefs();
const off = (...keys: (keyof typeof all)[]) => ({ ...all, ...Object.fromEntries(keys.map((k) => [k, false])) });

eq(classNetNzd(byClass, 'real_estate'), 200000, 'property counts net of its mortgage');
eq(classNetNzd({ realEstate: 100, realEstateMortgage: 30 }, 'real_estate'), 70, 'older snapshot without equity');
eq(classNetNzd(byClass, 'vehicles'), 10000, 'vehicles net of loans');
eq(classNetNzd(byClass, 'crypto'), 60, 'crypto includes DeFi (wallets are inside crypto already)');
eq(classNetNzd(byClass, 'cash'), 1200.5, 'cash leaves the card out');

eq(hiddenTotals(byClass, all).netNzd, 0, 'nothing hidden');
const h = hiddenTotals(byClass, off('real_estate', 'art'));
eq(h.netNzd, 200000, 'hidden property takes its equity off the total');
eq(h.grossNzd, 240000, 'and its full value off assets');
eq(h.classes.map((c) => c.label).join(), 'Property', 'empty hidden classes are not listed');
eq(hiddenTotals(byClass, off('cash')).classes[0].label, 'Cash & banks', 'Settings name for cash');
eq(hiddenTotals(null, off('stock')).netNzd, 0, 'no breakdown');

// Snapshots
const snap = { id: 's1', totalNzd: 214076.12, breakdown: { byClass, assetsKnownNzd: 261076.12, holdings: [{ assetClass: 'real_estate' }, { assetClass: 'stock' }, { assetClass: 'kiwisaver' }] } };
const v = visibleSnapshot(snap, off('real_estate'));
eq(v.totalNzd, 14076.12, 'snapshot total without property');
eq(v.hiddenNzd, 200000, 'hidden amount reported');
const vb = v.breakdown as { byClass: Record<string, number | null>; holdings: { assetClass: string }[]; assetsKnownNzd: number };
eq(vb.byClass.realEstate, null, 'property line gone from History');
eq(vb.byClass.realEstateMortgage, null, 'its mortgage too');
eq(vb.byClass.total, 14076.12, 'byClass total adjusted');
eq(vb.byClass.assets, 21076.12, 'byClass assets adjusted');
eq(vb.assetsKnownNzd, 21076.12, 'assets adjusted');
eq(vb.byClass.debt, 2000, 'personal debt still counts');
eq(vb.holdings.map((x) => x.assetClass).join(), 'stock,kiwisaver', 'property holdings left out');
eq(snap.totalNzd, 214076.12, 'stored snapshot is not changed');
eq(visibleSnapshot(snap, all).totalNzd, 214076.12, 'nothing hidden: unchanged');
eq(visibleSnapshot({ totalNzd: 500, breakdown: {} }, off('stock')).totalNzd, 500, 'very old snapshot keeps its total');

// Accessible view (total − KiwiSaver) must not take KiwiSaver off twice once it is hidden.
const ks = visibleSnapshot(snap, off('kiwisaver'));
const ksb = (ks.breakdown as { byClass: Record<string, number | null> }).byClass;
eq(ks.totalNzd, 209076.12, 'KiwiSaver hidden');
eq(accessibleOf(ks.totalNzd, ksb.kiwiSaver), 209076.12, 'accessible = total when KiwiSaver is hidden');

const money = (n: number) => `$${n.toFixed(2)}`;
eq(hiddenClassesSentence([{ label: 'Property', nzd: 240000 }], money), 'Leaves out Property ($240000.00), hidden in Settings → Categories & assets.', 'one class');
eq(
  hiddenClassesSentence([{ label: 'Stocks', nzd: 1 }, { label: 'Crypto', nzd: 2 }, { label: 'Property', nzd: 3 }], money),
  'Leaves out Stocks ($1.00), Crypto ($2.00) and Property ($3.00), hidden in Settings → Categories & assets.',
  'several classes',
);

console.log('visibleNetWorth.test.ts ok');
