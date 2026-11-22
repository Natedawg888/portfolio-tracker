/**
 * Per-user data key lifecycle (KAN-110, part of KAN-106). Builds on dataKey.ts.
 *
 * - Signup: a random data key is made and wrapped under the password. Only the wrap is stored
 *   (user_key_wraps, one row per kind: password, sso_passphrase; later recovery, passkey:<id>).
 * - Password sign-in: the password unwraps the key into sessionKeyStore for that session only.
 *   Accounts made before KAN-106 get their key here, on their next password sign-in.
 * - 2FA: the key is unwrapped at the password step and held in memory against the challenge
 *   (5 minutes) until the code step creates the session.
 * - Password change: the key is rewrapped under the new password (from the session, or by
 *   unwrapping with the current password).
 * - SSO-only accounts have no password, so they set a data-unlock passphrase on first sign-in
 *   and enter it to unlock after each SSO sign-in.
 * - Sign-out, revoking a session and expiry clear the key from memory (sessions.ts).
 *
 * Nothing is encrypted with the key yet (KAN-112), so a lost wrap loses nothing today.
 */
import type { Database } from 'sql.js';
import { queryAll, queryOne, run } from '../db/index.ts';
import { generateDataKey, sessionKeyStore, unwrapDataKey, wrapDataKey } from './dataKey.ts';

export type WrapKind = 'password' | 'sso_passphrase';

const context = (userId: string, kind: string) => `${userId}:${kind}`;

function getWrap(db: Database, userId: string, kind: string): string | null {
  return queryOne<{ wrapped: string }>(db, `SELECT wrapped FROM user_key_wraps WHERE user_id = ? AND kind = ?`, [userId, kind])?.wrapped ?? null;
}

function putWrap(db: Database, userId: string, kind: string, wrapped: string): void {
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO user_key_wraps (user_id, kind, wrapped, created_at, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(user_id, kind) DO UPDATE SET wrapped = excluded.wrapped, updated_at = excluded.updated_at`,
    [userId, kind, wrapped, now, now],
  );
}

export function wrapKinds(db: Database, userId: string): string[] {
  return queryAll<{ kind: string }>(db, `SELECT kind FROM user_key_wraps WHERE user_id = ? ORDER BY kind`, [userId]).map((r) => r.kind);
}

/** Signup with a password: a new key wrapped under it. Returns the key for the first session. */
export async function createKeyForPassword(db: Database, userId: string, password: string): Promise<Buffer> {
  const key = generateDataKey();
  putWrap(db, userId, 'password', await wrapDataKey(key, password, context(userId, 'password')));
  return key;
}

/**
 * Password sign-in: unwrap with the password, or create the key for an account that has none
 * yet. Null when the account's key is wrapped some other way only (it needs the passphrase), or
 * the wrap doesn't open (logged by the caller; sign-in still succeeds).
 */
export async function keyForPasswordSignIn(db: Database, userId: string, password: string): Promise<Buffer | null> {
  const wrapped = getWrap(db, userId, 'password');
  if (wrapped) return unwrapDataKey(wrapped, password, context(userId, 'password'));
  if (wrapKinds(db, userId).length === 0) return createKeyForPassword(db, userId, password);
  // Has a passphrase wrap but no password wrap (SSO account that later set a password):
  // it unlocks with the passphrase, then gets a password wrap at the next password change.
  return null;
}

/** New password: rewrap the key. Uses the session's key, or the current password to unwrap. */
export async function rewrapForNewPassword(
  db: Database,
  userId: string,
  newPassword: string,
  opts: { sessionId?: string | null; currentPassword?: string | null },
): Promise<'rewrapped' | 'created' | 'locked'> {
  let key = opts.sessionId ? sessionKeyStore.get(opts.sessionId, userId) : null;
  if (!key && opts.currentPassword) {
    const wrapped = getWrap(db, userId, 'password');
    if (wrapped) key = await unwrapDataKey(wrapped, opts.currentPassword, context(userId, 'password'));
  }
  if (key) {
    putWrap(db, userId, 'password', await wrapDataKey(key, newPassword, context(userId, 'password')));
    return 'rewrapped';
  }
  if (wrapKinds(db, userId).length === 0) {
    const created = await createKeyForPassword(db, userId, newPassword);
    if (opts.sessionId) sessionKeyStore.set(opts.sessionId, userId, created);
    return 'created';
  }
  // The key exists under another secret and isn't unlocked: leave the wraps alone.
  return 'locked';
}

export type DataKeyState = 'unlocked' | 'locked' | 'needs_passphrase';

/** For the client: whether this session has the key, can unlock with a passphrase, or must set one. */
export function dataKeyState(db: Database, userId: string, sessionId: string | null | undefined): DataKeyState {
  if (sessionId && sessionKeyStore.get(sessionId, userId)) return 'unlocked';
  const kinds = wrapKinds(db, userId);
  if (kinds.length === 0) return 'needs_passphrase';
  return 'locked';
}

/**
 * SSO accounts: set the data-unlock passphrase. With no key yet, one is made; with the key
 * unlocked in this session, it's wrapped under the passphrase too. Otherwise refused.
 */
export async function setUnlockPassphrase(db: Database, userId: string, sessionId: string, passphrase: string): Promise<'created' | 'added' | 'locked'> {
  const existing = sessionKeyStore.get(sessionId, userId);
  if (existing) {
    putWrap(db, userId, 'sso_passphrase', await wrapDataKey(existing, passphrase, context(userId, 'sso_passphrase')));
    return 'added';
  }
  if (wrapKinds(db, userId).length > 0) return 'locked';
  const key = generateDataKey();
  putWrap(db, userId, 'sso_passphrase', await wrapDataKey(key, passphrase, context(userId, 'sso_passphrase')));
  sessionKeyStore.set(sessionId, userId, key);
  return 'created';
}

/** Unlock this session with the passphrase (or the password, for accounts that have one). */
export async function unlockWithSecret(db: Database, userId: string, sessionId: string, secret: string): Promise<boolean> {
  for (const kind of ['sso_passphrase', 'password'] as const) {
    const wrapped = getWrap(db, userId, kind);
    if (!wrapped) continue;
    const key = await unwrapDataKey(wrapped, secret, context(userId, kind));
    if (key) {
      sessionKeyStore.set(sessionId, userId, key);
      return true;
    }
  }
  return false;
}

// --- 2FA: the key between the password step and the code step --------------------

const PENDING_TTL_MS = 5 * 60 * 1000;
const pending = new Map<string, { userId: string; key: Buffer; expires: number }>();

/** Hold the unwrapped key against a 2FA challenge (by its token hash). */
export function holdKeyForChallenge(challengeHash: string, userId: string, key: Buffer): void {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires <= now) pending.delete(k);
  pending.set(challengeHash, { userId, key: Buffer.from(key), expires: now + PENDING_TTL_MS });
}

/** Take the held key once (the code step). Null when expired, missing or for another user. */
export function takeKeyForChallenge(challengeHash: string, userId: string): Buffer | null {
  const hit = pending.get(challengeHash);
  pending.delete(challengeHash);
  if (!hit || hit.userId !== userId || hit.expires <= Date.now()) {
    hit?.key.fill(0);
    return null;
  }
  return hit.key;
}

export function pendingKeyCountForTest(): number {
  return pending.size;
}
