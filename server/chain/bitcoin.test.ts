/**
 * Bitcoin adapter: tx mapping, balance, Esplora pagination (mock server),
 * routed through the real registry/service. CHAIN_LIVE=1 also hits public Esplora.
 * Run: npm run test:chain
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mapEsploraTx } from './bitcoin.ts';
import { fetchWalletBalances, fetchWalletTransactions } from './index.ts';
import { formatUnits } from './networks.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
let passed = 0;
const check = (cond: unknown, msg: string) => {
  assert(cond, msg);
  passed++;
};

const ME = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const ALICE = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const BOB = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';
const conf = { confirmed: true, block_time: 1_700_000_000 };
const vin = (address: string | undefined, value: number) => ({ prevout: { scriptpubkey_address: address, value } });
const vout = (address: string | undefined, value: number) => ({ scriptpubkey_address: address, value });

// --- mapping ---------------------------------------------------------------
{
  const t = mapEsploraTx({ txid: 'a', fee: 300, status: conf, vin: [vin(ALICE, 5000)], vout: [vout(ME, 1000), vout(ALICE, 3700)] }, ME);
  check(t.direction === 'in' && t.amountRaw === '1000' && t.feeRaw === null && t.counterparty === ALICE, 'incoming');
  check(t.timestamp === '2023-11-14T22:13:20.000Z' && t.status === 'confirmed', 'confirmed timestamp');
}
{
  const t = mapEsploraTx({ txid: 'b', fee: 500, status: conf, vin: [vin(ME, 10_000)], vout: [vout(BOB, 7000), vout(ME, 2500)] }, ME);
  check(t.direction === 'out' && t.amountRaw === '7000' && t.feeRaw === '500' && t.counterparty === BOB, 'outgoing excludes change + fee');
}
{
  const t = mapEsploraTx({ txid: 'c', fee: 200, status: conf, vin: [vin(ME, 10_000)], vout: [vout(ME, 9800)] }, ME);
  check(t.direction === 'self' && t.amountRaw === '0' && t.feeRaw === '200' && t.counterparty === null, 'self transfer');
}
{
  const t = mapEsploraTx(
    { txid: 'd', fee: 200, status: conf, vin: [vin(ME, 5000), vin(ALICE, 5000)], vout: [vout(ME, 4900), vout(ALICE, 4900)] },
    ME,
  );
  check(t.direction === 'out' && t.amountRaw === '100' && t.feeRaw === null, 'coinjoin: net change, fee unknown');
}
{
  const t = mapEsploraTx(
    { txid: 'e', fee: 0, status: conf, vin: [{ is_coinbase: true, prevout: null }], vout: [vout(ME, 312_500_000)] },
    ME,
  );
  check(t.direction === 'in' && t.amountRaw === '312500000' && t.counterparty === null, 'coinbase reward');
}
{
  const t = mapEsploraTx({ txid: 'f', fee: 100, status: conf, vin: [vin(ME, 1000)], vout: [vout(ME, 900), vout(undefined, 0)] }, ME);
  check(t.direction === 'self', 'OP_RETURN output is not a counterparty');
}
{
  const t = mapEsploraTx({ txid: 'g', fee: 150, status: { confirmed: false }, vin: [vin(ALICE, 900)], vout: [vout(ME, 750)] }, ME);
  check(t.status === 'pending' && t.timestamp === null, 'pending tx');
}
check(formatUnits('312500000', 8) === '3.125', 'sats → BTC');

// --- mock Esplora --------------------------------------------------------------
const TOTAL_CONFIRMED = 60;
const txid = (i: number) => i.toString(16).padStart(64, '0');
const confirmedTxs = Array.from({ length: TOTAL_CONFIRMED }, (_, i) => ({
  txid: txid(i + 1),
  fee: 100,
  status: { confirmed: true, block_time: 1_700_000_000 - i * 600 },
  vin: [vin(ALICE, 2000)],
  vout: [vout(ME, 1000 + i)],
}));
const mempoolTxs = [1, 2].map((i) => ({
  txid: `${'f'.repeat(63)}${i}`,
  fee: 100,
  status: { confirmed: false },
  vin: [vin(ALICE, 2000)],
  vout: [vout(ME, 1)],
}));
const requests: string[] = [];

const server = http.createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '').replace(/^\/esplora/, ''));
  requests.push(path);
  const json = (o: unknown, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(o));
  };
  if (path === `/address/${ME}`) {
    return json({
      chain_stats: { funded_txo_sum: 150_000_000, spent_txo_sum: 25_000_000, tx_count: TOTAL_CONFIRMED },
      mempool_stats: { funded_txo_sum: 2, spent_txo_sum: 0, tx_count: 2 },
    });
  }
  if (path === `/address/${ME}/txs`) return json([...mempoolTxs, ...confirmedTxs.slice(0, 25)]);
  const m = new RegExp(`^/address/${ME}/txs/chain/([0-9a-f]{64})$`).exec(path);
  if (m) {
    const idx = confirmedTxs.findIndex((t) => t.txid === m[1]);
    return json(idx < 0 ? [] : confirmedTxs.slice(idx + 1, idx + 26));
  }
  if (path === '/address/bad') return json({ nope: true });
  json({ error: 'not found' }, 404);
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
process.env.CHAIN_BITCOIN_RPC_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/esplora`;

try {
  const bal = await fetchWalletBalances({ network: 'bitcoin', address: ME });
  check(bal.providerId === 'bitcoin-esplora', 'routed via registry to bitcoin adapter');
  check(bal.balances.length === 1 && bal.balances[0].amountRaw === '125000000', 'confirmed balance = funded − spent (mempool ignored)');
  check(formatUnits(bal.balances[0].amountRaw, bal.balances[0].asset.decimals) === '1.25', 'balance in BTC');

  // Page 1: pending + 50 confirmed (two upstream pages), cursor at #50.
  const p1 = await fetchWalletTransactions({ network: 'bitcoin', address: ME }, { limit: 50 });
  const p1Pending = p1.transactions.filter((t) => t.status === 'pending');
  check(p1Pending.length === 2, 'pending included on first page');
  check(p1.transactions.length === 52, `first page size (${p1.transactions.length})`);
  check(p1.nextCursor === txid(50), 'cursor = last confirmed txid');
  // Page 2: remaining 10, no more.
  const p2 = await fetchWalletTransactions({ network: 'bitcoin', address: ME }, { limit: 50, cursor: p1.nextCursor });
  check(p2.transactions.length === 10 && p2.transactions[0].hash === txid(51), 'second page continues after cursor');
  check(p2.transactions.every((t) => t.status === 'confirmed'), 'pending not repeated on later pages');
  check(p2.nextCursor === null, 'end of history');

  // Small limit truncates inside an upstream page and resumes exactly.
  const s1 = await fetchWalletTransactions({ network: 'bitcoin', address: ME }, { limit: 10 });
  check(s1.transactions.length === 12 && s1.nextCursor === txid(10), 'limit 10 → 10 confirmed + pending');
  const s2 = await fetchWalletTransactions({ network: 'bitcoin', address: ME }, { limit: 10, cursor: s1.nextCursor });
  check(s2.transactions.map((t) => t.hash).join() === Array.from({ length: 10 }, (_, i) => txid(11 + i)).join(), 'resume after truncated page');

  const all = [...p1.transactions, ...p2.transactions].filter((t) => t.status === 'confirmed');
  check(new Set(all.map((t) => t.hash)).size === TOTAL_CONFIRMED, 'no duplicates or gaps across pages');

  let threw = false;
  try {
    await fetchWalletTransactions({ network: 'bitcoin', address: ME }, { cursor: '../../etc/passwd' });
  } catch (err) {
    threw = (err as { code?: string }).code === 'upstream_error';
  }
  check(threw, 'malformed cursor rejected before any request');
  check(!requests.some((r) => r.includes('passwd')), 'malformed cursor never sent upstream');

  let bad = false;
  try {
    await fetchWalletBalances({ network: 'bitcoin', address: 'bad' });
  } catch (err) {
    bad = (err as { code?: string }).code === 'upstream_error';
  }
  check(bad, 'unexpected payload → upstream_error');
} finally {
  server.close();
  delete process.env.CHAIN_BITCOIN_RPC_URL;
}

// --- optional live smoke (public Esplora) --------------------------------------
if (process.env.CHAIN_LIVE === '1') {
  const genesis = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
  const bal = await fetchWalletBalances({ network: 'bitcoin', address: genesis });
  check(BigInt(bal.balances[0].amountRaw) >= 5_000_000_000n, 'live: genesis address holds ≥ 50 BTC');
  const page = await fetchWalletTransactions({ network: 'bitcoin', address: genesis }, { limit: 30 });
  const confirmedCount = page.transactions.filter((t) => t.status === 'confirmed').length;
  check(confirmedCount === 30 && page.nextCursor, 'live: 30 confirmed + cursor');
  const next = await fetchWalletTransactions({ network: 'bitcoin', address: genesis }, { limit: 5, cursor: page.nextCursor });
  check(next.transactions.length === 5 && !page.transactions.some((t) => t.hash === next.transactions[0].hash), 'live: next page is new');
  console.log('bitcoin live checks ran against', bal.providerId);
}

console.log(`bitcoin: ${passed} checks passed`);
