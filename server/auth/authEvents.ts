/**
 * Sign-in audit log (KAN-75): one row per new session and per passkey change, with the
 * coarse device label ("Chrome on Windows"). No IP addresses. Every query is per user.
 */
import type { Database } from 'sql.js';
import { newId, queryAll, run } from '../db/index.ts';

export type AuthEventKind = 'sign_in' | 'passkey_added' | 'passkey_removed';
export type SignInMethod = 'password' | 'two_factor' | 'passkey' | 'sso' | 'register';

export type AuthEventInfo = {
  id: string;
  kind: AuthEventKind;
  method: string | null;
  deviceLabel: string | null;
  createdAt: string;
};

/** Events older than this are dropped when new ones are written. */
const KEEP_DAYS = 180;

export function recordAuthEvent(
  db: Database,
  userId: string,
  kind: AuthEventKind,
  opts: { method?: string | null; deviceLabel?: string | null } = {},
): void {
  const now = new Date();
  run(db, `INSERT INTO auth_events (id, user_id, kind, method, device_label, created_at) VALUES (?,?,?,?,?,?)`, [
    newId('aev'),
    userId,
    kind,
    opts.method ?? null,
    opts.deviceLabel ?? null,
    now.toISOString(),
  ]);
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();
  run(db, `DELETE FROM auth_events WHERE user_id = ? AND created_at < ?`, [userId, cutoff]);
}

/** Newest first. */
export function listAuthEvents(db: Database, userId: string, limit = 10): AuthEventInfo[] {
  return queryAll<{ id: string; kind: AuthEventKind; method: string | null; device_label: string | null; created_at: string }>(
    db,
    `SELECT id, kind, method, device_label, created_at FROM auth_events WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    [userId, limit],
  ).map((r) => ({ id: r.id, kind: r.kind, method: r.method, deviceLabel: r.device_label, createdAt: r.created_at }));
}
