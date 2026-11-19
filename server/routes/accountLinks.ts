/**
 * Linked business accounts.
 *   GET    /api/account/links
 *   POST   /api/account/business          { businessName }
 *   POST   /api/account/links             { email, password }
 *   DELETE /api/account/links/:linkedUserId
 *   POST   /api/account/switch            { accountId }
 *
 * Switch rotates the session (new id, same pt_sid cookie as login) and writes an
 * audit line. It does not ask for a password. Only an owner and its linked
 * accounts can switch, in either direction. After a switch, reload user-scoped data.
 */
import { Router, type Response } from 'express';
import { getDb, queryOne, run } from '../db/index.ts';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { recordAuthEvent } from '../auth/authEvents.ts';
import {
  ACCOUNT_PENDING_DELETION,
  createLinkedBusinessAccount,
  isPendingDeletion,
  linkExistingBusiness,
  listAccountLinks,
  switchRelation,
  unlinkBusiness,
} from '../auth/accountLinks.ts';
import { clearLoginFailures, loginBlockedSec, recordLoginFailure } from '../auth/loginRateLimit.ts';
import { normalizeEmail, verifyPassword } from '../auth/passwords.ts';
import { createSession, getUserByEmail, sessionCookieHeader } from '../auth/sessions.ts';
import { clientKey } from '../auth/signIn.ts';
import { isTwoFactorEnabled } from '../auth/twoFactor.ts';
import { publicUserById } from './auth.ts';

const router = Router();

function fail(res: Response, status: number, code: string, error: string) {
  res.status(status).json({ error, code });
}

router.get('/links', async (req: AuthedRequest, res) => {
  if (!req.user) {
    fail(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }
  const db = await getDb();
  res.json(listAccountLinks(db, req.user.id, req.user.sessionId));
});

router.post('/business', async (req: AuthedRequest, res) => {
  if (!req.user) {
    fail(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }
  const db = await getDb();
  const result = createLinkedBusinessAccount(db, req.user.id, req.body?.businessName);
  if (!result.ok) {
    fail(res, result.status, result.code, result.error);
    return;
  }
  res.status(201).json({ account: result.account, links: listAccountLinks(db, req.user.id, req.user.sessionId) });
});

/** Same credential check and rate limit as POST /api/auth/login. 401, not a dead session. */
router.post('/links', async (req: AuthedRequest, res) => {
  if (!req.user) {
    fail(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }
  const emailRaw = typeof req.body?.email === 'string' ? req.body.email : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const email = normalizeEmail(emailRaw);
  if (!email || !password) {
    fail(res, 400, 'MISSING_FIELDS', 'Email and password are required');
    return;
  }
  const client = clientKey(req);
  const blocked = loginBlockedSec(email, client);
  if (blocked > 0) {
    res.setHeader('Retry-After', String(blocked));
    fail(res, 429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Try again in a few minutes.');
    return;
  }
  const user = await getUserByEmail(email);
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !ok) {
    recordLoginFailure(email, client);
    fail(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    return;
  }
  const db = await getDb();
  if (isTwoFactorEnabled(db, user.id)) {
    fail(res, 403, 'TWO_FACTOR_REQUIRED', 'That account uses two-factor authentication. Sign in and turn it off before linking it.');
    return;
  }
  const result = linkExistingBusiness(db, req.user.id, user.id);
  if (!result.ok) {
    fail(res, result.status, result.code, result.error);
    return;
  }
  clearLoginFailures(email);
  res.json({ links: listAccountLinks(db, req.user.id, req.user.sessionId) });
});

router.delete('/links/:linkedUserId', async (req: AuthedRequest, res) => {
  if (!req.user) {
    fail(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }
  const linkedUserId = typeof req.params.linkedUserId === 'string' ? req.params.linkedUserId : '';
  if (!linkedUserId) {
    fail(res, 404, 'NOT_FOUND', 'That linked account was not found.');
    return;
  }
  const db = await getDb();
  const result = unlinkBusiness(db, req.user.id, linkedUserId);
  if (!result.ok) {
    fail(res, result.status, result.code, result.error);
    return;
  }
  res.json({ ok: true, links: listAccountLinks(db, req.user.id, req.user.sessionId) });
});

router.post('/switch', async (req: AuthedRequest, res) => {
  if (!req.user?.sessionId) {
    fail(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }
  const accountId = typeof req.body?.accountId === 'string' ? req.body.accountId.trim() : '';
  if (!accountId) {
    fail(res, 400, 'MISSING_FIELDS', 'accountId is required');
    return;
  }
  if (accountId === req.user.id) {
    fail(res, 400, 'SAME_ACCOUNT', 'That account is already active.');
    return;
  }
  const db = await getDb();
  const current = queryOne<{ persistent: number; device_label: string | null; origin_owner_user_id: string | null }>(
    db,
    `SELECT persistent, device_label, origin_owner_user_id FROM sessions WHERE id = ? AND user_id = ?`,
    [req.user.sessionId, req.user.id],
  );
  if (!current) {
    fail(res, 401, 'UNAUTHORIZED', 'Authentication required');
    return;
  }
  const relation = switchRelation(db, req.user.id, accountId, current.origin_owner_user_id);
  if (!relation) {
    fail(res, 403, 'SWITCH_NOT_ALLOWED', 'You can only switch between your account and a business account linked to it.');
    return;
  }
  if (isPendingDeletion(db, accountId)) {
    fail(res, ACCOUNT_PENDING_DELETION.status, ACCOUNT_PENDING_DELETION.code, ACCOUNT_PENDING_DELETION.error);
    return;
  }
  // Switching into the business (not back to the owner). 2FA must be the account's own login.
  if (relation.originOwnerUserId && isTwoFactorEnabled(db, accountId)) {
    fail(res, 403, 'TWO_FACTOR_REQUIRED', 'That business account uses two-factor authentication, so it can’t be opened by switching.');
    return;
  }
  const user = publicUserById(db, accountId);
  if (!user) {
    fail(res, 404, 'NOT_FOUND', 'That account was not found.');
    return;
  }
  const created = await createSession(accountId, {
    persistent: Number(current.persistent) !== 0,
    deviceLabel: current.device_label,
    originOwnerUserId: relation.originOwnerUserId,
  });
  run(db, `DELETE FROM sessions WHERE id = ?`, [req.user.sessionId]);
  res.append('Set-Cookie', sessionCookieHeader(created.rawToken, created.expiresAt, created.persistent));
  const label = current.device_label;
  recordAuthEvent(db, accountId, 'account_switch', { method: 'account_switch', deviceLabel: label, sessionId: created.id });
  recordAuthEvent(db, req.user.id, 'account_switch', { method: 'account_switch', deviceLabel: label });
  res.json({ ok: true, user, activeAccount: user.activeAccount });
});

export default router;
