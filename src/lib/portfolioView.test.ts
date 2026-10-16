/**
 * Portfolio page view logic. Run: npm run test:portfolio
 */
import { normalizeAssetClassPrefs } from './assetClassPrefs.ts';
import {
  findIssues,
  formatSignedPct,
  holdingReturn,
  nextTab,
  priceSources,
  seriesChangePct,
  shareOfTotal,
  propertyFigures,
  tabFromHash,
  visibleTabs,
} from './portfolioView.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}

// Returns never show ∞.
eq(holdingReturn(120, null).kind, 'no_cost', 'missing cost is no_cost, not +∞%');
eq(holdingReturn(120, 0).kind, 'no_cost', 'zero cost is no_cost');
eq(holdingReturn(null, 100).kind, 'no_value', 'no value');
const r = holdingReturn(150, 100);
eq(r.kind === 'ok' ? r.pct : null, 50, '50% gain');
eq(r.kind === 'ok' ? r.returnNzd : null, 50, '$50 gain');
eq(formatSignedPct(12.345), '+12.35%', 'positive keeps +');
eq(formatSignedPct(-5), '−5.00%', 'negative keeps −');
eq(formatSignedPct(Infinity), '—', 'never ∞');

// Tabs.
const enabled = (p: string) => ['stock', 'gomining', 'forex'].includes(p);
const tabs = visibleTabs(enabled);
eq(tabs.join(), 'overview,stocks,dividends,mining,forex', 'only tabs for enabled classes');
eq(tabFromHash('#mining', tabs), 'mining', 'hash selects tab');
eq(tabFromHash('#crypto', tabs), 'overview', 'hidden tab falls back to overview');
eq(tabFromHash('', tabs), 'overview', 'no hash');
eq(nextTab(tabs, 'forex', 'ArrowRight'), 'overview', 'right wraps');
eq(nextTab(tabs, 'overview', 'ArrowLeft'), 'forex', 'left wraps');
const all = visibleTabs(() => true);
eq(all.join(), 'overview,stocks,dividends,crypto,mining,metals,forex,property,art,stones,collectables,vehicles,bonds', 'one tab per class, in Settings order');
eq(visibleTabs((p) => p !== 'vehicles').includes('vehicles'), false, 'Vehicles tab hidden when the class is off');
eq(normalizeAssetClassPrefs({ stock: true, crypto: false }).vehicles, true, 'settings saved before Vehicles existed turn it on');
eq(normalizeAssetClassPrefs({ vehicles: false }).vehicles, false, 'and it can be turned off');
eq(visibleTabs((p) => p === 'art').join(), 'overview,art', 'each of the four has its own toggle');
eq(tabFromHash('#other', tabs), 'forex', 'old #other link opens the first of the four that is on');
eq(tabFromHash('#other', visibleTabs((p) => p === 'stone')), 'stones', 'old #other link with only stones on');
eq(tabFromHash('#other', visibleTabs((p) => p === 'stock')), 'overview', 'old #other link with none of the four on');
eq(tabFromHash('#property', all), 'property', 'property hash');
eq(nextTab(tabs, 'mining', 'Home'), 'overview', 'home');
eq(nextTab(tabs, 'mining', 'Enter'), null, 'other keys ignored');

// Needs a look.
const issues = findIssues([
  { id: 't', assetClass: 'stock', name: 'Tesla', source: 'Sharesies', shares: 0, costNzd: 914.45, valueNzd: 1.37 },
  { id: 'q', assetClass: 'stock', name: 'QYLD', source: 'Sharesies', shares: 0.64, costNzd: 135.1, valueNzd: 21.19 },
  { id: 'a', assetClass: 'stock', name: 'AGNC', source: 'Hatch', shares: 1.1, costNzd: 37, valueNzd: 17.86 },
  { id: 'b', assetClass: 'crypto', name: 'Bitcoin', source: 'Sharesies', amount: 0, costNzd: 23, valueNzd: null },
  { id: 'n', assetClass: 'crypto', name: 'Nexo', source: 'manual', amount: 10, costNzd: null, valueNzd: 15 },
  { id: 'm', assetClass: 'gomining_miner', name: '#1', costNzd: 0, valueNzd: 30 },
  { id: 'u', assetClass: 'stock', name: 'Unknown qty', source: 'manual', shares: null, costNzd: 300, valueNzd: 300 },
]);
const keys = issues.map((i) => i.key).join();
eq(keys, 'closed-stocks,empty-crypto,no-cost-crypto,no-cost-gomining_miner,synced-cost', 'only problems that apply');
eq(issues[0].text.startsWith('Tesla has 0 shares'), true, 'names the closed position');
eq(issues.find((i) => i.key === 'synced-cost')?.text.startsWith('QYLD, AGNC:'), true, 'flags synced stocks whose cost is over 2× value');
eq(findIssues([{ id: 'x', assetClass: 'stock', name: 'Fine', shares: 1, costNzd: 10, valueNzd: 12 }]).length, 0, 'no issues, no panel');

eq(shareOfTotal(25, 100), 25, 'share');
eq(shareOfTotal(5, 0), null, 'no total');
eq(seriesChangePct([{ price: 100 }, { price: 90 }, { price: 110 }]), 10, 'first to last');
eq(seriesChangePct([{ price: 100 }]), null, 'one point');

eq(
  priceSources(
    [
      { assetClass: 'stock', source: 'Sharesies', notes: '11.9 USD → 21.19 NZD @ 1.78 (frankfurter)' },
      { assetClass: 'crypto', source: 'manual' },
      { assetClass: 'metal' },
      { assetClass: 'collectable', cardGame: 'mtg' },
    ],
    'gold-api',
  ).join(', '),
  'Akahu, Frankfurter FX, CoinGecko, gold-api.com, Scryfall',
  'sources in use only',
);
eq(priceSources([], null).length, 0, 'no holdings, no sources');

// Property figures.
eq(propertyFigures({ propertyValueNzd: 850000, mortgageOutstandingNzd: 520000 }).equityNzd, 330000, 'equity is value minus mortgage');
eq(propertyFigures({ propertyValueNzd: 850000, mortgageOutstandingNzd: null }).mortgageNzd, 0, 'no mortgage is 0');
eq(propertyFigures({ propertyValueNzd: null, mortgageOutstandingNzd: 1 }).equityNzd, null, 'no value, no equity');

console.log('portfolio view tests ok');
