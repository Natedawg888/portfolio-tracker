/**
 * Chain provider abstraction: config/env, key redaction, registry routing, transport errors.
 * Uses a local mock RPC server — no live network calls.
 * Run: npm run test:chain
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WALLET_NETWORKS, type WalletNetwork } from '../lib/walletAddress.ts';
import {
  describeChainConfig,
  envKeys,
  redactChainSecrets,
  resolveChainEndpoint,
  PUBLIC_DEFAULT_URLS,
} from './config.ts';
import { getJson, jsonRpc } from './http.ts';
import { formatUnits, NETWORK_CHAIN_INFO } from './networks.ts';
import { registerChainProvider, resetChainProvidersForTest } from './registry.ts';
import { fetchWalletBalances, fetchWalletTransactions, isNetworkSyncable } from './service.ts';
import { ChainProviderError, type ChainProvider, type ProviderContext } from './types.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

let passed = 0;
const check = (cond: unknown, msg: string) => {
  assert(cond, msg);
  passed++;
};

async function expectChainError(
  p: Promise<unknown>,
  code: ChainProviderError['code'],
  msg: string,
): Promise<ChainProviderError> {
  try {
    await p;
  } catch (err) {
    assert(err instanceof ChainProviderError, `${msg}: expected ChainProviderError, got ${err}`);
    const e = err as ChainProviderError;
    assert(e.code === code, `${msg}: expected ${code}, got ${e.code} (${e.message})`);
    passed++;
    return e;
  }
  throw new Error(`FAIL: ${msg}: expected rejection`);
}

// Clear any CHAIN_* from the developer's .env so results are deterministic.
for (const n of Object.keys(WALLET_NETWORKS) as WalletNetwork[]) {
  delete process.env[envKeys(n).url];
  delete process.env[envKeys(n).apiKey];
}

// --- formatUnits -----------------------------------------------------------
check(formatUnits('1000000000000000000', 18) === '1', '1 ETH');
check(formatUnits('1500000000000000000', 18) === '1.5', '1.5 ETH');
check(formatUnits('1', 8) === '0.00000001', '1 sat');
check(formatUnits('0', 9) === '0', 'zero lamports');
check(formatUnits('-250', 2) === '-2.5', 'negative');
check(formatUnits('007', 0) === '7', 'zero decimals strips leading zeros');
check(formatUnits('123456789012345678901234567890', 18) === '123456789012.34567890123456789', 'beyond float precision');
for (const n of Object.keys(WALLET_NETWORKS) as WalletNetwork[]) {
  check(NETWORK_CHAIN_INFO[n]?.nativeAsset.kind === 'native', `${n} has native asset`);
  check(PUBLIC_DEFAULT_URLS[n]?.startsWith('https://'), `${n} has https default`);
}

// --- mock RPC server ---------------------------------------------------------
const SECRET_PATH_KEY = 'alchemyStyleKey0123456789abcdef';
const SECRET_HEADER_KEY = 'hdr-secret-key-98765';
let lastApiKeyHeader: string | undefined;

const server = http.createServer((req, res) => {
  lastApiKeyHeader = req.headers['x-api-key'] as string | undefined;
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = req.url ?? '';
    if (url.endsWith('/rest/address/abc')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ chain_stats: { funded_txo_sum: 5000 } }));
      return;
    }
    const call = body ? (JSON.parse(body) as { id: number; method: string }) : { id: 0, method: '' };
    const reply = (o: object, status = 200, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(o));
    };
    switch (call.method) {
      case 'eth_blockNumber':
        return reply({ jsonrpc: '2.0', id: call.id, result: '0x10' });
      case 'rpc_error':
        // Upstream echoes the request URL — must be redacted.
        return reply({
          jsonrpc: '2.0',
          id: call.id,
          error: { code: -32000, message: `bad request to /v2/${SECRET_PATH_KEY}` },
        });
      case 'rpc_rate':
        return reply({ jsonrpc: '2.0', id: call.id, error: { code: -32005, message: 'limit exceeded' } });
      case 'http_429':
        return reply({ error: 'slow down' }, 429, { 'Retry-After': '7' });
      case 'http_500':
        return reply({ error: `internal for key ${SECRET_HEADER_KEY}` }, 500);
      case 'not_json':
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<html>oops</html>');
      case 'slow':
        setTimeout(() => reply({ jsonrpc: '2.0', id: call.id, result: 1 }), 1500);
        return;
      default:
        return reply({ jsonrpc: '2.0', id: call.id, error: { code: -32601, message: 'method not found' } });
    }
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as AddressInfo).port;
const envUrl = `http://127.0.0.1:${port}/v2/${SECRET_PATH_KEY}`;

const noLeak = (text: string, what: string) => {
  check(!text.includes(SECRET_PATH_KEY), `${what}: no path key`);
  check(!text.includes(SECRET_HEADER_KEY), `${what}: no header key`);
  check(!text.includes(`127.0.0.1:${port}`), `${what}: no endpoint host`);
};

try {
  // --- config ----------------------------------------------------------------
  const def = resolveChainEndpoint('bitcoin');
  check(def.ok && def.endpoint.source === 'public-default' && def.endpoint.url === PUBLIC_DEFAULT_URLS.bitcoin, 'default endpoint');

  process.env.CHAIN_ETHEREUM_RPC_URL = envUrl;
  process.env.CHAIN_ETHEREUM_API_KEY = SECRET_HEADER_KEY;
  const eth = resolveChainEndpoint('ethereum');
  check(eth.ok && eth.endpoint.source === 'env' && eth.endpoint.url === envUrl && eth.endpoint.apiKey === SECRET_HEADER_KEY, 'env endpoint');

  process.env.CHAIN_POLYGON_RPC_URL = `http://evil.example.com/${SECRET_PATH_KEY}`;
  const poly = resolveChainEndpoint('polygon');
  check(!poly.ok && poly.reason.includes('CHAIN_POLYGON_RPC_URL') && !poly.reason.includes('evil'), 'non-https remote rejected by name only');
  process.env.CHAIN_BASE_RPC_URL = 'not a url';
  check(!resolveChainEndpoint('base').ok, 'garbage URL rejected');

  const described = JSON.stringify(describeChainConfig());
  noLeak(described, 'describeChainConfig');
  check(!described.includes('evil') && !described.includes('publicnode'), 'describe exposes no hosts');
  const ethStatus = describeChainConfig().find((c) => c.network === 'ethereum');
  check(ethStatus?.configured && ethStatus.hasApiKey && ethStatus.source === 'env', 'describe ethereum status');
  check(describeChainConfig().find((c) => c.network === 'polygon')?.configured === false, 'describe polygon misconfigured');
  delete process.env.CHAIN_POLYGON_RPC_URL;
  delete process.env.CHAIN_BASE_RPC_URL;

  noLeak(
    redactChainSecrets(`GET ${envUrl}/x?apikey=zzz failed; key ${SECRET_HEADER_KEY}; path /v2/${SECRET_PATH_KEY}`),
    'redactChainSecrets',
  );
  check(redactChainSecrets('https://x.test/?api_key=abc123&y=1') === 'https://x.test/?api_key=[redacted]&y=1', 'generic api_key= redacted');

  // --- transport ---------------------------------------------------------------
  if (!eth.ok) throw new Error('unreachable');
  const ep = eth.endpoint;
  check((await jsonRpc<string>(ep, 'eth_blockNumber', [])) === '0x10', 'jsonRpc result');
  check(lastApiKeyHeader === SECRET_HEADER_KEY, 'api key sent as header');
  await jsonRpc(ep, 'eth_blockNumber', [], { apiKeyHeader: null });
  check(lastApiKeyHeader === undefined, 'apiKeyHeader:null omits key');
  const restEp = { ...ep, url: `http://127.0.0.1:${port}/rest/` };
  check((await getJson<{ chain_stats: { funded_txo_sum: number } }>(restEp, '/address/abc')).chain_stats.funded_txo_sum === 5000, 'getJson path join');

  noLeak((await expectChainError(jsonRpc(ep, 'rpc_error', []), 'upstream_error', 'rpc error')).message, 'rpc error');
  const rpcRate = await expectChainError(jsonRpc(ep, 'rpc_rate', []), 'rate_limited', 'rpc -32005');
  check(rpcRate.retryable, 'rate limit retryable');
  const r429 = await expectChainError(jsonRpc(ep, 'http_429', []), 'rate_limited', 'http 429');
  check(r429.retryAfterSec === 7, 'Retry-After parsed');
  const r500 = await expectChainError(jsonRpc(ep, 'http_500', []), 'upstream_error', 'http 500');
  noLeak(r500.message, 'http 500');
  check(!r500.retryable && r500.message.includes('HTTP 500'), 'http 500 message');
  await expectChainError(jsonRpc(ep, 'not_json', []), 'upstream_error', 'non-JSON body');
  const slow = await expectChainError(jsonRpc(ep, 'slow', [], { timeoutMs: 200 }), 'timeout', 'timeout');
  check(slow.retryable, 'timeout retryable');
  const closed = { ...ep, url: `http://127.0.0.1:1/v2/${SECRET_PATH_KEY}` };
  noLeak((await expectChainError(jsonRpc(closed, 'eth_blockNumber', []), 'network_error', 'connection refused')).message, 'network error');

  // --- registry + service -----------------------------------------------------------
  resetChainProvidersForTest();
  await expectChainError(fetchWalletBalances({ network: 'ethereum', address: '0xabc' }), 'unsupported_network', 'no adapter yet');
  check(!isNetworkSyncable('ethereum'), 'not syncable without adapter');

  const seen: ProviderContext[] = [];
  const fakeEvm: ChainProvider = {
    id: 'fake-evm',
    label: 'Fake EVM',
    supports: (n) => WALLET_NETWORKS[n].family === 'evm',
    async getBalances(ctx, address) {
      seen.push(ctx);
      if (address === 'boom') throw new Error(`fetch ${ctx.endpoint.url} failed with ${SECRET_HEADER_KEY}`);
      return [{ asset: NETWORK_CHAIN_INFO[ctx.network].nativeAsset, amountRaw: '42' }];
    },
    async getTransactions(_ctx, _address, opts) {
      return { transactions: [], nextCursor: opts.limit === 100 ? 'capped' : null };
    },
  };
  registerChainProvider(fakeEvm);
  let dup = false;
  try {
    registerChainProvider(fakeEvm);
  } catch {
    dup = true;
  }
  check(dup, 'duplicate provider id rejected');

  // Same adapter serves every EVM network — Base needs no service/aggregation change.
  const ethSnap = await fetchWalletBalances({ network: 'ethereum', address: '0xabc' });
  const baseSnap = await fetchWalletBalances({ network: 'base', address: '0xabc' });
  check(ethSnap.providerId === 'fake-evm' && ethSnap.balances[0].amountRaw === '42', 'ethereum routed');
  check(baseSnap.balances[0].asset.symbol === 'ETH' && baseSnap.network === 'base', 'base routed');
  check(seen[0].endpoint.source === 'env' && seen[1].endpoint.source === 'public-default', 'adapter gets per-network endpoint');
  check(isNetworkSyncable('base') && !isNetworkSyncable('solana'), 'syncable reflects adapters');
  await expectChainError(fetchWalletBalances({ network: 'solana', address: 'x' }), 'unsupported_network', 'solana not registered');

  const boom = await expectChainError(fetchWalletBalances({ network: 'ethereum', address: 'boom' }), 'upstream_error', 'adapter throw normalised');
  noLeak(boom.message, 'adapter error');

  const txs = await fetchWalletTransactions({ network: 'arbitrum', address: '0xabc' }, { limit: 10_000 });
  check(txs.nextCursor === 'capped' && txs.providerId === 'fake-evm', 'tx limit capped at 100');

  process.env.CHAIN_ARBITRUM_RPC_URL = 'ftp://nope';
  await expectChainError(fetchWalletBalances({ network: 'arbitrum', address: '0xabc' }), 'not_configured', 'misconfigured env');
  delete process.env.CHAIN_ARBITRUM_RPC_URL;
} finally {
  server.close();
  resetChainProvidersForTest();
}

console.log(`chain: ${passed} checks passed`);
