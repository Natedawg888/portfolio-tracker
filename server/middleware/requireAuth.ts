/**
 * Attach req.user from session cookie; optionally reject unauthenticated requests.
 */
import type { Request, Response, NextFunction } from 'express';
import {
  SESSION_COOKIE,
  findUserBySessionToken,
  parseCookieHeader,
  type AuthUser,
} from '../auth/sessions.ts';

export type AuthedRequest = Request & { user?: AuthUser | null };

export async function attachUser(req: AuthedRequest, _res: Response, next: NextFunction) {
  try {
    const raw = parseCookieHeader(req.headers.cookie, SESSION_COOKIE);
    req.user = await findUserBySessionToken(raw);
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  next();
}

/** Paths that stay public (no finance data). */
export function isPublicApiPath(path: string): boolean {
  if (path === '/health') return true;
  if (path.startsWith('/auth/')) return true;
  // Akahu OAuth redirect — validated via signed/ephemeral `state`, not session cookie.
  if (path === '/akahu/callback') return true;
  // Invoice share links (KAN-71) — the unguessable token is the credential.
  if (path.startsWith('/public/invoices/')) return true;
  // Side ad config (KAN-72): no user data either way.
  if (path === '/ads/config') return true;
  return false;
}
