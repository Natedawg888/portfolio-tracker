/**
 * resolveStockTicker exposes the Yahoo price, its currency and the FX rate it applied.
 * Run: npm run test:stock-resolve
 */
import assert from 'node:assert/strict';
import { clearStockQuoteCache, resolveStockTicker } from './stocks.ts';
import { clearFxCache } from './fx.ts';

const originalFetch = globalThis.fetch;

function yahooChart(symbol: string, price: number, currency: string) {
  return {
    chart: {
      result: [{ meta: { symbol, currency, regularMarketPrice: price, regularMarketTime: 1_760_000_000, longName: 'Space Exploration Technologies Corp' } }],
    },
  };
}

function installFetch(handler: (url: string) => { status: number; body: unknown }) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const result = handler(String(input));
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

function reset() {
  clearStockQuoteCache();
  clearFxCache();
}

try {
  reset();
  installFetch((url) => {
    if (url.includes('finance.yahoo.com')) return { status: 200, body: yahooChart('SPCX', 20, 'USD') };
    if (url.includes('frankfurter')) return { status: 200, body: { date: '2026-10-10', rates: { NZD: 1.7 } } };
    return { status: 404, body: {} };
  });
  const usd = await resolveStockTicker('SPCX', { force: true });
  assert.equal(usd.quote.status, 'ok');
  assert.ok(Math.abs((usd.quote.price ?? 0) - 34) < 1e-9, 'NZD price is USD × rate');
  assert.deepEqual(usd.native, { price: 20, currency: 'USD', fxRate: 1.7 }, 'USD listing exposes native price and rate');

  reset();
  installFetch((url) => {
    if (url.includes('finance.yahoo.com')) return { status: 200, body: yahooChart('AIR.NZ', 1.5, 'NZD') };
    return { status: 404, body: {} };
  });
  const nzd = await resolveStockTicker('AIR.NZ', { force: true });
  assert.deepEqual(nzd.native, { price: 1.5, currency: 'NZD', fxRate: 1 }, 'NZD listing needs no conversion');

  reset();
  installFetch((url) => {
    if (url.includes('finance.yahoo.com')) return { status: 200, body: yahooChart('SPCX', 20, 'USD') };
    return { status: 500, body: {} };
  });
  const noFx = await resolveStockTicker('SPCX', { force: true });
  assert.equal(noFx.quote.price, null, 'no FX → no NZD price');
  assert.equal(noFx.native, null, 'no FX → no native fields either');

  console.log('stocks.native: all passed');
} finally {
  globalThis.fetch = originalFetch;
  reset();
}
