/**
 * Bitcoin xpub watching (KAN-68): BIP32 / BIP84 published vectors, address encodings, parsing
 * and validation, and the Esplora gap-limit scan + merged history against a mock server.
 * Run: npm run test:chain
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { addressDeriver, addressForPublicKey, childPublicKey, deriveAddress, parseExtendedPublicKey, scanUsedAddresses } from './xpub.ts';
import { detectSecret, validateWalletAddress } from '../lib/walletAddress.ts';
import { clearXpubScanCacheForTest } from './bitcoin.ts';
import { fetchWalletBalances, fetchWalletTransactions } from './index.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
let passed = 0;
const check = (cond: unknown, msg: string) => {
  assert(cond, msg);
  passed++;
};

// BIP84 test vector (mnemonic "abandon … about", account m/84'/0'/0').
const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const z = parseExtendedPublicKey(ZPUB)!;
check(z && z.kind === 'zpub' && z.script === 'p2wpkh' && z.depth === 3, 'zpub parsed');
check(deriveAddress(z, 0, 0) === 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'BIP84 m/84h/0h/0h/0/0');
check(deriveAddress(z, 0, 1) === 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g', 'BIP84 m/84h/0h/0h/0/1');
check(deriveAddress(z, 1, 0) === 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el', 'BIP84 m/84h/0h/0h/1/0');

// BIP32 test vector 2: public derivation of m/0 from the master xpub.
const m2 = parseExtendedPublicKey('xpub661MyMwAqRbcFW31YEwpkMuc5THy2PSt5bDMsktWQcFF8syAmRUapSCGu8ED9W6oDMSgv6Zz8idoc4a6mr8BDzTJY47LJhkJ8UB7WEGuduB')!;
check(m2 && m2.kind === 'xpub' && m2.depth === 0, 'BIP32 vector 2 master xpub parsed');
const c0 = childPublicKey(m2, 0);
check(c0.publicKey.toString('hex') === '02fc9e5af0ac8d9b3cecfe2a888e2117ba3d089d8585886c9c826b6b22a98d12ea', 'BIP32 vector 2 m/0 public key');
check(c0.chainCode.toString('hex') === 'f0909affaa7ee7abe5dd4e100598d4dc53cd709d5a5c2cac40e7412f232f7c9c', 'BIP32 vector 2 m/0 chain code');

// Address encodings for the generator point (private key 1).
const G = Buffer.from('0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798', 'hex');
check(addressForPublicKey(G, 'p2wpkh') === 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'P2WPKH (BIP173 vector)');
check(addressForPublicKey(G, 'p2pkh') === '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH', 'P2PKH');
check(addressForPublicKey(G, 'p2sh-p2wpkh') === '3JvL6Ymt8MVWiCNHC7oWU6nLeHNJKLZGLN', 'P2SH-P2WPKH');

// Parsing and validation.
check(parseExtendedPublicKey(ZPUB.slice(0, -1) + (ZPUB.endsWith('s') ? 't' : 's')) === null, 'bad checksum rejected');
check(parseExtendedPublicKey('tpubD6NzVbkrYhZ4XgiXtGrdW5XDAPFCL9h7we1vwNCpn8tGbBcgfVYjXyhWo4E1xkh56hjod1RhGjxbaTLV3X4FyWuejifB9jusQ46QzG87VKp') === null, 'testnet tpub rejected');
check(validateWalletAddress('bitcoin', ZPUB).ok, 'zpub accepted as a Bitcoin wallet');
check(!validateWalletAddress('ethereum', ZPUB).ok, 'not on Ethereum');
check(detectSecret('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi') === 'private_key', 'xprv still refused as a secret');
check(detectSecret(ZPUB) === null, 'zpub is not a secret');
let threw = false;
try {
  childPublicKey(z, 0x80000000);
} catch {
  threw = true;
}
check(threw, 'hardened public derivation refused');

// Gap-limit scan (pure): used = receive 0, 3 and change 0, gap 2.
{
  const derive = addressDeriver(z);
  const used = new Set([derive(0, 0), derive(0, 3), derive(1, 0)]);
  const probed: string[] = [];
  const found = await scanUsedAddresses(z, async (a) => {
    probed.push(a);
    return { used: used.has(a), data: null };
  }, 2);
  check(found.map((f) => `${f.chain}/${f.index}`).join() === '0/0,1/0', 'gap 2 stops before receive 3 (0/1, 0/2 unused)');
  check(probed.length === 3 + 3, 'probed 0/0..0/2 and 1/0..1/2');
}

// Esplora mock through the real registry: balance and merged history.
{
  const derive = addressDeriver(z);
  const R0 = derive(0, 0);
  const R1 = derive(0, 1);
  const C0 = derive(1, 0);
  const OTHER = '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH';
  const stats = (funded: number, spent: number, n: number) => ({ chain_stats: { funded_txo_sum: funded, spent_txo_sum: spent, tx_count: n }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 } });
  const txIn = { txid: 'a'.repeat(64), fee: 200, status: { confirmed: true, block_time: 1_700_000_000 }, vin: [{ prevout: { scriptpubkey_address: OTHER, value: 100_200 } }], vout: [{ scriptpubkey_address: R0, value: 100_000 }] };
  // Spend from R0: 30k to OTHER, 69k change to C0, fee 1k. Not an "out" of 99k: an out of 30k.
  const txOut = { txid: 'b'.repeat(64), fee: 1_000, status: { confirmed: true, block_time: 1_700_000_100 }, vin: [{ prevout: { scriptpubkey_address: R0, value: 100_000 } }], vout: [{ scriptpubkey_address: OTHER, value: 30_000 }, { scriptpubkey_address: C0, value: 69_000 }] };
  const txIn2 = { txid: 'c'.repeat(64), fee: 100, status: { confirmed: true, block_time: 1_700_000_200 }, vin: [{ prevout: { scriptpubkey_address: OTHER, value: 5_100 } }], vout: [{ scriptpubkey_address: R1, value: 5_000 }] };
  const addrStats: Record<string, unknown> = { [R0]: stats(100_000, 100_000, 2), [R1]: stats(5_000, 0, 1), [C0]: stats(69_000, 0, 1) };
  const addrTxs: Record<string, unknown[]> = { [R0]: [txOut, txIn], [R1]: [txIn2], [C0]: [txOut] };
  const seenPaths: string[] = [];
  const server = http.createServer((req, res) => {
    const m = /^\/address\/([^/]+)(\/txs)?$/.exec(req.url ?? '');
    seenPaths.push(req.url ?? '');
    res.setHeader('Content-Type', 'application/json');
    if (!m) return res.end('[]');
    const a = decodeURIComponent(m[1]);
    if (m[2]) return res.end(JSON.stringify(addrTxs[a] ?? []));
    res.end(JSON.stringify(addrStats[a] ?? stats(0, 0, 0)));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  process.env.CHAIN_BITCOIN_RPC_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    clearXpubScanCacheForTest();
    const bal = await fetchWalletBalances({ network: 'bitcoin', address: ZPUB });
    check(bal.balances[0].amountRaw === String(5_000 + 69_000), 'balance = sum over derived addresses (R0 spent, R1 5k, C0 69k change)');
    check(!seenPaths.some((p) => p.includes(ZPUB)), 'the xpub is never sent to the provider');
    const before = seenPaths.length;
    const hist = await fetchWalletTransactions({ network: 'bitcoin', address: ZPUB }, { limit: 10 });
    check(seenPaths.length - before === 3, 'scan cached: only the 3 history calls');
    check(hist.transactions.length === 3, 'deduped by txid (txOut seen on R0 and C0)');
    const out = hist.transactions.find((t) => t.hash === 'b'.repeat(64))!;
    check(out.direction === 'out' && out.amountRaw === '30000' && out.feeRaw === '1000', 'change back to the wallet is not counted as out');
    check(hist.transactions[0].hash === 'c'.repeat(64), 'newest first');
    check(hist.transactions.find((t) => t.hash === 'a'.repeat(64))?.direction === 'in', 'receive is in');
  } finally {
    server.close();
    delete process.env.CHAIN_BITCOIN_RPC_URL;
  }
}

console.log(`xpub: ${passed} checks passed`);
