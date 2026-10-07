/**
 * Ethereum adapter (KAN-36): ETH balance over JSON-RPC, ERC-20 discovery + balances and
 * native history from Blockscout (mock server), routed through the real registry/service.
 * CHAIN_LIVE=1 also hits the public RPC + eth.blockscout.com.
 * Run: npm run test:chain
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { cleanLabel, mapBlockscoutTx, mapTokenRow } from './evm.ts';
import { fetchWalletBalances, fetchWalletTransactions, isNetworkSyncable } from './index.ts';
import { formatUnits, NETWORK_CHAIN_INFO } from './networks.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
let passed = 0;
const check = (cond: unknown, msg: string) => {
  assert(cond, msg);
  passed++;
};

const ETH = NETWORK_CHAIN_INFO.ethereum.nativeAsset;
const ME = '0x52908400098527886E0F7030069857D2E4169EE7';
const ALICE = '0x8617E340B3D01FA5F11F306F4090FD50E238070D';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const token = (address: string, symbol: string | null, decimals: string | null, extra: object = {}) => ({
  address_hash: address,
  type: 'ERC-20',
  symbol,
  name: symbol,
  decimals,
  reputation: 'ok',
  ...extra,
});
const hex40 = (i: number) => `0x${i.toString(16).padStart(40, '0')}`;

// --- token row mapping -----------------------------------------------------------
{
  const b = mapTokenRow({ token: token(USDT.toLowerCase(), 'USDT', '6'), value: '32000000' });
  check(b?.asset.kind === 'token' && b.asset.contract === USDT, 'contract checksummed');
  check(b?.amountRaw === '32000000' && formatUnits(b.amountRaw, b.asset.decimals) === '32', 'raw amount + decimals');
  check(mapTokenRow({ token: token(USDT, 'USDT', '6'), value: '0' }) === null, 'zero balance dropped');
  check(mapTokenRow({ token: token(USDT, 'X', '6', { reputation: 'scam' }), value: '5' }) === null, 'scam-flagged dropped');
  check(mapTokenRow({ token: token(USDT, 'X', null), value: '5' }) === null, 'unknown decimals dropped');
  check(mapTokenRow({ token: token(USDT, 'X', '99'), value: '5' }) === null, 'absurd decimals dropped');
  check(mapTokenRow({ token: token('0x1234', 'X', '6'), value: '5' }) === null, 'bad contract dropped');
  check(mapTokenRow({ token: { ...token(USDT, 'X', '0'), type: 'ERC-721' }, value: '1' }) === null, 'NFTs ignored');
  check(mapTokenRow({ token: token(USDT, 'X', '6'), value: '-5' }) === null, 'non-integer value dropped');
  const spam = mapTokenRow({
    token: token(USDT, '‮Claim​   reward at\nspam.example now!!!!', '18'),
    value: '1',
  });
  check(spam?.asset.symbol === 'Claim reward at spam.ex…', `spam symbol cleaned + capped (${spam?.asset.symbol})`);
  check(mapTokenRow({ token: token(USDT, '', '6'), value: '7' })?.asset.symbol === 'ERC20', 'missing symbol → ERC20');
  check(cleanLabel(null, 10) === '', 'cleanLabel null');
}

// --- tx mapping -----------------------------------------------------------------
{
  const base = { hash: '0x1', value: '1000', fee: { value: '21' }, status: 'ok', result: 'success', timestamp: '2022-11-04T14:23:23.000000Z' };
  const inTx = mapBlockscoutTx({ ...base, from: { hash: ALICE }, to: { hash: ME } }, ME, ETH);
  check(inTx.direction === 'in' && inTx.amountRaw === '1000' && inTx.feeRaw === null && inTx.counterparty === ALICE, 'incoming');
  check(inTx.status === 'confirmed' && inTx.timestamp === '2022-11-04T14:23:23.000Z', 'confirmed timestamp');
  const outTx = mapBlockscoutTx({ ...base, from: { hash: ME.toLowerCase() }, to: { hash: ALICE } }, ME, ETH);
  check(outTx.direction === 'out' && outTx.feeRaw === '21' && outTx.counterparty === ALICE, 'outgoing (case-insensitive) pays fee');
  const selfTx = mapBlockscoutTx({ ...base, from: { hash: ME }, to: { hash: ME } }, ME, ETH);
  check(selfTx.direction === 'self' && selfTx.amountRaw === '0' && selfTx.feeRaw === '21', 'self');
  const failed = mapBlockscoutTx({ ...base, status: 'error', result: 'out of gas', from: { hash: ME }, to: { hash: ALICE } }, ME, ETH);
  check(failed.status === 'failed' && failed.amountRaw === '0' && failed.feeRaw === '21', 'failed: no value, fee paid');
  const pending = mapBlockscoutTx({ ...base, status: null, result: 'pending', from: { hash: ALICE }, to: { hash: ME } }, ME, ETH);
  check(pending.status === 'pending' && pending.timestamp === null, 'pending');
  const create = mapBlockscoutTx({ ...base, from: { hash: ME }, to: null, created_contract: { hash: ALICE } }, ME, ETH);
  check(create.direction === 'out' && create.counterparty === ALICE, 'contract creation → created contract');
}

// --- mock RPC + Blockscout --------------------------------------------------------
const TOKENS = [
  ...Array.from({ length: 60 }, (_, i) => ({ token: token(hex40(i + 1), `T${i + 1}`, '18'), value: String(10 ** 6 + i) })),
  { token: token(hex40(1), 'T1', '18'), value: '1' }, // duplicate contract on a later page
  { token: token(hex40(999), 'ZERO', '18'), value: '0' },
];
const TXS = Array.from({ length: 120 }, (_, i) => ({
  hash: `0x${(i + 1).toString(16).padStart(64, '0')}`,
  from: { hash: ALICE },
  to: { hash: ME },
  value: String(1000 + i),
  fee: { value: '21' },
  status: 'ok',
  result: 'success',
  timestamp: new Date(1_700_000_000_000 - i * 60_000).toISOString(),
}));
const PAGE = 50;
const requests: string[] = [];
let failTokens = false;

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  requests.push(`${req.method} ${url.pathname}${url.search}`);
  const json = (o: unknown, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(o));
  };
  if (req.method === 'POST' && url.pathname === '/rpc') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { id, method, params } = JSON.parse(body);
      if (method === 'eth_getBalance' && params[0] === ME && params[1] === 'latest') {
        return json({ jsonrpc: '2.0', id, result: '0x1bc16d674ec80000' }); // 2 ETH
      }
      json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
    });
    return;
  }
  // Blockscout keyset pagination: next_page_params.n = index of the next item.
  const page = <T>(all: T[]) => {
    const start = Number(url.searchParams.get('n') ?? 0);
    const items = all.slice(start, start + PAGE);
    const next = start + PAGE < all.length ? { n: start + PAGE, items_count: PAGE } : null;
    return json({ items, next_page_params: next });
  };
  if (url.pathname === `/bs/addresses/${ME}/tokens`) {
    if (url.searchParams.get('type') !== 'ERC-20') return json({ message: 'type required' }, 422);
    if (failTokens) return json({ message: 'down' }, 503);
    return page(TOKENS);
  }
  if (url.pathname === `/bs/addresses/${ME}/transactions`) return page(TXS);
  json({ message: 'not found' }, 404);
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as AddressInfo).port;
process.env.CHAIN_ETHEREUM_RPC_URL = `http://127.0.0.1:${port}/rpc`;
process.env.CHAIN_ETHEREUM_INDEXER_URL = `http://127.0.0.1:${port}/bs`;

try {
  check(isNetworkSyncable('ethereum'), 'ethereum is syncable');
  check(!isNetworkSyncable('polygon'), 'L2s wait for KAN-37');

  const bal = await fetchWalletBalances({ network: 'ethereum', address: ME });
  check(bal.providerId === 'evm-rpc-blockscout', 'routed via registry to evm adapter');
  const native = bal.balances[0];
  check(native.asset.kind === 'native' && native.asset.symbol === 'ETH', 'native first');
  check(formatUnits(native.amountRaw, 18) === '2', 'ETH balance from eth_getBalance');
  const tokens = bal.balances.filter((b) => b.asset.kind === 'token');
  check(tokens.length === 60, `all tokens across pages, deduped, zero dropped (${tokens.length})`);
  check(tokens[0].amountRaw === '1000000', 'first-seen balance kept for a duplicate contract');
  check(requests.filter((r) => r.includes('/tokens')).length === 2, 'two token pages fetched');

  failTokens = true;
  const fallback = await fetchWalletBalances({ network: 'ethereum', address: ME });
  check(fallback.balances.length === 1 && fallback.balances[0].asset.kind === 'native', 'indexer down → native only');
  failTokens = false;

  // History: limit 30 stops mid-page; the cursor resumes exactly.
  const h1 = await fetchWalletTransactions({ network: 'ethereum', address: ME }, { limit: 30 });
  check(h1.transactions.length === 30 && h1.transactions[0].hash === TXS[0].hash && h1.nextCursor, 'first 30');
  const h2 = await fetchWalletTransactions({ network: 'ethereum', address: ME }, { limit: 30, cursor: h1.nextCursor });
  check(h2.transactions[0].hash === TXS[30].hash && h2.transactions.length === 30, 'resume mid-page');
  const h3 = await fetchWalletTransactions({ network: 'ethereum', address: ME }, { limit: 100, cursor: h2.nextCursor });
  check(h3.transactions.length === 60 && h3.nextCursor === null, 'rest of history across pages, then end');
  const all = [...h1.transactions, ...h2.transactions, ...h3.transactions];
  check(new Set(all.map((t) => t.hash)).size === TXS.length, 'no duplicates or gaps across pages');
  check(all.every((t) => t.direction === 'in' && t.asset.symbol === 'ETH'), 'native txs mapped');

  let threw = false;
  try {
    await fetchWalletTransactions({ network: 'ethereum', address: ME }, { cursor: '../../etc/passwd' });
  } catch (err) {
    threw = (err as { code?: string }).code === 'upstream_error';
  }
  check(threw, 'malformed cursor rejected');
  check(!requests.some((r) => r.includes('passwd')), 'malformed cursor never sent upstream');
} finally {
  server.close();
  delete process.env.CHAIN_ETHEREUM_RPC_URL;
  delete process.env.CHAIN_ETHEREUM_INDEXER_URL;
}

// --- optional live smoke (public RPC + eth.blockscout.com) -------------------------
if (process.env.CHAIN_LIVE === '1') {
  const bal = await fetchWalletBalances({ network: 'ethereum', address: ME });
  check(bal.balances[0].asset.symbol === 'ETH' && /^\d+$/.test(bal.balances[0].amountRaw), 'live: ETH balance');
  check(bal.balances.some((b) => b.asset.contract === USDT), 'live: discovers USDT held by the test address');
  const page = await fetchWalletTransactions({ network: 'ethereum', address: ME }, { limit: 5 });
  check(page.transactions.length >= 1, 'live: history');
  console.log('ethereum live checks ran against', bal.providerId);
}

console.log(`ethereum: ${passed} checks passed`);
