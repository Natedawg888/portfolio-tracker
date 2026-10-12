/**
 * Value Search ownership line, add link and metal headline. Run: npm run test:value-search
 */
import type { Holding } from './holdingDisplay.ts';
import type { LookupResult } from './valueSearchLookup.ts';
import { parseAs, SEARCH_TYPES, type SearchType } from './valueSearchDetect.ts';
import {
  addAction,
  findOwned,
  metalHeadline,
  ownedShortcuts,
  pageSources,
  parseRecents,
  pushRecent,
  type SavedSearch,
} from './valueSearchView.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`FAIL: ${msg} (got ${ja}, expected ${jb})`);
}

const common = {
  title: 't',
  detail: null,
  value: 1,
  currency: 'NZD',
  note: null,
  status: { kind: 'live' as const },
  source: 's',
  asOf: null,
};
const stock = (symbol: string): LookupResult => ({ ...common, type: 'stock', symbol });
const crypto = (symbol: string): LookupResult => ({ ...common, type: 'crypto', symbol });
const metal = (m: 'gold' | 'silver', amount: number | null = null, amountUnit: 'g' | 'oz_t' | 'kg' | null = null): LookupResult => ({
  ...common,
  type: 'metal',
  metal: m,
  perOzNzd: 100,
  amount,
  amountUnit,
});
const card = (c: Partial<{ name: string; set: string; number: string; finish: string; apiId: string }>): LookupResult => ({
  ...common,
  type: 'mtg',
  card: { name: 'Lightning Bolt', set: null, number: null, finish: null, apiId: null, ...c },
});
const currency = (from: string, to: string, amount: number | null = 100): LookupResult => ({
  ...common,
  type: 'currency',
  from,
  to,
  amount,
  rate: 1.7,
});
const miner: LookupResult = {
  ...common,
  type: 'miner',
  ths: 100,
  wPerTh: 15,
  wPerThFrom: 'query',
  discountPct: 0,
  periods: { day: { nzd: 1, btc: 0 }, month: { nzd: 1, btc: 0 }, year: { nzd: 1, btc: 0 } },
  liveInputs: [],
};

const h = (id: string, fields: Partial<Holding>): Holding => ({ id, assetClass: 'stock', name: id, costBasisNzd: null, ...fields });

const holdings: Holding[] = [
  h('s1', { assetClass: 'stock', symbol: 'QYLD', shares: 10, marketValueNzd: 300 }),
  h('s2', { assetClass: 'stock', symbol: 'qyld', shares: 5, marketValueNzd: 150 }),
  h('s3', { assetClass: 'stock', symbol: 'AIR.NZ', shares: 100 }),
  h('s4', { assetClass: 'stock', symbol: 'FPH', shares: 0, marketValueNzd: 0 }),
  h('s5', { assetClass: 'stock', symbol: 'SPK', shares: 1 }),
  h('s6', { assetClass: 'stock', symbol: 'SPK.NZ', shares: 1 }),
  h('c1', { assetClass: 'crypto', asset: 'BTC', amount: 0.5, marketValueNzd: 50000 }),
  h('m1', { assetClass: 'metal', metal: 'silver', amount: 1, unit: 'oz_t', marketValueNzd: 60 }),
  h('m2', { assetClass: 'metal', metal: 'silver', amount: 31.1034768, unit: 'g', marketValueNzd: 60 }),
  h('m3', { assetClass: 'metal', metal: 'gold', amount: 10, unit: 'g', marketValueNzd: 1500 }),
  h('f1', { assetClass: 'forex', currency: 'USD', amount: 500, marketValueNzd: 850 }),
  h('k1', { assetClass: 'collectable', cardGame: 'mtg', name: 'Lightning Bolt', cardSet: 'lea', cardFinish: 'nonfoil', quantity: 2, marketValueNzd: 900 }),
  h('k2', { assetClass: 'collectable', cardGame: 'mtg', name: 'Lightning Bolt', cardSet: '2xm', quantity: 1, marketValueNzd: 3 }),
  h('k3', { assetClass: 'collectable', cardGame: 'pokemon', name: 'Lightning Bolt', quantity: 1 }),
  h('k4', { assetClass: 'collectable', cardGame: 'mtg', name: 'Sol Ring', cardApiId: 'abc', quantity: 4, marketValueNzd: 20 }),
  h('g1', { assetClass: 'gomining_miner', hashrateThs: 100, estimatedValueNzd: 2000 }),
  h('g2', { assetClass: 'gomining_miner', hashrateThs: 50 }),
];

// Stocks: case-insensitive, lots summed, the holding's own value.
eq(findOwned(stock('QYLD'), holdings), { text: 'You own 15 shares', worthNzd: 450, href: '/portfolio?holding=s1#stocks' }, 'two QYLD lots');
eq(findOwned(stock('AIR'), holdings)?.text, 'You own 100 shares', 'AIR matches the only AIR.NZ holding');
eq(findOwned(stock('AIR.NZ'), holdings)?.worthNzd, null, 'no holding value → no worth (never searched price × shares)');
eq(findOwned(stock('SPK'), holdings)?.href, '/portfolio?holding=s5#stocks', 'exact symbol wins over the .NZ twin');
eq(findOwned(stock('SPK.AX'), holdings), null, 'other exchanges are not stripped');
eq(findOwned(stock('FPH'), holdings), null, 'sold (0 shares) holding is excluded');
eq(findOwned(stock('AAPL'), holdings), null, 'not held');
const ambiguous = [h('a', { symbol: 'XYZ', shares: 1 }), h('b', { symbol: 'XYZ.NZ', shares: 1 })];
eq(findOwned(stock('XYZ.AX'), ambiguous), null, 'unrelated suffix');
eq(findOwned(stock('XYZ'), ambiguous)?.href, '/portfolio?holding=a#stocks', 'exact match despite a .NZ sibling');
eq(findOwned(stock('XYZ.NZ'), [h('a', { symbol: 'XYZ', shares: 1 }), h('b', { symbol: 'xyz', shares: 2 })])?.text, 'You own 3 shares', '.NZ search vs bare lots of one listing');

// Crypto.
eq(findOwned(crypto('btc'), holdings), { text: 'You own 0.5 btc', worthNzd: 50000, href: '/portfolio?holding=c1#crypto' }, 'crypto by asset');

// Metals: summed across units, shown in oz t when units differ.
eq(findOwned(metal('silver'), holdings), { text: 'You own 2 oz t of silver', worthNzd: 120, href: '/portfolio?holding=m1#metals' }, 'silver oz t + g');
eq(findOwned(metal('gold'), holdings)?.text, 'You own 10 g of gold', 'single unit kept');

// Currency: the foreign side of the pair.
eq(findOwned(currency('USD', 'NZD'), holdings)?.text, 'You own 500 USD', 'USD → NZD');
eq(findOwned(currency('NZD', 'USD'), holdings)?.href, '/portfolio?holding=f1#other', 'NZD → USD');
eq(findOwned(currency('EUR', 'NZD'), holdings), null, 'EUR not held');

// Cards.
eq(findOwned(card({}), holdings), { text: 'You own 3 copies', worthNzd: 903, href: '/portfolio?holding=k1#collectables' }, 'name only: every MTG printing, not the Pokémon one');
eq(findOwned(card({ set: 'LEA' }), holdings)?.text, 'You own 2 copies', 'set narrows (case-insensitive)');
eq(findOwned(card({ set: 'lea', finish: 'foil' }), holdings), null, 'finish mismatch');
eq(findOwned(card({ name: 'Sol Ring', apiId: 'abc' }), holdings)?.text, 'You own 4 copies', 'by api id');
eq(findOwned(card({ name: 'Sol Ring', apiId: 'zzz' }), holdings), null, 'different api id is a different printing');

// Miners: all of them.
eq(findOwned(miner, holdings), { text: 'You own 2 miners, 150 TH/s total', worthNzd: null, href: '/portfolio?holding=g1#mining' }, 'miners, one without a value');

// Add links.
eq(addAction(stock('SPCX'), { forexEnabled: true }), { label: 'Add to Portfolio', href: '/portfolio?add=stock&ticker=SPCX#stocks' }, 'stock add');
eq(addAction(metal('gold', 2, 'kg'), { forexEnabled: true })?.href, '/portfolio?add=metal&metal=gold&amount=2000&unit=g#metals', 'kg converted for the gram/oz form');
eq(addAction(currency('USD', 'NZD'), { forexEnabled: true })?.href, '/portfolio?add=forex&currency=USD&amount=100#other', 'forex add with amount');
eq(addAction(currency('NZD', 'USD'), { forexEnabled: true })?.href, '/portfolio?add=forex&currency=USD#other', 'NZD amount is not a USD amount');
eq(addAction(currency('USD', 'NZD'), { forexEnabled: false }), null, 'forex disabled → no add button');
eq(addAction(currency('THB', 'NZD'), { forexEnabled: true }), null, 'currency the forex form lacks');
eq(addAction(card({ set: 'lea', number: '161' }), { forexEnabled: true })?.label, 'Add to collection', 'card label');
eq(addAction(miner, { forexEnabled: true })?.href, '/portfolio?add=miner&ths=100&wPerTh=15#mining', 'miner add');
eq(addAction({ ...common, type: 'diamond' }, { forexEnabled: true }), null, 'no prefilled add flow for diamonds');
eq(
  addAction({ ...stock('ZZZ'), value: null, status: { kind: 'unavailable', message: null } }, { forexEnabled: true }),
  null,
  'nothing found → nothing to add',
);

// Metal headline.
eq(metalHeadline(311.034768, null, null, 'oz_t'), { value: 311.034768, perUnit: 311.034768, note: 'per oz t' }, 'per oz t');
eq(metalHeadline(311.034768, null, null, 'g').note, 'per gram', 'per gram note');
eq(Math.round((metalHeadline(311.034768, null, null, 'g').value ?? 0) * 1e6), 10_000_000, 'per gram value');
eq(metalHeadline(311.034768, 10, 'g', 'oz_t').value?.toFixed(6), '100.000000', '10 g at any display unit');
eq(metalHeadline(null, 10, 'oz_t', 'g'), { value: null, perUnit: null, note: '10 oz t' }, 'unavailable stays null');

// "Things you own" shortcuts.
const label = (types: readonly SearchType[] = SEARCH_TYPES, list = holdings) =>
  ownedShortcuts(list, types).map((s) => `${s.label}|${s.query}|${s.type}`);
eq(
  label(),
  [
    'BTC|BTC|crypto',
    '150 TH/s|150 TH|miner',
    'Gold|gold|metal',
    'Lightning Bolt|Lightning Bolt|mtg',
    'QYLD|QYLD|stock',
    'Silver|silver|metal',
    'Sol Ring|Sol Ring|mtg',
    'AIR.NZ|AIR.NZ|stock',
    'Lightning Bolt|Lightning Bolt|pokemon',
    'SPK|SPK|stock',
  ],
  'value desc then name, lots and printings merged, miners as one, capped at 10',
);
eq(label().includes('FPH|FPH|stock'), false, 'sold holding has no shortcut');
eq(label().includes('SPK.NZ|SPK.NZ|stock'), false, 'eleventh shortcut cut');
eq(label().filter((l) => l.startsWith('QYLD')).length, 1, 'QYLD and qyld are one shortcut');
eq(
  label(['crypto', 'metal']),
  ['BTC|BTC|crypto', 'Gold|gold|metal', 'Silver|silver|metal'],
  'types turned off in Settings have no shortcuts',
);
eq(label(SEARCH_TYPES, holdings.filter((x) => x.assetClass !== 'gomining_miner')).some((l) => l.endsWith('|miner')), false, 'no miners, no miner button');
eq(label(SEARCH_TYPES, []), [], 'nothing held, nothing shown');
for (const s of ownedShortcuts(holdings, SEARCH_TYPES)) {
  const ctx = { enabled: new Set(SEARCH_TYPES), heldStocks: [], heldCrypto: [] };
  eq(parseAs(s.type, s.query, ctx)?.type, s.type, `shortcut ${s.label} runs as ${s.type}`);
}

// Recent searches.
const r = (query: string, type: SearchType): SavedSearch => ({ query, type });
let recents: SavedSearch[] = [];
for (const q of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']) recents = pushRecent(recents, r(q, 'stock'));
eq(recents.map((x) => x.query), ['a6', 'a5', 'a4', 'a3', 'a2'], 'most recent first, capped at 5');
eq(pushRecent(recents, r('  A3 ', 'stock')).map((x) => x.query), ['A3', 'a6', 'a5', 'a4', 'a2'], 'repeat moves to the top, trimmed');
eq(pushRecent([r('btc', 'crypto')], r('btc', 'stock')).length, 2, 'same text, different type is a different search');
eq(pushRecent(recents, r('   ', 'stock')), recents, 'empty query is not recorded');
eq(parseRecents(JSON.stringify([r('BTC', 'crypto'), r('btc', 'crypto'), r('x', 'stock')])), [r('BTC', 'crypto'), r('x', 'stock')], 'stored order kept, newest duplicate wins');
eq(parseRecents('{oops'), [], 'corrupt storage');
eq(parseRecents(null), [], 'nothing stored');
eq(parseRecents('{"query":"x"}'), [], 'not a list');
eq(parseRecents(JSON.stringify([{ query: 'x', type: 'bond' }, { query: 3, type: 'stock' }, null, r('ok', 'metal')])), [r('ok', 'metal')], 'unknown types and bad rows dropped');
eq(parseRecents(JSON.stringify(Array.from({ length: 8 }, (_, i) => r(`q${i}`, 'stock')))).length, 5, 'stored list capped');

// Sources line.
eq(pageSources(SEARCH_TYPES, 'gold-api.com'), ['Yahoo Finance', 'CoinGecko', 'Scryfall', 'pokemontcg.io', 'gold-api.com', 'Frankfurter', 'GoMining', 'OpenFacet'], 'every type');
eq(pageSources(['metal', 'currency'], 'metals.dev'), ['Metals.Dev', 'Frankfurter'], 'Metals.Dev when the server uses it');
eq(pageSources(['metal'], null), ['gold-api.com'], 'status unknown: default provider');
eq(pageSources(['stock'], 'metals.dev'), ['Yahoo Finance'], 'metals off: no metal source');

console.log('valueSearchView: all passed');
