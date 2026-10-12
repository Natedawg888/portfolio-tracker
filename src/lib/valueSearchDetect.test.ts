/**
 * Value Search auto-detection. Run: npm run test:value-search
 */
import {
  detectQuery,
  formatCurrencyQuery,
  parseAs,
  SEARCH_TYPES,
  visibleSearchTypes,
  type DetectContext,
  type ParsedQuery,
  type SearchType,
} from './valueSearchDetect.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`FAIL: ${msg} (got ${ja}, expected ${jb})`);
}

const all: DetectContext = {
  enabled: new Set(SEARCH_TYPES),
  heldStocks: ['QYLD', 'AIR.NZ'],
  heldCrypto: ['BTC', 'KAS'],
};
const without = (...off: SearchType[]): DetectContext => ({
  ...all,
  enabled: new Set(SEARCH_TYPES.filter((t) => !off.includes(t))),
});
const detect = (q: string, ctx = all): ParsedQuery | null => detectQuery(q, ctx);

// The user's examples.
eq(detect('SPCX'), { type: 'stock', symbol: 'SPCX' }, 'SPCX is a stock');
eq(detect('BTC'), { type: 'crypto', symbol: 'BTC' }, 'BTC is crypto');
eq(detect('bitcoin'), { type: 'crypto', symbol: 'BTC' }, 'bitcoin by name is crypto BTC');
eq(detect('Lightning Bolt'), { type: 'mtg', name: 'Lightning Bolt' }, 'card name falls to MTG');
eq(detect('silver'), { type: 'metal', metal: 'silver', amount: null, unit: null }, 'silver is a metal');
eq(
  detect('100 USD to NZD'),
  { type: 'currency', amount: 100, from: 'USD', to: 'NZD' },
  'currency with amount',
);
eq(detect('100 TH'), { type: 'miner', ths: 100, wPerTh: null }, '100 TH is a miner');
eq(detect('100 th/s')?.type, 'miner', 'lowercase th/s is a miner');
eq(detect('100TH')?.type, 'miner', 'TH glued to the number is a miner');
eq(detect('100th anniversary')?.type, 'mtg', 'an ordinal is not a hashrate');

// Variants.
eq(detect('usd in aud'), { type: 'currency', amount: null, from: 'USD', to: 'AUD' }, 'amount optional, "in"');
eq(detect('1,000 eur to nzd'), { type: 'currency', amount: 1000, from: 'EUR', to: 'NZD' }, 'thousands separator');
eq(detect('100TH/s'), { type: 'miner', ths: 100, wPerTh: null }, 'TH/s without space');
eq(detect('100 TH 15 W/TH'), { type: 'miner', ths: 100, wPerTh: 15 }, 'W/TH is parsed, not taken as hashrate');
eq(detect('silver 10 oz'), { type: 'metal', metal: 'silver', amount: 10, unit: 'oz_t' }, 'oz is troy oz');
eq(detect('gold 5g'), { type: 'metal', metal: 'gold', amount: 5, unit: 'g' }, 'grams');
eq(detect('Goldfish'), { type: 'mtg', name: 'Goldfish' }, 'metal must be a whole word');
eq(detect('AIR.NZ'), { type: 'stock', symbol: 'AIR.NZ' }, 'dotted ticker');

// Holdings.
eq(detect('qyld'), { type: 'stock', symbol: 'QYLD' }, 'held lowercase ticker is a stock');
eq(detect('kas'), { type: 'crypto', symbol: 'KAS' }, 'held crypto outside the known list');
eq(detect('aapl'), { type: 'mtg', name: 'aapl' }, 'unheld lowercase word is not a stock');

// Diamond.
eq(detect('1.2 ct'), { type: 'diamond', carat: 1.2, colour: null, clarity: null, shape: null }, '1.2 ct');
eq(
  detect('1ct G VS1 round'),
  { type: 'diamond', carat: 1, colour: 'G', clarity: 'VS1', shape: 'round' },
  'full diamond spec',
);

// Disabled types fall through to the next rule.
eq(detect('BTC', without('crypto')), { type: 'stock', symbol: 'BTC' }, 'crypto off: BTC is a stock-shaped ticker');
eq(detect('silver', without('metal')), { type: 'mtg', name: 'silver' }, 'metal off: falls to MTG');
eq(detect('1.2 ct', without('diamond')), { type: 'mtg', name: '1.2 ct' }, 'diamond off: falls to MTG');
eq(
  detect('100 USD to NZD', without('currency')),
  { type: 'mtg', name: '100 USD to NZD' },
  'currency off: not parsed as currency',
);
eq(
  detect('Lightning Bolt', without('mtg')),
  { type: 'pokemon', name: 'Lightning Bolt' },
  'MTG off: first enabled type that accepts it',
);
eq(
  detect('Lightning Bolt', { ...all, enabled: new Set<SearchType>(['metal', 'miner']) }),
  null,
  'nothing enabled accepts it',
);
eq(detect('   '), null, 'empty query');

// Explicit type buttons parse leniently.
eq(parseAs('miner', '100', all), { type: 'miner', ths: 100, wPerTh: null }, 'Miner: bare number');
eq(parseAs('currency', '50 usd', all), { type: 'currency', amount: 50, from: 'USD', to: 'NZD' }, 'Currency: to NZD');
eq(parseAs('stock', 'aapl', all), { type: 'stock', symbol: 'AAPL' }, 'Stock: any case');
eq(parseAs('pokemon', 'Charizard', all), { type: 'pokemon', name: 'Charizard' }, 'Pokémon: name');
eq(parseAs('metal', 'Charizard', all), null, 'Metal: needs a metal name');

// Pasted card ids.
const SCRYFALL = 'E3285E6B-3E79-4D7C-BF96-D920F973B122';
eq(detect(SCRYFALL), { type: 'mtg', apiId: SCRYFALL.toLowerCase() }, 'Scryfall UUID is an MTG card id');
eq(detect('sv3pt5-25'), { type: 'pokemon', apiId: 'sv3pt5-25' }, 'pokemontcg id');
eq(detect('base1-4'), { type: 'pokemon', apiId: 'base1-4' }, 'pokemontcg id, short set');
eq(detect('swsh12pt5gg-GG01'), { type: 'pokemon', apiId: 'swsh12pt5gg-GG01' }, 'pokemontcg id, lettered number');
eq(detect('sv3pt5-25', without('pokemon')), { type: 'mtg', name: 'sv3pt5-25' }, 'Pokémon off: id is just a name');
eq(detect(SCRYFALL, without('mtg'))?.type, 'pokemon', 'MTG off: UUID is not an MTG id');
eq(detect('BRK-B'), { type: 'mtg', name: 'BRK-B' }, 'no digit in the set part: not a Pokémon id');
eq(parseAs('mtg', 'sv3pt5-25', all), { type: 'mtg', name: 'sv3pt5-25' }, 'MTG button: Pokémon id is a name');
eq(parseAs('mtg', SCRYFALL, all), { type: 'mtg', apiId: SCRYFALL.toLowerCase() }, 'MTG button: UUID is an id');

// Currency query round trip (picker / swap rewrite the query).
for (const q of ['100 USD to NZD', 'EUR to AUD', '2.5 GBP to JPY']) {
  const parsed = detect(q);
  if (parsed?.type !== 'currency') throw new Error(`FAIL: ${q} should parse as currency`);
  eq(detect(formatCurrencyQuery(parsed)), parsed, `formatCurrencyQuery round-trips ${q}`);
}

// Visible types (the page and its nav link).
const prefsOn = (...on: string[]) => (key: string) => on.includes(key);
eq(visibleSearchTypes(prefsOn('stock', 'collectable'), { showCurrencyExchanger: false }), ['stock', 'mtg', 'pokemon'], 'collectables show both card games');
eq(visibleSearchTypes(prefsOn('forex'), { showCurrencyExchanger: false }), [], 'Forex holdings alone show nothing');
eq(visibleSearchTypes(prefsOn(), { showCurrencyExchanger: true }), ['currency'], 'exchanger alone shows currency');
eq(visibleSearchTypes(prefsOn('metal', 'gomining', 'stone', 'crypto'), { showCurrencyExchanger: true }), ['crypto', 'metal', 'currency', 'miner', 'diamond'], 'display order');

console.log('valueSearchDetect: all passed');
