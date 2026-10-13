/**
 * Quotes on read requests: page loads use stored quotes and never wait on a refresh.
 * Run: npm run test:net-worth-crypto
 *
 * Uses a throwaway sqlite file and a stubbed fetch that never answers, so no network.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `pt-readquotes-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
delete process.env.METALS_API_KEY;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// Every outside request hangs until the test releases it.
let fetchCalls = 0;
let release: (() => void) | null = null;
const hanging = new Promise<void>((resolve) => {
  release = resolve;
});
globalThis.fetch = (async () => {
  fetchCalls += 1;
  await hanging;
  throw new Error('offline (test)');
}) as typeof fetch;

const { getDb, run } = await import('../db/index.ts');
const { quotesForRead, settleQuoteRefreshes } = await import('./readQuotes.ts');
const { METAL_KINDS, metalAssetKey } = await import('./metals.ts');
const { forexAssetKey } = await import('./forexQuotesDb.ts');

const db = await getDb();
const now = new Date().toISOString();
const old = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const quote = (key: string, asOf: string) =>
  run(db, `INSERT INTO price_quotes (id, asset_key, currency, price, status, source, as_of) VALUES (?,?,?,?,?,?,?)`, [
    `q_${key}`, key, 'NZD', 2, 'ok', 'test', asOf,
  ]);
const holding = (id: string, user: string, cls: string, extra: Record<string, unknown>) => {
  const cols = ['id', 'user_id', 'asset_class', 'name', 'created_at', 'updated_at', ...Object.keys(extra)];
  run(db, `INSERT INTO holdings (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, [
    id, user, cls, id, now, now, ...Object.values(extra),
  ]);
};

async function within(ms: number, p: Promise<unknown>): Promise<boolean> {
  return Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
}

try {
  // No metals or forex: nothing is fetched.
  holding('h_stock', 'plain', 'stock', { symbol: 'AAPL', shares: 1 });
  assert(await within(200, quotesForRead(db, 'plain')), 'a user with no metals or forex does not wait');
  assert(fetchCalls === 0, 'and nothing is fetched for them');

  // Stale stored quotes: the read returns at once while the refresh hangs in the background.
  for (const m of METAL_KINDS) quote(metalAssetKey(m), old);
  quote(forexAssetKey('USD'), old);
  holding('h_gold', 'mixed', 'metal', { metal: 'gold', amount: 1 });
  holding('h_usd', 'mixed', 'forex', { asset: 'USD', amount: 100 });
  assert(await within(200, quotesForRead(db, 'mixed')), 'stale quotes do not make the read wait');
  assert(fetchCalls > 0, 'a background refresh started');
  const callsAfterFirst = fetchCalls;
  assert(await within(200, quotesForRead(db, 'mixed')), 'a second read while refreshing does not wait either');
  assert(fetchCalls === callsAfterFirst, 'and shares the refresh already running');

  release?.();
  await settleQuoteRefreshes();
  console.log('read quotes tests ok');
} finally {
  release?.();
  for (const suffix of ['', '.tmp', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
