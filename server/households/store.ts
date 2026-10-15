/**
 * Households (KAN-77): the household, members and roles, invites, leaving and removal,
 * ownership transfer, and an activity log. Sharing items is in sharing.ts.
 *
 * Access is decided from household_members on every call, so removing someone takes effect
 * on their next request. A user belongs to at most one household.
 *
 * Plan: the household feature follows its owner's plan (Plus or Pro), so one subscription
 * covers every member. Without it, members can still see the household, leave it, and the
 * owner can delete it, so nothing is ever stuck; creating, inviting and changing it need Plus.
 */
import crypto from 'node:crypto';
import type { Database } from 'sql.js';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { hasFeature } from '../lib/entitlements.ts';

export type Role = 'owner' | 'adult' | 'viewer';
export const INVITE_DAYS = 7;
export const MAX_PENDING_INVITES = 20;
export const MAX_MEMBERS = 12;

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code?: string };
const fail = (status: number, error: string, code?: string): { ok: false; status: number; error: string; code?: string } => ({ ok: false, status, error, code });
const PLAN_REQUIRED = () => fail(402, 'Households are part of KoruLedger Plus.', 'PLAN_REQUIRED');

export type Membership = { householdId: string; role: Role; ownerId: string; name: string };

export function membershipOf(db: Database, userId: string): Membership | null {
  const r = queryOne<{ household_id: string; role: Role; owner_id: string; name: string }>(
    db,
    `SELECT m.household_id, m.role, h.owner_id, h.name FROM household_members m
     JOIN households h ON h.id = m.household_id WHERE m.user_id = ?`,
    [userId],
  );
  return r ? { householdId: r.household_id, role: r.role, ownerId: r.owner_id, name: r.name } : null;
}

/** Owner's plan covers the household. */
export function householdActive(db: Database, m: Membership): boolean {
  return hasFeature(db, m.ownerId, 'household');
}

function displayName(db: Database, userId: string): string {
  const u = queryOne<{ display_name: string | null; first_name: string | null; last_name: string | null; email: string }>(
    db,
    `SELECT display_name, first_name, last_name, email FROM users WHERE id = ?`,
    [userId],
  );
  if (!u) return 'Someone';
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return (full || u.display_name || u.email.split('@')[0]).slice(0, 80);
}

export function logActivity(db: Database, householdId: string, actorId: string | null, action: string, detail = ''): void {
  run(
    db,
    `INSERT INTO household_activity (id, household_id, actor_id, actor_name, action, detail, created_at) VALUES (?,?,?,?,?,?,?)`,
    [newId('hact'), householdId, actorId, actorId ? displayName(db, actorId) : 'KoruLedger', action, detail.slice(0, 200), new Date().toISOString()],
  );
}

/**
 * A member's shares and shared pay (KAN-79) go when they leave, are removed or delete their
 * account; the items themselves stay theirs.
 */
function dropShares(db: Database, householdId: string, userId: string): void {
  run(db, `DELETE FROM household_shares WHERE household_id = ? AND owner_id = ?`, [householdId, userId]);
  run(db, `DELETE FROM household_pay WHERE household_id = ? AND user_id = ?`, [householdId, userId]);
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function cleanName(raw: unknown): string | null {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  return name && name.length <= 60 ? name : null;
}

// ---------------------------------------------------------------- reading

export type HouseholdView = {
  plan: { householdFeature: boolean };
  household: null | {
    id: string;
    name: string;
    active: boolean;
    myRole: Role;
    members: { userId: string; name: string; email: string; role: Role; joinedAt: string; isMe: boolean }[];
    invites: { id: string; email: string; role: Role; createdAt: string; expiresAt: string; expired: boolean }[];
    activity: { id: string; actorName: string; action: string; detail: string; createdAt: string }[];
  };
};

export function getHousehold(db: Database, userId: string, now = new Date()): HouseholdView {
  const plan = { householdFeature: hasFeature(db, userId, 'household') };
  const m = membershipOf(db, userId);
  if (!m) return { plan, household: null };
  const members = queryAll<{ user_id: string; role: Role; joined_at: string; email: string }>(
    db,
    `SELECT m.user_id, m.role, m.joined_at, u.email FROM household_members m JOIN users u ON u.id = m.user_id
     WHERE m.household_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'adult' THEN 1 ELSE 2 END, m.joined_at`,
    [m.householdId],
  ).map((r) => ({ userId: r.user_id, name: displayName(db, r.user_id), email: r.email, role: r.role, joinedAt: r.joined_at, isMe: r.user_id === userId }));
  // Only the owner manages invites, so only the owner sees invited email addresses.
  const invites =
    m.role === 'owner'
      ? queryAll<{ id: string; email: string; role: Role; created_at: string; expires_at: string }>(
          db,
          `SELECT id, email, role, created_at, expires_at FROM household_invites
           WHERE household_id = ? AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC`,
          [m.householdId],
        ).map((r) => ({ id: r.id, email: r.email, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at, expired: r.expires_at <= now.toISOString() }))
      : [];
  const activity = queryAll<{ id: string; actor_name: string; action: string; detail: string; created_at: string }>(
    db,
    `SELECT id, actor_name, action, detail, created_at FROM household_activity WHERE household_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`,
    [m.householdId],
  ).map((r) => ({ id: r.id, actorName: r.actor_name, action: r.action, detail: r.detail, createdAt: r.created_at }));
  return { plan, household: { id: m.householdId, name: m.name, active: householdActive(db, m), myRole: m.role, members, invites, activity } };
}

// ---------------------------------------------------------------- owner actions

export function createHousehold(db: Database, userId: string, body: unknown): Result<HouseholdView> {
  if (!hasFeature(db, userId, 'household')) return PLAN_REQUIRED();
  if (membershipOf(db, userId)) return fail(409, 'You are already in a household. Leave it first.');
  const name = cleanName((body as { name?: unknown } | null)?.name);
  if (!name) return fail(400, 'Household name is required (up to 60 characters)');
  const id = newId('hh');
  const now = new Date().toISOString();
  run(db, `INSERT INTO households (id, name, owner_id, created_at, updated_at) VALUES (?,?,?,?,?)`, [id, name, userId, now, now]);
  run(db, `INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES (?,?, 'owner', ?)`, [id, userId, now]);
  logActivity(db, id, userId, 'created the household', name);
  return { ok: true, value: getHousehold(db, userId) };
}

/** Owner-only actions on an active household. */
function ownerGate(db: Database, userId: string): Result<Membership> {
  const m = membershipOf(db, userId);
  if (!m) return fail(404, 'You are not in a household');
  if (m.role !== 'owner') return fail(403, 'Only the household owner can do that');
  if (!householdActive(db, m)) return PLAN_REQUIRED();
  return { ok: true, value: m };
}

export function renameHousehold(db: Database, userId: string, body: unknown): Result<HouseholdView> {
  const g = ownerGate(db, userId);
  if (!g.ok) return g;
  const name = cleanName((body as { name?: unknown } | null)?.name);
  if (!name) return fail(400, 'Household name is required (up to 60 characters)');
  run(db, `UPDATE households SET name = ?, updated_at = ? WHERE id = ?`, [name, new Date().toISOString(), g.value.householdId]);
  logActivity(db, g.value.householdId, userId, 'renamed the household', name);
  return { ok: true, value: getHousehold(db, userId) };
}

/** Owner can always delete, even without Plus, so nothing is ever stuck. */
export function deleteHousehold(db: Database, userId: string): Result<{ ok: true }> {
  const m = membershipOf(db, userId);
  if (!m) return fail(404, 'You are not in a household');
  if (m.role !== 'owner') return fail(403, 'Only the household owner can delete it');
  // Shared items never moved, so dropping the share rows returns them to their owners.
  run(db, `DELETE FROM household_shares WHERE household_id = ?`, [m.householdId]);
  run(db, `DELETE FROM household_split_shares WHERE split_id IN (SELECT id FROM household_splits WHERE household_id = ?)`, [m.householdId]);
  run(db, `DELETE FROM household_splits WHERE household_id = ?`, [m.householdId]);
  run(db, `DELETE FROM household_settlements WHERE household_id = ?`, [m.householdId]);
  run(db, `DELETE FROM household_pay WHERE household_id = ?`, [m.householdId]);
  run(db, `DELETE FROM household_pay_settings WHERE household_id = ?`, [m.householdId]);
  run(db, `DELETE FROM household_activity WHERE household_id = ?`, [m.householdId]);
  run(db, `DELETE FROM household_invites WHERE household_id = ?`, [m.householdId]);
  run(db, `DELETE FROM household_members WHERE household_id = ?`, [m.householdId]);
  run(db, `DELETE FROM households WHERE id = ?`, [m.householdId]);
  return { ok: true, value: { ok: true } };
}

export type InviteCreated = { view: HouseholdView; link: string; email: string; householdName: string; inviterName: string };

export function createInvite(db: Database, userId: string, body: unknown, linkBase: string, now = new Date()): Result<InviteCreated> {
  const g = ownerGate(db, userId);
  if (!g.ok) return g;
  const b = (body ?? {}) as { email?: unknown; role?: unknown };
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return fail(400, 'Enter a valid email address');
  const role: Role = b.role === 'viewer' ? 'viewer' : 'adult';
  const hh = g.value.householdId;
  const memberCount = Number(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM household_members WHERE household_id = ?`, [hh])?.n ?? 0);
  if (memberCount >= MAX_MEMBERS) return fail(409, `A household can have up to ${MAX_MEMBERS} members`);
  const already = queryOne(db, `SELECT 1 FROM household_members m JOIN users u ON u.id = m.user_id WHERE m.household_id = ? AND lower(u.email) = ?`, [hh, email]);
  if (already) return fail(409, 'That person is already in this household');
  const pending = queryAll<{ id: string; email: string }>(
    db,
    `SELECT id, email FROM household_invites WHERE household_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    [hh, now.toISOString()],
  );
  if (pending.length >= MAX_PENDING_INVITES) return fail(429, 'Too many invites waiting. Cancel some first.');
  // A new invite to the same address replaces the old one.
  for (const p of pending.filter((p) => p.email === email)) {
    run(db, `UPDATE household_invites SET revoked_at = ? WHERE id = ?`, [now.toISOString(), p.id]);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString();
  run(
    db,
    `INSERT INTO household_invites (id, household_id, email, role, token_hash, invited_by, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)`,
    [newId('hinv'), hh, email, role, hashToken(token), userId, now.toISOString(), expires],
  );
  logActivity(db, hh, userId, `invited someone as ${role === 'adult' ? 'an adult' : 'a viewer'}`);
  return {
    ok: true,
    value: {
      view: getHousehold(db, userId, now),
      link: `${linkBase.replace(/\/$/, '')}/household/join#token=${token}`,
      email,
      householdName: g.value.name,
      inviterName: displayName(db, userId),
    },
  };
}

export function revokeInvite(db: Database, userId: string, inviteId: string): Result<HouseholdView> {
  const g = ownerGate(db, userId);
  if (!g.ok) return g;
  const r = queryOne(db, `SELECT id FROM household_invites WHERE id = ? AND household_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`, [inviteId, g.value.householdId]);
  if (!r) return fail(404, 'Invite not found');
  run(db, `UPDATE household_invites SET revoked_at = ? WHERE id = ?`, [new Date().toISOString(), inviteId]);
  logActivity(db, g.value.householdId, userId, 'cancelled an invite');
  return { ok: true, value: getHousehold(db, userId) };
}

export function setRole(db: Database, userId: string, memberId: string, body: unknown): Result<HouseholdView> {
  const g = ownerGate(db, userId);
  if (!g.ok) return g;
  const role = (body as { role?: unknown } | null)?.role;
  if (role !== 'adult' && role !== 'viewer') return fail(400, 'Role must be adult or viewer');
  const target = queryOne<{ role: Role }>(db, `SELECT role FROM household_members WHERE household_id = ? AND user_id = ?`, [g.value.householdId, memberId]);
  if (!target) return fail(404, 'Member not found');
  if (target.role === 'owner') return fail(400, 'Transfer ownership to change the owner');
  run(db, `UPDATE household_members SET role = ? WHERE household_id = ? AND user_id = ?`, [role, g.value.householdId, memberId]);
  logActivity(db, g.value.householdId, userId, `made ${displayName(db, memberId)} ${role === 'adult' ? 'an adult' : 'a viewer'}`);
  return { ok: true, value: getHousehold(db, userId) };
}

export function removeMember(db: Database, userId: string, memberId: string): Result<HouseholdView> {
  const g = ownerGate(db, userId);
  if (!g.ok) return g;
  if (memberId === userId) return fail(400, 'You can’t remove yourself. Transfer ownership or delete the household.');
  const target = queryOne(db, `SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?`, [g.value.householdId, memberId]);
  if (!target) return fail(404, 'Member not found');
  const name = displayName(db, memberId);
  dropShares(db, g.value.householdId, memberId);
  run(db, `DELETE FROM household_members WHERE household_id = ? AND user_id = ?`, [g.value.householdId, memberId]);
  logActivity(db, g.value.householdId, userId, `removed ${name}`);
  return { ok: true, value: getHousehold(db, userId) };
}

/** The new owner must be an adult member with their own Plus, since their plan will cover the household. */
export function transferOwnership(db: Database, userId: string, body: unknown): Result<HouseholdView> {
  const g = ownerGate(db, userId);
  if (!g.ok) return g;
  const to = (body as { userId?: unknown } | null)?.userId;
  if (typeof to !== 'string' || to === userId) return fail(400, 'Choose another member');
  const target = queryOne<{ role: Role }>(db, `SELECT role FROM household_members WHERE household_id = ? AND user_id = ?`, [g.value.householdId, to]);
  if (!target) return fail(404, 'Member not found');
  if (target.role !== 'adult') return fail(400, 'Only an adult member can become the owner');
  if (!hasFeature(db, to, 'household')) return fail(402, 'The new owner needs KoruLedger Plus, since their plan covers the household.', 'PLAN_REQUIRED');
  const hh = g.value.householdId;
  run(db, `UPDATE household_members SET role = 'adult' WHERE household_id = ? AND user_id = ?`, [hh, userId]);
  run(db, `UPDATE household_members SET role = 'owner' WHERE household_id = ? AND user_id = ?`, [hh, to]);
  run(db, `UPDATE households SET owner_id = ?, updated_at = ? WHERE id = ?`, [to, new Date().toISOString(), hh]);
  logActivity(db, hh, userId, `made ${displayName(db, to)} the owner`);
  return { ok: true, value: getHousehold(db, userId) };
}

// ---------------------------------------------------------------- member actions

/** Members can always leave. The owner transfers ownership or deletes the household instead. */
export function leaveHousehold(db: Database, userId: string): Result<{ ok: true }> {
  const m = membershipOf(db, userId);
  if (!m) return fail(404, 'You are not in a household');
  if (m.role === 'owner') return fail(400, 'Transfer ownership or delete the household first');
  logActivity(db, m.householdId, userId, 'left the household');
  dropShares(db, m.householdId, userId);
  run(db, `DELETE FROM household_members WHERE household_id = ? AND user_id = ?`, [m.householdId, userId]);
  return { ok: true, value: { ok: true } };
}

type InviteRow = { id: string; household_id: string; email: string; role: Role; expires_at: string; accepted_at: string | null; revoked_at: string | null };

function findInvite(db: Database, token: unknown): InviteRow | null {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  return queryOne<InviteRow>(db, `SELECT * FROM household_invites WHERE token_hash = ?`, [hashToken(token)]) ?? null;
}

function inviteProblem(db: Database, userId: string, inv: InviteRow | null, now: Date): { status: number; error: string } | null {
  if (!inv || inv.revoked_at) return { status: 404, error: 'This invite link isn’t valid. Ask for a new one.' };
  if (inv.accepted_at) return { status: 410, error: 'This invite has already been used.' };
  if (inv.expires_at <= now.toISOString()) return { status: 410, error: 'This invite has expired. Ask for a new one.' };
  const me = queryOne<{ email: string }>(db, `SELECT email FROM users WHERE id = ?`, [userId]);
  if (!me || me.email.toLowerCase() !== inv.email) return { status: 403, error: `This invite is for ${inv.email}. Sign in with that account to accept it.` };
  return null;
}

export function previewInvite(db: Database, userId: string, token: unknown, now = new Date()): Result<{ householdName: string; inviterName: string; role: Role; alreadyInHousehold: boolean }> {
  const inv = findInvite(db, token);
  const problem = inviteProblem(db, userId, inv, now);
  if (problem) return fail(problem.status, problem.error);
  const hh = queryOne<{ name: string; owner_id: string }>(db, `SELECT name, owner_id FROM households WHERE id = ?`, [inv!.household_id]);
  if (!hh) return fail(404, 'This household no longer exists.');
  return { ok: true, value: { householdName: hh.name, inviterName: displayName(db, hh.owner_id), role: inv!.role, alreadyInHousehold: !!membershipOf(db, userId) } };
}

export function acceptInvite(db: Database, userId: string, token: unknown, now = new Date()): Result<HouseholdView> {
  const inv = findInvite(db, token);
  const problem = inviteProblem(db, userId, inv, now);
  if (problem) return fail(problem.status, problem.error);
  if (membershipOf(db, userId)) return fail(409, 'You are already in a household. Leave it first.');
  const hh = queryOne<{ owner_id: string }>(db, `SELECT owner_id FROM households WHERE id = ?`, [inv!.household_id]);
  if (!hh) return fail(404, 'This household no longer exists.');
  if (!hasFeature(db, hh.owner_id, 'household')) return PLAN_REQUIRED();
  const count = Number(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM household_members WHERE household_id = ?`, [inv!.household_id])?.n ?? 0);
  if (count >= MAX_MEMBERS) return fail(409, `A household can have up to ${MAX_MEMBERS} members`);
  run(db, `UPDATE household_invites SET accepted_at = ? WHERE id = ?`, [now.toISOString(), inv!.id]);
  run(db, `INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES (?,?,?,?)`, [inv!.household_id, userId, inv!.role, now.toISOString()]);
  logActivity(db, inv!.household_id, userId, `joined as ${inv!.role === 'adult' ? 'an adult' : 'a viewer'}`);
  return { ok: true, value: getHousehold(db, userId, now) };
}

/**
 * Account delete. A member just leaves. An owner's household passes to the longest-standing
 * adult who has Plus; with no such adult it is deleted (members keep everything of their own).
 */
export function removeUserFromHouseholds(db: Database, userId: string): void {
  const m = membershipOf(db, userId);
  if (!m) return;
  if (m.role !== 'owner') {
    logActivity(db, m.householdId, null, `${displayName(db, userId)} deleted their account and left`);
    dropShares(db, m.householdId, userId);
    run(db, `DELETE FROM household_members WHERE user_id = ?`, [userId]);
    return;
  }
  const heir = queryAll<{ user_id: string }>(
    db,
    `SELECT user_id FROM household_members WHERE household_id = ? AND role = 'adult' ORDER BY joined_at`,
    [m.householdId],
  ).find((a) => hasFeature(db, a.user_id, 'household'));
  if (heir) {
    run(db, `UPDATE household_members SET role = 'owner' WHERE household_id = ? AND user_id = ?`, [m.householdId, heir.user_id]);
    run(db, `UPDATE households SET owner_id = ?, updated_at = ? WHERE id = ?`, [heir.user_id, new Date().toISOString(), m.householdId]);
    logActivity(db, m.householdId, null, `${displayName(db, userId)} deleted their account; ${displayName(db, heir.user_id)} is now the owner`);
    dropShares(db, m.householdId, userId);
    run(db, `DELETE FROM household_members WHERE user_id = ?`, [userId]);
    return;
  }
  deleteHousehold(db, userId);
}
