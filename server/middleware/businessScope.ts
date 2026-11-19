/**
 * Business member scoping (KAN-129), shared by the routers that hold a business's records
 * (business, invoices, calendar). A route that names a business, or a record of one, finds that
 * business, checks the caller's role (server/business/members.ts) and then runs as the owner, so
 * every store keeps filtering on the owner's user_id. With no access the request carries on as
 * the caller, whose own data doesn't hold the record: the usual 404, and nothing shows it exists.
 *
 * Viewers can only read. Each router names its owner-only actions and the paths that check roles
 * themselves (exempt).
 */
import type { Request, Response } from 'express';
import type { Database } from 'sql.js';
import { getDb } from '../db/index.ts';
import { businessAccess, resourceAccess, roleAllows, type Access, type ResourceKind } from '../business/members.ts';
import { hasFeature } from '../lib/entitlements.ts';
import type { AuthedRequest } from './requireAuth.ts';

export const BUSINESS_MANAGE_REQUIRED = {
  code: 'BUSINESS_MANAGE_REQUIRED',
  error: 'Clients, invoices, stock and the business budget are part of KoruLedger Plus. Profit and loss, GST and the accountant export stay on KoruLedger Business.',
};

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type ScopedRequest = AuthedRequest & { scopeUserId?: string; businessAccess?: Access };

export type ScopeOptions = {
  /** Actions only the owner may take, even as an accountant. */
  ownerOnly?: (req: Request) => boolean;
  /** Paths that check roles themselves (e.g. a viewer leaving a business). */
  exempt?: (req: Request) => boolean;
  /**
   * Writes need business_manage on the business owner (not the member). Reads stay open so a
   * Free account can still see businesses it already has.
   */
  manage?: boolean;
};

/** Whose rows the route reads and writes: the caller, or the owner of the business they're in. */
export function scopeUid(req: Request): string {
  return (req as ScopedRequest).scopeUserId || (req as AuthedRequest).user?.id || '';
}

/** The signed-in person, whatever business they're working in. */
export function callerId(req: Request): string {
  return (req as AuthedRequest).user?.id || '';
}

/** Applies access to the request, or sends 403/404 and returns false. */
function apply(req: Request, res: Response, access: Access | null, opts: ScopeOptions, db: Database): boolean {
  const r = req as ScopedRequest;
  // Two records on one route must share a business.
  if (r.businessAccess && access?.businessId !== r.businessAccess.businessId) {
    res.status(404).json({ error: 'Not found' });
    return false;
  }
  if (!access) return true;
  if (access.role !== 'owner' && !opts.exempt?.(req)) {
    if (!roleAllows(access.role, req.method)) {
      res.status(403).json({ error: 'You can view this business but not change it.', code: 'BUSINESS_VIEWER' });
      return false;
    }
    if (opts.ownerOnly?.(req)) {
      res.status(403).json({ error: 'Only the business owner can do this.', code: 'BUSINESS_OWNER_ONLY' });
      return false;
    }
  }
  if (opts.manage && WRITE_METHODS.has(req.method) && !opts.exempt?.(req) && !hasFeature(db, access.ownerId, 'business_manage')) {
    res.status(402).json(BUSINESS_MANAGE_REQUIRED);
    return false;
  }
  r.businessAccess = access;
  r.scopeUserId = access.ownerId;
  return true;
}

/** The caller's own books, when the route does not name someone else's business. */
export async function assertCallerCanManage(req: Request, res: Response): Promise<boolean> {
  const db = await getDb();
  const ownerId = (req as ScopedRequest).businessAccess?.ownerId || callerId(req);
  if (hasFeature(db, ownerId, 'business_manage')) return true;
  res.status(402).json(BUSINESS_MANAGE_REQUIRED);
  return false;
}

/** A router.param handler: scopes to the business that `kind`'s record belongs to. */
export function scopeTo(kind: ResourceKind | ((req: Request) => ResourceKind), opts: ScopeOptions = {}) {
  return async (req: Request, res: Response, next: (err?: unknown) => void, id: unknown) => {
    try {
      const db = await getDb();
      const access = resourceAccess(db, callerId(req), typeof kind === 'function' ? kind(req) : kind, String(id));
      if (apply(req, res, access, opts, db)) next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * An edit that names a business (moving an invoice or client) must keep a member inside the
 * business they were let into; the owner may move records between their own businesses.
 */
export function staysInBusiness(req: Request, businessId: string | null | undefined): boolean {
  const a = (req as ScopedRequest).businessAccess;
  return !a || a.role === 'owner' || !businessId || businessId === a.businessId;
}

/**
 * For a route that names the business in its query or body (a list, or a create): scopes to it
 * when the caller is a member. Returns false when a reply was already sent.
 */
export async function scopeToBusiness(req: Request, res: Response, businessId: unknown, opts: ScopeOptions = {}): Promise<boolean> {
  if (typeof businessId !== 'string' || !businessId.trim()) return true;
  const db = await getDb();
  return apply(req, res, businessAccess(db, callerId(req), businessId.trim()), opts, db);
}
