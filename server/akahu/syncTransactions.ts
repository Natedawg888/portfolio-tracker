/**
 * Sync settled bank transactions from Akahu into local transactions table.
 * Default window: from 2026-10-01 inclusive (Pacific/Auckland).
 * Dedupe on external_id = Akahu _id. Never invent amounts.
 */
import { linkMirroredIncomeToBankCredits } from '../lib/incomeBankLink.ts';
import type { Database } from 'sql.js';
import { queryAll, queryOne, run, newId } from '../db/index.ts';
import {
  akahuGetAccounts,
  akahuGetTransactions,
  akahuRequestRefresh,
  latestTxnRefreshAt,
  waitForTxnRefresh,
  type AkahuTransaction,
} from './client.ts';
import { upsertAkahuCashAccounts } from './sync.ts';
import { createCategoryPredictor } from '../lib/categoryPredict.ts';

/** First calendar day to keep (Auckland date string). */
export const TXN_SYNC_FROM_DATE = '2026-10-01';

/**
 * NZDT (UTC+13) midnight on 2026-10-01 = 2026-09-30T11:00:00.000Z.
 * Akahu `start` is exclusive — pass 1ms before so Oct 1 00:00 NZ is included.
 */
export function akahuStartExclusiveForNzDate(ymd: string): string {
  // Build Auckland midnight as Instant via Intl / fixed offset for known NZDT date.
  // Oct 2026 is NZDT (UTC+13). For general dates we'd need a TZ library; this
  // project locks the spending window to Oct 2026+ so fixed offset is fine for the default.
  if (ymd === TXN_SYNC_FROM_DATE) {
    return '2026-09-30T10:59:59.999Z';
  }
  // Fallback: treat ymd as UTC date start minus 1ms (caller should prefer NZ-aware ISO).
  const utc = new Date(`${ymd}T00:00:00.000Z`);
  return new Date(utc.getTime() - 1).toISOString();
}

/** Format an ISO/UTC instant as YYYY-MM-DD in Pacific/Auckland. */
export function aucklandYmd(iso: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Auckland',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(iso));
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* fall through */
  }
  return iso.slice(0, 10);
}

export function mapAkahuTxnKind(type: string, amount: number): 'debit' | 'credit' | 'transfer' {
  const t = (type ?? '').toUpperCase();
  if (t === 'TRANSFER') return 'transfer';
  if (t === 'CREDIT' || t === 'DIRECT CREDIT' || t === 'INTEREST') return 'credit';
  if (amount >= 0) return 'credit';
  return 'debit';
}

/**
 * Best-effort card / payment-instrument label from Akahu fields.
 * Prefer card_suffix; Sharesies Spend gets an explicit Spend label; else type /
 * merchant / account nickname (same pattern as Kiwibank / wallet rows).
 */
export function deriveCardName(
  txn: AkahuTransaction,
  accountDisplayName: string,
  institution?: string | null,
): string {
  const conn = (institution ?? '').trim();
  const isSharesiesSpend =
    /spend/i.test(accountDisplayName) &&
    (/sharesies/i.test(conn) || /sharesies/i.test(accountDisplayName));

  const suffix = txn.meta?.card_suffix;
  if (suffix != null && String(suffix).trim()) {
    const s = String(suffix).trim();
    if (isSharesiesSpend) return `Sharesies Spend ····${s}`;
    const typeLabel = (txn.type ?? '').trim();
    if (typeLabel) return `${typeLabel} ····${s}`;
    return `Card ····${s}`;
  }
  const type = (txn.type ?? '').trim();
  if (isSharesiesSpend) {
    if (type && /CARD|EFTPOS|ATM/i.test(type)) return `Sharesies Spend · ${type}`;
    return 'Sharesies Spend';
  }
  if (type && /CARD|EFTPOS|ATM/i.test(type)) {
    return type;
  }
  if (txn.merchant?.name) {
    return accountDisplayName || txn.merchant.name;
  }
  if (accountDisplayName) return accountDisplayName;
  if (type) return type;
  return 'Bank';
}

export type TxnSyncResult = {
  ok: boolean;
  fetched: number;
  inserted: number;
  /** Existing row matched by Akahu external_id */
  updated: number;
  /** Soft-merged onto bank/manual placeholder (no prior external_id) */
  merged: number;
  /** Uncategorised rows given a category guessed from the user's past transactions */
  categorised: number;
  skippedNoAccount: number;
  skippedBeforeDate: number;
  sinceDate: string;
  /** Cash/payment accounts upserted before txn mapping (incl. Sharesies Spend) */
  cashAccountsEnsured: number;
  /** Whether POST /refresh was accepted (false if rate-limited or failed) */
  refreshed: boolean;
  refreshRateLimited?: boolean;
  error?: string;
};

export async function syncBankTransactionsFromAkahu(
  db: Database,
  sinceDate: string = TXN_SYNC_FROM_DATE,
  userId?: string,
): Promise<TxnSyncResult> {
  if (!userId) {
    throw new Error('syncBankTransactionsFromAkahu requires userId for per-user isolation');
  }
  const start = akahuStartExclusiveForNzDate(sinceDate);
  const now = new Date().toISOString();

  // Akahu serves cached settled txns until a refresh runs. Without this,
  // re-sync only sees already-known ids → fetched>0 but inserted=0 / all updates.
  let refreshed = false;
  let refreshRateLimited = false;
  const accountsBefore = await akahuGetAccounts();
  const baselineRefresh = latestTxnRefreshAt(accountsBefore);
  const refreshResult = await akahuRequestRefresh();
  refreshRateLimited = refreshResult.rateLimited;
  if (refreshResult.requested) {
    refreshed = true;
    await waitForTxnRefresh(baselineRefresh, { maxMs: 20_000, intervalMs: 1_500 });
  }

  // Ensure Kiwibank + Sharesies Spend / wallets exist locally before mapping.
  // Spending page only calls txn sync (not portfolio sync) — without this,
  // Spend card txns are skippedNoAccount when bank_accounts has no Spend row.
  const accountsForCash = await akahuGetAccounts();
  const cashAccountsEnsured = upsertAkahuCashAccounts(db, accountsForCash, now, userId);

  const remote = await akahuGetTransactions({ start });

  // Map Akahu account _id → local bank_accounts row
  const accounts = queryAll<{
    id: string;
    name: string;
    institution: string | null;
    external_id: string | null;
  }>(
    db,
    `SELECT id, name, institution, external_id FROM bank_accounts WHERE external_id IS NOT NULL AND user_id = ?`,
    [userId],
  );
  const byAkahuAcc = new Map<
    string,
    { id: string; name: string; institution: string | null }
  >();
  for (const a of accounts) {
    const ext = a.external_id ?? '';
    // external_id stored as "akahu:acc_…"
    const m = ext.match(/^akahu:(acc_[a-z0-9]+)$/i);
    const local = { id: a.id, name: a.name, institution: a.institution };
    if (m) byAkahuAcc.set(m[1], local);
    else if (/^acc_/i.test(ext)) byAkahuAcc.set(ext, local);
  }

  let inserted = 0;
  let updated = 0;
  let merged = 0;
  let categorised = 0;
  let skippedNoAccount = 0;
  let skippedBeforeDate = 0;
  // Category guesses from this user's own history (payee rule, then similar past spend).
  const predict = createCategoryPredictor(db, userId);
  /** Fill category only where none is set — a category chosen by the user always stays. */
  const fillCategory = (id: string, guessFrom: { merchant: string | null; description: string; amount: number }) => {
    const row = queryOne<{ category_id: string | null }>(db, `SELECT category_id FROM transactions WHERE id = ?`, [id]);
    if (row?.category_id) return;
    const guess = predict(guessFrom);
    if (!guess) return;
    run(db, `UPDATE transactions SET category_id = ? WHERE id = ? AND category_id IS NULL`, [guess.categoryId, id]);
    categorised += 1;
  };

  for (const txn of remote) {
    const ymd = aucklandYmd(txn.date);
    if (ymd < sinceDate) {
      skippedBeforeDate += 1;
      continue;
    }

    const local = byAkahuAcc.get(txn._account);
    if (!local) {
      skippedNoAccount += 1;
      continue;
    }

    const amount = Number(txn.amount);
    if (!Number.isFinite(amount)) continue;

    const kind = mapAkahuTxnKind(txn.type, amount);
    const description =
      (txn.merchant?.name && txn.merchant.name.trim()) ||
      (txn.description ?? '').trim() ||
      '(no description)';
    const merchant = txn.merchant?.name?.trim() || null;
    const cardName = deriveCardName(txn, local.name, local.institution);
    const externalId = txn._id;
    const currency = 'NZD';

    const existing = queryOne<{ id: string }>(
      db,
      `SELECT id FROM transactions WHERE external_id = ? AND user_id = ?`,
      [externalId, userId],
    );

    if (existing) {
      run(
        db,
        `UPDATE transactions SET
           account_id=?, date=?, description=?, amount=?, kind=?,
           currency=?, card_name=?, merchant=?, source='akahu'
         WHERE id=?`,
        [
          local.id,
          ymd,
          description,
          amount,
          kind,
          currency,
          cardName,
          merchant,
          existing.id,
        ],
      );
      updated += 1;
      fillCategory(existing.id, { merchant, description, amount });
    } else {
      // Soft-merge: only bank/manual placeholders (no external_id). Prefer a row
      // whose description loosely matches Akahu merchant/description so a same-day
      // same-amount placeholder for a *different* spend does not steal a new Akahu id.
      // Genuinely unmatched Akahu ids always INSERT below.
      const candidates = queryAll<{ id: string; description: string }>(
        db,
        `SELECT id, description FROM transactions
         WHERE account_id = ?
           AND amount = ?
           AND date = ?
           AND external_id IS NULL
           AND source IN ('bank', 'manual')
         ORDER BY created_at ASC`,
        [local.id, amount, ymd],
      );
      const needle = `${merchant ?? ''} ${description}`.toLowerCase();
      const pending =
        candidates.find((c) => {
          const d = (c.description ?? '').toLowerCase();
          if (!d || d === '(no description)' || d === 'eftpos') return true; // vague placeholder
          if (needle.includes(d) || d.includes(needle.trim())) return true;
          // token overlap (e.g. "Night n Day" vs "NIGHT'N DAY")
          const tokens = d.split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
          return tokens.some((t) => needle.includes(t));
        }) ?? null;
      if (pending) {
        run(
          db,
          `UPDATE transactions SET
             external_id=?, description=?, kind=?,
             currency=?, card_name=?, merchant=?, source='akahu'
           WHERE id=?`,
          [
            externalId,
            description,
            kind,
            currency,
            cardName,
            merchant,
            pending.id,
          ],
        );
        merged += 1;
        fillCategory(pending.id, { merchant, description, amount });
      } else {
        const guess = predict({ merchant, description, amount });
        if (guess) categorised += 1;
        run(
          db,
          `INSERT INTO transactions (
             id, user_id, account_id, date, description, amount, kind, category_id,
             currency, external_id, created_at, card_name, merchant, source
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'akahu')`,
          [
            newId('txn'),
            userId,
            local.id,
            ymd,
            description,
            amount,
            kind,
            guess?.categoryId ?? null,
            currency,
            externalId,
            now,
            cardName,
            merchant,
          ],
        );
        inserted += 1;
      }
    }
  }

  // A synced deposit may be an invoice payment already counted as income (KAN-71).
  linkMirroredIncomeToBankCredits(db, userId);

  return {
    ok: true,
    fetched: remote.length,
    inserted,
    updated,
    merged,
    categorised,
    skippedNoAccount,
    skippedBeforeDate,
    sinceDate,
    cashAccountsEnsured,
    refreshed,
    refreshRateLimited,
  };
}
