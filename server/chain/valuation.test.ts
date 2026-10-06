/**
 * NZD valuation of chain balances: priced / stale / unpriced, token exclusion,
 * failed wallets excluded without corrupting totals. Quotes are injected — no network.
 * Run: npm run test:chain
 */
import type { QuoteResult } from '../../src/types/index.ts';
import { NETWORK_CHAIN_INFO } from './networks.ts';
import { registerChainProvider, resetChainProvidersForTest } from './registry.ts';
import { ChainProviderError, type ChainAsset, type ChainBalance } from './types.ts';
import {
  STALE_AFTER_MS,
  clearWalletBalanceCache,
  combineValuations,
  valueBalancesNzd,
  valueWallet,
  type QuoteFn,
} from './valuation.ts';

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
  check(v.totalNzd === 10_000 && !v.complete, 'total excludes token and is marked incomplete');
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
  const none = combineValuations([]);
  check(none.totalNzd === 0 && none.complete && none.pricedAt === null, 'no wallets → 0, complete');
} finally {
  resetChainProvidersForTest();
}

console.log(`valuation: ${passed} checks passed`);
