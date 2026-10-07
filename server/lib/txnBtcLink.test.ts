/**
 * "Pays with BTC": spend converts NZD → BTC at the live quote and comes out of the
 * chosen BTC holding — only ever the signed-in user's holdings.
 * Run: npm run test:cash-sync
 *
 * Uses a throwaway sqlite file and a stubbed BTC quote (no network).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-btclink-'));
process.env.DATABASE_PATH = path.join(tmp, 'portfolio.db');

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
let passed = 0;
const check = (cond: unknown, msg: string) => {
  assert(cond, msg);
  passed++;
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-12;

// BTC = NZ$100,000 (CoinGecko shape); any other request fails.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('coingecko')) {
    return new Response(JSON.stringify({ bitcoin: { usd: 60_000, nzd: 100_000 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response('{}', { status: 503 });
}) as typeof fetch;

const { getDb, queryOne, run } = await import('../db/index.ts');
const { applyBtcLink, reverseBtcDelta, restoreStoredBtcDelta } = await import('./txnBtcLink.ts');

const db = await getDb();
const now = new Date().toISOString();
function btc(id: string, userId: string, amount: number) {
  run(db, `INSERT INTO holdings (id, user_id, asset_class, name, asset, amount, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`, [
    id,
    userId,
    'crypto',
    `${userId} BTC`,
    'BTC',
    amount,
    now,
    now,
  ]);
}
const amount = (id: string) => Number(queryOne<{ amount: number }>(db, 'SELECT amount FROM holdings WHERE id = ?', [id])?.amount);

btc('h_a', 'user_a', 1);
btc('h_b', 'user_b', 2);

try {
  // NZ$65 spend at NZ$100,000/BTC takes 0.00065 BTC out of A's holding.
  const spend = await applyBtcLink(db, { userId: 'user_a', affectsBtc: true, amountNzd: -65, kind: 'debit', btcHoldingId: 'h_a' });
  check(spend.ok && near(spend.meta.btcDeltaApplied!, -0.00065), 'debit → −0.00065 BTC');
  check(near(amount('h_a'), 0.99935), 'A holding reduced');

  // Credit adds BTC back.
  const credit = await applyBtcLink(db, { userId: 'user_a', affectsBtc: true, amountNzd: 65, kind: 'credit', btcHoldingId: 'h_a' });
  check(credit.ok && near(amount('h_a'), 1), 'credit → +0.00065 BTC');

  // Off by default: nothing moves.
  const off = await applyBtcLink(db, { userId: 'user_a', affectsBtc: false, amountNzd: -65, kind: 'debit', btcHoldingId: 'h_a' });
  check(off.ok && !off.meta.affectsBtc && near(amount('h_a'), 1), 'toggle off → holding untouched');

  // Another user's holding can't be named or picked.
  const cross = await applyBtcLink(db, { userId: 'user_a', affectsBtc: true, amountNzd: -65, kind: 'debit', btcHoldingId: 'h_b' });
  check(!cross.ok && near(amount('h_b'), 2), 'other user’s holding id refused, untouched');
  const auto = await applyBtcLink(db, { userId: 'user_a', affectsBtc: true, amountNzd: -65, kind: 'debit', btcHoldingId: null });
  check(auto.ok && auto.meta.btcHoldingId === 'h_a' && near(amount('h_b'), 2), 'no id → own primary holding only');
  const none = await applyBtcLink(db, { userId: 'user_c', affectsBtc: true, amountNzd: -65, kind: 'debit', btcHoldingId: null });
  check(!none.ok, 'user without BTC holdings can’t move anyone else’s');

  // Undo / redo are scoped too.
  const bMeta = { affectsBtc: true, btcHoldingId: 'h_b', btcDeltaApplied: -0.5, btcNzdRate: 100_000, btcAppliedAt: now };
  reverseBtcDelta(db, bMeta, 'user_a');
  restoreStoredBtcDelta(db, bMeta, 'user_a');
  check(near(amount('h_b'), 2), 'reverse/restore ignore another user’s holding');
  reverseBtcDelta(db, { ...bMeta, btcHoldingId: 'h_a', btcDeltaApplied: auto.meta.btcDeltaApplied }, 'user_a');
  check(near(amount('h_a'), 1), 'reverse own delta restores the holding');
} finally {
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`txnBtcLink: ${passed} checks passed`);
