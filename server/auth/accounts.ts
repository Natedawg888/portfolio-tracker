/**
 * Account switcher: several accounts signed in on one browser (like Google's chooser).
 *
 * The active account's session stays in `pt_sid`. Other signed-in accounts' session
 * tokens live in `pt_accts` — httpOnly, scoped to /api/auth so only these endpoints ever
 * receive them. Each token is an ordinary session (hashed in `sessions`, revocable from
 * Settings → Security). Switching swaps the two cookies; nothing new is stored.
 */
import type { Request, Response } from 'express';
import type { Database } from 'sql.js';
import { queryOne } from '../db/index.ts';
import {
  SESSION_COOKIE,
  cookieSecure,
  destroySessionByToken,
  parseCookieHeader,
  sessionByToken,
  sessionCookieHeader,
  SESSION_TTL_MS,
  type SessionRef,
} from './sessions.ts';

export const ACCOUNTS_COOKIE = 'pt_accts';
/** Other accounts remembered on one browser (plus the active one). */
export const MAX_OTHER_ACCOUNTS = 4;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

export function otherAccountTokens(req: Request): string[] {
  const raw = parseCookieHeader(req.headers.cookie, ACCOUNTS_COOKIE);
  if (!raw) return [];
  return raw.split('.').filter((t) => TOKEN_RE.test(t)).slice(0, MAX_OTHER_ACCOUNTS);
}

export function accountsCookieHeader(tokens: string[]): string {
  const keep = tokens.slice(0, MAX_OTHER_ACCOUNTS);
  const parts = [
    `${ACCOUNTS_COOKIE}=${keep.join('.')}`,
    'Path=/api/auth',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${keep.length ? Math.floor(SESSION_TTL_MS / 1000) : 0}`,
  ];
  if (cookieSecure()) parts.push('Secure');
  return parts.join('; ');
}

/** Live sessions behind the remembered tokens, dropping dead ones and duplicates of `excludeUserId`. */
function resolveOthers(db: Database, tokens: string[], excludeUserId: string | null): Array<{ token: string; session: SessionRef }> {
  const seen = new Set<string>(excludeUserId ? [excludeUserId] : []);
  const out: Array<{ token: string; session: SessionRef }> = [];
  for (const token of tokens) {
    const session = sessionByToken(db, token);
    if (!session || seen.has(session.userId)) continue;
    seen.add(session.userId);
    out.push({ token, session });
  }
  return out;
}

/**
 * Called when a new session for `userId` starts on this browser. A different account
 * already active here moves into the remembered list; an older session for the same
 * account is ended (one session per account per browser).
 */
export async function rememberPreviousAccount(db: Database, req: Request, res: Response, userId: string): Promise<void> {
  const previous = parseCookieHeader(req.headers.cookie, SESSION_COOKIE);
  const prevSession = sessionByToken(db, previous);
  const tokens = otherAccountTokens(req);
  const candidates = prevSession && prevSession.userId !== userId && previous ? [previous, ...tokens] : tokens;
  if (prevSession && prevSession.userId === userId) await destroySessionByToken(previous);
  for (const t of tokens) {
    if (sessionByToken(db, t)?.userId === userId) await destroySessionByToken(t);
  }
  const keep = resolveOthers(db, candidates, userId).map((o) => o.token);
  if (keep.length || tokens.length) res.append('Set-Cookie', accountsCookieHeader(keep));
}

export type RememberedAccount = {
  userId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  current: boolean;
};

function accountRow(db: Database, userId: string) {
  return queryOne<{ id: string; email: string; first_name: string | null; last_name: string | null; display_name: string | null; avatar_url: string | null }>(
    db,
    `SELECT id, email, first_name, last_name, display_name, avatar_url FROM users WHERE id = ?`,
    [userId],
  );
}

function toAccount(db: Database, userId: string, current: boolean): RememberedAccount | null {
  const r = accountRow(db, userId);
  if (!r) return null;
  const composed = [r.first_name, r.last_name].map((p) => (p ?? '').trim()).filter(Boolean).join(' ');
  return {
    userId: r.id,
    email: r.email,
    displayName: composed || r.display_name?.trim() || null,
    // Uploaded avatars are relative paths; the menu falls back to initials for those.
    avatarUrl: r.avatar_url && /^(data:|https?:|\/api\/)/.test(r.avatar_url) ? r.avatar_url : null,
    current,
  };
}

/** Accounts signed in on this browser, active first; rewrites the cookie if any died. */
export function listAccounts(db: Database, req: Request, res: Response, activeUserId: string | null): RememberedAccount[] {
  const tokens = otherAccountTokens(req);
  const others = resolveOthers(db, tokens, activeUserId);
  if (others.length !== tokens.length) res.append('Set-Cookie', accountsCookieHeader(others.map((o) => o.token)));
  const list: RememberedAccount[] = [];
  if (activeUserId) {
    const a = toAccount(db, activeUserId, true);
    if (a) list.push(a);
  }
  for (const o of others) {
    const a = toAccount(db, o.session.userId, false);
    if (a) list.push(a);
  }
  return list;
}

/**
 * Make `targetUserId` active: its remembered token becomes pt_sid and the current
 * active token (if any) goes back into the list. Null when that account isn't here.
 */
export function switchAccount(db: Database, req: Request, res: Response, targetUserId: string): SessionRef | null {
  const active = parseCookieHeader(req.headers.cookie, SESSION_COOKIE);
  const activeSession = sessionByToken(db, active);
  const others = resolveOthers(db, otherAccountTokens(req), activeSession?.userId ?? null);
  const target = others.find((o) => o.session.userId === targetUserId);
  if (!target) return null;
  const rest = others.filter((o) => o !== target).map((o) => o.token);
  const nextList = activeSession && active ? [active, ...rest] : rest;
  res.append('Set-Cookie', sessionCookieHeader(target.token, target.session.expiresAt, target.session.persistent));
  res.append('Set-Cookie', accountsCookieHeader(nextList));
  return target.session;
}

/**
 * After signing the active account out: promote the next remembered account, if any.
 * Returns its user id, or null (then the caller clears pt_sid).
 */
export function promoteNextAccount(db: Database, req: Request, res: Response): string | null {
  const others = resolveOthers(db, otherAccountTokens(req), null);
  const next = others[0];
  if (!next) {
    if (otherAccountTokens(req).length) res.append('Set-Cookie', accountsCookieHeader([]));
    return null;
  }
  res.append('Set-Cookie', sessionCookieHeader(next.token, next.session.expiresAt, next.session.persistent));
  res.append('Set-Cookie', accountsCookieHeader(others.slice(1).map((o) => o.token)));
  return next.session.userId;
}

/** Every session this browser holds (active + remembered), for "sign out of all accounts". */
export function allBrowserTokens(req: Request): string[] {
  const active = parseCookieHeader(req.headers.cookie, SESSION_COOKIE);
  return [...(active ? [active] : []), ...otherAccountTokens(req)];
}
