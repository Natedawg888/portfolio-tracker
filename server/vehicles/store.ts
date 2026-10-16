/**
 * Vehicles for one user (KAN-65): what each is worth, any loan on it, and what it costs to run.
 * Every query filters on user_id.
 *
 * Net worth (netWorth.ts, via vehicleTotals): vehicles set to count add their recorded value
 * and subtract a manually entered loan balance. A loan linked to a bank loan account isn't
 * subtracted here, since that account's balance already counts as a liability. Values are
 * what the user records; nothing is estimated or depreciated.
 */
import type { Database } from 'sql.js';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { aucklandToday, roundMoney } from '../debts/model.ts';
import { isYmd } from '../../src/lib/invoiceCalc.ts';
import { COST_FREQUENCIES, COST_KINDS, costToOwn, depreciatedValue, distancePerYear, type CostFrequency, type DistanceUnit, type RunningCost } from '../../src/lib/vehicles.ts';

export const MAX_RUNNING_COSTS = 20;
const VEHICLE_KINDS = ['car', 'ute', 'van', 'motorbike', 'campervan', 'truck', 'boat', 'trailer', 'other'] as const;
export type VehicleKind = (typeof VEHICLE_KINDS)[number];
type LoanKind = 'none' | 'manual' | 'account';
const MAX = 100_000_000;

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

export type VehicleDraft = {
  name: string;
  kind: VehicleKind;
  make: string;
  model: string;
  year: number | null;
  plate: string;
  purchaseDate: string | null;
  purchasePriceNzd: number | null;
  valueNzd: number | null;
  valuedOn: string | null;
  countInNetWorth: boolean;
  loan: {
    kind: LoanKind;
    accountId: string | null;
    balanceNzd: number | null;
    lender: string;
    ratePct: number | null;
    repaymentNzd: number | null;
    repaymentFrequency: CostFrequency | null;
  };
  runningCosts: RunningCost[];
  odometer: { reading: number | null; unit: DistanceUnit; readOn: string | null; atPurchase: number | null };
  /** % a year, diminishing value, for an estimated value (null = no estimate). */
  depreciationPct: number | null;
  notes: string;
};

export type Vehicle = VehicleDraft & {
  /** Price paid less the depreciation rate since purchase; null without a rate, price and date. */
  estimate: { valueNzd: number; years: number; ratePct: number } | null;
  /** From the reading when bought to the latest one. */
  distance: { perYear: number; unit: DistanceUnit; runningCostPerUnit: number | null } | null;
  id: string;
  /** The loan balance used: the linked account's (as a positive amount owed) or the one entered. */
  loanOwedNzd: number | null;
  loanAccountName: string | null;
  /** Value − loan owed; null without a value. */
  equityNzd: number | null;
  costToOwn: ReturnType<typeof costToOwn>;
  createdAt: string;
  updatedAt: string;
};

export type VehiclesView = {
  vehicles: Vehicle[];
  totals: {
    count: number;
    /** Vehicles counted in net worth. */
    valueNzd: number;
    loansNzd: number;
    equityNzd: number;
    runningPerMonthNzd: number;
    costToOwnPerMonthNzd: number;
  };
  loanAccounts: { id: string; name: string; balanceNzd: number }[];
};

type Row = {
  id: string;
  name: string;
  kind: VehicleKind;
  make: string;
  model: string;
  year: number | null;
  plate: string;
  purchase_date: string | null;
  purchase_price_nzd: number | null;
  value_nzd: number | null;
  valued_on: string | null;
  count_in_net_worth: number;
  loan_kind: LoanKind;
  loan_account_id: string | null;
  loan_balance_nzd: number | null;
  loan_lender: string;
  loan_rate_pct: number | null;
  loan_repayment_nzd: number | null;
  loan_repayment_freq: CostFrequency | null;
  running_costs_json: string;
  odometer: number | null;
  odometer_unit: string | null;
  odometer_on: string | null;
  odometer_at_purchase: number | null;
  depreciation_pct: number | null;
  notes: string;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------- parsing

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function amount(v: unknown, label: string, max = MAX): number | null | string {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return `${label} must be a number`;
  if (n < 0) return `${label} can’t be negative`;
  if (n > max) return `${label} is too large`;
  return roundMoney(n);
}
const isFreq = (v: unknown): v is CostFrequency => COST_FREQUENCIES.some((f) => f.value === v);

export function parseVehicle(db: Database, userId: string, raw: unknown): { ok: true; value: VehicleDraft } | { ok: false; error: string } {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'Enter the vehicle' };
  const name = text(o.name, 80);
  if (!name) return { ok: false, error: 'Give the vehicle a name' };
  const kind = VEHICLE_KINDS.includes(o.kind as VehicleKind) ? (o.kind as VehicleKind) : 'car';
  let year: number | null = null;
  if (o.year !== null && o.year !== undefined && o.year !== '') {
    year = Number(o.year);
    if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear() + 1) return { ok: false, error: 'Enter a year from 1900' };
  }
  for (const [k, label] of [['purchaseDate', 'Purchase date'], ['valuedOn', 'Valued on']] as const) {
    if (o[k] != null && o[k] !== '' && !isYmd(o[k])) return { ok: false, error: `${label} must be a date` };
  }
  const nums: Record<string, number | null> = {};
  for (const [k, label, max] of [
    ['purchasePriceNzd', 'Purchase price', MAX],
    ['valueNzd', 'Value', MAX],
  ] as const) {
    const v = amount(o[k], label, max);
    if (typeof v === 'string') return { ok: false, error: v };
    nums[k] = v;
  }

  // Loan.
  const l = (o.loan && typeof o.loan === 'object' ? o.loan : {}) as Record<string, unknown>;
  const loanKind: LoanKind = l.kind === 'manual' || l.kind === 'account' ? l.kind : 'none';
  let accountId: string | null = null;
  if (loanKind === 'account') {
    accountId = typeof l.accountId === 'string' ? l.accountId : null;
    if (!accountId || !queryOne(db, `SELECT 1 FROM bank_accounts WHERE id = ? AND user_id = ? AND account_type = 'loan'`, [accountId, userId])) {
      return { ok: false, error: 'Choose one of your loan accounts' };
    }
  }
  const balance = amount(l.balanceNzd, 'Loan balance');
  const rate = amount(l.ratePct, 'Interest rate', 100);
  const repay = amount(l.repaymentNzd, 'Repayment');
  for (const v of [balance, rate, repay]) if (typeof v === 'string') return { ok: false, error: v };
  if (loanKind === 'manual' && balance == null) return { ok: false, error: 'Enter how much is owed on the loan' };
  if (loanKind !== 'none' && repay != null && !isFreq(l.repaymentFrequency)) return { ok: false, error: 'Choose how often the loan is repaid' };

  // Running costs.
  const rawCosts = Array.isArray(o.runningCosts) ? o.runningCosts : [];
  if (rawCosts.length > MAX_RUNNING_COSTS) return { ok: false, error: `Up to ${MAX_RUNNING_COSTS} running costs` };
  const runningCosts: RunningCost[] = [];
  for (const rc of rawCosts) {
    const c = (rc ?? {}) as Record<string, unknown>;
    if (!COST_KINDS.some((k) => k.value === c.kind)) return { ok: false, error: 'Choose what each running cost is for' };
    if (!isFreq(c.frequency)) return { ok: false, error: 'Choose how often each running cost is paid' };
    const a = amount(c.amountNzd, 'Running cost');
    if (typeof a === 'string') return { ok: false, error: a };
    if (a == null || a === 0) continue;
    runningCosts.push({ kind: c.kind as RunningCost['kind'], amountNzd: a, frequency: c.frequency, ...(text(c.label, 40) ? { label: text(c.label, 40) } : {}) });
  }

  // Odometer and depreciation.
  const od = (o.odometer && typeof o.odometer === 'object' ? o.odometer : {}) as Record<string, unknown>;
  const reading = amount(od.reading, 'Odometer reading', 10_000_000);
  const atPurchase = amount(od.atPurchase, 'Odometer when bought', 10_000_000);
  const dep = amount(o.depreciationPct, 'Depreciation rate', 99);
  for (const v of [reading, atPurchase, dep]) if (typeof v === 'string') return { ok: false, error: v };
  if (od.readOn != null && od.readOn !== '' && !isYmd(od.readOn)) return { ok: false, error: 'Odometer date must be a date' };
  if (reading != null && atPurchase != null && (atPurchase as number) > (reading as number)) return { ok: false, error: 'The reading when bought is more than the latest reading' };

  return {
    ok: true,
    value: {
      odometer: {
        reading: reading as number | null,
        unit: od.unit === 'mi' ? 'mi' : 'km',
        readOn: isYmd(od.readOn) ? (od.readOn as string) : null,
        atPurchase: atPurchase as number | null,
      },
      depreciationPct: dep as number | null,
      name,
      kind,
      make: text(o.make, 40),
      model: text(o.model, 40),
      year,
      plate: text(o.plate, 10).toUpperCase(),
      purchaseDate: isYmd(o.purchaseDate) ? (o.purchaseDate as string) : null,
      purchasePriceNzd: nums.purchasePriceNzd,
      valueNzd: nums.valueNzd,
      valuedOn: isYmd(o.valuedOn) ? (o.valuedOn as string) : null,
      countInNetWorth: o.countInNetWorth !== false,
      loan: {
        kind: loanKind,
        accountId,
        balanceNzd: loanKind === 'manual' ? (balance as number) : null,
        lender: loanKind === 'none' ? '' : text(l.lender, 60),
        ratePct: loanKind === 'none' ? null : (rate as number | null),
        repaymentNzd: loanKind === 'none' ? null : (repay as number | null),
        repaymentFrequency: loanKind !== 'none' && repay != null ? (l.repaymentFrequency as CostFrequency) : null,
      },
      runningCosts,
      notes: text(o.notes, 500),
    },
  };
}

// ---------------------------------------------------------------- view

function present(db: Database, userId: string, r: Row): Vehicle {
  let runningCosts: RunningCost[] = [];
  try {
    runningCosts = JSON.parse(r.running_costs_json) as RunningCost[];
  } catch {
    runningCosts = [];
  }
  const account =
    r.loan_kind === 'account' && r.loan_account_id
      ? queryOne<{ name: string; balance: number }>(db, `SELECT name, balance FROM bank_accounts WHERE id = ? AND user_id = ?`, [r.loan_account_id, userId])
      : null;
  const loanOwedNzd = r.loan_kind === 'manual' ? Number(r.loan_balance_nzd ?? 0) : account ? roundMoney(Math.abs(Number(account.balance) || 0)) : null;
  const value = r.value_nzd == null ? null : Number(r.value_nzd);
  const draft: VehicleDraft = {
    name: r.name,
    kind: r.kind,
    make: r.make,
    model: r.model,
    year: r.year,
    plate: r.plate,
    purchaseDate: r.purchase_date,
    purchasePriceNzd: r.purchase_price_nzd,
    valueNzd: value,
    valuedOn: r.valued_on,
    countInNetWorth: r.count_in_net_worth === 1,
    loan: {
      kind: r.loan_kind,
      accountId: r.loan_account_id,
      balanceNzd: r.loan_balance_nzd,
      lender: r.loan_lender,
      ratePct: r.loan_rate_pct,
      repaymentNzd: r.loan_repayment_nzd,
      repaymentFrequency: r.loan_repayment_freq,
    },
    runningCosts,
    odometer: { reading: r.odometer, unit: r.odometer_unit === 'mi' ? 'mi' : 'km', readOn: r.odometer_on, atPurchase: r.odometer_at_purchase },
    depreciationPct: r.depreciation_pct,
    notes: r.notes,
  };
  const est =
    r.depreciation_pct != null && r.purchase_price_nzd != null && r.purchase_date
      ? depreciatedValue(Number(r.purchase_price_nzd), r.purchase_date, Number(r.depreciation_pct), aucklandToday())
      : null;
  const perYear = distancePerYear(r.odometer, r.odometer_on, r.odometer_at_purchase, r.purchase_date);
  const cost = costToOwn(runningCosts, null);
  return {
    ...draft,
    estimate: est ? { ...est, ratePct: Number(r.depreciation_pct) } : null,
    distance: perYear != null ? { perYear, unit: draft.odometer.unit, runningCostPerUnit: perYear > 0 && cost.running.year > 0 ? roundMoney(cost.running.year / perYear) : null } : null,
    id: r.id,
    loanOwedNzd,
    loanAccountName: account?.name ?? null,
    equityNzd: value == null ? null : roundMoney(value - (loanOwedNzd ?? 0)),
    costToOwn: costToOwn(runningCosts, r.loan_repayment_nzd != null && r.loan_repayment_freq ? { amountNzd: Number(r.loan_repayment_nzd), frequency: r.loan_repayment_freq } : null),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listVehicles(db: Database, userId: string): VehiclesView {
  const vehicles = queryAll<Row>(db, `SELECT * FROM vehicles WHERE user_id = ? ORDER BY created_at`, [userId]).map((r) => present(db, userId, r));
  const counted = vehicles.filter((v) => v.countInNetWorth && v.valueNzd != null);
  const t = vehicleTotals(db, userId);
  return {
    vehicles,
    totals: {
      count: vehicles.length,
      valueNzd: t?.valueNzd ?? 0,
      loansNzd: roundMoney(counted.reduce((s, v) => s + (v.loanOwedNzd ?? 0), 0)),
      equityNzd: roundMoney(counted.reduce((s, v) => s + (v.equityNzd ?? 0), 0)),
      runningPerMonthNzd: roundMoney(vehicles.reduce((s, v) => s + v.costToOwn.running.month, 0)),
      costToOwnPerMonthNzd: roundMoney(vehicles.reduce((s, v) => s + v.costToOwn.total.month, 0)),
    },
    loanAccounts: queryAll<{ id: string; name: string; balance: number }>(db, `SELECT id, name, balance FROM bank_accounts WHERE user_id = ? AND account_type = 'loan' ORDER BY name`, [userId]).map((a) => ({
      id: a.id,
      name: a.name,
      balanceNzd: roundMoney(Number(a.balance) || 0),
    })),
  };
}

/**
 * For net worth: recorded value of vehicles that count, and the manually entered loan balances
 * on them (loans linked to a bank account are already in the account liabilities). null when
 * no vehicle counts.
 */
export function vehicleTotals(db: Database, userId: string): { valueNzd: number; manualLoansNzd: number; perVehicle: { id: string; name: string; valueNzd: number; loanNzd: number }[] } | null {
  const rows = queryAll<{ id: string; name: string; value_nzd: number; loan_kind: string; loan_balance_nzd: number | null }>(
    db,
    `SELECT id, name, value_nzd, loan_kind, loan_balance_nzd FROM vehicles WHERE user_id = ? AND count_in_net_worth = 1 AND value_nzd IS NOT NULL ORDER BY created_at`,
    [userId],
  );
  if (!rows.length) return null;
  const perVehicle = rows.map((r) => ({ id: r.id, name: r.name, valueNzd: Number(r.value_nzd), loanNzd: r.loan_kind === 'manual' ? Number(r.loan_balance_nzd ?? 0) : 0 }));
  return {
    valueNzd: roundMoney(perVehicle.reduce((s, v) => s + v.valueNzd, 0)),
    manualLoansNzd: roundMoney(perVehicle.reduce((s, v) => s + v.loanNzd, 0)),
    perVehicle,
  };
}

// ---------------------------------------------------------------- writes

const COLS = `name=?, kind=?, make=?, model=?, year=?, plate=?, purchase_date=?, purchase_price_nzd=?, value_nzd=?, valued_on=?, count_in_net_worth=?,
  loan_kind=?, loan_account_id=?, loan_balance_nzd=?, loan_lender=?, loan_rate_pct=?, loan_repayment_nzd=?, loan_repayment_freq=?, running_costs_json=?,
  odometer=?, odometer_unit=?, odometer_on=?, odometer_at_purchase=?, depreciation_pct=?, notes=?`;
const values = (d: VehicleDraft) => [
  d.name, d.kind, d.make, d.model, d.year, d.plate, d.purchaseDate, d.purchasePriceNzd, d.valueNzd, d.valuedOn, d.countInNetWorth ? 1 : 0,
  d.loan.kind, d.loan.accountId, d.loan.balanceNzd, d.loan.lender, d.loan.ratePct, d.loan.repaymentNzd, d.loan.repaymentFrequency, JSON.stringify(d.runningCosts),
  d.odometer.reading, d.odometer.unit, d.odometer.readOn, d.odometer.atPurchase, d.depreciationPct, d.notes,
];

export function createVehicle(db: Database, userId: string, body: unknown): Result<Vehicle> {
  const p = parseVehicle(db, userId, body);
  if (!p.ok) return fail(400, p.error);
  const id = newId('veh');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO vehicles (id, user_id, name, kind, make, model, year, plate, purchase_date, purchase_price_nzd, value_nzd, valued_on, count_in_net_worth,
       loan_kind, loan_account_id, loan_balance_nzd, loan_lender, loan_rate_pct, loan_repayment_nzd, loan_repayment_freq, running_costs_json,
       odometer, odometer_unit, odometer_on, odometer_at_purchase, depreciation_pct, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, ...values(p.value), now, now],
  );
  return { ok: true, value: present(db, userId, queryOne<Row>(db, `SELECT * FROM vehicles WHERE id = ?`, [id])!) };
}

export function updateVehicle(db: Database, userId: string, id: string, body: unknown): Result<Vehicle> {
  if (!queryOne(db, `SELECT 1 FROM vehicles WHERE id = ? AND user_id = ?`, [id, userId])) return fail(404, 'Vehicle not found');
  const p = parseVehicle(db, userId, body);
  if (!p.ok) return fail(400, p.error);
  run(db, `UPDATE vehicles SET ${COLS}, updated_at=? WHERE id=? AND user_id=?`, [...values(p.value), new Date().toISOString(), id, userId]);
  return { ok: true, value: present(db, userId, queryOne<Row>(db, `SELECT * FROM vehicles WHERE id = ?`, [id])!) };
}

/** Removes the vehicle only. A linked bank loan account is never touched. */
export function deleteVehicle(db: Database, userId: string, id: string): boolean {
  if (!queryOne(db, `SELECT 1 FROM vehicles WHERE id = ? AND user_id = ?`, [id, userId])) return false;
  run(db, `DELETE FROM vehicles WHERE id = ? AND user_id = ?`, [id, userId]);
  return true;
}
