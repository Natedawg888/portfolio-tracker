/**
 * Single sign-on with Google, Microsoft and Apple (OpenID Connect, authorization-code flow).
 *
 * A provider appears only when its env vars are set (see docs/AUTH.md):
 *   Google     GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   Microsoft  MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT (default common)
 *   Apple      APPLE_CLIENT_ID (Services ID), APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (.p8 PEM)
 * Redirect URI registered with each provider: ${PUBLIC_URL}/api/auth/sso/<provider>/callback
 * (PUBLIC_URL defaults to http://127.0.0.1:3000 for local dev).
 *
 * Protections: `state` (CSRF) + `nonce` (token replay) + PKCE for Google/Microsoft, all
 * kept in a short-lived sealed httpOnly cookie bound to this browser. ID tokens are
 * verified against the provider's published keys (jwt.ts): signature, issuer, audience,
 * expiry, nonce. Client secrets never reach the browser.
 */
import { createHash, randomBytes } from 'node:crypto';
import { openSecret, sealSecret } from './secretBox.ts';
import { cookieSecure } from './sessions.ts';
import { signEs256, verifyIdToken, type JwtPayload, type JwksFetcher } from './jwt.ts';

export type SsoProviderId = 'google' | 'microsoft' | 'apple';
export const SSO_PROVIDERS: readonly SsoProviderId[] = ['google', 'apple', 'microsoft'];

export const SSO_STATE_COOKIE = 'pt_sso';
const STATE_TTL_MS = 10 * 60 * 1000;
/** Microsoft's tenant id for personal accounts (outlook.com, hotmail.com, live.com). */
const MS_CONSUMERS_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

type Endpoints = { authorizeUrl: string; tokenUrl: string; jwksUrl: string };

type ProviderDef = {
  label: string;
  configured: () => boolean;
  clientId: () => string;
  clientSecret: () => string;
  endpoints: () => Endpoints;
  issuer: string | ((p: JwtPayload) => boolean);
  scope: string;
  pkce: boolean;
  extraAuthParams: Record<string, string>;
  /** Only verified emails may link to an existing account. */
  emailVerified: (p: JwtPayload) => boolean;
  email: (p: JwtPayload) => string | null;
};

const env = (k: string) => process.env[k]?.trim() || '';
const truthy = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';
const msTenant = () => env('MICROSOFT_TENANT') || 'common';

const overrides = new Map<SsoProviderId, Partial<Endpoints> & { issuer?: string }>();

const PROVIDERS: Record<SsoProviderId, ProviderDef> = {
  google: {
    label: 'Google',
    configured: () => Boolean(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')),
    clientId: () => env('GOOGLE_CLIENT_ID'),
    clientSecret: () => env('GOOGLE_CLIENT_SECRET'),
    endpoints: () => ({
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    }),
    issuer: (p) => p.iss === 'https://accounts.google.com' || p.iss === 'accounts.google.com',
    scope: 'openid email profile',
    pkce: true,
    extraAuthParams: { prompt: 'select_account' },
    emailVerified: (p) => truthy(p.email_verified),
    email: (p) => (typeof p.email === 'string' ? p.email : null),
  },
  microsoft: {
    label: 'Microsoft',
    configured: () => Boolean(env('MICROSOFT_CLIENT_ID') && env('MICROSOFT_CLIENT_SECRET')),
    clientId: () => env('MICROSOFT_CLIENT_ID'),
    clientSecret: () => env('MICROSOFT_CLIENT_SECRET'),
    endpoints: () => {
      const t = encodeURIComponent(msTenant());
      return {
        authorizeUrl: `https://login.microsoftonline.com/${t}/oauth2/v2.0/authorize`,
        tokenUrl: `https://login.microsoftonline.com/${t}/oauth2/v2.0/token`,
        jwksUrl: `https://login.microsoftonline.com/${t}/discovery/v2.0/keys`,
      };
    },
    // Multi-tenant: the issuer names the user's tenant; pin it when a single tenant is configured.
    issuer: (p) => {
      const tid = typeof p.tid === 'string' ? p.tid : '';
      const t = msTenant();
      const pinned = !['common', 'organizations', 'consumers'].includes(t);
      return Boolean(tid) && p.iss === `https://login.microsoftonline.com/${tid}/v2.0` && (!pinned || tid === t);
    },
    scope: 'openid email profile',
    pkce: true,
    extraAuthParams: { prompt: 'select_account' },
    // Work/school emails can be unverified; trust personal accounts or the xms_edov claim.
    emailVerified: (p) => p.tid === MS_CONSUMERS_TENANT || truthy(p.xms_edov),
    email: (p) => (typeof p.email === 'string' ? p.email : null),
  },
  apple: {
    label: 'Apple',
    configured: () =>
      Boolean(env('APPLE_CLIENT_ID') && env('APPLE_TEAM_ID') && env('APPLE_KEY_ID') && env('APPLE_PRIVATE_KEY')),
    clientId: () => env('APPLE_CLIENT_ID'),
    // Apple's client secret is a short-lived ES256 JWT signed with the .p8 key.
    clientSecret: () => {
      const now = Math.floor(Date.now() / 1000);
      return signEs256(
        { kid: env('APPLE_KEY_ID') },
        { iss: env('APPLE_TEAM_ID'), iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: env('APPLE_CLIENT_ID') },
        env('APPLE_PRIVATE_KEY').replace(/\\n/g, '\n'),
      );
    },
    endpoints: () => ({
      authorizeUrl: 'https://appleid.apple.com/auth/authorize',
      tokenUrl: 'https://appleid.apple.com/auth/token',
      jwksUrl: 'https://appleid.apple.com/auth/keys',
    }),
    issuer: 'https://appleid.apple.com',
    scope: 'name email',
    pkce: false,
    // Asking for name/email requires form_post; routes/sso.ts turns the POST into a GET.
    extraAuthParams: { response_mode: 'form_post' },
    emailVerified: (p) => truthy(p.email_verified),
    email: (p) => (typeof p.email === 'string' ? p.email : null),
  },
};

export function isSsoProviderId(v: unknown): v is SsoProviderId {
  return typeof v === 'string' && (SSO_PROVIDERS as readonly string[]).includes(v);
}

export function ssoLabel(id: SsoProviderId): string {
  return PROVIDERS[id].label;
}

/** Providers with credentials set — the only buttons the UI shows. */
export function configuredSsoProviders(): Array<{ id: SsoProviderId; label: string }> {
  return SSO_PROVIDERS.filter((id) => PROVIDERS[id].configured()).map((id) => ({ id, label: PROVIDERS[id].label }));
}

export function isSsoConfigured(id: SsoProviderId): boolean {
  return PROVIDERS[id].configured();
}

function endpoints(id: SsoProviderId): Endpoints {
  return { ...PROVIDERS[id].endpoints(), ...overrides.get(id) };
}

export function publicBaseUrl(): string {
  return (env('PUBLIC_URL') || 'http://127.0.0.1:3000').replace(/\/+$/, '');
}

export function redirectUri(id: SsoProviderId): string {
  return `${publicBaseUrl()}/api/auth/sso/${id}/callback`;
}

// --- browser-bound flow state -----------------------------------------------------------

/** signin: normal sign-in / sign-up. add: account switcher. link: connect to the signed-in user. */
export type SsoMode = 'signin' | 'add' | 'link';

export type SsoState = {
  provider: SsoProviderId;
  state: string;
  nonce: string;
  verifier: string | null;
  remember: boolean;
  mode: SsoMode;
  linkUserId: string | null;
  issuedAt: number;
};

function stateCookie(value: string, maxAgeSec: number): string {
  const parts = [`${SSO_STATE_COOKIE}=${value}`, 'Path=/api/auth/sso', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (cookieSecure()) parts.push('Secure');
  return parts.join('; ');
}

export function clearSsoStateCookie(): string {
  return stateCookie('', 0);
}

/** Authorization URL to send the browser to, plus the cookie that binds the flow to it. */
export function beginSso(
  id: SsoProviderId,
  opts: { remember: boolean; mode: SsoMode; linkUserId: string | null },
): { url: string; cookie: string } {
  const def = PROVIDERS[id];
  const st: SsoState = {
    provider: id,
    state: randomBytes(24).toString('base64url'),
    nonce: randomBytes(24).toString('base64url'),
    verifier: def.pkce ? randomBytes(48).toString('base64url') : null,
    remember: opts.remember,
    mode: opts.mode,
    linkUserId: opts.linkUserId,
    issuedAt: Date.now(),
  };
  const q = new URLSearchParams({
    client_id: def.clientId(),
    redirect_uri: redirectUri(id),
    response_type: 'code',
    scope: def.scope,
    state: st.state,
    nonce: st.nonce,
    ...def.extraAuthParams,
  });
  if (st.verifier) {
    q.set('code_challenge', createHash('sha256').update(st.verifier).digest('base64url'));
    q.set('code_challenge_method', 'S256');
  }
  return {
    url: `${endpoints(id).authorizeUrl}?${q.toString()}`,
    cookie: stateCookie(encodeURIComponent(sealSecret(JSON.stringify(st))), Math.floor(STATE_TTL_MS / 1000)),
  };
}

export class SsoError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function readState(id: SsoProviderId, cookieValue: string | null, state: unknown): SsoState {
  const raw = cookieValue ? openSecret(decodeURIComponent(cookieValue)) : null;
  if (!raw) throw new SsoError('STATE_MISSING', 'Sign-in session expired. Try again.');
  let st: SsoState;
  try {
    st = JSON.parse(raw) as SsoState;
  } catch {
    throw new SsoError('STATE_MISSING', 'Sign-in session expired. Try again.');
  }
  if (st.provider !== id || typeof state !== 'string' || state !== st.state) {
    throw new SsoError('STATE_MISMATCH', 'Sign-in could not be verified. Try again.');
  }
  if (Date.now() - st.issuedAt > STATE_TTL_MS) throw new SsoError('STATE_MISSING', 'Sign-in took too long. Try again.');
  return st;
}

export type SsoIdentity = {
  provider: SsoProviderId;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
};

type TokenFetch = (url: string, body: URLSearchParams) => Promise<{ id_token?: string; error?: string }>;

const defaultTokenFetch: TokenFetch = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok) return { error: json.error || `HTTP ${res.status}` };
  return json;
};

function nameParts(p: JwtPayload, appleUser: unknown): { firstName: string | null; lastName: string | null } {
  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : null);
  // Apple sends the name once, on first consent, outside the token.
  const au = appleUser as { name?: { firstName?: unknown; lastName?: unknown } } | null;
  if (au?.name) return { firstName: clean(au.name.firstName), lastName: clean(au.name.lastName) };
  const first = clean(p.given_name);
  const last = clean(p.family_name);
  if (first || last) return { firstName: first, lastName: last };
  const full = clean(p.name);
  if (!full) return { firstName: null, lastName: null };
  const [f, ...rest] = full.split(/\s+/);
  return { firstName: f ?? null, lastName: rest.join(' ') || null };
}

/** Finish the provider round trip: check state, swap the code, verify the ID token. */
export async function completeSso(
  id: SsoProviderId,
  input: { code: unknown; state: unknown; error?: unknown; appleUser?: unknown; cookieValue: string | null },
  deps: { tokenFetch?: TokenFetch; jwksFetcher?: JwksFetcher } = {},
): Promise<{ state: SsoState; identity: SsoIdentity }> {
  if (input.error) {
    throw new SsoError(input.error === 'access_denied' || input.error === 'user_cancelled_authorize' ? 'CANCELLED' : 'PROVIDER_ERROR', 'Sign-in was cancelled.');
  }
  const st = readState(id, input.cookieValue, input.state);
  if (typeof input.code !== 'string' || !input.code || input.code.length > 2048) {
    throw new SsoError('PROVIDER_ERROR', 'The sign-in provider did not return a code.');
  }
  const def = PROVIDERS[id];
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: redirectUri(id),
    client_id: def.clientId(),
    client_secret: def.clientSecret(),
  });
  if (st.verifier) body.set('code_verifier', st.verifier);
  const tokens = await (deps.tokenFetch ?? defaultTokenFetch)(endpoints(id).tokenUrl, body);
  if (!tokens.id_token) throw new SsoError('PROVIDER_ERROR', `${def.label} sign-in failed. Try again.`);

  let payload: JwtPayload;
  try {
    const issuerOverride = overrides.get(id)?.issuer;
    payload = await verifyIdToken(tokens.id_token, {
      jwksUrl: endpoints(id).jwksUrl,
      issuer: issuerOverride ?? def.issuer,
      audience: def.clientId(),
      nonce: st.nonce,
      fetcher: deps.jwksFetcher,
    });
  } catch (err) {
    console.warn(`[sso] ${id} id_token rejected: ${err instanceof Error ? err.message : String(err)}`);
    throw new SsoError('TOKEN_INVALID', `${def.label} sign-in could not be verified. Try again.`);
  }
  const email = def.email(payload)?.trim().toLowerCase() || null;
  return {
    state: st,
    identity: {
      provider: id,
      subject: String(payload.sub),
      email,
      emailVerified: Boolean(email) && def.emailVerified(payload),
      ...nameParts(payload, id === 'apple' ? input.appleUser : null),
    },
  };
}

/** Tests only: point a provider at a mock server. */
export function setSsoEndpointsForTest(id: SsoProviderId, o: (Partial<Endpoints> & { issuer?: string }) | null): void {
  if (o) overrides.set(id, o);
  else overrides.delete(id);
}
