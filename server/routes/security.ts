/**
 * Account security (KAN-16), mounted under /api/auth with the auth router:
 * 2FA enrolment / disable / backup codes, signed-in sessions and trusted devices.
 * Every route needs a signed-in user; changes to 2FA need the current password, and
 * turning it off or regenerating backup codes also needs a current code.
 */
import { Router, type Response } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { getDb, queryOne } from '../db/index.ts';
import { verifyPassword } from '../auth/passwords.ts';
import { listSessions, parseCookieHeader, revokeOtherSessions, revokeSession } from '../auth/sessions.ts';
import { listAccounts, switchAccount } from '../auth/accounts.ts';
import {
  TRUSTED_DEVICE_COOKIE,
  beginTotpSetup,
  confirmTotpSetup,
  disableTwoFactor,
  isTwoFactorEnabled,
  listTrustedDevices,
  parseTrustedCookie,
  replaceBackupCodes,
  revokeTrustedDevices,
  twoFactorState,
  verifySecondFactor,
} from '../auth/twoFactor.ts';

const router = Router();

function signedIn(req: AuthedRequest, res: Response): req is AuthedRequest & { user: NonNullable<AuthedRequest['user']> } {
  if (req.user) return true;
  res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
  return false;
}

async function passwordOk(userId: string, password: unknown): Promise<boolean> {
  if (typeof password !== 'string' || !password) return false;
  const db = await getDb();
  const row = queryOne<{ password_hash: string }>(db, `SELECT password_hash FROM users WHERE id = ?`, [userId]);
  return row ? verifyPassword(password, row.password_hash) : false;
}

function browserTrustedTokens(req: AuthedRequest): string[] {
  return parseTrustedCookie(parseCookieHeader(req.headers.cookie, TRUSTED_DEVICE_COOKIE));
}

/** Everything the Settings → Security panel shows. */
router.get('/security', async (req: AuthedRequest, res) => {
  if (!signedIn(req, res)) return;
  const db = await getDb();
  res.json({
    twoFactor: twoFactorState(db, req.user.id),
    sessions: listSessions(db, req.user.id, req.user.sessionId),
    trustedDevices: listTrustedDevices(db, req.user.id, browserTrustedTokens(req)),
  });
});

/** Step 1: password → new pending secret + QR. Body: { password }. */
router.post('/2fa/setup', async (req: AuthedRequest, res) => {
  if (!signedIn(req, res)) return;
  const db = await getDb();
  if (isTwoFactorEnabled(db, req.user.id)) {
    res.status(409).json({ error: 'Two-factor sign-in is already on.', code: 'ALREADY_ENABLED' });
    return;
  }
  if (!(await passwordOk(req.user.id, req.body?.password))) {
    res.status(403).json({ error: 'Current password is incorrect', code: 'WRONG_PASSWORD' });
    return;
  }
  res.json(beginTotpSetup(db, req.user.id, req.user.email));
});

/** Step 2: first code from the app confirms setup; returns backup codes once. Body: { code }. */
router.post('/2fa/enable', async (req: AuthedRequest, res) => {
  if (!signedIn(req, res)) return;
  const db = await getDb();
  if (isTwoFactorEnabled(db, req.user.id)) {
    res.status(409).json({ error: 'Two-factor sign-in is already on.', code: 'ALREADY_ENABLED' });
    return;
  }
  const r = confirmTotpSetup(db, req.user.id, typeof req.body?.code === 'string' ? req.body.code : '');
  if (!r.ok) {
    const error =
      r.code === 'INVALID_CODE'
        ? 'That code isn’t right. Check the time on your phone and try the newest code.'
        : 'Setup has expired. Start again.';
    res.status(400).json({ error, code: r.code });
    return;
  }
  res.json({ ok: true, backupCodes: r.backupCodes, twoFactor: twoFactorState(db, req.user.id) });
});

/** Body: { password, code } — code is an authenticator or backup code. */
router.post('/2fa/disable', async (req: AuthedRequest, res) => {
  if (!signedIn(req, res)) return;
  const db = await getDb();
  if (!isTwoFactorEnabled(db, req.user.id)) {
    res.json({ ok: true, twoFactor: twoFactorState(db, req.user.id) });
    return;
  }
  if (!(await passwordOk(req.user.id, req.body?.password))) {
    res.status(403).json({ error: 'Current password is incorrect', code: 'WRONG_PASSWORD' });
    return;
  }
  if (!verifySecondFactor(db, req.user.id, req.body?.code).ok) {
    res.status(403).json({ error: 'That code isn’t right.', code: 'INVALID_CODE' });
    return;
  }
  disableTwoFactor(db, req.user.id);
  res.json({ ok: true, twoFactor: twoFactorState(db, req.user.id) });
});

/** New set of backup codes (old ones stop working). Body: { password, code }. */
router.post('/2fa/backup-codes', async (req: AuthedRequest, res) => {
  if (!signedIn(req, res)) return;
  const db = await getDb();
  if (!isTwoFactorEnabled(db, req.user.id)) {
    res.status(409).json({ error: 'Turn on two-factor sign-in first.', code: 'NOT_ENABLED' });
    return;
  }
  if (!(await passwordOk(req.user.id, req.body?.password))) {
    res.status(403).json({ error: 'Current password is incorrect', code: 'WRONG_PASSWORD' });
    return;
  }
  if (!verifySecondFactor(db, req.user.id, req.body?.code).ok) {
    res.status(403).json({ error: 'That code isn’t right.', code: 'INVALID_CODE' });
    return;
  }
  res.json({ ok: true, backupCodes: replaceBackupCodes(db, req.user.id), twoFactor: twoFactorState(db, req.user.id) });
});

router.post('/sessions/revoke-others', async (req: AuthedRequest, res) => {
  if (!signedIn(req, res)) return;
  const db = await getDb();
  const signedOut = req.user.sessionId ? revokeOtherSessions(db, req.user.id, req.user.sessionId) : 0;
  res.json({ ok: true, signedOut });
});

router.delete('/sessions/:id', async (req: AuthedRequest, res) => {
  if (!signedIn(req, res)) return;
  if (req.params.id === req.user.sessionId) {
    res.status(400).json({ error: 'Use Sign out for this device.', code: 'CURRENT_SESSION' });
    return;
  }
  const db = await getDb();
  if (!revokeSession(db, req.user.id, String(req.params.id))) {
    res.status(404).json({ error: 'Session not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ ok: true });
});

router.delete('/trusted-devices/:id', async (req: AuthedRequest, res) => {
  if (!signedIn(req, res)) return;
  const db = await getDb();
  if (revokeTrustedDevices(db, req.user.id, String(req.params.id)) === 0) {
    res.status(404).json({ error: 'Trusted device not found', code: 'NOT_FOUND' });
    return;
  }
  res.json({ ok: true });
});

router.delete('/trusted-devices', async (req: AuthedRequest, res) => {
  if (!signedIn(req, res)) return;
  const db = await getDb();
  res.json({ ok: true, revoked: revokeTrustedDevices(db, req.user.id, null) });
});

/** Accounts signed in on this browser (account switcher). */
router.get('/accounts', async (req: AuthedRequest, res) => {
  const db = await getDb();
  res.json({ accounts: listAccounts(db, req, res, req.user?.id ?? null) });
});

/** Body: { userId } — make another account signed in on this browser the active one. */
router.post('/accounts/switch', async (req: AuthedRequest, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId : '';
  const db = await getDb();
  if (!userId || !switchAccount(db, req, res, userId)) {
    res.status(404).json({ error: 'That account isn’t signed in on this browser any more. Sign in again.', code: 'NOT_FOUND' });
    return;
  }
  res.json({ ok: true, userId });
});

export default router;
