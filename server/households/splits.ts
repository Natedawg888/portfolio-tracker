/**
 * Household splits and settle-up (KAN-77 phase 3).
 *
 * - A split divides one spend (a debit) on an account shared with the household between
 *   current members: equally, by percent, or by amount (splitMath.ts). One split per
 *   transaction. The payer is the transaction's owner.
 * - Settlements record money paid between members.
 * - Balances and the fewest payments to settle come from every split and settlement in the
 *   household, including people who have since left (shown as having left), so nothing is lost.
 * - Adults and the owner create, change and remove splits and settlements; viewers only see them.
 */
import type { Database } from 'sql.js';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { aucklandToday, roundMoney } from '../debts/model.ts';
import { isYmd } from '../../src/lib/invoiceCalc.ts';
import { householdActive, logActivity, membershipOf, type Membership } from './store.ts';
import { balances, settleUp, splitShares, type SplitMethod } from './splitMath.ts';

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code?: string };
const fail = (status: number, error: string, code?: string): { ok: false; status: number; error: string; code?: string } => ({ ok: false, status, error, code });

export type SplitsView = {
  canEdit: boolean;
  members: { id: string; name: string }[];
  splits: {
    id: string;
    transactionId: string;
    payerId: string;
    payer: string;
    description: string;
    date: string;
    totalNzd: number;
    method: SplitMethod;
    shares: { memberId: string; name: string; amountNzd: number; input: number | null }[];
  }[];
  settlements: { id: string; fromId: string; from: string; toId: string; to: string; amountNzd: number; paidOn: string; note: string }[];
  /** Positive = is owed, negative = owes. People who have left are included and flagged. */
  balances: { memberId: string; name: string; netNzd: number; left: boolean }[];
  suggestions: { fromId: string; from: string; toId: string; to: string; amountNzd: number }[];
};

function names(db: Database, householdId: string, ids: string[]): { name: (id: string) => string; current: Set<string> } {
  const current = new Set(queryAll<{ user_id: string }>(db, `SELECT user_id FROM household_members WHERE household_id = ?`, [householdId]).map((r) => r.user_id));
  const map = new Map<string, string>();
  for (const id of new Set([...ids, ...current])) {
    const u = queryOne<{ first_name: string | null; last_name: string | null; email: string }>(db, `SELECT first_name, last_name, email FROM users WHERE id = ?`, [id]);
    const base = u ? [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email.split('@')[0] : 'Former member';
    map.set(id, current.has(id) ? base : `${base} (left)`);
  }
  return { name: (id) => map.get(id) ?? 'Former member', current };
}

export function listSplits(db: Database, userId: string): Result<SplitsView> {
  const m = membershipOf(db, userId);
  if (!m) return fail(404, 'You are not in a household');
  const splitRows = queryAll<{ id: string; transaction_id: string; payer_id: string; method: SplitMethod; total_nzd: number; description: string; txn_date: string }>(
    db,
    `SELECT * FROM household_splits WHERE household_id = ? ORDER BY txn_date DESC, created_at DESC`,
    [m.householdId],
  );
  const shareRows = queryAll<{ split_id: string; member_id: string; amount_nzd: number; input: number | null }>(
    db,
    `SELECT s.* FROM household_split_shares s JOIN household_splits h ON h.id = s.split_id WHERE h.household_id = ?`,
    [m.householdId],
  );
  const settlementRows = queryAll<{ id: string; from_id: string; to_id: string; amount_nzd: number; paid_on: string; note: string }>(
    db,
    `SELECT * FROM household_settlements WHERE household_id = ? ORDER BY paid_on DESC, created_at DESC`,
    [m.householdId],
  );
  const ids = [
    ...splitRows.map((s) => s.payer_id),
    ...shareRows.map((s) => s.member_id),
    ...settlementRows.flatMap((s) => [s.from_id, s.to_id]),
  ];
  const { name, current } = names(db, m.householdId, ids);
  const sharesBy = new Map<string, typeof shareRows>();
  for (const r of shareRows) sharesBy.set(r.split_id, [...(sharesBy.get(r.split_id) ?? []), r]);

  const splits = splitRows.map((s) => ({
    id: s.id,
    transactionId: s.transaction_id,
    payerId: s.payer_id,
    payer: name(s.payer_id),
    description: s.description,
    date: s.txn_date,
    totalNzd: roundMoney(Number(s.total_nzd)),
    method: s.method,
    shares: (sharesBy.get(s.id) ?? []).map((r) => ({ memberId: r.member_id, name: name(r.member_id), amountNzd: roundMoney(Number(r.amount_nzd)), input: r.input == null ? null : Number(r.input) })),
  }));
  const net = balances(
    splits.map((s) => ({ payerId: s.payerId, shares: s.shares })),
    settlementRows.map((r) => ({ fromId: r.from_id, toId: r.to_id, amountNzd: Number(r.amount_nzd) })),
  );
  for (const id of current) if (!net.has(id)) net.set(id, 0);
  return {
    ok: true,
    value: {
      canEdit: m.role !== 'viewer' && householdActive(db, m),
      members: [...current].map((id) => ({ id, name: name(id) })),
      splits,
      settlements: settlementRows.map((r) => ({ id: r.id, fromId: r.from_id, from: name(r.from_id), toId: r.to_id, to: name(r.to_id), amountNzd: roundMoney(Number(r.amount_nzd)), paidOn: r.paid_on, note: r.note })),
      balances: [...net]
        .map(([memberId, v]) => ({ memberId, name: name(memberId), netNzd: roundMoney(v), left: !current.has(memberId) }))
        .sort((a, b) => Number(a.left) - Number(b.left) || b.netNzd - a.netNzd || a.name.localeCompare(b.name)),
      suggestions: settleUp(net).map((p) => ({ ...p, from: name(p.fromId), to: name(p.toId) })),
    },
  };
}

/** Adults and the owner, on an active household. */
function editGate(db: Database, userId: string): Result<Membership> {
  const m = membershipOf(db, userId);
  if (!m) return fail(404, 'You are not in a household');
  if (m.role === 'viewer') return fail(403, 'Viewers can see splits but not change them');
  if (!householdActive(db, m)) return fail(402, 'Households are part of KoruLedger Plus.', 'PLAN_REQUIRED');
  return { ok: true, value: m };
}

/** A debit on an account a current member shares with this household. */
function sharedDebit(db: Database, householdId: string, transactionId: string) {
  return (
    queryOne<{ id: string; user_id: string; amount: number; date: string; description: string; merchant: string | null }>(
      db,
      `SELECT t.id, t.user_id, t.amount, t.date, t.description, t.merchant FROM transactions t
       JOIN household_shares s ON s.household_id = ? AND s.kind = 'account' AND s.item_id = t.account_id AND s.owner_id = t.user_id
       JOIN household_members m ON m.household_id = s.household_id AND m.user_id = t.user_id
       WHERE t.id = ? AND t.amount < 0`,
      [householdId, transactionId],
    ) ?? null
  );
}

type SplitBody = { method?: unknown; shares?: unknown };

function parseSplit(db: Database, householdId: string, totalNzd: number, body: SplitBody) {
  const method = body.method;
  if (method !== 'equal' && method !== 'percent' && method !== 'amount') return { ok: false as const, error: 'Choose how to split it' };
  if (!Array.isArray(body.shares)) return { ok: false as const, error: 'Choose who to split it between' };
  const entries = body.shares.map((e) => {
    const o = (e ?? {}) as { memberId?: unknown; value?: unknown };
    return { memberId: typeof o.memberId === 'string' ? o.memberId : '', value: o.value == null || o.value === '' ? undefined : Number(o.value) };
  });
  const current = new Set(queryAll<{ user_id: string }>(db, `SELECT user_id FROM household_members WHERE household_id = ?`, [householdId]).map((r) => r.user_id));
  if (entries.some((e) => !current.has(e.memberId))) return { ok: false as const, error: 'Split only between people in the household' };
  const r = splitShares(totalNzd, method, entries);
  if (!r.ok) return r;
  return { ok: true as const, method: method as SplitMethod, shares: r.shares.map((s, i) => ({ ...s, input: method === 'equal' ? null : (entries[i].value ?? null) })) };
}

function writeShares(db: Database, splitId: string, shares: { memberId: string; amountNzd: number; input: number | null }[]): void {
  run(db, `DELETE FROM household_split_shares WHERE split_id = ?`, [splitId]);
  for (const s of shares) {
    run(db, `INSERT INTO household_split_shares (split_id, member_id, amount_nzd, input) VALUES (?,?,?,?)`, [splitId, s.memberId, s.amountNzd, s.input]);
  }
}

const money = (n: number) => `$${n.toFixed(2)}`;

export function createSplit(db: Database, userId: string, body: unknown): Result<SplitsView> {
  const g = editGate(db, userId);
  if (!g.ok) return g;
  const b = (body ?? {}) as SplitBody & { transactionId?: unknown };
  if (typeof b.transactionId !== 'string') return fail(400, 'Choose a transaction to split');
  const t = sharedDebit(db, g.value.householdId, b.transactionId);
  if (!t) return fail(404, 'Only spending on accounts shared with the household can be split');
  if (queryOne(db, `SELECT 1 FROM household_splits WHERE household_id = ? AND transaction_id = ?`, [g.value.householdId, t.id])) {
    return fail(409, 'That’s already split. Change the existing split instead.');
  }
  const total = roundMoney(-Number(t.amount));
  const parsed = parseSplit(db, g.value.householdId, total, b);
  if (!parsed.ok) return fail(400, parsed.error);
  const id = newId('hsp');
  const now = new Date().toISOString();
  const description = (t.merchant || t.description || 'Transaction').trim().slice(0, 120);
  run(
    db,
    `INSERT INTO household_splits (id, household_id, transaction_id, payer_id, method, total_nzd, description, txn_date, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, g.value.householdId, t.id, t.user_id, parsed.method, total, description, t.date, userId, now, now],
  );
  writeShares(db, id, parsed.shares);
  logActivity(db, g.value.householdId, userId, 'split a transaction', `${description} ${money(total)}`);
  return listSplits(db, userId);
}

export function updateSplit(db: Database, userId: string, splitId: string, body: unknown): Result<SplitsView> {
  const g = editGate(db, userId);
  if (!g.ok) return g;
  const s = queryOne<{ id: string; total_nzd: number; description: string }>(db, `SELECT id, total_nzd, description FROM household_splits WHERE id = ? AND household_id = ?`, [splitId, g.value.householdId]);
  if (!s) return fail(404, 'Split not found');
  const parsed = parseSplit(db, g.value.householdId, Number(s.total_nzd), (body ?? {}) as SplitBody);
  if (!parsed.ok) return fail(400, parsed.error);
  run(db, `UPDATE household_splits SET method = ?, updated_at = ? WHERE id = ?`, [parsed.method, new Date().toISOString(), splitId]);
  writeShares(db, splitId, parsed.shares);
  logActivity(db, g.value.householdId, userId, 'changed a split', s.description);
  return listSplits(db, userId);
}

export function deleteSplit(db: Database, userId: string, splitId: string): Result<SplitsView> {
  const g = editGate(db, userId);
  if (!g.ok) return g;
  const s = queryOne<{ description: string }>(db, `SELECT description FROM household_splits WHERE id = ? AND household_id = ?`, [splitId, g.value.householdId]);
  if (!s) return fail(404, 'Split not found');
  run(db, `DELETE FROM household_split_shares WHERE split_id = ?`, [splitId]);
  run(db, `DELETE FROM household_splits WHERE id = ?`, [splitId]);
  logActivity(db, g.value.householdId, userId, 'removed a split', s.description);
  return listSplits(db, userId);
}

export function recordSettlement(db: Database, userId: string, body: unknown): Result<SplitsView> {
  const g = editGate(db, userId);
  if (!g.ok) return g;
  const b = (body ?? {}) as { fromId?: unknown; toId?: unknown; amountNzd?: unknown; paidOn?: unknown; note?: unknown };
  const amount = Number(b.amountNzd);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) return fail(400, 'Amount must be more than 0');
  if (typeof b.fromId !== 'string' || typeof b.toId !== 'string' || b.fromId === b.toId) return fail(400, 'Choose who paid whom');
  // Settling with someone who has left is allowed, so their balance can still be cleared.
  const view = listSplits(db, userId);
  const known = new Set(view.ok ? view.value.balances.map((x) => x.memberId) : []);
  if (!known.has(b.fromId) || !known.has(b.toId)) return fail(400, 'Choose people in the household');
  const paidOn = isYmd(b.paidOn) ? b.paidOn : aucklandToday();
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 120) : '';
  run(
    db,
    `INSERT INTO household_settlements (id, household_id, from_id, to_id, amount_nzd, paid_on, note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    [newId('hset'), g.value.householdId, b.fromId, b.toId, roundMoney(amount), paidOn, note, userId, new Date().toISOString()],
  );
  logActivity(db, g.value.householdId, userId, 'recorded a payment', money(roundMoney(amount)));
  return listSplits(db, userId);
}

export function deleteSettlement(db: Database, userId: string, id: string): Result<SplitsView> {
  const g = editGate(db, userId);
  if (!g.ok) return g;
  const s = queryOne<{ amount_nzd: number }>(db, `SELECT amount_nzd FROM household_settlements WHERE id = ? AND household_id = ?`, [id, g.value.householdId]);
  if (!s) return fail(404, 'Payment not found');
  run(db, `DELETE FROM household_settlements WHERE id = ?`, [id]);
  logActivity(db, g.value.householdId, userId, 'removed a payment', money(roundMoney(Number(s.amount_nzd))));
  return listSplits(db, userId);
}
