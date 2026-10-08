/**
 * Bank accounts + spending transactions.
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { CHARITY_SLUG, resolveCategoryIdOrSlug } from '../lib/categories.ts';
import { createCategoryPredictor } from '../lib/categoryPredict.ts';
import { getDb, queryAll, queryOne, run, newId } from '../db/index.ts';
import { coerceAkahuBalance } from '../akahu/sync.ts';
import { TXN_SYNC_FROM_DATE } from '../akahu/syncTransactions.ts';
import { parseWalletCsv } from '../../src/imports/walletCsv.ts';
import { linkInvoicePaymentsToBankCredits } from '../invoices/store.ts';
import {
  applyBtcLink,
  clearTxnBtcApplied,
  listBtcHoldings,
  pickPrimaryBtcHolding,
  readTxnBtcMeta,
  restoreStoredBtcDelta,
  reverseBtcDelta,
  writeTxnBtcColumns,
} from '../lib/txnBtcLink.ts';
import {
  deleteCharityReceipt,
  photoUrlFromPath,
  saveCharityReceipt,
} from '../lib/uploads.ts';

export const CHARITY_CATEGORY_ID = CHARITY_SLUG;

function charityCategoryIdFor(db: Parameters<typeof resolveCategoryIdOrSlug>[0], userId: string): string {
  return resolveCategoryIdOrSlug(db, userId, CHARITY_SLUG);
}

function isCharityCategoryId(categoryId: string | null | undefined, userCharityId: string): boolean {
  if (!categoryId) return false;
  if (categoryId === userCharityId) return true;
  if (categoryId === CHARITY_SLUG) return true;
  if (categoryId.startsWith(`${CHARITY_SLUG}__`)) return true;
  return false;
}

const router = Router();

const ALLOWED_SOURCES = new Set(['akahu', 'bank', 'google_wallet', 'manual', 'csv']);

/** Turn DB / legacy values into a finite number (handles object leftovers). */
function readBalance(raw: unknown): number {
  const n = coerceAkahuBalance(raw);
  if (n != null) return n;
  const fallback = Number(raw);
  return Number.isFinite(fallback) ? fallback : 0;
}

router.get('/', async (req: AuthedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const db = await getDb();
  const rows = queryAll(db, 'SELECT * FROM bank_accounts WHERE user_id = ? ORDER BY name', [userId]);
  res.json(rows.map(mapAccount));
});

function mapAccount(r: Record<string, unknown>) {
  return {
    id: r.id,
    name: r.name,
    institution: r.institution,
    accountType: r.account_type,
    currency: r.currency,
    balance: readBalance(r.balance),
    notes: r.notes,
    externalId: r.external_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapTransaction(r: Record<string, unknown>) {
  const btc = readTxnBtcMeta(r);
  return {
    id: r.id,
    accountId: r.account_id,
    accountName: r.account_name ?? null,
    date: r.date,
    description: r.description,
    amount: r.amount,
    kind: r.kind,
    categoryId: r.category_id,
    currency: r.currency,
    externalId: r.external_id,
    createdAt: r.created_at,
    cardName: r.card_name ?? null,
    merchant: r.merchant ?? null,
    source: r.source ?? 'manual',
    affectsBtc: btc.affectsBtc,
    btcHoldingId: btc.btcHoldingId,
    btcDeltaApplied: btc.btcDeltaApplied,
    btcNzdRate: btc.btcNzdRate,
    btcAppliedAt: btc.btcAppliedAt,
    btcHoldingName: r.btc_holding_name ?? null,
    receiptPath: r.receipt_path ?? null,
    receiptUrl: photoUrlFromPath((r.receipt_path as string | null) ?? null),
  };
}

router.post('/', async (req: AuthedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const db = await getDb();
  const b = req.body ?? {};
  const id = newId('acct');
  const now = new Date().toISOString();
  const balance = readBalance(b.balance ?? 0);
  run(
    db,
    `INSERT INTO bank_accounts (id, user_id, name, institution, account_type, currency, balance, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, b.name ?? 'Account', b.institution ?? '', b.accountType ?? 'other', b.currency ?? 'NZD', balance, b.notes ?? null, now, now],
  );
  res.status(201).json(mapAccount(queryOne(db, 'SELECT * FROM bank_accounts WHERE id=? AND user_id=?', [id, userId])!));
});

/** BTC crypto holdings available for "Use BTC" on spending txns. */
router.get('/btc-holdings', async (req: AuthedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const db = await getDb();
  const holdings = listBtcHoldings(db, userId);
  const primary = pickPrimaryBtcHolding(holdings);
  res.json({
    holdings,
    primaryId: primary?.id ?? null,
  });
});

router.get('/transactions', async (req: AuthedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const db = await getDb();
  const from =
    typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)
      ? req.query.from
      : TXN_SYNC_FROM_DATE;
  const to =
    typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)
      ? req.query.to
      : null;
  const rows = queryAll(
    db,
    to
      ? `SELECT t.*, a.name AS account_name, h.name AS btc_holding_name
     FROM transactions t
     LEFT JOIN bank_accounts a ON a.id = t.account_id
     LEFT JOIN holdings h ON h.id = t.btc_holding_id AND h.user_id = t.user_id
     WHERE t.user_id = ? AND t.date >= ? AND t.date <= ?
     ORDER BY t.date DESC, t.created_at DESC
     LIMIT 1000`
      : `SELECT t.*, a.name AS account_name, h.name AS btc_holding_name
     FROM transactions t
     LEFT JOIN bank_accounts a ON a.id = t.account_id
     LEFT JOIN holdings h ON h.id = t.btc_holding_id AND h.user_id = t.user_id
     WHERE t.user_id = ? AND t.date >= ?
     ORDER BY t.date DESC, t.created_at DESC
     LIMIT 1000`,
    to ? [userId, from, to] : [userId, from],
  );
  res.json(rows.map(mapTransaction));
});

router.post('/transactions', async (req: AuthedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const db = await getDb();
  const b = req.body ?? {};
  // Charged bank account. Null / omitted = not charged to one (e.g. crypto Visa debit card):
  // the spend still counts in budgets but no cash account is involved.
  const accountId = typeof b.accountId === 'string' && b.accountId.trim() ? b.accountId.trim() : null;
  if (accountId) {
    const acct = queryOne(db, 'SELECT id FROM bank_accounts WHERE id=? AND user_id=?', [accountId, userId]);
    if (!acct) {
      return res.status(400).json({ ok: false, error: 'Unknown accountId' });
    }
  }

  const date =
    typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date)
      ? b.date
      : null;
  if (!date) {
    return res.status(400).json({ ok: false, error: 'date must be YYYY-MM-DD' });
  }
  if (date < TXN_SYNC_FROM_DATE) {
    return res.status(400).json({
      ok: false,
      error: `Only transactions on/after ${TXN_SYNC_FROM_DATE} are accepted`,
    });
  }

  const amount = Number(b.amount);
  if (!Number.isFinite(amount)) {
    return res.status(400).json({ ok: false, error: 'amount must be a number' });
  }

  let source = typeof b.source === 'string' ? b.source : 'manual';
  if (!ALLOWED_SOURCES.has(source)) source = 'manual';
  // Convenience: UI "Google Wallet" toggle
  if (b.source === 'google_wallet' || b.wallet === true) source = 'google_wallet';

  const cardName =
    typeof b.cardName === 'string' && b.cardName.trim()
      ? b.cardName.trim()
      : null;
  if (source === 'google_wallet' && !cardName) {
    return res.status(400).json({
      ok: false,
      error: 'cardName is required for Google Wallet transactions',
    });
  }

  let kind = typeof b.kind === 'string' ? b.kind : amount < 0 ? 'debit' : 'credit';
  if (!['debit', 'credit', 'transfer'].includes(kind)) {
    kind = amount < 0 ? 'debit' : 'credit';
  }

  const description = (() => {
    if (typeof b.description === 'string' && b.description.trim()) return b.description.trim();
    if (source === 'bank') return cardName || 'Bank';
    if (source === 'google_wallet') return cardName || 'Google Wallet';
    return cardName || '(manual)';
  })();
  const merchant =
    typeof b.merchant === 'string' && b.merchant.trim() ? b.merchant.trim() : null;
  const currency = typeof b.currency === 'string' ? b.currency : 'NZD';
  const categoryProvided = typeof b.categoryId === 'string' && b.categoryId.trim() !== '';
  let categoryId = categoryProvided ? b.categoryId.trim() : null;
  if (categoryId && !queryOne(db, 'SELECT id FROM budget_categories WHERE id=? AND user_id=?', [categoryId, userId])) {
    return res.status(400).json({ ok: false, error: 'Unknown categoryId' });
  }
  if (!categoryProvided) {
    // "Automatic": payee's saved category, else a guess from similar past transactions.
    categoryId = createCategoryPredictor(db, userId)({ merchant, description, amount })?.categoryId ?? null;
  }
  const externalId =
    typeof b.externalId === 'string' && b.externalId.trim()
      ? b.externalId.trim()
      : null;

  if (externalId) {
    const dup = queryOne(db, 'SELECT id FROM transactions WHERE external_id=? AND user_id=?', [externalId, userId]);
    if (dup) {
      return res.status(409).json({ ok: false, error: 'Duplicate externalId', id: dup.id });
    }
  }

  const affectsBtc = b.affectsBtc === true || b.affectsBtc === 1 || b.affectsBtc === '1';
  const btcHoldingId =
    typeof b.btcHoldingId === 'string' && b.btcHoldingId.trim()
      ? b.btcHoldingId.trim()
      : null;

  // Apply BTC holding move before insert metadata (fail closed if quote missing)
  const btcResult = await applyBtcLink(db, {
    userId,
    affectsBtc,
    amountNzd: amount,
    kind,
    btcHoldingId,
  });
  if (!btcResult.ok) {
    return res.status(btcResult.status).json({ ok: false, error: btcResult.error });
  }

  const id = newId('txn');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO transactions (
       id, user_id, account_id, date, description, amount, kind, category_id,
       currency, external_id, created_at, card_name, merchant, source,
       affects_btc, btc_holding_id, btc_delta_applied, btc_nzd_rate, btc_applied_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      userId,
      accountId,
      date,
      description,
      amount,
      kind,
      categoryId,
      currency,
      externalId,
      now,
      cardName,
      merchant,
      source,
      btcResult.meta.affectsBtc ? 1 : 0,
      btcResult.meta.btcHoldingId,
      btcResult.meta.btcDeltaApplied,
      btcResult.meta.btcNzdRate,
      btcResult.meta.btcAppliedAt,
    ],
  );

  const row = queryOne(
    db,
    `SELECT t.*, a.name AS account_name, h.name AS btc_holding_name
     FROM transactions t
     LEFT JOIN bank_accounts a ON a.id = t.account_id
     LEFT JOIN holdings h ON h.id = t.btc_holding_id AND h.user_id = t.user_id
     WHERE t.id=?`,
    [id],
  )!;
  const mapped = mapTransaction(row);
  res.status(201).json({
    ...mapped,
    btcLink: affectsBtc
      ? {
          applied: true,
          holdingId: btcResult.meta.btcHoldingId,
          holdingName: btcResult.holdingName,
          btcDelta: btcResult.meta.btcDeltaApplied,
          btcNzdRate: btcResult.meta.btcNzdRate,
          quoteSource: btcResult.source,
        }
      : null,
  });
});

/** PATCH category / source / description / cardName / BTC link on a transaction. */
router.patch('/transactions/:id', async (req: AuthedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const db = await getDb();
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  if (!id) {
    return res.status(400).json({ ok: false, error: 'id is required' });
  }
  const existing = queryOne(db, 'SELECT * FROM transactions WHERE id=? AND user_id=?', [id, userId]);
  if (!existing) {
    return res.status(404).json({ ok: false, error: 'Transaction not found' });
  }

  const b = req.body ?? {};
  const hasCategory = 'categoryId' in b;
  const hasSource = 'source' in b;
  const hasDescription = 'description' in b;
  const hasCardName = 'cardName' in b;
  const hasAffectsBtc = 'affectsBtc' in b;
  const hasBtcHoldingId = 'btcHoldingId' in b;
  if (
    !hasCategory &&
    !hasSource &&
    !hasDescription &&
    !hasCardName &&
    !hasAffectsBtc &&
    !hasBtcHoldingId
  ) {
    return res.status(400).json({
      ok: false,
      error:
        'Provide at least one of: categoryId, source, description, cardName, affectsBtc, btcHoldingId',
    });
  }

  const rowDate = String(existing.date ?? '');
  if (rowDate < TXN_SYNC_FROM_DATE) {
    return res.status(400).json({
      ok: false,
      error: `Only transactions on/after ${TXN_SYNC_FROM_DATE} can be updated`,
    });
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (hasCategory) {
    let categoryId: string | null = null;
    if (b.categoryId === null || b.categoryId === '' || b.categoryId === undefined) {
      categoryId = null;
    } else if (typeof b.categoryId === 'string') {
      const cat = queryOne(
        db,
        'SELECT id FROM budget_categories WHERE id=? AND user_id=?',
        [b.categoryId, userId],
      );
      if (!cat) {
        return res.status(400).json({ ok: false, error: 'Unknown categoryId' });
      }
      categoryId = b.categoryId;
    } else {
      return res.status(400).json({ ok: false, error: 'categoryId must be a string or null' });
    }
    sets.push('category_id=?');
    params.push(categoryId);
  }

  if (hasSource) {
    if (typeof b.source !== 'string' || !ALLOWED_SOURCES.has(b.source)) {
      return res.status(400).json({
        ok: false,
        error: `source must be one of: ${[...ALLOWED_SOURCES].join(', ')}`,
      });
    }
    sets.push('source=?');
    params.push(b.source);
  }

  if (hasDescription) {
    if (b.description === null || b.description === undefined) {
      sets.push('description=?');
      params.push('');
    } else if (typeof b.description === 'string') {
      sets.push('description=?');
      params.push(b.description.trim());
    } else {
      return res.status(400).json({ ok: false, error: 'description must be a string' });
    }
  }

  if (hasCardName) {
    if (b.cardName === null || b.cardName === undefined || b.cardName === '') {
      sets.push('card_name=?');
      params.push(null);
    } else if (typeof b.cardName === 'string') {
      sets.push('card_name=?');
      params.push(b.cardName.trim() || null);
    } else {
      return res.status(400).json({ ok: false, error: 'cardName must be a string or null' });
    }
  }

  if (sets.length) {
    params.push(id);
    params.push(userId);
    run(db, `UPDATE transactions SET ${sets.join(', ')} WHERE id=? AND user_id=?`, params);
  }

  // Leaving Charity clears stored IR526 receipt (file + path).
  if (hasCategory) {
    const nextCat =
      b.categoryId === null || b.categoryId === '' || b.categoryId === undefined
        ? null
        : typeof b.categoryId === 'string'
          ? b.categoryId
          : null;
    if (!isCharityCategoryId(nextCat, charityCategoryIdFor(db, userId))) {
      const prevPath = (existing.receipt_path as string | null) ?? null;
      if (prevPath) {
        deleteCharityReceipt(prevPath);
        run(db, 'UPDATE transactions SET receipt_path=NULL WHERE id=? AND user_id=?', [id, userId]);
      }
    }
  }

  // BTC link: only when affectsBtc / btcHoldingId explicitly patched.
  // Category-only patches must NOT re-apply BTC (avoids double-apply).
  if (hasAffectsBtc || hasBtcHoldingId) {
    const fresh = queryOne(db, 'SELECT * FROM transactions WHERE id=? AND user_id=?', [id, userId])!;
    const prevMeta = readTxnBtcMeta(fresh);
    reverseBtcDelta(db, prevMeta, userId);
    clearTxnBtcApplied(db, id, userId);

    const nextAffects = hasAffectsBtc
      ? b.affectsBtc === true || b.affectsBtc === 1 || b.affectsBtc === '1'
      : prevMeta.affectsBtc;
    const nextHoldingId = hasBtcHoldingId
      ? typeof b.btcHoldingId === 'string' && b.btcHoldingId.trim()
        ? b.btcHoldingId.trim()
        : null
      : prevMeta.btcHoldingId;

    const btcResult = await applyBtcLink(db, {
      userId,
      affectsBtc: nextAffects,
      amountNzd: Number(fresh.amount),
      kind: String(fresh.kind ?? 'debit'),
      btcHoldingId: nextHoldingId,
    });
    if (!btcResult.ok) {
      // Put back the exact prior delta (do not re-quote)
      restoreStoredBtcDelta(db, prevMeta, userId);
      writeTxnBtcColumns(db, id, prevMeta, userId);
      return res.status(btcResult.status).json({ ok: false, error: btcResult.error });
    }
    writeTxnBtcColumns(db, id, btcResult.meta, userId);
  }

  const row = queryOne(
    db,
    `SELECT t.*, a.name AS account_name, h.name AS btc_holding_name
     FROM transactions t
     LEFT JOIN bank_accounts a ON a.id = t.account_id
     LEFT JOIN holdings h ON h.id = t.btc_holding_id AND h.user_id = t.user_id
     WHERE t.id=? AND t.user_id=?`,
    [id, userId],
  )!;
  res.json(mapTransaction(row));
});

/**
 * Upload / replace charity donation receipt (IR526).
 * Body: { receiptBase64: data URL or base64 } — JPEG/PNG/WebP/GIF/PDF, max 8MB.
 * Sets category to Charity if not already.
 */
router.post('/transactions/:id/receipt', async (req: AuthedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const db = await getDb();
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  if (!id) {
    return res.status(400).json({ ok: false, error: 'id is required' });
  }
  const existing = queryOne(db, 'SELECT * FROM transactions WHERE id=? AND user_id=?', [id, userId]);
  if (!existing) {
    return res.status(404).json({ ok: false, error: 'Transaction not found' });
  }
  const rowDate = String(existing.date ?? '');
  if (rowDate < TXN_SYNC_FROM_DATE) {
    return res.status(400).json({
      ok: false,
      error: `Only transactions on/after ${TXN_SYNC_FROM_DATE} can be updated`,
    });
  }
  const b64 = req.body?.receiptBase64 ?? req.body?.receipt ?? req.body?.photoBase64;
  if (typeof b64 !== 'string' || !b64.trim()) {
    return res.status(400).json({ ok: false, error: 'receiptBase64 (data URL or base64) required' });
  }
  let receiptPath: string;
  try {
    receiptPath = saveCharityReceipt(id, b64);
  } catch (err) {
    return res.status(400).json({ ok: false, error: (err as Error).message });
  }
  const prevPath = (existing.receipt_path as string | null) ?? null;
  if (prevPath && prevPath !== receiptPath) deleteCharityReceipt(prevPath);
  // Ensure Charity category when attaching an IR526 receipt.
  run(
    db,
    `UPDATE transactions SET receipt_path=?, category_id=? WHERE id=? AND user_id=?`,
    [receiptPath, charityCategoryIdFor(db, userId), id, userId],
  );
  const row = queryOne(
    db,
    `SELECT t.*, a.name AS account_name, h.name AS btc_holding_name
     FROM transactions t
     LEFT JOIN bank_accounts a ON a.id = t.account_id
     LEFT JOIN holdings h ON h.id = t.btc_holding_id AND h.user_id = t.user_id
     WHERE t.id=? AND t.user_id=?`,
    [id, userId],
  )!;
  res.json(mapTransaction(row));
});

/** Remove charity receipt file + path (keeps Charity category). */
router.delete('/transactions/:id/receipt', async (req: AuthedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const db = await getDb();
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  if (!id) {
    return res.status(400).json({ ok: false, error: 'id is required' });
  }
  const existing = queryOne(db, 'SELECT * FROM transactions WHERE id=? AND user_id=?', [id, userId]);
  if (!existing) {
    return res.status(404).json({ ok: false, error: 'Transaction not found' });
  }
  deleteCharityReceipt((existing.receipt_path as string | null) ?? null);
  run(db, 'UPDATE transactions SET receipt_path=NULL WHERE id=? AND user_id=?', [id, userId]);
  const row = queryOne(
    db,
    `SELECT t.*, a.name AS account_name, h.name AS btc_holding_name
     FROM transactions t
     LEFT JOIN bank_accounts a ON a.id = t.account_id
     LEFT JOIN holdings h ON h.id = t.btc_holding_id AND h.user_id = t.user_id
     WHERE t.id=? AND t.user_id=?`,
    [id, userId],
  )!;
  res.json(mapTransaction(row));
});

/** DELETE a transaction by id. */
router.delete('/transactions/:id', async (req: AuthedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const db = await getDb();
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  if (!id) {
    return res.status(400).json({ ok: false, error: 'id is required' });
  }
  const existing = queryOne<{ id: string; date: string }>(
    db,
    'SELECT id, date FROM transactions WHERE id=? AND user_id=?',
    [id, userId],
  );
  if (!existing) {
    return res.status(404).json({ ok: false, error: 'Transaction not found' });
  }
  if (existing.date < TXN_SYNC_FROM_DATE) {
    return res.status(400).json({
      ok: false,
      error: `Only transactions on/after ${TXN_SYNC_FROM_DATE} can be deleted`,
    });
  }
  const full = queryOne(db, 'SELECT * FROM transactions WHERE id=? AND user_id=?', [id, userId]);
  if (full) {
    reverseBtcDelta(db, readTxnBtcMeta(full), userId);
    deleteCharityReceipt((full.receipt_path as string | null) ?? null);
  }
  run(db, 'DELETE FROM transactions WHERE id=? AND user_id=?', [id, userId]);
  res.json({ ok: true, id });
});

/**
 * Import Google Wallet / spend CSV.
 * Body JSON: { csvText, accountId, source? } — or text/csv with ?accountId=
 */
router.post('/transactions/import-wallet-csv', async (req: AuthedRequest, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const db = await getDb();

  let csvText = '';
  let accountId = '';
  let sourcePref = 'google_wallet';

  const ct = (req.headers['content-type'] ?? '').toLowerCase();
  if (ct.includes('application/json') || typeof req.body === 'object') {
    const b = req.body ?? {};
    csvText = typeof b.csvText === 'string' ? b.csvText : typeof b.csv === 'string' ? b.csv : '';
    accountId =
      typeof b.accountId === 'string'
        ? b.accountId
        : typeof req.query.accountId === 'string'
          ? req.query.accountId
          : '';
    if (typeof b.source === 'string' && ALLOWED_SOURCES.has(b.source)) {
      sourcePref = b.source;
    }
  }
  if (!csvText && typeof req.body === 'string') {
    csvText = req.body;
    accountId = typeof req.query.accountId === 'string' ? req.query.accountId : '';
  }
  if (!accountId && typeof req.query.accountId === 'string') {
    accountId = req.query.accountId;
  }

  if (!accountId) {
    return res.status(400).json({ ok: false, error: 'accountId is required (charged bank account)' });
  }
  const acct = queryOne(db, 'SELECT id, name FROM bank_accounts WHERE id=? AND user_id=?', [accountId, userId]);
  if (!acct) {
    return res.status(400).json({ ok: false, error: 'Unknown accountId' });
  }
  if (!csvText.trim()) {
    return res.status(400).json({ ok: false, error: 'csvText is required' });
  }

  const parsed = parseWalletCsv(csvText, accountId);
  const now = new Date().toISOString();
  let inserted = 0;
  let skippedDup = 0;
  let skippedBefore = 0;

  const predict = createCategoryPredictor(db, userId);

  for (const item of parsed.items) {
    if (item.date < TXN_SYNC_FROM_DATE) {
      skippedBefore += 1;
      continue;
    }
    if (item.externalId) {
      const dup = queryOne(
        db,
        'SELECT id FROM transactions WHERE external_id=? AND user_id=?',
        [item.externalId, userId],
      );
      if (dup) {
        skippedDup += 1;
        continue;
      }
    }

    const source =
      sourcePref === 'csv' || sourcePref === 'google_wallet' ? sourcePref : 'google_wallet';
    const cardName = item.cardName?.trim() || null;
    run(
      db,
      `INSERT INTO transactions (
         id, user_id, account_id, date, description, amount, kind, category_id,
         currency, external_id, created_at, card_name, merchant, source
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)`,
      [
        newId('txn'),
        userId,
        accountId,
        item.date,
        item.description,
        item.amount,
        item.kind,
        predict({ description: item.description, amount: item.amount })?.categoryId ?? null,
        item.currency || 'NZD',
        item.externalId,
        now,
        cardName,
        source,
      ],
    );
    inserted += 1;
  }
  // An imported deposit may be an invoice payment already counted as income (KAN-71).
  if (inserted > 0) linkInvoicePaymentsToBankCredits(db, userId);

  res.json({
    ok: true,
    inserted,
    skippedDup,
    skippedBefore,
    parseErrors: parsed.errors,
    headers: parsed.headers,
    sourceLabel: parsed.sourceLabel,
    accountId,
    accountName: acct.name,
  });
});

export default router;
