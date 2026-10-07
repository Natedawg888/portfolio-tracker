/**
 * DB-backed sessions. Cookie holds raw token; DB stores SHA-256 hash only.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Database } from 'sql.js';
import { getDb, queryAll, queryOne, run, newId } from '../db/index.ts';

export const SESSION_COOKIE = 'pt_sid';
/** 30 days */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** "Keep me signed in" unticked: browser-session cookie, and the server forgets it after 24 h. */
export const SHORT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** last_seen_at is written at most this often (every write persists the whole sql.js file). */
const TOUCH_EVERY_MS = 10 * 60 * 1000;

export type AuthUser = {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  /** The session this request authenticated with (for "this device" / revoke others). */
  sessionId?: string;
};

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export type NewSession = { id: string; rawToken: string; expiresAt: string; persistent: boolean };

export async function createSession(
  userId: string,
  opts: { persistent?: boolean; deviceLabel?: string | null } = {},
): Promise<NewSession> {
  const db = await getDb();
  const persistent = opts.persistent ?? true;
  const rawToken = createSessionToken();
  const tokenHash = hashToken(rawToken);
  const id = newId('sess');
  const now = new Date();
  const ttl = persistent ? SESSION_TTL_MS : SHORT_SESSION_TTL_MS;
  const expiresAt = new Date(now.getTime() + ttl).toISOString();
  run(
    db,
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, device_label, last_seen_at, persistent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, tokenHash, expiresAt, now.toISOString(), opts.deviceLabel ?? null, now.toISOString(), persistent ? 1 : 0],
  );
  return { id, rawToken, expiresAt, persistent };
}

export type SessionRef = { id: string; userId: string; expiresAt: string; persistent: boolean };

/** Resolve a raw session token without touching it; null when unknown or expired. */
export function sessionByToken(database: Database, rawToken: string | null | undefined): SessionRef | null {
  if (!rawToken) return null;
  const row = queryOne<{ id: string; user_id: string; expires_at: string; persistent: number }>(
    database,
    `SELECT id, user_id, expires_at, persistent FROM sessions WHERE token_hash = ?`,
    [hashToken(rawToken)],
  );
  if (!row || row.expires_at <= new Date().toISOString()) return null;
  return { id: row.id, userId: row.user_id, expiresAt: row.expires_at, persistent: Number(row.persistent) !== 0 };
}

export type SessionInfo = {
  id: string;
  deviceLabel: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  persistent: boolean;
  current: boolean;
};

/** A user's live sessions, most recently used first. */
export function listSessions(database: Database, userId: string, currentId?: string | null): SessionInfo[] {
  const now = new Date().toISOString();
  return queryAll<{
    id: string;
    device_label: string | null;
    created_at: string;
    last_seen_at: string | null;
    expires_at: string;
    persistent: number;
  }>(
    database,
    `SELECT id, device_label, created_at, last_seen_at, expires_at, persistent FROM sessions
     WHERE user_id = ? AND expires_at > ? ORDER BY COALESCE(last_seen_at, created_at) DESC`,
    [userId, now],
  ).map((r) => ({
    id: r.id,
    deviceLabel: r.device_label ?? null,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at ?? null,
    expiresAt: r.expires_at,
    persistent: Number(r.persistent) !== 0,
    current: r.id === currentId,
  }));
}

/** Sign one session out (scoped to the user). True when a row was removed. */
export function revokeSession(database: Database, userId: string, sessionId: string): boolean {
  const hit = queryOne(database, `SELECT id FROM sessions WHERE id = ? AND user_id = ?`, [sessionId, userId]);
  if (!hit) return false;
  run(database, `DELETE FROM sessions WHERE id = ? AND user_id = ?`, [sessionId, userId]);
  return true;
}

/** Sign out every other session of this user; returns how many. */
export function revokeOtherSessions(database: Database, userId: string, keepSessionId: string): number {
  const c = queryOne<{ c: number }>(
    database,
    `SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND id != ?`,
    [userId, keepSessionId],
  );
  run(database, `DELETE FROM sessions WHERE user_id = ? AND id != ?`, [userId, keepSessionId]);
  return Number(c?.c ?? 0);
}

export async function destroySessionByToken(rawToken: string | undefined | null): Promise<void> {
  if (!rawToken) return;
  const db = await getDb();
  run(db, `DELETE FROM sessions WHERE token_hash = ?`, [hashToken(rawToken)]);
}

export async function findUserBySessionToken(
  rawToken: string | undefined | null,
): Promise<AuthUser | null> {
  if (!rawToken) return null;
  const db = await getDb();
  const tokenHash = hashToken(rawToken);
  const now = new Date().toISOString();
  const row = queryOne<{
    user_id: string;
    email: string;
    display_name: string | null;
    avatar_url: string | null;
    created_at: string;
    expires_at: string;
    session_id: string;
    last_seen_at: string | null;
  }>(
    db,
    `SELECT s.id AS session_id, s.expires_at, s.last_seen_at, u.id AS user_id, u.email,
            u.display_name, u.avatar_url, u.created_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?
     LIMIT 1`,
    [tokenHash],
  );
  if (!row) return null;
  if (String(row.expires_at) <= now) {
    run(db, `DELETE FROM sessions WHERE id = ?`, [row.session_id]);
    return null;
  }
  const seen = row.last_seen_at ? Date.parse(row.last_seen_at) : 0;
  if (!Number.isFinite(seen) || Date.now() - seen > TOUCH_EVERY_MS) {
    run(db, `UPDATE sessions SET last_seen_at = ? WHERE id = ?`, [now, row.session_id]);
  }
  return {
    sessionId: String(row.session_id),
    id: String(row.user_id),
    email: String(row.email),
    displayName: row.display_name != null && String(row.display_name).trim() !== ''
      ? String(row.display_name)
      : null,
    avatarUrl: row.avatar_url != null && String(row.avatar_url).trim() !== ''
      ? String(row.avatar_url)
      : null,
    createdAt: String(row.created_at),
  };
}

export function purgeExpiredSessions(database: Database): void {
  const now = new Date().toISOString();
  database.run(`DELETE FROM sessions WHERE expires_at <= ?`, [now]);
}

export function parseCookieHeader(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k !== name) continue;
    const v = part.slice(idx + 1).trim();
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  return null;
}

function cookieSecureEnabled(): boolean {
  const v = (process.env.COOKIE_SECURE ?? '').trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'no') return false;
  // Default: Secure only in production (Railway/Fly HTTPS). Local npm run start on http keeps Secure off unless set.
  return process.env.NODE_ENV === 'production';
}

/**
 * `persistent: false` ("keep me signed in" unticked) omits Max-Age, so the browser drops
 * the cookie when it closes; the server still expires the session after 24 h.
 */
export function sessionCookieHeader(rawToken: string, expiresAt: string, persistent = true): string {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (persistent) parts.push(`Max-Age=${maxAge}`);
  // Local HTTP (Vite/Express) — Secure would drop the cookie on http://127.0.0.1
  if (cookieSecureEnabled()) parts.push('Secure');
  return parts.join('; ');
}

export function cookieSecure(): boolean {
  return cookieSecureEnabled();
}

export function clearSessionCookieHeader(): string {
  const parts = [`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`];
  if (cookieSecureEnabled()) parts[0] += '; Secure';
  return parts.join('');
}

export async function countUsers(): Promise<number> {
  const db = await getDb();
  const row = queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM users`);
  return Number(row?.c ?? 0);
}

export async function getUserByEmail(email: string): Promise<{
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
} | null> {
  const db = await getDb();
  const row = queryOne<{
    id: string;
    email: string;
    password_hash: string;
    created_at: string;
  }>(db, `SELECT id, email, password_hash, created_at FROM users WHERE email = ?`, [email]);
  return row;
}

/** Remove every session for a user (all devices / cookies). */
export function destroySessionsForUser(database: Database, userId: string): number {
  const before = queryOne<{ c: number }>(
    database,
    `SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?`,
    [userId],
  );
  run(database, `DELETE FROM sessions WHERE user_id = ?`, [userId]);
  return Number(before?.c ?? 0);
}
