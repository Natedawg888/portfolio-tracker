/**
 * Public wallet address validation + secret rejection (read-only crypto wallets).
 *
 * - EVM (Ethereum, Polygon, Base, Arbitrum): 0x + 40 hex, EIP-55 checksum when mixed case.
 * - Bitcoin (mainnet): base58check P2PKH/P2SH, or bech32 (v0) / bech32m (v1+) segwit.
 * - Solana: base58 that decodes to a 32-byte public key.
 *
 * Seed phrases and private keys are detected *before* address validation so the user
 * gets a clear "never share this" message. Callers must never log or echo the input.
 */
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';

export type WalletFamily = 'evm' | 'bitcoin' | 'solana';

export const WALLET_NETWORKS = {
  ethereum: { label: 'Ethereum', family: 'evm' },
  polygon: { label: 'Polygon', family: 'evm' },
  base: { label: 'Base', family: 'evm' },
  arbitrum: { label: 'Arbitrum', family: 'evm' },
  bitcoin: { label: 'Bitcoin', family: 'bitcoin' },
  solana: { label: 'Solana', family: 'solana' },
} as const satisfies Record<string, { label: string; family: WalletFamily }>;

export type WalletNetwork = keyof typeof WALLET_NETWORKS;

export function parseWalletNetwork(raw: unknown): WalletNetwork | null {
  const k = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return Object.hasOwn(WALLET_NETWORKS, k) ? (k as WalletNetwork) : null;
}

// ---------------------------------------------------------------------------
// Secret detection
// ---------------------------------------------------------------------------

export type SecretKind = 'seed_phrase' | 'private_key';

export const SECRET_MESSAGES: Record<SecretKind, string> = {
  seed_phrase:
    'This looks like a recovery (seed) phrase. Never share it with anyone — KoruLedger only needs your public wallet address, and will never ask for or store your recovery phrase.',
  private_key:
    'This looks like a private key. Never share it with anyone — KoruLedger only needs your public wallet address, and will never ask for or store your private key.',
};

const MNEMONIC_LENGTHS = new Set([12, 15, 18, 21, 24]);
// A BIP39 word in any wordlist: letters (+ combining accents), no digits/punctuation.
const MNEMONIC_WORD = /^[\p{L}\p{M}]{1,10}$/u;

/**
 * Returns the kind of secret the input resembles, or null. Never throws.
 *
 * `field: 'address'` (default) is strict: an address never contains spaces, so any
 * 12+ word input is treated as a recovery phrase. `field: 'name'` only flags phrases
 * that look exactly like a mnemonic (12/15/18/21/24 single-case words) so ordinary
 * descriptive names like "Our old cold wallet for kids and the house fund" pass.
 */
export function detectSecret(input: string, field: 'address' | 'name' = 'address'): SecretKind | null {
  const s = input.trim();
  if (!s) return null;

  // BIP39 mnemonic (ignoring "1." style numbering / separators).
  const tokens = s.split(/[\s,;]+/u).filter((t) => t && !/^\d{1,2}[.):]?$/.test(t));
  const words = tokens.filter((t) => MNEMONIC_WORD.test(t));
  if (field === 'address') {
    if (words.length >= 12 && words.length >= tokens.length * 0.8) return 'seed_phrase';
  } else {
    const singleCase = s === s.toLowerCase() || s === s.toUpperCase();
    if (singleCase && MNEMONIC_LENGTHS.has(tokens.length) && words.length === tokens.length) {
      return 'seed_phrase';
    }
  }

  const compact = s.replace(/\s+/g, '');

  // Raw 32-byte hex private key (EVM / generic).
  if (/^(0x)?[0-9a-f]{64}$/i.test(compact)) return 'private_key';

  // BIP32 extended private keys: xprv/yprv/zprv/tprv/uprv/vprv + multisig Yprv/Zprv/Uprv/Vprv.
  if (/^[xyztuvYZUV]prv[1-9A-HJ-NP-Za-km-z]{100,}$/.test(compact)) return 'private_key';

  // Solana keypair exported as a JSON byte array (CLI id.json format).
  if (/^\[[\d\s,]+\]$/.test(compact)) {
    const nums = compact.slice(1, -1).split(',').filter(Boolean).map(Number);
    if (nums.length >= 32 && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      return 'private_key';
    }
  }

  const bytes = base58Decode(compact);
  if (bytes) {
    // Solana secret key: 64 bytes = seed + its ed25519 public key. Transaction
    // signatures are also 64 bytes, so confirm the halves actually match.
    if (bytes.length === 64 && isEd25519Keypair(bytes)) return 'private_key';
    // Bitcoin WIF: base58check, version 0x80 (mainnet) / 0xef (testnet), 32-byte key (+ compression flag).
    const payload = verifyChecksum(bytes);
    if (
      payload &&
      (payload[0] === 0x80 || payload[0] === 0xef) &&
      (payload.length === 33 || (payload.length === 34 && payload[33] === 0x01))
    ) {
      return 'private_key';
    }
  }
  return null;
}

// PKCS#8 DER prefix for a raw 32-byte Ed25519 private key (seed).
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** True when bytes[32..64] is the Ed25519 public key derived from seed bytes[0..32]. */
function isEd25519Keypair(bytes: Uint8Array): boolean {
  try {
    const key = createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_PREFIX, bytes.subarray(0, 32)]),
      format: 'der',
      type: 'pkcs8',
    });
    const jwk = createPublicKey(key).export({ format: 'jwk' });
    return Buffer.from(jwk.x ?? '', 'base64url').equals(bytes.subarray(32));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Address validation
// ---------------------------------------------------------------------------

export type AddressResult =
  | { ok: true; address: string }
  | { ok: false; error: string; secret?: SecretKind };

/** Validate + normalise a public address for a network. */
export function validateWalletAddress(network: WalletNetwork, raw: string): AddressResult {
  const secret = detectSecret(raw);
  if (secret) return { ok: false, error: SECRET_MESSAGES[secret], secret };

  const input = raw.trim();
  const { label, family } = WALLET_NETWORKS[network];
  if (!input) return { ok: false, error: 'address is required' };

  let address: string | null = null;
  if (family === 'evm') address = normaliseEvmAddress(input);
  else if (family === 'bitcoin') address = normaliseBitcoinAddress(input);
  else address = normaliseSolanaAddress(input);

  if (!address) {
    const hint =
      family === 'evm'
        ? 'Expected 0x followed by 40 hex characters (mixed-case addresses must match the EIP-55 checksum).'
        : family === 'bitcoin'
          ? 'Expected a Bitcoin mainnet address starting with 1, 3 or bc1.'
          : 'Expected a base58 Solana address (32–44 characters).';
    return { ok: false, error: `Not a valid ${label} address. ${hint}` };
  }
  return { ok: true, address };
}

/** EIP-55: all-lower / all-upper accepted (no checksum); mixed case must match. Returns checksummed. */
export function normaliseEvmAddress(input: string): string | null {
  const m = /^0x([0-9a-fA-F]{40})$/.exec(input);
  if (!m) return null;
  const hex = m[1];
  const checksummed = toChecksumAddress(hex);
  const isUniform = hex === hex.toLowerCase() || hex === hex.toUpperCase();
  if (!isUniform && `0x${hex}` !== checksummed) return null;
  return checksummed;
}

export function toChecksumAddress(hex40: string): string {
  const lower = hex40.toLowerCase();
  const hash = Buffer.from(keccak256(Buffer.from(lower, 'ascii'))).toString('hex');
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

export function normaliseBitcoinAddress(input: string): string | null {
  if (/^bc1/i.test(input)) return decodeSegwit('bc', input) ? input.toLowerCase() : null;
  const bytes = base58Decode(input);
  const payload = bytes && verifyChecksum(bytes);
  // P2PKH (0x00) or P2SH (0x05) + 20-byte hash.
  if (payload && payload.length === 21 && (payload[0] === 0x00 || payload[0] === 0x05)) return input;
  return null;
}

export function normaliseSolanaAddress(input: string): string | null {
  if (input.length < 32 || input.length > 44) return null;
  const bytes = base58Decode(input);
  return bytes && bytes.length === 32 ? input : null;
}

// ---------------------------------------------------------------------------
// Encoding primitives
// ---------------------------------------------------------------------------

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Decode(s: string): Uint8Array | null {
  if (!s || s.length > 200) return null;
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;
  const bytes: number[] = []; // little-endian accumulator
  for (const ch of s) {
    let carry = B58.indexOf(ch);
    if (carry < 0) return null;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Each leading '1' encodes one leading zero byte.
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...bytes.reverse()]);
}

function sha256(b: Uint8Array): Buffer {
  return createHash('sha256').update(b).digest();
}

/** base58check: returns payload (without 4-byte checksum) when valid. */
function verifyChecksum(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 5) return null;
  const payload = bytes.subarray(0, -4);
  const check = sha256(sha256(payload)).subarray(0, 4);
  return Buffer.from(bytes.subarray(-4)).equals(check) ? payload : null;
}

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32M_CONST = 0x2bc830a3;

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

/** BIP173 / BIP350 segwit address decode. Returns witness version + program, or null. */
export function decodeSegwit(
  hrp: string,
  addr: string,
): { version: number; program: Uint8Array } | null {
  if (addr.length > 90 || (addr !== addr.toLowerCase() && addr !== addr.toUpperCase())) return null;
  const s = addr.toLowerCase();
  const pos = s.lastIndexOf('1');
  if (pos < 1 || pos + 7 > s.length || s.slice(0, pos) !== hrp) return null;
  const data: number[] = [];
  for (const ch of s.slice(pos + 1)) {
    const v = BECH32_CHARSET.indexOf(ch);
    if (v < 0) return null;
    data.push(v);
  }
  const hrpExpand = [...hrp].map((c) => c.charCodeAt(0) >> 5);
  hrpExpand.push(0, ...[...hrp].map((c) => c.charCodeAt(0) & 31));
  const constant = bech32Polymod([...hrpExpand, ...data]);
  const version = data[0];
  if (version === undefined || version > 16) return null;
  // v0 must use bech32 (const 1); v1+ must use bech32m.
  if (constant !== (version === 0 ? 1 : BECH32M_CONST)) return null;

  // Convert 5-bit groups → bytes (no padding allowed).
  let acc = 0;
  let bits = 0;
  const program: number[] = [];
  for (const v of data.slice(1, -6)) {
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      program.push((acc >> bits) & 0xff);
    }
  }
  if (bits >= 5 || (acc & ((1 << bits) - 1)) !== 0) return null;
  if (program.length < 2 || program.length > 40) return null;
  if (version === 0 && program.length !== 20 && program.length !== 32) return null;
  return { version, program: Uint8Array.from(program) };
}

// Keccak-256 (original Keccak padding, as used by Ethereum — not NIST SHA3-256).
const MASK64 = (1n << 64n) - 1n;
const KECCAK_ROT = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];
const KECCAK_RC: bigint[] = (() => {
  const out: bigint[] = [];
  let r = 1;
  for (let i = 0; i < 24; i++) {
    let rc = 0n;
    for (let j = 0; j < 7; j++) {
      if (r & 1) rc ^= 1n << BigInt((1 << j) - 1);
      r = ((r << 1) ^ (r & 0x80 ? 0x71 : 0)) & 0xff;
    }
    out.push(rc);
  }
  return out;
})();

function rotl64(v: bigint, n: number): bigint {
  if (n === 0) return v;
  const s = BigInt(n);
  return ((v << s) | (v >> (64n - s))) & MASK64;
}

function keccakF(a: bigint[]): void {
  const c = new Array<bigint>(5);
  const b = new Array<bigint>(25);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) a[x + y] ^= d;
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(a[x + 5 * y], KECCAK_ROT[x + 5 * y]);
      }
    }
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        a[x + y] = b[x + y] ^ (~b[((x + 1) % 5) + y] & MASK64 & b[((x + 2) % 5) + y]);
      }
    }
    a[0] ^= KECCAK_RC[round];
  }
}

export function keccak256(input: Uint8Array): Uint8Array {
  const rate = 136;
  const padded = new Uint8Array(Math.floor(input.length / rate + 1) * rate);
  padded.set(input);
  padded[input.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;

  const state = new Array<bigint>(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let k = 7; k >= 0; k--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + k]);
      state[i] ^= lane;
    }
    keccakF(state);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = state[i];
    for (let k = 0; k < 8; k++) {
      out[i * 8 + k] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return out;
}
