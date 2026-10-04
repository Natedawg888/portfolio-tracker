/**
 * Per-user dividend rows. Every read and write filters on user_id.
 * A holding_id is accepted only when that stock belongs to the same user.
 */
import type { Database } from 'sql.js';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { removeDividendIncome, syncDividendIncome } from './incomeSync.ts';
import {
  buildDividendDashboard,
  computeDividend,
  type DividendDashboard,
  type DividendRecord,
  type HoldingValueInput,
} from './model.ts';

export type StockHoldingOption = {
  id: string;
  name: string;
  symbol: string | null;
  shares: number | null;
  costBasisNzd: number | null;
};

export type DividendWriteBody = {
  holdingId?: unknown;
  sharesHeld?: unknown;
  dividendPerShare?: unknown;
  taxWithholding?: unknown;
  imputationCredits?: unknown;
  paymentDate?: unknown;
  currency?: unknown;
  fxRateToNzd?: unknown;
  reinvested?: unknown;
  reinvestedAmount?: unknown;
  notes?: unknown;
};

type WriteResult =
  | { ok: true; event: DividendRecord }
  | { ok: false; status: number; error: string };

function mapEvent(row: Record<string, unknown>): DividendRecord {
  return {
    id: String(row.id),
    holdingId: row.holding_id != null && String(row.holding_id) !== '' ? String(row.holding_id) : null,
    companyName: String(row.company_name ?? ''),
    symbol: row.symbol != null && String(row.symbol) !== '' ? String(row.symbol) : null,
    sharesHeld: Number(row.shares_held),
    dividendPerShare: Number(row.dividend_per_share),
    grossDividend: Number(row.gross_dividend),
    taxWithholding: Number(row.tax_withholding ?? 0),
    imputationCredits: Number(row.imputation_credits ?? 0),
    netDividend: Number(row.net_dividend),
    paymentDate: String(row.payment_date),
    currency: String(row.currency ?? 'NZD'),
    fxRateToNzd: row.fx_rate_to_nzd == null || row.fx_rate_to_nzd === ''
      ? null
      : Number(row.fx_rate_to_nzd),
    reinvested: Number(row.reinvested) === 1,
    reinvestedAmount: row.reinvested_amount == null || row.reinvested_amount === ''
      ? null
      : Number(row.reinvested_amount),
    notes: row.notes != null && String(row.notes) !== '' ? String(row.notes) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listStockHoldings(db: Database, userId: string): StockHoldingOption[] {
  const rows = queryAll<Record<string, unknown>>(
    db,
    `SELECT id, name, symbol, shares, cost_basis_nzd
     FROM holdings
     WHERE user_id = ? AND asset_class = 'stock'
     ORDER BY name COLLATE NOCASE, symbol`,
    [userId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ''),
    symbol: row.symbol != null && String(row.symbol) !== '' ? String(row.symbol) : null,
    shares: row.shares == null || row.shares === '' ? null : Number(row.shares),
    costBasisNzd: row.cost_basis_nzd == null || row.cost_basis_nzd === ''
      ? null
      : Number(row.cost_basis_nzd),
  }));
}

export function listDividendEvents(db: Database, userId: string): DividendRecord[] {
  const rows = queryAll<Record<string, unknown>>(
    db,
    `SELECT * FROM dividend_events
     WHERE user_id = ?
     ORDER BY payment_date DESC, created_at DESC`,
    [userId],
  );
  return rows.map(mapEvent);
}

function ownedStock(
  db: Database,
  userId: string,
  holdingId: string,
): { id: string; name: string; symbol: string | null } | null {
  const row = queryOne<Record<string, unknown>>(
    db,
    `SELECT id, name, symbol
     FROM holdings
     WHERE id = ? AND user_id = ? AND asset_class = 'stock'`,
    [holdingId, userId],
  );
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name ?? row.symbol ?? 'Holding'),
    symbol: row.symbol != null && String(row.symbol) !== '' ? String(row.symbol) : null,
  };
}

function quotePriceNzd(db: Database, symbol: string | null): number | null {
  if (!symbol) return null;
  const row = queryOne<{ price?: number | null; status?: string }>(
    db,
    `SELECT price, status FROM price_quotes WHERE asset_key = ?`,
    [`STOCK:${symbol.toUpperCase()}`],
  );
  if (!row || row.status !== 'ok' || row.price == null) return null;
  const price = Number(row.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function notesFrom(raw: unknown): string | null | { error: string } {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') return { error: 'Notes must be text.' };
  const notes = raw.trim();
  if (!notes) return null;
  if (notes.length > 500) return { error: 'Notes must be 500 characters or fewer.' };
  return notes;
}

function writeValues(db: Database, userId: string, body: DividendWriteBody) {
  const holdingId = typeof body.holdingId === 'string' ? body.holdingId.trim() : '';
  if (!holdingId) return { ok: false as const, status: 400, error: 'Choose one of your stock or ETF holdings.' };
  const holding = ownedStock(db, userId, holdingId);
  if (!holding) {
    return { ok: false as const, status: 404, error: 'That holding is not on your portfolio.' };
  }
  const computed = computeDividend(body);
  if (!computed.ok) return { ok: false as const, status: 400, error: computed.error };
  const notes = notesFrom(body.notes);
  if (notes && typeof notes === 'object') return { ok: false as const, status: 400, error: notes.error };
  return { ok: true as const, holding, computed: computed.value, notes };
}

export function insertDividend(db: Database, userId: string, body: DividendWriteBody): WriteResult {
  const written = writeValues(db, userId, body);
  if (!written.ok) return written;
  const id = newId('div');
  const now = new Date().toISOString();
  const value = written.computed;
  run(
    db,
    `INSERT INTO dividend_events (
       id, user_id, holding_id, company_name, symbol,
       shares_held, dividend_per_share, gross_dividend, tax_withholding, imputation_credits, net_dividend,
       payment_date, currency, fx_rate_to_nzd, reinvested, reinvested_amount, notes, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      written.holding.id,
      written.holding.name,
      written.holding.symbol,
      value.sharesHeld,
      value.dividendPerShare,
      value.grossDividend,
      value.taxWithholding,
      value.imputationCredits,
      value.netDividend,
      value.paymentDate,
      value.currency,
      value.fxRateToNzd,
      value.reinvested ? 1 : 0,
      value.reinvestedAmount,
      written.notes,
      now,
      now,
    ],
  );
  const saved = listDividendEvents(db, userId).find((event) => event.id === id);
  if (!saved) return { ok: false, status: 500, error: 'Dividend was not saved.' };
  syncDividendIncome(db, userId, saved);
  return { ok: true, event: saved };
}

export function updateDividend(
  db: Database,
  userId: string,
  id: string,
  body: DividendWriteBody,
): WriteResult {
  const existing = queryOne<{ id: string }>(
    db,
    `SELECT id FROM dividend_events WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  if (!existing) return { ok: false, status: 404, error: 'Dividend not found.' };
  const written = writeValues(db, userId, body);
  if (!written.ok) return written;
  const value = written.computed;
  const now = new Date().toISOString();
  run(
    db,
    `UPDATE dividend_events SET
       holding_id = ?, company_name = ?, symbol = ?,
       shares_held = ?, dividend_per_share = ?, gross_dividend = ?, tax_withholding = ?,
       imputation_credits = ?, net_dividend = ?, payment_date = ?, currency = ?,
       fx_rate_to_nzd = ?, reinvested = ?, reinvested_amount = ?, notes = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [
      written.holding.id,
      written.holding.name,
      written.holding.symbol,
      value.sharesHeld,
      value.dividendPerShare,
      value.grossDividend,
      value.taxWithholding,
      value.imputationCredits,
      value.netDividend,
      value.paymentDate,
      value.currency,
      value.fxRateToNzd,
      value.reinvested ? 1 : 0,
      value.reinvestedAmount,
      written.notes,
      now,
      id,
      userId,
    ],
  );
  const saved = listDividendEvents(db, userId).find((event) => event.id === id);
  if (!saved) return { ok: false, status: 500, error: 'Dividend was not updated.' };
  syncDividendIncome(db, userId, saved);
  return { ok: true, event: saved };
}

export function deleteDividend(db: Database, userId: string, id: string): boolean {
  const existing = queryOne<{ id: string }>(
    db,
    `SELECT id FROM dividend_events WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  if (!existing) return false;
  run(db, `DELETE FROM dividend_events WHERE id = ? AND user_id = ?`, [id, userId]);
  removeDividendIncome(db, userId, id);
  return true;
}

/**
 * Keep the personal payment record when its holding is removed.
 * Only this user's rows for this holding are unlinked. Amounts stay as recorded.
 * Returns how many rows were unlinked.
 */
export function unlinkDividendsForHolding(db: Database, userId: string, holdingId: string): number {
  if (!userId || !holdingId) return 0;
  const before = queryOne<{ c: number }>(
    db,
    `SELECT COUNT(*) AS c FROM dividend_events WHERE user_id = ? AND holding_id = ?`,
    [userId, holdingId],
  );
  const count = Number(before?.c ?? 0);
  if (count <= 0) return 0;
  run(
    db,
    `UPDATE dividend_events
     SET holding_id = NULL, updated_at = ?
     WHERE user_id = ? AND holding_id = ?`,
    [new Date().toISOString(), userId, holdingId],
  );
  return count;
}

export function dashboardForUser(
  db: Database,
  userId: string,
  year: number,
  today?: string,
): DividendDashboard & { holdings: StockHoldingOption[] } {
  const holdings = listStockHoldings(db, userId);
  const events = listDividendEvents(db, userId);
  const valued: HoldingValueInput[] = holdings.map((holding) => ({
    ...holding,
    quotedPriceNzd: quotePriceNzd(db, holding.symbol),
  }));
  return {
    ...buildDividendDashboard({ events, holdings: valued, year, today }),
    holdings,
  };
}
