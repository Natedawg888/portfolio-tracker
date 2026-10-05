/**
 * Quote providers — return unavailable/stubbed when not wired; NEVER invent prices.
 */
import type { QuoteProvider, QuoteResult } from '../../src/types/index.ts';
import {
  getMetalQuote,
  metalAssetKey,
  parseMetalAssetKey,
} from './metals.ts';
import {
  parseStoneAssetKey,
  quoteDiamondFromAssetKey,
} from './stones.ts';
import {
  getStockQuoteNzd,
  parseStockAssetKey,
} from './stocks.ts';
import { resolveCryptoTicker } from './crypto.ts';

function stubResult(
  assetKey: string,
  source: QuoteResult['source'],
  message: string,
): QuoteResult {
  return {
    assetKey,
    currency: 'NZD',
    price: null,
    status: 'stubbed',
    source,
    asOf: null,
    message,
  };
}

/**
 * Crypto spot → NZD via CoinGecko (then Coinbase/Kraken public + FX).
 * Asset keys: CRYPTO:{TICKER} (e.g. CRYPTO:GMT for GoMining Token).
 * Docs: https://docs.coingecko.com/reference/simple-price
 */
export const cryptoQuoteProvider: QuoteProvider = {
  id: 'coingecko',
  name: 'CoinGecko crypto (NZD)',
  async getQuote(assetKey: string): Promise<QuoteResult> {
    const m = /^CRYPTO:(.+)$/i.exec(assetKey.trim());
    if (!m?.[1]) {
      return stubResult(
        assetKey,
        'stub',
        'Unrecognized crypto asset key. Expected CRYPTO:{TICKER}. Provider: CoinGecko https://www.coingecko.com/ · https://docs.coingecko.com/reference/simple-price',
      );
    }
    const resolved = await resolveCryptoTicker(m[1].trim().toUpperCase(), false);
    return { ...resolved.quote, assetKey: `CRYPTO:${m[1].trim().toUpperCase()}` };
  },
  async getQuotes(assetKeys: string[]): Promise<QuoteResult[]> {
    return Promise.all(assetKeys.map((k) => this.getQuote(k)));
  },
};

/** Legacy id kept for callers that still ask for "kraken" — routes to CoinGecko path. */
export const krakenQuoteProvider: QuoteProvider = cryptoQuoteProvider;

/**
 * Precious metal spot → NZD. gold-api.com unless METALS_API_KEY selects Metals.Dev.
 * Prices are NZD per troy ounce; holdings in grams are converted.
 */
export const metalQuoteProvider: QuoteProvider = {
  id: 'metal-spot',
  name: 'Metals.Dev spot (NZD)',
  async getQuote(assetKey: string): Promise<QuoteResult> {
    const parsed = parseMetalAssetKey(assetKey);
    if (!parsed) {
      return stubResult(
        assetKey,
        'stub',
        'Unrecognized metal asset key. Expected METAL:{gold|silver|platinum|palladium}:{g|oz_t}.',
      );
    }
    // Always quote as NZD per troy ounce (canonical).
    const quote = await getMetalQuote(parsed.metal, false);
    return {
      ...quote,
      assetKey: metalAssetKey(parsed.metal, 'oz_t'),
    };
  },
  async getQuotes(assetKeys: string[]): Promise<QuoteResult[]> {
    return Promise.all(assetKeys.map((k) => this.getQuote(k)));
  },
};

/**
 * GoMining digital miner valuation via public primary generative marketplace.
 * Prefer estimateMinerValueNzd (hashrate + EE) from holdings refresh — getQuote alone
 * cannot price without TH (returns stubbed guidance).
 * https://gomining.com/ · docs marketplace + nft-collection/find-all-generative
 */
export const goMiningQuoteProvider: QuoteProvider = {
  id: 'gomining',
  name: 'GoMining marketplace (primary generative USD/TH)',
  async getQuote(assetKey: string): Promise<QuoteResult> {
    return stubResult(
      assetKey,
      'gomining',
      'Call POST /api/holdings/:id/refresh-value (or refresh-gomining-values) with miner hashrate — prices from nft-collection/find-all-generative × BTC FX. Never invent.',
    );
  },
};

/**
 * Equity live quotes — Yahoo Finance × Frankfurter/BTC FX → NZD
 * (same pipeline as stock history charts). Never invents.
 */
export const stockQuoteProvider: QuoteProvider = {
  id: 'stock',
  name: 'Yahoo Finance equity (NZD)',
  async getQuote(assetKey: string): Promise<QuoteResult> {
    const parsed = parseStockAssetKey(assetKey);
    if (!parsed) {
      return stubResult(
        assetKey,
        'stub',
        'Unrecognized equity asset key. Expected STOCK:{TICKER}.',
      );
    }
    return getStockQuoteNzd(parsed.ticker);
  },
  async getQuotes(assetKeys: string[]): Promise<QuoteResult[]> {
    return Promise.all(assetKeys.map((k) => this.getQuote(k)));
  },
};

/**
 * Diamonds: OpenFacet MCP → USD → Frankfurter NZD (see stones.ts).
 * Non-diamond / unknown keys: not_applicable — manual estimate only.
 */
export const stoneCompProvider: QuoteProvider = {
  id: 'stone-comp',
  name: 'OpenFacet diamonds / manual other gems',
  async getQuote(assetKey: string): Promise<QuoteResult> {
    if (parseStoneAssetKey(assetKey)) {
      return quoteDiamondFromAssetKey(assetKey, false);
    }
    return {
      assetKey,
      currency: 'NZD',
      price: null,
      status: 'not_applicable',
      source: 'search_comp',
      asOf: null,
      message:
        'Live stone quotes are diamond-only via OpenFacet (https://openfacet.net/ · MCP https://mcp.openfacet.net/). Other gems need a manual estimated NZD — never invent. No live ruby/sapphire/emerald API wired.',
    };
  },
};

export const providers: Record<string, QuoteProvider> = {
  kraken: krakenQuoteProvider,
  coingecko: cryptoQuoteProvider,
  metal: metalQuoteProvider,
  gomining: goMiningQuoteProvider,
  stock: stockQuoteProvider,
  stone: stoneCompProvider,
};

export function providerForAssetKey(assetKey: string): QuoteProvider {
  if (assetKey.startsWith('CRYPTO:')) {
    return cryptoQuoteProvider;
  }
  if (assetKey.startsWith('FX:')) {
    // Forex holdings use Frankfurter via holdings refresh — not this stub path.
    return {
      id: 'frankfurter',
      name: 'Frankfurter FX (ECB)',
      async getQuote(key) {
        return stubResult(
          key,
          'stub',
          'Forex NZD via Frankfurter https://www.frankfurter.app/ — use POST /api/holdings/:id/refresh-value or Portfolio Refresh FX rates.',
        );
      },
    };
  }
  if (assetKey.startsWith('METAL:')) return metalQuoteProvider;
  if (assetKey.startsWith('GOMINING:')) return goMiningQuoteProvider;
  if (assetKey.startsWith('STOCK:')) return stockQuoteProvider;
  if (assetKey.startsWith('STONE:')) return stoneCompProvider;
  return {
    id: 'unknown',
    name: 'Unknown',
    async getQuote(key) {
      return stubResult(key, 'stub', 'No provider for this asset key.');
    },
  };
}
