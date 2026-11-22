/**
 * Asset normalisation for wallet tokens (KAN-39).
 *
 * - Known tokens: ERC-20 contracts (knownTokens.ts, each checked on-chain) and SPL mints map to a
 *   canonical symbol and name. A known token is priced only when it maps to a coin the crypto
 *   quote engine already knows (KNOWN_CRYPTO), by an explicit ticker: wrapped and bridged coins
 *   that are redeemable 1:1 (WETH → ETH, WBTC → BTC, USDC.e → USDC, WSOL → SOL). Never by
 *   searching a symbol, so a token calling itself "USDC" can't borrow USDC's price.
 * - Spam: names or symbols that advertise (URLs, "claim", "visit", "airdrop", "reward"), or are
 *   too long or not plain text. Flagged and hidden.
 * - Unknown: everything else. Flagged, hidden by default, never priced.
 * Hidden tokens never count in a total; the API leaves them out unless asked (?showHidden=1).
 */
import { KNOWN_CRYPTO } from '../../src/lib/knownCrypto.ts';
import type { WalletNetwork } from '../lib/walletAddress.ts';
import { KNOWN_TOKENS } from './knownTokens.ts';
import type { ChainAsset } from './types.ts';

export type TokenClass = 'native' | 'known' | 'unknown' | 'spam';

/** Well-known SPL mints (Solana). Decimals always come from the chain. */
export const KNOWN_SPL_MINTS: Readonly<Record<string, { symbol: string; name: string }>> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', name: 'USD Coin' },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', name: 'Tether USD' },
  So11111111111111111111111111111111111111112: { symbol: 'WSOL', name: 'Wrapped SOL' },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: { symbol: 'MSOL', name: 'Marinade staked SOL' },
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: { symbol: 'JITOSOL', name: 'Jito staked SOL' },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: 'JUP', name: 'Jupiter' },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: 'BONK', name: 'Bonk' },
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: { symbol: 'WIF', name: 'dogwifhat' },
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: { symbol: 'PYTH', name: 'Pyth Network' },
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': { symbol: 'RAY', name: 'Raydium' },
};

/**
 * Canonical symbol → quote ticker, only where the token is the coin itself or redeemable 1:1
 * for it. Liquid-staking tokens (stETH, cbETH, mSOL, jitoSOL) trade at their own rate, so they
 * stay unpriced rather than be guessed from ETH or SOL.
 */
const PRICE_AS: Readonly<Record<string, string>> = {
  USDT: 'USDT',
  USDC: 'USDC',
  'USDC.e': 'USDC',
  USDbC: 'USDC',
  DAI: 'DAI',
  WETH: 'ETH',
  WBTC: 'BTC',
  cbBTC: 'BTC',
  WPOL: 'POL',
  WSOL: 'SOL',
  LINK: 'LINK',
  UNI: 'UNI',
  AAVE: 'AAVE',
  ARB: 'ARB',
};

type Known = { symbol: string; name: string; priceTicker: string | null };

const ticker = (symbol: string): string | null => {
  const t = PRICE_AS[symbol];
  return t && KNOWN_CRYPTO[t] ? t : null;
};

/** The known token at this contract / mint on this network, or null. */
export function knownToken(network: WalletNetwork, contract: string | null): Known | null {
  if (!contract) return null;
  if (network === 'solana') {
    const m = KNOWN_SPL_MINTS[contract];
    return m ? { ...m, priceTicker: ticker(m.symbol) } : null;
  }
  const t = (KNOWN_TOKENS[network] ?? []).find((k) => k.contract.toLowerCase() === contract.toLowerCase());
  return t ? { symbol: t.symbol, name: t.name, priceTicker: ticker(t.symbol) } : null;
}

const SPAM_WORDS = /(https?:|www\.|\.(com|io|net|org|xyz|app|site|top|gift|claims?|vip|cc|me|to|link|fi)\b|t\.me|claim|visit|airdrop|reward|voucher|bonus|redeem|giveaway|free\s|access\s|eligible|\$\s?\d)/i;

/** True when a token's symbol or name looks like an advert rather than a coin. */
export function looksLikeSpam(asset: Pick<ChainAsset, 'symbol' | 'name'>): boolean {
  const s = asset.symbol ?? '';
  const n = asset.name ?? '';
  if (SPAM_WORDS.test(s) || SPAM_WORDS.test(n)) return true;
  if (s.length > 15) return true;
  // Plain printable text only: lookalike letters and emoji are a common scam tell.
  if (/[^\x20-\x7E]/.test(s)) return true;
  return false;
}

/** Normalise one balance's asset: canonical symbol and name, class, and how to price it. */
export function normaliseAsset(network: WalletNetwork, asset: ChainAsset): { asset: ChainAsset; tokenClass: TokenClass; priceTicker: string | null } {
  if (asset.kind === 'native') return { asset, tokenClass: 'native', priceTicker: asset.symbol };
  const known = knownToken(network, asset.contract);
  if (known) return { asset: { ...asset, symbol: known.symbol, name: known.name }, tokenClass: 'known', priceTicker: known.priceTicker };
  return { asset, tokenClass: looksLikeSpam(asset) ? 'spam' : 'unknown', priceTicker: null };
}

/** Spam and unknown tokens are hidden unless the user asks to see them. */
export const isHiddenClass = (c: TokenClass): boolean => c === 'spam' || c === 'unknown';
