/**
 * TOTP (RFC 6238) for authenticator apps — SHA-1, 6 digits, 30 s steps, the defaults
 * every app (Google Authenticator, 1Password, Authy, Microsoft Authenticator) supports.
 * Pure functions; storage and replay protection live in twoFactor.ts.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SEC = 30;
/** Accept one step either side for clock drift (±30 s). */
export const TOTP_WINDOW = 1;
export const TOTP_ISSUER = 'KoruLedger';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret (RFC 4226 recommends ≥ 128), base32 for the authenticator app. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return bin.toString().padStart(TOTP_DIGITS, '0');
}

export function totpStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SEC);
}

/** "123 456" / "123-456" → "123456"; null unless exactly 6 digits. */
export function normaliseTotpCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(s) ? s : null;
}

/**
 * The matching time step within the drift window, or null. Steps ≤ `lastUsedStep`
 * are refused so a code can't be replayed (including an earlier code in the window).
 */
export function verifyTotp(
  secretB32: string,
  code: string,
  opts: { nowMs?: number; lastUsedStep?: number | null } = {},
): number | null {
  const secret = base32Decode(secretB32);
  const want = normaliseTotpCode(code);
  if (!secret || secret.length === 0 || !want) return null;
  const now = totpStep(opts.nowMs);
  let match: number | null = null;
  for (let d = -TOTP_WINDOW; d <= TOTP_WINDOW; d++) {
    const step = now + d;
    if (step < 0) continue;
    // Compare every candidate (no early exit) so timing doesn't reveal which step matched.
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(want)) && match === null) match = step;
  }
  if (match === null) return null;
  if (opts.lastUsedStep != null && match <= opts.lastUsedStep) return null;
  return match;
}

/** otpauth:// URI the authenticator app scans (Key URI Format). */
export function otpauthUri(secretB32: string, accountEmail: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${accountEmail}`);
  const q = new URLSearchParams({
    secret: secretB32,
    issuer: TOTP_ISSUER,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SEC),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}
