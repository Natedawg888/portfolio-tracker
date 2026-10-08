/**
 * Per-user dividend rows. Every read and write filters on user_id.
 * A holding_id is accepted only when that stock belongs to the same user.
 */
import type { Database } from 'sql.js';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { logger } from '../lib/logger.ts';
import { prefetchFxToNzd } from '../quotes/fx.ts';
import { fetchYahooPublishedDividends } from '../quotes/yahooDividends.ts';
import { removeDividendIncome, syncDividendIncome } from './incomeSync.ts';
import {
  buildDividendDashboard,
  computeDividend,
  forecastReinvestKey,
  isYmd,
  projectDividendSchedule,
  todayAucklandYmd,
  type DetectedDividend,
  type DividendDashboard,
  type DividendRecord,
  type DividendView,
  type HoldingValueInput,
  type PublishedDividendSeries,
} from './model.ts';

export type StockHoldingOption = {
  id: string;
  name: string;
  symbol: string | null;
  shares: number | null;
  costBasisNzd: number | null;
};

type OwnedStockHolding = StockHoldingOption & { exchange: string | null };

export type PublishedDividendLoader = (input: {
  symbol: string;
  exchange: string | null;
}) => Promise<PublishedDividendSeries | null>;

async function defaultPublishedLoader(input: {
  symbol: string;
  exchange: string | null;
}): Promise<PublishedDividendSeries | null> {
  const chart = await fetchYahooPublishedDividends(input.symbol, input.exchange);
  if (!chart) return null;
  return { source: 'yahoo', currency: chart.currency, payments: chart.payments };
}

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

function listOwnedStocks(db: Database, userId: string): OwnedStockHolding[] {
  const rows = queryAll<Record<string, unknown>>(
    db,
    `SELECT id, name, symbol, shares, cost_basis_nzd, exchange
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
    exchange: row.exchange != null && String(row.exchange) !== '' ? String(row.exchange) : null,
  }));
}

export function listStockHoldings(db: Database, userId: string): StockHoldingOption[] {
  return listOwnedStocks(db, userId).map((holding) => ({
    id: holding.id,
    name: holding.name,
    symbol: holding.symbol,
    shares: holding.shares,
    costBasisNzd: holding.costBasisNzd,
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
  run(
    db,
    `DELETE FROM dividend_forecast_reinvest WHERE user_id = ? AND holding_id = ?`,
    [userId, holdingId],
  );
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

export type DividendReinvestResult =
  | {
      ok: true;
      event: DividendView;
      /** Forecast rows for this holding after the toggle. */
      detected: DetectedDividend[];
      /** Shares stored on the holding. This toggle does not change them. */
      ownedShares: number | null;
    }
  | { ok: false; status: number; error: string };

export type ForecastReinvestResult =
  | {
      ok: true;
      holdingId: string;
      paymentDate: string;
      reinvested: boolean;
      detected: DetectedDividend[];
      ownedShares: number | null;
    }
  | { ok: false; status: number; error: string };

/**
 * Turn reinvestment on or off for one recorded dividend.
 * On sets the reinvested amount to that payment's net cash.
 * The holding quantity is not updated. Forecast rows are not saved.
 */
export async function setDividendReinvest(
  db: Database,
  userId: string,
  id: string,
  reinvested: boolean,
  today?: string,
  loadPublished: PublishedDividendLoader = defaultPublishedLoader,
): Promise<DividendReinvestResult> {
  const existing = queryOne<{ id: string; net_dividend: number }>(
    db,
    `SELECT id, net_dividend FROM dividend_events WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  if (!existing) return { ok: false, status: 404, error: 'Dividend not found.' };
  const net = Number(existing.net_dividend);
  if (reinvested && !(net > 0)) {
    return { ok: false, status: 400, error: 'There is no net cash to reinvest.' };
  }
  run(
    db,
    `UPDATE dividend_events
     SET reinvested = ?, reinvested_amount = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
    [reinvested ? 1 : 0, reinvested ? net : null, new Date().toISOString(), id, userId],
  );
  const todayYmd = today && isYmd(today) ? today : todayAucklandYmd();
  const dash = await dashboardForUser(db, userId, Number(todayYmd.slice(0, 4)), todayYmd, loadPublished);
  const event = [...dash.history, ...dash.upcoming].find((row) => row.id === id);
  if (!event) return { ok: false, status: 500, error: 'Dividend was not updated.' };
  const holdingId = event.holdingId;
  return {
    ok: true,
    event,
    detected: holdingId ? dash.forecast.detected.filter((row) => row.holdingId === holdingId) : [],
    ownedShares: holdingId
      ? dash.holdings.find((holding) => holding.id === holdingId)?.shares ?? null
      : null,
  };
}

/**
 * Turn reinvestment on or off for one forecast row.
 * The preference is stored on its own. It is not a dividend event and not income.
 */
export async function setForecastReinvest(
  db: Database,
  userId: string,
  holdingId: string,
  paymentDate: string,
  reinvested: boolean,
  today?: string,
  loadPublished: PublishedDividendLoader = defaultPublishedLoader,
): Promise<ForecastReinvestResult> {
  if (!isYmd(paymentDate)) {
    return { ok: false, status: 400, error: 'Payment date must be a real calendar date (YYYY-MM-DD).' };
  }
  const holding = ownedStock(db, userId, holdingId);
  if (!holding) return { ok: false, status: 404, error: 'That holding is not on your portfolio.' };
  const prefs = readForecastReinvest(db, userId);
  const key = forecastReinvestKey(holdingId, paymentDate);
  if (reinvested) prefs.set(key, true);
  else prefs.delete(key);
  const todayYmd = today && isYmd(today) ? today : todayAucklandYmd();
  const dash = await dashboardForUser(
    db,
    userId,
    Number(todayYmd.slice(0, 4)),
    todayYmd,
    loadPublished,
    prefs,
  );
  const detected = dash.forecast.detected.filter((row) => row.holdingId === holdingId);
  const match = detected.some((row) => row.paymentDate === paymentDate);
  if (!match) {
    if (!reinvested) {
      writeForecastReinvest(db, userId, holdingId, paymentDate, false);
      return {
        ok: true,
        holdingId,
        paymentDate,
        reinvested: false,
        detected,
        ownedShares: dash.holdings.find((item) => item.id === holdingId)?.shares ?? null,
      };
    }
    return { ok: false, status: 404, error: 'That forecast payment is not on your projection.' };
  }
  writeForecastReinvest(db, userId, holdingId, paymentDate, reinvested);
  return {
    ok: true,
    holdingId,
    paymentDate,
    reinvested,
    detected,
    ownedShares: dash.holdings.find((item) => item.id === holdingId)?.shares ?? null,
  };
}

function usableShares(shares: number | null): number | null {
  if (shares == null || !Number.isFinite(shares) || !(shares > 0)) return null;
  return shares;
}

/** payment_date value meaning "every predicted payment of this holding". */
export const REINVEST_ALL_PAYMENTS = '*';

function reinvestAllKey(holdingId: string): string {
  return `${holdingId}:${REINVEST_ALL_PAYMENTS}`;
}

function readForecastReinvest(db: Database, userId: string): Map<string, boolean> {
  const rows = queryAll<Record<string, unknown>>(
    db,
    `SELECT holding_id, payment_date, reinvested
     FROM dividend_forecast_reinvest
     WHERE user_id = ?`,
    [userId],
  );
  const prefs = new Map<string, boolean>();
  for (const row of rows) {
    const holdingId = String(row.holding_id ?? '');
    const paymentDate = String(row.payment_date ?? '');
    if (!holdingId || (!isYmd(paymentDate) && paymentDate !== REINVEST_ALL_PAYMENTS)) continue;
    if (Number(row.reinvested) === 1) prefs.set(forecastReinvestKey(holdingId, paymentDate), true);
  }
  return prefs;
}

function writeForecastReinvest(
  db: Database,
  userId: string,
  holdingId: string,
  paymentDate: string,
  reinvested: boolean,
): void {
  if (!reinvested) {
    run(
      db,
      `DELETE FROM dividend_forecast_reinvest
       WHERE user_id = ? AND holding_id = ? AND payment_date = ?`,
      [userId, holdingId, paymentDate],
    );
    return;
  }
  const now = new Date().toISOString();
  const existing = queryOne<{ id: string }>(
    db,
    `SELECT id FROM dividend_forecast_reinvest
     WHERE user_id = ? AND holding_id = ? AND payment_date = ?`,
    [userId, holdingId, paymentDate],
  );
  if (existing) {
    run(
      db,
      `UPDATE dividend_forecast_reinvest
       SET reinvested = 1, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [now, existing.id, userId],
    );
    return;
  }
  run(
    db,
    `INSERT INTO dividend_forecast_reinvest (
       id, user_id, holding_id, payment_date, reinvested, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 1, ?, ?)`,
    [newId('dre'), userId, holdingId, paymentDate, now, now],
  );
}

async function detectedForHoldings(
  holdings: OwnedStockHolding[],
  events: DividendRecord[],
  today: string,
  loadPublished: PublishedDividendLoader,
  forecastPrefs: Map<string, boolean>,
): Promise<DetectedDividend[]> {
  const statedThrough = new Map<string, string>();
  for (const event of events) {
    if (!event.holdingId || !(event.paymentDate > today)) continue;
    const current = statedThrough.get(event.holdingId);
    if (current == null || event.paymentDate > current) statedThrough.set(event.holdingId, event.paymentDate);
  }
  const candidates = holdings.filter((holding) => {
    if (!holding.symbol) return false;
    return usableShares(holding.shares) != null;
  });
  const loaded = await Promise.all(candidates.map(async (holding) => {
    try {
      const series = await loadPublished({
        symbol: holding.symbol as string,
        exchange: holding.exchange,
      });
      return { holding, series };
    } catch (err) {
      logger.warn('Dividend history lookup failed', {
        symbol: holding.symbol,
        detail: (err as Error).message,
      });
      return { holding, series: null };
    }
  }));
  const foreign = [...new Set(
    loaded
      .map((item) => item.series?.currency?.toUpperCase() ?? '')
      .filter((currency) => /^[A-Z]{3}$/.test(currency) && currency !== 'NZD'),
  )];
  let rates = new Map<string, number>();
  if (foreign.length > 0) {
    try {
      const quotes = await prefetchFxToNzd(foreign);
      rates = new Map(
        [...quotes.entries()]
          .filter(([, quote]) => quote.status === 'ok' && quote.rate != null && quote.rate > 0)
          .map(([currency, quote]) => [currency, quote.rate as number]),
      );
    } catch (err) {
      logger.warn('Dividend FX lookup failed', { detail: (err as Error).message });
    }
  }
  const detected: DetectedDividend[] = [];
  for (const item of loaded) {
    const shares = usableShares(item.holding.shares);
    if (shares == null || !item.holding.symbol) continue;
    const currency = item.series?.currency?.toUpperCase() ?? '';
    const schedule = projectDividendSchedule({
      holdingId: item.holding.id,
      name: item.holding.name,
      symbol: item.holding.symbol,
      shares,
      series: item.series,
      today,
      fxRateToNzd: currency === 'NZD' ? 1 : rates.get(currency) ?? null,
    });
    const through = statedThrough.get(item.holding.id);
    for (const projected of schedule) {
      if (through && projected.paymentDate <= through) continue;
      const reinvested =
        forecastPrefs.get(reinvestAllKey(projected.holdingId)) === true ||
        forecastPrefs.get(forecastReinvestKey(projected.holdingId, projected.paymentDate)) === true;
      detected.push(reinvested ? { ...projected, reinvested: true } : projected);
    }
  }
  return detected;
}

export async function dashboardForUser(
  db: Database,
  userId: string,
  year: number,
  today?: string,
  loadPublished: PublishedDividendLoader = defaultPublishedLoader,
  forecastPrefs?: Map<string, boolean>,
): Promise<DividendDashboard & { holdings: StockHoldingOption[] }> {
  const owned = listOwnedStocks(db, userId);
  const holdings = owned.map((holding) => ({
    id: holding.id,
    name: holding.name,
    symbol: holding.symbol,
    shares: holding.shares,
    costBasisNzd: holding.costBasisNzd,
  }));
  const events = listDividendEvents(db, userId);
  const todayYmd = today && isYmd(today) ? today : todayAucklandYmd();
  const prefs = forecastPrefs ?? readForecastReinvest(db, userId);
  const detected = await detectedForHoldings(owned, events, todayYmd, loadPublished, prefs);
  const valued: HoldingValueInput[] = holdings.map((holding) => ({
    ...holding,
    quotedPriceNzd: quotePriceNzd(db, holding.symbol),
  }));
  const dash = buildDividendDashboard({ events, holdings: valued, year, today: todayYmd, detected });
  const reinvestAllHoldingIds = holdings.filter((h) => prefs.get(reinvestAllKey(h.id)) === true).map((h) => h.id);
  return {
    ...dash,
    forecast: { ...dash.forecast, reinvestAllHoldingIds },
    holdings,
  };
}

/**
 * Reinvest every predicted payment of one holding (a dividend reinvestment plan), so each
 * payment buys more shares and later payments grow. Off returns to per-payment choices.
 */
export function setForecastReinvestAll(
  db: Database,
  userId: string,
  holdingId: string,
  reinvested: boolean,
): { ok: true } | { ok: false; status: number; error: string } {
  if (!ownedStock(db, userId, holdingId)) return { ok: false, status: 404, error: 'That holding is not on your portfolio.' };
  writeForecastReinvest(db, userId, holdingId, REINVEST_ALL_PAYMENTS, reinvested);
  return { ok: true };
}
