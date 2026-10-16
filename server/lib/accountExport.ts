/**
 * "Download a copy" (Settings → Account → Your data): everything stored for one account,
 * as JSON. Secrets (password and token hashes, encrypted 2FA secrets, share-link tokens,
 * Akahu access tokens) are never included. Uploaded files (photos, receipts, payslips) are
 * listed by name but not embedded.
 */
import type { Database } from 'sql.js';
import { queryAll, queryOne } from '../db/index.ts';
import { SCOPED_TABLES } from './userScope.ts';
import { priceContributor } from '../shopping/prices.ts';
import { hasPassword } from '../auth/users.ts';
import { pendingEmailFor } from '../auth/emailChange.ts';

type Row = Record<string, unknown>;

/** Column names that hold secrets or link tokens. Matched on whole underscore-separated words. */
const SECRET_COLUMN = /(^|_)(token|secret|hash|password)(_|$)|_enc$/i;

/** Drop secrets and the internal user id; turn stored JSON text into JSON. */
export function cleanRow(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'user_id' || SECRET_COLUMN.test(key)) continue;
    if (typeof value === 'string' && /_json$/.test(key)) {
      try {
        out[key] = JSON.parse(value);
        continue;
      } catch {
        /* keep the text */
      }
    }
    out[key] = value;
  }
  return out;
}

const rows = (db: Database, sql: string, params: (string | number)[]) => queryAll<Row>(db, sql, params).map(cleanRow);

export function exportAccountData(db: Database, userId: string, now = new Date()): Row | null {
  const user = queryOne<{
    email: string;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
    preferences_json: string | null;
    password_hash: string;
    totp_enabled_at: string | null;
    created_at: string;
  }>(db, `SELECT email, first_name, last_name, avatar_url, preferences_json, password_hash, totp_enabled_at, created_at FROM users WHERE id = ?`, [userId]);
  if (!user) return null;

  let preferences: unknown = null;
  try {
    preferences = user.preferences_json ? JSON.parse(user.preferences_json) : null;
  } catch {
    preferences = user.preferences_json;
  }

  const data: Record<string, Row[]> = {};
  for (const table of SCOPED_TABLES) {
    data[table] = rows(db, `SELECT * FROM ${table} WHERE user_id = ?`, [userId]);
  }
  // Child rows that hang off a parent rather than carrying user_id.
  data.debt_repayments = rows(db, `SELECT * FROM debt_repayments WHERE person_id IN (SELECT id FROM debt_people WHERE user_id = ?)`, [userId]);
  data.kiwisaver_activity = rows(db, `SELECT * FROM kiwisaver_activity WHERE account_id IN (SELECT id FROM kiwisaver_accounts WHERE user_id = ?)`, [userId]);
  data.kiwisaver_balance_history = rows(db, `SELECT * FROM kiwisaver_balance_history WHERE account_id IN (SELECT id FROM kiwisaver_accounts WHERE user_id = ?)`, [userId]);

  const uploadedFiles = [
    user.avatar_url && !user.avatar_url.startsWith('data:') ? user.avatar_url : null,
    ...queryAll<{ p: string }>(db, `SELECT photo_path AS p FROM holdings WHERE user_id = ? AND photo_path IS NOT NULL AND photo_path != '' AND photo_path NOT LIKE 'data:%'`, [userId]).map((r) => r.p),
    ...queryAll<{ p: string }>(db, `SELECT receipt_path AS p FROM transactions WHERE user_id = ? AND receipt_path IS NOT NULL`, [userId]).map((r) => r.p),
    ...queryAll<{ p: string }>(db, `SELECT receipt_path AS p FROM warranties WHERE user_id = ? AND receipt_path IS NOT NULL`, [userId]).map((r) => r.p),
    ...queryAll<{ p: string }>(db, `SELECT file_path AS p FROM payslips WHERE user_id = ? AND file_path IS NOT NULL`, [userId]).map((r) => r.p),
  ].filter((p): p is string => Boolean(p));

  const membership = queryOne<{ household_id: string; role: string; joined_at: string }>(
    db,
    `SELECT household_id, role, joined_at FROM household_members WHERE user_id = ?`,
    [userId],
  );
  const household = membership
    ? {
        name: queryOne<{ name: string }>(db, `SELECT name FROM households WHERE id = ?`, [membership.household_id])?.name ?? null,
        role: membership.role,
        joinedAt: membership.joined_at,
      }
    : null;

  return {
    exportedAt: now.toISOString(),
    format: 'KoruLedger account export, version 1',
    note: 'Everything stored for your account, apart from passwords, security secrets and access tokens. Uploaded files are listed by name, not included.',
    profile: {
      email: user.email,
      pendingEmail: pendingEmailFor(db, userId, now)?.newEmail ?? null,
      firstName: user.first_name,
      lastName: user.last_name,
      hasPhoto: Boolean(user.avatar_url),
      createdAt: user.created_at,
      preferences,
    },
    signIn: {
      hasPassword: hasPassword(user.password_hash),
      twoFactorOnSince: user.totp_enabled_at,
      connectedAccounts: rows(db, `SELECT provider, email, created_at, last_used_at FROM user_identities WHERE user_id = ?`, [userId]),
      passkeys: rows(db, `SELECT name, created_at, last_used_at FROM user_passkeys WHERE user_id = ?`, [userId]),
      sessions: rows(db, `SELECT device_label, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ?`, [userId]),
      history: rows(db, `SELECT kind, method, device_label, created_at FROM auth_events WHERE user_id = ? ORDER BY created_at DESC`, [userId]),
      akahuConnected: Boolean(queryOne(db, `SELECT 1 AS x FROM akahu_connections WHERE user_id = ?`, [userId])),
    },
    household,
    sharedSupermarketPrices: rows(
      db,
      `SELECT product_name, chain, branch_name, price_nzd, observed_on, created_at FROM price_observations WHERE contributor = ?`,
      [priceContributor(userId)],
    ),
    uploadedFiles,
    data,
  };
}
