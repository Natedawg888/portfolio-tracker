/**
 * Businesses for one user (KAN-84): details, assets and their movements, clients, and the
 * transactions and income tagged to each. Every query filters on user_id; another user's id
 * behaves like a missing row.
 *
 * Income for a tax year, counted once:
 *   - invoice payments on the business's invoices (not void)
 *   - income rows tagged to the business that aren't invoice payments
 *   - bank credits tagged to the business, unless an income row counted above is linked to
 *     that deposit, or it is the deposit for an invoice payment that has no income row (same
 *     amount within 10 days, the bank-link rule used elsewhere)
 * Expenses are bank debits tagged to the business. Transfers count as neither.
 *
 * Asset values are what the user entered. Movements change the quantity and never take it
 * below zero.
 */
import type { Database } from 'sql.js';
import type {
  Business,
  BusinessAsset,
  BusinessAssetMovement,
  BusinessCard,
  BusinessClientView,
  BusinessDetail,
  BusinessListResponse,
  BusinessMoneyItem,
  BusinessTotals,
  InvoiceClient,
} from '../../src/types/index.ts';
import {
  assetValue,
  defaultUnit,
  gstCollectedEstimate,
  isAssetCategory,
  isBusinessType,
  isHiveStatus,
  isMovementKind,
  movementDelta,
  quantityAfter,
  roundQty,
  taxYearOf,
  taxYearRange,
  type AssetCategory,
  type BusinessType,
  type HiveStatus,
  type MovementKind,
  type ValueMode,
} from '../../src/lib/business.ts';
import { isValidEmail, isYmd } from '../../src/lib/invoiceCalc.ts';
import { roundMoney } from '../../src/lib/debtModel.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { deleteBusinessLogo, deleteEmployeeContract, saveBusinessLogo } from '../lib/uploads.ts';
import { getClient, listClients, summary } from '../invoices/store.ts';
import { listCommodities } from '../commodities/store.ts';
import { businessRow, presentBusiness, type BusinessRow } from './profile.ts';
import { activeEmployeeCount, listEmployees } from './employees.ts';

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

const MAX_MONEY = 100_000_000;
const MAX_QTY = 10_000_000;
const BANK_MATCH_DAYS = 10;

function obj(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function text(o: Record<string, unknown>, key: string, max: number): string {
  const v = o[key];
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function longText(o: Record<string, unknown>, key: string, max: number): string {
  const v = o[key];
  return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '';
}

/** Blank → null. Otherwise a number from 0 up. */
function optionalAmount(raw: unknown, label: string, max = MAX_MONEY): Parsed<number | null> {
  if (raw == null || raw === '') return { ok: true, value: null };
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number` };
  if (n < 0) return { ok: false, error: `${label} can't be negative` };
  if (n > max) return { ok: false, error: `${label} is too large` };
  return { ok: true, value: n };
}

// ---------------------------------------------------------------- parsing

export type BusinessDraft = {
  name: string;
  type: BusinessType;
  industry: string;
  nzbn: string;
  gstRegistered: boolean;
  gstNumber: string;
  email: string;
  address: string;
  phone: string;
  bankAccount: string;
  invoicePrefix: string;
  clientsEnabled: boolean;
  countInNetWorth: boolean;
};

export function parseBusiness(raw: unknown): Parsed<BusinessDraft> {
  const o = obj(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  const name = text(o, 'name', 120);
  if (!name) return { ok: false, error: 'Business name is required' };
  const type = o.type ?? 'sole_trader';
  if (!isBusinessType(type)) return { ok: false, error: 'Type must be sole trader, partnership, company or hobby' };
  const email = text(o, 'email', 254);
  if (email && !isValidEmail(email)) return { ok: false, error: 'Business email is not valid' };
  const gstRegistered = o.gstRegistered === true;
  const gstNumber = text(o, 'gstNumber', 20);
  if (gstRegistered && !gstNumber) return { ok: false, error: 'Add the GST number, or turn off GST registered' };
  if (gstRegistered && !/^\d{2,3}-?\d{3}-?\d{3}$/.test(gstNumber)) {
    return { ok: false, error: 'GST number must be 8 or 9 digits (e.g. 123-456-789)' };
  }
  const nzbn = text(o, 'nzbn', 20).replace(/\s/g, '');
  if (nzbn && !/^\d{13}$/.test(nzbn)) return { ok: false, error: 'NZBN must be 13 digits' };
  const invoicePrefix = text(o, 'invoicePrefix', 12) || 'INV-';
  if (/\d$/.test(invoicePrefix)) return { ok: false, error: 'Invoice prefix cannot end in a digit' };
  return {
    ok: true,
    value: {
      name,
      type,
      industry: text(o, 'industry', 80),
      nzbn,
      gstRegistered,
      gstNumber,
      email,
      address: longText(o, 'address', 400),
      phone: text(o, 'phone', 40),
      bankAccount: text(o, 'bankAccount', 40),
      invoicePrefix,
      clientsEnabled: o.clientsEnabled !== false,
      countInNetWorth: o.countInNetWorth !== false,
    },
  };
}

export type AssetDraft = {
  category: AssetCategory;
  name: string;
  quantity: number;
  unit: string;
  costNzd: number | null;
  valueMode: ValueMode;
  valueNzd: number | null;
  valuedOn: string | null;
  animalType: string;
  tag: string;
  location: string;
  status: HiveStatus;
  notes: string;
};

export function parseAsset(raw: unknown, today: string): Parsed<AssetDraft> {
  const o = obj(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  if (!isAssetCategory(o.category)) return { ok: false, error: 'Pick a category' };
  const category = o.category;
  const name = text(o, 'name', 80);
  if (!name) return { ok: false, error: 'Name is required' };
  const qty = optionalAmount(o.quantity, 'Quantity', MAX_QTY);
  if (!qty.ok) return qty;
  const cost = optionalAmount(o.costNzd, 'Cost');
  if (!cost.ok) return cost;
  const value = optionalAmount(o.valueNzd, 'Value');
  if (!value.ok) return value;
  const valueMode: ValueMode = o.valueMode === 'per_unit' ? 'per_unit' : 'total';
  let valuedOn: string | null = null;
  if (value.value != null) {
    valuedOn = o.valuedOn == null || o.valuedOn === '' ? today : (o.valuedOn as string);
    if (!isYmd(valuedOn)) return { ok: false, error: 'Valued on must be YYYY-MM-DD' };
    if (valuedOn > today) return { ok: false, error: 'Valued on can’t be in the future' };
  }
  const status = o.status ?? 'active';
  if (!isHiveStatus(status)) return { ok: false, error: 'Status must be active, dead or sold' };
  return {
    ok: true,
    value: {
      category,
      name,
      quantity: roundQty(qty.value ?? 0),
      unit: text(o, 'unit', 20) || defaultUnit(category),
      costNzd: cost.value == null ? null : roundMoney(cost.value),
      valueMode,
      valueNzd: value.value == null ? null : roundMoney(value.value),
      valuedOn,
      animalType: category === 'livestock' ? text(o, 'animalType', 40) : '',
      tag: text(o, 'tag', 60),
      location: text(o, 'location', 80),
      status: category === 'beehives' ? status : 'active',
      notes: longText(o, 'notes', 1000),
    },
  };
}

export type MovementDraft = { date: string; kind: MovementKind; quantity: number; amountNzd: number | null; notes: string };

export function parseMovement(raw: unknown, today: string): Parsed<MovementDraft> {
  const o = obj(raw);
  if (!o) return { ok: false, error: 'Body is required' };
  if (!isMovementKind(o.kind)) return { ok: false, error: 'Kind must be purchase, sale, birth, death or loss' };
  const date = o.date == null || o.date === '' ? today : o.date;
  if (!isYmd(date)) return { ok: false, error: 'Date must be YYYY-MM-DD' };
  const qty = optionalAmount(o.quantity, 'Quantity', MAX_QTY);
  if (!qty.ok) return qty;
  if (!qty.value || qty.value <= 0) return { ok: false, error: 'Quantity must be more than 0' };
  const amount = optionalAmount(o.amountNzd, 'Amount');
  if (!amount.ok) return amount;
  return {
    ok: true,
    value: {
      date,
      kind: o.kind,
      quantity: roundQty(qty.value),
      amountNzd: amount.value == null ? null : roundMoney(amount.value),
      notes: text(o, 'notes', 200),
    },
  };
}

// ---------------------------------------------------------------- businesses

function rows(db: Database, userId: string): BusinessRow[] {
  return queryAll<BusinessRow>(db, `SELECT * FROM businesses WHERE user_id = ? ORDER BY is_default DESC, lower(name), created_at`, [userId]);
}

export function createBusiness(db: Database, userId: string, d: BusinessDraft): Business {
  const id = newId('biz');
  const now = new Date().toISOString();
  const first = rows(db, userId).length === 0;
  run(
    db,
    `INSERT INTO businesses (id, user_id, name, type, industry, nzbn, gst_registered, gst_number, email, address, phone, bank_account,
       invoice_prefix, clients_enabled, count_in_net_worth, is_default, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, userId, d.name, d.type, d.industry, d.nzbn, d.gstRegistered ? 1 : 0, d.gstNumber, d.email, d.address, d.phone,
      d.bankAccount, d.invoicePrefix, d.clientsEnabled ? 1 : 0, d.countInNetWorth ? 1 : 0, first ? 1 : 0, now, now,
    ],
  );
  return presentBusiness(businessRow(db, userId, id)!);
}

/** null = not found. */
export function updateBusiness(db: Database, userId: string, id: string, d: BusinessDraft): Business | null {
  if (!businessRow(db, userId, id)) return null;
  run(
    db,
    `UPDATE businesses SET name=?, type=?, industry=?, nzbn=?, gst_registered=?, gst_number=?, email=?, address=?, phone=?,
       bank_account=?, invoice_prefix=?, clients_enabled=?, count_in_net_worth=?, updated_at=?
     WHERE id=? AND user_id=?`,
    [
      d.name, d.type, d.industry, d.nzbn, d.gstRegistered ? 1 : 0, d.gstNumber, d.email, d.address, d.phone, d.bankAccount,
      d.invoicePrefix, d.clientsEnabled ? 1 : 0, d.countInNetWorth ? 1 : 0, new Date().toISOString(), id, userId,
    ],
  );
  return presentBusiness(businessRow(db, userId, id)!);
}

/**
 * Deletes the business, its assets, movements and clients, and untags its transactions and
 * income (they stay in Budget and Income). A business with invoices can't be deleted: sent
 * invoices are kept on record.
 */
export function deleteBusiness(db: Database, userId: string, id: string): Result<true> {
  const r = businessRow(db, userId, id);
  if (!r) return fail(404, 'Business not found');
  const invoices = Number(queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM invoices WHERE user_id = ? AND business_id = ?`, [userId, id])?.c ?? 0);
  if (invoices > 0) return fail(409, `This business has ${invoices} invoice${invoices === 1 ? '' : 's'}. Invoices are kept on record, so it can’t be deleted.`);
  run(db, `DELETE FROM business_asset_movements WHERE user_id = ? AND asset_id IN (SELECT id FROM business_assets WHERE user_id = ? AND business_id = ?)`, [userId, userId, id]);
  run(db, `DELETE FROM business_assets WHERE user_id = ? AND business_id = ?`, [userId, id]);
  run(db, `DELETE FROM invoice_clients WHERE user_id = ? AND business_id = ?`, [userId, id]);
  for (const e of queryAll<{ p: string | null }>(db, `SELECT contract_path AS p FROM business_employees WHERE user_id = ? AND business_id = ?`, [userId, id])) {
    deleteEmployeeContract(e.p);
  }
  run(db, `DELETE FROM business_employees WHERE user_id = ? AND business_id = ?`, [userId, id]);
  run(db, `UPDATE transactions SET business_id = NULL WHERE user_id = ? AND business_id = ?`, [userId, id]);
  run(db, `UPDATE income_records SET business_id = NULL WHERE user_id = ? AND business_id = ?`, [userId, id]);
  run(db, `UPDATE commodities SET business_id = NULL WHERE user_id = ? AND business_id = ?`, [userId, id]);
  deleteBusinessLogo(r.logo_path);
  run(db, `DELETE FROM businesses WHERE id = ? AND user_id = ?`, [id, userId]);
  if (Number(r.is_default) === 1) {
    const next = rows(db, userId)[0];
    if (next) run(db, `UPDATE businesses SET is_default = 1 WHERE id = ? AND user_id = ?`, [next.id, userId]);
  }
  return { ok: true, value: true };
}

export function setBusinessLogo(db: Database, userId: string, id: string, image: string): Result<Business> {
  const r = businessRow(db, userId, id);
  if (!r) return fail(404, 'Business not found');
  let rel: string;
  try {
    rel = saveBusinessLogo(id, image);
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : 'Invalid image');
  }
  if (r.logo_path && r.logo_path !== rel) deleteBusinessLogo(r.logo_path);
  run(db, `UPDATE businesses SET logo_path = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [rel, new Date().toISOString(), id, userId]);
  return { ok: true, value: presentBusiness(businessRow(db, userId, id)!) };
}

export function removeBusinessLogo(db: Database, userId: string, id: string): Result<Business> {
  const r = businessRow(db, userId, id);
  if (!r) return fail(404, 'Business not found');
  deleteBusinessLogo(r.logo_path);
  run(db, `UPDATE businesses SET logo_path = NULL, updated_at = ? WHERE id = ? AND user_id = ?`, [new Date().toISOString(), id, userId]);
  return { ok: true, value: presentBusiness(businessRow(db, userId, id)!) };
}

// ---------------------------------------------------------------- assets

type AssetRow = {
  id: string;
  business_id: string;
  category: string;
  name: string;
  quantity: number;
  unit: string;
  cost_nzd: number | null;
  value_mode: string;
  value_nzd: number | null;
  valued_on: string | null;
  animal_type: string;
  tag: string;
  location: string;
  status: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

type MovementRow = {
  id: string;
  asset_id: string;
  date: string;
  kind: string;
  quantity: number;
  amount_nzd: number | null;
  notes: string;
  created_at: string;
};

function presentMovement(m: MovementRow): BusinessAssetMovement {
  return {
    id: m.id,
    assetId: m.asset_id,
    date: m.date,
    kind: (isMovementKind(m.kind) ? m.kind : 'purchase') as MovementKind,
    quantity: Number(m.quantity),
    amountNzd: m.amount_nzd == null ? null : roundMoney(Number(m.amount_nzd)),
    notes: m.notes ?? '',
    createdAt: m.created_at,
  };
}

function presentAsset(r: AssetRow, movements: BusinessAssetMovement[]): BusinessAsset {
  const category = (isAssetCategory(r.category) ? r.category : 'other') as AssetCategory;
  const valueMode: ValueMode = r.value_mode === 'per_unit' ? 'per_unit' : 'total';
  const quantity = Number(r.quantity);
  const valueNzd = r.value_nzd == null ? null : roundMoney(Number(r.value_nzd));
  const status = (isHiveStatus(r.status) ? r.status : 'active') as HiveStatus;
  return {
    id: r.id,
    businessId: r.business_id,
    category,
    name: r.name,
    quantity,
    unit: r.unit ?? '',
    costNzd: r.cost_nzd == null ? null : roundMoney(Number(r.cost_nzd)),
    valueMode,
    valueNzd,
    valuedOn: r.valued_on,
    currentValueNzd: assetValue({ quantity, valueMode, valueNzd, category, status }),
    animalType: r.animal_type ?? '',
    tag: r.tag ?? '',
    location: r.location ?? '',
    status,
    notes: r.notes ?? '',
    movements,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function assetRow(db: Database, userId: string, id: string): AssetRow | null {
  return queryOne<AssetRow>(db, `SELECT * FROM business_assets WHERE id = ? AND user_id = ?`, [id, userId]);
}

export function listAssets(db: Database, userId: string, businessId: string): BusinessAsset[] {
  const moves = new Map<string, BusinessAssetMovement[]>();
  for (const m of queryAll<MovementRow>(
    db,
    `SELECT m.* FROM business_asset_movements m JOIN business_assets a ON a.id = m.asset_id AND a.user_id = m.user_id
     WHERE m.user_id = ? AND a.business_id = ? ORDER BY m.date DESC, m.created_at DESC`,
    [userId, businessId],
  )) {
    const list = moves.get(m.asset_id) ?? [];
    list.push(presentMovement(m));
    moves.set(m.asset_id, list);
  }
  return queryAll<AssetRow>(
    db,
    `SELECT * FROM business_assets WHERE user_id = ? AND business_id = ? ORDER BY category, lower(name), created_at`,
    [userId, businessId],
  ).map((r) => presentAsset(r, moves.get(r.id) ?? []));
}

export function getAsset(db: Database, userId: string, id: string): BusinessAsset | null {
  const r = assetRow(db, userId, id);
  if (!r) return null;
  const moves = queryAll<MovementRow>(
    db,
    `SELECT * FROM business_asset_movements WHERE user_id = ? AND asset_id = ? ORDER BY date DESC, created_at DESC`,
    [userId, id],
  ).map(presentMovement);
  return presentAsset(r, moves);
}

const ASSET_COLS = `category=?, name=?, quantity=?, unit=?, cost_nzd=?, value_mode=?, value_nzd=?, valued_on=?, animal_type=?, tag=?, location=?, status=?, notes=?`;
const assetValues = (d: AssetDraft) => [
  d.category, d.name, d.quantity, d.unit, d.costNzd, d.valueMode, d.valueNzd, d.valuedOn, d.animalType, d.tag, d.location, d.status, d.notes,
];

export function createAsset(db: Database, userId: string, businessId: string, d: AssetDraft): Result<BusinessAsset> {
  if (!businessRow(db, userId, businessId)) return fail(404, 'Business not found');
  const id = newId('basset');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO business_assets (id, user_id, business_id, category, name, quantity, unit, cost_nzd, value_mode, value_nzd, valued_on,
       animal_type, tag, location, status, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, businessId, ...assetValues(d), now, now],
  );
  return { ok: true, value: getAsset(db, userId, id)! };
}

export function updateAsset(db: Database, userId: string, id: string, d: AssetDraft): Result<BusinessAsset> {
  if (!assetRow(db, userId, id)) return fail(404, 'Asset not found');
  run(db, `UPDATE business_assets SET ${ASSET_COLS}, updated_at=? WHERE id=? AND user_id=?`, [...assetValues(d), new Date().toISOString(), id, userId]);
  return { ok: true, value: getAsset(db, userId, id)! };
}

export function deleteAsset(db: Database, userId: string, id: string): boolean {
  if (!assetRow(db, userId, id)) return false;
  run(db, `DELETE FROM business_asset_movements WHERE user_id = ? AND asset_id = ?`, [userId, id]);
  run(db, `DELETE FROM business_assets WHERE id = ? AND user_id = ?`, [id, userId]);
  return true;
}

/** Records a purchase, sale, birth, death or loss and moves the quantity. */
export function addMovement(db: Database, userId: string, assetId: string, d: MovementDraft): Result<BusinessAsset> {
  const a = assetRow(db, userId, assetId);
  if (!a) return fail(404, 'Asset not found');
  const next = quantityAfter(Number(a.quantity), d.kind, d.quantity);
  if (next == null) return fail(400, `That would leave ${a.name} below zero (there ${Number(a.quantity) === 1 ? 'is' : 'are'} ${Number(a.quantity)})`);
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO business_asset_movements (id, user_id, asset_id, date, kind, quantity, amount_nzd, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    [newId('bmove'), userId, assetId, d.date, d.kind, d.quantity, d.amountNzd, d.notes, now],
  );
  run(db, `UPDATE business_assets SET quantity = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [next, now, assetId, userId]);
  return { ok: true, value: getAsset(db, userId, assetId)! };
}

/** Undoes a movement's change to the quantity, unless that would go below zero. */
export function deleteMovement(db: Database, userId: string, id: string): Result<BusinessAsset> {
  const m = queryOne<MovementRow>(db, `SELECT * FROM business_asset_movements WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!m) return fail(404, 'Movement not found');
  const a = assetRow(db, userId, m.asset_id);
  if (!a) return fail(404, 'Asset not found');
  const next = roundQty(Number(a.quantity) - movementDelta(m.kind as MovementKind, Number(m.quantity)));
  if (next < 0) return fail(400, `Removing it would leave ${a.name} below zero`);
  const now = new Date().toISOString();
  run(db, `DELETE FROM business_asset_movements WHERE id = ? AND user_id = ?`, [id, userId]);
  run(db, `UPDATE business_assets SET quantity = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [next, now, a.id, userId]);
  return { ok: true, value: getAsset(db, userId, a.id)! };
}

function assetsTotal(assets: BusinessAsset[]): number | null {
  const valued = assets.filter((a) => a.currentValueNzd != null);
  return valued.length ? roundMoney(valued.reduce((s, a) => s + (a.currentValueNzd ?? 0), 0)) : null;
}

/**
 * What a business is worth from what it owns: its assets (equipment, livestock, hives, stock …)
 * plus the produce linked to it, at the values the user entered. null when nothing has a value.
 */
export function businessValue(db: Database, userId: string, businessId: string, today: string): number | null {
  const parts = [assetsTotal(listAssets(db, userId, businessId)), ...businessProduce(db, userId, businessId, today).map((p) => p.valueNzd)].filter(
    (n): n is number => n != null,
  );
  return parts.length ? roundMoney(parts.reduce((s, n) => s + n, 0)) : null;
}

/**
 * Net worth (KAN-84): one value per business counted in net worth. Its equipment, stock and
 * produce count only through it (Commodities leaves out produce linked to a business).
 */
export function businessAssetTotals(db: Database, userId: string, today: string): { valueNzd: number; perBusiness: { id: string; name: string; valueNzd: number }[] } | null {
  const perBusiness: { id: string; name: string; valueNzd: number }[] = [];
  for (const b of rows(db, userId)) {
    if (!Number(b.count_in_net_worth)) continue;
    const total = businessValue(db, userId, b.id, today);
    if (total != null) perBusiness.push({ id: b.id, name: b.name, valueNzd: total });
  }
  if (!perBusiness.length) return null;
  return { valueNzd: roundMoney(perBusiness.reduce((s, b) => s + b.valueNzd, 0)), perBusiness };
}

// ---------------------------------------------------------------- money

type TxnRow = { id: string; date: string; description: string | null; merchant: string | null; amount: number; kind: string; business_id: string | null };
type IncomeRow = { id: string; date: string; description: string | null; amount_nzd: number; business_id: string | null; invoice_payment_id: string | null; transaction_id: string | null };

function dayGap(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/** Tagged items in [start, end] and the totals they make, counted once (see the header). */
export function businessMoney(
  db: Database,
  userId: string,
  businessId: string,
  start: string,
  end: string,
): { items: BusinessMoneyItem[]; incomeNzd: number; expensesNzd: number; invoicePaidNzd: number } {
  const payments = queryAll<{ id: string; date: string; amount_nzd: number; income_record_id: string | null }>(
    db,
    `SELECT p.id, p.date, p.amount_nzd, p.income_record_id FROM invoice_payments p
     JOIN invoices i ON i.id = p.invoice_id AND i.user_id = p.user_id
     WHERE p.user_id = ? AND i.business_id = ? AND i.status != 'void' AND p.date >= ? AND p.date <= ?`,
    [userId, businessId, start, end],
  );
  const invoicePaidNzd = roundMoney(payments.reduce((s, p) => s + Number(p.amount_nzd), 0));

  const incomes = queryAll<IncomeRow>(
    db,
    `SELECT id, date, description, amount_nzd, business_id, invoice_payment_id, transaction_id FROM income_records
     WHERE user_id = ? AND business_id = ? AND date >= ? AND date <= ? ORDER BY date DESC, id`,
    [userId, businessId, start, end],
  );
  // Deposits an income row tagged to this business already stands for (in any year).
  const linkedDeposits = new Map(
    queryAll<{ t: string; inv: string | null }>(
      db,
      `SELECT transaction_id AS t, invoice_payment_id AS inv FROM income_records WHERE user_id = ? AND business_id = ? AND transaction_id IS NOT NULL`,
      [userId, businessId],
    ).map((r) => [r.t, r.inv ? ('invoice' as const) : ('income' as const)]),
  );
  const txns = queryAll<TxnRow>(
    db,
    `SELECT id, date, description, merchant, amount, kind, business_id FROM transactions
     WHERE user_id = ? AND business_id = ? AND date >= ? AND date <= ? ORDER BY date DESC, id`,
    [userId, businessId, start, end],
  );

  // Invoice payments with no income row have no bank link: match a tagged deposit the usual way.
  const paidByDeposit = new Set<string>();
  for (const p of payments.filter((x) => !x.income_record_id).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    const hit = txns
      .filter((t) => Number(t.amount) > 0 && !linkedDeposits.has(t.id) && !paidByDeposit.has(t.id))
      .filter((t) => Math.abs(Number(t.amount) - Number(p.amount_nzd)) < 0.005 && dayGap(t.date, p.date) <= BANK_MATCH_DAYS)
      .sort((a, b) => dayGap(a.date, p.date) - dayGap(b.date, p.date) || a.id.localeCompare(b.id))[0];
    if (hit) paidByDeposit.add(hit.id);
  }

  let income = invoicePaidNzd;
  let expenses = 0;
  const items: BusinessMoneyItem[] = [];
  for (const r of incomes) {
    const viaInvoice = Boolean(r.invoice_payment_id);
    if (!viaInvoice) income += Number(r.amount_nzd);
    items.push({
      kind: 'income',
      id: r.id,
      date: r.date,
      description: (r.description ?? '').trim() || 'Income',
      amountNzd: roundMoney(Number(r.amount_nzd)),
      businessId: r.business_id,
      countedVia: viaInvoice ? 'invoice' : null,
    });
  }
  for (const t of txns) {
    const amount = Number(t.amount);
    let countedVia: BusinessMoneyItem['countedVia'] = null;
    if (t.kind === 'transfer') {
      // A transfer between the user's own accounts is neither income nor an expense.
    } else if (amount > 0) {
      if (linkedDeposits.has(t.id)) countedVia = linkedDeposits.get(t.id)!;
      else if (paidByDeposit.has(t.id)) countedVia = 'invoice';
      else income += amount;
    } else if (amount < 0) {
      expenses += -amount;
    }
    items.push({
      kind: 'transaction',
      id: t.id,
      date: t.date,
      description: (t.merchant || t.description || '').trim() || 'Transaction',
      amountNzd: roundMoney(amount),
      businessId: t.business_id,
      countedVia,
    });
  }
  items.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return { items, incomeNzd: roundMoney(income), expensesNzd: roundMoney(expenses), invoicePaidNzd };
}

function outstanding(db: Database, userId: string, businessId: string, today: string): number {
  return roundMoney(
    queryAll<Parameters<typeof summary>[2]>(db, `SELECT * FROM invoices WHERE user_id = ? AND business_id = ? AND status = 'sent'`, [userId, businessId])
      .map((r) => summary(db, userId, r, today).balanceNzd)
      .reduce((s, n) => s + n, 0),
  );
}

export function businessTotals(db: Database, userId: string, b: BusinessRow, taxYear: number, today: string): BusinessTotals {
  const { start, end } = taxYearRange(taxYear);
  const money = businessMoney(db, userId, b.id, start, end);
  return {
    incomeNzd: money.incomeNzd,
    expensesNzd: money.expensesNzd,
    netNzd: roundMoney(money.incomeNzd - money.expensesNzd),
    assetsNzd: businessValue(db, userId, b.id, today),
    gstCollectedEstimateNzd: Number(b.gst_registered) === 1 ? gstCollectedEstimate(money.incomeNzd) : null,
    outstandingNzd: outstanding(db, userId, b.id, today),
  };
}

/** Tax years with tagged money or invoice payments, plus the current one, newest first. */
function taxYears(db: Database, userId: string, today: string): number[] {
  const years = new Set<number>([taxYearOf(today)]);
  const dates = queryAll<{ d: string }>(
    db,
    `SELECT date AS d FROM transactions WHERE user_id = ? AND business_id IS NOT NULL
     UNION SELECT date FROM income_records WHERE user_id = ? AND business_id IS NOT NULL
     UNION SELECT p.date FROM invoice_payments p WHERE p.user_id = ?`,
    [userId, userId, userId],
  );
  for (const r of dates) if (isYmd(r.d)) years.add(taxYearOf(r.d));
  return [...years].sort((a, b) => b - a);
}

function count(db: Database, sql: string, params: unknown[]): number {
  return Number(queryOne<{ c: number }>(db, sql, params)?.c ?? 0);
}

/** What was recorded in the tax year (counts only; the totals above are unchanged). */
function yearActivity(db: Database, userId: string, businessId: string, taxYear: number): BusinessCard['activity'] {
  const { start, end } = taxYearRange(taxYear);
  return {
    invoices: count(db, `SELECT COUNT(*) AS c FROM invoices WHERE user_id = ? AND business_id = ? AND issue_date >= ? AND issue_date <= ?`, [userId, businessId, start, end]),
    tagged: businessMoney(db, userId, businessId, start, end).items.length,
  };
}

export function listBusinesses(db: Database, userId: string, today: string, taxYear?: number | null): BusinessListResponse {
  const year = taxYear ?? taxYearOf(today);
  const businesses: BusinessCard[] = rows(db, userId).map((r) => ({
    ...presentBusiness(r),
    totals: businessTotals(db, userId, r, year, today),
    assetCount: count(db, `SELECT COUNT(*) AS c FROM business_assets WHERE user_id = ? AND business_id = ?`, [userId, r.id]),
    clientCount: count(db, `SELECT COUNT(*) AS c FROM invoice_clients WHERE user_id = ? AND business_id = ?`, [userId, r.id]),
    invoiceCount: count(db, `SELECT COUNT(*) AS c FROM invoices WHERE user_id = ? AND business_id = ?`, [userId, r.id]),
    employeeCount: activeEmployeeCount(db, userId, r.id),
    activity: yearActivity(db, userId, r.id, year),
  }));
  return { today, taxYear: year, taxYears: taxYears(db, userId, today), businesses };
}

type InvoiceRowLike = Parameters<typeof summary>[2];

function clientFigures(db: Database, userId: string, clientId: string, today: string) {
  const invoices = queryAll<InvoiceRowLike>(
    db,
    `SELECT * FROM invoices WHERE user_id = ? AND client_id = ? ORDER BY issue_date DESC, created_at DESC`,
    [userId, clientId],
  ).map((r) => summary(db, userId, r, today));
  const sent = invoices.filter((i) => i.storedStatus === 'sent');
  return {
    invoices,
    billedNzd: roundMoney(sent.reduce((s, i) => s + i.totalNzd, 0)),
    outstandingNzd: roundMoney(sent.reduce((s, i) => s + i.balanceNzd, 0)),
  };
}

export function getBusinessDetail(db: Database, userId: string, id: string, today: string, taxYear?: number | null): BusinessDetail | null {
  const r = businessRow(db, userId, id);
  if (!r) return null;
  const year = taxYear ?? taxYearOf(today);
  const { start, end } = taxYearRange(year);
  return {
    today,
    taxYear: year,
    taxYears: taxYears(db, userId, today),
    business: presentBusiness(r),
    totals: businessTotals(db, userId, r, year, today),
    assets: listAssets(db, userId, id),
    clients: listClients(db, userId, id).map((c) => {
      const f = clientFigures(db, userId, c.id, today);
      return { ...c, billedNzd: f.billedNzd, outstandingNzd: f.outstandingNzd };
    }),
    invoices: queryAll<InvoiceRowLike>(
      db,
      `SELECT * FROM invoices WHERE user_id = ? AND business_id = ? ORDER BY issue_date DESC, created_at DESC`,
      [userId, id],
    ).map((inv) => summary(db, userId, inv, today)),
    money: businessMoney(db, userId, id, start, end).items,
    produce: businessProduce(db, userId, id, today),
    employees: listEmployees(db, userId, id, today),
  };
}

/**
 * Commodities (KAN-81) held as the business's produce, like honey or wool. They are valued and
 * counted in net worth on Portfolio → Commodities, so the business shows them without adding
 * them to its own asset total.
 */
export function businessProduce(db: Database, userId: string, businessId: string, today: string): BusinessDetail['produce'] {
  const linked = new Set(
    queryAll<{ id: string }>(db, `SELECT id FROM commodities WHERE user_id = ? AND business_id = ?`, [userId, businessId]).map((r) => r.id),
  );
  if (!linked.size) return [];
  return listCommodities(db, userId, today)
    .commodities.filter((c) => linked.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, quantity: c.quantity, unit: c.unit, valueNzd: c.valueNzd, unitPriceNzd: c.unitPriceNzd, valueOn: c.valueOn, stale: c.stale }));
}

/** Untagged commodities that could be linked to a business. */
export function produceCandidates(db: Database, userId: string, today: string): BusinessDetail['produce'] {
  const free = new Set(
    queryAll<{ id: string }>(db, `SELECT id FROM commodities WHERE user_id = ? AND business_id IS NULL`, [userId]).map((r) => r.id),
  );
  return listCommodities(db, userId, today)
    .commodities.filter((c) => free.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, quantity: c.quantity, unit: c.unit, valueNzd: c.valueNzd, unitPriceNzd: c.unitPriceNzd, valueOn: c.valueOn, stale: c.stale }));
}

/** Link a commodity to a business as produce held, or unlink it (businessId null). */
export function linkProduce(db: Database, userId: string, commodityId: string, businessId: string | null): Result<true> {
  if (businessId && !businessRow(db, userId, businessId)) return fail(404, 'Business not found');
  if (!queryOne(db, `SELECT id FROM commodities WHERE id = ? AND user_id = ?`, [commodityId, userId])) return fail(404, 'Commodity not found');
  run(db, `UPDATE commodities SET business_id = ? WHERE id = ? AND user_id = ?`, [businessId, commodityId, userId]);
  return { ok: true, value: true };
}

export function getClientView(db: Database, userId: string, clientId: string, today: string): BusinessClientView | null {
  const client: InvoiceClient | null = getClient(db, userId, clientId);
  if (!client) return null;
  const f = clientFigures(db, userId, clientId, today);
  const last = queryOne<{ date: string; amount_nzd: number; number: string }>(
    db,
    `SELECT p.date, p.amount_nzd, i.number FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id AND i.user_id = p.user_id
     WHERE p.user_id = ? AND i.client_id = ? AND i.status != 'void' ORDER BY p.date DESC, p.created_at DESC LIMIT 1`,
    [userId, clientId],
  );
  return {
    client,
    businessName: client.businessId ? businessRow(db, userId, client.businessId)?.name ?? '' : '',
    invoices: f.invoices,
    billedNzd: f.billedNzd,
    outstandingNzd: f.outstandingNzd,
    lastPayment: last ? { date: last.date, amountNzd: roundMoney(Number(last.amount_nzd)), invoiceNumber: last.number } : null,
  };
}

/**
 * Untagged transactions and income rows in [start, end] that could be tagged, newest first.
 * Invoice payments are left out: they belong to their invoice's business already.
 */
export function moneyCandidates(db: Database, userId: string, start: string, end: string, q: string): BusinessMoneyItem[] {
  const like = `%${q.trim().toLowerCase().replace(/[%_]/g, '')}%`;
  const txns = queryAll<TxnRow>(
    db,
    `SELECT id, date, description, merchant, amount, kind, business_id FROM transactions
     WHERE user_id = ? AND business_id IS NULL AND kind != 'transfer' AND date >= ? AND date <= ?
       AND (lower(COALESCE(description, '')) LIKE ? OR lower(COALESCE(merchant, '')) LIKE ?)
     ORDER BY date DESC, id LIMIT 100`,
    [userId, start, end, like, like],
  ).map((t): BusinessMoneyItem => ({
    kind: 'transaction',
    id: t.id,
    date: t.date,
    description: (t.merchant || t.description || '').trim() || 'Transaction',
    amountNzd: roundMoney(Number(t.amount)),
    businessId: null,
    countedVia: null,
  }));
  const incomes = queryAll<IncomeRow>(
    db,
    `SELECT id, date, description, amount_nzd, business_id, invoice_payment_id, transaction_id FROM income_records
     WHERE user_id = ? AND business_id IS NULL AND invoice_payment_id IS NULL AND date >= ? AND date <= ?
       AND lower(COALESCE(description, '')) LIKE ?
     ORDER BY date DESC, id LIMIT 50`,
    [userId, start, end, like],
  ).map((r): BusinessMoneyItem => ({
    kind: 'income',
    id: r.id,
    date: r.date,
    description: (r.description ?? '').trim() || 'Income',
    amountNzd: roundMoney(Number(r.amount_nzd)),
    businessId: null,
    countedVia: null,
  }));
  return [...txns, ...incomes].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

/** Tag a transaction or income row to a business, or untag it (businessId null). Invoice payments can't be moved. */
export function tagMoney(db: Database, userId: string, kind: 'transaction' | 'income', id: string, businessId: string | null): Result<true> {
  if (businessId && !businessRow(db, userId, businessId)) return fail(404, 'Business not found');
  if (kind === 'transaction') {
    if (!queryOne(db, `SELECT id FROM transactions WHERE id = ? AND user_id = ?`, [id, userId])) return fail(404, 'Transaction not found');
    run(db, `UPDATE transactions SET business_id = ? WHERE id = ? AND user_id = ?`, [businessId, id, userId]);
    return { ok: true, value: true };
  }
  const inc = queryOne<{ invoice_payment_id: string | null }>(db, `SELECT invoice_payment_id FROM income_records WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!inc) return fail(404, 'Income not found');
  if (inc.invoice_payment_id) return fail(409, 'Invoice payments belong to the invoice’s business');
  run(db, `UPDATE income_records SET business_id = ? WHERE id = ? AND user_id = ?`, [businessId, id, userId]);
  return { ok: true, value: true };
}
