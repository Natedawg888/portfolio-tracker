/**
 * Debounced Akahu auto-sync helpers for page open / refresh.
 * Bank txns and portfolio (Sharesies/Hatch stocks) share the same debounce interval
 * but use separate localStorage keys so opening Spending vs Portfolio don't block each other.
 *
 * Concurrent callers (React Strict Mode remount, Portfolio+Budget both open) share one
 * in-flight promise so a cancelled effect does not strand a completed sync without a UI reload.
 */
import {
  akahuStatus,
  akahuSync,
  akahuSyncTransactions,
  type AkahuSyncResult,
  type AkahuTxnSyncResult,
} from '../api/akahuClient';
import { SPENDING_FLOOR } from './period';

const TXN_STORAGE_KEY = 'portfolio.akahuTxnSync.at';
const PORTFOLIO_STORAGE_KEY = 'portfolio.akahuPortfolioSync.at';

/** Min gap between automatic syncs (manual Sync buttons ignore this). */
export const AKAHU_AUTO_SYNC_DEBOUNCE_MS = 90_000;
/** @deprecated alias — same interval */
export const AKAHU_TXN_AUTO_SYNC_DEBOUNCE_MS = AKAHU_AUTO_SYNC_DEBOUNCE_MS;

function lastAt(key: string): number {
  try {
    const n = Number(localStorage.getItem(key) ?? '0');
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function markAt(key: string, at = Date.now()): void {
  try {
    localStorage.setItem(key, String(at));
  } catch {
    /* ignore quota / private mode */
  }
}

function clearAt(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

async function isConfigured(): Promise<boolean> {
  try {
    return (await akahuStatus()).configured;
  } catch {
    return false;
  }
}

export type AutoTxnSyncOutcome =
  | { ran: false; reason: 'not_configured' | 'debounced' }
  | { ran: true; result: AkahuTxnSyncResult };

export type AutoPortfolioSyncOutcome =
  | { ran: false; reason: 'not_configured' | 'debounced' }
  | { ran: true; result: AkahuSyncResult };

let txnInflight: Promise<AutoTxnSyncOutcome> | null = null;
let portfolioInflight: Promise<AutoPortfolioSyncOutcome> | null = null;

/**
 * If Akahu is configured and debounce elapsed, sync settled bank txns since floor.
 * Safe to call on Spending / Dashboard mount.
 */
export async function maybeAutoSyncBankTransactions(
  opts: { force?: boolean; sinceDate?: string } = {},
): Promise<AutoTxnSyncOutcome> {
  const sinceDate = opts.sinceDate ?? SPENDING_FLOOR;
  if (!(await isConfigured())) return { ran: false, reason: 'not_configured' };

  if (txnInflight) return txnInflight;

  const now = Date.now();
  if (!opts.force && now - lastAt(TXN_STORAGE_KEY) < AKAHU_AUTO_SYNC_DEBOUNCE_MS) {
    return { ran: false, reason: 'debounced' };
  }

  markAt(TXN_STORAGE_KEY, now);
  txnInflight = (async () => {
    try {
      const result = await akahuSyncTransactions(sinceDate);
      return { ran: true as const, result };
    } catch (err) {
      // Allow a retry soon if the request failed (network / 5xx).
      clearAt(TXN_STORAGE_KEY);
      throw err;
    } finally {
      txnInflight = null;
    }
  })();
  return txnInflight;
}

/**
 * If Akahu is configured and debounce elapsed, sync Sharesies/Hatch stocks,
 * wallets, crypto, KiwiSaver, and cash balances.
 * Safe to call on Portfolio / Dashboard mount.
 */
export async function maybeAutoSyncPortfolio(
  opts: { force?: boolean } = {},
): Promise<AutoPortfolioSyncOutcome> {
  if (!(await isConfigured())) return { ran: false, reason: 'not_configured' };

  if (portfolioInflight) return portfolioInflight;

  const now = Date.now();
  if (!opts.force && now - lastAt(PORTFOLIO_STORAGE_KEY) < AKAHU_AUTO_SYNC_DEBOUNCE_MS) {
    return { ran: false, reason: 'debounced' };
  }

  markAt(PORTFOLIO_STORAGE_KEY, now);
  portfolioInflight = (async () => {
    try {
      const result = await akahuSync();
      return { ran: true as const, result };
    } catch (err) {
      clearAt(PORTFOLIO_STORAGE_KEY);
      throw err;
    } finally {
      portfolioInflight = null;
    }
  })();
  return portfolioInflight;
}

export function formatTxnSyncMsg(r: AkahuTxnSyncResult): string {
  const merged = r.merged ?? 0;
  const parts = [
    `Bank sync: fetched ${r.fetched}, inserted ${r.inserted}, updated ${r.updated}`,
  ];
  if (merged) parts.push(`merged ${merged}`);
  if (r.categorised) parts.push(`${r.categorised} categorised from past transactions`);
  if (r.cashAccountsEnsured) parts.push(`${r.cashAccountsEnsured} cash accounts`);
  if (r.skippedNoAccount) parts.push(`${r.skippedNoAccount} skipped (no matching account)`);
  if (r.skippedBeforeDate) parts.push(`${r.skippedBeforeDate} before floor`);
  parts.push(`from ${r.sinceDate}`);
  if (r.refreshed) parts.push('refreshed');
  else if (r.refreshRateLimited) parts.push('refresh skipped (rate limit)');
  return parts.join(' · ');
}

export function formatPortfolioSyncMsg(r: AkahuSyncResult): string {
  return (
    `Portfolio sync: ${r.stocksUpserted} stocks` +
    (r.stockSymbols?.length ? ` (${r.stockSymbols.join(', ')})` : '') +
    ` · ${r.cryptoUpserted} crypto · ${r.cashAccountsUpserted} cash` +
    (r.kiwisaverBalanceSynced ? ' · KiwiSaver' : '')
  );
}
