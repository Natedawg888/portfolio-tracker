/**
 * Two-factor sign-in (KAN-16): authenticator-app TOTP, one-time backup codes, the
 * short-lived "password OK, code pending" challenge, and "trust this device".
 *
 * - TOTP secrets are sealed with AES-256-GCM (secretBox.ts); never stored or logged in clear.
 * - Backup codes, challenge tokens and trusted-device tokens are high-entropy random values
 *   stored as SHA-256 hashes only (like session tokens), so a database copy can't use them.
 * - A TOTP step is accepted once (totp_last_step), so an observed code can't be replayed.
 */
import { randomBytes } from 'node:crypto';
import type { Database } from 'sql.js';
import qrcode from 'qrcode-generator';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { openSecret, sealSecret } from './secretBox.ts';
import { cookieSecure, createSessionToken, hashToken } from './sessions.ts';
import { generateTotpSecret, normaliseTotpCode, otpauthUri, verifyTotp } from './totp.ts';

export const BACKUP_CODE_COUNT = 10;
/** Unconfirmed setup expires so a half-finished enrolment doesn't linger. */
const PENDING_SETUP_TTL_MS = 15 * 60 * 1000;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MAX_CHALLENGE_ATTEMPTS = 5;
export const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const TRUSTED_DEVICE_COOKIE = 'pt_tdev';
/** Tokens kept in the trusted-device cookie (one per account on this browser). */
const MAX_TRUSTED_TOKENS = 8;

// --- state ---------------------------------------------------------------------------

type TotpRow = {
  totp_secret_enc: string | null;
  totp_pending_enc: string | null;
  totp_pending_at: string | null;
  totp_enabled_at: string | null;
  totp_last_step: number | null;
};

function totpRow(db: Database, userId: string): TotpRow | null {
  return queryOne<TotpRow>(
    db,
    `SELECT totp_secret_enc, totp_pending_enc, totp_pending_at, totp_enabled_at, totp_last_step FROM users WHERE id = ?`,
    [userId],
  );
}

export function isTwoFactorEnabled(db: Database, userId: string): boolean {
  return Boolean(totpRow(db, userId)?.totp_secret_enc);
}

export type TwoFactorState = { enabled: boolean; enabledAt: string | null; backupCodesRemaining: number };

export function twoFactorState(db: Database, userId: string): TwoFactorState {
  const row = totpRow(db, userId);
  const remaining = queryOne<{ c: number }>(
    db,
    `SELECT COUNT(*) AS c FROM user_backup_codes WHERE user_id = ? AND used_at IS NULL`,
    [userId],
  );
  return {
    enabled: Boolean(row?.totp_secret_enc),
    enabledAt: row?.totp_enabled_at ?? null,
    backupCodesRemaining: Number(remaining?.c ?? 0),
  };
}

// --- enrolment -----------------------------------------------------------------------

export type SetupPayload = { secret: string; otpauthUri: string; qrSvg: string };

/** Start (or restart) enrolment: a fresh secret held as pending until a code confirms it. */
export function beginTotpSetup(db: Database, userId: string, email: string): SetupPayload {
  const secret = generateTotpSecret();
  const now = new Date().toISOString();
  run(db, `UPDATE users SET totp_pending_enc = ?, totp_pending_at = ?, updated_at = ? WHERE id = ?`, [
    sealSecret(secret),
    now,
    now,
    userId,
  ]);
  const uri = otpauthUri(secret, email);
  const qr = qrcode(0, 'M');
  qr.addData(uri);
  qr.make();
  return { secret, otpauthUri: uri, qrSvg: qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true }) };
}

export type ConfirmResult =
  | { ok: true; backupCodes: string[] }
  | { ok: false; code: 'NO_PENDING_SETUP' | 'SETUP_EXPIRED' | 'INVALID_CODE' };

export function confirmTotpSetup(db: Database, userId: string, code: string): ConfirmResult {
  const row = totpRow(db, userId);
  const secret = openSecret(row?.totp_pending_enc);
  if (!row?.totp_pending_enc || !secret) return { ok: false, code: 'NO_PENDING_SETUP' };
  const startedAt = Date.parse(row.totp_pending_at ?? '');
  if (!Number.isFinite(startedAt) || Date.now() - startedAt > PENDING_SETUP_TTL_MS) {
    return { ok: false, code: 'SETUP_EXPIRED' };
  }
  const step = verifyTotp(secret, code);
  if (step === null) return { ok: false, code: 'INVALID_CODE' };
  const now = new Date().toISOString();
  run(
    db,
    `UPDATE users SET totp_secret_enc = ?, totp_pending_enc = NULL, totp_pending_at = NULL,
       totp_enabled_at = ?, totp_last_step = ?, updated_at = ? WHERE id = ?`,
    [row.totp_pending_enc, now, step, now, userId],
  );
  return { ok: true, backupCodes: replaceBackupCodes(db, userId) };
}

/** Turn 2FA off: secret, backup codes and trusted devices all go. */
export function disableTwoFactor(db: Database, userId: string): void {
  const now = new Date().toISOString();
  run(
    db,
    `UPDATE users SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_pending_at = NULL,
       totp_enabled_at = NULL, totp_last_step = NULL, updated_at = ? WHERE id = ?`,
    [now, userId],
  );
  run(db, `DELETE FROM user_backup_codes WHERE user_id = ?`, [userId]);
  run(db, `DELETE FROM trusted_devices WHERE user_id = ?`, [userId]);
  run(db, `DELETE FROM login_challenges WHERE user_id = ?`, [userId]);
}

// --- backup codes ------------------------------------------------------------------------

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i

/** 10 characters from a 31-symbol alphabet ≈ 49.5 bits each, shown as xxxxx-xxxxx. */
function newBackupCode(): string {
  let s = '';
  while (s.length < 10) {
    // Rejection sampling: 248 = 8 × 31, so every symbol is equally likely.
    for (const b of randomBytes(16)) if (b < 248 && s.length < 10) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  }
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

export function normaliseBackupCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.toLowerCase().replace(/[\s-]/g, '');
  return /^[a-z0-9]{10}$/.test(s) ? s : null;
}

/** Replace every backup code; returns the new plaintext codes (shown once, never stored). */
export function replaceBackupCodes(db: Database, userId: string): string[] {
  run(db, `DELETE FROM user_backup_codes WHERE user_id = ?`, [userId]);
  const now = new Date().toISOString();
  const codes = Array.from({ length: BACKUP_CODE_COUNT }, newBackupCode);
  for (const code of codes) {
    run(db, `INSERT INTO user_backup_codes (id, user_id, code_hash, used_at, created_at) VALUES (?,?,?,NULL,?)`, [
      newId('bkc'),
      userId,
      hashToken(normaliseBackupCode(code)!),
      now,
    ]);
  }
  return codes;
}

// --- verifying a second factor -----------------------------------------------------------

export type SecondFactorResult =
  | { ok: true; method: 'totp' | 'backup_code'; backupCodesRemaining?: number }
  | { ok: false };

/** Check an authenticator code or a backup code; consumes the backup code / TOTP step. */
export function verifySecondFactor(db: Database, userId: string, raw: unknown): SecondFactorResult {
  const row = totpRow(db, userId);
  const secret = openSecret(row?.totp_secret_enc);
  if (!secret) return { ok: false };

  const totp = normaliseTotpCode(raw);
  if (totp) {
    const step = verifyTotp(secret, totp, { lastUsedStep: row?.totp_last_step ?? null });
    if (step === null) return { ok: false };
    run(db, `UPDATE users SET totp_last_step = ? WHERE id = ?`, [step, userId]);
    return { ok: true, method: 'totp' };
  }

  const backup = normaliseBackupCode(raw);
  if (!backup) return { ok: false };
  const hit = queryOne<{ id: string }>(
    db,
    `SELECT id FROM user_backup_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`,
    [userId, hashToken(backup)],
  );
  if (!hit) return { ok: false };
  run(db, `UPDATE user_backup_codes SET used_at = ? WHERE id = ?`, [new Date().toISOString(), hit.id]);
  return { ok: true, method: 'backup_code', backupCodesRemaining: twoFactorState(db, userId).backupCodesRemaining };
}

// --- sign-in challenge ---------------------------------------------------------------

export function createLoginChallenge(db: Database, userId: string, persistent: boolean): { token: string; expiresAt: string } {
  const now = Date.now();
  run(db, `DELETE FROM login_challenges WHERE expires_at <= ?`, [new Date(now).toISOString()]);
  const token = createSessionToken();
  const expiresAt = new Date(now + CHALLENGE_TTL_MS).toISOString();
  run(
    db,
    `INSERT INTO login_challenges (id, user_id, token_hash, persistent, attempts, created_at, expires_at) VALUES (?,?,?,?,0,?,?)`,
    [newId('chal'), userId, hashToken(token), persistent ? 1 : 0, new Date(now).toISOString(), expiresAt],
  );
  return { token, expiresAt };
}

export type ChallengeLookup =
  | { ok: true; id: string; userId: string; persistent: boolean }
  | { ok: false; code: 'CHALLENGE_INVALID' | 'CHALLENGE_EXPIRED' | 'TOO_MANY_ATTEMPTS' };

/** Look up a challenge and count this attempt against it. */
export function useChallengeAttempt(db: Database, token: unknown): ChallengeLookup {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return { ok: false, code: 'CHALLENGE_INVALID' };
  const row = queryOne<{ id: string; user_id: string; persistent: number; attempts: number; expires_at: string }>(
    db,
    `SELECT id, user_id, persistent, attempts, expires_at FROM login_challenges WHERE token_hash = ?`,
    [hashToken(token)],
  );
  if (!row) return { ok: false, code: 'CHALLENGE_INVALID' };
  if (row.expires_at <= new Date().toISOString()) {
    run(db, `DELETE FROM login_challenges WHERE id = ?`, [row.id]);
    return { ok: false, code: 'CHALLENGE_EXPIRED' };
  }
  if (Number(row.attempts) >= MAX_CHALLENGE_ATTEMPTS) {
    run(db, `DELETE FROM login_challenges WHERE id = ?`, [row.id]);
    return { ok: false, code: 'TOO_MANY_ATTEMPTS' };
  }
  run(db, `UPDATE login_challenges SET attempts = attempts + 1 WHERE id = ?`, [row.id]);
  return { ok: true, id: row.id, userId: row.user_id, persistent: Number(row.persistent) !== 0 };
}

export function deleteChallenge(db: Database, id: string): void {
  run(db, `DELETE FROM login_challenges WHERE id = ?`, [id]);
}

// --- trusted devices ---------------------------------------------------------------------

/** Raw tokens in the trusted-device cookie ("tok.tok.tok"; one per account on this browser). */
export function parseTrustedCookie(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split('.')
    .filter((t) => /^[A-Za-z0-9_-]{20,100}$/.test(t))
    .slice(-MAX_TRUSTED_TOKENS);
}

export function trustedCookieHeader(tokens: string[]): string {
  const keep = tokens.slice(-MAX_TRUSTED_TOKENS);
  const parts = [
    `${TRUSTED_DEVICE_COOKIE}=${keep.join('.')}`,
    'Path=/api/auth',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${keep.length ? Math.floor(TRUSTED_DEVICE_TTL_MS / 1000) : 0}`,
  ];
  if (cookieSecure()) parts.push('Secure');
  return parts.join('; ');
}

/** True when one of this browser's tokens is a live trusted device of `userId` (touches it). */
export function isTrustedDevice(db: Database, userId: string, tokens: string[]): boolean {
  const now = new Date().toISOString();
  for (const t of tokens) {
    const row = queryOne<{ id: string }>(
      db,
      `SELECT id FROM trusted_devices WHERE token_hash = ? AND user_id = ? AND expires_at > ?`,
      [hashToken(t), userId, now],
    );
    if (row) {
      run(db, `UPDATE trusted_devices SET last_used_at = ? WHERE id = ?`, [now, row.id]);
      return true;
    }
  }
  return false;
}

export function createTrustedDevice(db: Database, userId: string, label: string): string {
  const token = createSessionToken();
  const now = Date.now();
  run(db, `DELETE FROM trusted_devices WHERE expires_at <= ?`, [new Date(now).toISOString()]);
  run(
    db,
    `INSERT INTO trusted_devices (id, user_id, token_hash, label, created_at, last_used_at, expires_at) VALUES (?,?,?,?,?,?,?)`,
    [
      newId('tdev'),
      userId,
      hashToken(token),
      label,
      new Date(now).toISOString(),
      new Date(now).toISOString(),
      new Date(now + TRUSTED_DEVICE_TTL_MS).toISOString(),
    ],
  );
  return token;
}

export type TrustedDeviceInfo = {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
};

export function listTrustedDevices(db: Database, userId: string, browserTokens: string[]): TrustedDeviceInfo[] {
  const mine = new Set(browserTokens.map(hashToken));
  return queryAll<{ id: string; label: string | null; created_at: string; last_used_at: string | null; expires_at: string; token_hash: string }>(
    db,
    `SELECT id, label, created_at, last_used_at, expires_at, token_hash FROM trusted_devices
     WHERE user_id = ? AND expires_at > ? ORDER BY COALESCE(last_used_at, created_at) DESC`,
    [userId, new Date().toISOString()],
  ).map((r) => ({
    id: r.id,
    label: r.label ?? null,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at ?? null,
    expiresAt: r.expires_at,
    current: mine.has(r.token_hash),
  }));
}

/** Revoke one trusted device (scoped to the user), or all when `id` is null. */
export function revokeTrustedDevices(db: Database, userId: string, id: string | null): number {
  const where = id ? `user_id = ? AND id = ?` : `user_id = ?`;
  const params = id ? [userId, id] : [userId];
  const c = queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM trusted_devices WHERE ${where}`, params);
  run(db, `DELETE FROM trusted_devices WHERE ${where}`, params);
  return Number(c?.c ?? 0);
}
