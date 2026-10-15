/**
 * Household sharing, phase 2 (KAN-77). A member marks their own items as shared; nothing
 * moves, so leaving or deleting the household just drops the share rows.
 *
 * Who sees what: every member sees what is shared plus their own items, never another
 * member's unshared items. Adults and the owner may edit shared budgets (this month's plan),
 * goals (target, amount saved) and bills (amount, next due) through the owner's own store
 * functions; viewers are read-only. Shared holdings and accounts are read-only to others.
 *
 * Shared budget spending counts only transactions on accounts members have shared, in a
 * category matching the shared one (by its well-known slug, else by name), this month.
 * Net worth uses each owner's own valuation; nothing is estimated.
 */
import type { Database } from 'sql.js';
import { queryAll, queryOne, run, newId } from '../db/index.ts';
import { computeNetWorth } from '../lib/netWorth.ts';
import { LIABILITY_ACCOUNT_TYPES, coerceAkahuBalance, isLiquidCashAccountType } from '../akahu/sync.ts';
import { listSavingsGoals, updateSavingsGoal } from '../savings/store.ts';
import { parsePatchSavingsGoal } from '../savings/model.ts';
import { listRecurring, parseRecurring, updateRecurring } from '../recurring/store.ts';
import { aucklandToday, roundMoney } from '../debts/model.ts';
import { householdActive, logActivity, membershipOf, type Membership } from './store.ts';

export const SHARE_KINDS = ['budget', 'bill', 'goal', 'holding', 'account'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];
const KIND_WORD: Record<ShareKind, string> = { budget: 'a budget', bill: 'a bill', goal: 'a goal', holding: 'a holding', account: 'an account' };

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code?: string };
const fail = (status: number, error: string, code?: string): { ok: false; status: number; error: string; code?: string } => ({ ok: false, status, error, code });

export function isShareKind(v: unknown): v is ShareKind {
  return (SHARE_KINDS as readonly unknown[]).includes(v);
}

type ShareRow = { owner_id: string; kind: ShareKind; item_id: string };

/** Share rows of current members only. */
function sharesOf(db: Database, householdId: string): ShareRow[] {
  return queryAll<ShareRow>(
    db,
    `SELECT s.owner_id, s.kind, s.item_id FROM household_shares s
     JOIN household_members m ON m.household_id = s.household_id AND m.user_id = s.owner_id
     WHERE s.household_id = ?`,
    [householdId],
  );
}

function memberNames(db: Database, householdId: string): Map<string, string> {
  return new Map(
    queryAll<{ user_id: string; first_name: string | null; last_name: string | null; email: string }>(
      db,
      `SELECT m.user_id, u.first_name, u.last_name, u.email FROM household_members m JOIN users u ON u.id = m.user_id WHERE m.household_id = ?`,
      [householdId],
    ).map((r) => [r.user_id, [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || r.email.split('@')[0]]),
  );
}

const ITEM_TABLE: Record<ShareKind, string> = {
  budget: 'budget_categories',
  bill: 'recurring_items',
  goal: 'savings_goals',
  holding: 'holdings',
  account: 'bank_accounts',
};

function ownsItem(db: Database, userId: string, kind: ShareKind, itemId: string): boolean {
  const extra = kind === 'budget' ? ` AND type = 'spending'` : '';
  return !!queryOne(db, `SELECT 1 FROM ${ITEM_TABLE[kind]} WHERE id = ? AND user_id = ?${extra}`, [itemId, userId]);
}

// ---------------------------------------------------------------- the member's own items

/** No amounts in `detail`: it is plain text, so Hide amounts couldn't mask it. */
export type ShareableView = Record<ShareKind, { id: string; name: string; detail: string; shared: boolean }[]>;

export function shareable(db: Database, userId: string): Result<ShareableView> {
  const m = membershipOf(db, userId);
  if (!m) return fail(404, 'You are not in a household');
  const mine = new Set(
    queryAll<{ kind: string; item_id: string }>(db, `SELECT kind, item_id FROM household_shares WHERE household_id = ? AND owner_id = ?`, [m.householdId, userId]).map(
      (r) => `${r.kind}:${r.item_id}`,
    ),
  );
  const is = (kind: ShareKind, id: string) => mine.has(`${kind}:${id}`);
  const today = aucklandToday();
  return {
    ok: true,
    value: {
      budget: queryAll<{ id: string; name: string }>(db, `SELECT id, name FROM budget_categories WHERE user_id = ? AND type = 'spending' ORDER BY sort_order, name`, [userId]).map(
        (c) => ({ id: c.id, name: c.name, detail: 'Budget category', shared: is('budget', c.id) }),
      ),
      bill: listRecurring(db, userId, today).items.filter((r) => r.status === 'active').map((r) => ({
        id: r.id,
        name: r.name,
        detail: `${r.kind === 'subscription' ? 'Subscription' : 'Bill'} · ${r.cadence}`,
        shared: is('bill', r.id),
      })),
      goal: listSavingsGoals(db, userId, today).map((g) => ({ id: g.id, name: g.name, detail: g.deadline ? `Savings goal · by ${g.deadline}` : 'Savings goal', shared: is('goal', g.id) })),
      holding: queryAll<{ id: string; name: string | null; asset_class: string; asset: string | null }>(
        db,
        `SELECT id, name, asset_class, asset FROM holdings WHERE user_id = ? ORDER BY asset_class, name`,
        [userId],
      ).map((h) => ({ id: h.id, name: (h.name || h.asset || 'Holding').trim(), detail: h.asset_class.replace(/_/g, ' '), shared: is('holding', h.id) })),
      account: queryAll<{ id: string; name: string; institution: string; account_type: string }>(
        db,
        `SELECT id, name, institution, account_type FROM bank_accounts WHERE user_id = ? ORDER BY name`,
        [userId],
      ).map((a) => ({ id: a.id, name: a.name, detail: [a.institution, a.account_type].filter(Boolean).join(' · '), shared: is('account', a.id) })),
    },
  };
}

export function setShared(db: Database, userId: string, body: unknown): Result<ShareableView> {
  const m = membershipOf(db, userId);
  if (!m) return fail(404, 'You are not in a household');
  const b = (body ?? {}) as { kind?: unknown; itemId?: unknown; shared?: unknown };
  if (!isShareKind(b.kind) || typeof b.itemId !== 'string') return fail(400, 'Choose an item to share');
  if (!ownsItem(db, userId, b.kind, b.itemId)) return fail(404, 'You can only share your own items');
  const on = b.shared === true;
  if (on && !householdActive(db, m)) return fail(402, 'Households are part of KoruLedger Plus.', 'PLAN_REQUIRED');
  const exists = !!queryOne(db, `SELECT 1 FROM household_shares WHERE household_id = ? AND kind = ? AND item_id = ?`, [m.householdId, b.kind, b.itemId]);
  if (on && !exists) {
    run(db, `INSERT INTO household_shares (household_id, owner_id, kind, item_id, shared_at) VALUES (?,?,?,?,?)`, [m.householdId, userId, b.kind, b.itemId, new Date().toISOString()]);
    logActivity(db, m.householdId, userId, `shared ${KIND_WORD[b.kind]}`, itemName(db, b.kind, b.itemId));
  } else if (!on && exists) {
    run(db, `DELETE FROM household_shares WHERE household_id = ? AND kind = ? AND item_id = ? AND owner_id = ?`, [m.householdId, b.kind, b.itemId, userId]);
    logActivity(db, m.householdId, userId, `stopped sharing ${KIND_WORD[b.kind]}`, itemName(db, b.kind, b.itemId));
  }
  return shareable(db, userId);
}

function itemName(db: Database, kind: ShareKind, id: string): string {
  const col = kind === 'holding' ? `COALESCE(name, asset, 'Holding')` : 'name';
  return String(queryOne<{ n: string }>(db, `SELECT ${col} AS n FROM ${ITEM_TABLE[kind]} WHERE id = ?`, [id])?.n ?? '');
}

// ---------------------------------------------------------------- dashboard

function monthBounds(today: string): { start: string; end: string; ym: string } {
  const [y, mo] = today.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { start: `${today.slice(0, 7)}-01`, end: `${today.slice(0, 7)}-${String(last).padStart(2, '0')}`, ym: today.slice(0, 7) };
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export type HouseholdDashboard = {
  canEdit: boolean;
  month: string;
  netWorth: {
    totalNzd: number;
    holdings: { id: string; owner: string; name: string; valueNzd: number }[];
    accounts: { id: string; owner: string; name: string; balanceNzd: number }[];
    /** Shared holdings that couldn't be valued right now (left out, never guessed). */
    unvalued: number;
  };
  budgets: { id: string; owner: string; name: string; plannedNzd: number | null; spentNzd: number; remainingNzd: number | null }[];
  bills: { id: string; owner: string; name: string; amountNzd: number; nextDue: string; cadence: string }[];
  goals: { id: string; owner: string; name: string; targetNzd: number; currentAmountNzd: number; deadline: string | null; amountSource: 'account' | 'manual' }[];
  /** splitId: this spend is already split in the household (phase 3). */
  transactions: { id: string; member: string; account: string; date: string; description: string; amountNzd: number; splitId: string | null }[];
};

export async function dashboard(db: Database, userId: string): Promise<Result<HouseholdDashboard>> {
  const m = membershipOf(db, userId);
  if (!m) return fail(404, 'You are not in a household');
  const today = aucklandToday();
  const { start, end, ym } = monthBounds(today);
  const names = memberNames(db, m.householdId);
  const shares = sharesOf(db, m.householdId);
  const by = (kind: ShareKind) => shares.filter((s) => s.kind === kind);

  // Accounts.
  const accountShares = by('account');
  const accounts: HouseholdDashboard['netWorth']['accounts'] = [];
  for (const s of accountShares) {
    const a = queryOne<{ id: string; name: string; balance: number; currency: string; account_type: string; notes: string | null }>(
      db,
      `SELECT id, name, balance, currency, account_type, notes FROM bank_accounts WHERE id = ? AND user_id = ?`,
      [s.item_id, s.owner_id],
    );
    if (!a || (a.currency ?? 'NZD').toUpperCase() !== 'NZD') continue;
    const counts = isLiquidCashAccountType(a.account_type, a.notes) || LIABILITY_ACCOUNT_TYPES.has((a.account_type ?? '').toLowerCase());
    if (!counts) continue;
    const parsed = coerceAkahuBalance(a.balance);
    const bal = parsed ?? (Number.isFinite(Number(a.balance)) ? Number(a.balance) : 0);
    accounts.push({ id: a.id, owner: names.get(s.owner_id) ?? 'Member', name: a.name, balanceNzd: roundMoney(bal) });
  }

  // Holdings: each owner's own valuation.
  const holdings: HouseholdDashboard['netWorth']['holdings'] = [];
  let unvalued = 0;
  const holdingOwners = [...new Set(by('holding').map((s) => s.owner_id))];
  for (const owner of holdingOwners) {
    const wanted = new Set(by('holding').filter((s) => s.owner_id === owner).map((s) => s.item_id));
    const nw = await computeNetWorth(db, owner);
    const points = new Map(nw.breakdown.holdings.map((p) => [p.id, p]));
    for (const id of wanted) {
      const p = points.get(id);
      if (!p || !Number.isFinite(p.valueNzd)) {
        if (queryOne(db, `SELECT 1 FROM holdings WHERE id = ? AND user_id = ?`, [id, owner])) unvalued += 1;
        continue;
      }
      holdings.push({ id, owner: names.get(owner) ?? 'Member', name: p.label, valueNzd: roundMoney(p.valueNzd) });
    }
  }
  const totalNzd = roundMoney(accounts.reduce((s, a) => s + a.balanceNzd, 0) + holdings.reduce((s, h) => s + h.valueNzd, 0));

  // Shared accounts per member, for budget spending and the transaction list.
  const sharedAccountsByMember = new Map<string, string[]>();
  for (const s of accountShares) sharedAccountsByMember.set(s.owner_id, [...(sharedAccountsByMember.get(s.owner_id) ?? []), s.item_id]);
  const inList = (ids: string[]) => ids.map(() => '?').join(',');

  // Budgets.
  const budgets: HouseholdDashboard['budgets'] = [];
  for (const s of by('budget')) {
    const cat = queryOne<{ id: string; name: string; slug: string | null }>(db, `SELECT id, name, slug FROM budget_categories WHERE id = ? AND user_id = ?`, [s.item_id, s.owner_id]);
    if (!cat) continue;
    const plan = queryOne<{ total: number | null; n: number }>(
      db,
      `SELECT SUM(amount_nzd) AS total, COUNT(*) AS n FROM budgets WHERE user_id = ? AND category_id = ? AND period_start <= ? AND period_end >= ?`,
      [s.owner_id, cat.id, end, start],
    );
    let spent = 0;
    for (const [member, accts] of sharedAccountsByMember) {
      const cats = queryAll<{ id: string }>(
        db,
        cat.slug
          ? `SELECT id FROM budget_categories WHERE user_id = ? AND slug = ?`
          : `SELECT id FROM budget_categories WHERE user_id = ? AND lower(name) = lower(?)`,
        [member, cat.slug ?? cat.name],
      ).map((r) => r.id);
      if (cats.length === 0 || accts.length === 0) continue;
      spent += Number(
        queryOne<{ t: number | null }>(
          db,
          `SELECT SUM(-amount) AS t FROM transactions WHERE user_id = ? AND amount < 0 AND date >= ? AND date <= ?
           AND category_id IN (${inList(cats)}) AND account_id IN (${inList(accts)})`,
          [member, start, end, ...cats, ...accts],
        )?.t ?? 0,
      );
    }
    const planned = plan && plan.n > 0 ? roundMoney(Number(plan.total ?? 0)) : null;
    budgets.push({ id: cat.id, owner: names.get(s.owner_id) ?? 'Member', name: cat.name, plannedNzd: planned, spentNzd: roundMoney(spent), remainingNzd: planned == null ? null : roundMoney(planned - spent) });
  }

  // Bills due in the next 31 days.
  const bills: HouseholdDashboard['bills'] = [];
  const horizon = addDays(today, 31);
  for (const owner of [...new Set(by('bill').map((s) => s.owner_id))]) {
    const wanted = new Set(by('bill').filter((s) => s.owner_id === owner).map((s) => s.item_id));
    for (const r of listRecurring(db, owner, today).items) {
      if (!wanted.has(r.id) || r.status !== 'active' || r.nextDue > horizon) continue;
      bills.push({ id: r.id, owner: names.get(owner) ?? 'Member', name: r.name, amountNzd: roundMoney(r.amountNzd), nextDue: r.nextDue, cadence: r.cadence });
    }
  }
  bills.sort((a, b) => a.nextDue.localeCompare(b.nextDue) || a.name.localeCompare(b.name));

  // Goals.
  const goals: HouseholdDashboard['goals'] = [];
  for (const owner of [...new Set(by('goal').map((s) => s.owner_id))]) {
    const wanted = new Set(by('goal').filter((s) => s.owner_id === owner).map((s) => s.item_id));
    for (const g of listSavingsGoals(db, owner, today)) {
      if (!wanted.has(g.id)) continue;
      goals.push({ id: g.id, owner: names.get(owner) ?? 'Member', name: g.name, targetNzd: g.targetNzd, currentAmountNzd: g.currentAmountNzd, deadline: g.deadline, amountSource: g.amountSource });
    }
  }

  // Recent transactions on shared accounts, with who made them.
  const transactions: HouseholdDashboard['transactions'] = [];
  for (const [member, accts] of sharedAccountsByMember) {
    if (accts.length === 0) continue;
    for (const t of queryAll<{ id: string; date: string; description: string; merchant: string | null; amount: number; account_name: string }>(
      db,
      `SELECT t.id, t.date, t.description, t.merchant, t.amount, a.name AS account_name FROM transactions t JOIN bank_accounts a ON a.id = t.account_id
       WHERE t.user_id = ? AND t.account_id IN (${inList(accts)}) AND t.date >= ? ORDER BY t.date DESC LIMIT 50`,
      [member, ...accts, addDays(today, -30)],
    )) {
      transactions.push({ id: t.id, member: names.get(member) ?? 'Member', account: t.account_name, date: t.date, description: (t.merchant || t.description || '').trim(), amountNzd: roundMoney(Number(t.amount)), splitId: null });
    }
  }
  transactions.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const splitOf = new Map(
    queryAll<{ id: string; transaction_id: string }>(db, `SELECT id, transaction_id FROM household_splits WHERE household_id = ?`, [m.householdId]).map((r) => [r.transaction_id, r.id]),
  );
  for (const t of transactions) t.splitId = splitOf.get(t.id) ?? null;

  return {
    ok: true,
    value: {
      canEdit: m.role !== 'viewer' && householdActive(db, m),
      month: ym,
      netWorth: { totalNzd, holdings, accounts, unvalued },
      budgets,
      bills,
      goals,
      transactions: transactions.slice(0, 50),
    },
  };
}

// ---------------------------------------------------------------- editing shared items

/** Adults and the owner, on an active household, for an item that is shared. */
function editGate(db: Database, userId: string, kind: ShareKind, itemId: string): Result<{ m: Membership; ownerId: string }> {
  const m = membershipOf(db, userId);
  if (!m) return fail(404, 'You are not in a household');
  const share = sharesOf(db, m.householdId).find((s) => s.kind === kind && s.item_id === itemId);
  if (!share) return fail(404, 'That isn’t shared with your household');
  if (m.role === 'viewer') return fail(403, 'Viewers can see shared items but not change them');
  if (!householdActive(db, m)) return fail(402, 'Households are part of KoruLedger Plus.', 'PLAN_REQUIRED');
  return { ok: true, value: { m, ownerId: share.owner_id } };
}

/** This month's plan for a shared budget, kept in the owner's budgets (same rule as Budget). */
export function setSharedBudgetPlan(db: Database, userId: string, categoryId: string, body: unknown): Result<{ ok: true }> {
  const g = editGate(db, userId, 'budget', categoryId);
  if (!g.ok) return g;
  const amount = Number((body as { amountNzd?: unknown } | null)?.amountNzd);
  if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) return fail(400, 'Plan must be 0 or more');
  const { start, end } = monthBounds(aucklandToday());
  const owner = g.value.ownerId;
  const existing =
    queryOne<{ id: string }>(db, `SELECT id FROM budgets WHERE user_id = ? AND category_id = ? AND period_start = ? AND period_end = ?`, [owner, categoryId, start, end]) ??
    queryOne<{ id: string }>(
      db,
      `SELECT id FROM budgets WHERE user_id = ? AND category_id = ? AND period_start <= ? AND period_end >= ? ORDER BY period_start DESC LIMIT 1`,
      [owner, categoryId, end, start],
    );
  if (existing) run(db, `UPDATE budgets SET amount_nzd = ? WHERE id = ? AND user_id = ?`, [roundMoney(amount), existing.id, owner]);
  else run(db, `INSERT INTO budgets (id, user_id, category_id, period_start, period_end, amount_nzd) VALUES (?,?,?,?,?,?)`, [newId('bud'), owner, categoryId, start, end, roundMoney(amount)]);
  logActivity(db, g.value.m.householdId, userId, 'changed a shared budget', `${itemName(db, 'budget', categoryId)}: ${roundMoney(amount).toFixed(2)} this month`);
  return { ok: true, value: { ok: true } };
}

export function updateSharedGoal(db: Database, userId: string, goalId: string, body: unknown): Result<{ ok: true }> {
  const g = editGate(db, userId, 'goal', goalId);
  if (!g.ok) return g;
  const raw = (body ?? {}) as Record<string, unknown>;
  // Only the amounts; name, notes, deadline and the linked account stay with the owner.
  const parsed = parsePatchSavingsGoal({ ...(raw.targetNzd !== undefined ? { targetNzd: raw.targetNzd } : {}), ...(raw.currentAmountNzd !== undefined ? { currentAmountNzd: raw.currentAmountNzd } : {}) });
  if (!parsed.ok) return fail(400, parsed.error);
  if (Object.keys(parsed.value).length === 0) return fail(400, 'Nothing to change');
  const saved = updateSavingsGoal(db, g.value.ownerId, goalId, parsed.value, aucklandToday());
  if (!saved) return fail(404, 'Goal not found');
  logActivity(db, g.value.m.householdId, userId, 'updated a shared goal', saved.name);
  return { ok: true, value: { ok: true } };
}

export function updateSharedBill(db: Database, userId: string, billId: string, body: unknown): Result<{ ok: true }> {
  const g = editGate(db, userId, 'bill', billId);
  if (!g.ok) return g;
  const raw = (body ?? {}) as Record<string, unknown>;
  const parsed = parseRecurring({ ...(raw.amountNzd !== undefined ? { amountNzd: raw.amountNzd } : {}), ...(raw.nextDue !== undefined ? { nextDue: raw.nextDue } : {}) }, true);
  if (!parsed.ok) return fail(400, parsed.error);
  if (Object.keys(parsed.value).length === 0) return fail(400, 'Nothing to change');
  const saved = updateRecurring(db, g.value.ownerId, billId, parsed.value, aucklandToday());
  if (!saved) return fail(404, 'Bill not found');
  logActivity(db, g.value.m.householdId, userId, 'updated a shared bill', saved.name);
  return { ok: true, value: { ok: true } };
}
