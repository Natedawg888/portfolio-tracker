/**
 * Personal accounts attach separate business users instead of changing into one.
 *
 * account_links.owner_user_id is the personal (or both) user. linked_user_id is the
 * business user. A business user is on at most one link (UNIQUE). An owner may have
 * up to 5. Every query takes the signed-in user's id; nothing lists another owner's links.
 *
 * Email: users.email is NOT NULL UNIQUE, so a created business account cannot store
 * NULL. It gets a synthetic address at LINKED_ACCOUNT_EMAIL_DOMAIN (.invalid is not a
 * mailbox). password_hash is NO_LOGIN until that account sets a password, passkey, or
 * single sign-on. It is opened only by switching.
 *
 * Deleting the personal account detaches those links and marks the business users for
 * deletion (preferences_json.pendingDeletion). Their books and Stripe customer stay,
 * so a billing failure on one of them cannot block the personal deletion, and their
 * subscription is not cancelled here. Sign-in is refused while the mark is set.
 */
import { randomUUID } from 'node:crypto';
import type { Database } from 'sql.js';
import type {
  AccountLinkParty,
  AccountLinksResponse,
  ActiveAccount,
  LinkedAccountSummary,
} from '../../src/types/accountLinks.ts';
import { mergeOnboardingIntoPreferencesJson } from '../../src/lib/onboardingPrefs.ts';
import { mergeRunsBusinessIntoPreferencesJson, withStarterBusinessCreated } from '../../src/lib/runsBusiness.ts';
import { mergeUsageModeIntoPreferencesJson } from '../../src/lib/usageMode.ts';
import { createBusiness, parseBusiness } from '../business/store.ts';
import { usageModeFor } from '../billing/planGuards.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { planOf } from '../lib/entitlements.ts';
import { destroySessionsForUser } from './sessions.ts';
import { NO_LOGIN, composeDisplayName, createUserAccount, signInMethodCount } from './users.ts';
import { LINKED_ACCOUNT_EMAIL_DOMAIN, isSyntheticLinkedEmail, publicEmail } from './syntheticEmail.ts';

export { LINKED_ACCOUNT_EMAIL_DOMAIN, isSyntheticLinkedEmail, publicEmail };

export const MAX_LINKED_ACCOUNTS = 5;

export const ACCOUNT_PENDING_DELETION = {
  status: 403 as const,
  code: 'ACCOUNT_PENDING_DELETION',
  error: 'This account is marked for deletion and can no longer be signed in to.',
};

export type LinkFailure = { ok: false; status: number; code: string; error: string };

type UserBits = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  preferences_json: string | null;
};

function prefsObject(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* unreadable preferences are replaced below */
  }
  return {};
}

export function isPendingDeletion(db: Database, userId: string): boolean {
  const row = queryOne<{ preferences_json: string | null }>(db, `SELECT preferences_json FROM users WHERE id = ?`, [userId]);
  const mark = prefsObject(row?.preferences_json).pendingDeletion;
  return Boolean(mark && typeof mark === 'object');
}

function withPendingDeletion(json: string | null, formerOwnerUserId: string): string {
  return JSON.stringify({
    ...prefsObject(json),
    pendingDeletion: {
      at: new Date().toISOString(),
      reason: 'owner_account_deleted',
      formerOwnerUserId,
    },
  });
}

export function syntheticLinkedEmail(): string {
  return `linked.${randomUUID()}@${LINKED_ACCOUNT_EMAIL_DOMAIN}`;
}

export function ownerUserIdOf(db: Database, userId: string): string | null {
  const row = queryOne<{ owner_user_id: string }>(
    db,
    `SELECT owner_user_id FROM account_links WHERE linked_user_id = ?`,
    [userId],
  );
  return row?.owner_user_id ?? null;
}

function ownedCount(db: Database, ownerId: string): number {
  return Number(queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM account_links WHERE owner_user_id = ?`, [ownerId])?.c ?? 0);
}

export function accountHasOwnLogin(db: Database, userId: string): boolean {
  return signInMethodCount(db, userId) > 0;
}

function loadUser(db: Database, userId: string): UserBits | null {
  return queryOne<UserBits>(
    db,
    `SELECT id, first_name, last_name, display_name, preferences_json FROM users WHERE id = ?`,
    [userId],
  );
}

function displayNameOf(row: UserBits): string | null {
  return composeDisplayName(row.first_name, row.last_name) || row.display_name?.trim() || null;
}

function businessNameOf(db: Database, userId: string): string | null {
  const row = queryOne<{ name: string }>(
    db,
    `SELECT name FROM businesses WHERE user_id = ? AND (archived_at IS NULL OR archived_at = '')
     ORDER BY is_default DESC, created_at ASC LIMIT 1`,
    [userId],
  );
  const name = row?.name?.trim();
  return name || null;
}

function party(db: Database, userId: string): AccountLinkParty {
  const row = loadUser(db, userId);
  const isLinkedBusiness = ownerUserIdOf(db, userId) != null;
  return {
    id: userId,
    displayName: row ? displayNameOf(row) : null,
    usageMode: usageModeFor(db, userId),
    plan: planOf(db, userId),
    isLinkedBusiness,
    canUnlink: isLinkedBusiness && accountHasOwnLogin(db, userId),
  };
}

function summary(db: Database, linkedUserId: string, viewerId: string): LinkedAccountSummary {
  const row = loadUser(db, linkedUserId);
  const hasOwnLogin = accountHasOwnLogin(db, linkedUserId);
  const ownerId = ownerUserIdOf(db, linkedUserId);
  return {
    id: linkedUserId,
    displayName: row ? displayNameOf(row) : null,
    businessName: businessNameOf(db, linkedUserId),
    plan: planOf(db, linkedUserId),
    hasOwnLogin,
    canUnlink: ownerId === viewerId && hasOwnLogin,
  };
}

export function activeAccountFor(db: Database, userId: string): ActiveAccount {
  const ownerId = ownerUserIdOf(db, userId);
  return {
    id: userId,
    usageMode: usageModeFor(db, userId),
    isLinkedBusiness: ownerId != null,
    hasOwnLogin: accountHasOwnLogin(db, userId),
    ownerId,
  };
}

function sessionOriginOwnerId(db: Database, userId: string, sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;
  const row = queryOne<{ origin_owner_user_id: string | null }>(
    db,
    `SELECT origin_owner_user_id FROM sessions WHERE id = ? AND user_id = ?`,
    [sessionId, userId],
  );
  return row?.origin_owner_user_id ?? null;
}

/** From either side: the owner sees linked businesses; a linked business sees its owner. */
export function listAccountLinks(db: Database, userId: string, sessionId?: string | null): AccountLinksResponse {
  const ownerId = ownerUserIdOf(db, userId);
  const rows = queryOwned(db, userId);
  const origin = sessionOriginOwnerId(db, userId, sessionId);
  return {
    current: party(db, userId),
    owner: ownerId ? party(db, ownerId) : null,
    linked: rows.map((id) => summary(db, id, userId)),
    canSwitchToOwner: ownerId != null && origin === ownerId,
  };
}

function queryOwned(db: Database, ownerId: string): string[] {
  return queryAll<{ linked_user_id: string }>(
    db,
    `SELECT linked_user_id FROM account_links WHERE owner_user_id = ? ORDER BY created_at ASC, id ASC`,
    [ownerId],
  ).map((row) => row.linked_user_id);
}

/** Personal or both, and not itself a linked business. Unset usage counts as personal. */
export function ownerMayLink(db: Database, userId: string): LinkFailure | null {
  if (ownerUserIdOf(db, userId)) {
    return {
      ok: false,
      status: 403,
      code: 'LINKED_BUSINESS_CANNOT_OWN',
      error: 'A linked business account can’t add another account.',
    };
  }
  const mode = usageModeFor(db, userId);
  if (mode !== 'personal' && mode !== 'both') {
    return {
      ok: false,
      status: 403,
      code: 'NOT_PERSONAL_ACCOUNT',
      error: 'Only a personal account can add a business account.',
    };
  }
  return null;
}

function capFailure(db: Database, ownerId: string): LinkFailure | null {
  if (ownedCount(db, ownerId) >= MAX_LINKED_ACCOUNTS) {
    return { ok: false, status: 409, code: 'LINK_LIMIT', error: 'You can link up to 5 business accounts.' };
  }
  return null;
}

function businessNameFailure(raw: unknown): { ok: true; name: string } | LinkFailure {
  if (typeof raw !== 'string') {
    return { ok: false, status: 400, code: 'INVALID_BUSINESS_NAME', error: 'Business name is required' };
  }
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, status: 400, code: 'INVALID_BUSINESS_NAME', error: 'Business name is required' };
  if (name.length > 120) {
    return { ok: false, status: 400, code: 'INVALID_BUSINESS_NAME', error: 'Business name must be 120 characters or less' };
  }
  return { ok: true, name };
}

function rollbackCreatedUser(db: Database, userId: string): void {
  run(db, `DELETE FROM businesses WHERE user_id = ?`, [userId]);
  run(db, `DELETE FROM budget_categories WHERE user_id = ?`, [userId]);
  run(db, `DELETE FROM account_links WHERE linked_user_id = ? OR owner_user_id = ?`, [userId, userId]);
  run(db, `DELETE FROM users WHERE id = ?`, [userId]);
}

export function createLinkedBusinessAccount(
  db: Database,
  ownerId: string,
  businessName: unknown,
): { ok: true; account: LinkedAccountSummary } | LinkFailure {
  const gate = ownerMayLink(db, ownerId);
  if (gate) return gate;
  const room = capFailure(db, ownerId);
  if (room) return room;
  const named = businessNameFailure(businessName);
  if (!named.ok) return named;
  const owner = loadUser(db, ownerId);
  if (!owner) return { ok: false, status: 401, code: 'UNAUTHORIZED', error: 'Authentication required' };

  const created = createUserAccount(db, {
    email: syntheticLinkedEmail(),
    passwordHash: NO_LOGIN,
    firstName: owner.first_name,
    lastName: owner.last_name,
  });
  const prefs = mergeOnboardingIntoPreferencesJson(
    withStarterBusinessCreated(mergeRunsBusinessIntoPreferencesJson(mergeUsageModeIntoPreferencesJson(created.preferencesJson, 'business'), true)),
    { assetClassesDone: true, budgetCategoriesDone: true, akahuStepDone: true, planStepDone: true },
  );
  run(db, `UPDATE users SET preferences_json = ?, updated_at = ? WHERE id = ?`, [prefs, new Date().toISOString(), created.id]);

  const parsed = parseBusiness({ name: named.name });
  if (!parsed.ok) {
    rollbackCreatedUser(db, created.id);
    return { ok: false, status: 400, code: 'INVALID_BUSINESS_NAME', error: parsed.error };
  }
  try {
    createBusiness(db, created.id, parsed.value);
    run(db, `INSERT INTO account_links (id, owner_user_id, linked_user_id, created_at) VALUES (?, ?, ?, ?)`, [
      newId('alk'),
      ownerId,
      created.id,
      new Date().toISOString(),
    ]);
  } catch (err) {
    rollbackCreatedUser(db, created.id);
    throw err;
  }
  return { ok: true, account: summary(db, created.id, ownerId) };
}

/** Caller has already checked the password the same way login does. */
export function linkExistingBusiness(db: Database, ownerId: string, linkedUserId: string): LinkFailure | { ok: true } {
  const gate = ownerMayLink(db, ownerId);
  if (gate) return gate;
  if (linkedUserId === ownerId) {
    return { ok: false, status: 409, code: 'CANNOT_LINK_SELF', error: 'You can’t link the account you’re signed in to.' };
  }
  if (isPendingDeletion(db, linkedUserId)) return { ok: false, ...ACCOUNT_PENDING_DELETION };
  if (usageModeFor(db, linkedUserId) !== 'business') {
    return { ok: false, status: 403, code: 'NOT_BUSINESS_ACCOUNT', error: 'That account isn’t a business account.' };
  }
  const existing = ownerUserIdOf(db, linkedUserId);
  if (existing) {
    return { ok: false, status: 409, code: 'ALREADY_LINKED', error: 'That business account is already linked to a personal account.' };
  }
  const room = capFailure(db, ownerId);
  if (room) return room;
  run(db, `INSERT INTO account_links (id, owner_user_id, linked_user_id, created_at) VALUES (?, ?, ?, ?)`, [
    newId('alk'),
    ownerId,
    linkedUserId,
    new Date().toISOString(),
  ]);
  return { ok: true };
}

export function unlinkBusiness(db: Database, actorId: string, linkedUserId: string): LinkFailure | { ok: true } {
  const row = queryOne<{ owner_user_id: string }>(
    db,
    `SELECT owner_user_id FROM account_links WHERE linked_user_id = ?`,
    [linkedUserId],
  );
  if (!row) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'That linked account was not found.' };
  const isOwner = row.owner_user_id === actorId;
  const isSelf = actorId === linkedUserId;
  if (!isOwner && !isSelf) {
    return { ok: false, status: 403, code: 'NOT_LINK_OWNER', error: 'Only the personal owner, or this business account itself, can unlink it.' };
  }
  if (!accountHasOwnLogin(db, linkedUserId)) {
    return {
      ok: false,
      status: 409,
      code: 'LINKED_ACCOUNT_HAS_NO_LOGIN',
      error: 'This business account has no login of its own, so it can’t be unlinked. Set a password on it first.',
    };
  }
  destroySwitchedInSessions(db, linkedUserId, row.owner_user_id);
  run(db, `DELETE FROM account_links WHERE linked_user_id = ?`, [linkedUserId]);
  return { ok: true };
}

/** Sessions opened by the owner switching in. A direct sign-in has no origin and is kept. */
export function destroySwitchedInSessions(db: Database, linkedUserId: string, ownerUserId: string): void {
  run(db, `DELETE FROM sessions WHERE user_id = ? AND origin_owner_user_id = ?`, [linkedUserId, ownerUserId]);
}

/**
 * Drop a switched-in session whose link is gone. Returns true when the session was destroyed.
 * Direct sign-ins (no origin) are left alone.
 */
export function destroyOrphanSwitchSession(db: Database, sessionId: string, userId: string): boolean {
  const row = queryOne<{ origin_owner_user_id: string | null }>(
    db,
    `SELECT origin_owner_user_id FROM sessions WHERE id = ? AND user_id = ?`,
    [sessionId, userId],
  );
  const origin = row?.origin_owner_user_id ?? null;
  if (!origin) return false;
  const link = queryOne(
    db,
    `SELECT id FROM account_links WHERE owner_user_id = ? AND linked_user_id = ?`,
    [origin, userId],
  );
  if (link) return false;
  run(db, `DELETE FROM sessions WHERE id = ?`, [sessionId]);
  return true;
}

/**
 * Owner → one of its linked accounts, or back to that owner.
 * Switching back is allowed only when this session was opened by that owner
 * (origin_owner_user_id). A business that signed in with its own password has
 * no origin and cannot enter the owner account.
 */
export function switchRelation(
  db: Database,
  fromUserId: string,
  toUserId: string,
  sessionOriginOwnerId: string | null,
): { originOwnerUserId: string | null } | null {
  const owned = queryOne(
    db,
    `SELECT id FROM account_links WHERE owner_user_id = ? AND linked_user_id = ?`,
    [fromUserId, toUserId],
  );
  if (owned) return { originOwnerUserId: fromUserId };
  const back = queryOne(
    db,
    `SELECT id FROM account_links WHERE owner_user_id = ? AND linked_user_id = ?`,
    [toUserId, fromUserId],
  );
  if (back && sessionOriginOwnerId === toUserId) return { originOwnerUserId: null };
  return null;
}

export type DetachOnDeletion = {
  /** Every link removed, including businesses that can still sign in. */
  detached: string[];
  /** Created accounts with no login. Marked for deletion; sign-in is refused. */
  markedForDeletion: string[];
};

/**
 * Remove every link this user owns or belongs to.
 * A linked business that can sign in (password, passkey, or single sign-on) is
 * only detached: no pendingDeletion. Sessions the owner switched into are
 * deleted. A session that business opened itself stays, and the account keeps working.
 * A created account with no login is marked pendingDeletion and signed out.
 * Stripe cancel and the purge run after the personal user is gone
 * (settleMarkedLinkedAccounts) so a billing failure cannot block this deletion.
 */
export function detachLinksOnAccountDeletion(db: Database, userId: string): DetachOnDeletion {
  const owned = queryOwned(db, userId);
  const markedForDeletion: string[] = [];
  const now = new Date().toISOString();
  for (const linkedId of owned) {
    destroySwitchedInSessions(db, linkedId, userId);
    if (accountHasOwnLogin(db, linkedId)) continue;
    const prefs = queryOne<{ preferences_json: string | null }>(db, `SELECT preferences_json FROM users WHERE id = ?`, [linkedId]);
    if (prefs) {
      run(db, `UPDATE users SET preferences_json = ?, updated_at = ? WHERE id = ?`, [
        withPendingDeletion(prefs.preferences_json, userId),
        now,
        linkedId,
      ]);
    }
    destroySessionsForUser(db, linkedId);
    markedForDeletion.push(linkedId);
  }
  run(db, `DELETE FROM account_links WHERE owner_user_id = ? OR linked_user_id = ?`, [userId, userId]);
  return { detached: owned, markedForDeletion };
}

/** Drop the link when this business user turns on two-factor sign-in. */
export function detachLinkForTwoFactor(db: Database, linkedUserId: string): boolean {
  const ownerId = ownerUserIdOf(db, linkedUserId);
  if (!ownerId) return false;
  destroySwitchedInSessions(db, linkedUserId, ownerId);
  run(db, `DELETE FROM account_links WHERE linked_user_id = ?`, [linkedUserId]);
  return true;
}
