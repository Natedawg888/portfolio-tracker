/**
 * NZD valuation of chain balances: priced / stale / unpriced, token exclusion,
 * failed wallets excluded without corrupting totals. Quotes are injected — no network.
 * Run: npm run test:chain
 */
import type { QuoteResult } from '../../src/types/index.ts';
import { NETWORK_CHAIN_INFO } from './networks.ts';
import { registerChainProvider, resetChainProvidersForTest } from './registry.ts';
import { blockNetwork, resetRateLimitsForTest } from './rateLimit.ts';
import { ChainProviderError, type ChainAsset, type ChainBalance } from './types.ts';
import { withoutHidden,
  STALE_AFTER_MS,
  clearWalletBalanceCache,
  combineValuations,
  valueBalancesNzd,
  valueWallet,
  type QuoteFn,
} from './valuation.ts';
import { looksLikeSpam, normaliseAsset } from './tokenRegistry.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
let passed = 0;
const check = (cond: unknown, msg: string) => {
  assert(cond, msg);
  passed++;
};

const NOW = Date.parse('2026-10-06T00:00:00Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const BTC = NETWORK_CHAIN_INFO.bitcoin.nativeAsset;
const ETH = NETWORK_CHAIN_INFO.ethereum.nativeAsset;
const SOL = NETWORK_CHAIN_INFO.solana.nativeAsset;
const USDC: ChainAsset = { kind: 'token', symbol: 'USDC', name: 'USD Coin', decimals: 6, contract: '0xA0b8…' };
const bal = (asset: ChainAsset, amountRaw: string): ChainBalance => ({ asset, amountRaw });

function quoteOf(price: number | null, asOf: string | null, status: QuoteResult['status'] = 'ok'): QuoteResult {
  return { assetKey: 'x', currency: 'NZD', price, status, source: 'coingecko', asOf, message: status === 'ok' ? 'cached NZD' : 'CoinGecko rate limit' };
}

const calls: string[] = [];
const quotes: Record<string, QuoteResult | 'throw'> = {
  BTC: quoteOf(100_000, iso(60_000)), // 1 min old → fresh
  ETH: quoteOf(5_000, iso(2 * 60 * 60 * 1000)), // 2 h old → stale but used
  SOL: quoteOf(null, null, 'unavailable'),
  USDC: quoteOf(1.6, iso(0)), // must never be asked for
};
const quote: QuoteFn = async (t) => {
  calls.push(t);
  const q = quotes[t];
  if (!q || q === 'throw') throw new Error('boom');
  return q;
};

// --- KAN-39: token normalisation ----------------------------------------------------
{
  const REAL_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  const STETH = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84';
  const tok = (contract: string, symbol: string, name: string, decimals = 18): ChainAsset => ({ kind: 'token', symbol, name, decimals, contract });
  calls.length = 0;
  const v = await valueBalancesNzd(
    [
      bal(ETH, '1000000000000000000'),
      bal(tok(REAL_USDC.toLowerCase(), 'usdc', 'whatever', 6), '250000000'),
      bal(tok(WETH, 'WETH', 'Wrapped Ether'), '500000000000000000'),
      bal(tok(STETH, 'stETH', 'Liquid staked Ether 2.0'), '1000000000000000000'),
      bal(tok('0x1111111111111111111111111111111111111111', 'USDC', 'USD Coin'), '999000000000'),
      bal(tok('0x2222222222222222222222222222222222222222', 'Visit usdc-claim.com', 'Claim reward'), '1'),
      bal(tok('0x3333333333333333333333333333333333333333', 'ΕTH', 'Ether'), '1'),
    ],
    quote,
    NOW,
    'ethereum',
  );
  const by = (c: string) => v.items.find((i) => i.asset.contract?.toLowerCase() === c.toLowerCase())!;
  check(by(REAL_USDC).tokenClass === 'known' && by(REAL_USDC).asset.symbol === 'USDC' && by(REAL_USDC).asset.name === 'USD Coin', 'known contract → canonical symbol and name');
  check(by(REAL_USDC).valueNzd === 400, 'known USDC priced through the USDC ticker (250 × 1.6)');
  check(by(WETH).valueNzd === 2_500, 'WETH priced as ETH (0.5 × 5,000)');
  check(by(STETH).tokenClass === 'known' && by(STETH).status === 'unpriced' && !by(STETH).hidden, 'stETH known but not guessed from ETH');
  const fake = by('0x1111111111111111111111111111111111111111');
  check(fake.tokenClass === 'unknown' && fake.hidden && fake.valueNzd === null, 'a token calling itself USDC at another contract is unknown, hidden, unpriced');
  check(by('0x2222222222222222222222222222222222222222').tokenClass === 'spam', 'advert token is spam');
  check(by('0x3333333333333333333333333333333333333333').tokenClass === 'spam', 'lookalike letters are spam');
  check(v.totalNzd === 5_000 + 400 + 2_500, 'total: ETH + USDC + WETH only');
  check(v.hiddenCount === 3 && !v.complete, 'three hidden; stETH unpriced keeps it incomplete');
  check(calls.sort().join() === 'ETH,USDC', `quotes only by explicit ticker (${calls.join()})`);
  const shown = withoutHidden({ ok: true, fetchedAt: iso(0), ...v }, false);
  check(shown.ok && shown.items.length === 4 && shown.items.every((i) => !i.hidden), 'hidden left out by default');
  const all = withoutHidden({ ok: true, fetchedAt: iso(0), ...v }, true);
  check(all.ok && all.items.length === 7, 'showHidden returns them');
}
{
  const sol = await valueBalancesNzd([bal({ kind: 'token', symbol: 'So11…1112', name: 'SPL', decimals: 9, contract: 'So11111111111111111111111111111111111111112' }, '2000000000')], quote, NOW, 'solana');
  check(sol.items[0].asset.symbol === 'WSOL' && sol.items[0].tokenClass === 'known', 'SPL mint → WSOL');
  check(sol.items[0].status === 'unpriced' && !sol.items[0].hidden, 'priced as SOL when SOL has a price (none in this test)');
}
check(looksLikeSpam({ symbol: 'UNI', name: 'Uniswap' }) === false, 'real names are not spam');
check(looksLikeSpam({ symbol: '$500 REWARD', name: 'x' }), 'reward is spam');
check(normaliseAsset('polygon', { kind: 'token', symbol: 'x', name: 'x', decimals: 6, contract: null }).tokenClass === 'unknown', 'no contract → unknown');

// --- single wallet valuation --------------------------------------------------------
{
  const v = await valueBalancesNzd([bal(BTC, '125000000')], quote, NOW);
  check(v.items[0].status === 'priced' && v.items[0].amount === '1.25', 'BTC priced');
  check(v.items[0].valueNzd === 125_000 && v.totalNzd === 125_000, 'value = amount × NZD price');
  check(v.complete && !v.hasStalePrices, 'complete, not stale');
  check(v.pricedAt === iso(60_000) && v.items[0].pricedAt === iso(60_000), 'last-priced time returned');
}
{
  calls.length = 0;
  const v = await valueBalancesNzd(
    [bal(ETH, '1500000000000000000'), bal(ETH, '500000000000000000'), bal(USDC, '250000000')],
    quote,
    NOW,
  );
  check(calls.join() === 'ETH', `one quote per symbol; tokens never quoted (${calls.join()})`);
  check(v.items[0].status === 'stale' && v.items[0].valueNzd === 7_500, 'stale price still counted');
  check(v.hasStalePrices && v.items[0].message === 'cached NZD', 'stale flagged with message');
  check(v.items[2].status === 'unpriced' && v.items[2].valueNzd === null, 'token unpriced');
  // KAN-39: without a network the token can't be matched, so it's unknown: hidden, never counted,
  // and it doesn't make the total incomplete.
  check(v.items[2].tokenClass === 'unknown' && v.items[2].hidden && v.hiddenCount === 1, 'unmatched token is unknown and hidden');
  check(v.totalNzd === 10_000 && v.complete, 'total excludes the hidden token');
}
{
  const v = await valueBalancesNzd([bal(BTC, '100000000'), bal(SOL, '2000000000')], quote, NOW);
  check(v.items[1].status === 'unpriced' && v.items[1].message === 'CoinGecko rate limit', 'unavailable quote → unpriced with reason');
  check(v.totalNzd === 100_000 && !v.complete && Number.isFinite(v.totalNzd), 'unavailable price never corrupts total');
}
{
  quotes.SOL = 'throw';
  const v = await valueBalancesNzd([bal(SOL, '1')], quote, NOW);
  check(v.items[0].status === 'unpriced' && v.totalNzd === 0 && !v.complete, 'quote exception → unpriced');
  for (const bad of [Number.NaN, -5, 0, Infinity]) {
    quotes.SOL = quoteOf(bad, iso(0));
    const w = await valueBalancesNzd([bal(SOL, '1000000000')], quote, NOW);
    check(w.items[0].status === 'unpriced' && w.totalNzd === 0, `bad price ${bad} rejected`);
  }
}
{
  const v = await valueBalancesNzd([bal(BTC, '1'), bal(USDC, '0')], quote, NOW);
  check(v.complete, 'zero-balance unpriced token does not make the total incomplete');
  check(v.items[0].valueNzd === 0 && v.items[0].amount === '0.00000001', '1 sat rounds to 0 cents');
}
{
  quotes.BTC = quoteOf(100_000, iso(STALE_AFTER_MS + 1));
  const v = await valueBalancesNzd([bal(BTC, '100000000'), bal(ETH, '1000000000000000000')], quote, NOW);
  check(v.items[0].status === 'stale', 'stale threshold');
  check(v.pricedAt === iso(2 * 60 * 60 * 1000), 'total pricedAt = oldest price used');
  quotes.BTC = quoteOf(100_000, null);
  check((await valueBalancesNzd([bal(BTC, '1')], quote, NOW)).items[0].status === 'stale', 'missing asOf treated as stale');
  quotes.BTC = quoteOf(100_000, iso(60_000));
  check((await valueBalancesNzd([], quote, NOW)).complete, 'empty wallet is complete with total 0');
}

// --- wallets through the registry ------------------------------------------------------
resetChainProvidersForTest();
clearWalletBalanceCache();
let fetches = 0;
registerChainProvider({
  id: 'fake',
  label: 'Fake',
  supports: (n) => n === 'bitcoin' || n === 'ethereum',
  async getBalances(ctx) {
    fetches++;
    if (ctx.network === 'ethereum') throw new ChainProviderError('rate_limited', 'ethereum', 'Ethereum provider rate limit reached', 30);
    return [bal(BTC, '50000000')];
  },
  async getTransactions() {
    return { transactions: [], nextCursor: null };
  },
});
try {
  const btcWallet = await valueWallet({ network: 'bitcoin', address: 'a' }, quote);
  check(btcWallet.ok && btcWallet.totalNzd === 50_000, 'wallet valued via registry');
  await valueWallet({ network: 'bitcoin', address: 'a' }, quote);
  check(fetches === 1, 'balances cached briefly between valuations');

  const ethWallet = await valueWallet({ network: 'ethereum', address: 'b' }, quote);
  check(!ethWallet.ok && ethWallet.code === 'rate_limited' && ethWallet.retryAfterSec === 30, 'chain failure returned, not thrown');
  const solWallet = await valueWallet({ network: 'solana', address: 'c' }, quote);
  check(!solWallet.ok && solWallet.code === 'unsupported_network', 'unsupported network returned');

  const all = combineValuations([btcWallet, ethWallet, solWallet]);
  check(all.totalNzd === 50_000, 'failed wallets excluded from total');
  check(!all.complete && all.failedWallets === 2, 'portfolio marked incomplete with failure count');
  check(all.pricedAt === iso(60_000), 'portfolio pricedAt');
  blockNetwork('bitcoin', 60_000);
  const fetchesBefore = fetches;
  const blockedVal = await valueWallet({ network: 'bitcoin', address: 'uncached' }, quote);
  check(!blockedVal.ok && blockedVal.code === 'rate_limited' && fetches === fetchesBefore, 'rate-limited network not fetched on page load');
  const cachedVal = await valueWallet({ network: 'bitcoin', address: 'a' }, quote);
  check(cachedVal.ok, 'cached balances still valued during a rate-limit window');
  resetRateLimitsForTest();
  const none = combineValuations([]);
  check(none.totalNzd === 0 && none.complete && none.pricedAt === null, 'no wallets → 0, complete');
} finally {
  resetChainProvidersForTest();
}

console.log(`valuation: ${passed} checks passed`);
