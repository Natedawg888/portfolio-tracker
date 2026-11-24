/**
 * Encrypted columns (KAN-112): personal notes (phase 1), then personal details and money figures
 * (phase 2, PHASE2_* below).
 *
 * - Each request runs with its user's id and unlocked data key (if any) in an AsyncLocalStorage
 *   context (attachUser). Reads decrypt any `ue1:` value transparently in queryAll; without the key
 *   (signed out, locked, another user's row, a background job) the value reads as null.
 * - Writes: after the user's sign-in and after each request that changed something, any plain value
 *   left in ENCRYPTED_COLUMNS for that user is encrypted (AES-256-GCM, AAD = the owner's user id,
 *   plus `#n` for numbers). So
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

/**
 * Phase 2 (KAN-112): personal details and money figures that no SQL filters, sorts or totals,
 * that no background job reads (option A, KAN-115 not built yet), that no household member reads,
 * and that no GET handler reads and writes back (a locked GET would save the null over the value).
 * Left plain on purpose, for those reasons:
 * - holdings, bank_accounts, transactions, budgets, savings_goals, recurring_items, pay_sources
 *   (household sharing; alerts digest, Akahu, chain and quote jobs);
 * - kiwisaver_accounts (Akahu sync); bonds (coupon income is synced on GET);
 * - debt_people outstanding/interest rate/interest charged (interest is posted on GET);
 * - vehicles value_nzd, crypto_txns amount (filtered or totalled in SQL);
 * - payslips source_key, which still holds the employer name for employer matching.
 * Numbers decrypt back to numbers: they're sealed with AAD `<userId>#n`, so the type is authenticated.
 */
export const PHASE2_TEXT_COLUMNS: readonly (readonly [string, string])[] = [
  ['payslips', 'employer'],
  ['payslips', 'tax_code'],
  ['vehicles', 'make'],
  ['vehicles', 'model'],
  ['vehicles', 'plate'],
  ['vehicles', 'loan_lender'],
  ['warranties', 'item_name'],
  ['warranties', 'retailer'],
  ['rental_tenancies', 'tenant_label'],
  ['crypto_txns', 'counterparty'],
  ['crypto_txns', 'external_ref'],
];
export const PHASE2_NUMBER_COLUMNS: readonly (readonly [string, string])[] = [
  ...['hourly_rate', 'gross_nzd', 'paye_nzd', 'acc_nzd', 'ks_employee_nzd', 'ks_rate_pct', 'ks_employer_nzd', 'esct_nzd', 'student_loan_nzd', 'other_deductions_nzd', 'allowances_nzd', 'net_nzd'].map((c) => ['payslips', c] as const),
  ...['purchase_price_nzd', 'loan_balance_nzd', 'loan_rate_pct', 'loan_repayment_nzd', 'odometer', 'odometer_at_purchase'].map((c) => ['vehicles', c] as const),
  ['warranties', 'price_nzd'],
  ['rental_properties', 'purchase_price'],
  ['rental_properties', 'sale_price'],
  ['rental_properties', 'sale_costs'],
  ['rental_tenancies', 'rent_amount'],
  ['rental_tenancies', 'bond_amount'],
  ['debt_people', 'minimum_payment_nzd'],
  ['debt_people', 'actual_payment_nzd'],
  ['debt_people', 'interest_paid_nzd'],
  ['crypto_txns', 'nzd_value'],
  ['crypto_txns', 'fee_nzd'],
  ['crypto_txns', 'to_amount'],
  ['commodities', 'cost_nzd'],
  ['commodities', 'price_nzd'],
];

type Column = { table: string; column: string; number: boolean };
/** Every encrypted column, text (phase 1 notes + phase 2 details) and number. */
export const ENCRYPTED_COLUMNS: readonly Column[] = [
  ...PHASE1_COLUMNS.map(([table, column]) => ({ table, column, number: false })),
  ...PHASE2_TEXT_COLUMNS.map(([table, column]) => ({ table, column, number: false })),
  ...PHASE2_NUMBER_COLUMNS.map(([table, column]) => ({ table, column, number: true })),
];

export const encryptionEnabled = () => process.env.DATA_ENCRYPTION === '1';

const numberAad = (userId: string) => `${userId}#n`;

/** Open one stored value: text under AAD `<userId>`, a number under `<userId>#n`. Null when it can't. */
function openValue(key: Buffer, sealed: string, userId: string): string | number | null {
  const text = decryptField(key, sealed, userId);
  if (text !== null) return text;
  const num = decryptField(key, sealed, numberAad(userId));
  if (num === null) return null;
  const n = Number(num);
  return Number.isFinite(n) ? n : null;
}

/** queryAll hook: decrypt `ue1:` values with the request's key; null when it can't. */
export function decryptRow<T extends Record<string, unknown>>(row: T): T {
  let out: Record<string, unknown> | null = null;
  for (const [k, v] of Object.entries(row)) {
    if (!isEncryptedField(v)) continue;
    const ctx = als.getStore();
    const plain = ctx?.key && ctx.userId ? openValue(ctx.key, v, ctx.userId) : null;
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

/** Encrypt every plain value left in the encrypted columns for this user. Returns how many. */
export function encryptPendingForUser(db: Database, userId: string, key: Buffer, write: (db: Database, sql: string, params: unknown[]) => void = (d, sql, params) => d.run(sql, params as never[])): number {
  if (!encryptionEnabled()) return 0;
  let n = 0;
  for (const { table, column, number } of ENCRYPTED_COLUMNS) {
    if (!tableHas(db, table, column)) continue;
    const stmt = db.prepare(`SELECT id, ${column} AS v FROM ${table} WHERE user_id = ? AND ${column} IS NOT NULL AND ${column} != '' AND ${column} NOT LIKE 'ue1:%'`);
    stmt.bind([userId]);
    const rows: { id: string; v: string | number }[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as { id: string; v: string | number });
    stmt.free();
    for (const r of rows) {
      // A number column holding something that isn't a number is left alone rather than changed.
      if (number && !Number.isFinite(Number(r.v))) continue;
      const sealed = number ? encryptField(key, String(Number(r.v)), numberAad(userId)) : encryptField(key, String(r.v), userId);
      write(db, `UPDATE ${table} SET ${column} = ? WHERE id = ? AND user_id = ?`, [sealed, r.id, userId]);
      n++;
    }
  }
  return n;
}

/**
 * True when this request can't open the user's data but some of it is encrypted: the session is
 * locked (or there's no request). Anything that would save figures computed from it (the daily
 * net-worth snapshot, a data export) must skip or refuse, or it would store/hand out nulls.
 */
export function lockedOutOfData(db: Database, userId: string): boolean {
  const ctx = als.getStore();
  if (ctx?.key && ctx.userId === userId) return false;
  for (const { table, column } of ENCRYPTED_COLUMNS) {
    if (!tableHas(db, table, column)) continue;
    const stmt = db.prepare(`SELECT 1 FROM ${table} WHERE user_id = ? AND ${column} LIKE 'ue1:%' LIMIT 1`);
    stmt.bind([userId]);
    const found = stmt.step();
    stmt.free();
    if (found) return true;
  }
  return false;
}

/** Report: plain values still waiting per user (accounts not yet migrated). */
export function migrationReport(db: Database): { userId: string; email: string; plainValues: number }[] {
  const users = new Map<string, number>();
  for (const { table, column } of ENCRYPTED_COLUMNS) {
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
