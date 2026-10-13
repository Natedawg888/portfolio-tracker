/**
 * Shared "finish signing in" steps (KAN-16) for register, password sign-in and the 2FA
 * step: create the session with a device label and the "keep me signed in" choice,
 * then set the cookie. Later sign-in methods (SSO, account switcher) reuse this.
 */
import type { Request, Response } from 'express';
import { getDb } from '../db/index.ts';
import { createSession, sessionCookieHeader } from './sessions.ts';
import { deviceLabel } from './deviceLabel.ts';
import { rememberPreviousAccount } from './accounts.ts';
import { recordAuthEvent, type SignInMethod } from './authEvents.ts';

/** Body flag `remember` (default true): false → browser-session cookie, 24 h server expiry. */
export function parseRemember(body: unknown): boolean {
  const v = (body as { remember?: unknown } | null | undefined)?.remember;
  return v !== false && v !== 'false' && v !== 0;
}

/** Client key for rate limiting (respects the app's trust proxy setting). */
export function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export async function startSession(
  req: Request,
  res: Response,
  userId: string,
  persistent: boolean,
  /** How they signed in (audit log), and the passkey used, if any (KAN-75). */
  opts: { method: SignInMethod; passkeyId?: string | null },
) {
  const db = await getDb();
  // Account switcher: a different account already signed in here stays available.
  await rememberPreviousAccount(db, req, res, userId);
  const label = deviceLabel(req.headers['user-agent']);
  const session = await createSession(userId, { persistent, deviceLabel: label, passkeyId: opts.passkeyId ?? null });
  res.append('Set-Cookie', sessionCookieHeader(session.rawToken, session.expiresAt, session.persistent));
  recordAuthEvent(db, userId, 'sign_in', { method: opts.method, deviceLabel: label });
  return session;
}
