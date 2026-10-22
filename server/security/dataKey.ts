/**
 * Per-user data keys (KAN-106). Each user's sensitive columns and uploads are encrypted with a
 * random 256-bit data key that only the user can unlock. The database stores the key wrapped
 * (AES-256-GCM) under a key derived from a secret the user holds: their password, an SSO unlock
 * passphrase or the recovery code. The unwrapped key lives only in server memory for the
 * session (sessionKeys below) and is never written to disk or logged.
 *
 * Argon2id is Node's built-in crypto.argon2 (Node 24+); its parameters are stored with each
 * wrapped key so they can be raised later without breaking old wraps.
 *
 * Wrapped key: dk1:argon2id:<memory KiB>,<passes>,<parallelism>:<salt>:<iv>:<tag>:<ciphertext>
 * Field:       ue1:<iv>:<tag>:<ciphertext>
 * All parts base64url.
 */
import { argon2, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

export const DATA_KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const WRAP_PREFIX = 'dk1';
const FIELD_PREFIX = 'ue1';

/** OWASP's Argon2id baseline: 19 MiB, 2 passes, 1 lane (about 80 ms here). */
export type KdfParams = { memory: number; passes: number; parallelism: number };
export const DEFAULT_KDF: KdfParams = { memory: 19456, passes: 2, parallelism: 1 };

export function generateDataKey(): Buffer {
  return randomBytes(DATA_KEY_BYTES);
}

async function deriveWrappingKey(secret: string, salt: Buffer, p: KdfParams): Promise<Buffer> {
  return argon2Async('argon2id', {
    message: Buffer.from(secret.normalize('NFKC'), 'utf8'),
    nonce: salt,
    parallelism: p.parallelism,
    tagLength: DATA_KEY_BYTES,
    memory: p.memory,
    passes: p.passes,
  });
}

function seal(key: Buffer, plain: Buffer, aad: string): [Buffer, Buffer, Buffer] {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return [iv, cipher.getAuthTag(), ct];
}

/** Null when the key is wrong, the AAD differs or the data was tampered with. */
function open(key: Buffer, iv: Buffer, tag: Buffer, ct: Buffer, aad: string): Buffer | null {
  if (iv.length !== IV_BYTES || tag.length !== 16) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    return null;
  }
}

const b64 = (b: Buffer) => b.toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');

/**
 * Wraps the data key under `secret`. `context` binds the wrap to its owner and purpose
 * (e.g. `<userId>:password`), so a wrapped key copied to another row or user won't open.
 */
export async function wrapDataKey(
  dataKey: Buffer,
  secret: string,
  context: string,
  params: KdfParams = DEFAULT_KDF,
): Promise<string> {
  if (dataKey.length !== DATA_KEY_BYTES) throw new Error('Data key must be 32 bytes');
  if (!secret) throw new Error('A secret is required to wrap the data key');
  const salt = randomBytes(SALT_BYTES);
  const kek = await deriveWrappingKey(secret, salt, params);
  try {
    const [iv, tag, ct] = seal(kek, dataKey, context);
    const kdf = `${params.memory},${params.passes},${params.parallelism}`;
    return [WRAP_PREFIX, 'argon2id', kdf, b64(salt), b64(iv), b64(tag), b64(ct)].join(':');
  } finally {
    kek.fill(0);
  }
}

/** The data key, or null when the secret or context is wrong or the value is malformed. */
export async function unwrapDataKey(wrapped: string, secret: string, context: string): Promise<Buffer | null> {
  const parts = wrapped.split(':');
  if (parts.length !== 7 || parts[0] !== WRAP_PREFIX || parts[1] !== 'argon2id') return null;
  const [memory, passes, parallelism] = parts[2].split(',').map(Number);
  if (![memory, passes, parallelism].every((n) => Number.isInteger(n) && n > 0)) return null;
  const salt = unb64(parts[3]);
  if (salt.length < SALT_BYTES || !secret) return null;
  let kek: Buffer;
  try {
    kek = await deriveWrappingKey(secret, salt, { memory, passes, parallelism });
  } catch {
    return null;
  }
  try {
    const key = open(kek, unb64(parts[4]), unb64(parts[5]), unb64(parts[6]), context);
    return key && key.length === DATA_KEY_BYTES ? key : null;
  } finally {
    kek.fill(0);
  }
}

export function isEncryptedField(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(`${FIELD_PREFIX}:`);
}

/**
 * Encrypts one column value. `aad` should name where it lives (e.g. `<userId>:transactions.amount`)
 * so a ciphertext moved to another user, table or column fails to decrypt.
 */
export function encryptField(dataKey: Buffer, plain: string, aad: string): string {
  const [iv, tag, ct] = seal(dataKey, Buffer.from(plain, 'utf8'), aad);
  return [FIELD_PREFIX, b64(iv), b64(tag), b64(ct)].join(':');
}

/** Null when the value isn't an encrypted field, or the key or AAD is wrong. */
export function decryptField(dataKey: Buffer, sealed: string, aad: string): string | null {
  if (!isEncryptedField(sealed)) return null;
  const parts = sealed.split(':');
  if (parts.length !== 4) return null;
  const out = open(dataKey, unb64(parts[1]), unb64(parts[2]), unb64(parts[3]), aad);
  return out ? out.toString('utf8') : null;
}

/** Encrypts a whole upload; same layout as a field, as bytes: iv | tag | ciphertext. */
export function encryptBytes(dataKey: Buffer, plain: Buffer, aad: string): Buffer {
  const [iv, tag, ct] = seal(dataKey, plain, aad);
  return Buffer.concat([iv, tag, ct]);
}

export function decryptBytes(dataKey: Buffer, sealed: Buffer, aad: string): Buffer | null {
  if (sealed.length < IV_BYTES + 16) return null;
  return open(dataKey, sealed.subarray(0, IV_BYTES), sealed.subarray(IV_BYTES, IV_BYTES + 16), sealed.subarray(IV_BYTES + 16), aad);
}

/**
 * Unwrapped data keys by session id, in this process's memory only. A restart or redeploy
 * empties it, so every session is locked until the user signs in again (background jobs run
 * only for unlocked sessions: KAN-106 option A).
 */
const sessionKeys = new Map<string, { userId: string; key: Buffer }>();

export const sessionKeyStore = {
  set(sessionId: string, userId: string, key: Buffer): void {
    this.clear(sessionId);
    sessionKeys.set(sessionId, { userId, key: Buffer.from(key) });
  },
  /** Only returns the key to the session's own user. */
  get(sessionId: string, userId: string): Buffer | null {
    const entry = sessionKeys.get(sessionId);
    return entry && entry.userId === userId ? entry.key : null;
  },
  /** Any unlocked session's key for the user, for jobs that run while they're signed in. */
  forUser(userId: string): Buffer | null {
    for (const entry of sessionKeys.values()) if (entry.userId === userId) return entry.key;
    return null;
  },
  clear(sessionId: string): void {
    const entry = sessionKeys.get(sessionId);
    if (!entry) return;
    entry.key.fill(0);
    sessionKeys.delete(sessionId);
  },
  clearUser(userId: string): void {
    for (const [id, entry] of sessionKeys) if (entry.userId === userId) this.clear(id);
  },
  /** Drops keys for sessions no longer in `liveSessionIds` (expired or revoked). */
  retain(liveSessionIds: ReadonlySet<string>): void {
    for (const id of [...sessionKeys.keys()]) if (!liveSessionIds.has(id)) this.clear(id);
  },
  size(): number {
    return sessionKeys.size;
  },
};
