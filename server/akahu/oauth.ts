/**
 * Akahu Full App OAuth2 helpers (authorization-code flow).
 * Not used by Personal Apps - those paste a user token into .env instead.
 * Docs: https://developers.akahu.nz/docs/authorizing-with-oauth2
 */
import crypto from 'node:crypto';
import { getAkahuAppCredentials } from './loadEnv.ts';

const OAUTH_AUTHORIZE = 'https://oauth.akahu.nz';
const API_BASE = 'https://api.akahu.io/v1';

type PendingState = {
  userId: string;
  createdAt: number;
};

/** In-memory CSRF state (single-process local API). TTL 15 minutes. */
const pendingStates = new Map<string, PendingState>();
const STATE_TTL_MS = 15 * 60 * 1000;

function pruneStates() {
  const now = Date.now();
  for (const [k, v] of pendingStates) {
    if (now - v.createdAt > STATE_TTL_MS) pendingStates.delete(k);
  }
}

export function createOAuthState(userId: string): string {
  pruneStates();
  const state = crypto.randomBytes(24).toString('hex');
  pendingStates.set(state, { userId, createdAt: Date.now() });
  return state;
}

export function consumeOAuthState(state: string): string | null {
  pruneStates();
  const row = pendingStates.get(state);
  if (!row) return null;
  pendingStates.delete(state);
  if (Date.now() - row.createdAt > STATE_TTL_MS) return null;
  return row.userId;
}

export function buildAuthorizeUrl(opts: {
  state: string;
  email?: string | null;
  scope?: string;
}): string {
  const { appId, redirectUri, oauthReady } = getAkahuAppCredentials();
  if (!oauthReady || !appId || !redirectUri) {
    throw new Error(
      'Akahu OAuth not configured. Set AKAHU_APP_ID, AKAHU_APP_SECRET, and AKAHU_REDIRECT_URI (Full App).',
    );
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: appId,
    redirect_uri: redirectUri,
    scope: opts.scope ?? 'ENDURING_CONSENT',
    state: opts.state,
  });
  if (opts.email) params.set('login_hint', opts.email);
  return `${OAUTH_AUTHORIZE}?${params.toString()}`;
}

export type TokenExchangeResult = {
  accessToken: string;
  scope: string | null;
};

export async function exchangeAuthorizationCode(code: string): Promise<TokenExchangeResult> {
  const { appId, appSecret, redirectUri, oauthReady } = getAkahuAppCredentials();
  if (!oauthReady || !appId || !appSecret || !redirectUri) {
    throw new Error('Akahu OAuth not configured (need APP_ID, APP_SECRET, REDIRECT_URI)');
  }
  const res = await fetch(`${API_BASE}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: appId,
      client_secret: appSecret,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
    message?: string;
  };
  if (!res.ok || !body.access_token) {
    const detail =
      body.error_description || body.error || body.message || res.statusText || `HTTP ${res.status}`;
    throw new Error(`Akahu token exchange failed: ${detail}`);
  }
  return {
    accessToken: body.access_token,
    scope: body.scope ?? null,
  };
}

/** Revoke a user access token (Full App / OAuth). Safe no-op errors are returned, not thrown. */
export async function revokeUserAccessToken(userToken: string): Promise<{ ok: boolean; error?: string }> {
  const { appId } = getAkahuAppCredentials();
  if (!appId) return { ok: false, error: 'Missing AKAHU_APP_ID' };
  const res = await fetch(`${API_BASE}/token`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${userToken}`,
      'X-Akahu-Id': appId,
      Accept: 'application/json',
    },
  });
  if (res.ok || res.status === 401) {
    // 401 = already revoked
    return { ok: true };
  }
  const text = await res.text().catch(() => '');
  return { ok: false, error: `Akahu revoke ${res.status}: ${text.slice(0, 160)}` };
}
