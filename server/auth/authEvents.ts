/**
 * Sign-in audit log (KAN-75): one row per new session and per passkey change, with the
 * coarse device label ("Chrome on Windows"). No IP addresses. Every query is per user.
 *
 * Each sign-in also keeps which provider (Google / Apple / Microsoft) or passkey it used and
 * the session it opened, so Settings → Security can name them and say whether that browser
 * is still signed in. A sign-in from a device label the log hasn't seen before is "new";
 * the user can mark it reviewed ("Yes, it was me").
 */
import type { Database } from 'sql.js';
import { newId, queryAll, run } from '../db/index.ts';

export type AuthEventKind = 'sign_in' | 'passkey_added' | 'passkey_removed';
export type SignInMethod = 'password' | 'two_factor' | 'passkey' | 'sso' | 'register';

export type AuthEventInfo = {
  id: string;
  kind: AuthEventKind;
  method: string | null;
  /** google / apple / microsoft for single sign-on (also before a two-factor code); null otherwise or for older events. */
  provider: string | null;
  /** The passkey's current name (null when not a passkey sign-in, or the passkey was removed). */
  passkeyName: string | null;
  deviceLabel: string | null;
  createdAt: string;
  /** The session this sign-in opened is still live. */
  signedIn: boolean;
  /** …and it is the session making this request. */
  current: boolean;
  /** A sign-in from a device the log had not seen before. */
  newDevice: boolean;
  /** The user said it was them (or secured the account after it). */
  reviewed: boolean;
};

/** Events older than this are dropped when new ones are written. */
const KEEP_DAYS = 180;
/** "Was this you?" asks about new-device sign-ins this recent. */
export const REVIEW_DAYS = 14;

export function recordAuthEvent(
  db: Database,
  userId: string,
  kind: AuthEventKind,
  opts: { method?: string | null; deviceLabel?: string | null; provider?: string | null; passkeyId?: string | null; sessionId?: string | null } = {},
): void {
  const now = new Date();
  run(
    db,
    `INSERT INTO auth_events (id, user_id, kind, method, device_label, created_at, provider, passkey_id, session_id) VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      newId('aev'),
      userId,
      kind,
      opts.method ?? null,
      opts.deviceLabel ?? null,
      now.toISOString(),
      opts.provider ?? null,
      opts.passkeyId ?? null,
      opts.sessionId ?? null,
    ],
  );
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();
  run(db, `DELETE FROM auth_events WHERE user_id = ? AND created_at < ?`, [userId, cutoff]);
}

type Row = {
  id: string;
  kind: AuthEventKind;
  method: string | null;
  provider: string | null;
  passkey_name: string | null;
  device_label: string | null;
  created_at: string;
  session_id: string | null;
  signed_in: number;
  new_device: number;
  acknowledged_at: string | null;
};

// A sign-in is "new" when the account had earlier events but none from this device label.
const SELECT = `
  SELECT e.id, e.kind, e.method, e.provider, pk.name AS passkey_name, e.device_label, e.created_at,
         e.session_id, e.acknowledged_at,
         CASE WHEN s.id IS NOT NULL AND s.expires_at > ? THEN 1 ELSE 0 END AS signed_in,
         CASE WHEN e.kind = 'sign_in' AND COALESCE(e.method, '') != 'register'
                AND EXISTS (SELECT 1 FROM auth_events p WHERE p.user_id = e.user_id AND p.created_at < e.created_at)
                AND NOT EXISTS (SELECT 1 FROM auth_events p WHERE p.user_id = e.user_id AND p.created_at < e.created_at
                                AND p.device_label IS e.device_label)
              THEN 1 ELSE 0 END AS new_device
  FROM auth_events e
  LEFT JOIN user_passkeys pk ON pk.id = e.passkey_id AND pk.user_id = e.user_id
  LEFT JOIN sessions s ON s.id = e.session_id AND s.user_id = e.user_id
  WHERE e.user_id = ?`;

function toInfo(r: Row, currentSessionId: string | null | undefined): AuthEventInfo {
  const signedIn = Number(r.signed_in) === 1;
  return {
    id: r.id,
    kind: r.kind,
    method: r.method,
    provider: r.provider ?? null,
    passkeyName: r.passkey_name ?? null,
    deviceLabel: r.device_label,
    createdAt: r.created_at,
    signedIn,
    current: signedIn && Boolean(currentSessionId) && r.session_id === currentSessionId,
    newDevice: Number(r.new_device) === 1,
    reviewed: r.acknowledged_at != null,
  };
}

/** Newest first. */
export function listAuthEvents(db: Database, userId: string, limit = 10, currentSessionId?: string | null): AuthEventInfo[] {
  return queryAll<Row>(db, `${SELECT} ORDER BY e.created_at DESC, e.id DESC LIMIT ?`, [new Date().toISOString(), userId, limit]).map((r) =>
    toInfo(r, currentSessionId),
  );
}

/** Recent new-device sign-ins the user hasn't reviewed, other than this browser's own (newest first, at most 3). */
export function unreviewedNewSignIns(db: Database, userId: string, currentSessionId?: string | null): AuthEventInfo[] {
  const since = new Date(Date.now() - REVIEW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return queryAll<Row>(
    db,
    `${SELECT} AND e.kind = 'sign_in' AND e.acknowledged_at IS NULL AND e.created_at >= ? ORDER BY e.created_at DESC, e.id DESC`,
    [new Date().toISOString(), userId, since],
  )
    .map((r) => toInfo(r, currentSessionId))
    .filter((e) => e.newDevice && !e.current)
    .slice(0, 3);
}

/** "Yes, it was me": mark sign-ins reviewed (all of the user's unreviewed ones when `id` is null). */
export function markSignInsReviewed(db: Database, userId: string, id: string | null): number {
  const where = id ? `user_id = ? AND id = ? AND kind = 'sign_in' AND acknowledged_at IS NULL` : `user_id = ? AND kind = 'sign_in' AND acknowledged_at IS NULL`;
  const params = id ? [userId, id] : [userId];
  const n = queryAll<{ id: string }>(db, `SELECT id FROM auth_events WHERE ${where}`, params).length;
  run(db, `UPDATE auth_events SET acknowledged_at = ? WHERE ${where}`, [new Date().toISOString(), ...params]);
  return n;
}

/**
 * When the user last signed in with their password: a password sign-in, the sign-up, or a
 * two-factor sign-in that started with the password (not with a provider).
 */
export function lastPasswordSignInAt(db: Database, userId: string): string | null {
  const rows = queryAll<{ created_at: string }>(
    db,
    `SELECT created_at FROM auth_events WHERE user_id = ? AND kind = 'sign_in'
       AND (method IN ('password', 'register') OR (method = 'two_factor' AND provider IS NULL))
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  return rows[0]?.created_at ?? null;
}
