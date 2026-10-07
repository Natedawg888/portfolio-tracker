/**
 * Encrypt small server-side secrets at rest (2FA TOTP secrets) with AES-256-GCM.
 *
 * Key: AUTH_ENCRYPTION_KEY (32 bytes as 64 hex chars or base64) — set it in production
 * and keep it out of database backups. Without it, a random key is generated once at
 * data/secrets/auth.key (mode 0600) so local installs work; that file sits beside the
 * database, so it protects copies of the .db on their own but not a copy of data/.
 *
 * Stored format: v1:<iv b64url>:<tag b64url>:<ciphertext b64url>
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../db/index.ts';

let cachedKey: Buffer | null = null;

function parseKey(raw: string): Buffer | null {
  const s = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return Buffer.from(s, 'hex');
  const b = Buffer.from(s, 'base64');
  return b.length === 32 ? b : null;
}

export function encryptionKeySource(): 'env' | 'file' {
  return process.env.AUTH_ENCRYPTION_KEY?.trim() ? 'env' : 'file';
}

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const env = process.env.AUTH_ENCRYPTION_KEY?.trim();
  if (env) {
    const k = parseKey(env);
    if (!k) throw new Error('AUTH_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64)');
    cachedKey = k;
    return k;
  }
  const dir = path.join(DATA_DIR, 'secrets');
  const file = path.join(dir, 'auth.key');
  if (fs.existsSync(file)) {
    const k = parseKey(fs.readFileSync(file, 'utf8'));
    if (!k) throw new Error(`${file} is not a valid 32-byte key`);
    cachedKey = k;
    return k;
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const k = randomBytes(32);
  fs.writeFileSync(file, `${k.toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
  cachedKey = k;
  return k;
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(':');
}

/** Null when the value is malformed or was sealed with a different key. */
export function openSecret(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const parts = sealed.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(parts[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Tests only. */
export function resetSecretBoxKeyForTest(): void {
  cachedKey = null;
}
