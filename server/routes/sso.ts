/**
 * Single sign-on routes (Google / Apple / Microsoft), mounted under /api/auth.
 *
 *   GET  /sso/providers                    configured providers (buttons to show)
 *   GET  /sso/:provider/start?remember&mode   → 302 to the provider
 *   GET  /sso/:provider/callback           ← provider (Apple POSTs; we 303 it to GET)
 *   DELETE /identities/:id                 disconnect a provider (Settings → Security); needs a recent sign-in or { password }
 *
 * Which account a provider sign-in opens:
 *   1. one already linked to that provider account (provider + subject);
 *   2. mode=link: the signed-in user (connect from Settings);
 *   3. an account with the same email — only when the provider says it's verified;
 *   4. otherwise a new account (no password until the user sets one).
 * Two-factor sign-in still applies: with 2FA on and an untrusted browser the user lands
 * on the code step (the challenge travels in the URL fragment, never sent to servers).
 */
import express, { Router, type Request, type Response } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { getDb, newId, queryAll, queryOne, run } from '../db/index.ts';
import { parseCookieHeader } from '../auth/sessions.ts';
import { startSession } from '../auth/signIn.ts';
import { REAUTH_REQUIRED, recentlyConfirmed } from '../auth/reauth.ts';
import { NO_PASSWORD, createUserAccount, hasPassword } from '../auth/users.ts';
import { parseOnboardingFromPreferencesJson } from '../../src/lib/onboardingPrefs.ts';
import {
  TRUSTED_DEVICE_COOKIE,
  createLoginChallenge,
  isTrustedDevice,
  isTwoFactorEnabled,
  parseTrustedCookie,
} from '../auth/twoFactor.ts';
import {
  SSO_STATE_COOKIE,
  SsoError,
  beginSso,
  clearSsoStateCookie,
  completeSso,
  configuredSsoProviders,
  isSsoConfigured,
  isSsoProviderId,
  ssoLabel,
  type SsoIdentity,
  type SsoMode,
} from '../auth/sso.ts';

const router = Router();

function fail(res: Response, mode: SsoMode, code: string): void {
  res.append('Set-Cookie', clearSsoStateCookie());
  const q = new URLSearchParams({ sso_error: code });
  res.redirect(303, mode === 'link' ? `/settings?tab=security&${q}` : `/login?${q}`);
}

router.get('/sso/providers', (_req, res) => {
  res.json({ providers: configuredSsoProviders() });
});

router.get('/sso/:provider/start', (req: AuthedRequest, res) => {
  const id = req.params.provider;
  const modeRaw = typeof req.query.mode === 'string' ? req.query.mode : 'signin';
  const mode: SsoMode = modeRaw === 'add' || modeRaw === 'link' ? modeRaw : 'signin';
  if (!isSsoProviderId(id) || !isSsoConfigured(id)) return fail(res, mode, 'NOT_CONFIGURED');
  if (mode === 'link' && !req.user) return fail(res, 'signin', 'SIGN_IN_FIRST');
  const { url, cookie } = beginSso(id, {
    remember: req.query.remember !== '0',
    mode,
    linkUserId: mode === 'link' ? req.user!.id : null,
  });
  res.append('Set-Cookie', cookie);
  res.redirect(302, url);
});

// Apple answers with a cross-site form POST, which doesn't carry our SameSite=Lax cookies.
// Re-issue it as a top-level GET to the same callback so the browser sends them.
router.post('/sso/apple/callback', express.urlencoded({ extended: false, limit: '16kb' }), (req, res) => {
  const q = new URLSearchParams();
  for (const k of ['code', 'state', 'error', 'user']) {
    const v = (req.body as Record<string, unknown> | undefined)?.[k];
    if (typeof v === 'string') q.set(k, v);
  }
  res.redirect(303, `/api/auth/sso/apple/callback?${q}`);
});

function findIdentityUser(provider: string, subject: string): Promise<string | null> {
  return getDb().then(
    (db) =>
      queryOne<{ user_id: string }>(db, `SELECT user_id FROM user_identities WHERE provider = ? AND subject = ?`, [provider, subject])
        ?.user_id ?? null,
  );
}

async function linkIdentity(userId: string, idn: SsoIdentity): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO user_identities (id, user_id, provider, subject, email, created_at, last_used_at) VALUES (?,?,?,?,?,?,?)`,
    [newId('idn'), userId, idn.provider, idn.subject, idn.email, now, now],
  );
}

async function resolveUser(idn: SsoIdentity): Promise<{ userId: string; created: boolean }> {
  const db = await getDb();
  const linked = await findIdentityUser(idn.provider, idn.subject);
  if (linked) {
    run(db, `UPDATE user_identities SET last_used_at = ?, email = COALESCE(?, email) WHERE provider = ? AND subject = ?`, [
      new Date().toISOString(),
      idn.email,
      idn.provider,
      idn.subject,
    ]);
    return { userId: linked, created: false };
  }
  if (!idn.email) throw new SsoError('NO_EMAIL', `${ssoLabel(idn.provider)} didn’t share an email address, so we can’t create or find your account.`);
  const existing = queryOne<{ id: string }>(db, `SELECT id FROM users WHERE email = ?`, [idn.email]);
  if (existing) {
    if (!idn.emailVerified) {
      throw new SsoError('ACCOUNT_EXISTS', 'An account with this email already exists. Sign in with your password, then connect it in Settings → Security.');
    }
    await linkIdentity(existing.id, idn);
    return { userId: existing.id, created: false };
  }
  const created = createUserAccount(db, {
    email: idn.email,
    passwordHash: NO_PASSWORD,
    firstName: idn.firstName,
    lastName: idn.lastName,
  });
  await linkIdentity(created.id, idn);
  return { userId: created.id, created: true };
}

router.get('/sso/:provider/callback', async (req: AuthedRequest, res) => {
  const id = req.params.provider;
  if (!isSsoProviderId(id) || !isSsoConfigured(id)) return fail(res, 'signin', 'NOT_CONFIGURED');
  let mode: SsoMode = 'signin';
  try {
    let appleUser: unknown = null;
    if (typeof req.query.user === 'string' && req.query.user.length < 4096) {
      try {
        appleUser = JSON.parse(req.query.user);
      } catch {
        appleUser = null;
      }
    }
    const { state, identity } = await completeSso(id, {
      code: req.query.code,
      state: req.query.state,
      error: req.query.error,
      appleUser,
      cookieValue: parseCookieHeader(req.headers.cookie, SSO_STATE_COOKIE),
    });
    mode = state.mode;
    res.append('Set-Cookie', clearSsoStateCookie());

    if (mode === 'link') {
      if (!req.user || req.user.id !== state.linkUserId) return fail(res, 'link', 'SIGN_IN_FIRST');
      const owner = await findIdentityUser(identity.provider, identity.subject);
      if (owner && owner !== req.user.id) return fail(res, 'link', 'IDENTITY_IN_USE');
      if (!owner) await linkIdentity(req.user.id, identity);
      res.redirect(303, `/settings?tab=security&sso_linked=${id}`);
      return;
    }

    const { userId } = await resolveUser(identity);
    const db = await getDb();
    const back = mode === 'add' ? '/login?add=1' : '/login';
    if (isTwoFactorEnabled(db, userId)) {
      const trusted = parseTrustedCookie(parseCookieHeader(req.headers.cookie, TRUSTED_DEVICE_COOKIE));
      if (!isTrustedDevice(db, userId, trusted)) {
        const challenge = createLoginChallenge(db, userId, state.remember, identity.provider);
        res.redirect(303, `${back}#sso2fa=${encodeURIComponent(challenge.token)}`);
        return;
      }
    }
    await startSession(req as Request, res, userId, state.remember, { method: 'sso', provider: identity.provider });
    const prefs = queryOne<{ preferences_json: string | null }>(db, `SELECT preferences_json FROM users WHERE id = ?`, [userId]);
    const onboarded = parseOnboardingFromPreferencesJson(prefs?.preferences_json ?? null).complete;
    res.redirect(303, onboarded ? '/' : '/register');
  } catch (err) {
    if (err instanceof SsoError) return fail(res, mode, err.code);
    console.error('[sso] callback failed', err instanceof Error ? err.message : err);
    return fail(res, mode, 'PROVIDER_ERROR');
  }
});

/** Connected providers for Settings → Security. */
export async function listIdentities(userId: string) {
  const db = await getDb();
  return queryAll<{ id: string; provider: string; email: string | null; created_at: string; last_used_at: string | null }>(
    db,
    `SELECT id, provider, email, created_at, last_used_at FROM user_identities WHERE user_id = ? ORDER BY created_at ASC`,
    [userId],
  ).map((r) => ({
    id: r.id,
    provider: r.provider,
    label: isSsoProviderId(r.provider) ? ssoLabel(r.provider) : r.provider,
    email: r.email,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
}

router.delete('/identities/:id', async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const db = await getDb();
  const row = queryOne<{ id: string }>(db, `SELECT id FROM user_identities WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
  if (!row) {
    res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    return;
  }
  const pw = queryOne<{ password_hash: string }>(db, `SELECT password_hash FROM users WHERE id = ?`, [req.user.id]);
  const count = Number(queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM user_identities WHERE user_id = ?`, [req.user.id])?.c ?? 0);
  if (!hasPassword(pw?.password_hash) && count <= 1) {
    res.status(409).json({ error: 'Set a password first, or you won’t be able to sign in.', code: 'LAST_SIGN_IN_METHOD' });
    return;
  }
  if (!(await recentlyConfirmed(db, req.user, (req.body ?? {}).password))) {
    res.status(403).json(REAUTH_REQUIRED);
    return;
  }
  run(db, `DELETE FROM user_identities WHERE id = ? AND user_id = ?`, [row.id, req.user.id]);
  res.json({ ok: true });
});

export default router;
