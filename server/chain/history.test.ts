/**
 * Wallet transaction history (KAN-43): stored by the sync job, classified (received / sent /
 * transfer / staking / swap), deduped on re-sync, pending → confirmed, spam hidden, isolated per
 * user, refreshed only every few hours, and served by the API.
 * Run: npm run test:chain
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
let passed = 0;
const check = (cond: unknown, msg: string) => {
  assert(cond, msg);
  passed++;
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-whist-'));
process.env.DATABASE_PATH = path.join(dir, 'portfolio.db');
process.env.NODE_ENV = 'test';

const { getDb, queryAll, run } = await import('../db/index.ts');
const { importWalletHistory, historyDue, listWalletTxns, HISTORY_EVERY_MS } = await import('./history.ts');
const { NETWORK_CHAIN_INFO } = await import('./networks.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser } = await import('../middleware/requireAuth.ts');
const { default: walletsRouter } = await import('../routes/wallets.ts');
const { deleteScopedDataForUser } = await import('../lib/userScope.ts');

const db = await getDb();
const now = new Date().toISOString();
for (const [id, email] of [['ua', 'a@example.com'], ['ub', 'b@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)`, [id, email, 'h', now, now]);
}
const ME = '0x52908400098527886E0F7030069857D2E4169EE7';
const MINE2 = '0x8617E340B3D01FA5F11F306F4090FD50E238070D';
const POOL = '0x1111111111111111111111111111111111111111';
const SHOP = '0x2222222222222222222222222222222222222222';
for (const [id, user, addr] of [['w1', 'ua', ME], ['w2', 'ua', MINE2], ['wb', 'ub', ME]]) {
  run(db, `INSERT INTO wallets (id, user_id, name, network, address, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, [id, user, id, 'ethereum', addr, now, now]);
}
const ETH = NETWORK_CHAIN_INFO.ethereum.nativeAsset;
const USDC = { kind: 'token' as const, symbol: 'USDC', name: 'USD Coin', decimals: 6, contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' };
const SPAM = { kind: 'token' as const, symbol: 'Visit claim-usdc.com', name: 'Claim', decimals: 0, contract: '0x3333333333333333333333333333333333333333' };
const tx = (hash: string, day: number, direction: 'in' | 'out' | 'self', asset: typeof ETH, amountRaw: string, counterparty: string | null, status: 'confirmed' | 'pending' = 'confirmed') => ({
  hash, timestamp: `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`, status, direction, asset, amountRaw, feeRaw: direction === 'out' ? '21000' : null, counterparty,
});

let native = [
  tx('0xa', 1, 'in', ETH, '1000000000000000000', SHOP),
  tx('0xb', 2, 'out', ETH, '500000000000000000', MINE2),
  tx('0xc', 3, 'in', ETH, '1000', POOL),
  tx('0xd', 4, 'in', ETH, '1000', POOL),
  tx('0xe', 5, 'in', ETH, '1000', POOL),
  tx('0xf', 6, 'out', ETH, '2000', SHOP, 'pending'),
];
let tokens = [tx('0xa', 1, 'in', USDC, '25000000', SHOP), tx('0x9', 7, 'in', SPAM, '1', SHOP)];
const source = { native: async () => ({ transactions: native }), tokens: async () => tokens };

const r1 = await importWalletHistory(db, { id: 'w1', userId: 'ua', network: 'ethereum', address: ME }, source);
check(r1.added === 8, `8 rows stored (${r1.added})`);
const rows = listWalletTxns(db, 'ua', { showHidden: true });
const by = (h: string, sym = 'ETH') => rows.find((r) => r.hash === h && r.symbol === sym)!;
check(by('0xa').kind === 'received' && by('0xa').amount === '1', 'received 1 ETH');
check(by('0xa', 'USDC').kind === 'received' && by('0xa', 'USDC').amount === '25', 'same tx, USDC leg kept apart');
check(by('0xb').kind === 'transfer', 'sent to your own other wallet → transfer');
check(['0xc', '0xd', '0xe'].every((h) => by(h).kind === 'staking'), 'repeated payments from one sender → staking');
check(by('0xf').kind === 'sent' && by('0xf').status === 'pending', 'sent, pending');
check(by('0x9', 'Visit claim-usdc.com').hidden, 'spam token stored hidden');
check(listWalletTxns(db, 'ua').length === 7, 'spam left out by default');
check(listWalletTxns(db, 'ua')[0].hash === '0xf', 'newest first');

// Re-sync: nothing duplicated; the pending one confirms.
native = native.map((t) => (t.hash === '0xf' ? { ...t, status: 'confirmed' as const } : t));
const r2 = await importWalletHistory(db, { id: 'w1', userId: 'ua', network: 'ethereum', address: ME }, source);
check(r2.added === 0 && r2.updated === 1, 'dedupe on re-sync, pending → confirmed');
check(queryAll(db, `SELECT id FROM wallet_txns WHERE wallet_id = 'w1'`).length === 8, 'still 8 rows');
check(listWalletTxns(db, 'ua').find((r) => r.hash === '0xf')?.status === 'confirmed', 'now confirmed');

// Refresh only every few hours.
check(!historyDue(db, 'w1'), 'not due right after');
check(historyDue(db, 'w1', Date.now() + HISTORY_EVERY_MS + 1), 'due later');
check(historyDue(db, 'w2'), 'never fetched → due');

// Isolation and filters.
tokens = [];
await importWalletHistory(db, { id: 'wb', userId: 'ub', network: 'ethereum', address: ME }, source);
check(listWalletTxns(db, 'ua').every((r) => r.walletId !== 'wb'), "B's rows never in A's list");
check(listWalletTxns(db, 'ua', { from: '2026-10-03', to: '2026-10-05' }).length === 3, 'date filter');

// HTTP.
const app = express();
app.use('/api', attachUser);
app.use('/api/wallets', walletsRouter);
const server: Server = await new Promise((r) => {
  const s = app.listen(0, '127.0.0.1', () => r(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  const ca = `${SESSION_COOKIE}=${(await createSession('ua')).rawToken}`;
  const cb = `${SESSION_COOKIE}=${(await createSession('ub')).rawToken}`;
  const all = await fetch(`${base}/api/wallets/transactions`, { headers: { Cookie: ca } });
  check(all.status === 200 && ((await all.json()) as unknown[]).length === 7, 'GET /transactions');
  const hidden = await fetch(`${base}/api/wallets/transactions?showHidden=1`, { headers: { Cookie: ca } });
  check(((await hidden.json()) as unknown[]).length === 8, 'showHidden=1 includes spam');
  check((await fetch(`${base}/api/wallets/w1/transactions`, { headers: { Cookie: cb } })).status === 404, "B can't read A's wallet");
  check((await fetch(`${base}/api/wallets/transactions`)).status === 401, 'signed out');
  // Deleting the wallet removes its history.
  check((await fetch(`${base}/api/wallets/w1`, { method: 'DELETE', headers: { Cookie: ca } })).status === 200, 'wallet deleted');
  check(queryAll(db, `SELECT id FROM wallet_txns WHERE wallet_id = 'w1'`).length === 0, 'its history went with it');
  deleteScopedDataForUser(db, 'ub');
  check(queryAll(db, `SELECT id FROM wallet_txns WHERE user_id = 'ub'`).length === 0, 'account deletion clears history');
  console.log(`history: ${passed} checks passed`);
} finally {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
