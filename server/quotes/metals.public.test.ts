/**
 * Public NZD metal spots do not require METALS_API_KEY and do not invent prices.
 * Run: npm run test:metals
 */
import assert from 'node:assert/strict';
import {
  fetchMetalSpotNzd,
  parseGoldApiNzd,
  resetMetalsRuntimeState,
} from './metals.ts';
import { metalSpotQuoteNote, summarizeStoredMetalSpots } from './metalSpotCopy.ts';

const originalFetch = globalThis.fetch;
const originalKey = process.env.METALS_API_KEY;

function restore() {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.METALS_API_KEY;
  else process.env.METALS_API_KEY = originalKey;
  resetMetalsRuntimeState();
}

function goldApiBody(symbol: string, price: number, currency = 'NZD') {
  return {
    name: symbol,
    symbol,
    currency,
    price,
    updatedAt: '2026-10-05T01:39:06.000Z',
    exchangeRate: 9.99,
  };
}

const FIXTURE: Record<string, number> = {
  XAU: 111.11,
  XAG: 22.22,
  XPT: 33.33,
  XPD: 44.44,
};

function installFetch(handler: (url: string) => { status: number; body: unknown }) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const result = handler(url);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

try {
  const parsed = parseGoldApiNzd('gold', goldApiBody('XAU', 111.11));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.price, 111.11);
    assert.equal(parsed.asOf, '2026-10-05T01:39:06.000Z');
  }

  const usd = parseGoldApiNzd('gold', goldApiBody('XAU', 111.11, 'USD'));
  assert.equal(usd.ok, false);

  const swapped = parseGoldApiNzd('silver', goldApiBody('XAU', 111.11));
  assert.equal(swapped.ok, false);

  const blank = parseGoldApiNzd('gold', { symbol: 'XAU', currency: 'NZD', price: null, exchangeRate: 1.7 });
  assert.equal(blank.ok, false);

  delete process.env.METALS_API_KEY;
  resetMetalsRuntimeState();
  const calls = installFetch((url) => {
    const symbol = url.split('/').at(-2) ?? '';
    return { status: 200, body: goldApiBody(symbol, FIXTURE[symbol] ?? 0) };
  });
  const spots = await fetchMetalSpotNzd(true);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((url) => url.startsWith('https://api.gold-api.com/price/') && url.endsWith('/NZD')));
  assert.ok(calls.every((url) => !url.includes('metals.dev') && !url.includes('api_key')));
  assert.equal(spots.gold.price, 111.11);
  assert.equal(spots.silver.price, 22.22);
  assert.equal(spots.platinum.price, 33.33);
  assert.equal(spots.palladium.price, 44.44);
  assert.equal(spots.gold.source, 'gold-api');
  assert.equal(spots.gold.currency, 'NZD');
  assert.equal(spots.gold.status, 'ok');
  assert.ok(!spots.gold.message?.includes('METALS_API_KEY'));
  // exchangeRate 9.99 must not be applied to the NZD price.
  assert.notEqual(spots.gold.price, 111.11 * 9.99);

  resetMetalsRuntimeState();
  installFetch(() => ({
    status: 200,
    body: { symbol: 'XAU', currency: 'USD', price: 50, exchangeRate: 1.5 },
  }));
  const rejected = await fetchMetalSpotNzd(true);
  for (const metal of ['gold', 'silver', 'platinum', 'palladium'] as const) {
    assert.equal(rejected[metal].price, null);
    assert.equal(rejected[metal].status, 'unavailable');
  }

  const noted = summarizeStoredMetalSpots(spots);
  assert.equal(noted.status, 'ok');
  assert.equal(noted.source, 'gold-api');
  const availableNote = metalSpotQuoteNote({ configured: false, ...noted });
  assert.match(availableNote, /gold-api\.com/);
  assert.doesNotMatch(availableNote, /unavailable/);
  const missingNote = metalSpotQuoteNote({
    configured: false,
    status: 'unavailable',
    source: null,
  });
  assert.match(missingNote, /unavailable from gold-api\.com/);
  const devNote = metalSpotQuoteNote({
    configured: true,
    status: 'ok',
    source: 'metals_dev',
  });
  assert.match(devNote, /Metals\.Dev/);
  assert.doesNotMatch(devNote, /gold-api\.com/);

  console.log('metals public spot tests passed');
} finally {
  restore();
}
