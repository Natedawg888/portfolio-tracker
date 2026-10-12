/**
 * Portfolio add / holding link params. Run: npm run test:value-search
 */
import {
  holdingHref,
  parsePortfolioAddParams,
  portfolioAddHref,
  type PortfolioAddRequest,
} from './portfolioAddParams.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`FAIL: ${msg} (got ${ja}, expected ${jb})`);
}

const parse = (qs: string) => parsePortfolioAddParams(new URLSearchParams(qs));

// Every request survives the link round trip, and the hash names its tab.
const requests: [PortfolioAddRequest, string][] = [
  [{ kind: 'stock', ticker: 'AIR.NZ' }, '#stocks'],
  [{ kind: 'crypto', ticker: 'BTC' }, '#crypto'],
  [{ kind: 'metal', metal: 'silver', amount: 10, unit: 'oz_t' }, '#metals'],
  [{ kind: 'metal', metal: 'gold', amount: null, unit: null }, '#metals'],
  [{ kind: 'forex', currency: 'USD', amount: 100 }, '#other'],
  [{ kind: 'miner', ths: 100, wPerTh: 15 }, '#mining'],
  [
    { kind: 'card', game: 'mtg', name: 'Lightning Bolt', set: 'lea', number: '161', finish: 'foil', apiId: null },
    '#collectables',
  ],
  [
    { kind: 'card', game: 'pokemon', name: null, set: null, number: null, finish: 'reverseHolofoil', apiId: 'sv3pt5-25' },
    '#collectables',
  ],
];
for (const [req, hash] of requests) {
  const href = portfolioAddHref(req);
  eq(href.startsWith('/portfolio?') && href.endsWith(hash), true, `${req.kind} href ${href} ends with ${hash}`);
  const url = new URL(href, 'http://x');
  eq(parsePortfolioAddParams(url.searchParams), req, `${req.kind} round-trips through ${href}`);
}

// Normalisation.
eq(parse('add=stock&ticker=%20aapl%20'), { kind: 'stock', ticker: 'AAPL' }, 'ticker trimmed and upper-cased');
eq(parse('add=forex&currency=eur'), { kind: 'forex', currency: 'EUR', amount: null }, 'currency upper-cased');

// Junk is ignored.
eq(parse(''), null, 'no add param');
eq(parse('add=house'), null, 'unknown kind');
eq(parse('add=stock'), null, 'stock without ticker');
eq(parse('add=stock&ticker=%3Cscript%3E'), null, 'ticker with markup');
eq(parse('add=metal&metal=unobtanium&amount=5'), null, 'unknown metal');
eq(parse('add=metal&metal=gold&amount=-5&unit=kg'), { kind: 'metal', metal: 'gold', amount: null, unit: null }, 'negative amount and unknown unit dropped');
eq(parse('add=forex&currency=XYZ'), null, 'currency the forex form does not offer');
eq(parse('add=miner&ths=abc&wPerTh=0'), { kind: 'miner', ths: null, wPerTh: null }, 'non-numeric and zero dropped');
eq(parse('add=card&game=yugioh&name=Dark'), null, 'unknown game');
eq(parse('add=card&game=mtg'), null, 'card with neither name nor id');
eq(
  parse('add=card&game=mtg&name=Bolt&finish=holofoil&apiId=..%2Fadmin'),
  { kind: 'card', game: 'mtg', name: 'Bolt', set: null, number: null, finish: null, apiId: null },
  "a Pokémon finish on an MTG card and a path-like id are dropped",
);
eq(parse(`add=card&game=mtg&name=${'x'.repeat(200)}`), null, 'overlong name');

eq(holdingHref('metals', 'abc-123'), '/portfolio?holding=abc-123#metals', 'holding link keeps the tab in the hash');

console.log('portfolioAddParams: all passed');
