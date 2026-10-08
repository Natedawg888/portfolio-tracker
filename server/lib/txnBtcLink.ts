/**
 * Optional link: spending transactions ↔ BTC crypto holdings.
 * Explicit per-txn only (no category auto-link). Never invent BTC/NZD prices.
 */
import type { Database } from 'sql.js';
import { queryAll, queryOne, run } from '../db/index.ts';
import { fetchBtcFx } from '../quotes/btc.ts';

export type BtcHoldingOption = {
  id: string;
  name: string;
  asset: string;
  amount: number;
  source: string | null;
  notes: string | null;
};

export type TxnBtcLinkMeta = {
  affectsBtc: boolean;
  btcHoldingId: string | null;
  btcDeltaApplied: number | null;
  btcNzdRate: number | null;
  btcAppliedAt: string | null;
};

function isBtcAsset(asset: unknown): boolean {
  const a = String(asset ?? '').trim().toUpperCase();
  return a === 'BTC' || a === 'XBT' || a === 'BITCOIN';
}

/** List crypto holdings with asset BTC (or XBT). */
export function listBtcHoldings(db: Database, userId?: string | null): BtcHoldingOption[] {
  const rows = queryAll(
    db,
    userId
      ? `SELECT id, name, asset, amount, source, notes
     FROM holdings
     WHERE asset_class = 'crypto' AND user_id = ?
     ORDER BY name`
      : `SELECT id, name, asset, amount, source, notes
     FROM holdings
     WHERE asset_class = 'crypto'
     ORDER BY name`,
    userId ? [userId] : [],
  );
  return rows
    .filter((r) => isBtcAsset(r.asset))
    .map((r) => ({
      id: String(r.id),
      name: String(r.name ?? 'BTC'),
      asset: String(r.asset ?? 'BTC'),
      amount: Number(r.amount ?? 0),
      source: (r.source as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
    }));
}

/**
 * Prefer manual / Nexo BTC line when multiple exist; else largest amount; else first by name.
 */
export function pickPrimaryBtcHolding(
  holdings: BtcHoldingOption[],
  preferredId?: string | null,
): BtcHoldingOption | null {
  if (!holdings.length) return null;
  if (preferredId) {
    const hit = holdings.find((h) => h.id === preferredId);
    if (hit) return hit;
  }
  const score = (h: BtcHoldingOption): number => {
    const hay = `${h.name} ${h.source ?? ''} ${h.notes ?? ''}`.toLowerCase();
    let s = 0;
    if (/nexo/.test(hay)) s += 100;
    if (/manual/.test(hay) || h.source === 'manual') s += 50;
    if (Number.isFinite(h.amount)) s += Math.min(Math.abs(h.amount), 10);
    return s;
  };
  return [...holdings].sort((a, b) => {
    const d = score(b) - score(a);
    if (d !== 0) return d;
    return a.name.localeCompare(b.name);
  })[0]!;
}

export function readTxnBtcMeta(row: Record<string, unknown>): TxnBtcLinkMeta {
  const rawAffects = row.affects_btc;
  const affectsBtc =
    rawAffects === 1 || rawAffects === true || rawAffects === '1';
  const delta =
    row.btc_delta_applied == null || row.btc_delta_applied === ''
      ? null
      : Number(row.btc_delta_applied);
  const rate =
    row.btc_nzd_rate == null || row.btc_nzd_rate === ''
      ? null
      : Number(row.btc_nzd_rate);
  return {
    affectsBtc,
    btcHoldingId:
      typeof row.btc_holding_id === 'string' && row.btc_holding_id
        ? row.btc_holding_id
        : null,
    btcDeltaApplied: delta != null && Number.isFinite(delta) ? delta : null,
    btcNzdRate: rate != null && Number.isFinite(rate) && rate > 0 ? rate : null,
    btcAppliedAt:
      typeof row.btc_applied_at === 'string' && row.btc_applied_at
        ? row.btc_applied_at
        : null,
  };
}

/** Reverse a previously applied BTC delta on its holding (idempotent if none). */
export function reverseBtcDelta(db: Database, meta: TxnBtcLinkMeta, userId: string): void {
  if (
    meta.btcDeltaApplied == null ||
    meta.btcDeltaApplied === 0 ||
    !meta.btcHoldingId
  ) {
    return;
  }
  const holding = queryOne(
    db,
    `SELECT id, amount FROM holdings WHERE id=? AND asset_class='crypto' AND user_id=?`,
    [meta.btcHoldingId, userId],
  );
  if (!holding) return;
  const current = Number(holding.amount ?? 0);
  const next = current - meta.btcDeltaApplied;
  const now = new Date().toISOString();
  run(
    db,
    `UPDATE holdings SET amount=?, updated_at=? WHERE id=? AND user_id=?`,
    [next, now, meta.btcHoldingId, userId],
  );
}

export type ApplyBtcLinkResult =
  | {
      ok: true;
      meta: TxnBtcLinkMeta;
      holdingName: string;
      btcNzd: number;
      source: string;
    }
  | { ok: false; error: string; status: number };

/**
 * Apply BTC holding adjustment for a txn that opts in (affectsBtc).
 * Debit/negative NZD → reduce BTC; credit/positive → increase BTC.
 * Requires a live/cached BTC NZD quote — never invents.
 */
export async function applyBtcLink(
  db: Database,
  opts: {
    /** Only this user's holdings are listed or changed. */
    userId: string;
    affectsBtc: boolean;
    amountNzd: number;
    kind: string;
    btcHoldingId?: string | null;
  },
): Promise<ApplyBtcLinkResult> {
  if (!opts.affectsBtc) {
    return {
      ok: true,
      meta: {
        affectsBtc: false,
        btcHoldingId: null,
        btcDeltaApplied: null,
        btcNzdRate: null,
        btcAppliedAt: null,
      },
      holdingName: '',
      btcNzd: 0,
      source: '',
    };
  }

  const absNzd = Math.abs(Number(opts.amountNzd));
  if (!Number.isFinite(absNzd) || absNzd === 0) {
    return {
      ok: false,
      error: 'Non-zero NZD amount required when Use BTC is on',
      status: 400,
    };
  }

  const fx = await fetchBtcFx();
  if (fx.status !== 'ok' || fx.btcNzd == null || !(fx.btcNzd > 0)) {
    return {
      ok: false,
      error:
        fx.message ??
        'BTC/NZD quote unavailable — cannot adjust BTC holding (never invent prices)',
      status: 503,
    };
  }

  const holdings = listBtcHoldings(db, opts.userId);
  if (!holdings.length) {
    return {
      ok: false,
      error: 'No BTC crypto holding found — add a BTC holding first',
      status: 400,
    };
  }

  const chosen = pickPrimaryBtcHolding(holdings, opts.btcHoldingId ?? null);
  if (!chosen) {
    return {
      ok: false,
      error: 'Could not resolve a BTC holding',
      status: 400,
    };
  }
  if (opts.btcHoldingId && chosen.id !== opts.btcHoldingId) {
    return {
      ok: false,
      error: 'Unknown or non-BTC btcHoldingId',
      status: 400,
    };
  }

  const btcQty = absNzd / fx.btcNzd;
  // Spend (debit / negative amount) reduces BTC; income (credit) increases.
  const isDebit =
    opts.kind === 'debit' ||
    (opts.kind !== 'credit' && Number(opts.amountNzd) < 0);
  const delta = isDebit ? -btcQty : btcQty;

  const now = new Date().toISOString();
  const nextAmount = Number(chosen.amount) + delta;
  run(
    db,
    `UPDATE holdings SET amount=?, updated_at=? WHERE id=? AND user_id=?`,
    [nextAmount, now, chosen.id, opts.userId],
  );

  return {
    ok: true,
    meta: {
      affectsBtc: true,
      btcHoldingId: chosen.id,
      btcDeltaApplied: delta,
      btcNzdRate: fx.btcNzd,
      btcAppliedAt: now,
    },
    holdingName: chosen.name,
    btcNzd: fx.btcNzd,
    source: fx.source,
  };
}


/** Re-apply a previously stored signed BTC delta (used to undo a failed re-link). */
export function restoreStoredBtcDelta(db: Database, meta: TxnBtcLinkMeta, userId: string): void {
  if (
    meta.btcDeltaApplied == null ||
    meta.btcDeltaApplied === 0 ||
    !meta.btcHoldingId
  ) {
    return;
  }
  const holding = queryOne(
    db,
    `SELECT id, amount FROM holdings WHERE id=? AND asset_class='crypto' AND user_id=?`,
    [meta.btcHoldingId, userId],
  );
  if (!holding) return;
  const current = Number(holding.amount ?? 0);
  const next = current + meta.btcDeltaApplied;
  const now = new Date().toISOString();
  run(
    db,
    `UPDATE holdings SET amount=?, updated_at=? WHERE id=? AND user_id=?`,
    [next, now, meta.btcHoldingId, userId],
  );
}
/** Persist BTC link columns on one of the user's transaction rows. */
export function writeTxnBtcColumns(
  db: Database,
  txnId: string,
  meta: TxnBtcLinkMeta,
  userId: string,
): void {
  run(
    db,
    `UPDATE transactions SET
       affects_btc=?,
       btc_holding_id=?,
       btc_delta_applied=?,
       btc_nzd_rate=?,
       btc_applied_at=?
     WHERE id=? AND user_id=?`,
    [
      meta.affectsBtc ? 1 : 0,
      meta.btcHoldingId,
      meta.btcDeltaApplied,
      meta.btcNzdRate,
      meta.btcAppliedAt,
      txnId,
      userId,
    ],
  );
}

/** Clear BTC link metadata after reverse (keep affects_btc flag as stored by caller). */
export function clearTxnBtcApplied(db: Database, txnId: string, userId: string): void {
  run(
    db,
    `UPDATE transactions SET
       btc_holding_id=NULL,
       btc_delta_applied=NULL,
       btc_nzd_rate=NULL,
       btc_applied_at=NULL
     WHERE id=? AND user_id=?`,
    [txnId, userId],
  );
}
