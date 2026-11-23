/**
 * Attach req.user from session cookie; optionally reject unauthenticated requests.
 */
import { sessionKeyStore } from '../security/dataKey.ts';
import { encryptPendingForUser, encryptionEnabled, runWithCryptoContext } from '../security/fieldCrypto.ts';
import type { Request, Response, NextFunction } from 'express';
import { destroyOrphanSwitchSession } from '../auth/accountLinks.ts';
import { getDb, run } from '../db/index.ts';
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
    const user = await findUserBySessionToken(raw);
    if (user?.sessionId && (await destroyOrphanSwitchSession(await getDb(), user.sessionId, user.id))) {
      req.user = null;
      next();
      return;
    }
    req.user = user;
    // KAN-112: this request reads and writes with its user's unlocked data key (if any).
    const key = user?.sessionId ? sessionKeyStore.get(user.sessionId, user.id) : null;
    if (user && key && req.method !== 'GET' && req.method !== 'HEAD' && encryptionEnabled()) {
      const userId = user.id;
      _res.on('finish', () => {
        const fresh = sessionKeyStore.forUser(userId);
        if (!fresh) return;
        void getDb()
          .then((db) => encryptPendingForUser(db, userId, fresh, run))
          .catch(() => undefined);
      });
    }
    // A locked session can't change anything while encryption is on: a read-modify-write would
    // save the unreadable (null) values back over the encrypted ones. Unlock first (KAN-117).
    const mutating = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    if (user && !key && mutating && encryptionEnabled() && !req.path.startsWith('/auth/')) {
      _res.status(423).json({ error: 'Unlock your data to make changes.', code: 'DATA_LOCKED' });
      return;
    }
    runWithCryptoContext({ userId: user?.id ?? null, key }, next);
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
