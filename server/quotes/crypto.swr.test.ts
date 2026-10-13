/**
 * Crypto prices on page loads: an older good price comes back at once while one
 * shared refresh runs. Run: npm run test:net-worth-crypto
 *
 * Uses a throwaway sqlite file and a stubbed fetch, so no network.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `pt-crypto-swr-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

let calls = 0;
let gate: Promise<void> | null = null;
globalThis.fetch = (async (input: string | URL | Request) => {
  calls += 1;
  if (gate) await gate;
  const url = String(input);
  if (url.includes('api.coingecko.com/api/v3/simple/price')) {
    return new Response(JSON.stringify({ bitcoin: { usd: 60000, nzd: 100000 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { status: 404 });
}) as typeof fetch;

const { getDb } = await import('../db/index.ts');
await getDb();
const { ageCryptoPriceCacheForTest, clearCryptoQuoteCache, getCryptoQuoteNzd, settleCryptoRefreshes } = await import('./crypto.ts');

let release: (() => void) | null = null;
try {
  clearCryptoQuoteCache();
  const first = await getCryptoQuoteNzd('BTC');
  assert(first.price === 100000, `first price from CoinGecko (got ${first.price} ${first.message})`);
  const afterFirst = calls;
  await getCryptoQuoteNzd('BTC');
  assert(calls === afterFirst, 'a fresh price is reused');

  // Older than the 10-minute TTL: returned at once while the refresh hangs.
  ageCryptoPriceCacheForTest(11 * 60 * 1000);
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = Date.now();
  const stale = await getCryptoQuoteNzd('BTC');
  assert(Date.now() - started < 200, 'did not wait for CoinGecko');
  assert(stale.price === 100000, 'the last good price is returned');
  assert(calls === afterFirst + 1, 'one background refresh started');
  await getCryptoQuoteNzd('BTC');
  assert(calls === afterFirst + 1, 'a second read shares the running refresh');
  release?.();
  await settleCryptoRefreshes();
  console.log('crypto quote refresh tests ok');
} finally {
  release?.();
  for (const suffix of ['', '.tmp', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
