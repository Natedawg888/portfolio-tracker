/**
 * Encrypted columns, phase 1 (KAN-112): personal notes.
 *
 * - Each request runs with its user's id and unlocked data key (if any) in an AsyncLocalStorage
 *   context (attachUser). Reads decrypt any `ue1:` value transparently in queryAll; without the key
 *   (signed out, locked, another user's row, a background job) the value reads as null.
 * - Writes: after the user's sign-in and after each request that changed something, any plain value
 *   left in PHASE1_COLUMNS for that user is encrypted (AES-256-GCM, AAD = the owner's user id). So
 *   existing accounts are migrated on their next sign-in, and new notes are encrypted straight after.
 * - DATA_ENCRYPTION=1 turns the encrypting on. Reading always works, so switching it off later
 *   never makes data unreadable; it only stops encrypting new values.
 * - Business, invoice and employee data (incl. bank account numbers) stay plain for now: accountants
 *   and viewers read them, so they need per-business keys (KAN-129 design). Later phases add amounts.
 * Option A (KAN-106): background jobs only see what's plain or what an unlocked session can open.
 * While encryption is on, a locked session can read (encrypted values come back null) but not
 * change anything (423 DATA_LOCKED, attachUser), so nothing unreadable is ever saved back.
 * The unlock screens (KAN-117) must ship before DATA_ENCRYPTION is turned on.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database } from 'sql.js';
import { decryptField, encryptField, isEncryptedField } from './dataKey.ts';

export type CryptoContext = { userId: string | null; key: Buffer | null };
const als = new AsyncLocalStorage<CryptoContext>();

export function runWithCryptoContext<T>(ctx: CryptoContext, fn: () => T): T {
  return als.run(ctx, fn);
}
export function cryptoContext(): CryptoContext | undefined {
  return als.getStore();
}

/** [table, column] encrypted in phase 1. Every table has id and user_id. */
export const PHASE1_COLUMNS: readonly (readonly [string, string])[] = [
  ['bank_accounts', 'notes'],
  ['budgets', 'notes'],
  ['holdings', 'notes'],
  ['holdings', 'valuation_notes'],
  ['valuation_snapshots', 'notes'],
  ['kiwisaver_accounts', 'notes'],
  ['debt_people', 'notes'],
  ['income_records', 'notes'],
  ['income_plans', 'notes'],
  ['dividend_events', 'notes'],
  ['savings_goals', 'notes'],
  ['donations', 'notes'],
  ['recurring_items', 'notes'],
  ['warranties', 'notes'],
  ['rental_properties', 'notes'],
  ['payslips', 'notes'],
  ['vehicles', 'notes'],
  ['crypto_txns', 'notes'],
  ['defi_positions', 'notes'],
  ['bonds', 'notes'],
  ['commodities', 'notes'],
];

export const encryptionEnabled = () => process.env.DATA_ENCRYPTION === '1';

/** queryAll hook: decrypt `ue1:` values with the request's key; null when it can't. */
export function decryptRow<T extends Record<string, unknown>>(row: T): T {
  let out: Record<string, unknown> | null = null;
  for (const [k, v] of Object.entries(row)) {
    if (!isEncryptedField(v)) continue;
    const ctx = als.getStore();
    const plain = ctx?.key && ctx.userId ? decryptField(ctx.key, v, ctx.userId) : null;
    out ??= { ...row };
    out[k] = plain;
  }
  return (out ?? row) as T;
}

function tableHas(db: Database, table: string, column: string): boolean {
  const stmt = db.prepare(`SELECT name FROM pragma_table_info(?)`);
  stmt.bind([table]);
  let found = false;
  while (stmt.step()) if (stmt.getAsObject().name === column) found = true;
  stmt.free();
  return found;
}

/** Encrypt every plain value left in the phase-1 columns for this user. Returns how many. */
export function encryptPendingForUser(db: Database, userId: string, key: Buffer, write: (db: Database, sql: string, params: unknown[]) => void = (d, sql, params) => d.run(sql, params as never[])): number {
  if (!encryptionEnabled()) return 0;
  let n = 0;
  for (const [table, column] of PHASE1_COLUMNS) {
    if (!tableHas(db, table, column)) continue;
    const stmt = db.prepare(`SELECT id, ${column} AS v FROM ${table} WHERE user_id = ? AND ${column} IS NOT NULL AND ${column} != '' AND ${column} NOT LIKE 'ue1:%'`);
    stmt.bind([userId]);
    const rows: { id: string; v: string }[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as { id: string; v: string });
    stmt.free();
    for (const r of rows) {
      write(db, `UPDATE ${table} SET ${column} = ? WHERE id = ? AND user_id = ?`, [encryptField(key, String(r.v), userId), r.id, userId]);
      n++;
    }
  }
  return n;
}

/** Report: plain values still waiting per user (accounts not yet migrated). */
export function migrationReport(db: Database): { userId: string; email: string; plainValues: number }[] {
  const users = new Map<string, number>();
  for (const [table, column] of PHASE1_COLUMNS) {
    if (!tableHas(db, table, column)) continue;
    const stmt = db.prepare(`SELECT user_id AS u, COUNT(*) AS n FROM ${table} WHERE user_id IS NOT NULL AND ${column} IS NOT NULL AND ${column} != '' AND ${column} NOT LIKE 'ue1:%' GROUP BY user_id`);
    while (stmt.step()) {
      const r = stmt.getAsObject() as { u: string; n: number };
      users.set(r.u, (users.get(r.u) ?? 0) + Number(r.n));
    }
    stmt.free();
  }
  const out: { userId: string; email: string; plainValues: number }[] = [];
  for (const [userId, plainValues] of users) {
    const stmt = db.prepare(`SELECT email FROM users WHERE id = ?`);
    stmt.bind([userId]);
    const email = stmt.step() ? String(stmt.getAsObject().email) : '';
    stmt.free();
    out.push({ userId, email, plainValues });
  }
  return out.sort((a, b) => b.plainValues - a.plainValues);
}
