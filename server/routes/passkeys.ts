/**
 * Passkey endpoints (KAN-75), mounted under /api/auth.
 *   POST   /passkeys/register/options   signed in; needs a sign-in in the last 15 min or { password }
 *   POST   /passkeys/register/verify    signed in; { response, name? }
 *   POST   /passkeys/login/options      public, rate limited; { remember? }
 *   POST   /passkeys/login/verify       public, rate limited; { response } → { user }
 *   PATCH  /passkeys/:id                signed in; { name }
 *   DELETE /passkeys/:id                signed in; needs a sign-in in the last 15 min or { password };
 *                                       refused for the last way to sign in; also ends the sessions that passkey opened
 * The list of passkeys and recent sign-ins is part of GET /api/auth/security.
 */
import { Router, type Request, type Response } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { getDb } from '../db/index.ts';
import { deviceLabel } from '../auth/deviceLabel.ts';
import { clearLoginFailures, loginBlockedSec, recordLoginFailure } from '../auth/loginRateLimit.ts';
import { clientKey, parseRemember, startSession } from '../auth/signIn.ts';
import {
  authenticationOptions,
  finishAuthentication,
  finishRegistration,
  listPasskeys,
  registrationOptions,
  relyingParty,
  removePasskey,
  renamePasskey,
  type PasskeyError,
} from '../auth/passkeys.ts';
import { REAUTH_REQUIRED, recentlyConfirmed } from '../auth/reauth.ts';
import { signInMethodCount } from '../auth/users.ts';
import { publicUserById } from './auth.ts';

const router = Router();

/** Adding a passkey needs a sign-in this recent (or the password). */
export { RECENT_SIGN_IN_MS } from '../auth/reauth.ts';

const MESSAGES: Record<PasskeyError, string> = {
  no_relying_party: 'Passkeys aren’t available on this address.',
  bad_response: 'That passkey response wasn’t valid.',
  challenge_invalid: 'That passkey request expired. Try again.',
  not_verified: 'That passkey couldn’t be verified.',
  unknown_passkey: 'That passkey isn’t registered here. It may have been removed.',
  already_registered: 'That passkey is already registered.',
  too_many: 'You have the maximum number of passkeys. Remove one first.',
};

function fail(res: Response, status: number, code: PasskeyError) {
  res.status(status).json({ error: MESSAGES[code], code: code.toUpperCase() });
}

function signedIn(req: AuthedRequest, res: Response): req is AuthedRequest & { user: NonNullable<AuthedRequest['user']> } {
  if (req.user) return true;
  res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
  return false;
}

function rpFor(req: Request) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  return relyingParty(origin);
}

router.post('/passkeys/register/options', async (req: AuthedRequest, res) => {
  if (!signedIn(req, res)) return;
  const rp = rpFor(req);
  if (!rp) return fail(res, 400, 'no_relying_party');
  const db = await getDb();
  if (!(await recentlyConfirmed(db, req.user, (req.body ?? {}).password))) {
    res.status(403).json({ error: 'Confirm your password to add a passkey.', code: 'REAUTH_REQUIRED' });
    return;
  }
  const result = await registrationOptions(db, rp, {
    id: req.user.id,
    email: req.user.email,
    displayName: req.user.displayName,
  });
  if (!result.ok) return fail(res, 400, result.error);
  res.json(result.value);
});

router.post('/passkeys/register/verify', async (req: AuthedRequest, res) => {
  if (!signedIn(req, res)) return;
  const rp = rpFor(req);
  if (!rp) return fail(res, 400, 'no_relying_party');
  const db = await getDb();
  const body = (req.body ?? {}) as { response?: unknown; name?: unknown };
  const result = await finishRegistration(db, rp, req.user.id, body.response, {
    name: body.name,
    deviceLabel: deviceLabel(req.headers['user-agent']),
  });
  if (!result.ok) return fail(res, result.error === 'already_registered' ? 409 : 400, result.error);
  res.status(201).json(result.value);
});

/** Rate-limit key for passkey sign-in: per client (there is no account until it verifies). */
function passkeyAccountKey(client: string): string {
  return `passkey:${client}`;
}

function blocked(req: Request, res: Response): boolean {
  const client = clientKey(req);
  const wait = loginBlockedSec(passkeyAccountKey(client), client);
  if (wait <= 0) return false;
  res.setHeader('Retry-After', String(wait));
  res.status(429).json({ error: 'Too many sign-in attempts. Try again in a few minutes.', code: 'TOO_MANY_ATTEMPTS' });
  return true;
}

router.post('/passkeys/login/options', async (req, res) => {
  if (blocked(req, res)) return;
  const rp = rpFor(req);
  if (!rp) return fail(res, 400, 'no_relying_party');
  const db = await getDb();
  res.json(await authenticationOptions(db, rp, parseRemember(req.body)));
});

router.post('/passkeys/login/verify', async (req, res) => {
  if (blocked(req, res)) return;
  const rp = rpFor(req);
  if (!rp) return fail(res, 400, 'no_relying_party');
  const client = clientKey(req);
  const db = await getDb();
  const result = await finishAuthentication(db, rp, (req.body ?? {}).response);
  if (!result.ok) {
    recordLoginFailure(passkeyAccountKey(client), client);
    return fail(res, 401, result.error);
  }
  clearLoginFailures(passkeyAccountKey(client));
  // A verified passkey is two factors (the device and its unlock), so 2FA is satisfied.
  await startSession(req, res, result.value.userId, result.value.persistent, { method: 'passkey', passkeyId: result.value.passkeyId });
  res.json({ user: publicUserById(db, result.value.userId) });
});

router.patch('/passkeys/:id', async (req: AuthedRequest, res) => {
  if (!signedIn(req, res)) return;
  const db = await getDb();
  const saved = renamePasskey(db, req.user.id, String(req.params.id), (req.body ?? {}).name);
  if (!saved) {
    res.status(404).json({ error: 'Passkey not found', code: 'NOT_FOUND' });
    return;
  }
  res.json(saved);
});

router.delete('/passkeys/:id', async (req: AuthedRequest, res) => {
  if (!signedIn(req, res)) return;
  const db = await getDb();
  const id = String(req.params.id);
  const owned = listPasskeys(db, req.user.id).some((p) => p.id === id);
  if (owned && signInMethodCount(db, req.user.id) <= 1) {
    res.status(409).json({ error: 'This is your only way to sign in. Add a password or another passkey first.', code: 'LAST_SIGN_IN_METHOD' });
    return;
  }
  if (owned && !(await recentlyConfirmed(db, req.user, (req.body ?? {}).password))) {
    res.status(403).json(REAUTH_REQUIRED);
    return;
  }
  const removed = removePasskey(db, req.user.id, id, {
    keepSessionId: req.user.sessionId ?? null,
    deviceLabel: deviceLabel(req.headers['user-agent']),
  });
  if (!removed) {
    res.status(404).json({ error: 'Passkey not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ ok: true, ...removed });
});

export default router;
