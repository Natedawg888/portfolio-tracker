/**
 * Holding card icon URL chain (same spirit as quote fallbacks):
 *   Crypto: preferred → CoinGecko well-known → cryptocurrency-icons CDN
 *           → letter avatar (UI only, via HoldingIcon onError cascade).
 *   Stocks: preferred (Akahu/Sharesies logo) → FMP → Parqet → IEX logos
 *           → Clearbit (domain map) → letter avatar.
 * Never used for prices.
 */

/** CoinGecko small images for well-known tickers (incl. coins missing from CDN). */
export const WELL_KNOWN_COINGECKO_ICONS: Record<string, string> = {
  BTC: 'https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png?1696501400',
  ETH: 'https://coin-images.coingecko.com/coins/images/279/small/ethereum.png?1696501628',
  XRP: 'https://coin-images.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png?1696501442',
  SOL: 'https://coin-images.coingecko.com/coins/images/4128/small/solana.png?1718769756',
  ADA: 'https://coin-images.coingecko.com/coins/images/975/small/cardano.png?1696502090',
  DOGE: 'https://coin-images.coingecko.com/coins/images/5/small/dogecoin.png?1696501409',
  DOT: 'https://coin-images.coingecko.com/coins/images/12171/small/polkadot.jpg?1766533446',
  AVAX:
    'https://coin-images.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png?1696512369',
  MATIC: 'https://coin-images.coingecko.com/coins/images/4713/small/polygon.png?1698233745',
  LINK: 'https://coin-images.coingecko.com/coins/images/877/small/Chainlink_Logo_500.png?1760023405',
  LTC: 'https://coin-images.coingecko.com/coins/images/2/small/litecoin.png?1696501400',
  BCH: 'https://coin-images.coingecko.com/coins/images/780/small/bitcoin-cash-circle.png?1696501932',
  ATOM: 'https://coin-images.coingecko.com/coins/images/1481/small/cosmos_hub.png?1696502525',
  UNI: 'https://coin-images.coingecko.com/coins/images/12504/small/uniswap-logo.png?1720676669',
  XLM: 'https://coin-images.coingecko.com/coins/images/100/small/fmpFRHHQ_400x400.jpg?1735231350',
  NEAR: 'https://coin-images.coingecko.com/coins/images/10365/small/near.jpg?1696510367',
  APT: 'https://coin-images.coingecko.com/coins/images/26455/small/Aptos-Network-Profile-Picture_%281%29.png?1788259511',
  ARB: 'https://coin-images.coingecko.com/coins/images/16547/small/arb.jpg?1721358242',
  OP: 'https://coin-images.coingecko.com/coins/images/25244/small/Token.png?1774456081',
  SUI: 'https://coin-images.coingecko.com/coins/images/26375/small/sui-ocean-square.png?1727791290',
  TRX: 'https://coin-images.coingecko.com/coins/images/1094/small/photo_2026-04-13_09-59-16.png?1776048311',
  // CoinGecko id the-open-network (Toncoin / Gram lineage)
  TON: 'https://coin-images.coingecko.com/coins/images/17980/small/Gram_Circular_Badge.png?1781524778',
  SHIB: 'https://coin-images.coingecko.com/coins/images/11939/small/shiba.png?1696511800',
  USDT: 'https://coin-images.coingecko.com/coins/images/325/small/Tether.png?1696501661',
  USDC: 'https://coin-images.coingecko.com/coins/images/6319/small/USDC.png?1769615602',
  DAI: 'https://coin-images.coingecko.com/coins/images/9956/small/Badge_Dai.png?1696509996',
  AAVE: 'https://coin-images.coingecko.com/coins/images/12645/small/aave-token-round.png?1720472354',
  MKR: 'https://coin-images.coingecko.com/coins/images/1364/small/Mark_Maker.png?1696502423',
  CRV: 'https://coin-images.coingecko.com/coins/images/12124/small/Curve.png?1696511967',
  GMT: 'https://coin-images.coingecko.com/coins/images/15662/small/GoMining_Logo.webp?1769225542',
  GOMINING:
    'https://coin-images.coingecko.com/coins/images/15662/small/GoMining_Logo.webp?1769225542',
  BNB: 'https://coin-images.coingecko.com/coins/images/825/small/bnb-icon2_2x.png?1696501970',
  ETC: 'https://coin-images.coingecko.com/coins/images/453/small/ethereum-classic-logo.png?1696501717',
  FIL: 'https://coin-images.coingecko.com/coins/images/12817/small/filecoin.png?1696512609',
  ICP: 'https://coin-images.coingecko.com/coins/images/14495/small/Internet_Computer_logo.png?1696514180',
  ALGO: 'https://coin-images.coingecko.com/coins/images/4380/small/download.png?1696504978',
  VET: 'https://coin-images.coingecko.com/coins/images/1167/small/VET.png?1742383283',
  HBAR: 'https://coin-images.coingecko.com/coins/images/3688/small/hbar.png?1696504364',
  EGLD: 'https://coin-images.coingecko.com/coins/images/12335/small/egld-token-logo.png?1696512162',
  FTM: 'https://coin-images.coingecko.com/coins/images/4001/small/Fantom_round.png?1696504642',
  NEXO: 'https://coin-images.coingecko.com/coins/images/3695/small/CG-nexo-token-200x200_2x.png?1730414360',
  PEPE: 'https://coin-images.coingecko.com/coins/images/29850/small/pepe-token.jpeg?1696528776',
  // Cronos (Crypto.com Chain) — not in spothq/cryptocurrency-icons
  CRO: 'https://coin-images.coingecko.com/coins/images/7310/small/cro_token_logo.png?1696507599',
  CRONOS:
    'https://coin-images.coingecko.com/coins/images/7310/small/cro_token_logo.png?1696507599',
};

/**
 * Clearbit domain hints for common equity / ETF tickers (icons only).
 * logo.dev publishable tokens are optional via VITE_LOGO_DEV_TOKEN.
 */
const CLEARBIT_DOMAINS: Record<string, string> = {
  AAPL: 'apple.com',
  MSFT: 'microsoft.com',
  GOOGL: 'google.com',
  GOOG: 'google.com',
  AMZN: 'amazon.com',
  META: 'meta.com',
  NVDA: 'nvidia.com',
  TSLA: 'tesla.com',
  'BRK-B': 'berkshirehathaway.com',
  'BRK-A': 'berkshirehathaway.com',
  JPM: 'jpmorganchase.com',
  V: 'visa.com',
  MA: 'mastercard.com',
  NFLX: 'netflix.com',
  DIS: 'disney.com',
  INTC: 'intel.com',
  AMD: 'amd.com',
  PYPL: 'paypal.com',
  ADBE: 'adobe.com',
  CRM: 'salesforce.com',
  ORCL: 'oracle.com',
  IBM: 'ibm.com',
  CSCO: 'cisco.com',
  QCOM: 'qualcomm.com',
  TXN: 'ti.com',
  AVGO: 'broadcom.com',
  COST: 'costco.com',
  PEP: 'pepsico.com',
  KO: 'coca-cola.com',
  NKE: 'nike.com',
  SBUX: 'starbucks.com',
  BA: 'boeing.com',
  GE: 'ge.com',
  XOM: 'exxonmobil.com',
  CVX: 'chevron.com',
  AGNC: 'agnc.com',
  QYLD: 'globalxetfs.com',
  COIN: 'coinbase.com',
  PLTR: 'palantir.com',
  AIR: 'airnewzealand.co.nz',
  AIA: 'aia.com',
  FPH: 'fisherpaykelhealthcare.com',
  SPK: 'spark.co.nz',
  CBA: 'commbank.com.au',
  WBC: 'westpac.com.au',
  ANZ: 'anz.com',
  BHP: 'bhp.com',
  RIO: 'riotinto.com',
};

const CRYPTO_CDN =
  'https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/color';

/** Sanitize / absolute-ize a provider logo URL (Akahu/Sharesies/Hatch). */
export function normalizeLogoUrl(raw?: string | null): string | null {
  if (raw == null) return null;
  const u = String(raw).trim();
  if (!u) return null;
  if (/^javascript:/i.test(u) || /^data:/i.test(u)) return null;
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('/')) {
    // Sharesies instrument logos are always under data.sharesies.nz when relative.
    return `https://data.sharesies.nz${u}`;
  }
  if (!/^https?:\/\//i.test(u)) return null;
  // Prefer HTTPS to avoid mixed content if the app is ever served over TLS.
  if (u.startsWith('http://')) return `https://${u.slice('http://'.length)}`;
  return u;
}

/** Strip exchange suffix / Sharesies SKS.* prefix → bare ticker for CDN lookups. */
export function normalizeStockSymbol(ticker: string): string | null {
  const raw = ticker.trim().toUpperCase();
  if (!raw) return null;
  let symbol = raw;
  // Sharesies KiwiSaver / instrument ids: SKS.NASDAQ.NVDA → NVDA, SKS.NZX.KPG → KPG, SKS.FUND.SVOO → SVOO
  const sks = /^SKS\.(NASDAQ|NYSE|AMEX|NZX|ASX|LSE|LON|US|FUND)\.([A-Z0-9.-]+)$/i.exec(symbol);
  if (sks) symbol = sks[2];
  symbol = symbol.replace(/\.(US|NYSE|NASDAQ|AMEX|NZ|NZX|ASX|LSE|LON)$/i, '');
  symbol = symbol.replace(/\./g, '-');
  if (!/^[A-Z0-9^-]+$/.test(symbol)) return null;
  return symbol;
}

/** Public cryptocurrency-icons CDN by lowercase ticker (may 404 — caller cascades). */
export function cryptoCdnIconUrl(ticker: string): string | null {
  const t = ticker.trim().toLowerCase();
  if (!/^[a-z0-9]+$/.test(t)) return null;
  return `${CRYPTO_CDN}/${t}.png`;
}

/** Public FMP equity logo CDN — icons only, never prices. */
export function stockIconUrl(ticker: string): string | null {
  const symbol = normalizeStockSymbol(ticker);
  if (!symbol) return null;
  return `https://financialmodelingprep.com/image-stock/${encodeURIComponent(symbol)}.png`;
}

/** Parqet public equity logo CDN (ticker-based SVG/PNG). */
export function parqetStockIconUrl(ticker: string): string | null {
  const symbol = normalizeStockSymbol(ticker);
  if (!symbol) return null;
  return `https://assets.parqet.com/logos/symbol/${encodeURIComponent(symbol)}`;
}

/** Legacy IEX Cloud logo bucket (public GCS). */
export function iexStockIconUrl(ticker: string): string | null {
  const symbol = normalizeStockSymbol(ticker);
  if (!symbol) return null;
  return `https://storage.googleapis.com/iex/api/logos/${encodeURIComponent(symbol)}.png`;
}

/** Clearbit logo by known issuer domain (no API key). */
export function clearbitStockIconUrl(ticker: string): string | null {
  const symbol = normalizeStockSymbol(ticker);
  if (!symbol) return null;
  const domain = CLEARBIT_DOMAINS[symbol];
  if (!domain) return null;
  return `https://logo.clearbit.com/${domain}`;
}

/**
 * logo.dev ticker CDN when a publishable token is configured
 * (Vite: VITE_LOGO_DEV_TOKEN). Without a token this returns null.
 */
export function logoDevStockIconUrl(ticker: string): string | null {
  const symbol = normalizeStockSymbol(ticker);
  if (!symbol) return null;
  let token = '';
  try {
    // Vite client injects import.meta.env; Node/tsx server import leaves it unset.
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    token = String(env?.VITE_LOGO_DEV_TOKEN ?? '').trim();
  } catch {
    token = '';
  }
  if (!token) return null;
  return `https://img.logo.dev/ticker/${encodeURIComponent(symbol)}?token=${encodeURIComponent(token)}&format=png&size=64`;
}

export function wellKnownCoingeckoIcon(ticker: string): string | null {
  const t = ticker.trim().toUpperCase();
  return WELL_KNOWN_COINGECKO_ICONS[t] ?? null;
}

/**
 * Ordered icon candidates for crypto:
 * preferred (resolve/search thumb) → well-known CoinGecko → CDN by ticker.
 * Deduped; empty means letter avatar only.
 */
export function buildCryptoIconChain(
  ticker: string,
  preferredUrl?: string | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: string | null | undefined) => {
    if (!u) return;
    const url = u.trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  push(normalizeLogoUrl(preferredUrl));
  push(wellKnownCoingeckoIcon(ticker));
  push(cryptoCdnIconUrl(ticker));
  return out;
}

/**
 * Ordered icon candidates for stock:
 * preferred (Akahu) → FMP → Parqet → IEX → logo.dev → Clearbit.
 */
export function buildStockIconChain(
  ticker: string,
  preferredUrl?: string | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (u: string | null | undefined) => {
    if (!u) return;
    const url = u.trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  push(normalizeLogoUrl(preferredUrl));
  push(stockIconUrl(ticker));
  push(parqetStockIconUrl(ticker));
  push(iexStockIconUrl(ticker));
  push(logoDevStockIconUrl(ticker));
  push(clearbitStockIconUrl(ticker));
  return out;
}

/** Primary iconUrl for API resolve (first in chain, or null). */
export function resolveCryptoIconUrl(
  ticker: string,
  preferredUrl?: string | null,
): string | null {
  return buildCryptoIconChain(ticker, preferredUrl)[0] ?? null;
}

export function resolveStockIconUrl(
  ticker: string,
  preferredUrl?: string | null,
): string | null {
  return buildStockIconChain(ticker, preferredUrl)[0] ?? null;
}

export function letterChars(ticker: string): string {
  const t = ticker.replace(/[^A-Za-z0-9]/g, '');
  return (t.slice(0, 2) || '?').toUpperCase();
}
