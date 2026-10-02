/**
 * Optional .env loader for workstation. Box uses process.env directly.
 * Never logs secret values.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let loaded = false;

export function loadDotEnv(fileName = '.env', opts?: { force?: boolean }): void {
  if (loaded && !opts?.force) return;
  if (!opts?.force) loaded = true;
  const envPath = path.join(ROOT, fileName);
  if (!fs.existsSync(envPath)) {
    if (!opts?.force) loaded = true;
    return;
  }
  if (opts?.force) loaded = true;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export type AkahuAppMode = 'none' | 'personal' | 'oauth';

export type AkahuAppCredentials = {
  /** App can call Akahu somehow (shared personal token and/or OAuth-ready full app). */
  configured: boolean;
  appId: string | null;
  /** Shared Personal App user token from .env (single-household fallback). */
  userToken: string | null;
  /** Full-app secret - required for OAuth code exchange (never expose to browser). */
  appSecret: string | null;
  /** Must match a Redirect URI registered on the Akahu app. */
  redirectUri: string | null;
  /** Where to send the browser after OAuth callback (Settings). */
  frontendUrl: string;
  /**
   * - personal: APP_ID + USER_TOKEN only (no multi-user OAuth)
   * - oauth: APP_ID + APP_SECRET + REDIRECT_URI (per-user Connect flow)
   * - none: missing required pieces
   */
  mode: AkahuAppMode;
  /** True when Full App OAuth connect is possible. */
  oauthReady: boolean;
  /** True when a shared env user token exists (Personal App path). */
  sharedTokenConfigured: boolean;
};

export function getAkahuAppCredentials(): AkahuAppCredentials {
  loadDotEnv();
  const appId = process.env.AKAHU_APP_ID?.trim() || null;
  const userToken = process.env.AKAHU_USER_TOKEN?.trim() || null;
  const appSecret = process.env.AKAHU_APP_SECRET?.trim() || null;
  const redirectUri =
    process.env.AKAHU_REDIRECT_URI?.trim() ||
    // Sensible local default (Vite proxies /api → :8787)
    'http://127.0.0.1:3000/api/akahu/callback';
  const frontendUrl =
    process.env.AKAHU_FRONTEND_URL?.trim() || 'http://127.0.0.1:3000';

  const sharedTokenConfigured = Boolean(appId && userToken);
  const oauthReady = Boolean(appId && appSecret && redirectUri);
  let mode: AkahuAppMode = 'none';
  if (oauthReady) mode = 'oauth';
  else if (sharedTokenConfigured) mode = 'personal';

  return {
    configured: sharedTokenConfigured || oauthReady,
    appId,
    userToken,
    appSecret,
    redirectUri,
    frontendUrl,
    mode,
    oauthReady,
    sharedTokenConfigured,
  };
}

/** @deprecated Prefer getAkahuAppCredentials + resolveAkahuUserToken */
export function getAkahuCredentials(): {
  configured: boolean;
  appId: string | null;
  userToken: string | null;
} {
  const c = getAkahuAppCredentials();
  return {
    configured: c.sharedTokenConfigured,
    appId: c.appId,
    userToken: c.userToken,
  };
}
