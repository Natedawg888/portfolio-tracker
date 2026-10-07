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

/** Body flag `remember` (default true): false → browser-session cookie, 24 h server expiry. */
export function parseRemember(body: unknown): boolean {
  const v = (body as { remember?: unknown } | null | undefined)?.remember;
  return v !== false && v !== 'false' && v !== 0;
}

/** Client key for rate limiting (respects the app's trust proxy setting). */
export function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export async function startSession(req: Request, res: Response, userId: string, persistent: boolean) {
  // Account switcher: a different account already signed in here stays available.
  await rememberPreviousAccount(await getDb(), req, res, userId);
  const session = await createSession(userId, { persistent, deviceLabel: deviceLabel(req.headers['user-agent']) });
  res.append('Set-Cookie', sessionCookieHeader(session.rawToken, session.expiresAt, session.persistent));
  return session;
}
