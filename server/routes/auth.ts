/**
 * Email/password auth — create account, login (+ 2FA step, KAN-16), logout, session probe,
 * profile (first/last name / avatar), change email & password.
 * 2FA setup, sessions and trusted devices live in routes/security.ts.
 * First signup on an empty database claims that install. A database that already
 * has finance or bank rows is not handed to the first registrant unless
 * ALLOW_EXISTING_DATA_CLAIM is set on the server (rule in auth/users.ts).
 */
import { Router } from 'express';
import { getDb, queryOne, run } from '../db/index.ts';
import {
  hashPassword,
  verifyPassword,
  validateEmail,
  validatePassword,
  normalizeEmail,
} from '../auth/passwords.ts';
import {
  SESSION_COOKIE,
  countUsers,
  destroySessionByToken,
  destroySessionsForUser,
  getUserByEmail,
  parseCookieHeader,
  clearSessionCookieHeader,
  purgeExpiredSessions,
  revokeOtherSessions,
} from '../auth/sessions.ts';
import { clientKey, parseRemember, startSession } from '../auth/signIn.ts';
import { recentlyConfirmed } from '../auth/reauth.ts';
import { clearLoginFailures, loginBlockedSec, recordLoginFailure } from '../auth/loginRateLimit.ts';
import { deviceLabel } from '../auth/deviceLabel.ts';
import { accountsCookieHeader, allBrowserTokens, promoteNextAccount } from '../auth/accounts.ts';
import {
  TRUSTED_DEVICE_COOKIE,
  createLoginChallenge,
  createTrustedDevice,
  deleteChallenge,
  isTrustedDevice,
  isTwoFactorEnabled,
  parseTrustedCookie,
  trustedCookieHeader,
  useChallengeAttempt,
  verifySecondFactor,
} from '../auth/twoFactor.ts';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { cancelEmailChange, confirmEmailChange, emailChangeTooSoon, pendingEmailFor, startEmailChange } from '../auth/emailChange.ts';
import { emailEnabled, messageHtml, sendEmail } from '../invoices/email.ts';
import { shareBase } from './invoices.ts';
import { exportAccountData } from '../lib/accountExport.ts';
import { composeDisplayName, createUserAccount, hasPassword } from '../auth/users.ts';
import { deleteScopedDataForUser, getDataOwnerUserId } from '../lib/userScope.ts';
import { mayClaimExistingFinance } from '../lib/dataClaim.ts';
import {
  deleteAvatarFile,
  photoUrlFromPath,
  saveUserAvatar,
} from '../lib/uploads.ts';
import {
  parseOnboardingFromPreferencesJson,
  preferencesWithAkahuSkippedUnlessRequired,
  type OnboardingFlags,
} from '../../src/lib/onboardingPrefs.ts';

const router = Router();

/** Trim + length-cap a name part; empty → null. */
function normalizeNamePart(raw: unknown, max = 40): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return null;
  const t = raw.trim().slice(0, max);
  return t || null;
}


function publicUser(u: {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  createdAt?: string;
  created_at?: string;
  preferences_json?: string | null;
  preferencesJson?: string | null;
}) {
  const rawAvatar = u.avatarUrl ?? null;
  // Absolute data URLs or http(s) pass through; relative upload paths become /api/uploads/…
  let avatarUrl: string | null = null;
  if (rawAvatar) {
    if (
      rawAvatar.startsWith('data:') ||
      rawAvatar.startsWith('http://') ||
      rawAvatar.startsWith('https://') ||
      rawAvatar.startsWith('/api/')
    ) {
      avatarUrl = rawAvatar;
    } else {
      avatarUrl = photoUrlFromPath(rawAvatar);
    }
  }
  const firstName = u.firstName?.trim() || null;
  const lastName = u.lastName?.trim() || null;
  const displayName =
    composeDisplayName(firstName, lastName) ||
    u.displayName?.trim() ||
    null;
  const parsed = parseOnboardingFromPreferencesJson(
    u.preferencesJson ?? u.preferences_json ?? null,
  );
  const onboarding: OnboardingFlags = parsed.flags ?? {
    assetClassesDone: true,
    budgetCategoriesDone: true,
    akahuStepDone: true,
  };
  return {
    id: u.id,
    email: u.email,
    firstName,
    lastName,
    displayName,
    avatarUrl,
    createdAt: u.createdAt ?? u.created_at ?? null,
    onboardingComplete: parsed.complete,
    onboarding,
  };
}

/**
 * Record Akahu setup as skipped for every account except Nathan's email.
 * No-op for Nathan, for legacy complete accounts, and when the step is already done.
 */
function preferencesForUser(
  db: Awaited<ReturnType<typeof getDb>>,
  userId: string,
  email: string,
  preferencesJson: string | null | undefined,
): string | null {
  const applied = preferencesWithAkahuSkippedUnlessRequired(preferencesJson, email);
  if (applied.changed && applied.json != null) {
    const now = new Date().toISOString();
    run(
      db,
      `UPDATE users SET preferences_json = ?, updated_at = ? WHERE id = ?`,
      [applied.json, now, userId],
    );
    return applied.json;
  }
  return applied.json;
}

function toPublicUser(
  db: Awaited<ReturnType<typeof getDb>>,
  u: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
    createdAt?: string;
    created_at?: string;
    preferences_json?: string | null;
    preferencesJson?: string | null;
  },
) {
  const preferences_json = preferencesForUser(
    db,
    u.id,
    u.email,
    u.preferencesJson ?? u.preferences_json ?? null,
  );
  return {
    ...publicUser({ ...u, preferences_json }),
    /** New address waiting for its link to be opened (null when none). */
    pendingEmail: pendingEmailFor(db, u.id)?.newEmail ?? null,
    /** True when changing email sends a confirmation link; false when it applies at once. */
    emailChangeConfirms: emailEnabled(),
  };
}

function loadUserRow(db: Awaited<ReturnType<typeof getDb>>, userId: string) {
  return queryOne<{
    id: string;
    email: string;
    password_hash: string;
    first_name: string | null;
    last_name: string | null;
    display_name: string | null;
    avatar_url: string | null;
    created_at: string;
    preferences_json: string | null;
  }>(
    db,
    // first_name / last_name / display_name / avatar_url / preferences_json may be null on older rows
    `SELECT id, email, password_hash, first_name, last_name, display_name, avatar_url, created_at, preferences_json FROM users WHERE id = ?`,
    [userId],
  );
}

/** The signed-in user's public shape, as password sign-in returns it (KAN-75 passkey sign-in). */
export function publicUserById(db: Awaited<ReturnType<typeof getDb>>, userId: string) {
  const row = loadUserRow(db, userId);
  if (!row) return null;
  return toPublicUser(db, {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    preferences_json: row.preferences_json,
  });
}

/** Setup / session status (safe for unauthenticated clients). */
router.get('/status', async (_req, res) => {
  const db = await getDb();
  purgeExpiredSessions(db);
  const users = await countUsers();
  const claimed = queryOne<{ value: string }>(db, `SELECT value FROM meta WHERE key = 'data_owner_user_id'`);
  const firstSignupClaimsData = users === 0 && mayClaimExistingFinance(db);
  res.json({
    hasUsers: users > 0,
    userCount: users,
    needsSetup: users === 0,
    dataClaimed: Boolean(claimed?.value),
    firstSignupClaimsData,
    /** Later accounts get empty per-user ledgers (not shared household dump). */
    perUserLedgers: true,
  });
});

router.get('/me', async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.json({ user: null });
    return;
  }
  const db = await getDb();
  const row = loadUserRow(db, req.user.id);
  if (!row) {
    res.json({ user: null });
    return;
  }
  res.json({
    user: toPublicUser(db, {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      createdAt: row.created_at,
      preferences_json: row.preferences_json,
    }),
  });
});

router.post('/register', async (req, res) => {
  const emailRaw = typeof req.body?.email === 'string' ? req.body.email : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  // Prefer firstName/lastName; accept legacy displayName only as a soft fallback for older clients.
  let firstName = normalizeNamePart(req.body?.firstName);
  let lastName = normalizeNamePart(req.body?.lastName);
  if (!firstName && !lastName && typeof req.body?.displayName === 'string') {
    const parts = req.body.displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 1) firstName = parts[0].slice(0, 40);
    if (parts.length >= 2) lastName = parts.slice(1).join(' ').slice(0, 40);
  }

  const emailErr = validateEmail(emailRaw);
  if (emailErr) {
    res.status(400).json({ error: emailErr, code: 'INVALID_EMAIL' });
    return;
  }
  const passErr = validatePassword(password);
  if (passErr) {
    res.status(400).json({ error: passErr, code: 'INVALID_PASSWORD' });
    return;
  }
  if (!firstName) {
    res.status(400).json({ error: 'First name is required', code: 'INVALID_FIRST_NAME' });
    return;
  }
  if (!lastName) {
    res.status(400).json({ error: 'Last name is required', code: 'INVALID_LAST_NAME' });
    return;
  }

  const email = normalizeEmail(emailRaw);
  const existing = await getUserByEmail(email);
  if (existing) {
    res.status(409).json({ error: 'An account with that email already exists', code: 'EMAIL_TAKEN' });
    return;
  }

  const db = await getDb();
  const passwordHash = await hashPassword(password);
  const created = createUserAccount(db, { email, passwordHash, firstName, lastName });
  const { id, displayName, claimedExistingData } = created;
  const now = created.createdAt;
  const prefsJson = created.preferencesJson;

  await startSession(req, res, id, parseRemember(req.body), { method: 'register' });
  res.status(201).json({
    user: toPublicUser(db, {
      id,
      email,
      firstName,
      lastName,
      displayName,
      avatarUrl: null,
      createdAt: now,
      preferences_json: prefsJson,
    }),
    claimedExistingData,
    message: claimedExistingData
      ? 'Account created. Existing local portfolio data is now available under this account.'
      : 'Account created.',
  });
});

router.post('/login', async (req, res) => {
  const emailRaw = typeof req.body?.email === 'string' ? req.body.email : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const email = normalizeEmail(emailRaw);

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required', code: 'MISSING_FIELDS' });
    return;
  }
  const client = clientKey(req);
  const blocked = loginBlockedSec(email, client);
  if (blocked > 0) {
    res.setHeader('Retry-After', String(blocked));
    res.status(429).json({ error: 'Too many sign-in attempts. Try again in a few minutes.', code: 'TOO_MANY_ATTEMPTS' });
    return;
  }

  const user = await getUserByEmail(email);
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !ok) {
    recordLoginFailure(email, client);
    res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    return;
  }

  const db = await getDb();
  const remember = parseRemember(req.body);
  // 2FA (KAN-16): password alone isn't enough unless this browser is a trusted device.
  if (isTwoFactorEnabled(db, user.id)) {
    const trusted = parseTrustedCookie(parseCookieHeader(req.headers.cookie, TRUSTED_DEVICE_COOKIE));
    if (!isTrustedDevice(db, user.id, trusted)) {
      const challenge = createLoginChallenge(db, user.id, remember);
      res.json({
        twoFactorRequired: true,
        challenge: challenge.token,
        expiresAt: challenge.expiresAt,
        methods: ['totp', 'backup_code'],
      });
      return;
    }
  }
  clearLoginFailures(email);

  const row = loadUserRow(db, user.id);
  await startSession(req, res, user.id, remember, { method: 'password' });
  res.json({
    user: toPublicUser(db, {
      id: user.id,
      email: user.email,
      firstName: row?.first_name ?? null,
      lastName: row?.last_name ?? null,
      displayName: row?.display_name ?? null,
      avatarUrl: row?.avatar_url ?? null,
      createdAt: user.created_at,
      preferences_json: row?.preferences_json ?? null,
    }),
  });
});

/**
 * Second step of sign-in when 2FA is on. Body: { challenge, code, trustDevice? }.
 * `code` is a 6-digit authenticator code or a backup code (xxxxx-xxxxx, single use).
 */
router.post('/login/2fa', async (req, res) => {
  const db = await getDb();
  const c = useChallengeAttempt(db, req.body?.challenge);
  if (!c.ok) {
    const message =
      c.code === 'TOO_MANY_ATTEMPTS'
        ? 'Too many incorrect codes. Sign in again.'
        : 'This sign-in has expired. Sign in again.';
    res.status(401).json({ error: message, code: c.code });
    return;
  }
  const row = loadUserRow(db, c.userId);
  if (!row) {
    deleteChallenge(db, c.id);
    res.status(401).json({ error: 'This sign-in has expired. Sign in again.', code: 'CHALLENGE_INVALID' });
    return;
  }
  const client = clientKey(req);
  const blocked = loginBlockedSec(row.email, client);
  if (blocked > 0) {
    res.setHeader('Retry-After', String(blocked));
    res.status(429).json({ error: 'Too many sign-in attempts. Try again in a few minutes.', code: 'TOO_MANY_ATTEMPTS' });
    return;
  }
  const v = verifySecondFactor(db, c.userId, req.body?.code);
  if (!v.ok) {
    recordLoginFailure(row.email, client);
    res.status(401).json({ error: 'That code isn’t right. Check your authenticator app and try again.', code: 'INVALID_CODE' });
    return;
  }
  deleteChallenge(db, c.id);
  clearLoginFailures(row.email);

  // Trust the browser first, so the new session is linked to it (one device in Settings → Security).
  let trustedDeviceId: string | undefined;
  if (req.body?.trustDevice === true) {
    const existing = parseTrustedCookie(parseCookieHeader(req.headers.cookie, TRUSTED_DEVICE_COOKIE));
    const trusted = createTrustedDevice(db, row.id, deviceLabel(req.headers['user-agent']));
    trustedDeviceId = trusted.id;
    res.append('Set-Cookie', trustedCookieHeader([...existing, trusted.token]));
  }
  await startSession(req, res, row.id, c.persistent, { method: 'two_factor', provider: c.provider, trustedDeviceId });
  res.json({
    user: toPublicUser(db, {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      createdAt: row.created_at,
      preferences_json: row.preferences_json,
    }),
    ...(v.method === 'backup_code'
      ? { usedBackupCode: true, backupCodesRemaining: v.backupCodesRemaining ?? 0 }
      : {}),
  });
});

/** Sign the active account out; another account signed in on this browser takes over. */
router.post('/logout', async (req, res) => {
  const raw = parseCookieHeader(req.headers.cookie, SESSION_COOKIE);
  await destroySessionByToken(raw);
  const next = promoteNextAccount(await getDb(), req, res);
  if (!next) res.append('Set-Cookie', clearSessionCookieHeader());
  res.json({ ok: true, switchedToUserId: next });
});

/** Sign every account on this browser out. */
router.post('/logout-all', async (req, res) => {
  const tokens = allBrowserTokens(req);
  for (const t of tokens) await destroySessionByToken(t);
  res.append('Set-Cookie', clearSessionCookieHeader());
  res.append('Set-Cookie', accountsCookieHeader([]));
  res.json({ ok: true, signedOut: tokens.length });
});

/** Update first/last name (auth required). Also accepts legacy displayName. */
router.patch('/profile', async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const db = await getDb();
  const row = loadUserRow(db, req.user.id);
  if (!row) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }

  let firstName = row.first_name;
  let lastName = row.last_name;
  const body = req.body ?? {};
  const hasFirst = Object.prototype.hasOwnProperty.call(body, 'firstName');
  const hasLast = Object.prototype.hasOwnProperty.call(body, 'lastName');
  const hasDisplay = Object.prototype.hasOwnProperty.call(body, 'displayName');

  if (hasFirst) {
    const raw = body.firstName;
    if (raw !== null && typeof raw !== 'string') {
      res.status(400).json({ error: 'firstName must be a string or null', code: 'INVALID_FIRST_NAME' });
      return;
    }
    firstName = normalizeNamePart(raw);
  }
  if (hasLast) {
    const raw = body.lastName;
    if (raw !== null && typeof raw !== 'string') {
      res.status(400).json({ error: 'lastName must be a string or null', code: 'INVALID_LAST_NAME' });
      return;
    }
    lastName = normalizeNamePart(raw);
  }
  // Legacy: single displayName field splits into first/last when first/last not sent.
  if (hasDisplay && !hasFirst && !hasLast) {
    const raw = body.displayName;
    if (raw === null || raw === '') {
      firstName = null;
      lastName = null;
    } else if (typeof raw === 'string') {
      const parts = raw.trim().split(/\s+/).filter(Boolean);
      firstName = parts[0] ? parts[0].slice(0, 40) : null;
      lastName = parts.length >= 2 ? parts.slice(1).join(' ').slice(0, 40) : null;
    } else {
      res.status(400).json({ error: 'displayName must be a string or null', code: 'INVALID_DISPLAY_NAME' });
      return;
    }
  }

  const displayName = composeDisplayName(firstName, lastName);
  const now = new Date().toISOString();
  run(
    db,
    `UPDATE users SET first_name = ?, last_name = ?, display_name = ?, updated_at = ? WHERE id = ?`,
    [firstName, lastName, displayName, now, req.user.id],
  );

  res.json({
    user: toPublicUser(db, {
      id: row.id,
      email: row.email,
      firstName,
      lastName,
      displayName,
      avatarUrl: row.avatar_url,
      createdAt: row.created_at,
      preferences_json: row.preferences_json,
    }),
  });
});

/**
 * Upload / set avatar. Body: { photoBase64: data URL | base64 }
 * or { avatarUrl: data URL } for small inline images stored as data URL in users.avatar_url.
 * Auth required. Max ~8MB for file upload path.
 */
router.post('/avatar', async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const db = await getDb();
  const row = loadUserRow(db, req.user.id);
  if (!row) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }

  const photoBase64 =
    typeof req.body?.photoBase64 === 'string'
      ? req.body.photoBase64
      : typeof req.body?.avatarUrl === 'string'
        ? req.body.avatarUrl
        : '';
  if (!photoBase64.trim()) {
    res.status(400).json({ error: 'photoBase64 (or avatarUrl) is required', code: 'MISSING_IMAGE' });
    return;
  }

  // Prefer server file upload; fall back to storing a short data URL in the column.
  let stored: string;
  try {
    // Remove prior file if we previously stored a path
    if (row.avatar_url && !row.avatar_url.startsWith('data:')) {
      deleteAvatarFile(row.avatar_url);
    }
    stored = saveUserAvatar(req.user.id, photoBase64);
  } catch (err) {
    // If decode fails for upload, allow small data URLs directly in DB
    const trimmed = photoBase64.trim();
    if (trimmed.startsWith('data:image/') && trimmed.length <= 400_000) {
      stored = trimmed;
    } else {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Invalid image',
        code: 'INVALID_IMAGE',
      });
      return;
    }
  }

  const now = new Date().toISOString();
  run(db, `UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?`, [
    stored,
    now,
    req.user.id,
  ]);

  res.json({
    user: toPublicUser(db, {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      displayName: row.display_name,
      avatarUrl: stored,
      createdAt: row.created_at,
      preferences_json: row.preferences_json,
    }),
  });
});

router.delete('/avatar', async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const db = await getDb();
  const row = loadUserRow(db, req.user.id);
  if (!row) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  if (row.avatar_url && !row.avatar_url.startsWith('data:')) {
    deleteAvatarFile(row.avatar_url);
  }
  const now = new Date().toISOString();
  run(db, `UPDATE users SET avatar_url = NULL, updated_at = ? WHERE id = ?`, [now, req.user.id]);
  res.json({
    user: toPublicUser(db, {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      displayName: row.display_name,
      avatarUrl: null,
      createdAt: row.created_at,
      preferences_json: row.preferences_json,
    }),
  });
});

/** Change password — requires current password. Auth required. */
router.post('/change-password', async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  if (!newPassword) {
    res.status(400).json({ error: 'currentPassword and newPassword are required', code: 'MISSING_FIELDS' });
    return;
  }
  const passErr = validatePassword(newPassword);
  if (passErr) {
    res.status(400).json({ error: passErr, code: 'INVALID_PASSWORD' });
    return;
  }

  const db = await getDb();
  const row = loadUserRow(db, req.user.id);
  if (!row) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  // Accounts created with Google / Apple / Microsoft have no password yet: this sets the first one.
  if (hasPassword(row.password_hash)) {
    if (!currentPassword) {
      res.status(400).json({ error: 'currentPassword and newPassword are required', code: 'MISSING_FIELDS' });
      return;
    }
    const ok = await verifyPassword(currentPassword, row.password_hash);
    if (!ok) {
      res.status(403).json({ error: 'Current password is incorrect', code: 'WRONG_PASSWORD' });
      return;
    }
  } else if (!(await recentlyConfirmed(db, req.user, null))) {
    // No password to check: setting the first one needs a sign-in in the last 15 minutes.
    res.status(403).json({ error: 'For your security, sign out and back in, then set your password within 15 minutes.', code: 'REAUTH_REQUIRED' });
    return;
  }

  const passwordHash = await hashPassword(newPassword);
  const now = new Date().toISOString();
  run(db, `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, [
    passwordHash,
    now,
    req.user.id,
  ]);
  // A new password should lock out anyone holding an old session elsewhere.
  const signedOut = req.user.sessionId ? revokeOtherSessions(db, req.user.id, req.user.sessionId) : 0;
  res.json({
    ok: true,
    signedOutSessions: signedOut,
    message: signedOut > 0 ? `Password updated. Signed out ${signedOut} other session${signedOut === 1 ? '' : 's'}.` : 'Password updated.',
  });
});

/** Change email — requires current password. Auth required. */
router.post('/change-email', async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const emailRaw = typeof req.body?.email === 'string' ? req.body.email : '';

  if (!currentPassword || !emailRaw) {
    res.status(400).json({ error: 'currentPassword and email are required', code: 'MISSING_FIELDS' });
    return;
  }
  const emailErr = validateEmail(emailRaw);
  if (emailErr) {
    res.status(400).json({ error: emailErr, code: 'INVALID_EMAIL' });
    return;
  }
  const email = normalizeEmail(emailRaw);

  const db = await getDb();
  const row = loadUserRow(db, req.user.id);
  if (!row) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const ok = await verifyPassword(currentPassword, row.password_hash);
  if (!ok) {
    res.status(403).json({ error: 'Current password is incorrect', code: 'WRONG_PASSWORD' });
    return;
  }
  if (email === row.email) {
    res.json({
      user: toPublicUser(db, {
        id: row.id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        createdAt: row.created_at,
        preferences_json: row.preferences_json,
      }),
      message: 'Email unchanged.',
    });
    return;
  }
  const taken = await getUserByEmail(email);
  if (taken && taken.id !== req.user.id) {
    res.status(409).json({ error: 'An account with that email already exists', code: 'EMAIL_TAKEN' });
    return;
  }

  if (emailEnabled()) {
    // Confirm the new address first; the current email keeps working until the link is opened.
    if (emailChangeTooSoon(db, req.user.id)) {
      res.status(429).json({ error: 'We just sent a link. Wait a minute before asking for another.', code: 'TOO_SOON' });
      return;
    }
    const { token } = startEmailChange(db, req.user.id, email);
    const link = `${shareBase(req)}/confirm-email#token=${token}`;
    const text = `Someone asked to change the email on a KoruLedger account to this address.\n\nIf it was you, open this link within 24 hours to confirm. Until then your current email keeps working. If it wasn't you, ignore this email and nothing changes.`;
    const sent = await sendEmail({
      fromName: 'KoruLedger',
      replyTo: null,
      to: [email],
      subject: 'Confirm your new KoruLedger email',
      text: `${text}\n\n${link}`,
      html: messageHtml(text, link, 'Confirm my new email'),
      attachment: null,
      idempotencyKey: `email-change-${token.slice(0, 24)}`,
    });
    if (!sent.ok) {
      cancelEmailChange(db, req.user.id);
      res.status(502).json({ error: 'Could not send the confirmation email. Try again shortly.', code: 'EMAIL_SEND_FAILED' });
      return;
    }
    // Heads-up to the current address, so an unexpected change can be noticed. Best effort.
    const notice = `Someone asked to change the email on your KoruLedger account to ${email}. It only changes once that address confirms it. If this wasn't you, sign in, cancel the change under Settings → Account, and change your password.`;
    await sendEmail({
      fromName: 'KoruLedger',
      replyTo: null,
      to: [row.email],
      subject: 'Your KoruLedger email is being changed',
      text: notice,
      html: messageHtml(notice, null),
      attachment: null,
      idempotencyKey: `email-change-notice-${token.slice(0, 24)}`,
    });
    res.json({
      user: toPublicUser(db, {
        id: row.id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        createdAt: row.created_at,
        preferences_json: row.preferences_json,
      }),
      pendingEmail: email,
      message: `Check ${email} to confirm. Your current email works until then.`,
    });
    return;
  }

  // Email sending isn't set up on this server: the change applies at once (the form says so).
  const now = new Date().toISOString();
  cancelEmailChange(db, req.user.id);
  run(db, `UPDATE users SET email = ?, updated_at = ? WHERE id = ?`, [email, now, req.user.id]);
  res.json({
    user: toPublicUser(db, {
      id: row.id,
      email,
      firstName: row.first_name,
      lastName: row.last_name,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      createdAt: row.created_at,
      preferences_json: row.preferences_json,
    }),
    message: 'Email updated.',
  });
});


/** Download a copy of everything stored for the signed-in account (JSON). Auth required. */
router.get('/export', async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const db = await getDb();
  const data = exportAccountData(db, req.user.id);
  if (!data) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const day = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="koruledger-account-${day}.json"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(JSON.stringify(data, null, 2));
});

/** Cancel a pending email change. Auth required. */
router.post('/change-email/cancel', async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const db = await getDb();
  cancelEmailChange(db, req.user.id);
  res.json({ ok: true });
});

/**
 * Confirm a new email from the emailed link (/confirm-email#token=…). Works signed out:
 * holding the link proves the mailbox; the password was checked when the change was asked for.
 * POST only, so mail scanners that open links don't confirm by accident.
 */
router.post('/confirm-email', async (req, res) => {
  const db = await getDb();
  const result = confirmEmailChange(db, typeof req.body?.token === 'string' ? req.body.token : '');
  if (!result.ok) {
    res.status(result.status).json({ error: result.error, code: result.code });
    return;
  }
  res.json({ ok: true, email: result.email });
});


/**
 * Permanently delete the signed-in account.
 * Body: { password: string, confirm: "DELETE" }
 * Removes: user row, all sessions, preferences (on user), avatar file,
 * per-user akahu_connections, and this user's scoped finance rows.
 * Does NOT wipe other users' data. Shared globals left intact (see AUTH.md):
 * app_settings defaults (locale/currency/timezone), price_quotes, meta keys other than data_owner.
 * GoMining inputs and collectable types live on the user and are deleted with them; a data
 * owner's legacy copies in app_settings go too, and the owner role is cleared, not passed on.
 * Keep src/lib/accountView.ts (the Deleted / Kept lists on the page) in step with this.
 */
router.post('/delete-account', async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const confirm = typeof req.body?.confirm === 'string' ? req.body.confirm.trim() : '';

  if (!password) {
    res.status(400).json({ error: 'password is required', code: 'MISSING_FIELDS' });
    return;
  }
  if (confirm !== 'DELETE') {
    res.status(400).json({
      error: 'Type DELETE to confirm account deletion',
      code: 'CONFIRM_REQUIRED',
    });
    return;
  }

  const db = await getDb();
  const row = loadUserRow(db, req.user.id);
  if (!row) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) {
    res.status(403).json({ error: 'Current password is incorrect', code: 'WRONG_PASSWORD' });
    return;
  }

  const userId = req.user.id;
  const wasOwner = getDataOwnerUserId(db) === userId;

  // 1) Scoped finance + holding photos (this user only)
  const scoped = deleteScopedDataForUser(db, userId);

  // 2) Per-user Akahu OAuth token (also CASCADE on user delete; explicit for clarity)
  const akahuBefore = queryOne<{ c: number }>(
    db,
    `SELECT COUNT(*) AS c FROM akahu_connections WHERE user_id = ?`,
    [userId],
  );
  run(db, `DELETE FROM akahu_connections WHERE user_id = ?`, [userId]);

  // 3) Avatar file
  if (row.avatar_url && !row.avatar_url.startsWith('data:')) {
    deleteAvatarFile(row.avatar_url);
  }

  // 4) All sessions for this user, plus 2FA backup codes / trusted devices / pending sign-ins
  const sessionsRemoved = destroySessionsForUser(db, userId);
  run(db, `DELETE FROM user_backup_codes WHERE user_id = ?`, [userId]);
  run(db, `DELETE FROM trusted_devices WHERE user_id = ?`, [userId]);
  run(db, `DELETE FROM login_challenges WHERE user_id = ?`, [userId]);
  run(db, `DELETE FROM user_identities WHERE user_id = ?`, [userId]);
  run(db, `DELETE FROM user_passkeys WHERE user_id = ?`, [userId]);
  run(db, `DELETE FROM webauthn_challenges WHERE user_id = ?`, [userId]);
  run(db, `DELETE FROM auth_events WHERE user_id = ?`, [userId]);
  run(db, `DELETE FROM user_entitlements WHERE user_id = ?`, [userId]);
  run(db, `DELETE FROM email_changes WHERE user_id = ?`, [userId]);

  // 5) data owner: cleared, never handed to another account. The owner role unlocks the
  //    server's shared Akahu token (the owner's bank feed) and the owner's legacy GoMining /
  //    collectable values in app_settings, so passing it on would expose them to someone else.
  if (wasOwner) {
    run(db, `DELETE FROM meta WHERE key = 'data_owner_user_id'`);
    run(db, `DELETE FROM meta WHERE key = 'data_claimed_at'`);
    run(db, `DELETE FROM app_settings WHERE key LIKE 'gomining%' OR key = 'collectableTypes'`);
  }

  // 6) User row (preferences_json lives here)
  run(db, `DELETE FROM users WHERE id = ?`, [userId]);

  // Clear cookie for this browser
  res.setHeader('Set-Cookie', clearSessionCookieHeader());
  res.json({
    ok: true,
    message: 'Account deleted.',
    deleted: {
      userId,
      sessions: sessionsRemoved,
      akahuConnections: Number(akahuBefore?.c ?? 0),
      scopedTables: scoped.tables,
      holdingPhotos: scoped.photosRemoved,
      wasDataOwner: wasOwner,
    },
    sharedDataRemaining: [
      'app_settings (locale, currency, timezone defaults)',
      'price_quotes (shared quote cache)',
      'meta (schema_version etc.; data_owner cleared)',
      '.env Akahu Personal App token (server env — not per-user; no owner may use it until one is set)',
    ],
  });
});


export default router;
