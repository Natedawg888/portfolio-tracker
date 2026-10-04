/**
 * Upsert Akahu Sharesies/Hatch holdings + KiwiSaver + bank cash into local DB.
 * Non-NZD market values → NZD via live Frankfurter FX (USD fallback: BTC FX ratio).
 * Cost basis from Akahu item fields or value−returns when available; else NULL (never fake $0).
 * Idempotent via external_id.
 *
 * Cash path (Kiwibank and other NZ banks): sync ANY active Akahu account that has
 * a numeric balance.current and is NOT INVESTMENT / KIWISAVER / REWARDS — no
 * connection-name whitelist. Sharesies/Hatch investment + KiwiSaver stay separate.
 */
import type { Database } from 'sql.js';
import { queryAll, queryOne, run, newId } from '../db/index.ts';
import { unlinkDividendsForHolding } from '../dividends/store.ts';
import {
  akahuGetAccounts,
  akahuGetAccountTransactions,
  type AkahuAccount,
  type AkahuPortfolioItem,
} from './client.ts';
import {
  prefetchFxToNzd,
  type ConvertToNzdResult,
  type FxToNzdQuote,
} from '../quotes/fx.ts';
import { normalizeLogoUrl } from '../../src/lib/holdingIcons.ts';

const COMMON_CRYPTO = new Set(
  [
    'BTC', 'ETH', 'XRP', 'SOL', 'ADA', 'DOGE', 'LTC', 'BNB', 'AVAX', 'DOT',
    'MATIC', 'LINK', 'UNI', 'ATOM', 'NEAR', 'APT', 'ARB', 'OP', 'SUI', 'TRX',
    'SHIB', 'PEPE', 'USDT', 'USDC', 'DAI', 'BCH', 'ETC', 'XLM', 'ALGO', 'FIL',
  ].map((s) => s.toUpperCase()),
);

export type AkahuSyncResult = {
  ok: boolean;
  stocksUpserted: number;
  cryptoUpserted: number;
  stocksDeleted: number;
  cryptoDeleted: number;
  kiwisaverFunds: number;
  kiwisaverBalanceSynced: boolean;
  cashAccountsUpserted: number;
  stockSymbols: string[];
  cryptoSymbols: string[];
  sources: string[];
  /** Live FX sources used this sync (Frankfurter / btc_fx_ratio / …). */
  fxSources: string[];
  error?: string;
};

function connectionSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function externalIdFor(connName: string, accountId: string, fundId?: string): string {
  const slug = connectionSlug(connName) || 'unknown';
  if (fundId) return `akahu:${slug}:${fundId}`;
  return `akahu:${accountId}:holding`;
}

function isCryptoHolding(account: AkahuAccount, item: AkahuPortfolioItem): boolean {
  const conn = account.connection?.name ?? '';
  if (conn !== 'Sharesies') return false;
  const name = account.name ?? '';
  if (/crypto/i.test(name)) return true;
  const exchange = (item.exchange ?? '').toString();
  if (/kraken/i.test(exchange)) return true;
  const symbol = (item.symbol ?? '').toUpperCase();
  if (symbol && COMMON_CRYPTO.has(symbol)) return true;
  return false;
}

function finiteOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Cost in the item's native currency when Akahu provides it.
 * Prefer explicit cost_basis / average_cost×shares / average_price×shares;
 * else value − returns (Hatch/Sharesies both expose returns).
 * Returns null when unknown — never invent $0.
 */
export function deriveAkahuCostInCurrency(
  item: AkahuPortfolioItem,
  account?: AkahuAccount,
): number | null {
  const explicit = finiteOrNull(item.cost_basis);
  if (explicit != null && explicit > 0) return explicit;

  const shares = finiteOrNull(item.shares);
  const avg =
    finiteOrNull(item.average_cost) ?? finiteOrNull(item.average_price);
  if (avg != null && avg > 0 && shares != null && shares > 0) {
    return avg * shares;
  }

  const value = finiteOrNull(item.value);
  const returns = finiteOrNull(item.returns);
  if (value != null && returns != null) {
    const cost = value - returns;
    if (Number.isFinite(cost) && cost > 0) return cost;
  }

  // Single-holding account: Hatch meta.breakdown.cost_basis
  const portfolio = account?.meta?.portfolio ?? [];
  const breakdown = account?.meta?.breakdown as
    | { cost_basis?: number; returns?: number }
    | undefined;
  if (
    portfolio.length === 1 &&
    breakdown &&
    finiteOrNull(breakdown.cost_basis) != null &&
    finiteOrNull(breakdown.cost_basis)! > 0
  ) {
    return Number(breakdown.cost_basis);
  }

  return null;
}

type ValueNoteFx = {
  converted: ConvertToNzdResult | null;
  fxQuote: FxToNzdQuote | null;
};

function valueNote(item: AkahuPortfolioItem, fx: ValueNoteFx): string | null {
  const currency = (item.currency ?? '').toUpperCase();
  const value = finiteOrNull(item.value);
  if (value == null) return null;

  if (!currency || currency === 'NZD') {
    return `Akahu market value: ${value} NZD`;
  }

  if (fx.converted) {
    const c = fx.converted;
    const nzd = Math.round(c.nzd * 100) / 100;
    return (
      `Akahu market value: ${value} ${currency} → ${nzd} NZD ` +
      `@ ${c.rate} (${c.source})`
    );
  }

  const why = fx.fxQuote?.message ?? 'FX unavailable';
  return `Akahu market value: ${value} ${currency} (FX unavailable — ${why}; no NZD applied)`;
}

function upsertPriceQuote(
  db: Database,
  assetKey: string,
  item: AkahuPortfolioItem,
  now: string,
  fx: ValueNoteFx,
): void {
  const currency = (item.currency ?? 'NZD').toUpperCase();
  const valueNative = finiteOrNull(item.value);
  const shares = finiteOrNull(item.shares);

  // Resolve NZD total: native NZD or live FX conversion
  let valueNzd: number | null = null;
  let fxNote = '';
  if (valueNative != null) {
    if (!currency || currency === 'NZD') {
      valueNzd = valueNative;
      fxNote = `${valueNative} NZD`;
    } else if (fx.converted) {
      valueNzd = fx.converted.nzd;
      fxNote =
        `${valueNative} ${currency} → ${Math.round(valueNzd * 100) / 100} NZD ` +
        `@ ${fx.converted.rate} (${fx.converted.source})`;
    }
  }

  if (valueNzd != null && Number.isFinite(valueNzd)) {
    let unit: number | null = null;
    let status = 'ok';
    let notes: string | null = `Akahu portfolio value ${fxNote}`;
    if (shares != null && shares > 0) {
      unit = valueNzd / shares;
      notes = `Akahu implied NZD unit from value/shares (${fxNote} / ${shares})`;
    } else {
      // Quantity unknown — store NZD *total* as price so cards can still show Value
      unit = valueNzd;
      status = 'ok';
      notes = `Akahu total NZD ${fxNote} (quantity unknown; price holds total NZD)`;
    }
    run(
      db,
      `INSERT INTO price_quotes (id, asset_key, currency, price, status, source, as_of, notes)
       VALUES (?, ?, 'NZD', ?, ?, 'akahu', ?, ?)
       ON CONFLICT(asset_key) DO UPDATE SET
         price=excluded.price, status=excluded.status, source=excluded.source,
         as_of=excluded.as_of, notes=excluded.notes, currency=excluded.currency`,
      [newId('q'), assetKey, unit, status, now, notes],
    );
    return;
  }

  // FX failed or value missing — never invent; note-only unavailable quote
  const note =
    valueNative != null
      ? `Akahu value ${valueNative} ${currency || '?'} (FX unavailable; no NZD applied)`
      : 'Akahu value unknown (no FX applied)';
  run(
    db,
    `INSERT INTO price_quotes (id, asset_key, currency, price, status, source, as_of, notes)
     VALUES (?, ?, ?, NULL, 'unavailable', 'akahu', ?, ?)
     ON CONFLICT(asset_key) DO UPDATE SET
       price=NULL, status='unavailable', source='akahu',
       as_of=excluded.as_of, notes=excluded.notes, currency=excluded.currency`,
    [newId('q'), assetKey, currency || 'NZD', now, note],
  );
}

function upsertHolding(
  db: Database,
  opts: {
    userId: string;
    externalId: string;
    source: string;
    assetClass: 'stock' | 'crypto';
    name: string;
    notes: string | null;
    /** NZD cost when known from Akahu; null = unknown (never fake 0). */
    costBasisNzd?: number | null;
    symbol?: string | null;
    shares?: number | null;
    exchange?: string | null;
    asset?: string | null;
    amount?: number | null;
    /** Akahu instrument logo URL (icons only). */
    logoUrl?: string | null;
    now: string;
  },
): 'inserted' | 'updated' {
  // Explicit null stays null; undefined treated as null on insert. Never coerce to 0.
  const cost =
    opts.costBasisNzd != null && Number.isFinite(opts.costBasisNzd) && opts.costBasisNzd > 0
      ? opts.costBasisNzd
      : null;
  const logoUrl = normalizeLogoUrl(opts.logoUrl ?? null);

  const existing = queryOne(
    db,
    'SELECT id FROM holdings WHERE external_id = ? AND user_id = ?',
    [opts.externalId, opts.userId],
  );
  if (existing) {
    if (opts.assetClass === 'stock') {
      run(
        db,
        `UPDATE holdings SET
          asset_class=?, name=?, notes=?, source=?, updated_at=?,
          cost_basis_nzd=?,
          symbol=?, shares=?, exchange=?, asset=NULL, amount=NULL,
          logo_url=?
         WHERE id=?`,
        [
          opts.assetClass,
          opts.name,
          opts.notes,
          opts.source,
          opts.now,
          cost,
          opts.symbol ?? null,
          opts.shares ?? null,
          opts.exchange ?? null,
          logoUrl,
          existing.id,
        ],
      );
    } else {
      run(
        db,
        `UPDATE holdings SET
          asset_class=?, name=?, notes=?, source=?, updated_at=?,
          cost_basis_nzd=?,
          asset=?, amount=?, symbol=NULL, shares=NULL, exchange=NULL,
          logo_url=?
         WHERE id=?`,
        [
          opts.assetClass,
          opts.name,
          opts.notes,
          opts.source,
          opts.now,
          cost,
          opts.asset ?? null,
          opts.amount ?? null,
          logoUrl,
          existing.id,
        ],
      );
    }
    return 'updated';
  }

  const id = newId('hld');
  run(
    db,
    `INSERT INTO holdings (
      id, user_id, asset_class, name, notes, cost_basis_nzd, acquired_at, created_at, updated_at,
      symbol, shares, exchange, asset, amount, source, external_id, logo_url
    ) VALUES (?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      opts.userId,
      opts.assetClass,
      opts.name,
      opts.notes,
      cost,
      opts.now,
      opts.now,
      opts.symbol ?? null,
      opts.shares ?? null,
      opts.exchange ?? null,
      opts.asset ?? null,
      opts.amount ?? null,
      opts.source,
      opts.externalId,
      logoUrl,
    ],
  );
  return 'inserted';
}

/** Auckland calendar day YYYY-MM-DD for history bucket keys. */
function aucklandDay(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

/**
 * Sync Sharesies KiwiSaver from Akahu account payload.
 * Real fields only: balance.current, meta.breakdown.returns, meta.portfolio[], profile.pir.
 * History = local points recorded on each sync (Akahu does not expose balance timeseries).
 * Activity = account transactions when available; Sharesies KS currently has attributes=[] → unavailable.
 */
async function syncKiwiSaver(db: Database, account: AkahuAccount, now: string, userId: string): Promise<number> {
  const portfolio = account.meta?.portfolio ?? [];
  const balance = Number(account.balance?.current ?? 0);
  const currency = (account.balance?.currency ?? 'NZD').toUpperCase();
  // Live Sharesies KS is NZD. Non-NZD would need FX — never invent; still store raw current.
  void currency;
  const breakdown = account.meta?.breakdown as { returns?: number; cost_basis?: number } | undefined;
  const returnsNzd = finiteOrNull(breakdown?.returns);
  const profile = account.meta?.profile as { pir?: number } | undefined;
  const pir = finiteOrNull(profile?.pir);
  const totalValue = portfolio.reduce((s, p) => s + (Number(p.value) || 0), 0);

  const fundMix = portfolio.map((p) => {
    const bal = p.value != null ? Number(p.value) : null;
    const itemReturns = finiteOrNull(p.returns);
    let allocationPct: number | null = null;
    // Allocation vs account balance (authoritative) — residual may exist outside portfolio[].
    if (bal != null && balance > 0) {
      allocationPct = Math.round((bal / balance) * 10000) / 100;
    } else if (bal != null && totalValue > 0) {
      allocationPct = Math.round((bal / totalValue) * 10000) / 100;
    }
    const cur = (p.currency ?? 'NZD').toUpperCase();
    return {
      fundName: p.name ?? p.symbol ?? 'Fund',
      allocationPct,
      balanceNzd: cur === 'NZD' ? bal : null,
      returnsNzd: cur === 'NZD' ? itemReturns : null,
      shares: finiteOrNull(p.shares),
      symbol: p.symbol ?? undefined,
      logo: normalizeLogoUrl(p.logo) ?? undefined,
      fundId: p.fund_id ?? undefined,
      currency: cur,
    };
  });

  const attrs = account.attributes ?? [];
  const hasTxnAttr = attrs.map((a) => String(a).toUpperCase()).includes('TRANSACTIONS');
  let activityStatus = 'unavailable';
  let activityNote =
    'Sharesies KiwiSaver via Akahu has no TRANSACTIONS attribute; account ledger history is not exposed. Government contribution is not a separate Akahu field.';
  let txns: Awaited<ReturnType<typeof akahuGetAccountTransactions>> = [];

  try {
    const start = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString();
    txns = await akahuGetAccountTransactions(account._id, { start, end: now });
    if (txns.length > 0) {
      activityStatus = 'ok';
      activityNote = `Akahu account transactions (${txns.length} in window).`;
    } else if (hasTxnAttr) {
      activityStatus = 'empty';
      activityNote =
        'Akahu TRANSACTIONS attribute present but no settled transactions in the last ~400 days.';
    } else {
      activityStatus = 'unavailable';
      activityNote =
        'Sharesies KiwiSaver via Akahu: attributes=[] (no TRANSACTIONS); GET /accounts/{id}/transactions returned 0 items. Government contribution unavailable as a provider field.';
    }
  } catch (err) {
    activityStatus = 'unavailable';
    activityNote = `Could not fetch KiwiSaver transactions: ${
      err instanceof Error ? err.message.slice(0, 160) : String(err)
    }. Government contribution unavailable.`;
    txns = [];
  }

  const extId = `akahu:${account._id}`;
  const existing = queryOne(
    db,
    `SELECT * FROM kiwisaver_accounts
     WHERE user_id = ? AND (external_id=? OR provider='sharesies')
     LIMIT 1`,
    [userId, extId],
  );

  const notes = `Synced via Akahu (${account._id}) · NZD`;
  let accountId: string;

  if (existing) {
    accountId = String(existing.id);
    // Keep prior provider returns/PIR if this payload omits them (never invent; never wipe).
    const returnsToStore =
      returnsNzd != null ? returnsNzd : finiteOrNull(existing.returns_nzd);
    const pirToStore = pir != null ? pir : finiteOrNull(existing.pir);
    const fundMixJson =
      fundMix.length > 0
        ? JSON.stringify(fundMix)
        : String(existing.fund_mix_json ?? '[]');
    run(
      db,
      `UPDATE kiwisaver_accounts SET
        name=?, balance_nzd=?, returns_nzd=?, external_id=?, pir=?,
        fund_mix_json=?, observed_at=?, connection_status='akahu', notes=?,
        activity_status=?, activity_note=?, updated_at=?
       WHERE id=?`,
      [
        account.name || existing.name,
        balance,
        returnsToStore,
        extId,
        pirToStore,
        fundMixJson,
        now,
        notes,
        activityStatus,
        activityNote,
        now,
        accountId,
      ],
    );
  } else {
    accountId = newId('ks');
    run(
      db,
      `INSERT INTO kiwisaver_accounts
        (id, user_id, name, provider, scheme_name, balance_nzd, returns_nzd, external_id, pir,
         fund_mix_json, observed_at, connection_status, notes, activity_status, activity_note,
         created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        accountId,
        userId,
        account.name || 'KiwiSaver',
        'sharesies',
        null,
        balance,
        returnsNzd,
        extId,
        pir,
        JSON.stringify(fundMix),
        now,
        'akahu',
        notes,
        activityStatus,
        activityNote,
        now,
        now,
      ],
    );
  }

  // Persist history with the same returns we stored on the account (preserve if omitted).
  const stored = queryOne(db, 'SELECT returns_nzd FROM kiwisaver_accounts WHERE id=?', [accountId]);
  const historyReturns = finiteOrNull(stored?.returns_nzd) ?? returnsNzd;

  // One history point per Auckland day (real balance/returns from this sync).
  const day = aucklandDay(now);
  const histExisting = queryOne(
    db,
    `SELECT id FROM kiwisaver_balance_history WHERE account_id=? AND observed_at=?`,
    [accountId, day],
  );
  if (histExisting) {
    run(
      db,
      `UPDATE kiwisaver_balance_history SET balance_nzd=?, returns_nzd=?, source='akahu' WHERE id=?`,
      [balance, historyReturns, histExisting.id],
    );
  } else {
    run(
      db,
      `INSERT INTO kiwisaver_balance_history
        (id, account_id, observed_at, balance_nzd, returns_nzd, source)
       VALUES (?,?,?,?,?,?)`,
      [newId('ksh'), accountId, day, balance, historyReturns, 'akahu'],
    );
  }

  for (const t of txns) {
    const ext = `akahu:${t._id}`;
    const found = queryOne(db, `SELECT id FROM kiwisaver_activity WHERE external_id=?`, [ext]);
    if (found) {
      run(
        db,
        `UPDATE kiwisaver_activity SET date=?, description=?, amount_nzd=?, txn_type=? WHERE id=?`,
        [t.date, t.description ?? '', Number(t.amount) || 0, t.type ?? null, found.id],
      );
    } else {
      run(
        db,
        `INSERT INTO kiwisaver_activity
          (id, account_id, external_id, date, description, amount_nzd, txn_type, source, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          newId('ksa'),
          accountId,
          ext,
          t.date,
          t.description ?? '',
          Number(t.amount) || 0,
          t.type ?? null,
          'akahu',
          now,
        ],
      );
    }
  }

  return fundMix.length;
}

/** Account types never stored as bank_accounts cash (handled elsewhere). */
const NON_CASH_ACCOUNT_TYPES = new Set(['INVESTMENT', 'KIWISAVER', 'REWARDS']);

/**
 * Map Akahu account.type → local bank_accounts.account_type.
 * Kiwibank Everyday/Main accounts arrive as CHECKING → cheque.
 */
export function mapAkahuAccountType(type: string): string {
  switch ((type ?? '').toUpperCase()) {
    case 'CHECKING':
      return 'cheque';
    case 'SAVINGS':
      return 'savings';
    case 'CREDITCARD':
      return 'credit';
    case 'LOAN':
      return 'loan';
    case 'WALLET':
      return 'wallet';
    case 'TERMDEPOSIT':
      return 'term_deposit';
    case 'FOREIGN':
    case 'TAX':
    default:
      return 'other';
  }
}

/** Local account_type values that count as liquid cash for net-worth Cash. */
export const LIQUID_CASH_ACCOUNT_TYPES = new Set([
  'cheque',
  'savings',
  'wallet',
  'term_deposit',
]);

/** Local account_type values treated as liabilities (excluded from Cash total). */
export const LIABILITY_ACCOUNT_TYPES = new Set(['credit', 'loan']);

/**
 * True when a bank_accounts.account_type should feed cashNzd.
 * Includes legacy Sharesies WALLET rows stored as "other" (pre wallet mapping).
 */
export function isLiquidCashAccountType(accountType: string, notes?: string | null): boolean {
  const t = (accountType ?? '').toLowerCase();
  if (LIABILITY_ACCOUNT_TYPES.has(t)) return false;
  if (LIQUID_CASH_ACCOUNT_TYPES.has(t)) return true;
  // Legacy: WALLET was mapped to "other" before wallet type existed
  if (t === 'other' && notes && /\bWALLET\b/i.test(notes)) return true;
  return false;
}

/**
 * Coerce Akahu balance payloads to a finite number.
 * Accepts bare numbers, numeric strings, or `{ current, available?, currency? }`.
 * Never returns the object itself (that becomes "[object Object]" in UI).
 */
export function coerceAkahuBalance(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === 'object' && raw !== null && 'current' in raw) {
    return coerceAkahuBalance((raw as { current: unknown }).current);
  }
  return null;
}

/** Display name: "Main · 38-9014-…" — never append balance (object → [object Object]). */
export function cashAccountDisplayName(account: Pick<AkahuAccount, 'name' | 'formatted_account'>): string {
  const base = (account.name ?? '').trim() || 'Account';
  const fmt = (account.formatted_account ?? '').trim();
  return fmt ? `${base} · ${fmt}` : base;
}

/**
 * Decide whether an Akahu account should upsert into bank_accounts.
 *
 * Prefer: ANY account with a numeric balance.current that is NOT
 * INVESTMENT / KIWISAVER / REWARDS — regardless of connection.name.
 * That covers Kiwibank (CHECKING), other NZ banks, Sharesies Spend/Rainy day,
 * and Sharesies/Hatch wallets without a connection-name filter.
 *
 * balance.current === 0 is valid (e.g. empty Kiwibank Debit card).
 * Missing balance / non-numeric current → skip (do not invent balances).
 */
export function shouldSyncAsCash(
  account: Pick<AkahuAccount, 'type' | 'balance' | 'connection' | 'name'>,
): boolean {
  const type = (account.type ?? '').toUpperCase();
  if (NON_CASH_ACCOUNT_TYPES.has(type)) return false;
  // Require a numeric balance (0 is valid; missing → skip). Never store the object.
  return coerceAkahuBalance(account.balance) != null;
}

/**
 * Upsert traditional bank + broker cash wallets into bank_accounts.
 * Includes Kiwibank Main / Debit card and any similar NZ bank cash accounts.
 * Skips INVESTMENT and KIWISAVER (handled elsewhere). Non-NZD balances are
 * stored as-is; cashNzd summary stays NZD-only (no FX).
 */
/**
 * Upsert traditional bank + broker cash wallets into bank_accounts.
 * Includes Kiwibank Main / Debit card. Stores Number(balance.current) only.
 * Name may include formatted_account; never the balance object.
 */
function syncCashAccount(db: Database, account: AkahuAccount, now: string, userId: string): boolean {
  if (!shouldSyncAsCash(account)) return false;

  const conn = account.connection?.name ?? '';
  const type = (account.type ?? '').toUpperCase();
  const name = cashAccountDisplayName(account);

  const ext = `akahu:${account._id}`;
  const currency = (account.balance!.currency ?? 'NZD').toUpperCase();
  const balance = coerceAkahuBalance(account.balance);
  if (balance == null) return false;
  const accountType = mapAkahuAccountType(type);
  const notes = `${ext} · ${conn} ${type}`;

  // Prefer external_id; fall back to notes LIKE for DBs migrated mid-flight (same user only)
  let existing = queryOne(
    db,
    `SELECT * FROM bank_accounts WHERE external_id = ? AND user_id = ? LIMIT 1`,
    [ext, userId],
  );
  if (!existing) {
    existing = queryOne(
      db,
      `SELECT * FROM bank_accounts WHERE notes LIKE ? AND user_id = ? LIMIT 1`,
      [`%${ext}%`, userId],
    );
  }

  if (existing) {
    run(
      db,
      `UPDATE bank_accounts SET
         name=?, institution=?, account_type=?, currency=?, balance=?, notes=?,
         external_id=?, updated_at=?
       WHERE id=?`,
      [name, conn, accountType, currency, balance, notes, ext, now, existing.id],
    );
  } else {
    run(
      db,
      `INSERT INTO bank_accounts
         (id, user_id, name, institution, account_type, currency, balance, notes, external_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [newId('acct'), userId, name, conn, accountType, currency, balance, notes, ext, now, now],
    );
  }
  return true;
}

/**
 * Upsert all Akahu accounts that shouldSyncAsCash (Kiwibank, Sharesies Spend,
 * Rainy day, wallets, etc.) into bank_accounts. Used by portfolio sync and by
 * transaction sync so Spend/payment cards exist before txn mapping.
 */
export function upsertAkahuCashAccounts(
  db: Database,
  accounts: AkahuAccount[],
  now: string = new Date().toISOString(),
  userId?: string,
): number {
  if (!userId) {
    throw new Error('upsertAkahuCashAccounts requires userId for per-user isolation');
  }
  let n = 0;
  for (const account of accounts) {
    if (account.status && account.status !== 'ACTIVE') continue;
    if (syncCashAccount(db, account, now, userId)) n += 1;
  }
  return n;
}

export async function syncAkahuPortfolio(db: Database, userId: string): Promise<AkahuSyncResult> {
  if (!userId) throw new Error('syncAkahuPortfolio requires userId');
  const now = new Date().toISOString();
  const accounts = await akahuGetAccounts();

  const seenExternalIds = new Set<string>();
  const stockSymbols: string[] = [];
  const cryptoSymbols: string[] = [];
  const sources = new Set<string>();
  const fxSources = new Set<string>();
  let stocksUpserted = 0;
  let cryptoUpserted = 0;
  let kiwisaverFunds = 0;
  let kiwisaverBalanceSynced = false;
  let cashAccountsUpserted = 0;

  // Prefetch live FX for every non-NZD portfolio currency (never invent).
  const currenciesNeeded: string[] = [];
  for (const account of accounts) {
    if (account.status && account.status !== 'ACTIVE') continue;
    const conn = account.connection?.name ?? '';
    const type = (account.type ?? '').toUpperCase();
    if (type !== 'INVESTMENT') continue;
    if (conn !== 'Sharesies' && conn !== 'Hatch') continue;
    for (const item of account.meta?.portfolio ?? []) {
      const c = (item.currency ?? 'NZD').toUpperCase();
      if (c && c !== 'NZD') currenciesNeeded.push(c);
    }
  }
  const fxMap = await prefetchFxToNzd(currenciesNeeded, true);
  for (const q of fxMap.values()) {
    if (q.status === 'ok' && q.source !== 'identity') {
      fxSources.add(q.source === 'frankfurter' ? 'Frankfurter' : q.source);
    }
  }

  function fxForItem(item: AkahuPortfolioItem): {
    converted: ConvertToNzdResult | null;
    fxQuote: FxToNzdQuote | null;
  } {
    const currency = (item.currency ?? 'NZD').toUpperCase();
    const value = finiteOrNull(item.value);
    if (value == null) return { converted: null, fxQuote: null };
    if (!currency || currency === 'NZD') {
      return {
        converted: {
          nzd: value,
          rate: 1,
          fromCurrency: 'NZD',
          source: 'identity',
          asOf: now,
          message: 'NZD identity',
        },
        fxQuote: {
          fromCurrency: 'NZD',
          rate: 1,
          status: 'ok',
          source: 'identity',
          asOf: now,
          message: 'NZD identity',
        },
      };
    }
    const fxQuote = fxMap.get(currency) ?? null;
    if (!fxQuote || fxQuote.status !== 'ok' || fxQuote.rate == null) {
      return { converted: null, fxQuote };
    }
    return {
      converted: {
        nzd: value * fxQuote.rate,
        rate: fxQuote.rate,
        fromCurrency: currency,
        source: fxQuote.source,
        asOf: fxQuote.asOf ?? now,
        message: fxQuote.message ?? `${currency}→NZD @ ${fxQuote.rate}`,
      },
      fxQuote,
    };
  }

  function costBasisNzdFor(
    item: AkahuPortfolioItem,
    account: AkahuAccount,
  ): number | null {
    const costNative = deriveAkahuCostInCurrency(item, account);
    if (costNative == null) return null;
    const currency = (item.currency ?? 'NZD').toUpperCase();
    if (!currency || currency === 'NZD') return costNative;
    const fxQuote = fxMap.get(currency);
    if (!fxQuote || fxQuote.status !== 'ok' || fxQuote.rate == null) return null;
    return costNative * fxQuote.rate;
  }

  for (const account of accounts) {
    if (account.status && account.status !== 'ACTIVE') continue;
    const conn = account.connection?.name ?? 'Unknown';
    const type = (account.type ?? '').toUpperCase();

    if (conn === 'Sharesies' && type === 'KIWISAVER') {
      kiwisaverFunds = await syncKiwiSaver(db, account, now, userId);
      kiwisaverBalanceSynced = true;
      sources.add('Sharesies');
      continue;
    }

    if (syncCashAccount(db, account, now, userId)) {
      cashAccountsUpserted += 1;
      sources.add(conn);
    }

    if (type !== 'INVESTMENT') continue;
    if (conn !== 'Sharesies' && conn !== 'Hatch') continue;

    const portfolio = account.meta?.portfolio ?? [];
    const sourceLabel = conn; // Sharesies | Hatch
    sources.add(sourceLabel);

    for (const item of portfolio) {
      const fundId = item.fund_id;
      const ext = externalIdFor(conn, account._id, fundId);
      seenExternalIds.add(ext);

      const crypto = isCryptoHolding(account, item);
      const fx = fxForItem(item);
      const notes = valueNote(item, fx);
      const costBasisNzd = costBasisNzdFor(item, account);

      if (crypto) {
        const symbol = (item.symbol ?? item.name ?? 'CRYPTO').toUpperCase();
        upsertHolding(db, {
          userId,
          externalId: ext,
          source: sourceLabel,
          assetClass: 'crypto',
          name: item.name ?? symbol,
          notes,
          costBasisNzd,
          asset: symbol,
          amount: item.shares != null ? Number(item.shares) : 0,
          logoUrl: item.logo ?? null,
          now,
        });
        cryptoUpserted += 1;
        if (!cryptoSymbols.includes(symbol)) cryptoSymbols.push(symbol);
        const assetKey = `CRYPTO:${symbol}`;
        upsertPriceQuote(db, assetKey, item, now, fx);
      } else {
        const symbol = item.symbol ?? 'UNKNOWN';
        upsertHolding(db, {
          userId,
          externalId: ext,
          source: sourceLabel,
          assetClass: 'stock',
          name: item.name ?? symbol,
          notes,
          costBasisNzd,
          symbol,
          shares: item.shares != null ? Number(item.shares) : 0,
          exchange: item.exchange ?? null,
          logoUrl: item.logo ?? null,
          now,
        });
        stocksUpserted += 1;
        if (!stockSymbols.includes(symbol)) stockSymbols.push(symbol);
        const assetKey = `STOCK:${symbol}`;
        upsertPriceQuote(db, assetKey, item, now, fx);
      }
    }
  }

  // Delete stale Akahu-sourced holdings for Sharesies/Hatch that disappeared
  const prior = queryAll<{ id: string; external_id: string; asset_class: string }>(
    db,
    `SELECT id, external_id, asset_class FROM holdings
     WHERE user_id = ?
       AND external_id IS NOT NULL AND external_id LIKE 'akahu:%'
       AND source IN ('Sharesies', 'Hatch')`,
    [userId],
  );
  let stocksDeleted = 0;
  let cryptoDeleted = 0;
  for (const row of prior) {
    if (seenExternalIds.has(row.external_id)) continue;
    unlinkDividendsForHolding(db, userId, row.id);
    run(db, 'DELETE FROM holdings WHERE id = ? AND user_id = ?', [row.id, userId]);
    if (row.asset_class === 'crypto') cryptoDeleted += 1;
    else stocksDeleted += 1;
  }

  return {
    ok: true,
    stocksUpserted,
    cryptoUpserted,
    stocksDeleted,
    cryptoDeleted,
    kiwisaverFunds,
    kiwisaverBalanceSynced,
    cashAccountsUpserted,
    stockSymbols,
    cryptoSymbols,
    sources: [...sources],
    fxSources: [...fxSources],
  };
}
