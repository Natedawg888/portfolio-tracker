/**
 * Email/password auth — create account, login, logout, session probe,
 * profile (first/last name / avatar), change email & password.
 * First signup claims existing local finance data; later users get empty scoped ledgers.
 */
import { Router } from 'express';
import { getDb, queryOne, run, newId } from '../db/index.ts';
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
  createSession,
  destroySessionByToken,
  destroySessionsForUser,
  getUserByEmail,
  parseCookieHeader,
  sessionCookieHeader,
  clearSessionCookieHeader,
  purgeExpiredSessions,
} from '../auth/sessions.ts';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import {
  claimUnscopedRowsForOwner,
  deleteScopedDataForUser,
  getDataOwnerUserId,
} from '../lib/userScope.ts';
import { seedCategoriesForUser } from '../lib/categories.ts';
import {
  deleteAvatarFile,
  photoUrlFromPath,
  saveUserAvatar,
} from '../lib/uploads.ts';
import {
  initialPreferencesJsonForNewUser,
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

/** Compose "First Last" for display; null if both missing. */
function composeDisplayName(first: string | null, last: string | null): string | null {
  const parts = [first, last].filter((p): p is string => Boolean(p && p.trim()));
  if (parts.length === 0) return null;
  return parts.join(' ').slice(0, 80);
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
  return publicUser({ ...u, preferences_json });
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

/** Setup / session status (safe for unauthenticated clients). */
router.get('/status', async (_req, res) => {
  const db = await getDb();
  purgeExpiredSessions(db);
  const users = await countUsers();
  const claimed = queryOne<{ value: string }>(db, `SELECT value FROM meta WHERE key = 'data_owner_user_id'`);
  res.json({
    hasUsers: users > 0,
    userCount: users,
    needsSetup: users === 0,
    dataClaimed: Boolean(claimed?.value),
    firstSignupClaimsData: true,
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
  const usersBefore = await countUsers();
  const id = newId('user');
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  const displayName = composeDisplayName(firstName, lastName);

  const prefsJson = initialPreferencesJsonForNewUser(email);
  run(
    db,
    `INSERT INTO users (id, email, password_hash, first_name, last_name, display_name, avatar_url, preferences_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    [id, email, passwordHash, firstName, lastName, displayName, prefsJson, now, now],
  );

  let claimedExistingData = false;
  if (usersBefore === 0) {
    run(db, `INSERT OR REPLACE INTO meta (key, value) VALUES ('data_owner_user_id', ?)`, [id]);
    run(db, `INSERT OR REPLACE INTO meta (key, value) VALUES ('data_claimed_at', ?)`, [now]);
    claimUnscopedRowsForOwner(db, id);
    claimedExistingData = true;
  }
  // Every user gets their own budget category set (owner claims legacy globals).
  seedCategoriesForUser(db, id);
  // Later signups intentionally get empty finance rows (holdings/txns/etc.).

  const { rawToken, expiresAt } = await createSession(id);
  res.setHeader('Set-Cookie', sessionCookieHeader(rawToken, expiresAt));
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

  const user = await getUserByEmail(email);
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !ok) {
    res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    return;
  }

  const db = await getDb();
  const row = loadUserRow(db, user.id);
  const { rawToken, expiresAt } = await createSession(user.id);
  res.setHeader('Set-Cookie', sessionCookieHeader(rawToken, expiresAt));
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

router.post('/logout', async (req, res) => {
  const raw = parseCookieHeader(req.headers.cookie, SESSION_COOKIE);
  await destroySessionByToken(raw);
  res.setHeader('Set-Cookie', clearSessionCookieHeader());
  res.json({ ok: true });
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

  if (!currentPassword || !newPassword) {
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
  const ok = await verifyPassword(currentPassword, row.password_hash);
  if (!ok) {
    res.status(403).json({ error: 'Current password is incorrect', code: 'WRONG_PASSWORD' });
    return;
  }

  const passwordHash = await hashPassword(newPassword);
  const now = new Date().toISOString();
  run(db, `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, [
    passwordHash,
    now,
    req.user.id,
  ]);
  res.json({ ok: true, message: 'Password updated.' });
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

  const now = new Date().toISOString();
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


/**
 * Permanently delete the signed-in account.
 * Body: { password: string, confirm: "DELETE" }
 * Removes: user row, all sessions, preferences (on user), avatar file,
 * per-user akahu_connections, and this user's scoped finance rows.
 * Does NOT wipe other users' data. Shared globals left intact (see AUTH.md):
 * app_settings, price_quotes, meta keys other than data_owner.
 * (budget_categories are per-user and deleted with scoped data.)
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

  // 4) All sessions for this user
  const sessionsRemoved = destroySessionsForUser(db, userId);

  // 5) data_owner_user_id — reassign or clear; never leave a dangling owner id
  if (wasOwner) {
    const nextOwner = queryOne<{ id: string }>(
      db,
      `SELECT id FROM users WHERE id != ? ORDER BY created_at ASC LIMIT 1`,
      [userId],
    );
    if (nextOwner?.id) {
      run(db, `INSERT OR REPLACE INTO meta (key, value) VALUES ('data_owner_user_id', ?)`, [
        nextOwner.id,
      ]);
      claimUnscopedRowsForOwner(db, nextOwner.id);
    } else {
      run(db, `DELETE FROM meta WHERE key = 'data_owner_user_id'`);
      run(db, `DELETE FROM meta WHERE key = 'data_claimed_at'`);
    }
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
      // budget_categories now per-user and removed with scoped delete
      'app_settings (GoMining params, collectable types, locale)',
      'price_quotes (shared quote cache)',
      'meta (schema_version etc.; data_owner cleared or reassigned)',
      '.env Akahu Personal App token (server env — not per-user)',
    ],
  });
});


export default router;
