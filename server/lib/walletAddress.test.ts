/**
 * Wallet address validation + secret rejection tests (published vectors where possible).
 * Run: npm run test:wallets
 */
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import {
  keccak256,
  detectSecret,
  validateWalletAddress,
  parseWalletNetwork,
  type WalletNetwork,
} from './walletAddress.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

let passed = 0;
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

// Keccak-256 (Ethereum), not SHA3-256
assert(
  hex(keccak256(new Uint8Array())) ===
    'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
  'keccak256("")',
);
assert(
  hex(keccak256(Buffer.from('abc'))) ===
    '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
  'keccak256("abc")',
);
assert(hex(keccak256(new Uint8Array(200))).length === 64, 'keccak256 multi-block');
passed += 3;

function valid(network: WalletNetwork, addr: string, expected = addr) {
  const r = validateWalletAddress(network, addr);
  assert(r.ok && r.address === expected, `${network} valid: ${addr} → ${JSON.stringify(r)}`);
  passed++;
}
function invalid(network: WalletNetwork, addr: string) {
  const r = validateWalletAddress(network, addr);
  assert(!r.ok && !r.secret, `${network} invalid: ${addr} → ${JSON.stringify(r)}`);
  passed++;
}
function secret(network: WalletNetwork, input: string, kind: 'seed_phrase' | 'private_key') {
  const r = validateWalletAddress(network, input);
  assert(!r.ok && r.secret === kind, `${network} secret ${kind} → ${JSON.stringify(r)}`);
  assert(!r.ok && !r.error.includes(input.trim().slice(0, 12)), 'error must not echo the secret');
  passed++;
}

// EVM — EIP-55 spec vectors
for (const a of [
  '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
  '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
]) {
  valid('ethereum', a);
  valid('polygon', a.toLowerCase(), a); // uniform case accepted, stored checksummed
  valid('base', `0x${a.slice(2).toUpperCase()}`, a);
}
invalid('ethereum', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD'); // bad checksum
invalid('arbitrum', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeA'); // too short
invalid('ethereum', '5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'); // missing 0x
invalid('ethereum', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'); // BTC on EVM

// Bitcoin — base58check + BIP173 / BIP350 vectors
valid('bitcoin', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'); // genesis P2PKH
valid('bitcoin', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'); // P2SH
valid('bitcoin', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'); // v0 P2WPKH
valid('bitcoin', 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
valid('bitcoin', 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3'); // v0 P2WSH
valid('bitcoin', 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0'); // v1 taproot (bech32m)
invalid('bitcoin', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb'); // bad base58 checksum
invalid('bitcoin', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5'); // bad bech32 checksum
invalid('bitcoin', 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd'); // v1 with bech32 (BIP350 invalid)
invalid('bitcoin', 'bc1QW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'); // mixed case
invalid('bitcoin', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xwkxyxyx'); // testnet hrp
invalid('bitcoin', 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn'); // testnet P2PKH
invalid('bitcoin', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');

// Solana — base58 32-byte public keys
valid('solana', '11111111111111111111111111111111'); // system program (all zero)
valid('solana', 'So11111111111111111111111111111111111111112'); // wrapped SOL mint
valid('solana', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'); // SPL token program
invalid('solana', 'So11111111111111111111111111111111111111110l'); // 'l' not base58
invalid('solana', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
invalid('solana', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'); // decodes to 25 bytes

// Secrets — rejected on every network with a clear message
const mnemonic12 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
secret('ethereum', mnemonic12, 'seed_phrase');
secret('bitcoin', `  ${mnemonic12.toUpperCase()}\n`, 'seed_phrase');
secret(
  'solana',
  mnemonic12.split(' ').map((w, i) => `${i + 1}. ${w}`).join('\n'),
  'seed_phrase',
);
secret('ethereum', 'legal winner thank year wave sausage worth useful legal winner thank yellow '.repeat(2), 'seed_phrase');
secret('ethereum', '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318', 'private_key');
secret('polygon', '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318', 'private_key');
secret('bitcoin', '5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ', 'private_key'); // WIF uncompressed
secret('bitcoin', 'KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617', 'private_key'); // WIF compressed
const XPRV =
  'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi';
secret('bitcoin', XPRV, 'private_key');
secret('solana', JSON.stringify([...randomBytes(64)]), 'private_key');
secret('solana', base58Encode(solanaSecretKey()), 'private_key');
secret(
  'solana',
  'ábaco abdomen abeja abierto abogado abono aborto abrazo abrir abuelo abuso acabar', // Spanish BIP39
  'seed_phrase',
);
secret('bitcoin', withVersion(XPRV, '02aa7a99'), 'private_key'); // Zprv (multisig)
secret('bitcoin', withVersion(XPRV, '0295b005'), 'private_key'); // Yprv (multisig)
assert(withVersion(XPRV, '02aa7a99').startsWith('Zprv'), 'Zprv fixture prefix');
passed++;

// 64-byte base58 that is NOT a keypair (e.g. a Solana tx signature) → plain invalid address
assert(detectSecret(base58Encode(randomBytes(64))) === null, 'tx signature is not a private key');
invalid('solana', base58Encode(randomBytes(64)));
passed++;

// Name field: descriptive names pass; exact mnemonic shape is still rejected
assert(
  detectSecret('Our old cold wallet for kids and the house fund plus some spare cash', 'name') === null,
  'long descriptive name is not a seed',
);
assert(detectSecret('Ledger Nano X — main long-term BTC stack (do not touch until 2030)', 'name') === null, 'name with punctuation');
assert(detectSecret(mnemonic12, 'name') === 'seed_phrase', 'mnemonic in name field');
assert(detectSecret(mnemonic12.toUpperCase(), 'name') === 'seed_phrase', 'uppercase mnemonic in name field');
assert(detectSecret('0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318', 'name') === 'private_key', 'pk in name');
passed += 5;

// Not secrets
assert(detectSecret('Cold storage') === null, 'plain wallet name is not a secret');
assert(detectSecret('My main Ledger wallet for long term holds') === null, 'short sentence is not a seed');
assert(detectSecret('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed') === null, 'EVM address is not a secret');
assert(detectSecret('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa') === null, 'BTC address is not a secret');
assert(detectSecret('So11111111111111111111111111111111111111112') === null, 'SOL address is not a secret');
passed += 5;

// Network parsing
assert(parseWalletNetwork(' Ethereum ') === 'ethereum', 'network case-insensitive');
assert(parseWalletNetwork('dogecoin') === null, 'unknown network');
assert(parseWalletNetwork('toString') === null, 'prototype keys are not networks');
passed += 3;

console.log(`walletAddress: ${passed} checks passed`);

function base58Encode(bytes: Uint8Array): string {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(`0x${hex(bytes) || '0'}`);
  let out = '';
  while (n > 0n) {
    out = A[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** 64-byte Solana secret key: 32-byte ed25519 seed + its public key. */
function solanaSecretKey(): Uint8Array {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const seed = Buffer.from(privateKey.export({ format: 'jwk' }).d!, 'base64url');
  const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url');
  return Buffer.concat([seed, pub]);
}

/** Re-encode a base58check extended key with a different 4-byte version (e.g. xprv → Zprv). */
function withVersion(key: string, versionHex: string): string {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const ch of key) n = n * 58n + BigInt(A.indexOf(ch));
  const raw = Buffer.from(n.toString(16).padStart(164, '0'), 'hex'); // 82 bytes
  const payload = Buffer.concat([Buffer.from(versionHex, 'hex'), raw.subarray(4, 78)]);
  const sha = (b: Buffer) => createHash('sha256').update(b).digest();
  return base58Encode(Buffer.concat([payload, sha(sha(payload)).subarray(0, 4)]));
}
