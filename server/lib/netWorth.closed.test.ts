/**
 * Net worth: closed (0-quantity) stock / crypto positions and Akahu "total" quotes.
 * Run: npm run test:net-worth-crypto
 *
 * Uses a throwaway sqlite file and a fake wallet valuer — no chain or quote calls.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(os.tmpdir(), `pt-networth-closed-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function eq(actual: number | null | undefined, expected: number, msg: string): void {
  if (actual == null || Math.abs(actual - expected) > 1e-6) {
    throw new Error(`FAIL: ${msg} (got ${actual}, expected ${expected})`);
  }
}

const { getDb, run } = await import('../db/index.ts');
const { computeNetWorth } = await import('./netWorth.ts');
const { METAL_KINDS, metalAssetKey } = await import('../quotes/metals.ts');

const now = new Date().toISOString();
const db = await getDb();
const user = 'closed_user';
const quote = (key: string, price: number, notes: string | null = null) =>
  run(
    db,
    `INSERT INTO price_quotes (id, asset_key, currency, price, status, source, as_of, notes) VALUES (?,?,?,?,?,?,?,?)`,
    [`q_${key}`, key, 'NZD', price, 'ok', 'test', now, notes],
  );
for (const metal of METAL_KINDS) quote(metalAssetKey(metal), 1);

quote('STOCK:QYLD', 33);
// What an older sync left behind for a sold position: a total, not a unit price.
quote('STOCK:TSLA', 1.37, 'Akahu total NZD 0.77 USD → 1.37 NZD @ 1.78 (quantity unknown; price holds total NZD)');
quote('CRYPTO:BTC', 0.11, 'Akahu total NZD 0.06 USD → 0.11 NZD @ 1.78 (quantity unknown; price holds total NZD)');

const holding = (id: string, cls: 'stock' | 'crypto', sym: string, qty: number, cost: number, notes: string | null) =>
  run(
    db,
    `INSERT INTO holdings (id, user_id, asset_class, name, symbol, shares, asset, amount, cost_basis_nzd, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, user, cls, sym, cls === 'stock' ? sym : null, cls === 'stock' ? qty : null, cls === 'crypto' ? sym : null,
      cls === 'crypto' ? qty : null, cost, notes, now, now],
  );
holding('qyld', 'stock', 'QYLD', 0.64, 135.1, null);
holding('tsla', 'stock', 'TSLA', 0, 914.45, 'Akahu market value: 0.77 USD → 1.37 NZD @ 1.78 (frankfurter)');
holding('btc_sold', 'crypto', 'BTC', 0, 23.12, 'Akahu market value: 0.06 USD → 0.11 NZD @ 1.78 (frankfurter)');
holding('xrp_sold', 'crypto', 'XRP', 0, 36.72, null);
holding('btc_manual', 'crypto', 'BTC', 0.001, 3.18, null);
// A manual stock saved with a cost and no share count: quantity unknown, not sold.
run(db, `INSERT INTO holdings (id, user_id, asset_class, name, symbol, cost_basis_nzd, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
  ['unknown_qty', user, 'stock', 'Manual', 'MANL', 250, now, now]);

const nw = await computeNetWorth(db, user, async () => ({ ok: true, totalNzd: 0, items: [], complete: true }) as never);

// QYLD 0.64 × 33 = 21.12, plus Tesla's own 1.37 — not Tesla's 914.45 cost — plus the unknown-quantity stock at its 250 cost.
eq(nw.stocksNzd, 21.12 + 1.37 + 250, 'closed stock adds what Akahu reports, never its cost; no share count keeps cost');
// Sold BTC 0.11 + sold XRP 0 + manual BTC: the "total" quote is not a unit price, so it falls back to cost 3.18.
eq(nw.cryptoNzd, 0.11 + 3.18, 'closed crypto adds no cost; a total quote is never multiplied by a quantity');

console.log('net worth closed-position tests ok');
