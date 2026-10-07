/**
 * Net worth: read-only crypto wallets in totals, allocation and "% of net worth" (KAN-42).
 * Run: npm run test:net-worth-crypto
 *
 * Uses a throwaway sqlite file and a fake wallet valuer — no chain or quote calls.
 * Does not read or write data/portfolio.db.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `pt-networth-crypto-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function eq(actual: number | null | undefined, expected: number | null, msg: string): void {
  const ok =
    expected == null ? actual == null : actual != null && Math.abs(actual - expected) < 1e-6;
  if (!ok) throw new Error(`FAIL: ${msg} (got ${actual}, expected ${expected})`);
}

const { getDb, run } = await import('../db/index.ts');
const { computeNetWorth } = await import('./netWorth.ts');
const { valueBalancesNzd } = await import('../chain/valuation.ts');
const { METAL_KINDS, metalAssetKey } = await import('../quotes/metals.ts');
type WalletValuer = import('./netWorth.ts').WalletValuer;
type WalletValuation = import('../chain/valuation.ts').WalletValuation;

const now = new Date().toISOString();
const db = await getDb();
let passed = 0;

// Metal spot rows so computeNetWorth never reaches for a live metals quote.
for (const metal of METAL_KINDS) {
  run(
    db,
    `INSERT INTO price_quotes (id, asset_key, currency, price, status, source, as_of) VALUES (?,?,?,?,?,?,?)`,
    [`quote_${metal}`, metalAssetKey(metal), 'NZD', 1, 'ok', 'test', now],
  );
}
run(
  db,
  `INSERT INTO price_quotes (id, asset_key, currency, price, status, source, as_of) VALUES (?,?,?,?,?,?,?)`,
  ['quote_btc', 'CRYPTO:BTC', 'NZD', 100_000, 'ok', 'test', now],
);

function cash(userId: string, balance: number) {
  run(
    db,
    `INSERT INTO bank_accounts (id, user_id, name, account_type, currency, balance, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [`acct_${userId}_${balance}`, userId, 'Everyday', 'cheque', 'NZD', balance, now, now],
  );
}
function manualBtc(userId: string, amount: number) {
  run(
    db,
    `INSERT INTO holdings (id, user_id, asset_class, name, asset, amount, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [`hold_${userId}`, userId, 'crypto', 'Nexo BTC', 'BTC', amount, now, now],
  );
}
function wallet(userId: string, id: string, network: string, address: string) {
  run(
    db,
    `INSERT INTO wallets (id, user_id, name, network, address, status, created_at, updated_at)
     VALUES (?,?,?,?,?,'connected',?,?)`,
    [id, userId, `${id} wallet`, network, address, now, now],
  );
}
function debt(userId: string, amount: number) {
  run(
    db,
    `INSERT INTO debt_people (id, user_id, name, kind, outstanding_nzd, created_at, updated_at, interest_charged_nzd)
     VALUES (?,?,?,?,?,?,?,?)`,
    [`debt_${userId}`, userId, 'Loan', 'person', amount, now, now, 0],
  );
}

// Fake chain: BTC wallet holds 0.05 BTC; ETH wallet holds 1 ETH plus a spam token
// claiming a huge balance; one wallet's provider is down.
const fakeQuote = async (ticker: string) => ({
  assetKey: `CRYPTO:${ticker}`,
  currency: 'NZD' as const,
  price: ticker === 'BTC' ? 100_000 : ticker === 'ETH' ? 5_000 : null,
  status: 'ok' as const,
  source: 'test' as never,
  asOf: now,
});
const native = (symbol: string, decimals: number) => ({ kind: 'native' as const, symbol, name: symbol, decimals, contract: null });
const BALANCES: Record<string, Parameters<typeof valueBalancesNzd>[0]> = {
  addr_btc: [{ asset: native('BTC', 8), amountRaw: '5000000' }],
  addr_eth: [
    { asset: native('ETH', 18), amountRaw: '1000000000000000000' },
    {
      asset: { kind: 'token', symbol: 'FREEUSDT', name: 'Claim rewards at spam.example', decimals: 6, contract: '0xspam' },
      amountRaw: '999999999000000',
    },
  ],
};
const seen: string[] = [];
const valuer: WalletValuer = async (w) => {
  seen.push(w.address);
  const balances = BALANCES[w.address];
  if (!balances) {
    return { ok: false, error: 'Provider down', code: 'upstream_error', retryAfterSec: null } satisfies WalletValuation;
  }
  return { ok: true, fetchedAt: now, ...(await valueBalancesNzd(balances, fakeQuote)) };
};

// --- User A: cash 10k + manual 0.1 BTC (10k) + BTC wallet (5k) + ETH wallet (5k + spam) ---
cash('nw_a', 10_000);
manualBtc('nw_a', 0.1);
wallet('nw_a', 'w_a_btc', 'bitcoin', 'addr_btc');
wallet('nw_a', 'w_a_eth', 'ethereum', 'addr_eth');
// --- User B: someone else's wallet must never reach A's totals ---
wallet('nw_b', 'w_b', 'bitcoin', 'addr_btc');

const a = await computeNetWorth(db, 'nw_a', valuer);
eq(a.cryptoHoldingsNzd, 10_000, 'manual crypto holding at market');
eq(a.cryptoWalletsNzd, 10_000, 'wallets: 0.05 BTC + 1 ETH; spam token adds nothing');
eq(a.cryptoNzd, 20_000, 'crypto = manual + wallets');
eq(a.assetsKnownNzd, 30_000, 'wallets count toward total assets');
eq(a.totalKnownNzd, 30_000, 'wallets count toward net worth');
eq(a.breakdown.byClass.crypto, 20_000, 'allocation crypto row includes wallets');
eq(a.cryptoPctOfNetWorth, 66.7, 'crypto is 66.7% of net worth');
assert(a.cryptoWalletsComplete === false, 'unpriced non-zero token marks wallets incomplete');
eq(a.cryptoWalletsFailed, 0, 'no failed wallets');
eq(a.counts.wallets, 2, 'counts A wallets only');
assert(
  a.breakdown.holdings.some((h) => h.id === 'wallet:w_a_btc' && h.assetClass === 'crypto' && h.valueNzd === 5_000),
  'wallet appears as a crypto line in the snapshot breakdown',
);
assert(!a.breakdown.holdings.some((h) => h.id === 'wallet:w_b'), 'user B wallet not in A breakdown');
assert(seen.filter((x) => x === 'addr_btc').length === 1, 'only A wallets valued for A');
passed += 13;

// A wallet that can't be valued is left out and flagged — never zeroes the rest.
wallet('nw_a', 'w_a_down', 'solana', 'addr_down');
const down = await computeNetWorth(db, 'nw_a', valuer);
eq(down.cryptoWalletsNzd, 10_000, 'failed wallet excluded from wallet total');
eq(down.cryptoWalletsFailed, 1, 'failed wallet counted');
assert(down.cryptoWalletsComplete === false, 'failed wallet marks total incomplete');
assert(!down.breakdown.holdings.some((h) => h.id === 'wallet:w_a_down'), 'failed wallet has no breakdown line');
passed += 4;

// Net worth ≤ 0: no percentage (a share of a negative number misleads).
debt('nw_a', 40_000);
const negative = await computeNetWorth(db, 'nw_a', valuer);
eq(negative.totalKnownNzd, -10_000, 'debt larger than assets');
eq(negative.cryptoPctOfNetWorth, null, 'no crypto % when net worth ≤ 0');
passed += 2;

// No crypto at all: no percentage, wallet total null (not 0).
cash('nw_c', 5_000);
const none = await computeNetWorth(db, 'nw_c', valuer);
eq(none.cryptoNzd, 0, 'no crypto');
eq(none.cryptoWalletsNzd, null, 'no wallets → null wallet total');
eq(none.cryptoPctOfNetWorth, null, 'no crypto % without crypto');
assert(none.cryptoWalletsComplete && none.cryptoWalletsFailed === 0, 'no wallets is complete');
passed += 4;

for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
console.log(`netWorth crypto: ${passed} passed`);
