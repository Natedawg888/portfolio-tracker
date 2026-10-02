/**
 * Income tracking — cash or crypto inflows (NZD), plus monthly planned income.
 * Crypto: qty × live quote (resolveCryptoTicker, same path as holdings) → NZD;
 *         merge-by-ticker into holdings. Client does not supply NZD.
 * Cash: client NZD; optional credit transaction on cat-income when an account is chosen.
 * Floor: 2026-10-01 (Pacific/Auckland date-only).
 *
 * Received (planned-vs-received / Income card) =
 *   income_records for the month
 *   UNION inflows on type=income categories (Salary, Mining, …) that month.
 *   transfer_in / transfer_out never count as income or (for outflows) as spend.
 * Matched to planned lines by category_id where possible.
 * Dedupe: if Add income created a linked credit (income_records.transaction_id),
 * that txn id is skipped when summing category credits so the same dollars are
 * not counted twice. Soft-merge (Akahu) keeps the same txn id — still one count.
 * Crypto income_records always count; holding merge/reverse is unchanged.
 */

import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import {
  INCOME_MINING_SLUG,
  INCOME_SLUG,
  resolveCategoryIdOrSlug,
} from '../lib/categories.ts';
import { getDb, queryAll, queryOne, run, newId } from '../db/index.ts';
import { resolveCryptoTicker } from '../quotes/crypto.ts';
import type { QuoteResult } from '../../src/types/index.ts';

const router = Router();

router.use((req, res, next) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  (req as AuthedRequest & { scopeUserId: string }).scopeUserId = userId;
  next();
});
function uid(req: { scopeUserId?: string; user?: { id?: string } | null }): string {
  return (req as AuthedRequest & { scopeUserId?: string }).scopeUserId
    || (req as AuthedRequest).user?.id
    || '';
}

const SPENDING_FLOOR = '2026-10-01';
type Db = Awaited<ReturnType<typeof getDb>>;

/** Generic income slug (legacy / uncategorised). Resolve per-user via resolveIncomeCategoryId. */
const INCOME_CATEGORY_ID = INCOME_SLUG;

function resolveIncomeCategoryId(db: Db, userId: string, kind: 'cash' | 'crypto' = 'cash'): string {
  const slug = kind === 'crypto' ? INCOME_MINING_SLUG : INCOME_SLUG;
  return resolveCategoryIdOrSlug(db, userId, slug);
}


function isIncomeCategory(db: Db, categoryId: string | null | undefined): boolean {
  if (!categoryId) return false;
  const row = queryOne<{ type?: string; is_income?: number }>(
    db,
    `SELECT type, is_income FROM budget_categories WHERE id=?`,
    [categoryId],
  );
  if (!row) return false;
  // Prefer type: transfer_in must never count as income
  if (typeof row.type === 'string' && row.type.length > 0) return row.type === 'income';
  return Boolean(row.is_income);
}

function defaultIncomeCategory(kind: 'cash' | 'crypto'): string {
  return kind === 'crypto' ? INCOME_MINING_SLUG : INCOME_CATEGORY_ID;
}

function mapRecord(r: Record<string, unknown>) {
  return {
    id: r.id as string,
    date: r.date as string,
    amountNzd: Number(r.amount_nzd ?? 0),
    kind: (r.kind as string) === 'crypto' ? 'crypto' : 'cash',
    description: (r.description as string) ?? '',
    accountId: (r.account_id as string | null) ?? null,
    accountName: (r.account_name as string | null) ?? null,
    accountType: (r.account_type as string | null) ?? null,
    categoryId: (r.category_id as string | null) ?? INCOME_CATEGORY_ID,
    categoryName: (r.category_name as string | null) ?? null,
    cryptoAsset: (r.crypto_asset as string | null) ?? null,
    cryptoAmount: r.crypto_amount != null ? Number(r.crypto_amount) : null,
    holdingId: (r.holding_id as string | null) ?? null,
    holdingName: (r.holding_name as string | null) ?? null,
    transactionId: (r.transaction_id as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    createdAt: r.created_at as string,
    /** Explicit income_records row (Add income / crypto). */
    origin: 'record' as const,
    txnSource: null as string | null,
  };
}

/** Income-category bank/manual credit not already linked from an income_record. */
function mapCategoryTxnAsIncome(r: Record<string, unknown>) {
  const txnId = r.id as string;
  return {
    id: `cat-income:${txnId}`,
    date: r.date as string,
    amountNzd: Number(r.amount ?? 0),
    kind: 'cash' as const,
    description: (r.description as string) ?? '',
    accountId: (r.account_id as string | null) ?? null,
    accountName: (r.account_name as string | null) ?? null,
    accountType: (r.account_type as string | null) ?? null,
    categoryId: (r.category_id as string | null) ?? INCOME_CATEGORY_ID,
    categoryName: (r.category_name as string | null) ?? null,
    cryptoAsset: null as string | null,
    cryptoAmount: null as number | null,
    holdingId: null as string | null,
    holdingName: null as string | null,
    transactionId: txnId,
    notes: (r.notes as string | null) ?? null,
    createdAt: r.created_at as string,
    origin: 'category_txn' as const,
    txnSource: (r.source as string | null) ?? null,
  };
}

/**
 * Linked txn ids from Add income (cash + account). Matching is_income credits
 * are skipped so records + extras never double-count the same dollars.
 */
function linkedIncomeTransactionIds(db: Db, userId: string): Set<string> {
  const rows = queryAll<{ transaction_id?: string }>(
    db,
    `SELECT transaction_id FROM income_records
     WHERE user_id = ? AND transaction_id IS NOT NULL`,
    [userId],
  );
  const set = new Set<string>();
  for (const r of rows) {
    if (r.transaction_id) set.add(r.transaction_id);
  }
  return set;
}

/** Unlinked is_income inflows in [start, end] (amount > 0), keyed by category. */
function unlinkedIncomeCategoryCredits(
  db: Db,
  userId: string,
  start: string,
  end: string,
  linked: Set<string>,
) {
  const creditRows = queryAll<Record<string, unknown>>(
    db,
    `SELECT t.id, t.date, t.description, t.amount, t.account_id, t.category_id, t.source,
            t.created_at, a.name AS account_name, a.account_type, c.name AS category_name
     FROM transactions t
     LEFT JOIN bank_accounts a ON a.id = t.account_id AND a.user_id = t.user_id
     INNER JOIN budget_categories c ON c.id = t.category_id AND c.user_id = t.user_id
       AND (c.type = 'income' OR (c.type IS NULL AND c.is_income = 1))
     WHERE t.user_id = ? AND t.date >= ? AND t.date <= ? AND t.amount > 0
     ORDER BY t.date DESC, t.created_at DESC`,
    [userId, start, end],
  );
  const extras: ReturnType<typeof mapCategoryTxnAsIncome>[] = [];
  let extraIncome = 0;
  const byCategory = new Map<string, number>();
  for (const t of creditRows) {
    const id = t.id as string | undefined;
    if (id && linked.has(id)) continue;
    const amt = Number(t.amount);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    extraIncome += amt;
    const catId = (t.category_id as string) || INCOME_CATEGORY_ID;
    byCategory.set(catId, (byCategory.get(catId) ?? 0) + amt);
    extras.push(mapCategoryTxnAsIncome(t));
  }
  return { extras, extraIncome, extraCount: extras.length, byCategory };
}

function mapPlan(r: Record<string, unknown>) {
  return {
    id: r.id as string,
    yearMonth: r.year_month as string,
    categoryId: (r.category_id as string) || INCOME_CATEGORY_ID,
    categoryName: (r.category_name as string | null) ?? null,
    amountNzd: Number(r.amount_nzd ?? 0),
    notes: (r.notes as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function parseYearMonth(input: unknown): { key: string } | null {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}$/.test(input)) return null;
  const month = Number(input.slice(5, 7));
  if (month < 1 || month > 12) return null;
  return { key: input };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthBounds(ym: string): { start: string; end: string } {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(5, 7));
  const endDay = String(daysInMonth(year, month)).padStart(2, '0');
  return { start: `${ym}-01`, end: `${ym}-${endDay}` };
}


/** Persist unit quote (same shape as holdings route). */
function persistUnitQuote(
  db: Awaited<ReturnType<typeof getDb>>,
  assetKey: string,
  quote: {
    currency: string;
    price: number | null;
    status: string;
    source: string;
    asOf: string | null;
    message?: string | null;
  },
) {
  const now = quote.asOf ?? new Date().toISOString();
  run(
    db,
    `INSERT INTO price_quotes (id, asset_key, currency, price, status, source, as_of, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(asset_key) DO UPDATE SET
       price=excluded.price, status=excluded.status, source=excluded.source,
       as_of=excluded.as_of, notes=excluded.notes, currency=excluded.currency`,
    [
      newId('q'),
      assetKey,
      quote.currency,
      quote.price,
      quote.status,
      quote.source,
      now,
      quote.message ?? null,
    ],
  );
}

/** Merge crypto qty into an existing non-Akahu holding, or create a new row. */
function mergeOrCreateCrypto(
  db: Awaited<ReturnType<typeof getDb>>,
  opts: {
    userId: string;
    asset: string;
    amount: number;
    costBasisNzd: number | null;
    acquiredAt: string;
    notes: string | null;
  },
): { holdingId: string; merged: boolean; previousAmount: number; newAmount: number; name: string } {
  const ticker = opts.asset.toUpperCase();
  const existing =
    queryOne(
      db,
      `SELECT * FROM holdings
       WHERE user_id = ? AND asset_class = 'crypto' AND UPPER(asset) = ?
         AND (external_id IS NULL OR external_id NOT LIKE 'akahu:%')
       ORDER BY CASE WHEN source = 'manual' THEN 0 ELSE 1 END, updated_at DESC
       LIMIT 1`,
      [opts.userId, ticker],
    ) ?? null;

  const now = new Date().toISOString();
  if (existing) {
    const oldAmount =
      existing.amount != null && Number.isFinite(Number(existing.amount))
        ? Number(existing.amount)
        : 0;
    const mergedAmount = oldAmount + opts.amount;
    const oldCost =
      existing.cost_basis_nzd != null && Number.isFinite(Number(existing.cost_basis_nzd))
        ? Number(existing.cost_basis_nzd)
        : null;
    const addCost = opts.costBasisNzd;
    const mergedCost =
      oldCost == null && addCost == null
        ? null
        : (oldCost ?? 0) + (addCost ?? 0);
    const mergedNotes =
      opts.notes && String(opts.notes).trim()
        ? existing.notes
          ? `${existing.notes}\n${String(opts.notes).trim()}`
          : String(opts.notes).trim()
        : (existing.notes as string | null);
    run(
      db,
      `UPDATE holdings SET amount=?, cost_basis_nzd=?, notes=?, updated_at=?,
        source=COALESCE(source, 'manual')
       WHERE id=?`,
      [mergedAmount, mergedCost, mergedNotes ?? null, now, existing.id],
    );
    return {
      holdingId: existing.id as string,
      merged: true,
      previousAmount: oldAmount,
      newAmount: mergedAmount,
      name: existing.name as string,
    };
  }

  const id = newId('hld');
  run(
    db,
    `INSERT INTO holdings (
       id, user_id, asset_class, name, notes, cost_basis_nzd, acquired_at, created_at, updated_at,
       asset, amount, source
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      opts.userId,
      'crypto',
      ticker,
      opts.notes,
      opts.costBasisNzd,
      opts.acquiredAt,
      now,
      now,
      ticker,
      opts.amount,
      'manual',
    ],
  );
  return {
    holdingId: id,
    merged: false,
    previousAmount: 0,
    newAmount: opts.amount,
    name: ticker,
  };
}

/** List income records + unlinked Income-category inflows. Optional ?from=&to= or ?month=YYYY-MM. */
router.get('/', async (req, res) => {
  const db = await getDb();
  let from = typeof req.query.from === 'string' ? req.query.from : SPENDING_FLOOR;
  let to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const month = parseYearMonth(req.query.month);
  if (month) {
    const b = monthBounds(month.key);
    from = b.start;
    to = b.end;
  }
  if (from < SPENDING_FLOOR) from = SPENDING_FLOOR;

  const params: string[] = [from];
  let sql = `
    SELECT i.*, a.name AS account_name, h.name AS holding_name, c.name AS category_name
    FROM income_records i
    LEFT JOIN bank_accounts a ON a.id = i.account_id
    LEFT JOIN holdings h ON h.id = i.holding_id
    LEFT JOIN budget_categories c ON c.id = COALESCE(i.category_id, 'cat-income')
    WHERE i.user_id = ? AND i.date >= ?`;
  params.unshift(uid(req));
  if (to) {
    sql += ` AND i.date <= ?`;
    params.push(to);
  }
  sql += ` ORDER BY i.date DESC, i.created_at DESC`;

  const rows = queryAll(db, sql, params).map(mapRecord);
  // Bank sync / tagged income-category credits feed the same list (deduped vs linked Add income).
  const end = to ?? '9999-12-31';
  const linked = linkedIncomeTransactionIds(db, uid(req));
  const { extras } = unlinkedIncomeCategoryCredits(db, uid(req), from, end, linked);
  const merged = [...rows, ...extras].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });
  res.json(merged);
});

/**
 * Month summary: planned vs received (totals + per income category).
 * actualNzd = SUM(income_records in month) + SUM(unlinked is_income inflows).
 * Linked Add-income credits excluded from the txn sum (no double-count).
 * Per-category lines match received to planned Salary / Mining / etc. where possible.
 */
router.get('/summary', async (req, res) => {
  const db = await getDb();
  const month = parseYearMonth(req.query.month);
  if (!month) {
    res.status(400).json({ error: 'month=YYYY-MM is required' });
    return;
  }
  const { start, end } = monthBounds(month.key);

  const planRows = queryAll(
    db,
    `SELECT p.*, c.name AS category_name
     FROM income_plans p
     LEFT JOIN budget_categories c ON c.id = p.category_id
     WHERE p.user_id = ? AND p.year_month=?
     ORDER BY c.sort_order, c.name`,
    [uid(req), month.key],
  ).map(mapPlan);

  const recordAgg = queryAll<{ category_id?: string; total?: number; cnt?: number }>(
    db,
    `SELECT COALESCE(category_id, ?) AS category_id,
            COALESCE(SUM(amount_nzd), 0) AS total,
            COUNT(*) AS cnt
     FROM income_records
     WHERE date >= ? AND date <= ?
     GROUP BY COALESCE(category_id, ?)`,
    [resolveIncomeCategoryId(db, uid(req), 'cash'), start, end, resolveIncomeCategoryId(db, uid(req), 'cash')],
  );

  const linked = linkedIncomeTransactionIds(db, uid(req));
  const { extraIncome, extraCount, byCategory: extraByCat } = unlinkedIncomeCategoryCredits(
    db,
    uid(req),
    start,
    end,
    linked,
  );

  const receivedByCat = new Map<string, { amount: number; recordCount: number }>();
  let recordsTotal = 0;
  let recordCount = 0;
  for (const row of recordAgg) {
    const catId = (row.category_id as string) || INCOME_CATEGORY_ID;
    const amt = Number(row.total ?? 0);
    const cnt = Number(row.cnt ?? 0);
    recordsTotal += amt;
    recordCount += cnt;
    const prev = receivedByCat.get(catId) ?? { amount: 0, recordCount: 0 };
    prev.amount += amt;
    prev.recordCount += cnt;
    receivedByCat.set(catId, prev);
  }
  for (const [catId, amt] of extraByCat) {
    const prev = receivedByCat.get(catId) ?? { amount: 0, recordCount: 0 };
    prev.amount += amt;
    receivedByCat.set(catId, prev);
  }

  const catMeta = queryAll<{ id?: string; name?: string; sort_order?: number }>(
    db,
    `SELECT id, name, sort_order FROM budget_categories
     WHERE user_id = ? AND (type = 'income' OR (type IS NULL AND is_income = 1))`,
    [uid(req)],
  );
  const nameById = new Map(catMeta.map((c) => [c.id as string, c.name as string]));
  const sortById = new Map(catMeta.map((c) => [c.id as string, Number(c.sort_order ?? 0)]));

  const catIds = new Set<string>([
    ...planRows.map((p) => p.categoryId),
    ...receivedByCat.keys(),
  ]);

  const categories = Array.from(catIds)
    .map((categoryId) => {
      const plan = planRows.find((p) => p.categoryId === categoryId) ?? null;
      const received = receivedByCat.get(categoryId)?.amount ?? 0;
      const planned = plan ? plan.amountNzd : 0;
      return {
        categoryId,
        categoryName: nameById.get(categoryId) ?? categoryId,
        plannedNzd: planned,
        actualNzd: received,
        remainingNzd: planned - received,
        recordCount: receivedByCat.get(categoryId)?.recordCount ?? 0,
        plan,
      };
    })
    .sort(
      (a, b) =>
        (sortById.get(a.categoryId) ?? 999) - (sortById.get(b.categoryId) ?? 999) ||
        a.categoryName.localeCompare(b.categoryName),
    );

  const plannedNzd = planRows.reduce((s, p) => s + p.amountNzd, 0);
  const actualNzd = recordsTotal + extraIncome;

  res.json({
    yearMonth: month.key,
    periodStart: start,
    periodEnd: end,
    plannedNzd,
    actualNzd,
    recordsTotalNzd: recordsTotal,
    categoryCreditsExtraNzd: extraIncome,
    recordCount,
    categoryCreditCount: extraCount,
    receivedItemCount: recordCount + extraCount,
    remainingNzd: plannedNzd - actualNzd,
    /** @deprecated single-lump compat — first plan or null; prefer `plans` / `categories`. */
    plan: planRows[0] ?? null,
    plans: planRows,
    categories,
  });
});

/** List planned income lines for a month (one per income category). */
router.get('/plan', async (req, res) => {
  const db = await getDb();
  const month = parseYearMonth(req.query.month);
  if (!month) {
    res.status(400).json({ error: 'month=YYYY-MM is required' });
    return;
  }
  const plans = queryAll(
    db,
    `SELECT p.*, c.name AS category_name
     FROM income_plans p
     LEFT JOIN budget_categories c ON c.id = p.category_id
     WHERE p.user_id = ? AND p.year_month=?
     ORDER BY c.sort_order, c.name`,
    [uid(req), month.key],
  ).map(mapPlan);
  res.json(plans);
});

/** Upsert one planned income line: { yearMonth, categoryId, amountNzd, notes? }. */
router.put('/plan', async (req, res) => {
  const db = await getDb();
  const b = req.body ?? {};
  const month = parseYearMonth(b.yearMonth);
  if (!month) {
    res.status(400).json({ error: 'yearMonth must be YYYY-MM' });
    return;
  }
  const categoryId =
    typeof b.categoryId === 'string' && b.categoryId.trim()
      ? b.categoryId.trim()
      : INCOME_CATEGORY_ID;
  if (!isIncomeCategory(db, categoryId)) {
    res.status(400).json({ error: 'categoryId must be an income category' });
    return;
  }
  const amount = Number(b.amountNzd);
  if (!Number.isFinite(amount) || amount < 0) {
    res.status(400).json({ error: 'amountNzd must be a non-negative number' });
    return;
  }
  const notes = typeof b.notes === 'string' ? b.notes.trim() || null : null;
  const now = new Date().toISOString();
  const existing = queryOne(
    db,
    `SELECT * FROM income_plans WHERE user_id=? AND year_month=? AND category_id=?`,
    [uid(req), month.key, categoryId],
  );
  if (existing) {
    run(
      db,
      `UPDATE income_plans SET amount_nzd=?, notes=?, updated_at=? WHERE id=?`,
      [amount, notes ?? existing.notes ?? null, now, existing.id],
    );
    const row = queryOne(
      db,
      `SELECT p.*, c.name AS category_name FROM income_plans p
       LEFT JOIN budget_categories c ON c.id = p.category_id WHERE p.user_id = ? AND p.id=?`,
      [uid(req), existing.id],
    )!;
    res.json(mapPlan(row));
    return;
  }
  const id = newId('incp');
  run(
    db,
    `INSERT INTO income_plans (id, user_id, year_month, category_id, amount_nzd, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, uid(req), month.key, categoryId, amount, notes, now, now],
  );
  const row = queryOne(
    db,
    `SELECT p.*, c.name AS category_name FROM income_plans p
     LEFT JOIN budget_categories c ON c.id = p.category_id WHERE p.user_id = ? AND p.id=?`,
    [uid(req), id],
  )!;
  res.status(201).json(mapPlan(row));
});

router.delete('/plan/:id', async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const existing = queryOne(db, `SELECT id FROM income_plans WHERE id=? AND user_id=?`, [id, uid(req)]);
  if (!existing) {
    res.status(404).json({ error: 'Plan not found' });
    return;
  }
  run(db, `DELETE FROM income_plans WHERE id=? AND user_id=?`, [id, uid(req)]);
  res.json({ ok: true, id });
});

router.post('/', async (req, res) => {
  const db = await getDb();
  const b = req.body ?? {};
  const date =
    typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null;
  if (!date) {
    res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    return;
  }
  if (date < SPENDING_FLOOR) {
    res.status(400).json({ error: `Only income on/after ${SPENDING_FLOOR} is accepted` });
    return;
  }
  const kindRaw = typeof b.kind === 'string' ? b.kind.trim().toLowerCase() : 'cash';
  const kind = kindRaw === 'crypto' ? 'crypto' : 'cash';
  let categoryId =
    typeof b.categoryId === 'string' && b.categoryId.trim()
      ? b.categoryId.trim()
      : resolveIncomeCategoryId(db, uid(req), kind);
  if (!isIncomeCategory(db, categoryId)) {
    res.status(400).json({ error: 'categoryId must be an income category (Salary, Mining, …)' });
    return;
  }
  let amount: number | null = null;
  if (kind === 'cash') {
    const cashAmount = Number(b.amountNzd ?? b.amount);
    if (!Number.isFinite(cashAmount) || cashAmount <= 0) {
      res.status(400).json({ error: 'amountNzd must be a positive number' });
      return;
    }
    amount = cashAmount;
  }
  const description =
    typeof b.description === 'string' && b.description.trim()
      ? b.description.trim()
      : kind === 'crypto'
        ? 'Crypto income'
        : 'Income';
  const notes = typeof b.notes === 'string' ? b.notes.trim() || null : null;
  const now = new Date().toISOString();

  let accountId: string | null = null;
  let transactionId: string | null = null;
  let cryptoAsset: string | null = null;
  let cryptoAmount: number | null = null;
  let holdingId: string | null = null;
  let holdingMeta: ReturnType<typeof mergeOrCreateCrypto> | null = null;

  if (kind === 'cash') {
    accountId = typeof b.accountId === 'string' && b.accountId.trim() ? b.accountId.trim() : null;
    if (accountId) {
      const acct = queryOne(
        db,
        `SELECT id FROM bank_accounts WHERE id=? AND user_id=?`,
        [accountId, uid(req)],
      );
      if (!acct) {
        res.status(400).json({ error: 'Unknown accountId' });
        return;
      }
      // Credit transaction tagged Income so totals / category views pick it up
      transactionId = newId('txn');
      run(
        db,
        `INSERT INTO transactions (
           id, user_id, account_id, date, description, amount, kind, category_id,
           currency, external_id, created_at, card_name, merchant, source,
           affects_btc, btc_holding_id, btc_delta_applied, btc_nzd_rate, btc_applied_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          transactionId,
          uid(req),
          accountId,
          date,
          description,
          amount,
          'credit',
          categoryId,
          'NZD',
          null,
          now,
          null,
          null,
          'manual',
          0,
          null,
          null,
          null,
          null,
        ],
      );
    }
  } else {
    const assetRaw =
      (typeof b.cryptoAsset === 'string' && b.cryptoAsset.trim()) ||
      (typeof b.asset === 'string' && b.asset.trim()) ||
      (typeof b.ticker === 'string' && b.ticker.trim()) ||
      '';
    if (!assetRaw) {
      res.status(400).json({ error: 'cryptoAsset (ticker) is required for crypto income' });
      return;
    }
    cryptoAsset = assetRaw.toUpperCase();
    const qty = Number(b.cryptoAmount ?? b.amountCrypto ?? b.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      res.status(400).json({ error: 'cryptoAmount must be a positive number' });
      return;
    }
    cryptoAmount = qty;

    // Same quote path as holdings: resolveCryptoTicker → unit NZD × qty (never invent).
    const resolved = await resolveCryptoTicker(cryptoAsset, false);
    const quote: QuoteResult = resolved.quote;
    persistUnitQuote(db, quote.assetKey, quote);
    const unit = quote.status === 'ok' ? quote.price : null;
    if (unit == null || !Number.isFinite(unit) || unit <= 0) {
      res.status(503).json({
        error:
          quote.message ??
          `Live NZD quote unavailable for ${cryptoAsset} — cannot derive income value (never invent).`,
        quote,
      });
      return;
    }
    amount = unit * qty;

    holdingMeta = mergeOrCreateCrypto(db, {
      userId: uid(req),
      asset: cryptoAsset,
      amount: qty,
      costBasisNzd: amount,
      acquiredAt: date,
      notes: notes ? `Income: ${notes}` : `Income ${date} · ${description}`,
    });
    holdingId = holdingMeta.holdingId;
    // Prefer resolved display name when holding was created as ticker-only
    if (
      !holdingMeta.merged &&
      resolved.name &&
      resolved.name !== cryptoAsset &&
      holdingMeta.name === cryptoAsset
    ) {
      run(db, 'UPDATE holdings SET name=? WHERE id=?', [resolved.name, holdingId]);
      holdingMeta = { ...holdingMeta, name: resolved.name };
    }
  }

  if (amount == null || !Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'Could not determine a positive NZD income amount' });
    return;
  }

  const id = newId('inc');
  run(
    db,
    `INSERT INTO income_records (
       id, user_id, date, amount_nzd, kind, description, account_id, category_id,
       crypto_asset, crypto_amount, holding_id, transaction_id, notes, created_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      uid(req),
      date,
      amount,
      kind,
      description,
      accountId,
      categoryId,
      cryptoAsset,
      cryptoAmount,
      holdingId,
      transactionId,
      notes,
      now,
    ],
  );

  const row = queryOne(
    db,
    `SELECT i.*, a.name AS account_name, h.name AS holding_name, c.name AS category_name
     FROM income_records i
     LEFT JOIN bank_accounts a ON a.id = i.account_id
     LEFT JOIN holdings h ON h.id = i.holding_id
     LEFT JOIN budget_categories c ON c.id = COALESCE(i.category_id, 'cat-income')
     WHERE i.id=?`,
    [id],
  )!;

  res.status(201).json({
    ...mapRecord(row),
    holding: holdingMeta,
  });
});

router.delete('/:id', async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const existing = queryOne(db, `SELECT * FROM income_records WHERE id=? AND user_id=?`, [id, uid(req)]);
  if (!existing) {
    res.status(404).json({ error: 'Income record not found' });
    return;
  }
  // Reverse crypto merge when possible (subtract qty; never invent if holding gone)
  if (existing.kind === 'crypto' && existing.holding_id && existing.crypto_amount != null) {
    const holding = queryOne(
      db,
      `SELECT * FROM holdings WHERE id=? AND user_id=?`,
      [existing.holding_id, uid(req)],
    );
    if (holding) {
      const qty = Number(existing.crypto_amount);
      const old =
        holding.amount != null && Number.isFinite(Number(holding.amount))
          ? Number(holding.amount)
          : 0;
      const next = Math.max(0, old - qty);
      const cost =
        holding.cost_basis_nzd != null && Number.isFinite(Number(holding.cost_basis_nzd))
          ? Math.max(0, Number(holding.cost_basis_nzd) - Number(existing.amount_nzd ?? 0))
          : holding.cost_basis_nzd;
      run(
        db,
        `UPDATE holdings SET amount=?, cost_basis_nzd=?, updated_at=? WHERE id=? AND user_id=?`,
        [next, cost, new Date().toISOString(), holding.id, uid(req)],
      );
    }
  }
  if (existing.transaction_id) {
    run(
      db,
      `DELETE FROM transactions WHERE id=? AND user_id=?`,
      [existing.transaction_id, uid(req)],
    );
  }
  run(db, `DELETE FROM income_records WHERE id=? AND user_id=?`, [id, uid(req)]);
  res.json({ ok: true, id });
});

export default router;
