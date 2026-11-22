/**
 * Shared "finish signing in" steps (KAN-16) for register, password sign-in and the 2FA
 * step: create the session with a device label and the "keep me signed in" choice,
 * then set the cookie. Later sign-in methods (SSO, account switcher) reuse this.
 */
import type { Request, Response } from 'express';
import { getDb } from '../db/index.ts';
import { createSession, parseCookieHeader, sessionCookieHeader } from './sessions.ts';
import { TRUSTED_DEVICE_COOKIE, parseTrustedCookie, trustedDeviceIdFor } from './twoFactor.ts';
import { deviceLabel } from './deviceLabel.ts';
import { rememberPreviousAccount } from './accounts.ts';
import { recordAuthEvent, type SignInMethod } from './authEvents.ts';
import { ACCOUNT_PENDING_DELETION, isPendingDeletion } from './accountLinks.ts';
import { sessionKeyStore } from '../security/dataKey.ts';

/** Body flag `remember` (default true): false → browser-session cookie, 24 h server expiry. */
export function parseRemember(body: unknown): boolean {
  const v = (body as { remember?: unknown } | null | undefined)?.remember;
  return v !== false && v !== 'false' && v !== 0;
}

/** Client key for rate limiting (respects the app's trust proxy setting). */
export function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/** Null when the response was already sent (the account is marked for deletion). */
export async function startSession(
  req: Request,
  res: Response,
  userId: string,
  persistent: boolean,
  /**
   * How they signed in (audit log), the passkey or provider used, if any (KAN-75), and the
   * trusted device on this browser (looked up from its cookie when not given).
   */
  opts: {
    method: SignInMethod;
    passkeyId?: string | null;
    provider?: string | null;
    trustedDeviceId?: string | null;
    /** The user's unwrapped data key (KAN-110), held in memory for this session only. */
    dataKey?: Buffer | null;
  },
): Promise<Awaited<ReturnType<typeof createSession>> | null> {
  const db = await getDb();
  if (isPendingDeletion(db, userId)) {
    res.status(ACCOUNT_PENDING_DELETION.status).json({ error: ACCOUNT_PENDING_DELETION.error, code: ACCOUNT_PENDING_DELETION.code });
    return null;
  }
  // Account switcher: a different account already signed in here stays available.
  await rememberPreviousAccount(db, req, res, userId);
  const label = deviceLabel(req.headers['user-agent']);
  const trustedDeviceId =
    opts.trustedDeviceId !== undefined
      ? opts.trustedDeviceId
      : trustedDeviceIdFor(db, userId, parseTrustedCookie(parseCookieHeader(req.headers.cookie, TRUSTED_DEVICE_COOKIE)));
  const session = await createSession(userId, { persistent, deviceLabel: label, passkeyId: opts.passkeyId ?? null, trustedDeviceId });
  if (opts.dataKey) {
    sessionKeyStore.set(session.id, userId, opts.dataKey);
    opts.dataKey.fill(0);
  }
  res.append('Set-Cookie', sessionCookieHeader(session.rawToken, session.expiresAt, session.persistent));
  recordAuthEvent(db, userId, 'sign_in', {
    method: opts.method,
    deviceLabel: label,
    provider: opts.provider ?? null,
    passkeyId: opts.passkeyId ?? null,
    sessionId: session.id,
  });
  return session;
}
