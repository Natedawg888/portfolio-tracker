/**
 * Per-user Akahu OAuth tokens + cached institution list (server-side only).
 */
import type { Database } from 'sql.js';
import { getDb, persist, queryOne, run, newId } from '../db/index.ts';
import { getAkahuAppCredentials } from './loadEnv.ts';
import { getDataOwnerUserIdAsync } from '../lib/userScope.ts';

export type AkahuInstitution = {
  connectionId: string;
  name: string;
  logo?: string | null;
  accountCount: number;
  types: string[];
};

export type AkahuConnectionRow = {
  id: string;
  userId: string;
  accessToken: string;
  scope: string | null;
  institutionsJson: string | null;
  connectedAt: string;
  updatedAt: string;
  lastSyncAt: string | null;
};

export function ensureAkahuConnectionsTable(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS akahu_connections (
      id                 TEXT PRIMARY KEY,
      user_id            TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      access_token       TEXT NOT NULL,
      scope              TEXT,
      institutions_json  TEXT,
      connected_at       TEXT NOT NULL,
      updated_at         TEXT NOT NULL,
      last_sync_at       TEXT
    )
  `);
  database.run(
    `CREATE INDEX IF NOT EXISTS idx_akahu_connections_user ON akahu_connections(user_id)`,
  );
}

function rowFromDb(r: Record<string, unknown>): AkahuConnectionRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    accessToken: String(r.access_token),
    scope: r.scope != null ? String(r.scope) : null,
    institutionsJson: r.institutions_json != null ? String(r.institutions_json) : null,
    connectedAt: String(r.connected_at),
    updatedAt: String(r.updated_at),
    lastSyncAt: r.last_sync_at != null ? String(r.last_sync_at) : null,
  };
}

export async function getConnectionForUser(userId: string): Promise<AkahuConnectionRow | null> {
  const db = await getDb();
  ensureAkahuConnectionsTable(db);
  const r = queryOne(
    db,
    `SELECT id, user_id, access_token, scope, institutions_json, connected_at, updated_at, last_sync_at
     FROM akahu_connections WHERE user_id = ?`,
    [userId],
  );
  return r ? rowFromDb(r) : null;
}

export async function upsertConnection(opts: {
  userId: string;
  accessToken: string;
  scope?: string | null;
  institutions?: AkahuInstitution[];
}): Promise<AkahuConnectionRow> {
  const db = await getDb();
  ensureAkahuConnectionsTable(db);
  const now = new Date().toISOString();
  const existing = await getConnectionForUser(opts.userId);
  const institutionsJson =
    opts.institutions != null ? JSON.stringify(opts.institutions) : (existing?.institutionsJson ?? null);
  if (existing) {
    run(
      db,
      `UPDATE akahu_connections
       SET access_token = ?, scope = ?, institutions_json = ?, updated_at = ?
       WHERE user_id = ?`,
      [
        opts.accessToken,
        opts.scope ?? existing.scope,
        institutionsJson,
        now,
        opts.userId,
      ],
    );
  } else {
    run(
      db,
      `INSERT INTO akahu_connections
         (id, user_id, access_token, scope, institutions_json, connected_at, updated_at, last_sync_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        newId('akahu'),
        opts.userId,
        opts.accessToken,
        opts.scope ?? null,
        institutionsJson,
        now,
        now,
      ],
    );
  }
  persist();
  const row = await getConnectionForUser(opts.userId);
  if (!row) throw new Error('Failed to persist Akahu connection');
  return row;
}

export async function updateInstitutions(
  userId: string,
  institutions: AkahuInstitution[],
  markSynced = true,
): Promise<void> {
  const db = await getDb();
  ensureAkahuConnectionsTable(db);
  const now = new Date().toISOString();
  run(
    db,
    `UPDATE akahu_connections
     SET institutions_json = ?, updated_at = ?, last_sync_at = CASE WHEN ? THEN ? ELSE last_sync_at END
     WHERE user_id = ?`,
    [JSON.stringify(institutions), now, markSynced ? 1 : 0, now, userId],
  );
  persist();
}

export async function deleteConnection(userId: string): Promise<boolean> {
  const db = await getDb();
  ensureAkahuConnectionsTable(db);
  const existing = await getConnectionForUser(userId);
  if (!existing) return false;
  run(db, `DELETE FROM akahu_connections WHERE user_id = ?`, [userId]);
  persist();
  return true;
}

export function parseInstitutions(json: string | null): AkahuInstitution[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is AkahuInstitution =>
        Boolean(x) &&
        typeof x === 'object' &&
        typeof (x as AkahuInstitution).connectionId === 'string' &&
        typeof (x as AkahuInstitution).name === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * Resolve which user access token to use for Akahu API calls.
 * Prefer per-user OAuth token.
 * Shared Personal App env token (AKAHU_USER_TOKEN) is ONLY for the data owner
 * (first user) — never dump Nathan's Akahu accounts into later users' ledgers.
 */
export async function resolveAkahuUserToken(userId?: string | null): Promise<{
  appId: string;
  userToken: string;
  source: 'oauth' | 'env';
} | null> {
  const app = getAkahuAppCredentials();
  if (!app.appId) return null;

  if (userId) {
    const conn = await getConnectionForUser(userId);
    if (conn?.accessToken) {
      return { appId: app.appId, userToken: conn.accessToken, source: 'oauth' };
    }
  }

  // Shared env token: only the household data owner may use it.
  if (app.userToken && userId) {
    const ownerId = await getDataOwnerUserIdAsync();
    if (ownerId && ownerId === userId) {
      return { appId: app.appId, userToken: app.userToken, source: 'env' };
    }
    // Non-owner without OAuth: empty until they Connect (Full App) or remain empty.
    return null;
  }

  // No userId context (should be rare) — do not expose shared token.
  return null;
}
