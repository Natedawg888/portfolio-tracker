/**
 * Akahu user access tokens at rest.
 * AES-256-GCM when AKAHU_TOKEN_ENCRYPTION_KEY is set (32 bytes, base64 or 64 hex chars).
 * Legacy plaintext rows still open. New production writes require the key.
 * Never log token material.
 */
import crypto from 'node:crypto';
import { logger } from '../lib/logger.ts';

const PREFIX = 'ptenc1:';
let warnedMissingKey = false;

export function isSealedAccessToken(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

/** 32-byte key, or null when the env var is unset. Throws if the value is not 32 bytes. */
export function readTokenEncryptionKey(): Buffer | null {
  const raw = (process.env.AKAHU_TOKEN_ENCRYPTION_KEY ?? '').trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length === 32) return buf;
  throw new Error(
    'AKAHU_TOKEN_ENCRYPTION_KEY must be 32 bytes, as 64 hex characters or standard base64',
  );
}

export function sealAccessToken(plain: string): string {
  const key = readTokenEncryptionKey();
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('AKAHU_TOKEN_ENCRYPTION_KEY is required to store Akahu tokens');
    }
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      logger.warn('akahu_token_encryption_disabled', {
        reason: 'AKAHU_TOKEN_ENCRYPTION_KEY is unset; new Akahu tokens are stored without encryption',
      });
    }
    return plain;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

export function openAccessToken(stored: string): string {
  if (!isSealedAccessToken(stored)) return stored;
  const key = readTokenEncryptionKey();
  if (!key) {
    throw new Error('Stored Akahu token is encrypted but AKAHU_TOKEN_ENCRYPTION_KEY is not set');
  }
  const parts = stored.slice(PREFIX.length).split('.');
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    throw new Error('Could not decrypt stored Akahu token');
  }
  try {
    const iv = Buffer.from(parts[0], 'base64url');
    const tag = Buffer.from(parts[1], 'base64url');
    const data = Buffer.from(parts[2], 'base64url');
    if (iv.length === 0 || tag.length === 0 || data.length === 0) {
      throw new Error('Could not decrypt stored Akahu token');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (err) {
    if (err instanceof Error && err.message === 'Could not decrypt stored Akahu token') throw err;
    throw new Error('Could not decrypt stored Akahu token');
  }
}
