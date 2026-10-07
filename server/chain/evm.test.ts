/**
 * EVM adapter (KAN-36/37): native balance over JSON-RPC, ERC-20 discovery + balances and
 * native history from Blockscout, well-known tokens via Multicall3 on networks without an
 * indexer (mock servers), routed through the real registry/service.
 * CHAIN_LIVE=1 also hits the public RPCs + eth.blockscout.com.
 * Run: npm run test:chain
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { normaliseEvmAddress } from '../lib/walletAddress.ts';
import {
  MULTICALL3,
  cleanLabel,
  decodeAggregate3,
  encodeBalanceOfBatch,
  mapBlockscoutTx,
  mapTokenRow,
} from './evm.ts';
import { KNOWN_TOKENS } from './knownTokens.ts';
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

// --- well-known token list ---------------------------------------------------------
for (const [network, tokens] of Object.entries(KNOWN_TOKENS)) {
  check(tokens.length > 0, `${network}: has tokens`);
  check(tokens.every((t) => normaliseEvmAddress(t.contract) === t.contract), `${network}: contracts are EIP-55 checksummed`);
  check(tokens.every((t) => Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 36), `${network}: decimals sane`);
  check(new Set(tokens.map((t) => t.contract)).size === tokens.length, `${network}: no duplicate contracts`);
  check(new Set(tokens.map((t) => t.symbol)).size === tokens.length, `${network}: no duplicate symbols`);
}
check(['ethereum', 'polygon', 'base', 'arbitrum'].every((n) => n in KNOWN_TOKENS), 'every EVM network has a list');

// --- Multicall3 encoding --------------------------------------------------------------
const w = (hex: string) => hex.padStart(64, '0');
/** What Multicall3.aggregate3 returns: (bool success, bytes returnData)[]. */
function encodeAggregate3Result(rows: Array<{ success: boolean; value: bigint | null }>): string {
  const tuples = rows.map((r) =>
    r.value === null
      ? w(r.success ? '1' : '0') + w('40') + w('0')
      : w(r.success ? '1' : '0') + w('40') + w('20') + w(r.value.toString(16)),
  );
  let offset = rows.length * 32;
  const offsets = tuples.map((t) => {
    const o = w(offset.toString(16));
    offset += t.length / 2;
    return o;
  });
  return `0x${w('20')}${w(rows.length.toString(16))}${offsets.join('')}${tuples.join('')}`;
}
{
  const data = encodeBalanceOfBatch(ME, [USDT, ALICE]);
  check(data.startsWith('0x82ad56cb'), 'aggregate3 selector');
  check((data.length - 10) / 2 === 32 * 2 + 32 * 2 + 192 * 2, 'aggregate3 calldata length');
  check(data.includes(`70a08231${w(ME.slice(2).toLowerCase())}`), 'balanceOf(owner) calldata embedded');
  check(data.includes(w(USDT.slice(2).toLowerCase())), 'target embedded');
  const rows = decodeAggregate3(encodeAggregate3Result([{ success: true, value: 5n }, { success: false, value: null }]));
  check(rows.length === 2 && rows[0].success && BigInt(`0x${rows[0].data}`) === 5n, 'decode success row');
  check(!rows[1].success && rows[1].data === '', 'decode failed row');
  let bad = 0;
  for (const junk of ['0x', '0xzz', `0x${w('20')}${w('5')}`, `0x${w('ffffffff')}`]) {
    try {
      decodeAggregate3(junk);
    } catch {
      bad++;
    }
  }
  check(bad === 4, 'malformed multicall responses throw');
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
const rpcMulticalls: string[] = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  requests.push(`${req.method} ${url.pathname}${url.search}`);
  const json = (o: unknown, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(o));
  };
  if (req.method === 'POST' && url.pathname.startsWith('/rpc')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { id, method, params } = JSON.parse(body);
      if (method === 'eth_getBalance' && params[0] === ME && params[1] === 'latest') {
        return json({ jsonrpc: '2.0', id, result: '0x1bc16d674ec80000' }); // 2 ETH / POL
      }
      if (method === 'eth_call' && params[0]?.to === MULTICALL3) {
        rpcMulticalls.push(String(url.pathname));
        // Known list: first token holds 7 units, second call fails, the rest hold nothing.
        const n = (KNOWN_TOKENS[url.pathname === '/rpc-polygon' ? 'polygon' : 'ethereum'] ?? []).length;
        const rows = Array.from({ length: n }, (_, i) =>
          i === 0 ? { success: true, value: 7n } : i === 1 ? { success: false, value: null } : { success: true, value: 0n },
        );
        return json({ jsonrpc: '2.0', id, result: encodeAggregate3Result(rows) });
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
  check(
    (['ethereum', 'polygon', 'base', 'arbitrum'] as const).every((n) => isNetworkSyncable(n)),
    'every EVM network is syncable',
  );

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
  const fbTokens = fallback.balances.filter((b) => b.asset.kind === 'token');
  check(
    fbTokens.length === 1 && fbTokens[0].asset.contract === KNOWN_TOKENS.ethereum![0].contract && fbTokens[0].amountRaw === '7',
    'indexer down → well-known tokens via Multicall3 (failed + zero rows dropped)',
  );
  failTokens = false;

  // L2 without an indexer: native + well-known tokens over RPC only, Blockscout never asked.
  process.env.CHAIN_POLYGON_RPC_URL = `http://127.0.0.1:${port}/rpc-polygon`;
  const before = requests.length;
  const poly = await fetchWalletBalances({ network: 'polygon', address: ME });
  check(poly.providerId === 'evm-rpc-blockscout' && poly.balances[0].asset.symbol === 'POL', 'polygon native is POL');
  check(formatUnits(poly.balances[0].amountRaw, 18) === '2', 'polygon native balance');
  const polyTokens = poly.balances.filter((b) => b.asset.kind === 'token');
  check(polyTokens.length === 1 && polyTokens[0].asset.symbol === KNOWN_TOKENS.polygon![0].symbol, 'polygon well-known token');
  check(!requests.slice(before).some((r) => r.includes('/bs/')), 'no indexer request for polygon');
  check(rpcMulticalls.includes('/rpc-polygon'), 'multicall went to the polygon RPC');
  let noHistory = '';
  try {
    await fetchWalletTransactions({ network: 'polygon', address: ME });
  } catch (err) {
    noHistory = (err as { code?: string }).code ?? '';
  }
  check(noHistory === 'not_configured', 'polygon history needs an indexer');
  delete process.env.CHAIN_POLYGON_RPC_URL;

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
  for (const network of ['polygon', 'base', 'arbitrum'] as const) {
    // Native balance + one Multicall3 batch over the public RPC must succeed on each L2.
    const l2 = await fetchWalletBalances({ network, address: ME });
    check(l2.balances[0].asset.kind === 'native' && /^\d+$/.test(l2.balances[0].amountRaw), `live: ${network} native + multicall`);
  }
  console.log('evm live checks ran against', bal.providerId);
}

console.log(`evm: ${passed} checks passed`);
