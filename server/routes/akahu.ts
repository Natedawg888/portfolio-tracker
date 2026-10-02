/**
 * Akahu sync + OAuth Connect endpoints - secrets stay server-side.
 */
import { Router } from 'express';
import type { Response } from 'express';
import { getDb } from '../db/index.ts';
import { getAkahuAppCredentials } from '../akahu/loadEnv.ts';
import { syncAkahuPortfolio } from '../akahu/sync.ts';
import {
  syncBankTransactionsFromAkahu,
  TXN_SYNC_FROM_DATE,
} from '../akahu/syncTransactions.ts';
import {
  akahuGetAccounts,
  institutionsFromAccounts,
  runWithAkahuCreds,
} from '../akahu/client.ts';
import {
  buildAuthorizeUrl,
  consumeOAuthState,
  createOAuthState,
  exchangeAuthorizationCode,
  revokeUserAccessToken,
} from '../akahu/oauth.ts';
import {
  deleteConnection,
  getConnectionForUser,
  parseInstitutions,
  resolveAkahuUserToken,
  updateInstitutions,
  upsertConnection,
  type AkahuInstitution,
} from '../akahu/connections.ts';
import type { AuthedRequest } from '../middleware/requireAuth.ts';

const router = Router();

function safeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}

function redirectFrontend(res: Response, pathAndQuery: string) {
  const { frontendUrl } = getAkahuAppCredentials();
  const base = frontendUrl.replace(/\/$/, '');
  const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  res.redirect(302, `${base}${path}`);
}

async function withUserAkahuCreds<T>(
  userId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const resolved = await resolveAkahuUserToken(userId);
  if (!resolved) {
    throw new Error(
      'Akahu not configured. Set AKAHU_APP_ID + AKAHU_USER_TOKEN, or Connect accounts via OAuth (needs APP_SECRET).',
    );
  }
  return runWithAkahuCreds(
    { appId: resolved.appId, userToken: resolved.userToken },
    fn,
  ) as Promise<T>;
}

async function refreshInstitutionCache(userId: string): Promise<AkahuInstitution[]> {
  const accounts = await withUserAkahuCreds(userId, () => akahuGetAccounts());
  const institutions = institutionsFromAccounts(accounts);
  const oauthConn = await getConnectionForUser(userId);
  if (oauthConn) {
    await updateInstitutions(userId, institutions, true);
  }
  return institutions;
}

router.get('/status', async (req: AuthedRequest, res) => {
  const app = getAkahuAppCredentials();
  const userId = req.user?.id;
  const oauthConn = userId ? await getConnectionForUser(userId) : null;
  const resolved = userId ? await resolveAkahuUserToken(userId) : null;

  let institutions: AkahuInstitution[] = [];
  if (oauthConn) {
    institutions = parseInstitutions(oauthConn.institutionsJson);
  }

  const connected = Boolean(oauthConn) || resolved?.source === 'env';
  // Personal App shared token exists in .env but must NOT appear as "connected"
  // for non-owners — they need Full App OAuth or stay empty.
  const sharedTokenForOwnerOnly =
    app.sharedTokenConfigured && !app.oauthReady && resolved?.source !== 'env' && !oauthConn;

  res.json({
    configured: Boolean(resolved) || app.oauthReady || (app.sharedTokenConfigured && resolved?.source === 'env'),
    /** True when this user can sync right now (own OAuth or owner+env). */
    canSync: Boolean(resolved),
    provider: 'akahu',
    baseUrl: 'https://api.akahu.io/v1',
    mode: app.mode,
    oauthReady: app.oauthReady,
    sharedTokenConfigured: app.sharedTokenConfigured,
    /** Env token is only usable by the first/data-owner user. */
    sharedTokenOwnerOnly: Boolean(app.sharedTokenConfigured && !app.oauthReady),
    needsOwnOAuth: Boolean(sharedTokenForOwnerOnly || (!resolved && app.oauthReady)),
    /** How this logged-in user will authenticate to Akahu */
    tokenSource: resolved?.source ?? null,
    connected,
    oauthConnected: Boolean(oauthConn),
    connectedAt: oauthConn?.connectedAt ?? null,
    lastSyncAt: oauthConn?.lastSyncAt ?? null,
    institutions,
    /**
     * Honest multi-user note for the UI.
     * Personal App shared env token = data owner only.
     * Full App OAuth = each local user connects their own Akahu.
     * Non-owners without OAuth stay empty (no Nathan dump).
     */
    multiUser: app.oauthReady
      ? 'per_user_oauth'
      : app.sharedTokenConfigured
        ? 'shared_env_token_owner_only'
        : 'none',
  });
});

/** Start OAuth: returns authorizeUrl (JSON) so the SPA can navigate. */
router.post('/connect', async (req: AuthedRequest, res) => {
  const app = getAkahuAppCredentials();
  if (!app.oauthReady) {
    return res.status(503).json({
      ok: false,
      error:
        'Akahu OAuth Connect requires a Full App: set AKAHU_APP_ID, AKAHU_APP_SECRET, and AKAHU_REDIRECT_URI. Personal Apps use a shared AKAHU_USER_TOKEN in .env instead (no per-user OAuth).',
      mode: app.mode,
      oauthReady: false,
    });
  }
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
  }
  try {
    const state = createOAuthState(req.user.id);
    const authorizeUrl = buildAuthorizeUrl({
      state,
      email: req.user.email,
      scope: 'ENDURING_CONSENT',
    });
    res.json({ ok: true, authorizeUrl });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeError(err) });
  }
});

/**
 * OAuth redirect target (must be registered on the Akahu app).
 * Public path - validated via `state` (bound to user id at connect time).
 */
router.get('/callback', async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const error = q.error;
  const code = q.code;
  const state = q.state;
  const event = q.event;

  if (error) {
    const desc = q.error_description || error;
    return redirectFrontend(
      res,
      `/settings?akahu=error&message=${encodeURIComponent(desc)}`,
    );
  }

  if (event === 'REVOKE') {
    // User revoked in Akahu UI during flow - clear local token if we can map state
    if (state) {
      const userId = consumeOAuthState(state);
      if (userId) await deleteConnection(userId);
    }
    return redirectFrontend(res, '/settings?akahu=revoked');
  }

  if (!code || !state) {
    return redirectFrontend(
      res,
      `/settings?akahu=error&message=${encodeURIComponent('Missing code or state from Akahu')}`,
    );
  }

  const userId = consumeOAuthState(state);
  if (!userId) {
    return redirectFrontend(
      res,
      `/settings?akahu=error&message=${encodeURIComponent('Invalid or expired OAuth state - try Connect again')}`,
    );
  }

  try {
    const token = await exchangeAuthorizationCode(code);
    await upsertConnection({
      userId,
      accessToken: token.accessToken,
      scope: token.scope,
    });

    // Best-effort: cache institutions + pull portfolio/txns
    try {
      await refreshInstitutionCache(userId);
      const db = await getDb();
      await withUserAkahuCreds(userId, async () => {
        await syncAkahuPortfolio(db, userId);
        await syncBankTransactionsFromAkahu(db, TXN_SYNC_FROM_DATE, userId);
      });
    } catch {
      // Connection saved; sync can be retried from UI
    }

    return redirectFrontend(res, '/settings?akahu=connected');
  } catch (err) {
    return redirectFrontend(
      res,
      `/settings?akahu=error&message=${encodeURIComponent(safeError(err))}`,
    );
  }
});

/** List institutions (fresh from Akahu when possible). */
router.get('/institutions', async (req: AuthedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
  }
  const resolved = await resolveAkahuUserToken(req.user.id);
  if (!resolved) {
    return res.status(503).json({
      ok: false,
      error: 'Akahu not configured for this user',
      institutions: [],
    });
  }
  try {
    const institutions = await refreshInstitutionCache(req.user.id);
    res.json({ ok: true, institutions, tokenSource: resolved.source });
  } catch (err) {
    // Fall back to cache
    const conn = await getConnectionForUser(req.user.id);
    const cached = parseInstitutions(conn?.institutionsJson ?? null);
    res.status(502).json({
      ok: false,
      error: safeError(err),
      institutions: cached,
      tokenSource: resolved.source,
    });
  }
});

/** Disconnect: revoke OAuth token (if any) and drop local row. Shared env token is never revoked. */
router.post('/disconnect', async (req: AuthedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
  }
  const conn = await getConnectionForUser(req.user.id);
  if (!conn) {
    return res.json({
      ok: true,
      disconnected: false,
      message:
        'No per-user OAuth connection stored. Shared Personal App token (AKAHU_USER_TOKEN) stays in .env - remove it there to disconnect the household feed.',
    });
  }
  const revoke = await revokeUserAccessToken(conn.accessToken);
  await deleteConnection(req.user.id);
  res.json({
    ok: true,
    disconnected: true,
    revokedAtAkahu: revoke.ok,
    revokeError: revoke.error,
  });
});

router.post('/sync', async (req: AuthedRequest, res) => {
  const userId = req.user?.id;
  const resolved = await resolveAkahuUserToken(userId);
  if (!resolved) {
    return res.status(503).json({
      ok: false,
      error:
        'Akahu not configured. Set AKAHU_APP_ID and AKAHU_USER_TOKEN (env), or Connect accounts via OAuth.',
    });
  }
  try {
    const db = await getDb();
    const result = await withUserAkahuCreds(userId, () => {
      if (!userId) throw new Error('Authentication required for Akahu sync');
      return syncAkahuPortfolio(db, userId);
    });
    if (userId && resolved.source === 'oauth') {
      try {
        await refreshInstitutionCache(userId);
      } catch {
        /* non-fatal */
      }
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ ok: false, error: safeError(err) });
  }
});

/** Sync settled bank transactions from Akahu (default since 2026-10-01 NZ). */
router.post('/sync-transactions', async (req: AuthedRequest, res) => {
  const userId = req.user?.id;
  const resolved = await resolveAkahuUserToken(userId);
  if (!resolved) {
    return res.status(503).json({
      ok: false,
      error:
        'Akahu not configured. Set AKAHU_APP_ID and AKAHU_USER_TOKEN (env), or Connect accounts via OAuth.',
    });
  }
  const since =
    typeof req.body?.sinceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.sinceDate)
      ? req.body.sinceDate
      : TXN_SYNC_FROM_DATE;
  try {
    const db = await getDb();
    const result = await withUserAkahuCreds(userId, () => {
      if (!userId) throw new Error('Authentication required for Akahu sync');
      return syncBankTransactionsFromAkahu(db, since, userId);
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({ ok: false, error: safeError(err), sinceDate: since });
  }
});

export default router;
