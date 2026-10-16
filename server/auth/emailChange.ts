/**
 * Email change with confirmation: the new address only replaces the old one after the
 * link sent to it is opened. Until then the current email keeps working.
 * Route: server/routes/auth.ts (change-email, confirm-email). Table: email_changes.
 */
import crypto from 'node:crypto';
import type { Database } from 'sql.js';
import { queryOne, run } from '../db/index.ts';

/** How long a confirmation link works. */
export const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;
/** Minimum gap between confirmation emails for one account. */
export const EMAIL_CHANGE_RESEND_MS = 60 * 1000;

export type PendingEmail = { newEmail: string; expiresAt: string };

export type ConfirmResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; status: number; error: string; code: string };

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** The pending change for this user, or null when none (or it has expired). */
export function pendingEmailFor(db: Database, userId: string, now = new Date()): PendingEmail | null {
  const row = queryOne<{ new_email: string; expires_at: string }>(
    db,
    `SELECT new_email, expires_at FROM email_changes WHERE user_id = ?`,
    [userId],
  );
  if (!row || Date.parse(row.expires_at) <= now.getTime()) return null;
  return { newEmail: row.new_email, expiresAt: row.expires_at };
}

/** True when this user asked for a confirmation email less than a minute ago. */
export function emailChangeTooSoon(db: Database, userId: string, now = new Date()): boolean {
  const row = queryOne<{ created_at: string }>(db, `SELECT created_at FROM email_changes WHERE user_id = ?`, [userId]);
  return Boolean(row && now.getTime() - Date.parse(row.created_at) < EMAIL_CHANGE_RESEND_MS);
}

/** Start (or restart) a change to `newEmail`. Returns the raw token for the link. */
export function startEmailChange(db: Database, userId: string, newEmail: string, now = new Date()): { token: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + EMAIL_CHANGE_TTL_MS).toISOString();
  run(db, `DELETE FROM email_changes WHERE user_id = ?`, [userId]);
  run(
    db,
    `INSERT INTO email_changes (user_id, new_email, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    [userId, newEmail, hashToken(token), now.toISOString(), expiresAt],
  );
  return { token, expiresAt };
}

export function cancelEmailChange(db: Database, userId: string): void {
  run(db, `DELETE FROM email_changes WHERE user_id = ?`, [userId]);
}

/** Apply the change for this link. The link works once. */
export function confirmEmailChange(db: Database, token: string, now = new Date()): ConfirmResult {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(token)) {
    return { ok: false, status: 400, error: 'This link is incomplete. Open the latest email again.', code: 'INVALID_TOKEN' };
  }
  const row = queryOne<{ user_id: string; new_email: string; expires_at: string }>(
    db,
    `SELECT user_id, new_email, expires_at FROM email_changes WHERE token_hash = ?`,
    [hashToken(token)],
  );
  if (!row) {
    return { ok: false, status: 404, error: 'This link has already been used or replaced by a newer one.', code: 'TOKEN_NOT_FOUND' };
  }
  if (Date.parse(row.expires_at) <= now.getTime()) {
    run(db, `DELETE FROM email_changes WHERE user_id = ?`, [row.user_id]);
    return { ok: false, status: 410, error: 'This link has expired. Change your email again to get a new one.', code: 'TOKEN_EXPIRED' };
  }
  const taken = queryOne<{ id: string }>(db, `SELECT id FROM users WHERE email = ? AND id != ?`, [row.new_email, row.user_id]);
  if (taken) {
    run(db, `DELETE FROM email_changes WHERE user_id = ?`, [row.user_id]);
    return { ok: false, status: 409, error: 'Another account now uses that email.', code: 'EMAIL_TAKEN' };
  }
  run(db, `UPDATE users SET email = ?, updated_at = ? WHERE id = ?`, [row.new_email, now.toISOString(), row.user_id]);
  run(db, `DELETE FROM email_changes WHERE user_id = ?`, [row.user_id]);
  return { ok: true, userId: row.user_id, email: row.new_email };
}
