/**
 * Advanced crypto (KAN-47): Pro gate, ledger validation, cost basis and gains with unrealised
 * values, staking income by tax year, wallet import (suggestions, swaps paired, fees, ignore,
 * never offered twice), historical prices (Yahoo × Frankfurter, never guessed), ERC-20 transfer
 * mapping, DeFi positions in net worth, isolation and account deletion.
 * Run: npm run test:crypto
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-crypto-'));
process.env.DATABASE_PATH = path.join(dataDir, 'portfolio.db');
process.env.AUTH_ENCRYPTION_KEY = 'c'.repeat(64);
process.env.PLAN_PRO_EMAILS = 'pia@example.com';
process.env.PLAN_PLUS_EMAILS = 'pat@example.com';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, run, queryAll } = await import('../db/index.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { computeNetWorth } = await import('../lib/netWorth.ts');
const { deleteScopedDataForUser } = await import('../lib/userScope.ts');
const { cryptoSummary, importPreview, importCommit } = await import('./store.ts');
const { historicalPriceNzd, clearPriceCacheForTest } = await import('./prices.ts');
const { mapTokenTransfer } = await import('../chain/evm.ts');
const { default: cryptoRouter } = await import('../routes/crypto.ts');

const now = '2026-10-05T00:00:00.000Z';
const db = await getDb();
for (const id of ['pia', 'pat', 'fred']) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, last_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, [id, `${id}@example.com`, 'h', id, 'Test', now, now]);
}
const ME = '0x1111111111111111111111111111111111111111';
const OTHER_OWN = '0x2222222222222222222222222222222222222222';
for (const [id, user, addr] of [['w_main', 'pia', ME], ['w_cold', 'pia', OTHER_OWN], ['w_fred', 'fred', ME]]) {
  run(db, `INSERT INTO wallets (id, user_id, name, network, address, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`, [id, user, id, 'ethereum', addr, now, now]);
}

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/crypto', cryptoRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/crypto`;
type Json = Record<string, any>;
async function call(method: string, p: string, cookie: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { Accept: 'application/json', Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
}
const prices: Record<string, number> = { ETH: 6000, SOL: 300, USDC: 1.65 };
const priceOf = async (a: string) => ({ price: prices[a] ?? null, status: prices[a] ? 'ok' : 'unavailable' });

try {
  const P = `${SESSION_COOKIE}=${(await createSession('pia')).rawToken}`;
  const PLUS = `${SESSION_COOKIE}=${(await createSession('pat')).rawToken}`;
  const F = `${SESSION_COOKIE}=${(await createSession('fred')).rawToken}`;

  // Pro only.
  for (const [c, who] of [[F, 'free'], [PLUS, 'Plus']] as const) {
    const r = await call('POST', '/txns', c, { date: '2025-05-01', kind: 'buy', asset: 'ETH', amount: 1, nzdValue: 3000 });
    assert(r.status === 402 && r.json.code === 'PRO_REQUIRED', `${who} users get PRO_REQUIRED`);
  }
  assert((await call('GET', '/summary', F)).status === 402, 'summary is Pro');
  assert((await call('GET', '/import/w_fred', F)).status === 402, 'import is Pro');

  // Validation.
  const bad = [
    [{ date: '2025-05-01', kind: 'buy', asset: 'ETH', amount: -1, nzdValue: 1 }, 'negative amount'],
    [{ date: '2025-05-01', kind: 'buy', asset: 'ETH', amount: 1, nzdValue: -5 }, 'negative value'],
    [{ date: '2031-01-01', kind: 'buy', asset: 'ETH', amount: 1, nzdValue: 1 }, 'future date'],
    [{ date: '2025-05-01', kind: 'yolo', asset: 'ETH', amount: 1 }, 'unknown kind'],
    [{ date: '2025-05-01', kind: 'swap', asset: 'ETH', amount: 1, nzdValue: 1 }, 'swap without what was received'],
    [{ date: '2025-05-01', kind: 'buy', asset: '', amount: 1 }, 'asset required'],
  ] as const;
  for (const [body, why] of bad) assert((await call('POST', '/txns', P, body)).status === 400, why);

  // Ledger: buys, a sale, staking, a buy with no value yet.
  const add = async (b: Json) => {
    const r = await call('POST', '/txns', P, b);
    assert(r.status === 201, `add ${JSON.stringify(b)} → ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };
  await add({ date: '2025-05-01', kind: 'buy', asset: 'eth', amount: 1, nzdValue: 3000, feeNzd: 10 });
  await add({ date: '2025-08-01', kind: 'buy', asset: 'ETH', amount: 1, nzdValue: 5000 });
  const sale = await add({ date: '2025-11-01', kind: 'sell', asset: 'ETH', amount: 1.5, nzdValue: 9000, feeNzd: 15 });
  await add({ date: '2025-06-01', kind: 'staking_reward', asset: 'SOL', amount: 2, nzdValue: 400 });
  const noValue = await add({ date: '2026-05-01', kind: 'buy', asset: 'USDC', amount: 100 });
  assert(noValue.needsValue === true, 'a buy without a value is flagged');

  let s = (await cryptoSummary(db, 'pia', 2025, priceOf));
  assert(s.ok, 'summary');
  if (!s.ok) throw new Error('unreachable');
  assert(s.value.costMethod === 'fifo' && s.value.year.realisedNzd === 3475 && s.value.year.incomeNzd === 400, `FIFO year ${JSON.stringify(s.value.year)}`);
  const eth = s.value.positions.find((p) => p.asset === 'ETH')!;
  assert(eth.quantity === 0.5 && eth.costNzd === 2500 && eth.valueNzd === 3000 && eth.unrealisedNzd === 500, `ETH unrealised ${JSON.stringify(eth)}`);
  assert(s.value.missingValue === 1, 'one missing value');
  const usdc = s.value.positions.find((p) => p.asset === 'USDC')!;
  assert(usdc.costIncomplete && usdc.unrealisedNzd === null && usdc.valueNzd === 165, 'no unrealised gain until the cost is known');
  assert(s.value.unrealisedNzd === 700, 'left out of the total (ETH +500, SOL +200)');

  // Weighted average.
  assert((await call('PUT', '/settings', P, { costMethod: 'nope' })).status === 400, 'method checked');
  assert((await call('PUT', '/settings', P, { costMethod: 'wac' })).status === 200, 'switch to weighted average');
  s = await cryptoSummary(db, 'pia', 2025, priceOf);
  if (!s.ok) throw new Error('summary');
  assert(s.value.costMethod === 'wac' && s.value.year.realisedNzd === 2977.5, `WAC realised ${s.value.year.realisedNzd}`);

  // Editing and deleting.
  const up = await call('PUT', `/txns/${sale.id}`, P, { date: '2025-11-01', kind: 'sell', asset: 'ETH', amount: 1, nzdValue: 6000 });
  assert(up.status === 200 && up.json.amount === 1, 'edit');
  assert((await call('PUT', `/txns/${sale.id}`, F, { date: '2025-11-01', kind: 'sell', asset: 'ETH', amount: 1, nzdValue: 1 })).status === 402, 'free can’t edit');
  assert((await call('DELETE', `/txns/${noValue.id}`, P)).status === 200, 'delete');

  // Historical prices: Yahoo daily close × Frankfurter, nearest earlier day; nothing guessed.
  clearPriceCacheForTest();
  const fake = async (url: string) => {
    if (url.includes('yahoo')) {
      if (url.includes('NOPE-USD')) return { ok: true, status: 200, json: async () => ({ chart: { result: null } }) };
      const d = (s: string) => Date.parse(`${s}T00:00:00Z`) / 1000;
      return { ok: true, status: 200, json: async () => ({ chart: { result: [{ timestamp: [d('2025-05-02'), d('2025-05-03'), d('2025-05-04')], indicators: { quote: [{ close: [1800, 1850, null] }] } }] } }) };
    }
    return { ok: true, status: 200, json: async () => ({ rates: { '2025-05-01': { NZD: 1.7 }, '2025-05-02': { NZD: 1.68 } } }) };
  };
  const p1 = await historicalPriceNzd('ETH', '2025-05-04', fake);
  assert(p1.ok && p1.priceNzd === 3108 && p1.priceDate === '2025-05-03', `Sunday: Saturday close × Friday FX ${JSON.stringify(p1)}`);
  const p2 = await historicalPriceNzd('WETH', '2025-05-03', fake);
  assert(p2.ok && p2.priceNzd === 3108, 'WETH priced as ETH');
  assert(!(await historicalPriceNzd('NOPE', '2025-05-03', fake)).ok, 'unknown coin: no price');

  // ERC-20 transfer mapping.
  const tok = { address_hash: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', type: 'ERC-20', symbol: 'USDC', name: 'USD Coin', decimals: '6' };
  const mapped = mapTokenTransfer({ transaction_hash: `0x${'a'.repeat(64)}`, log_index: 3, timestamp: '2025-06-01T00:00:00Z', from: { hash: ME }, to: { hash: '0xdex' }, token: tok, total: { value: '100000000', decimals: '6' } }, ME);
  assert(mapped && mapped.direction === 'out' && mapped.amountRaw === '100000000' && mapped.hash.endsWith(':3'), 'token transfer mapped');
  assert(mapTokenTransfer({ transaction_hash: `0x${'b'.repeat(64)}`, from: { hash: ME }, to: { hash: '0xx' }, token: { ...tok, reputation: 'scam' }, total: { value: '1' } }, ME) === null, 'scam tokens dropped');
  assert(mapTokenTransfer({ transaction_hash: `0x${'c'.repeat(64)}`, from: { hash: '0xa' }, to: { hash: '0xb' }, token: tok, total: { value: '1' } }, ME) === null, 'transfers not involving the wallet dropped');

  // Wallet import with a stubbed chain: own-wallet transfer, a swap (two legs), staking, gas.
  const tx = (hash: string, dir: 'in' | 'out', symbol: string, decimals: number, amountRaw: string, cp: string, ts = '2025-06-10T00:00:00Z', feeRaw: string | null = null) => ({
    hash, timestamp: ts, status: 'confirmed', direction: dir, asset: { symbol, decimals }, amountRaw, feeRaw, counterparty: cp,
  });
  const source = {
    native: async () => ({
      transactions: [
        tx('0xh1', 'out', 'ETH', 18, '1000000000000000000', OTHER_OWN, '2025-06-01T00:00:00Z', '21000000000000'),
        tx('0xh2', 'in', 'ETH', 18, '30000000000000000', '0xdex', '2025-06-05T00:00:00Z'),
        tx('0xv1', 'in', 'ETH', 18, '1000000000000000', '0xval', '2025-07-01T00:00:00Z'),
        tx('0xv2', 'in', 'ETH', 18, '1000000000000000', '0xval', '2025-08-01T00:00:00Z'),
        tx('0xv3', 'in', 'ETH', 18, '1000000000000000', '0xval', '2025-09-01T00:00:00Z'),
        { ...tx('0xpending', 'in', 'ETH', 18, '5', '0xq'), status: 'pending' },
      ],
    }),
    tokens: async () => [tx('0xh2:0', 'out', 'USDC', 6, '100000000', '0xdex', '2025-06-05T00:00:00Z')],
    price: async (a: string) => (a === 'ETH' ? { ok: true as const, priceNzd: 4000, source: 'yahoo+frankfurter' } : { ok: false as const, reason: 'no price' }),
  };
  assert((await importPreview(db, 'pia', 'w_fred', source)).ok === false, 'can’t import someone else’s wallet');
  let prev = await importPreview(db, 'pia', 'w_main', source);
  if (!prev.ok) throw new Error(`preview ${prev.error}`);
  const c = (ref: string) => prev.ok && prev.value.candidates.find((x) => x.ref === ref)!;
  assert(prev.value.candidates.length === 7, `7 candidates (pending dropped) ${prev.value.candidates.map((x) => x.ref)}`);
  assert(c('ethereum:0xh1')!.suggestion.kind === 'transfer_out', 'to own wallet');
  assert(c('ethereum:0xh1:fee')!.suggestion.kind === 'fee' && c('ethereum:0xh1:fee')!.amount === 0.000021, 'gas as a fee');
  assert(c('ethereum:0xh2')!.suggestion.kind === 'swap' && c('ethereum:0xh2')!.suggestion.pairRef === 'ethereum:0xh2:0', 'swap legs paired');
  assert(c('ethereum:0xv1')!.suggestion.kind === 'staking_reward' && c('ethereum:0xv1')!.nzdValue === 4, 'staking suggested, valued');

  // Commit: the swap as one row, staking rewards, the fee; ignore the own-wallet transfer.
  const commit = importCommit(db, 'pia', {
    walletId: 'w_main',
    items: [
      { ref: 'ethereum:0xh1', kind: 'ignore' },
      { ref: 'ethereum:0xh1:fee', kind: 'fee', date: '2025-06-01', asset: 'ETH', amount: 0.000021, nzdValue: 0.08 },
      { ref: 'ethereum:0xh2:0', pairRef: 'ethereum:0xh2', kind: 'swap', date: '2025-06-05', asset: 'USDC', amount: 100, nzdValue: 165, toAsset: 'ETH', toAmount: 0.03 },
      { ref: 'ethereum:0xv1', kind: 'staking_reward', date: '2025-07-01', asset: 'ETH', amount: 0.001, nzdValue: 4, priceSource: 'yahoo+frankfurter' },
    ],
  });
  assert(commit.ok && commit.value.added === 3 && commit.value.ignored === 1, `commit ${JSON.stringify(commit)}`);
  prev = await importPreview(db, 'pia', 'w_main', source);
  if (!prev.ok) throw new Error('preview 2');
  assert(prev.value.candidates.length === 2 && prev.value.skipped === 4, `only v2 and v3 left (${prev.value.candidates.map((x) => x.ref)}, skipped ${prev.value.skipped})`);
  assert(importCommit(db, 'pia', { walletId: 'w_main', items: [{ ref: 'ethereum:0xv1', kind: 'staking_reward', date: '2025-07-01', asset: 'ETH', amount: 0.001, nzdValue: 4 }] }).ok, 'repeat commit is harmless');
  assert(queryAll(db, `SELECT * FROM crypto_txns WHERE user_id = 'pia' AND external_ref = 'ethereum:0xv1'`).length === 1, 'no duplicates');
  const sw = queryAll<{ kind: string; to_asset: string }>(db, `SELECT kind, to_asset FROM crypto_txns WHERE external_ref = 'ethereum:0xh2:0'`);
  assert(sw.length === 1 && sw[0].kind === 'swap' && sw[0].to_asset === 'ETH', 'swap saved once');

  // DeFi positions and net worth.
  const nw0 = (await computeNetWorth(db, 'pia')).totalKnownNzd;
  assert((await call('POST', '/defi', F, { protocol: 'Aave', kind: 'lending', valueNzd: 1 })).status === 402, 'DeFi is Pro');
  assert((await call('POST', '/defi', P, { protocol: '', kind: 'lending', valueNzd: 1 })).status === 400, 'protocol required');
  let d = await call('POST', '/defi', P, { protocol: 'Aave', kind: 'lending', network: 'ethereum', assets: 'USDC', valueNzd: 5000 });
  assert(d.status === 201 && d.json.netNzd === 5000, 'lending position');
  d = await call('POST', '/defi', P, { protocol: 'Aave', kind: 'borrow', assets: 'ETH', valueNzd: 1200 });
  assert(d.json.netNzd === 3800, 'borrowing comes off');
  const nw1 = await computeNetWorth(db, 'pia');
  assert(nw1.defiNzd === 3800 && nw1.totalKnownNzd === nw0 + 3800, 'DeFi in net worth');
  const borrow = d.json.positions.find((x: Json) => x.kind === 'borrow');
  d = await call('PUT', `/defi/${borrow.id}`, P, { ...borrow, countInNetWorth: false });
  assert(d.json.netNzd === 5000 && (await computeNetWorth(db, 'pia')).defiNzd === 5000, 'switched off');

  // Isolation.
  assert((await call('DELETE', `/defi/${borrow.id}`, PLUS)).status === 402, 'others blocked (plan)');
  run(db, `INSERT INTO user_entitlements (user_id, plan, note, updated_at) VALUES ('fred', 'pro', '', ?)`, [now]);
  assert((await call('DELETE', `/defi/${borrow.id}`, F)).status === 404, 'another Pro user can’t delete it');
  assert((await call('PUT', `/txns/${sale.id}`, F, { date: '2025-11-01', kind: 'sell', asset: 'ETH', amount: 1, nzdValue: 1 })).status === 404, 'or edit a txn');
  const fs2 = await cryptoSummary(db, 'fred', 2025, priceOf);
  assert(fs2.ok && fs2.value.txns.length === 0 && fs2.value.defi.positions.length === 0, 'and sees nothing of Pia’s');

  // Account deletion.
  deleteScopedDataForUser(db, 'pia');
  for (const table of ['crypto_txns', 'crypto_import_refs', 'crypto_settings', 'defi_positions']) {
    assert(queryAll(db, `SELECT * FROM ${table} WHERE user_id = 'pia'`).length === 0, `${table} cleared`);
  }
  console.log('crypto tests passed');
} finally {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
