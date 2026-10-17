/**
 * Business rows (KAN-84) and the invoice details printed from them. Every query filters on
 * user_id; another user's business id behaves like a missing one.
 *
 * Each user has at most one default business. It is made from their invoice details
 * (business_profiles, Settings → Business) or their account name the first time anything
 * needs a business, and invoices or clients without a business are attached to it.
 */
import type { Database } from 'sql.js';
import type { Business, BusinessProfile } from '../../src/types/index.ts';
import { DEFAULT_INVOICE_PREFIX } from '../../src/lib/invoiceCalc.ts';
import { isBusinessType, type BusinessType } from '../../src/lib/business.ts';
import { newId, queryOne, run } from '../db/index.ts';
import { photoUrlFromPath } from '../lib/uploads.ts';

export type BusinessRow = {
  id: string;
  user_id: string;
  name: string;
  type: string;
  industry: string;
  nzbn: string;
  gst_registered: number;
  gst_number: string;
  email: string;
  address: string;
  phone: string;
  bank_account: string;
  invoice_prefix: string;
  logo_path: string | null;
  clients_enabled: number;
  count_in_net_worth: number;
  is_default: number;
  created_at: string;
  updated_at: string;
};

export function presentBusiness(r: BusinessRow): Business {
  return {
    id: r.id,
    name: r.name,
    type: (isBusinessType(r.type) ? r.type : 'sole_trader') as BusinessType,
    industry: r.industry ?? '',
    nzbn: r.nzbn ?? '',
    gstRegistered: Number(r.gst_registered) === 1,
    gstNumber: r.gst_number ?? '',
    email: r.email ?? '',
    address: r.address ?? '',
    phone: r.phone ?? '',
    bankAccount: r.bank_account ?? '',
    invoicePrefix: r.invoice_prefix || DEFAULT_INVOICE_PREFIX,
    logoUrl: photoUrlFromPath(r.logo_path),
    clientsEnabled: Number(r.clients_enabled) === 1,
    countInNetWorth: Number(r.count_in_net_worth) === 1,
    isDefault: Number(r.is_default) === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function businessRow(db: Database, userId: string, id: string): BusinessRow | null {
  return queryOne<BusinessRow>(db, `SELECT * FROM businesses WHERE id = ? AND user_id = ?`, [id, userId]);
}

export function defaultBusinessRow(db: Database, userId: string): BusinessRow | null {
  return queryOne<BusinessRow>(db, `SELECT * FROM businesses WHERE user_id = ? ORDER BY is_default DESC, created_at, id LIMIT 1`, [userId]);
}

function accountName(db: Database, userId: string): { name: string; email: string } {
  const u = queryOne<{ email?: string; display_name?: string | null; first_name?: string | null; last_name?: string | null }>(
    db,
    `SELECT * FROM users WHERE id = ?`,
    [userId],
  );
  const name = (u?.display_name ?? '').trim() || [u?.first_name, u?.last_name].filter((p) => p && String(p).trim()).join(' ');
  return { name, email: u?.email ?? '' };
}

/** The default business, made now (from Settings → Business or the account) if there is none. */
export function ensureDefaultBusiness(db: Database, userId: string): BusinessRow {
  const existing = defaultBusinessRow(db, userId);
  if (existing) {
    if (!Number(existing.is_default)) run(db, `UPDATE businesses SET is_default = 1 WHERE id = ? AND user_id = ?`, [existing.id, userId]);
    attachOrphans(db, userId, existing.id);
    return { ...existing, is_default: 1 };
  }
  const p = queryOne<{
    business_name: string; address: string; email: string; phone: string; bank_account: string;
    gst_registered: number; gst_number: string; nzbn: string; invoice_prefix: string;
  }>(db, `SELECT * FROM business_profiles WHERE user_id = ?`, [userId]);
  const account = accountName(db, userId);
  const id = newId('biz');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO businesses (id, user_id, name, type, nzbn, gst_registered, gst_number, email, address, phone, bank_account,
       invoice_prefix, is_default, created_at, updated_at)
     VALUES (?,?,?, 'sole_trader', ?,?,?,?,?,?,?,?, 1, ?, ?)`,
    [
      id, userId, (p?.business_name ?? '').trim() || account.name, p?.nzbn ?? '',
      Number(p?.gst_registered ?? 0) === 1 ? 1 : 0, p?.gst_number ?? '', p?.email ?? account.email, p?.address ?? '',
      p?.phone ?? '', p?.bank_account ?? '', p?.invoice_prefix || DEFAULT_INVOICE_PREFIX, now, now,
    ],
  );
  attachOrphans(db, userId, id);
  return businessRow(db, userId, id)!;
}

function attachOrphans(db: Database, userId: string, businessId: string): void {
  run(db, `UPDATE invoices SET business_id = ? WHERE user_id = ? AND business_id IS NULL`, [businessId, userId]);
  run(db, `UPDATE invoice_clients SET business_id = ? WHERE user_id = ? AND business_id IS NULL`, [businessId, userId]);
}

/** The business by id, or the default one when id is empty. null = that id isn't this user's. */
export function resolveBusiness(db: Database, userId: string, id: string | null | undefined): BusinessRow | null {
  return id ? businessRow(db, userId, id) : ensureDefaultBusiness(db, userId);
}

/** What an invoice prints for this business. */
export function profileFromBusiness(r: BusinessRow): BusinessProfile {
  return {
    businessName: r.name,
    address: r.address ?? '',
    email: r.email ?? '',
    phone: r.phone ?? '',
    bankAccount: r.bank_account ?? '',
    gstRegistered: Number(r.gst_registered) === 1,
    gstNumber: r.gst_number ?? '',
    nzbn: r.nzbn ?? '',
    invoicePrefix: r.invoice_prefix || DEFAULT_INVOICE_PREFIX,
  };
}
