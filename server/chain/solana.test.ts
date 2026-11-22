/**
 * Solana adapter (KAN-38): SOL balance, SPL token discovery (Token + Token-2022, summed by mint,
 * known symbols), SOL history with fees, address validation, routed through the real
 * registry/service against a mock JSON-RPC server. CHAIN_LIVE=1 also hits the public RPC.
 * Run: npm run test:chain
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { validateWalletAddress } from '../lib/walletAddress.ts';
import { KNOWN_SPL_TOKENS, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, mapSolanaTx, mapTokenAccounts, splAsset } from './solana.ts';
import { fetchWalletBalances, fetchWalletTransactions, isNetworkSyncable } from './index.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
let passed = 0;
const check = (cond: unknown, msg: string) => {
  assert(cond, msg);
  passed++;
};

const ME = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const BOB = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ODD = 'Fh7bvKWdCGM7aTPz5bD9WXkQpyQKuMjTAPrYkWz4Rpb8';
const acct = (mint: string, amount: string, decimals: number) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } } });

// --- address validation ------------------------------------------------------------
check(validateWalletAddress('solana', ME).ok, 'valid Solana address');
check(!validateWalletAddress('solana', '0x52908400098527886E0F7030069857D2E4169EE7').ok, 'EVM address rejected on Solana');
check(!validateWalletAddress('solana', 'not-an-address-0OIl').ok, 'bad base58 rejected');

// --- token mapping ---------------------------------------------------------------
{
  const b = mapTokenAccounts([acct(USDC, '1500000', 6), acct(USDC, '500000', 6), acct(ODD, '0', 9), acct(ODD, '7', 2), { account: {} }, acct('bad', '5', 6)]);
  check(b.length === 2, 'summed by mint; zero, malformed and bad mints dropped');
  const usdc = b.find((x) => x.asset.contract === USDC);
  check(usdc?.amountRaw === '2000000' && usdc.asset.symbol === 'USDC' && usdc.asset.decimals === 6, 'USDC summed, known symbol, chain decimals');
  const odd = b.find((x) => x.asset.contract === ODD);
  check(odd?.asset.symbol === 'Fh7b…Rpb8' && odd.asset.kind === 'token', 'unknown mint labelled by address');
  check(splAsset(USDC, 6).name === KNOWN_SPL_TOKENS[USDC].name, 'known name');
}

// --- history mapping -------------------------------------------------------------
{
  const keys = [{ pubkey: ME, signer: true }, { pubkey: BOB, signer: false }];
  const out = mapSolanaTx(ME, { signature: 's1', blockTime: 1_700_000_000, err: null, confirmationStatus: 'finalized' }, {
    meta: { err: null, fee: 5000, preBalances: [2_000_000_000, 0], postBalances: [1_499_995_000, 500_000_000] },
    transaction: { message: { accountKeys: keys } },
  });
  check(out?.direction === 'out' && out.amountRaw === '500000000' && out.feeRaw === '5000', 'sent 0.5 SOL, fee apart');
  check(out?.timestamp === new Date(1_700_000_000_000).toISOString() && out.status === 'confirmed', 'time and status');
  const inn = mapSolanaTx(BOB, { signature: 's1', blockTime: 1, err: null }, {
    meta: { err: null, fee: 5000, preBalances: [2_000_000_000, 0], postBalances: [1_499_995_000, 500_000_000] },
    transaction: { message: { accountKeys: keys } },
  });
  check(inn?.direction === 'in' && inn.amountRaw === '500000000' && inn.feeRaw === null, 'received 0.5 SOL, no fee');
  const failed = mapSolanaTx(ME, { signature: 's2', blockTime: 1, err: { InstructionError: [0, 'x'] } }, {
    meta: { err: { InstructionError: [0, 'x'] }, fee: 5000, preBalances: [100_000, 0], postBalances: [95_000, 0] },
    transaction: { message: { accountKeys: keys } },
  });
  check(failed?.status === 'failed' && failed.direction === 'self' && failed.feeRaw === '5000', 'failed tx keeps its fee');
  check(mapSolanaTx('Other111111111111111111111111111111111111111', { signature: 's3' }, { meta: { preBalances: [1], postBalances: [1] }, transaction: { message: { accountKeys: [ME] } } }) === null, 'address not in tx');
}

// --- mock RPC through the real registry/service ------------------------------------
const calls: { method: string; params: unknown[] }[] = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const { id, method, params } = JSON.parse(body) as { id: number; method: string; params: unknown[] };
    calls.push({ method, params });
    const reply = (result: unknown) => res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
    if (method === 'getBalance') return reply({ context: { slot: 1 }, value: 1_234_500_000 });
    if (method === 'getTokenAccountsByOwner') {
      const program = (params[1] as { programId: string }).programId;
      if (program === TOKEN_PROGRAM) return reply({ value: [acct(USDC, '25000000', 6)] });
      if (program === TOKEN_2022_PROGRAM) return reply({ value: [acct(ODD, '3', 0)] });
    }
    if (method === 'getSignaturesForAddress') {
      const before = (params[1] as { before?: string }).before;
      return reply(before ? [] : [{ signature: 'sigA', blockTime: 1_700_000_100, err: null, confirmationStatus: 'finalized' }, { signature: 'sigB', blockTime: 1_700_000_000, err: null, confirmationStatus: 'finalized' }]);
    }
    if (method === 'getTransaction') {
      const sig = params[0];
      const keys = [{ pubkey: BOB, signer: true }, { pubkey: ME, signer: false }];
      return reply(sig === 'sigA'
        ? { meta: { err: null, fee: 5000, preBalances: [10_000_000_000, 0], postBalances: [8_999_995_000, 1_000_000_000] }, transaction: { message: { accountKeys: keys } } }
        : { meta: { err: null, fee: 5000, preBalances: [1, 0], postBalances: [1, 0] }, transaction: { message: { accountKeys: keys } } });
    }
    res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'no' } }));
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
process.env.CHAIN_SOLANA_RPC_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  check(isNetworkSyncable('solana'), 'Solana is syncable now');
  const snap = await fetchWalletBalances({ network: 'solana', address: ME });
  check(snap.providerId === 'solana-rpc', 'routed to the Solana adapter');
  check(snap.balances[0].asset.symbol === 'SOL' && snap.balances[0].amountRaw === '1234500000', 'SOL balance in lamports');
  check(snap.balances.some((b) => b.asset.symbol === 'USDC' && b.amountRaw === '25000000'), 'Token program USDC');
  check(snap.balances.some((b) => b.asset.contract === ODD), 'Token-2022 mint found');
  const page = await fetchWalletTransactions({ network: 'solana', address: ME }, { limit: 2 });
  check(page.transactions.length === 1 && page.transactions[0].direction === 'in' && page.transactions[0].amountRaw === '1000000000', '1 SOL received; sigB moved nothing for ME and is left out');
  check(page.nextCursor === 'sigB', 'cursor is the last signature');
  const next = await fetchWalletTransactions({ network: 'solana', address: ME }, { limit: 2, cursor: page.nextCursor });
  check(next.transactions.length === 0 && next.nextCursor === null, 'older page empty');
  check(calls.some((c) => c.method === 'getSignaturesForAddress' && (c.params[1] as { before?: string }).before === 'sigB'), 'before = cursor');
} finally {
  server.close();
  delete process.env.CHAIN_SOLANA_RPC_URL;
}

if (process.env.CHAIN_LIVE === '1') {
  const live = await fetchWalletBalances({ network: 'solana', address: ME });
  check(live.balances[0].asset.symbol === 'SOL', 'live SOL balance');
}

console.log(`solana: ${passed} checks passed`);
