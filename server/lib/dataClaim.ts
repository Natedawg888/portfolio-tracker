/**
 * Whether the first account may take unscoped finance rows.
 * A database with no finance/bank rows is a normal empty install.
 * Rows that already exist stay put unless ALLOW_EXISTING_DATA_CLAIM is set
 * on the server (never a request field).
 */
import type { Database } from 'sql.js';

/** Tables that hold money or bank data. Budget-category seeds are not included. */
export const FINANCE_CLAIM_TABLES = [
  'holdings',
  'bank_accounts',
  'transactions',
  'kiwisaver_accounts',
  'debt_people',
  'income_records',
  'income_plans',
  'dividend_events',
  'dividend_forecast_reinvest',
  'budgets',
  'valuation_snapshots',
  'payee_settings',
  'akahu_connections',
  'wallets',
  'savings_goals',
  'donations',
  'pay_sources',
  'invoices',
  'invoice_clients',
] as const;

export function existingDataClaimAllowed(): boolean {
  const raw = (process.env.ALLOW_EXISTING_DATA_CLAIM ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function countFinanceRows(database: Database): number {
  let total = 0;
  for (const table of FINANCE_CLAIM_TABLES) {
    let stmt: ReturnType<Database['prepare']> | null = null;
    try {
      stmt = database.prepare(`SELECT COUNT(*) AS c FROM ${table}`);
      if (stmt.step()) {
        const row = stmt.getAsObject() as { c?: number };
        total += Number(row.c ?? 0);
      }
    } catch {
      // Table not created yet on a partial schema.
    } finally {
      stmt?.free();
    }
  }
  return total;
}

/** True when first signup may assign unscoped rows (empty install, or the env flag). */
export function mayClaimExistingFinance(database: Database): boolean {
  return countFinanceRows(database) === 0 || existingDataClaimAllowed();
}

/**
 * Startup owner when meta has none yet.
 * An already-recorded owner is left to the caller. Do not invent an owner
 * for a database that already has finance rows unless the env flag is set.
 */
export function startupOwnerId(opts: {
  earliestUserId: string | null;
  financeRowCount: number;
  claimAllowed: boolean;
}): string | null {
  if (!opts.earliestUserId) return null;
  if (opts.financeRowCount === 0 || opts.claimAllowed) return opts.earliestUserId;
  return null;
}
