/**
 * Advanced crypto for Pro (KAN-47): a crypto ledger, cost basis (FIFO or weighted average, the
 * two methods IRD lists), realised and unrealised gains, staking income, DeFi positions, and
 * importing on-chain transfers from your synced wallets with suggested classifications.
 *
 * - Everything here needs the Pro plan (entitlements 'crypto_pro'); every query filters on user_id.
 * - NZD values are never guessed: entered by you, or Yahoo Finance × Frankfurter for the day
 *   (prices.ts). Rows without a needed value are flagged and left out of the money figures.
 * - Imports save nothing until you choose a kind for each transfer (or ignore it); imported and
 *   ignored transfers are remembered so they aren't offered again.
 * - DeFi positions are the values you record; they count in net worth (defiTotals) when set to.
 */
import type { Database } from 'sql.js';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { aucklandToday, roundMoney } from '../debts/model.ts';
import { isYmd } from '../../src/lib/invoiceCalc.ts';
import { hasFeature } from '../lib/entitlements.ts';
import { CRYPTO_TXN_KINDS, NEEDS_VALUE, computeGains, needsValue, cryptoTaxYear, suggestKinds, yearSummary, type CostMethod, type CryptoTxnKind, type ImportedTransfer, type LedgerTxn } from '../../src/lib/cryptoGains.ts';
import { historicalPriceNzd } from './prices.ts';
import { fetchWalletTokenTransfers, fetchWalletTransactions } from '../chain/index.ts';
import { formatUnits } from '../chain/networks.ts';
import { NETWORK_CHAIN_INFO } from '../chain/networks.ts';
import type { WalletNetwork } from '../lib/walletAddress.ts';

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code?: string };
const fail = (status: number, error: string, code?: string): { ok: false; status: number; error: string; code?: string } => ({ ok: false, status, error, code });
export const PRO_REQUIRED = () => fail(402, 'Advanced crypto is part of KoruLedger Pro.', 'PRO_REQUIRED');
export const isPro = (db: Database, userId: string) => hasFeature(db, userId, 'crypto_pro');

const MAX = 1e12;
const MAX_IMPORT_PRICES = 30;
export const DEFI_KINDS = ['lending', 'liquidity', 'staking', 'vault', 'borrow', 'other'] as const;
export type DefiKind = (typeof DEFI_KINDS)[number];

// ---------------------------------------------------------------- ledger

type TxnRow = {
  id: string;
  date: string;
  kind: CryptoTxnKind;
  asset: string;
  amount: number;
  nzd_value: number | null;
  price_source: string;
  fee_nzd: number;
  to_asset: string | null;
  to_amount: number | null;
  wallet_id: string | null;
  external_ref: string | null;
  counterparty: string | null;
  notes: string;
  taxable_on_receipt: number;
};
export type CryptoTxn = {
  id: string;
  date: string;
  kind: CryptoTxnKind;
  asset: string;
  amount: number;
  nzdValue: number | null;
  priceSource: string;
  feeNzd: number;
  toAsset: string | null;
  toAmount: number | null;
  walletId: string | null;
  imported: boolean;
  counterparty: string | null;
  notes: string;
  /** Airdrops only (KAN-86): taxable on receipt, so income at its NZD value; otherwise nil cost. */
  taxableOnReceipt: boolean;
  needsValue: boolean;
};

const present = (r: TxnRow): CryptoTxn => ({
  id: r.id,
  date: r.date,
  kind: r.kind,
  asset: r.asset,
  amount: Number(r.amount),
  nzdValue: r.nzd_value == null ? null : Number(r.nzd_value),
  priceSource: r.price_source,
  feeNzd: Number(r.fee_nzd),
  toAsset: r.to_asset,
  toAmount: r.to_amount == null ? null : Number(r.to_amount),
  walletId: r.wallet_id,
  imported: !!r.external_ref,
  counterparty: r.counterparty,
  notes: r.notes,
  taxableOnReceipt: r.taxable_on_receipt === 1,
  needsValue: needsValue({ kind: r.kind, taxableOnReceipt: r.taxable_on_receipt === 1 }) && r.nzd_value == null,
});

const assetCode = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase().replace(/[^A-Z0-9.\-_]/g, '').slice(0, 20) : '');
function money(v: unknown, label: string, opts: { nullable?: boolean; max?: number } = {}): number | null | string {
  if (v === null || v === undefined || v === '') return opts.nullable ? null : 0;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return `${label} must be a number`;
  if (n < 0) return `${label} can’t be negative`;
  if (n > (opts.max ?? MAX)) return `${label} is too large`;
  return n;
}

export type TxnDraft = Omit<CryptoTxn, 'id' | 'imported' | 'needsValue' | 'walletId' | 'priceSource'> & { priceSource?: string; walletId?: string | null };

export function parseTxn(raw: unknown): { ok: true; value: TxnDraft } | { ok: false; error: string } {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'Enter the transaction' };
  if (!isYmd(o.date)) return { ok: false, error: 'Date must be a date' };
  if ((o.date as string) > aucklandToday()) return { ok: false, error: 'The date is in the future' };
  if (!CRYPTO_TXN_KINDS.includes(o.kind as CryptoTxnKind)) return { ok: false, error: 'Choose what kind of transaction it is' };
  const kind = o.kind as CryptoTxnKind;
  const asset = assetCode(o.asset);
  if (!asset) return { ok: false, error: 'Enter the coin or token, e.g. BTC' };
  const amount = money(o.amount, 'Amount');
  if (typeof amount === 'string') return { ok: false, error: amount };
  if (!(amount! > 0)) return { ok: false, error: 'Amount must be more than 0' };
  const nzd = money(o.nzdValue, 'NZD value', { nullable: true });
  const fee = money(o.feeNzd, 'Fee');
  for (const v of [nzd, fee]) if (typeof v === 'string') return { ok: false, error: v };
  let toAsset: string | null = null;
  let toAmount: number | null = null;
  if (kind === 'swap') {
    toAsset = assetCode(o.toAsset);
    const ta = money(o.toAmount, 'Amount received');
    if (typeof ta === 'string') return { ok: false, error: ta };
    if (!toAsset || !(ta! > 0)) return { ok: false, error: 'Enter what you received in the swap' };
    if (toAsset === asset) return { ok: false, error: 'A swap is between two different coins' };
    toAmount = ta;
  }
  return {
    ok: true,
    value: {
      date: o.date as string,
      kind,
      asset,
      amount: amount!,
      nzdValue: nzd == null ? null : roundMoney(nzd as number),
      feeNzd: roundMoney((fee as number) ?? 0),
      toAsset,
      toAmount,
      counterparty: typeof o.counterparty === 'string' ? o.counterparty.trim().slice(0, 80) || null : null,
      notes: typeof o.notes === 'string' ? o.notes.trim().slice(0, 300) : '',
      taxableOnReceipt: kind === 'airdrop' && o.taxableOnReceipt === true,
      priceSource: o.priceSource === 'yahoo+frankfurter' ? 'yahoo+frankfurter' : 'manual',
    },
  };
}

function insertTxn(db: Database, userId: string, d: TxnDraft, extra: { walletId?: string | null; externalRef?: string | null } = {}): string {
  const id = newId('ctx');
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO crypto_txns (id, user_id, date, kind, asset, amount, nzd_value, price_source, fee_nzd, to_asset, to_amount, wallet_id, external_ref, counterparty, notes, taxable_on_receipt, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, d.date, d.kind, d.asset, d.amount, d.nzdValue, d.priceSource ?? 'manual', d.feeNzd, d.toAsset, d.toAmount, extra.walletId ?? null, extra.externalRef ?? null, d.counterparty, d.notes, d.taxableOnReceipt ? 1 : 0, now, now],
  );
  return id;
}

export function createTxn(db: Database, userId: string, body: unknown): Result<CryptoTxn> {
  if (!isPro(db, userId)) return PRO_REQUIRED();
  const p = parseTxn(body);
  if (!p.ok) return fail(400, p.error);
  const id = insertTxn(db, userId, p.value);
  return { ok: true, value: present(queryOne<TxnRow>(db, `SELECT * FROM crypto_txns WHERE id = ?`, [id])!) };
}

export function updateTxn(db: Database, userId: string, id: string, body: unknown): Result<CryptoTxn> {
  if (!isPro(db, userId)) return PRO_REQUIRED();
  if (!queryOne(db, `SELECT 1 FROM crypto_txns WHERE id = ? AND user_id = ?`, [id, userId])) return fail(404, 'Transaction not found');
  const p = parseTxn(body);
  if (!p.ok) return fail(400, p.error);
  const d = p.value;
  run(
    db,
    `UPDATE crypto_txns SET date=?, kind=?, asset=?, amount=?, nzd_value=?, price_source=?, fee_nzd=?, to_asset=?, to_amount=?, counterparty=?, notes=?, taxable_on_receipt=?, updated_at=? WHERE id=? AND user_id=?`,
    [d.date, d.kind, d.asset, d.amount, d.nzdValue, d.priceSource ?? 'manual', d.feeNzd, d.toAsset, d.toAmount, d.counterparty, d.notes, d.taxableOnReceipt ? 1 : 0, new Date().toISOString(), id, userId],
  );
  return { ok: true, value: present(queryOne<TxnRow>(db, `SELECT * FROM crypto_txns WHERE id = ?`, [id])!) };
}

/** Removes the ledger row only. An imported transfer stays remembered, so it isn't offered again. */
export function deleteTxn(db: Database, userId: string, id: string): Result<{ ok: true }> {
  if (!isPro(db, userId)) return PRO_REQUIRED();
  if (!queryOne(db, `SELECT 1 FROM crypto_txns WHERE id = ? AND user_id = ?`, [id, userId])) return fail(404, 'Transaction not found');
  run(db, `DELETE FROM crypto_txns WHERE id = ? AND user_id = ?`, [id, userId]);
  return { ok: true, value: { ok: true } };
}

export function costMethodOf(db: Database, userId: string): CostMethod {
  return queryOne<{ cost_method: string }>(db, `SELECT cost_method FROM crypto_settings WHERE user_id = ?`, [userId])?.cost_method === 'wac' ? 'wac' : 'fifo';
}

export function setCostMethod(db: Database, userId: string, body: unknown): Result<{ costMethod: CostMethod }> {
  if (!isPro(db, userId)) return PRO_REQUIRED();
  const m = (body as { costMethod?: unknown } | null)?.costMethod;
  if (m !== 'fifo' && m !== 'wac') return fail(400, 'Choose FIFO or weighted average');
  run(
    db,
    `INSERT INTO crypto_settings (user_id, cost_method, updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET cost_method = excluded.cost_method, updated_at = excluded.updated_at`,
    [userId, m, new Date().toISOString()],
  );
  return { ok: true, value: { costMethod: m } };
}

/** A price for a ledger form (asset, date). */
export async function lookupPrice(db: Database, userId: string, asset: unknown, date: unknown): Promise<Result<{ priceNzd: number | null; source: string | null; priceDate: string | null; reason: string | null }>> {
  if (!isPro(db, userId)) return PRO_REQUIRED();
  const a = assetCode(asset);
  if (!a || !isYmd(date)) return fail(400, 'Asset and date are required');
  const r = await historicalPriceNzd(a, date as string);
  return { ok: true, value: r.ok ? { priceNzd: r.priceNzd, source: r.source, priceDate: r.priceDate, reason: null } : { priceNzd: null, source: null, priceDate: null, reason: r.reason } };
}

// ---------------------------------------------------------------- summary

export type CryptoSummary = {
  costMethod: CostMethod;
  taxYear: number;
  years: { startYear: number; label: string }[];
  year: ReturnType<typeof yearSummary>;
  positions: { asset: string; quantity: number; costNzd: number; avgCostNzd: number | null; costIncomplete: boolean; priceNzd: number | null; valueNzd: number | null; unrealisedNzd: number | null; priceStatus: string }[];
  unrealisedNzd: number;
  disposals: { txnId: string; date: string; asset: string; amount: number; proceedsNzd: number; costNzd: number; gainNzd: number; shortfall: number }[];
  income: { txnId: string; date: string; asset: string; kind: CryptoTxnKind; amount: number; nzdValue: number }[];
  missingValue: number;
  shortfalls: string[];
  txns: CryptoTxn[];
  defi: DefiView;
  wallets: { id: string; name: string; network: string }[];
};

export type PriceFn = (asset: string) => Promise<{ price: number | null; status: string }>;

export async function cryptoSummary(db: Database, userId: string, yearRaw: unknown, priceOf: PriceFn): Promise<Result<CryptoSummary>> {
  if (!isPro(db, userId)) return PRO_REQUIRED();
  const rows = queryAll<TxnRow>(db, `SELECT * FROM crypto_txns WHERE user_id = ? ORDER BY date, created_at`, [userId]);
  const txns = rows.map(present);
  const method = costMethodOf(db, userId);
  const ledger: LedgerTxn[] = rows.map((r) => ({ id: r.id, date: r.date, kind: r.kind, asset: r.asset, amount: Number(r.amount), nzdValue: r.nzd_value == null ? null : Number(r.nzd_value), feeNzd: Number(r.fee_nzd), toAsset: r.to_asset, toAmount: r.to_amount == null ? null : Number(r.to_amount), taxableOnReceipt: r.taxable_on_receipt === 1 }));
  const g = computeGains(ledger, method);
  const current = cryptoTaxYear(aucklandToday());
  const n = Number(yearRaw);
  const taxYear = Number.isInteger(n) && n > 2008 && n <= current ? n : current;
  const yearSet = new Set([current, taxYear, ...txns.map((t) => cryptoTaxYear(t.date))]);
  const positions = [];
  let unrealised = 0;
  for (const p of g.positions) {
    const q = await priceOf(p.asset).catch(() => ({ price: null, status: 'unavailable' }));
    const value = q.price != null ? roundMoney(q.price * p.quantity) : null;
    // No gain until the whole cost is known.
    const u = value != null && !p.costIncomplete ? roundMoney(value - p.costNzd) : null;
    if (u != null) unrealised += u;
    positions.push({ ...p, priceNzd: q.price, valueNzd: value, unrealisedNzd: u, priceStatus: q.status });
  }
  return {
    ok: true,
    value: {
      costMethod: method,
      taxYear,
      years: [...yearSet].sort((a, b) => b - a).map((y) => ({ startYear: y, label: `1 April ${y} – 31 March ${y + 1}` })),
      year: yearSummary(g, taxYear),
      positions,
      unrealisedNzd: roundMoney(unrealised),
      disposals: g.disposals.filter((d) => cryptoTaxYear(d.date) === taxYear),
      income: g.income.filter((i) => cryptoTaxYear(i.date) === taxYear),
      missingValue: g.missingValue.length,
      shortfalls: g.shortfalls,
      txns: [...txns].reverse(),
      defi: listDefi(db, userId),
      wallets: queryAll<{ id: string; name: string; network: string }>(db, `SELECT id, name, network FROM wallets WHERE user_id = ? ORDER BY created_at`, [userId]),
    },
  };
}

// ---------------------------------------------------------------- DeFi positions

type DefiRow = { id: string; protocol: string; kind: DefiKind; network: string; assets: string; value_nzd: number; valued_on: string | null; count_in_net_worth: number; notes: string };
export type DefiPosition = { id: string; protocol: string; kind: DefiKind; network: string; assets: string; valueNzd: number; valuedOn: string | null; countInNetWorth: boolean; notes: string };
export type DefiView = { positions: DefiPosition[]; netNzd: number };

export function listDefi(db: Database, userId: string): DefiView {
  const positions = queryAll<DefiRow>(db, `SELECT * FROM defi_positions WHERE user_id = ? ORDER BY created_at`, [userId]).map((r) => ({
    id: r.id,
    protocol: r.protocol,
    kind: r.kind,
    network: r.network,
    assets: r.assets,
    valueNzd: Number(r.value_nzd),
    valuedOn: r.valued_on,
    countInNetWorth: r.count_in_net_worth === 1,
    notes: r.notes,
  }));
  return { positions, netNzd: defiNet(positions) };
}

const defiNet = (ps: DefiPosition[]) => roundMoney(ps.filter((p) => p.countInNetWorth).reduce((s, p) => s + (p.kind === 'borrow' ? -p.valueNzd : p.valueNzd), 0));

/** For net worth: positions counted (borrowing as a minus), or null when none count. */
export function defiTotals(db: Database, userId: string): { netNzd: number; perPosition: { id: string; label: string; valueNzd: number }[] } | null {
  const ps = listDefi(db, userId).positions.filter((p) => p.countInNetWorth);
  if (!ps.length) return null;
  return { netNzd: defiNet(ps), perPosition: ps.map((p) => ({ id: p.id, label: `${p.protocol}${p.assets ? ` · ${p.assets}` : ''}`, valueNzd: p.kind === 'borrow' ? -p.valueNzd : p.valueNzd })) };
}

function parseDefi(raw: unknown): { ok: true; value: Omit<DefiPosition, 'id'> } | { ok: false; error: string } {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'Enter the position' };
  const protocol = typeof o.protocol === 'string' ? o.protocol.trim().slice(0, 60) : '';
  if (!protocol) return { ok: false, error: 'Enter the protocol, e.g. Aave' };
  if (!DEFI_KINDS.includes(o.kind as DefiKind)) return { ok: false, error: 'Choose the kind of position' };
  const value = money(o.valueNzd, 'Value');
  if (typeof value === 'string') return { ok: false, error: value };
  if (o.valuedOn != null && o.valuedOn !== '' && !isYmd(o.valuedOn)) return { ok: false, error: 'Valued on must be a date' };
  return {
    ok: true,
    value: {
      protocol,
      kind: o.kind as DefiKind,
      network: typeof o.network === 'string' ? o.network.trim().slice(0, 30) : '',
      assets: typeof o.assets === 'string' ? o.assets.trim().slice(0, 60) : '',
      valueNzd: roundMoney(value as number),
      valuedOn: isYmd(o.valuedOn) ? (o.valuedOn as string) : null,
      countInNetWorth: o.countInNetWorth !== false,
      notes: typeof o.notes === 'string' ? o.notes.trim().slice(0, 300) : '',
    },
  };
}

export function saveDefi(db: Database, userId: string, id: string | null, body: unknown): Result<DefiView> {
  if (!isPro(db, userId)) return PRO_REQUIRED();
  const p = parseDefi(body);
  if (!p.ok) return fail(400, p.error);
  const d = p.value;
  const now = new Date().toISOString();
  if (id) {
    if (!queryOne(db, `SELECT 1 FROM defi_positions WHERE id = ? AND user_id = ?`, [id, userId])) return fail(404, 'Position not found');
    run(db, `UPDATE defi_positions SET protocol=?, kind=?, network=?, assets=?, value_nzd=?, valued_on=?, count_in_net_worth=?, notes=?, updated_at=? WHERE id=? AND user_id=?`, [
      d.protocol, d.kind, d.network, d.assets, d.valueNzd, d.valuedOn, d.countInNetWorth ? 1 : 0, d.notes, now, id, userId,
    ]);
  } else {
    run(db, `INSERT INTO defi_positions (id, user_id, protocol, kind, network, assets, value_nzd, valued_on, count_in_net_worth, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [
      newId('defi'), userId, d.protocol, d.kind, d.network, d.assets, d.valueNzd, d.valuedOn, d.countInNetWorth ? 1 : 0, d.notes, now, now,
    ]);
  }
  return { ok: true, value: listDefi(db, userId) };
}

export function deleteDefi(db: Database, userId: string, id: string): Result<DefiView> {
  if (!isPro(db, userId)) return PRO_REQUIRED();
  if (!queryOne(db, `SELECT 1 FROM defi_positions WHERE id = ? AND user_id = ?`, [id, userId])) return fail(404, 'Position not found');
  run(db, `DELETE FROM defi_positions WHERE id = ? AND user_id = ?`, [id, userId]);
  return { ok: true, value: listDefi(db, userId) };
}

// ---------------------------------------------------------------- wallet import

export type ImportCandidate = ImportedTransfer & {
  network: string;
  suggestion: { kind: CryptoTxnKind; reason: string; confident: boolean; pairRef?: string };
  /** NZD value of the amount on the day, when found. */
  nzdValue: number | null;
  priceSource: string | null;
  priceNote: string | null;
};

type ChainSource = {
  native: (wallet: { network: WalletNetwork; address: string }) => Promise<{ transactions: { hash: string; timestamp: string | null; status: string; direction: 'in' | 'out' | 'self'; asset: { symbol: string; decimals: number }; amountRaw: string; feeRaw: string | null; counterparty: string | null }[] }>;
  tokens: (wallet: { network: WalletNetwork; address: string }) => Promise<{ hash: string; timestamp: string | null; status: string; direction: 'in' | 'out' | 'self'; asset: { symbol: string; decimals: number }; amountRaw: string; feeRaw: string | null; counterparty: string | null }[]>;
  price: (asset: string, date: string) => Promise<{ ok: true; priceNzd: number; source: string } | { ok: false; reason: string }>;
};
export const liveChainSource: ChainSource = {
  native: (w) => fetchWalletTransactions(w, { limit: 100 }),
  tokens: (w) => fetchWalletTokenTransfers(w, 100),
  price: (a, d) => historicalPriceNzd(a, d),
};

/** On-chain transfers from one of your wallets that aren't in the ledger yet, with suggested kinds and NZD values. */
export async function importPreview(db: Database, userId: string, walletId: string, source: ChainSource = liveChainSource): Promise<Result<{ wallet: { id: string; name: string; network: string }; candidates: ImportCandidate[]; skipped: number }>> {
  if (!isPro(db, userId)) return PRO_REQUIRED();
  const w = queryOne<{ id: string; name: string; network: WalletNetwork; address: string }>(db, `SELECT id, name, network, address FROM wallets WHERE id = ? AND user_id = ?`, [walletId, userId]);
  if (!w) return fail(404, 'Wallet not found');
  let native;
  let tokens;
  try {
    [native, tokens] = await Promise.all([source.native(w), source.tokens(w)]);
  } catch (err) {
    return fail(502, err instanceof Error ? err.message : 'Couldn’t read that wallet’s history right now');
  }
  const seen = new Set(queryAll<{ ref: string }>(db, `SELECT ref FROM crypto_import_refs WHERE user_id = ?`, [userId]).map((r) => r.ref));
  const nativeSymbol = NETWORK_CHAIN_INFO[w.network].nativeAsset.symbol;
  const items: (ImportedTransfer & { network: string })[] = [];
  let skipped = 0;
  for (const t of [...native.transactions, ...tokens]) {
    if (t.status !== 'confirmed' || !t.timestamp) continue;
    const date = t.timestamp.slice(0, 10);
    const amount = Number(formatUnits(t.amountRaw, t.asset.decimals));
    const ref = `${w.network}:${t.hash}`;
    if (amount > 0 && t.direction !== 'self') {
      if (seen.has(ref)) skipped += 1;
      else items.push({ ref, hash: t.hash.split(':')[0], date, direction: t.direction, asset: t.asset.symbol.toUpperCase(), amount, counterparty: t.counterparty, network: w.network });
    }
    // Gas this wallet paid is a small disposal of the native coin.
    if (t.feeRaw && /^\d+$/.test(t.feeRaw) && t.feeRaw !== '0') {
      const fee = Number(formatUnits(t.feeRaw, NETWORK_CHAIN_INFO[w.network].nativeAsset.decimals));
      const feeRef = `${ref}:fee`;
      if (fee > 0 && !seen.has(feeRef)) items.push({ ref: feeRef, hash: `${t.hash}:fee`, date, direction: 'out', asset: nativeSymbol, amount: fee, counterparty: null, network: w.network });
    }
  }
  const own = queryAll<{ address: string }>(db, `SELECT address FROM wallets WHERE user_id = ? AND id != ?`, [userId, w.id]).map((r) => r.address);
  const suggestions = suggestKinds(items, own);
  let lookups = 0;
  const candidates: ImportCandidate[] = [];
  for (const it of items.sort((a, b) => (a.date < b.date ? 1 : -1))) {
    let s = suggestions.get(it.ref)!;
    if (it.ref.endsWith(':fee')) s = { kind: 'fee', reason: 'Network fee this wallet paid', confident: true };
    let nzdValue: number | null = null;
    let priceSource: string | null = null;
    let priceNote: string | null = null;
    if ((NEEDS_VALUE.has(s.kind) || s.kind === 'fee') && lookups < MAX_IMPORT_PRICES) {
      lookups += 1;
      const p = await source.price(it.asset, it.date).catch((e: unknown) => ({ ok: false as const, reason: e instanceof Error ? e.message : 'lookup failed' }));
      if (p.ok) {
        nzdValue = roundMoney(p.priceNzd * it.amount);
        priceSource = p.source;
      } else priceNote = p.reason;
    } else if (NEEDS_VALUE.has(s.kind)) priceNote = 'Look up the value when you save, or enter it.';
    candidates.push({ ...it, suggestion: s, nzdValue, priceSource, priceNote });
  }
  return { ok: true, value: { wallet: { id: w.id, name: w.name, network: w.network }, candidates, skipped } };
}

/**
 * Save the transfers you've classified. Body: { walletId, items: [{ ref, kind | 'ignore', date,
 * asset, amount, nzdValue?, priceSource?, feeNzd?, toAsset?, toAmount?, pairRef? }] }.
 * A swap carries both legs (pairRef); both are remembered.
 */
export function importCommit(db: Database, userId: string, body: unknown): Result<{ added: number; ignored: number }> {
  if (!isPro(db, userId)) return PRO_REQUIRED();
  const b = (body ?? {}) as { walletId?: unknown; items?: unknown };
  const walletId = typeof b.walletId === 'string' ? b.walletId : '';
  if (!queryOne(db, `SELECT 1 FROM wallets WHERE id = ? AND user_id = ?`, [walletId, userId])) return fail(404, 'Wallet not found');
  if (!Array.isArray(b.items) || b.items.length === 0) return fail(400, 'Nothing to import');
  if (b.items.length > 500) return fail(400, 'Import up to 500 at a time');
  const now = new Date().toISOString();
  const seen = new Set(queryAll<{ ref: string }>(db, `SELECT ref FROM crypto_import_refs WHERE user_id = ?`, [userId]).map((r) => r.ref));
  const drafts: { draft: TxnDraft | null; refs: string[] }[] = [];
  for (const raw of b.items) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const ref = typeof o.ref === 'string' && /^[a-z]+:[\w:]{4,200}$/.test(o.ref) ? o.ref : null;
    if (!ref) return fail(400, 'Each item needs its reference');
    const pairRef = typeof o.pairRef === 'string' && /^[a-z]+:[\w:]{4,200}$/.test(o.pairRef) ? o.pairRef : null;
    const refs = pairRef ? [ref, pairRef] : [ref];
    if (refs.some((r) => seen.has(r))) continue;
    if (o.kind === 'ignore') {
      drafts.push({ draft: null, refs });
      continue;
    }
    const p = parseTxn(o);
    if (!p.ok) return fail(400, `${o.asset ?? 'Item'} on ${o.date ?? '?'}: ${p.error}`);
    drafts.push({ draft: p.value, refs });
  }
  let added = 0;
  let ignored = 0;
  for (const { draft, refs } of drafts) {
    if (draft) {
      insertTxn(db, userId, draft, { walletId, externalRef: refs[0] });
      added += 1;
    } else ignored += 1;
    for (const r of refs) run(db, `INSERT OR IGNORE INTO crypto_import_refs (user_id, ref, ignored, created_at) VALUES (?,?,?,?)`, [userId, r, draft ? 0 : 1, now]);
  }
  return { ok: true, value: { added, ignored } };
}
