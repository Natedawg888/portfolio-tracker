/**
 * Re-authentication for sensitive account changes (adding or removing a passkey,
 * disconnecting a sign-in provider): the session must have been opened in the last
 * 15 minutes, or the request must carry the account password.
 */
import type { Database } from 'sql.js';
import { queryOne } from '../db/index.ts';
import { verifyPassword } from './passwords.ts';

/** A sign-in this recent counts as confirming it's you. */
export const RECENT_SIGN_IN_MS = 15 * 60 * 1000;

/** When this session stops counting as a recent sign-in (null when it never did). */
export function recentSignInUntil(db: Database, userId: string, sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;
  const row = queryOne<{ created_at: string }>(db, `SELECT created_at FROM sessions WHERE id = ? AND user_id = ?`, [sessionId, userId]);
  const at = row ? Date.parse(row.created_at) : NaN;
  return Number.isFinite(at) ? new Date(at + RECENT_SIGN_IN_MS).toISOString() : null;
}

/** Session opened within RECENT_SIGN_IN_MS, or the account password supplied. */
export async function recentlyConfirmed(
  db: Database,
  user: { id: string; sessionId?: string },
  password: unknown,
): Promise<boolean> {
  const until = recentSignInUntil(db, user.id, user.sessionId);
  if (until && Date.now() < Date.parse(until)) return true;
  if (typeof password !== 'string' || !password) return false;
  const row = queryOne<{ password_hash: string }>(db, `SELECT password_hash FROM users WHERE id = ?`, [user.id]);
  return row ? verifyPassword(password, row.password_hash) : false;
}

export const REAUTH_REQUIRED = { error: 'Confirm your password to do this.', code: 'REAUTH_REQUIRED' } as const;
