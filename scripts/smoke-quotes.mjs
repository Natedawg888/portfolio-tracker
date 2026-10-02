/**
 * Smoke-test live quote modules (same code as API). Never invents.
 */
import { resolveStockTicker } from '../server/quotes/stocks.ts';
import { resolveCryptoTicker } from '../server/quotes/crypto.ts';
import {
  fetchMetalSpotNzd,
  metalsConfigured,
  metalsQuotaBlocked,
  metalsQuotaMessage,
} from '../server/quotes/metals.ts';
import { quoteDiamondOpenFacet } from '../server/quotes/stones.ts';
import { convertToNzd } from '../server/quotes/fx.ts';
import { getDb } from '../server/db/index.ts';
import { resolveMetalSpotNzd } from '../server/quotes/metalQuotesDb.ts';
import { loadDotEnv } from '../server/akahu/loadEnv.ts';

loadDotEnv();

const out = {
  metalsConfigured: metalsConfigured(),
  metalsQuotaBlocked: metalsQuotaBlocked(),
  metalsQuotaMessage: metalsQuotaMessage(),
};

try {
  const stock = await resolveStockTicker('AAPL');
  out.stockAAPL = {
    name: stock.name,
    yahoo: stock.yahooSymbol,
    status: stock.quote.status,
    price: stock.quote.price,
    source: stock.quote.source,
    message: stock.quote.message?.slice(0, 200),
  };
} catch (e) {
  out.stockAAPL = { error: String(e) };
}

try {
  const fph = await resolveStockTicker('FPH');
  out.stockFPH = {
    name: fph.name,
    yahoo: fph.yahooSymbol,
    status: fph.quote.status,
    price: fph.quote.price,
    source: fph.quote.source,
    message: fph.quote.message?.slice(0, 200),
  };
} catch (e) {
  out.stockFPH = { error: String(e) };
}

try {
  const gmt = await resolveCryptoTicker('GMT');
  out.gmt = {
    name: gmt.name,
    id: gmt.coingeckoId,
    status: gmt.quote.status,
    price: gmt.quote.price,
    source: gmt.quote.source,
    message: gmt.quote.message?.slice(0, 200),
  };
} catch (e) {
  out.gmt = { error: String(e) };
}

try {
  const btc = await resolveCryptoTicker('BTC');
  out.btc = {
    name: btc.name,
    id: btc.coingeckoId,
    status: btc.quote.status,
    price: btc.quote.price,
    source: btc.quote.source,
    message: btc.quote.message?.slice(0, 160),
  };
} catch (e) {
  out.btc = { error: String(e) };
}

try {
  const db = await getDb();
  const metals = await resolveMetalSpotNzd(db, false);
  out.metals = Object.fromEntries(
    Object.entries(metals).map(([k, v]) => [
      k,
      {
        status: v.status,
        price: v.price,
        source: v.source,
        asOf: v.asOf,
        message: v.message?.slice(0, 180),
      },
    ]),
  );
} catch (e) {
  out.metals = { error: String(e) };
}

try {
  const d = await quoteDiamondOpenFacet({
    carat: 1,
    colour: 'G',
    clarity: 'VS2',
    shape: 'round',
  });
  out.diamond = {
    status: d.status,
    price: d.price,
    source: d.source,
    message: d.message?.slice(0, 240),
    assetKey: d.assetKey,
  };
} catch (e) {
  out.diamond = { error: String(e) };
}

try {
  out.fx = await convertToNzd(1, 'USD', false);
} catch (e) {
  out.fx = { error: String(e) };
}

console.log(JSON.stringify(out, null, 2));
