/**
 * Minimal JWT handling for single sign-on, on Node crypto only (no auth library):
 * - verify RS256 ID tokens from Google / Microsoft / Apple against their published JWKS
 * - sign the ES256 client secret Apple requires for its token endpoint
 */
import { createPrivateKey, createPublicKey, sign, verify, type JsonWebKey } from 'node:crypto';

export type JwtPayload = Record<string, unknown> & {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  iat?: number;
  nbf?: number;
  nonce?: string;
};

type Jwks = { keys: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }> };

function b64urlJson(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

const JWKS_TTL_MS = 60 * 60 * 1000;
const jwksCache = new Map<string, { at: number; jwks: Jwks }>();

export type JwksFetcher = (url: string) => Promise<Jwks>;

const defaultFetcher: JwksFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`signing keys request failed (HTTP ${res.status})`);
  const json = (await res.json()) as Jwks;
  if (!json || !Array.isArray(json.keys)) throw new Error('signing keys response has no keys');
  return json;
};

async function jwk(url: string, kid: string, fetcher: JwksFetcher): Promise<JsonWebKey> {
  const cached = jwksCache.get(url);
  const fresh = cached && Date.now() - cached.at < JWKS_TTL_MS;
  let key = fresh ? cached.jwks.keys.find((k) => k.kid === kid) : undefined;
  if (!key) {
    // Unknown kid: the provider may have rotated keys — refetch once.
    const jwks = await fetcher(url);
    jwksCache.set(url, { at: Date.now(), jwks });
    key = jwks.keys.find((k) => k.kid === kid);
  }
  if (!key) throw new Error('token was signed with an unknown key');
  return key;
}

export type VerifyOptions = {
  jwksUrl: string;
  /** Exact issuer, or a function for multi-tenant issuers (Microsoft). */
  issuer: string | ((payload: JwtPayload) => boolean);
  audience: string;
  nonce?: string;
  nowSec?: number;
  fetcher?: JwksFetcher;
};

const CLOCK_SKEW_SEC = 120;

/** Verify signature + standard claims; throws with a short reason on any failure. */
export async function verifyIdToken(token: string, opts: VerifyOptions): Promise<JwtPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const header = b64urlJson(parts[0]);
  if (header.alg !== 'RS256') throw new Error(`unexpected token algorithm ${String(header.alg)}`);
  if (typeof header.kid !== 'string') throw new Error('token has no key id');
  const key = createPublicKey({ key: await jwk(opts.jwksUrl, header.kid, opts.fetcher ?? defaultFetcher), format: 'jwk' });
  const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('token signature is invalid');

  const p = b64urlJson(parts[1]) as JwtPayload;
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const issuerOk = typeof opts.issuer === 'function' ? opts.issuer(p) : p.iss === opts.issuer;
  if (!issuerOk) throw new Error('token issuer is wrong');
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  if (!aud.includes(opts.audience)) throw new Error('token audience is wrong');
  if (typeof p.exp !== 'number' || p.exp + CLOCK_SKEW_SEC < now) throw new Error('token has expired');
  if (typeof p.nbf === 'number' && p.nbf - CLOCK_SKEW_SEC > now) throw new Error('token is not valid yet');
  if (typeof p.iat === 'number' && p.iat - CLOCK_SKEW_SEC > now) throw new Error('token was issued in the future');
  if (opts.nonce !== undefined && p.nonce !== opts.nonce) throw new Error('token nonce does not match');
  if (typeof p.sub !== 'string' || !p.sub) throw new Error('token has no subject');
  return p;
}

/** ES256 JWT (Apple's client_secret). `privateKeyPem` is the .p8 key Apple issues. */
export function signEs256(header: Record<string, unknown>, payload: Record<string, unknown>, privateKeyPem: string): string {
  const enc = (o: Record<string, unknown>) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${enc({ ...header, alg: 'ES256', typ: 'JWT' })}.${enc(payload)}`;
  const sig = sign('sha256', Buffer.from(input), { key: createPrivateKey(privateKeyPem), dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

/** Tests only. */
export function clearJwksCacheForTest(): void {
  jwksCache.clear();
}
