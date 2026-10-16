/**
 * Bonds and term deposits for one user (KAN-80). Every query filters on user_id.
 *
 * - Value: a value the user recorded (with its date), else what they paid. Never a market price.
 *   Non-NZD bonds use the stored Frankfurter FX quote (as Forex holdings do); without one they're
 *   left out of net worth and say so.
 * - A term deposit linked to a synced term-deposit bank account isn't counted again: Cash has it.
 * - Plus (entitlement 'bonds_plus'): coupon calendar, coupons into Income, projections, maturity
 *   alerts. Free: add and value bonds, counted in net worth.
 * - Coupons into Income: on their date (from the Budget start), NZD only, after RWT (or the amount
 *   the user recorded), as income_records.bond_coupon_ref, linked to the matching bank deposit so it
 *   isn't counted twice. Skipping a coupon or deleting a bond removes its Income rows; the bank
 *   transaction is never touched.
 */
import type { Database } from 'sql.js';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { aucklandToday, roundMoney } from '../debts/model.ts';
import { isYmd } from '../../src/lib/invoiceCalc.ts';
import { bondSchedule, maturityAlert, RWT_CHOICES, type BondKind, type CouponFrequency, type ScheduledPayment } from '../../src/lib/bondSchedule.ts';
import { hasFeature } from '../lib/entitlements.ts';
import { ensureCategory } from '../lib/categories.ts';
import { linkMirroredIncomeToBankCredits } from '../lib/incomeBankLink.ts';
import { TXN_SYNC_FROM_DATE } from '../lib/syncFloor.ts';
import { forexAssetKey, refreshForexCurrency } from '../quotes/forexQuotesDb.ts';

const INTEREST_CATEGORY = { slug: 'cat-income-dividends', name: 'Dividends & interest', type: 'income', sortOrder: 3 } as const;
const KINDS: BondKind[] = ['govt', 'corporate', 'td'];
const FREQS: CouponFrequency[] = ['monthly', 'quarterly', 'half_yearly', 'yearly', 'maturity'];
const MAX = 1e10;

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code?: string };
const fail = (status: number, error: string, code?: string): { ok: false; status: number; error: string; code?: string } => ({ ok: false, status, error, code });
export const isBondsPlus = (db: Database, userId: string) => hasFeature(db, userId, 'bonds_plus');

export type BondDraft = {
  name: string;
  kind: BondKind;
  faceValue: number;
  purchasePrice: number;
  purchaseDate: string;
  ratePct: number;
  frequency: CouponFrequency;
  maturityDate: string;
  currency: string;
  code: string;
  rwtPct: number | null;
  valueAmount: number | null;
  valueOn: string | null;
  linkedAccountId: string | null;
  notes: string;
};

type Row = {
  id: string;
  name: string;
  kind: BondKind;
  face_value: number;
  purchase_price: number;
  purchase_date: string;
  rate_pct: number;
  frequency: CouponFrequency;
  maturity_date: string;
  currency: string;
  code: string;
  rwt_pct: number | null;
  value_amount: number | null;
  value_on: string | null;
  linked_account_id: string | null;
  status: 'active' | 'repaid' | 'rolled';
  closed_on: string | null;
  rolled_from_id: string | null;
  notes: string;
};

export type Payment = ScheduledPayment & { bondId: string; bondName: string; currency: string; skipped: boolean; recorded: number | null; inIncome: boolean };

export type Bond = BondDraft & {
  id: string;
  status: Row['status'];
  closedOn: string | null;
  rolledFromId: string | null;
  /** Value in its currency: recorded, else cost. */
  value: number;
  valueSource: 'recorded' | 'cost';
  /** NZD value, or null when there's no FX rate for its currency. */
  valueNzd: number | null;
  /** True when it's linked to a synced term-deposit account (already in Cash). */
  countedInCash: boolean;
  linkedAccountName: string | null;
  nextCoupon: { date: string; net: number } | null;
  yearlyIncome: number;
  alert: ReturnType<typeof maturityAlert>;
};

export type BondsView = {
  plus: boolean;
  bonds: Bond[];
  totals: { valueNzd: number; bondsNzd: number; termDepositsNzd: number; unvalued: number; yearlyIncomeNzd: number };
  /** Plus: upcoming coupons and maturities (next 12 months), and recent paid coupons. */
  calendar: Payment[] | null;
  recent: Payment[] | null;
  /** Plus: active holdings maturing within 90 days, or matured and not yet closed. */
  alerts: { bondId: string; name: string; maturityDate: string; level: 'matured' | '30' | '90'; days: number }[] | null;
  termDepositAccounts: { id: string; name: string; balanceNzd: number }[];
};

// ---------------------------------------------------------------- parsing

function num(v: unknown, label: string, opts: { nullable?: boolean; max?: number; required?: boolean } = {}): number | null | string {
  if (v === null || v === undefined || v === '') return opts.required ? `${label} is required` : opts.nullable ? null : 0;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return `${label} must be a number`;
  if (n < 0) return `${label} can’t be negative`;
  if (n > (opts.max ?? MAX)) return `${label} is too large`;
  return n;
}

export function parseBond(db: Database, userId: string, raw: unknown): { ok: true; value: BondDraft } | { ok: false; error: string } {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'Enter the bond' };
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 80) : '';
  if (!name) return { ok: false, error: 'Enter the name or issuer' };
  if (!KINDS.includes(o.kind as BondKind)) return { ok: false, error: 'Choose government bond, corporate bond or term deposit' };
  if (!FREQS.includes(o.frequency as CouponFrequency)) return { ok: false, error: 'Choose how often it pays' };
  for (const k of ['purchaseDate', 'maturityDate'] as const) if (!isYmd(o[k])) return { ok: false, error: `${k === 'purchaseDate' ? 'Purchase' : 'Maturity'} date must be a date` };
  if ((o.maturityDate as string) <= (o.purchaseDate as string)) return { ok: false, error: 'Maturity must be after the purchase date' };
  const nums: Record<string, number | null> = {};
  for (const [k, label, opts] of [
    ['faceValue', 'Face value', { required: true }],
    ['purchasePrice', 'Purchase price', { required: true }],
    ['ratePct', 'Rate', { required: true, max: 100 }],
    ['valueAmount', 'Value', { nullable: true }],
  ] as const) {
    const v = num(o[k], label, opts);
    if (typeof v === 'string') return { ok: false, error: v };
    nums[k] = v;
  }
  if (!(nums.faceValue! > 0)) return { ok: false, error: 'Face value must be more than 0' };
  let rwt: number | null = null;
  if (o.rwtPct != null && o.rwtPct !== '') {
    rwt = Number(o.rwtPct);
    if (!(RWT_CHOICES as readonly number[]).includes(rwt)) return { ok: false, error: `RWT must be one of ${RWT_CHOICES.join('%, ')}%` };
  }
  if (o.valueOn != null && o.valueOn !== '' && !isYmd(o.valueOn)) return { ok: false, error: 'Valued on must be a date' };
  const currency = typeof o.currency === 'string' && /^[A-Za-z]{3}$/.test(o.currency.trim()) ? o.currency.trim().toUpperCase() : 'NZD';
  let linkedAccountId: string | null = null;
  if (typeof o.linkedAccountId === 'string' && o.linkedAccountId) {
    if (o.kind !== 'td') return { ok: false, error: 'Only a term deposit can be linked to a bank account' };
    if (!queryOne(db, `SELECT 1 FROM bank_accounts WHERE id = ? AND user_id = ? AND account_type = 'term_deposit'`, [o.linkedAccountId, userId])) {
      return { ok: false, error: 'Choose one of your term deposit accounts' };
    }
    linkedAccountId = o.linkedAccountId;
  }
  return {
    ok: true,
    value: {
      name,
      kind: o.kind as BondKind,
      faceValue: roundMoney(nums.faceValue!),
      purchasePrice: roundMoney(nums.purchasePrice!),
      purchaseDate: o.purchaseDate as string,
      ratePct: Math.round(nums.ratePct! * 10000) / 10000,
      frequency: o.frequency as CouponFrequency,
      maturityDate: o.maturityDate as string,
      currency,
      code: typeof o.code === 'string' ? o.code.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '').slice(0, 20) : '',
      rwtPct: rwt,
      valueAmount: nums.valueAmount == null ? null : roundMoney(nums.valueAmount),
      valueOn: isYmd(o.valueOn) ? (o.valueOn as string) : null,
      linkedAccountId,
      notes: typeof o.notes === 'string' ? o.notes.trim().slice(0, 300) : '',
    },
  };
}

// ---------------------------------------------------------------- view

const terms = (r: Row) => ({
  kind: r.kind,
  faceValue: Number(r.face_value),
  ratePct: Number(r.rate_pct),
  frequency: r.frequency,
  purchaseDate: r.purchase_date,
  maturityDate: r.maturity_date,
  rwtPct: r.rwt_pct,
});

function fxRate(db: Database, currency: string): number | null {
  if (currency === 'NZD') return 1;
  const q = queryOne<{ price: number | null; status: string }>(db, 'SELECT price, status FROM price_quotes WHERE asset_key = ?', [forexAssetKey(currency)]);
  return q && (q.status === 'ok' || q.status === 'stale') && q.price != null && Number(q.price) > 0 ? Number(q.price) : null;
}

type Overrides = Map<string, { skipped: boolean; net: number | null }>;
function overrides(db: Database, userId: string): Overrides {
  return new Map(
    queryAll<{ bond_id: string; due_date: string; skipped: number; net_amount: number | null }>(db, `SELECT * FROM bond_coupons WHERE user_id = ?`, [userId]).map((r) => [
      `${r.bond_id}:${r.due_date}`,
      { skipped: r.skipped === 1, net: r.net_amount == null ? null : Number(r.net_amount) },
    ]),
  );
}

/** Payments that actually happen: up to the close date for repaid / rolled holdings. */
function payments(r: Row, ov: Overrides, incomeRefs: Set<string>): Payment[] {
  return bondSchedule(terms(r))
    .filter((p) => (r.status === 'active' ? true : r.closed_on != null && p.date <= r.closed_on && p.kind === 'coupon'))
    .map((p) => {
      const o = ov.get(`${r.id}:${p.date}`);
      return { ...p, bondId: r.id, bondName: r.name, currency: r.currency, skipped: p.kind === 'coupon' && !!o?.skipped, recorded: o?.net ?? null, inIncome: incomeRefs.has(`${r.id}:${p.date}`) };
    });
}

function present(db: Database, r: Row, ov: Overrides, incomeRefs: Set<string>, today: string, plus: boolean): Bond {
  const value = r.value_amount != null ? Number(r.value_amount) : Number(r.purchase_price);
  const fx = fxRate(db, r.currency);
  const account = r.linked_account_id ? queryOne<{ name: string }>(db, `SELECT name FROM bank_accounts WHERE id = ?`, [r.linked_account_id]) : null;
  const pays = payments(r, ov, incomeRefs);
  const next = pays.find((p) => p.kind === 'coupon' && p.date >= today && !p.skipped) ?? null;
  const t = terms(r);
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    faceValue: t.faceValue,
    purchasePrice: Number(r.purchase_price),
    purchaseDate: r.purchase_date,
    ratePct: t.ratePct,
    frequency: r.frequency,
    maturityDate: r.maturity_date,
    currency: r.currency,
    code: r.code,
    rwtPct: r.rwt_pct,
    valueAmount: r.value_amount,
    valueOn: r.value_on,
    linkedAccountId: r.linked_account_id,
    notes: r.notes,
    status: r.status,
    closedOn: r.closed_on,
    rolledFromId: r.rolled_from_id,
    value: roundMoney(value),
    valueSource: r.value_amount != null ? 'recorded' : 'cost',
    valueNzd: fx == null ? null : roundMoney(value * fx),
    countedInCash: !!r.linked_account_id,
    linkedAccountName: account?.name ?? null,
    nextCoupon: next ? { date: next.date, net: next.recorded ?? next.net } : null,
    // Yearly income after RWT at the coupon rate (an "at maturity" holding pays it all at the end).
    yearlyIncome: roundMoney(t.faceValue * (t.ratePct / 100) * (t.rwtPct ? 1 - t.rwtPct / 100 : 1)),
    alert: plus && r.status === 'active' ? maturityAlert(r.maturity_date, today) : null,
  };
}

function rows(db: Database, userId: string): Row[] {
  return queryAll<Row>(db, `SELECT * FROM bonds WHERE user_id = ? ORDER BY status = 'active' DESC, maturity_date, created_at`, [userId]);
}

export function listBonds(db: Database, userId: string, today = aucklandToday()): BondsView {
  const plus = isBondsPlus(db, userId);
  const ov = overrides(db, userId);
  const incomeRefs = new Set(queryAll<{ r: string }>(db, `SELECT bond_coupon_ref AS r FROM income_records WHERE user_id = ? AND bond_coupon_ref IS NOT NULL`, [userId]).map((x) => x.r));
  const rs = rows(db, userId);
  const bonds = rs.map((r) => present(db, r, ov, incomeRefs, today, plus));
  const active = bonds.filter((b) => b.status === 'active');
  const counted = active.filter((b) => !b.countedInCash && b.valueNzd != null);
  const horizon = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  const all = rs.flatMap((r) => payments(r, ov, incomeRefs));
  return {
    plus,
    bonds,
    totals: {
      valueNzd: roundMoney(counted.reduce((s, b) => s + b.valueNzd!, 0)),
      bondsNzd: roundMoney(counted.filter((b) => b.kind !== 'td').reduce((s, b) => s + b.valueNzd!, 0)),
      termDepositsNzd: roundMoney(counted.filter((b) => b.kind === 'td').reduce((s, b) => s + b.valueNzd!, 0)),
      unvalued: active.filter((b) => b.valueNzd == null).length,
      yearlyIncomeNzd: roundMoney(active.filter((b) => b.currency === 'NZD').reduce((s, b) => s + b.yearlyIncome, 0)),
    },
    calendar: plus ? all.filter((p) => p.date >= today && p.date <= horizon).sort((a, b) => (a.date < b.date ? -1 : 1)) : null,
    recent: plus ? all.filter((p) => p.kind === 'coupon' && p.date < today).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12) : null,
    alerts: plus
      ? bonds.filter((b) => b.alert).map((b) => ({ bondId: b.id, name: b.name, maturityDate: b.maturityDate, level: b.alert!.level, days: b.alert!.days }))
      : null,
    termDepositAccounts: queryAll<{ id: string; name: string; balance: number }>(db, `SELECT id, name, balance FROM bank_accounts WHERE user_id = ? AND account_type = 'term_deposit' ORDER BY name`, [userId]).map((a) => ({
      id: a.id,
      name: a.name,
      balanceNzd: roundMoney(Number(a.balance) || 0),
    })),
  };
}

// ---------------------------------------------------------------- Income

/** Make Income match the coupons that have been paid (Plus, NZD, from the Budget start). */
export function syncBondIncome(db: Database, userId: string, today = aucklandToday()): void {
  const plus = isBondsPlus(db, userId);
  const ov = overrides(db, userId);
  const want = new Map<string, { date: string; amount: number; name: string }>();
  if (plus) {
    for (const r of rows(db, userId)) {
      if (r.currency !== 'NZD') continue;
      for (const p of payments(r, ov, new Set())) {
        if (p.kind !== 'coupon' || p.skipped || p.date > today || p.date < TXN_SYNC_FROM_DATE) continue;
        const amount = roundMoney(p.recorded ?? p.net);
        if (amount > 0) want.set(`${r.id}:${p.date}`, { date: p.date, amount, name: r.name });
      }
    }
  }
  const have = queryAll<{ id: string; bond_coupon_ref: string; amount_nzd: number }>(db, `SELECT id, bond_coupon_ref, amount_nzd FROM income_records WHERE user_id = ? AND bond_coupon_ref IS NOT NULL`, [userId]);
  const seen = new Set<string>();
  for (const h of have) {
    const w = want.get(h.bond_coupon_ref);
    if (!w) {
      run(db, `DELETE FROM income_records WHERE id = ? AND user_id = ?`, [h.id, userId]);
      continue;
    }
    seen.add(h.bond_coupon_ref);
    if (Math.abs(Number(h.amount_nzd) - w.amount) >= 0.005) {
      // A new amount may no longer match the deposit it was linked to.
      run(db, `UPDATE income_records SET amount_nzd = ?, transaction_id = NULL WHERE id = ? AND user_id = ?`, [w.amount, h.id, userId]);
    }
  }
  let added = false;
  for (const [ref, w] of want) {
    if (seen.has(ref)) continue;
    run(
      db,
      `INSERT INTO income_records (id, user_id, date, amount_nzd, kind, description, category_id, notes, created_at, bond_coupon_ref) VALUES (?,?,?,?, 'cash', ?, ?, ?, ?, ?)`,
      [newId('inc'), userId, w.date, w.amount, `Interest · ${w.name}`.slice(0, 200), ensureCategory(db, userId, INTEREST_CATEGORY), 'Recorded from Bonds.', new Date().toISOString(), ref],
    );
    added = true;
  }
  if (added || have.length) linkMirroredIncomeToBankCredits(db, userId);
}

// ---------------------------------------------------------------- net worth and projections

/** Active holdings in net worth (not linked to a synced TD account), or null when none. */
export function bondTotals(db: Database, userId: string): { bondsNzd: number; termDepositsNzd: number; perBond: { id: string; label: string; valueNzd: number; kind: BondKind }[]; unvalued: number } | null {
  const rs = rows(db, userId).filter((r) => r.status === 'active' && !r.linked_account_id);
  if (!rs.length) return null;
  const perBond: { id: string; label: string; valueNzd: number; kind: BondKind }[] = [];
  let unvalued = 0;
  for (const r of rs) {
    const fx = fxRate(db, r.currency);
    if (fx == null) {
      unvalued += 1;
      continue;
    }
    perBond.push({ id: r.id, label: r.name, kind: r.kind, valueNzd: roundMoney((r.value_amount != null ? Number(r.value_amount) : Number(r.purchase_price)) * fx) });
  }
  return {
    bondsNzd: roundMoney(perBond.filter((b) => b.kind !== 'td').reduce((s, b) => s + b.valueNzd, 0)),
    termDepositsNzd: roundMoney(perBond.filter((b) => b.kind === 'td').reduce((s, b) => s + b.valueNzd, 0)),
    perBond,
    unvalued,
  };
}

/**
 * Plus: NZD cash coming in each projection month (index 0 = month 1): coupons after RWT, and the
 * value leaving the bond class at maturity (principal back into cash). Null without Plus or bonds.
 */
export function bondProjectionFlows(db: Database, userId: string, asOf: string, horizonMonths: number): { couponsNzd: number[]; maturedValueNzd: number[]; principalNzd: number[] } | null {
  if (!isBondsPlus(db, userId)) return null;
  // Closed holdings still pay interest up to their close date (a roll-over pays it on the roll date).
  const rs = rows(db, userId).filter((r) => r.currency === 'NZD' && !r.linked_account_id);
  if (!rs.some((r) => r.status === 'active')) return null;
  const ov = overrides(db, userId);
  const couponsNzd = new Array(horizonMonths).fill(0);
  const maturedValueNzd = new Array(horizonMonths).fill(0);
  const principalNzd = new Array(horizonMonths).fill(0);
  const [ay, am] = asOf.split('-').map(Number);
  const monthIndex = (d: string) => {
    const [y, m] = d.split('-').map(Number);
    return (y - ay) * 12 + (m - am); // 1 = next month
  };
  for (const r of rs) {
    for (const p of payments(r, ov, new Set())) {
      if (p.date <= asOf || p.skipped) continue;
      const i = monthIndex(p.date) - 1;
      if (i < 0 || i >= horizonMonths) continue;
      if (p.kind === 'coupon') couponsNzd[i] += p.recorded ?? p.net;
      else {
        principalNzd[i] += p.net;
        maturedValueNzd[i] += r.value_amount != null ? Number(r.value_amount) : Number(r.purchase_price);
      }
    }
  }
  return { couponsNzd: couponsNzd.map(roundMoney), maturedValueNzd: maturedValueNzd.map(roundMoney), principalNzd: principalNzd.map(roundMoney) };
}

// ---------------------------------------------------------------- writes

const COLS = `name=?, kind=?, face_value=?, purchase_price=?, purchase_date=?, rate_pct=?, frequency=?, maturity_date=?, currency=?, code=?, rwt_pct=?,
  value_amount=?, value_on=?, linked_account_id=?, notes=?`;
const values = (d: BondDraft) => [
  d.name, d.kind, d.faceValue, d.purchasePrice, d.purchaseDate, d.ratePct, d.frequency, d.maturityDate, d.currency, d.code, d.rwtPct,
  d.valueAmount, d.valueOn, d.linkedAccountId, d.notes,
];

function insert(db: Database, userId: string, d: BondDraft, rolledFrom: string | null = null): string {
  const id = newId('bond');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO bonds (id, user_id, name, kind, face_value, purchase_price, purchase_date, rate_pct, frequency, maturity_date, currency, code, rwt_pct,
       value_amount, value_on, linked_account_id, notes, rolled_from_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, ...values(d), rolledFrom, now, now],
  );
  return id;
}

async function ensureFx(db: Database, currency: string): Promise<void> {
  if (currency === 'NZD' || fxRate(db, currency) != null) return;
  await refreshForexCurrency(db, currency).catch(() => null);
}

export async function createBond(db: Database, userId: string, body: unknown): Promise<Result<BondsView>> {
  const p = parseBond(db, userId, body);
  if (!p.ok) return fail(400, p.error);
  insert(db, userId, p.value);
  await ensureFx(db, p.value.currency);
  syncBondIncome(db, userId);
  return { ok: true, value: listBonds(db, userId) };
}

export async function updateBond(db: Database, userId: string, id: string, body: unknown): Promise<Result<BondsView>> {
  if (!queryOne(db, `SELECT 1 FROM bonds WHERE id = ? AND user_id = ?`, [id, userId])) return fail(404, 'Not found');
  const p = parseBond(db, userId, body);
  if (!p.ok) return fail(400, p.error);
  run(db, `UPDATE bonds SET ${COLS}, updated_at=? WHERE id=? AND user_id=?`, [...values(p.value), new Date().toISOString(), id, userId]);
  await ensureFx(db, p.value.currency);
  syncBondIncome(db, userId);
  return { ok: true, value: listBonds(db, userId) };
}

/** Removes the holding, its coupon changes and its Income rows. Bank transactions stay. */
export function deleteBond(db: Database, userId: string, id: string): Result<BondsView> {
  if (!queryOne(db, `SELECT 1 FROM bonds WHERE id = ? AND user_id = ?`, [id, userId])) return fail(404, 'Not found');
  run(db, `DELETE FROM bond_coupons WHERE bond_id = ? AND user_id = ?`, [id, userId]);
  run(db, `DELETE FROM bonds WHERE id = ? AND user_id = ?`, [id, userId]);
  syncBondIncome(db, userId);
  return { ok: true, value: listBonds(db, userId) };
}

/** Skip a coupon, or record what was actually received (after RWT). Body: { skipped?, netAmount? }. */
export function setCoupon(db: Database, userId: string, id: string, date: unknown, body: unknown): Result<BondsView> {
  if (!isBondsPlus(db, userId)) return fail(402, 'The coupon calendar is part of KoruLedger Plus.', 'PLAN_REQUIRED');
  const r = queryOne<Row>(db, `SELECT * FROM bonds WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!r) return fail(404, 'Not found');
  if (!isYmd(date) || !bondSchedule(terms(r)).some((p) => p.kind === 'coupon' && p.date === date)) return fail(400, 'That isn’t one of its coupon dates');
  const b = (body ?? {}) as { skipped?: unknown; netAmount?: unknown };
  const amt = num(b.netAmount, 'Amount', { nullable: true });
  if (typeof amt === 'string') return fail(400, amt);
  run(
    db,
    `INSERT INTO bond_coupons (bond_id, user_id, due_date, skipped, net_amount, updated_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(bond_id, due_date) DO UPDATE SET skipped = excluded.skipped, net_amount = excluded.net_amount, updated_at = excluded.updated_at`,
    [id, userId, date, b.skipped === true ? 1 : 0, amt == null ? null : roundMoney(amt), new Date().toISOString()],
  );
  syncBondIncome(db, userId);
  return { ok: true, value: listBonds(db, userId) };
}

/** Matured and paid back. */
export function markRepaid(db: Database, userId: string, id: string, body: unknown): Result<BondsView> {
  const r = queryOne<Row>(db, `SELECT * FROM bonds WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!r) return fail(404, 'Not found');
  if (r.status !== 'active') return fail(409, 'It’s already closed');
  const on = (body as { on?: unknown } | null)?.on;
  const date = isYmd(on) ? (on as string) : r.maturity_date;
  if (date < r.purchase_date) return fail(400, 'Repaid before it was bought');
  run(db, `UPDATE bonds SET status = 'repaid', closed_on = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [date, new Date().toISOString(), id, userId]);
  syncBondIncome(db, userId);
  return { ok: true, value: listBonds(db, userId) };
}

/** Reinvest at maturity: closes this one as rolled and adds the new holding (new terms in the body). */
export async function rollOver(db: Database, userId: string, id: string, body: unknown): Promise<Result<BondsView>> {
  const r = queryOne<Row>(db, `SELECT * FROM bonds WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!r) return fail(404, 'Not found');
  if (r.status !== 'active') return fail(409, 'It’s already closed');
  const p = parseBond(db, userId, body);
  if (!p.ok) return fail(400, p.error);
  if (p.value.purchaseDate < r.purchase_date) return fail(400, 'The new one starts before the old one');
  run(db, `UPDATE bonds SET status = 'rolled', closed_on = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [p.value.purchaseDate, new Date().toISOString(), id, userId]);
  insert(db, userId, p.value, id);
  await ensureFx(db, p.value.currency);
  syncBondIncome(db, userId);
  return { ok: true, value: listBonds(db, userId) };
}
