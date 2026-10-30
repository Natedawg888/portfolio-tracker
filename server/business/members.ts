/**
 * Accountant and viewer access to a business's books (KAN-129, phase 1).
 *
 * The owner is businesses.user_id. They invite people by email as an accountant (reads and edits
 * the books) or a viewer (reads only), and can change their role or remove them at any time. A
 * member can leave. Every row stays under the owner's user_id; the business router resolves which
 * business a request touches, checks the caller's role here, and then acts as the owner
 * (server/routes/business.ts). Access is read fresh on every request, so removal takes effect on
 * the next one.
 *
 * Members never see the owner's personal data: only routes that name a business, or a record of
 * one, are scoped to it. Encryption (KAN-106) wraps a per-business key to each member; that lands
 * with KAN-112.
 *
 * Plan: the accountant's Business plan unlocks reports, GST and the export on every business they
 * belong to, for them and for the owner (businessReportsUnlocked).
 */
import crypto from 'node:crypto';
import type { Database } from 'sql.js';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { hasFeature } from '../lib/entitlements.ts';
import { displayName } from '../households/store.ts';

export type BusinessRole = 'owner' | 'accountant' | 'viewer';
export type MemberRole = Exclude<BusinessRole, 'owner'>;
export const INVITE_DAYS = 7;
export const MAX_PENDING_INVITES = 20;
export const MAX_MEMBERS = 10;

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });
const NOT_FOUND = () => fail(404, 'Business not found');

export type Access = { businessId: string; ownerId: string; role: BusinessRole };

/** The caller's role on a business, or null when they have none (or it doesn't exist). */
export function businessAccess(db: Database, userId: string, businessId: string): Access | null {
  const b = queryOne<{ user_id: string }>(db, `SELECT user_id FROM businesses WHERE id = ?`, [businessId]);
  if (!b) return null;
  if (b.user_id === userId) return { businessId, ownerId: userId, role: 'owner' };
  const m = queryOne<{ role: MemberRole }>(db, `SELECT role FROM business_members WHERE business_id = ? AND user_id = ?`, [businessId, userId]);
  return m ? { businessId, ownerId: b.user_id, role: m.role } : null;
}

/**
 * Records a route can name, and how to find their business. Movements have no business_id of
 * their own, so they go through their asset.
 */
export const RESOURCE_SQL = {
  business: `SELECT id AS business_id, user_id FROM businesses WHERE id = ?`,
  asset: `SELECT business_id, user_id FROM business_assets WHERE id = ?`,
  movement: `SELECT a.business_id, m.user_id FROM business_asset_movements m
             JOIN business_assets a ON a.id = m.asset_id AND a.user_id = m.user_id WHERE m.id = ?`,
  employee: `SELECT business_id, user_id FROM business_employees WHERE id = ?`,
  stockItem: `SELECT business_id, user_id FROM business_stock_items WHERE id = ?`,
  stockBatch: `SELECT business_id, user_id FROM business_stock_batches WHERE id = ?`,
  stockAdjustment: `SELECT business_id, user_id FROM business_stock_adjustments WHERE id = ?`,
  supplier: `SELECT business_id, user_id FROM business_suppliers WHERE id = ?`,
  bill: `SELECT business_id, user_id FROM business_supplier_invoices WHERE id = ?`,
  client: `SELECT business_id, user_id FROM invoice_clients WHERE id = ?`,
  sale: `SELECT business_id, user_id FROM business_sales WHERE id = ?`,
} as const;
export type ResourceKind = keyof typeof RESOURCE_SQL;

/** The caller's access to the business a record belongs to; null when none (or no such record). */
export function resourceAccess(db: Database, userId: string, kind: ResourceKind, id: string): Access | null {
  const r = queryOne<{ business_id: string | null; user_id: string | null }>(db, RESOURCE_SQL[kind], [id]);
  if (!r?.business_id || !r.user_id) return null;
  const access = businessAccess(db, userId, r.business_id);
  // A record under someone other than the business's owner is never reachable through it.
  return access && access.ownerId === r.user_id ? access : null;
}

/** What a role may do on a request. Owner-only actions are checked separately (OWNER_ONLY in the router). */
export function roleAllows(role: BusinessRole, method: string): boolean {
  if (role === 'viewer') return method === 'GET' || method === 'HEAD';
  return true;
}

/** Reports unlock with the caller's own Business plan, or any accountant's on this business. */
export function businessReportsUnlocked(db: Database, userId: string, businessId: string | null): boolean {
  if (hasFeature(db, userId, 'business_reports')) return true;
  if (!businessId) return false;
  return queryAll<{ user_id: string }>(db, `SELECT user_id FROM business_members WHERE business_id = ? AND role = 'accountant'`, [businessId]).some((m) =>
    hasFeature(db, m.user_id, 'business_reports'),
  );
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function logActivity(db: Database, businessId: string, actorId: string | null, action: string, now = new Date()): void {
  run(
    db,
    `INSERT INTO business_member_activity (id, business_id, actor_id, actor_name, action, created_at) VALUES (?,?,?,?,?,?)`,
    [newId('bact'), businessId, actorId, actorId ? displayName(db, actorId) : 'KoruLedger', action, now.toISOString()],
  );
}

const roleWords = (role: MemberRole) => (role === 'accountant' ? 'an accountant' : 'a viewer');

export type MembersView = {
  businessId: string;
  businessName: string;
  myRole: BusinessRole;
  owner: { userId: string; name: string };
  members: { userId: string; name: string; email: string | null; role: MemberRole; joinedAt: string }[];
  /** Pending invites; the owner only. */
  invites: { id: string; email: string; role: MemberRole; createdAt: string; expiresAt: string }[];
  activity: { actorName: string; action: string; createdAt: string }[];
};

export function getMembers(db: Database, userId: string, businessId: string, now = new Date()): Result<MembersView> {
  const a = businessAccess(db, userId, businessId);
  if (!a) return NOT_FOUND();
  const b = queryOne<{ name: string }>(db, `SELECT name FROM businesses WHERE id = ?`, [businessId])!;
  const isOwner = a.role === 'owner';
  const members = queryAll<{ user_id: string; role: MemberRole; joined_at: string; email: string | null }>(
    db,
    `SELECT m.user_id, m.role, m.joined_at, u.email FROM business_members m LEFT JOIN users u ON u.id = m.user_id
     WHERE m.business_id = ? ORDER BY m.joined_at`,
    [businessId],
  ).map((m) => ({
    userId: m.user_id,
    name: displayName(db, m.user_id),
    // Email addresses are for the owner, who manages access, and for each person's own row.
    email: isOwner || m.user_id === userId ? (m.email ?? null) : null,
    role: m.role,
    joinedAt: m.joined_at,
  }));
  const invites = isOwner
    ? queryAll<{ id: string; email: string; role: MemberRole; created_at: string; expires_at: string }>(
        db,
        `SELECT id, email, role, created_at, expires_at FROM business_invites
         WHERE business_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at`,
        [businessId, now.toISOString()],
      ).map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.created_at, expiresAt: i.expires_at }))
    : [];
  const activity = queryAll<{ actor_name: string; action: string; created_at: string }>(
    db,
    `SELECT actor_name, action, created_at FROM business_member_activity WHERE business_id = ? ORDER BY created_at DESC LIMIT 30`,
    [businessId],
  ).map((r) => ({ actorName: r.actor_name, action: r.action, createdAt: r.created_at }));
  return {
    ok: true,
    value: {
      businessId,
      businessName: b.name,
      myRole: a.role,
      owner: { userId: a.ownerId, name: displayName(db, a.ownerId) },
      members,
      invites,
      activity,
    },
  };
}

function ownerOf(db: Database, userId: string, businessId: string): Result<Access> {
  const a = businessAccess(db, userId, businessId);
  if (!a) return NOT_FOUND();
  if (a.role !== 'owner') return fail(403, 'Only the business owner can change who has access.');
  return { ok: true, value: a };
}

function parseRole(raw: unknown): MemberRole | null {
  return raw === 'accountant' || raw === 'viewer' ? raw : null;
}

export type InviteCreated = { view: MembersView; link: string; email: string; businessName: string; inviterName: string; role: MemberRole };

export function createInvite(db: Database, userId: string, businessId: string, body: unknown, linkBase: string, now = new Date()): Result<InviteCreated> {
  const g = ownerOf(db, userId, businessId);
  if (!g.ok) return g;
  const b = (body ?? {}) as { email?: unknown; role?: unknown };
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return fail(400, 'Enter a valid email address');
  const role = parseRole(b.role ?? 'accountant');
  if (!role) return fail(400, 'role must be accountant or viewer');
  const me = queryOne<{ email: string }>(db, `SELECT email FROM users WHERE id = ?`, [userId]);
  if (me && me.email.toLowerCase() === email) return fail(400, 'You already own this business');
  const count = Number(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM business_members WHERE business_id = ?`, [businessId])?.n ?? 0);
  if (count >= MAX_MEMBERS) return fail(409, `A business can have up to ${MAX_MEMBERS} people with access`);
  const already = queryOne(db, `SELECT 1 FROM business_members m JOIN users u ON u.id = m.user_id WHERE m.business_id = ? AND lower(u.email) = ?`, [businessId, email]);
  if (already) return fail(409, 'That person already has access. Change their role instead.');
  const pending = queryAll<{ id: string; email: string }>(
    db,
    `SELECT id, email FROM business_invites WHERE business_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    [businessId, now.toISOString()],
  );
  if (pending.length >= MAX_PENDING_INVITES) return fail(429, 'Too many invites waiting. Cancel some first.');
  // A new invite to the same address replaces the old one.
  for (const p of pending.filter((p) => p.email === email)) {
    run(db, `UPDATE business_invites SET revoked_at = ? WHERE id = ?`, [now.toISOString(), p.id]);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString();
  run(
    db,
    `INSERT INTO business_invites (id, business_id, email, role, token_hash, invited_by, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)`,
    [newId('binv'), businessId, email, role, hashToken(token), userId, now.toISOString(), expires],
  );
  logActivity(db, businessId, userId, `invited someone as ${roleWords(role)}`, now);
  const view = getMembers(db, userId, businessId, now);
  if (!view.ok) return view;
  const name = queryOne<{ name: string }>(db, `SELECT name FROM businesses WHERE id = ?`, [businessId])!.name;
  return {
    ok: true,
    value: {
      view: view.value,
      link: `${linkBase.replace(/\/$/, '')}/business/join#token=${token}`,
      email,
      businessName: name,
      inviterName: displayName(db, userId),
      role,
    },
  };
}

export function revokeInvite(db: Database, userId: string, businessId: string, inviteId: string): Result<MembersView> {
  const g = ownerOf(db, userId, businessId);
  if (!g.ok) return g;
  const r = queryOne(db, `SELECT id FROM business_invites WHERE id = ? AND business_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`, [inviteId, businessId]);
  if (!r) return fail(404, 'Invite not found');
  run(db, `UPDATE business_invites SET revoked_at = ? WHERE id = ?`, [new Date().toISOString(), inviteId]);
  logActivity(db, businessId, userId, 'cancelled an invite');
  return getMembers(db, userId, businessId);
}

type InviteRow = { id: string; business_id: string; email: string; role: MemberRole; expires_at: string; accepted_at: string | null; revoked_at: string | null };

function findInvite(db: Database, token: unknown): InviteRow | null {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  return queryOne<InviteRow>(db, `SELECT * FROM business_invites WHERE token_hash = ?`, [hashToken(token)]) ?? null;
}

function inviteProblem(db: Database, userId: string, inv: InviteRow | null, now: Date): { status: number; error: string } | null {
  if (!inv || inv.revoked_at) return { status: 404, error: 'This invite link isn’t valid. Ask for a new one.' };
  if (inv.accepted_at) return { status: 410, error: 'This invite has already been used.' };
  if (inv.expires_at <= now.toISOString()) return { status: 410, error: 'This invite has expired. Ask for a new one.' };
  const me = queryOne<{ email: string }>(db, `SELECT email FROM users WHERE id = ?`, [userId]);
  if (!me || me.email.toLowerCase() !== inv.email) return { status: 403, error: `This invite is for ${inv.email}. Sign in with that account to accept it.` };
  return null;
}

export type InvitePreview = { businessId: string; businessName: string; ownerName: string; role: MemberRole; alreadyMember: boolean };

export function previewInvite(db: Database, userId: string, token: unknown, now = new Date()): Result<InvitePreview> {
  const inv = findInvite(db, token);
  const problem = inviteProblem(db, userId, inv, now);
  if (problem) return fail(problem.status, problem.error);
  const b = queryOne<{ name: string; user_id: string }>(db, `SELECT name, user_id FROM businesses WHERE id = ?`, [inv!.business_id]);
  if (!b) return fail(404, 'This business no longer exists.');
  return {
    ok: true,
    value: {
      businessId: inv!.business_id,
      businessName: b.name,
      ownerName: displayName(db, b.user_id),
      role: inv!.role,
      alreadyMember: !!businessAccess(db, userId, inv!.business_id),
    },
  };
}

export function acceptInvite(db: Database, userId: string, token: unknown, now = new Date()): Result<{ businessId: string; role: MemberRole }> {
  const inv = findInvite(db, token);
  const problem = inviteProblem(db, userId, inv, now);
  if (problem) return fail(problem.status, problem.error);
  const b = queryOne<{ user_id: string }>(db, `SELECT user_id FROM businesses WHERE id = ?`, [inv!.business_id]);
  if (!b) return fail(404, 'This business no longer exists.');
  if (b.user_id === userId) return fail(409, 'You already own this business.');
  if (businessAccess(db, userId, inv!.business_id)) return fail(409, 'You already have access to this business.');
  const count = Number(queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM business_members WHERE business_id = ?`, [inv!.business_id])?.n ?? 0);
  if (count >= MAX_MEMBERS) return fail(409, `A business can have up to ${MAX_MEMBERS} people with access`);
  run(db, `UPDATE business_invites SET accepted_at = ? WHERE id = ?`, [now.toISOString(), inv!.id]);
  run(db, `INSERT INTO business_members (business_id, user_id, role, added_by, joined_at) VALUES (?,?,?,?,?)`, [
    inv!.business_id,
    userId,
    inv!.role,
    queryOne<{ invited_by: string }>(db, `SELECT invited_by FROM business_invites WHERE id = ?`, [inv!.id])?.invited_by ?? b.user_id,
    now.toISOString(),
  ]);
  logActivity(db, inv!.business_id, userId, `joined as ${roleWords(inv!.role)}`, now);
  return { ok: true, value: { businessId: inv!.business_id, role: inv!.role } };
}

export function setMemberRole(db: Database, userId: string, businessId: string, memberId: string, body: unknown): Result<MembersView> {
  const g = ownerOf(db, userId, businessId);
  if (!g.ok) return g;
  const role = parseRole((body as { role?: unknown } | null)?.role);
  if (!role) return fail(400, 'role must be accountant or viewer');
  const m = queryOne(db, `SELECT 1 FROM business_members WHERE business_id = ? AND user_id = ?`, [businessId, memberId]);
  if (!m) return fail(404, 'That person doesn’t have access to this business');
  run(db, `UPDATE business_members SET role = ? WHERE business_id = ? AND user_id = ?`, [role, businessId, memberId]);
  logActivity(db, businessId, userId, `made ${displayName(db, memberId)} ${roleWords(role)}`);
  return getMembers(db, userId, businessId);
}

/** The owner removes someone, or a member removes themself (leaves). */
export function removeMember(db: Database, userId: string, businessId: string, memberId: string): Result<{ ok: true; left: boolean }> {
  const a = businessAccess(db, userId, businessId);
  if (!a) return NOT_FOUND();
  const leaving = memberId === userId;
  if (!leaving && a.role !== 'owner') return fail(403, 'Only the business owner can remove people.');
  if (leaving && a.role === 'owner') return fail(400, 'The owner can’t leave their own business.');
  const m = queryOne(db, `SELECT 1 FROM business_members WHERE business_id = ? AND user_id = ?`, [businessId, memberId]);
  if (!m) return fail(404, 'That person doesn’t have access to this business');
  run(db, `DELETE FROM business_members WHERE business_id = ? AND user_id = ?`, [businessId, memberId]);
  logActivity(db, businessId, userId, leaving ? 'left' : `removed ${displayName(db, memberId)}`);
  return { ok: true, value: { ok: true, left: leaving } };
}

export type SharedBusiness = { id: string; name: string; ownerName: string; role: MemberRole; archived: boolean; joinedAt: string };

/** Businesses other people have let this user into (the accountant's client list). */
export function sharedWithMe(db: Database, userId: string): SharedBusiness[] {
  return queryAll<{ id: string; name: string; user_id: string; archived_at: string | null; role: MemberRole; joined_at: string }>(
    db,
    `SELECT b.id, b.name, b.user_id, b.archived_at, m.role, m.joined_at FROM business_members m
     JOIN businesses b ON b.id = m.business_id WHERE m.user_id = ? ORDER BY lower(b.name)`,
    [userId],
  ).map((r) => ({ id: r.id, name: r.name, ownerName: displayName(db, r.user_id), role: r.role, archived: !!r.archived_at, joinedAt: r.joined_at }));
}

/** A business is being deleted: nobody keeps access to it. */
export function forgetBusinessMembers(db: Database, businessId: string): void {
  run(db, `DELETE FROM business_members WHERE business_id = ?`, [businessId]);
  run(db, `DELETE FROM business_invites WHERE business_id = ?`, [businessId]);
  run(db, `DELETE FROM business_member_activity WHERE business_id = ?`, [businessId]);
}

/** Account delete: leave every business shared with them, and close every one they own. */
export function removeUserFromBusinesses(db: Database, userId: string): void {
  for (const r of queryAll<{ business_id: string }>(db, `SELECT business_id FROM business_members WHERE user_id = ?`, [userId])) {
    logActivity(db, r.business_id, null, 'Someone with access deleted their account');
  }
  run(db, `DELETE FROM business_members WHERE user_id = ?`, [userId]);
  run(db, `DELETE FROM business_invites WHERE invited_by = ? AND accepted_at IS NULL`, [userId]);
  for (const b of queryAll<{ id: string }>(db, `SELECT id FROM businesses WHERE user_id = ?`, [userId])) forgetBusinessMembers(db, b.id);
}
