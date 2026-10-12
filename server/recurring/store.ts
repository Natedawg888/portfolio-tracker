/**
 * Bills and subscriptions for one user (KAN-26). Every query filters on user_id.
 *
 * - Saved items: confirmed from a suggestion or added by hand. Reads roll next_due
 *   forward to the first due date on or after today and attach the last payment seen.
 * - Suggestions: detectRecurring() over the user's spending (transfers and income are
 *   left out), minus payees already saved or dismissed.
 */
import type { Database } from 'sql.js';
import type { RecurringItem, RecurringListResponse } from '../../src/types/index.ts';
import {
  CADENCES,
  addCadence,
  detectRecurring,
  merchantKey,
  monthlyEquivalent,
  nextDueOnOrAfter,
  occurrencesWithin,
  type Cadence,
  type DetectionTxn,
  type RecurringKind,
  type RecurringStatus,
} from '../../src/lib/recurring.ts';
import { isYmd } from '../../src/lib/invoiceCalc.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { roundMoney } from '../debts/model.ts';

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export type RecurringDraft = {
  name: string;
  kind: RecurringKind;
  amountNzd: number;
  cadence: Cadence;
  nextDue: string;
  categoryId: string | null;
  status: RecurringStatus;
  notes: string;
  merchantKey: string | null;
  source: 'detected' | 'manual';
};

const KINDS: RecurringKind[] = ['bill', 'subscription'];
const STATUSES: RecurringStatus[] = ['active', 'paused', 'cancelled'];

/** Full body for create; `partial` allows any subset for edits. */
export function parseRecurring(raw: unknown, partial: boolean): Parsed<Partial<RecurringDraft>> {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'Body is required' };
  const out: Partial<RecurringDraft> = {};
  if (o.name !== undefined || !partial) {
    const name = typeof o.name === 'string' ? o.name.trim().replace(/\s+/g, ' ') : '';
    if (!name) return { ok: false, error: 'Name is required' };
    if (name.length > 80) return { ok: false, error: 'Name must be 80 characters or fewer' };
    out.name = name;
  }
  if (o.kind !== undefined || !partial) {
    if (!KINDS.includes(o.kind as RecurringKind)) return { ok: false, error: 'kind must be bill or subscription' };
    out.kind = o.kind as RecurringKind;
  }
  if (o.amountNzd !== undefined || !partial) {
    const n = Number(o.amountNzd);
    if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) return { ok: false, error: 'Amount must be more than 0' };
    out.amountNzd = roundMoney(n);
  }
  if (o.cadence !== undefined || !partial) {
    if (!CADENCES.includes(o.cadence as Cadence)) return { ok: false, error: `cadence must be one of ${CADENCES.join(', ')}` };
    out.cadence = o.cadence as Cadence;
  }
  if (o.nextDue !== undefined || !partial) {
    if (!isYmd(o.nextDue)) return { ok: false, error: 'Next due must be YYYY-MM-DD' };
    out.nextDue = o.nextDue;
  }
  if (o.status !== undefined) {
    if (!STATUSES.includes(o.status as RecurringStatus)) return { ok: false, error: 'status must be active, paused or cancelled' };
    out.status = o.status as RecurringStatus;
  } else if (!partial) out.status = 'active';
  if (o.categoryId !== undefined) out.categoryId = typeof o.categoryId === 'string' && o.categoryId.trim() ? o.categoryId.trim() : null;
  if (o.notes !== undefined) out.notes = typeof o.notes === 'string' ? o.notes.trim().slice(0, 500) : '';
  if (!partial) {
    out.merchantKey = typeof o.merchantKey === 'string' && o.merchantKey.trim() ? merchantKey(o.merchantKey) || null : null;
    out.source = o.source === 'detected' && out.merchantKey ? 'detected' : 'manual';
  }
  return { ok: true, value: out };
}

type Row = {
  id: string;
  name: string;
  merchant_key: string | null;
  kind: string;
  amount_nzd: number;
  cadence: string;
  next_due: string;
  category_id: string | null;
  category_name?: string | null;
  status: string;
  source: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

const SELECT = `SELECT r.*, c.name AS category_name FROM recurring_items r
  LEFT JOIN budget_categories c ON c.id = r.category_id AND c.user_id = r.user_id`;

function ownedCategory(db: Database, userId: string, id: string | null | undefined): string | null {
  if (!id) return null;
  return queryOne<{ id: string }>(db, `SELECT id FROM budget_categories WHERE id = ? AND user_id = ?`, [id, userId])?.id ?? null;
}

/** The user's money-out transactions for detection and "last paid", newest 15 months. */
function spendingTxns(db: Database, userId: string, today: string): DetectionTxn[] {
  const from = addCadence(today, 'monthly', -15);
  return queryAll<{ id: string; date: string; amount: number; description: string; merchant: string | null; category_id: string | null; category_name: string | null; type: string | null; is_income: number | null }>(
    db,
    `SELECT t.id, t.date, t.amount, t.description, t.merchant, t.category_id, c.name AS category_name, c.type, c.is_income
     FROM transactions t
     LEFT JOIN budget_categories c ON c.id = t.category_id AND c.user_id = t.user_id
     WHERE t.user_id = ? AND t.date >= ? AND t.date <= ? AND t.amount < 0`,
    [userId, from, today],
  )
    // Transfers (savings, investments, own accounts) and income categories are not bills.
    .filter((t) => (t.type ? t.type === 'spending' : !t.is_income))
    .map((t) => ({
      id: t.id,
      date: t.date,
      amount: Number(t.amount),
      description: t.description ?? '',
      merchant: t.merchant,
      categoryId: t.category_id,
      categoryName: t.category_name,
    }));
}

function present(r: Row, today: string, lastPaid: Map<string, { date: string; amount: number }>): RecurringItem {
  const cadence = (CADENCES.includes(r.cadence as Cadence) ? r.cadence : 'monthly') as Cadence;
  const amount = roundMoney(Number(r.amount_nzd));
  const paid = r.merchant_key ? lastPaid.get(r.merchant_key) ?? null : null;
  return {
    id: r.id,
    name: r.name,
    merchantKey: r.merchant_key,
    kind: r.kind === 'subscription' ? 'subscription' : 'bill',
    amountNzd: amount,
    monthlyNzd: monthlyEquivalent(amount, cadence),
    cadence,
    nextDue: r.status === 'active' ? nextDueOnOrAfter(r.next_due, cadence, today) : r.next_due,
    categoryId: r.category_id,
    categoryName: r.category_name ?? null,
    status: (STATUSES.includes(r.status as RecurringStatus) ? r.status : 'active') as RecurringStatus,
    source: r.source === 'detected' ? 'detected' : 'manual',
    notes: r.notes,
    lastPaidDate: paid?.date ?? null,
    lastPaidNzd: paid ? roundMoney(Math.abs(paid.amount)) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function lastPaidByKey(txns: DetectionTxn[]): Map<string, { date: string; amount: number }> {
  const out = new Map<string, { date: string; amount: number }>();
  for (const t of txns) {
    const key = merchantKey(t.merchant || t.description);
    const prev = out.get(key);
    if (!prev || t.date > prev.date) out.set(key, { date: t.date, amount: t.amount });
  }
  return out;
}

export function listRecurring(db: Database, userId: string, today: string): RecurringListResponse {
  const txns = spendingTxns(db, userId, today);
  const paid = lastPaidByKey(txns);
  const items = queryAll<Row>(db, `${SELECT} WHERE r.user_id = ? ORDER BY r.name COLLATE NOCASE, r.id`, [userId]).map((r) =>
    present(r, today, paid),
  );
  const savedKeys = new Set(items.map((i) => i.merchantKey).filter(Boolean));
  const dismissed = new Set(
    queryAll<{ merchant_key: string }>(db, `SELECT merchant_key FROM recurring_dismissed WHERE user_id = ?`, [userId]).map((d) => d.merchant_key),
  );
  const suggestions = detectRecurring(txns, today)
    .filter((s) => !savedKeys.has(s.merchantKey) && !dismissed.has(s.merchantKey))
    .map(({ transactionIds, ...s }) => ({ ...s, transactionCount: transactionIds.length }));

  const active = items.filter((i) => i.status === 'active');
  const monthly = roundMoney(active.reduce((s, i) => s + i.monthlyNzd, 0));
  let due30 = 0;
  for (const i of active) {
    // occurrencesWithin is the same 30-day walk (weekly bills can fall several times).
    const hits = occurrencesWithin(i.nextDue, i.cadence, today).length;
    for (let hit = 0; hit < hits; hit += 1) due30 += i.amountNzd;
  }
  return {
    today,
    items,
    suggestions,
    dismissedCount: dismissed.size,
    totals: {
      monthlyNzd: monthly,
      yearlyNzd: roundMoney(monthly * 12),
      dueNext30DaysNzd: roundMoney(due30),
      activeCount: active.length,
    },
  };
}

export function getRecurring(db: Database, userId: string, id: string, today: string): RecurringItem | null {
  const r = queryOne<Row>(db, `${SELECT} WHERE r.id = ? AND r.user_id = ?`, [id, userId]);
  return r ? present(r, today, lastPaidByKey(spendingTxns(db, userId, today))) : null;
}

export function createRecurring(db: Database, userId: string, d: RecurringDraft, today: string): RecurringItem {
  const id = newId('rec');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO recurring_items (id, user_id, name, merchant_key, kind, amount_nzd, cadence, next_due, category_id, status, source, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, d.name, d.merchantKey, d.kind, d.amountNzd, d.cadence, d.nextDue, ownedCategory(db, userId, d.categoryId), d.status, d.source, d.notes ?? '', now, now],
  );
  return getRecurring(db, userId, id, today)!;
}

export function updateRecurring(db: Database, userId: string, id: string, patch: Partial<RecurringDraft>, today: string): RecurringItem | null {
  const r = queryOne<Row>(db, `SELECT * FROM recurring_items WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!r) return null;
  run(
    db,
    `UPDATE recurring_items SET name=?, kind=?, amount_nzd=?, cadence=?, next_due=?, category_id=?, status=?, notes=?, updated_at=?
     WHERE id=? AND user_id=?`,
    [
      patch.name ?? r.name,
      patch.kind ?? r.kind,
      patch.amountNzd ?? r.amount_nzd,
      patch.cadence ?? r.cadence,
      patch.nextDue ?? r.next_due,
      patch.categoryId !== undefined ? ownedCategory(db, userId, patch.categoryId) : r.category_id,
      patch.status ?? r.status,
      patch.notes ?? r.notes,
      new Date().toISOString(),
      id,
      userId,
    ],
  );
  return getRecurring(db, userId, id, today);
}

export function deleteRecurring(db: Database, userId: string, id: string): boolean {
  if (!queryOne(db, `SELECT id FROM recurring_items WHERE id = ? AND user_id = ?`, [id, userId])) return false;
  run(db, `DELETE FROM recurring_items WHERE id = ? AND user_id = ?`, [id, userId]);
  return true;
}

export function dismissSuggestion(db: Database, userId: string, rawKey: unknown): Parsed<{ merchantKey: string }> {
  const key = typeof rawKey === 'string' ? merchantKey(rawKey) : '';
  if (!key) return { ok: false, error: 'merchantKey is required' };
  run(db, `INSERT OR IGNORE INTO recurring_dismissed (id, user_id, merchant_key, dismissed_at) VALUES (?,?,?,?)`, [
    newId('recd'), userId, key, new Date().toISOString(),
  ]);
  return { ok: true, value: { merchantKey: key } };
}

/** Bring back every dismissed suggestion. */
export function restoreDismissed(db: Database, userId: string): number {
  const n = Number(queryOne<{ c?: number }>(db, `SELECT COUNT(*) AS c FROM recurring_dismissed WHERE user_id = ?`, [userId])?.c ?? 0);
  run(db, `DELETE FROM recurring_dismissed WHERE user_id = ?`, [userId]);
  return n;
}
