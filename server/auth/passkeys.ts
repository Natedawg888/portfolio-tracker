/**
 * Passkeys (KAN-75): WebAuthn registration and sign-in, using @simplewebauthn/server
 * for every cryptographic check. Every passkey query is scoped to its user.
 *
 * - Challenges are single-use and expire after 5 minutes. They are consumed before
 *   verification, so a failed or replayed response can never use one twice.
 * - Sign-in uses discoverable credentials: the browser offers the passkeys it holds
 *   for this site, so the server never says whether an email has a passkey.
 * - User verification (Face ID, Touch ID, Windows Hello, device PIN) is required, so
 *   a passkey sign-in is two factors on its own (the device, and the unlock).
 * - The relying party is the site's own host (PUBLIC_URL), or localhost in dev.
 */
import type { Database } from 'sql.js';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { decodeClientDataJSON, isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { recordAuthEvent } from './authEvents.ts';

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const RP_NAME = 'KoruLedger';
const MAX_PASSKEYS = 20;
const NAME_MAX = 60;

export type RelyingParty = { rpID: string; origins: string[] };

/**
 * The relying party for this request. Production and alpha each use their own
 * PUBLIC_URL host. WEBAUTHN_RP_ID / WEBAUTHN_ORIGINS override it (comma-separated
 * origins). In dev without PUBLIC_URL, only a localhost origin is accepted (browsers
 * do not allow passkeys on IP addresses such as 127.0.0.1).
 */
export function relyingParty(requestOrigin: string | undefined): RelyingParty | null {
  const rpOverride = process.env.WEBAUTHN_RP_ID?.trim();
  const originsOverride = process.env.WEBAUTHN_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
  const publicUrl = process.env.PUBLIC_URL?.trim();
  if (publicUrl || rpOverride) {
    let origin: string | null = null;
    let host: string | null = null;
    try {
      if (publicUrl) {
        const u = new URL(publicUrl);
        origin = u.origin;
        host = u.hostname;
      }
    } catch {
      /* fall through to overrides */
    }
    const rpID = rpOverride || host;
    const origins = originsOverride?.length ? originsOverride : origin ? [origin] : [];
    return rpID && origins.length ? { rpID, origins } : null;
  }
  if (!requestOrigin) return null;
  try {
    const u = new URL(requestOrigin);
    if (u.hostname !== 'localhost') return null;
    return { rpID: 'localhost', origins: [u.origin] };
  } catch {
    return null;
  }
}

/** Library calls, injectable for tests. */
export type Verifiers = {
  verifyRegistration: typeof verifyRegistrationResponse;
  verifyAuthentication: typeof verifyAuthenticationResponse;
};
const realVerifiers: Verifiers = {
  verifyRegistration: verifyRegistrationResponse,
  verifyAuthentication: verifyAuthenticationResponse,
};

export type PasskeyInfo = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
};

type PasskeyRow = {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  name: string;
  backed_up: number;
  created_at: string;
  last_used_at: string | null;
};

export type PasskeyError =
  | 'no_relying_party'
  | 'bad_response'
  | 'challenge_invalid'
  | 'not_verified'
  | 'unknown_passkey'
  | 'already_registered'
  | 'too_many';

export type Result<T> = { ok: true; value: T } | { ok: false; error: PasskeyError };

export function listPasskeys(db: Database, userId: string): PasskeyInfo[] {
  return queryAll<PasskeyRow>(db, `SELECT * FROM user_passkeys WHERE user_id = ? ORDER BY created_at ASC, id ASC`, [userId]).map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    backedUp: r.backed_up === 1,
  }));
}

function parseTransports(raw: string | null): AuthenticatorTransport[] | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v.filter((t) => typeof t === 'string') as AuthenticatorTransport[]) : undefined;
  } catch {
    return undefined;
  }
}

function storeChallenge(db: Database, purpose: 'register' | 'login', challenge: string, userId: string | null, persistent: boolean): void {
  const now = Date.now();
  run(db, `DELETE FROM webauthn_challenges WHERE expires_at <= ?`, [new Date(now).toISOString()]);
  run(
    db,
    `INSERT INTO webauthn_challenges (id, user_id, purpose, challenge, persistent, created_at, expires_at) VALUES (?,?,?,?,?,?,?)`,
    [newId('wch'), userId, purpose, challenge, persistent ? 1 : 0, new Date(now).toISOString(), new Date(now + CHALLENGE_TTL_MS).toISOString()],
  );
}

/**
 * Take the challenge a response was signed over and delete it (single use), whether
 * or not the response then verifies. Null when unknown, expired, for another purpose,
 * or (registration) for another user.
 */
function consumeChallenge(
  db: Database,
  purpose: 'register' | 'login',
  clientDataJSON: unknown,
  userId: string | null,
): { challenge: string; persistent: boolean } | null {
  if (typeof clientDataJSON !== 'string') return null;
  let challenge: string;
  try {
    challenge = decodeClientDataJSON(clientDataJSON).challenge;
  } catch {
    return null;
  }
  if (typeof challenge !== 'string' || !challenge) return null;
  const row = queryOne<{ id: string; user_id: string | null; purpose: string; persistent: number; expires_at: string }>(
    db,
    `SELECT id, user_id, purpose, persistent, expires_at FROM webauthn_challenges WHERE challenge = ?`,
    [challenge],
  );
  if (!row) return null;
  run(db, `DELETE FROM webauthn_challenges WHERE id = ?`, [row.id]);
  if (row.purpose !== purpose) return null;
  if (row.expires_at <= new Date().toISOString()) return null;
  if (purpose === 'register' && row.user_id !== userId) return null;
  return { challenge, persistent: row.persistent === 1 };
}

/** Options for adding a passkey to the signed-in user's account. */
export async function registrationOptions(
  db: Database,
  rp: RelyingParty,
  user: { id: string; email: string; displayName: string | null },
): Promise<Result<PublicKeyCredentialCreationOptionsJSON>> {
  const existing = queryAll<PasskeyRow>(db, `SELECT credential_id, transports FROM user_passkeys WHERE user_id = ?`, [user.id]);
  if (existing.length >= MAX_PASSKEYS) return { ok: false, error: 'too_many' };
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: user.email,
    userID: isoUint8Array.fromUTF8String(user.id),
    userDisplayName: user.displayName || user.email,
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.credential_id, transports: parseTransports(p.transports) })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    timeout: CHALLENGE_TTL_MS,
  });
  storeChallenge(db, 'register', options.challenge, user.id, true);
  return { ok: true, value: options };
}

function cleanName(raw: unknown, fallback: string): string {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX) : '';
  return name || fallback;
}

/** Verify the browser's new credential and save it for the signed-in user. */
export async function finishRegistration(
  db: Database,
  rp: RelyingParty,
  userId: string,
  response: unknown,
  opts: { name?: unknown; deviceLabel: string },
  verifiers: Verifiers = realVerifiers,
): Promise<Result<PasskeyInfo>> {
  const r = response as RegistrationResponseJSON | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.response) return { ok: false, error: 'bad_response' };
  const challenge = consumeChallenge(db, 'register', r.response.clientDataJSON, userId);
  if (!challenge) return { ok: false, error: 'challenge_invalid' };
  let verified;
  try {
    verified = await verifiers.verifyRegistration({
      response: r,
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
  } catch {
    return { ok: false, error: 'not_verified' };
  }
  if (!verified.verified) return { ok: false, error: 'not_verified' };
  const { credential, credentialBackedUp } = verified.registrationInfo;
  if (queryOne(db, `SELECT id FROM user_passkeys WHERE credential_id = ?`, [credential.id])) {
    return { ok: false, error: 'already_registered' };
  }
  const id = newId('pk');
  const now = new Date().toISOString();
  const name = cleanName(opts.name, opts.deviceLabel);
  run(
    db,
    `INSERT INTO user_passkeys (id, user_id, credential_id, public_key, counter, transports, name, backed_up, created_at, last_used_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      credential.id,
      isoBase64URL.fromBuffer(credential.publicKey),
      credential.counter,
      credential.transports?.length ? JSON.stringify(credential.transports) : null,
      name,
      credentialBackedUp ? 1 : 0,
      now,
      null,
    ],
  );
  recordAuthEvent(db, userId, 'passkey_added', { deviceLabel: opts.deviceLabel });
  return { ok: true, value: { id, name, createdAt: now, lastUsedAt: null, backedUp: credentialBackedUp } };
}

/** Options for signing in with any passkey this browser holds for the site. */
export async function authenticationOptions(
  db: Database,
  rp: RelyingParty,
  persistent: boolean,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: 'required',
    timeout: CHALLENGE_TTL_MS,
  });
  storeChallenge(db, 'login', options.challenge, null, persistent);
  return options;
}

/** Verify a sign-in assertion. On success the caller opens the session. */
export async function finishAuthentication(
  db: Database,
  rp: RelyingParty,
  response: unknown,
  verifiers: Verifiers = realVerifiers,
): Promise<Result<{ userId: string; passkeyId: string; persistent: boolean }>> {
  const r = response as AuthenticationResponseJSON | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.response) return { ok: false, error: 'bad_response' };
  const challenge = consumeChallenge(db, 'login', r.response.clientDataJSON, null);
  if (!challenge) return { ok: false, error: 'challenge_invalid' };
  const row = queryOne<PasskeyRow>(db, `SELECT * FROM user_passkeys WHERE credential_id = ?`, [r.id]);
  if (!row) return { ok: false, error: 'unknown_passkey' };
  // The passkey's user handle, when sent, must be the account it is stored under.
  if (r.response.userHandle) {
    let handle = '';
    try {
      handle = isoUint8Array.toUTF8String(isoBase64URL.toBuffer(r.response.userHandle));
    } catch {
      return { ok: false, error: 'not_verified' };
    }
    if (handle !== row.user_id) return { ok: false, error: 'not_verified' };
  }
  let verified;
  try {
    verified = await verifiers.verifyAuthentication({
      response: r,
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp.origins,
      expectedRPID: rp.rpID,
      credential: {
        id: row.credential_id,
        publicKey: isoBase64URL.toBuffer(row.public_key),
        counter: Number(row.counter) || 0,
        transports: parseTransports(row.transports),
      },
      requireUserVerification: true,
    });
  } catch {
    return { ok: false, error: 'not_verified' };
  }
  if (!verified.verified) return { ok: false, error: 'not_verified' };
  run(db, `UPDATE user_passkeys SET counter = ?, last_used_at = ?, backed_up = ? WHERE id = ? AND user_id = ?`, [
    verified.authenticationInfo.newCounter,
    new Date().toISOString(),
    verified.authenticationInfo.credentialBackedUp ? 1 : 0,
    row.id,
    row.user_id,
  ]);
  return { ok: true, value: { userId: row.user_id, passkeyId: row.id, persistent: challenge.persistent } };
}

/** Rename one of the user's passkeys. False when it isn't theirs. */
export function renamePasskey(db: Database, userId: string, id: string, rawName: unknown): PasskeyInfo | null {
  const row = queryOne<PasskeyRow>(db, `SELECT * FROM user_passkeys WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!row) return null;
  const name = cleanName(rawName, row.name);
  run(db, `UPDATE user_passkeys SET name = ? WHERE id = ? AND user_id = ?`, [name, id, userId]);
  return { id, name, createdAt: row.created_at, lastUsedAt: row.last_used_at, backedUp: row.backed_up === 1 };
}

/**
 * Remove one of the user's passkeys: it can't sign in again, and every session it
 * opened ends at once, except the session making this request.
 * Null when it isn't theirs; otherwise how many sessions ended.
 */
export function removePasskey(
  db: Database,
  userId: string,
  id: string,
  opts: { keepSessionId?: string | null; deviceLabel: string },
): { sessionsEnded: number } | null {
  const row = queryOne<{ id: string }>(db, `SELECT id FROM user_passkeys WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!row) return null;
  run(db, `DELETE FROM user_passkeys WHERE id = ? AND user_id = ?`, [id, userId]);
  const keep = opts.keepSessionId ?? '';
  const ended = Number(
    queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND passkey_id = ? AND id != ?`, [userId, id, keep])?.c ?? 0,
  );
  run(db, `DELETE FROM sessions WHERE user_id = ? AND passkey_id = ? AND id != ?`, [userId, id, keep]);
  recordAuthEvent(db, userId, 'passkey_removed', { deviceLabel: opts.deviceLabel });
  return { sessionsEnded: ended };
}
