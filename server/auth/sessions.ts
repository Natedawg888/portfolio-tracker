/**
 * DB-backed sessions. Cookie holds raw token; DB stores SHA-256 hash only.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Database } from 'sql.js';
import { getDb, queryOne, run, newId } from '../db/index.ts';

export const SESSION_COOKIE = 'pt_sid';
/** 30 days */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthUser = {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(userId: string): Promise<{ rawToken: string; expiresAt: string }> {
  const db = await getDb();
  const rawToken = createSessionToken();
  const tokenHash = hashToken(rawToken);
  const id = newId('sess');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  run(
    db,
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, userId, tokenHash, expiresAt, now.toISOString()],
  );
  return { rawToken, expiresAt };
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
  }>(
    db,
    `SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.email,
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
  return {
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

export function sessionCookieHeader(rawToken: string, expiresAt: string): string {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  // Local HTTP (Vite/Express) — Secure would drop the cookie on http://127.0.0.1
  if (cookieSecureEnabled()) parts.push('Secure');
  return parts.join('; ');
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
