/**
 * Bitcoin extended public keys (KAN-68): watch a whole wallet, not one address.
 *
 * - Accepts mainnet xpub / ypub / zpub (base58check, 78 bytes, version bytes below). Private
 *   versions (xprv…) are refused as secrets before this is reached (walletAddress.ts).
 * - BIP32 public derivation (CKDpub, non-hardened only) of receive (0/i) and change (1/i)
 *   addresses, with the script type set by the prefix: xpub → P2PKH (BIP44), ypub →
 *   P2SH-P2WPKH (BIP49), zpub → P2WPKH (BIP84).
 * - secp256k1 point maths in BigInt: only public keys are handled, so constant-time code isn't
 *   needed. Hashes come from node:crypto.
 * The extended key itself is never logged or put in an error message; only derived addresses are.
 */
import { createHash, createHmac } from 'node:crypto';
import { base58Decode } from '../lib/walletAddress.ts';

export type XpubKind = 'xpub' | 'ypub' | 'zpub';
export type ScriptType = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh';

const VERSIONS: Record<number, { kind: XpubKind; script: ScriptType }> = {
  0x0488b21e: { kind: 'xpub', script: 'p2pkh' },
  0x049d7cb2: { kind: 'ypub', script: 'p2sh-p2wpkh' },
  0x04b24746: { kind: 'zpub', script: 'p2wpkh' },
};

export type ExtendedPublicKey = { kind: XpubKind; script: ScriptType; depth: number; chainCode: Buffer; publicKey: Buffer };

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest();
const hash160 = (b: Uint8Array) => createHash('ripemd160').update(sha256(b)).digest();

/** Quick shape test (no checksum): xpub/ypub/zpub followed by base58. */
export function looksLikeExtendedPublicKey(s: string): boolean {
  return /^[xyz]pub[1-9A-HJ-NP-Za-km-z]{100,112}$/.test(s.trim());
}

/** Parse and validate a mainnet xpub / ypub / zpub. Null when it isn't one. */
export function parseExtendedPublicKey(input: string): ExtendedPublicKey | null {
  const s = input.trim();
  if (!looksLikeExtendedPublicKey(s)) return null;
  const bytes = base58Decode(s);
  if (!bytes || bytes.length !== 82) return null;
  const payload = Buffer.from(bytes.subarray(0, 78));
  const check = sha256(sha256(payload)).subarray(0, 4);
  if (!Buffer.from(bytes.subarray(78)).equals(check)) return null;
  const v = VERSIONS[payload.readUInt32BE(0)];
  if (!v || s.slice(0, 4) !== v.kind) return null;
  const publicKey = payload.subarray(45, 78);
  if (publicKey[0] !== 0x02 && publicKey[0] !== 0x03) return null;
  if (!decompress(publicKey)) return null;
  return { ...v, depth: payload[4], chainCode: Buffer.from(payload.subarray(13, 45)), publicKey: Buffer.from(publicKey) };
}

// --- secp256k1 -------------------------------------------------------------------

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
};
type Point = { x: bigint; y: bigint } | null;

const mod = (a: bigint, m = P) => ((a % m) + m) % m;
function modPow(b: bigint, e: bigint, m = P): bigint {
  let r = 1n;
  b = mod(b, m);
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}
const inv = (a: bigint) => modPow(a, P - 2n);

function add(a: Point, b: Point): Point {
  if (!a) return b;
  if (!b) return a;
  if (a.x === b.x) {
    if (mod(a.y + b.y) === 0n) return null;
    const l = mod(3n * a.x * a.x * inv(2n * a.y));
    const x = mod(l * l - 2n * a.x);
    return { x, y: mod(l * (a.x - x) - a.y) };
  }
  const l = mod((b.y - a.y) * inv(b.x - a.x));
  const x = mod(l * l - a.x - b.x);
  return { x, y: mod(l * (a.x - x) - a.y) };
}

function mul(k: bigint, p: Point): Point {
  let r: Point = null;
  let q = p;
  while (k > 0n) {
    if (k & 1n) r = add(r, q);
    q = add(q, q);
    k >>= 1n;
  }
  return r;
}

const toBig = (b: Uint8Array) => BigInt(`0x${Buffer.from(b).toString('hex') || '0'}`);
const to32 = (n: bigint) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');

function decompress(pub: Uint8Array): Point {
  if (pub.length !== 33) return null;
  const x = toBig(pub.subarray(1));
  if (x >= P) return null;
  const y2 = mod(x * x * x + 7n);
  let y = modPow(y2, (P + 1n) / 4n);
  if (mod(y * y) !== y2) return null;
  if ((y & 1n) !== BigInt(pub[0] & 1)) y = P - y;
  return { x, y };
}

const compress = (p: { x: bigint; y: bigint }) => Buffer.concat([Buffer.from([p.y & 1n ? 0x03 : 0x02]), to32(p.x)]);

/** CKDpub: the non-hardened child `index` of a public key + chain code. */
export function childPublicKey(parent: { publicKey: Buffer; chainCode: Buffer }, index: number): { publicKey: Buffer; chainCode: Buffer } {
  if (!Number.isInteger(index) || index < 0 || index >= 0x80000000) throw new Error('Only non-hardened public derivation');
  const data = Buffer.alloc(37);
  parent.publicKey.copy(data, 0);
  data.writeUInt32BE(index, 33);
  const I = createHmac('sha512', parent.chainCode).update(data).digest();
  const il = toBig(I.subarray(0, 32));
  if (il >= N) throw new Error('Invalid child key (try the next index)');
  const child = add(mul(il, G), decompress(parent.publicKey));
  if (!child) throw new Error('Invalid child key (try the next index)');
  return { publicKey: compress(child), chainCode: Buffer.from(I.subarray(32)) };
}

// --- addresses ---------------------------------------------------------------------

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58check(payload: Buffer): string {
  const bytes = Buffer.concat([payload, sha256(sha256(payload)).subarray(0, 4)]);
  let n = toBig(bytes);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}
function convertBits(data: Uint8Array, from: number, to: number): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (bits > 0) out.push((acc << (to - bits)) & maxv);
  return out;
}
/** Segwit v0 (bech32) address for a 20-byte program. */
export function encodeSegwitV0(hrp: string, program: Uint8Array): string {
  const data = [0, ...convertBits(program, 8, 5)];
  const hrpExp = [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  const mod1 = polymod([...hrpExp, ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod1 >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...checksum].map((d) => CHARSET[d]).join('')}`;
}

/** Mainnet address for a compressed public key. */
export function addressForPublicKey(pub: Buffer, script: ScriptType): string {
  const h = hash160(pub);
  if (script === 'p2wpkh') return encodeSegwitV0('bc', h);
  if (script === 'p2pkh') return base58check(Buffer.concat([Buffer.from([0x00]), h]));
  const redeem = Buffer.concat([Buffer.from([0x00, 0x14]), h]);
  return base58check(Buffer.concat([Buffer.from([0x05]), hash160(redeem)]));
}

/** Derived address at chain (0 receive, 1 change) / index. */
export function deriveAddress(key: ExtendedPublicKey, chain: 0 | 1, index: number): string {
  const branch = childPublicKey(key, chain);
  return addressForPublicKey(childPublicKey(branch, index).publicKey, key.script);
}

/** A lazily derived address list per chain (branch key derived once). */
export function addressDeriver(key: ExtendedPublicKey): (chain: 0 | 1, index: number) => string {
  const branches = [childPublicKey(key, 0), childPublicKey(key, 1)];
  const cache = new Map<string, string>();
  return (chain, index) => {
    const k = `${chain}/${index}`;
    let a = cache.get(k);
    if (!a) {
      a = addressForPublicKey(childPublicKey(branches[chain], index).publicKey, key.script);
      cache.set(k, a);
    }
    return a;
  };
}

export const DEFAULT_GAP_LIMIT = 20;
/** Upper bound per chain, so a busy wallet can't run away with provider calls. */
export const MAX_ADDRESSES_PER_CHAIN = 500;

/**
 * Gap-limit scan: walk each chain until `gap` consecutive addresses have never been used.
 * `used(address)` says whether an address has any history (and may return extra data).
 */
export async function scanUsedAddresses<T>(
  key: ExtendedPublicKey,
  probe: (address: string) => Promise<{ used: boolean; data: T }>,
  gap = DEFAULT_GAP_LIMIT,
): Promise<{ address: string; chain: 0 | 1; index: number; data: T }[]> {
  const derive = addressDeriver(key);
  const out: { address: string; chain: 0 | 1; index: number; data: T }[] = [];
  for (const chain of [0, 1] as const) {
    let unused = 0;
    for (let i = 0; i < MAX_ADDRESSES_PER_CHAIN && unused < gap; i++) {
      const address = derive(chain, i);
      const r = await probe(address);
      if (r.used) {
        unused = 0;
        out.push({ address, chain, index: i, data: r.data });
      } else unused++;
    }
  }
  return out;
}
