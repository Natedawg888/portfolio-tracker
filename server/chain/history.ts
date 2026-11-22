/**
 * Wallet transaction history (KAN-43). The sync job stores each wallet's recent on-chain
 * transactions (native coin and tokens) in wallet_txns, so the Financial timeline (KAN-62) and the
 * wallet cards can show them without calling providers on page load.
 *
 * - Kinds: received, sent, transfer (between your own wallets, or to itself), staking (repeated
 *   payments from one sender that is never paid back, a guess), swap (sent and received in one tx).
 *   Same rules as the Pro ledger import (suggestKinds), so the two agree.
 * - Deduped on re-sync by (wallet, tx hash, asset): a pending tx is updated when it confirms.
 * - Spam and unknown tokens (KAN-39) are stored but left out of what the API returns unless asked.
 * - History is fetched at most every HISTORY_EVERY_MS per wallet (providers rate-limit; Solana needs
 *   one call per transaction). A history failure never fails the balance sync.
 * Amounts are integer strings in the asset's smallest unit plus decimals, never floats.
 */
import type { Database } from 'sql.js';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import type { WalletNetwork } from '../lib/walletAddress.ts';
import { suggestKinds, type ImportedTransfer } from '../../src/lib/cryptoGains.ts';
import { formatUnits } from './networks.ts';
import { isHiddenClass, normaliseAsset } from './tokenRegistry.ts';
import type { ChainTransaction } from './types.ts';

export const HISTORY_EVERY_MS = 6 * 60 * 60 * 1000;
export const HISTORY_LIMIT = 25;

export type WalletTxnKind = 'received' | 'sent' | 'transfer' | 'staking' | 'swap';

export type WalletTxn = {
  id: string;
  walletId: string;
  network: WalletNetwork;
  hash: string;
  timestamp: string | null;
  status: 'confirmed' | 'pending' | 'failed';
  kind: WalletTxnKind;
  direction: 'in' | 'out' | 'self';
  symbol: string;
  contract: string | null;
  amountRaw: string;
  decimals: number;
  /** Human amount (exact decimal string). */
  amount: string;
  feeRaw: string | null;
  counterparty: string | null;
  hidden: boolean;
};

export type HistorySource = {
  native: (w: { network: WalletNetwork; address: string }) => Promise<{ transactions: ChainTransaction[] }>;
  tokens: (w: { network: WalletNetwork; address: string }) => Promise<ChainTransaction[]>;
};

type Row = {
  id: string;
  wallet_id: string;
  network: WalletNetwork;
  hash: string;
  ts: string | null;
  status: WalletTxn['status'];
  kind: WalletTxnKind;
  direction: WalletTxn['direction'];
  symbol: string;
  contract: string | null;
  amount_raw: string;
  decimals: number;
  fee_raw: string | null;
  counterparty: string | null;
  hidden: number;
};

const present = (r: Row): WalletTxn => ({
  id: r.id,
  walletId: r.wallet_id,
  network: r.network,
  hash: r.hash,
  timestamp: r.ts,
  status: r.status,
  kind: r.kind,
  direction: r.direction,
  symbol: r.symbol,
  contract: r.contract,
  amountRaw: r.amount_raw,
  decimals: Number(r.decimals),
  amount: formatUnits(r.amount_raw, Number(r.decimals)),
  feeRaw: r.fee_raw,
  counterparty: r.counterparty,
  hidden: r.hidden === 1,
});

/** Map ledger-import suggestions to timeline kinds. */
function kindFor(suggested: string, direction: 'in' | 'out' | 'self'): WalletTxnKind {
  if (direction === 'self' || suggested === 'transfer_in' || suggested === 'transfer_out') return 'transfer';
  if (suggested === 'staking_reward') return 'staking';
  if (suggested === 'swap') return 'swap';
  return direction === 'in' ? 'received' : 'sent';
}

/** Fetch and store one wallet's recent history. Returns how many rows were new. */
export async function importWalletHistory(
  db: Database,
  wallet: { id: string; userId: string; network: WalletNetwork; address: string },
  source: HistorySource,
): Promise<{ added: number; updated: number }> {
  const [native, tokens] = await Promise.all([source.native(wallet), source.tokens(wallet)]);
  const all = [...native.transactions, ...tokens].filter((t) => t.hash && /^\d+$/.test(t.amountRaw));
  const own = queryAll<{ address: string }>(db, `SELECT address FROM wallets WHERE user_id = ? AND id != ?`, [wallet.userId, wallet.id]).map((r) => r.address);
  const items: ImportedTransfer[] = all.map((t, i) => ({
    ref: String(i),
    hash: t.hash,
    date: (t.timestamp ?? '').slice(0, 10),
    direction: t.direction,
    asset: t.asset.symbol.toUpperCase(),
    amount: Number(formatUnits(t.amountRaw, t.asset.decimals)),
    counterparty: t.counterparty,
  }));
  const suggestions = suggestKinds(items, own);
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;
  all.forEach((t, i) => {
    const norm = normaliseAsset(wallet.network, t.asset);
    const assetKey = (t.asset.contract ?? t.asset.symbol).toLowerCase();
    const kind = kindFor(suggestions.get(String(i))?.kind ?? '', t.direction);
    const existing = queryOne<{ id: string; status: string }>(db, `SELECT id, status FROM wallet_txns WHERE wallet_id = ? AND hash = ? AND asset_key = ?`, [wallet.id, t.hash, assetKey]);
    if (existing) {
      if (existing.status !== t.status) {
        run(db, `UPDATE wallet_txns SET status = ?, ts = ?, updated_at = ? WHERE id = ?`, [t.status, t.timestamp, now, existing.id]);
        updated++;
      }
      return;
    }
    run(
      db,
      `INSERT INTO wallet_txns (id, user_id, wallet_id, network, hash, asset_key, ts, status, kind, direction, symbol, contract, amount_raw, decimals, fee_raw, counterparty, hidden, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [newId('wtx'), wallet.userId, wallet.id, wallet.network, t.hash, assetKey, t.timestamp, t.status, kind, t.direction, norm.asset.symbol, t.asset.contract, t.amountRaw, t.asset.decimals, t.feeRaw, t.counterparty, isHiddenClass(norm.tokenClass) ? 1 : 0, now, now],
    );
    added++;
  });
  run(db, `UPDATE wallets SET history_synced_at = ? WHERE id = ?`, [now, wallet.id]);
  return { added, updated };
}

/** True when the wallet's history is due for a refresh. */
export function historyDue(db: Database, walletId: string, nowMs = Date.now()): boolean {
  const at = queryOne<{ history_synced_at: string | null }>(db, `SELECT history_synced_at FROM wallets WHERE id = ?`, [walletId])?.history_synced_at;
  return !at || nowMs - Date.parse(at) >= HISTORY_EVERY_MS;
}

/** The user's stored wallet transactions, newest first. Hidden tokens left out unless asked. */
export function listWalletTxns(
  db: Database,
  userId: string,
  opts: { walletId?: string | null; from?: string | null; to?: string | null; showHidden?: boolean; limit?: number } = {},
): WalletTxn[] {
  const where = ['user_id = ?'];
  const args: (string | number)[] = [userId];
  if (opts.walletId) {
    where.push('wallet_id = ?');
    args.push(opts.walletId);
  }
  if (opts.from) {
    where.push('ts >= ?');
    args.push(`${opts.from}T00:00:00.000Z`);
  }
  if (opts.to) {
    where.push('ts <= ?');
    args.push(`${opts.to}T23:59:59.999Z`);
  }
  if (!opts.showHidden) where.push('hidden = 0');
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 200)), 1000);
  return queryAll<Row>(db, `SELECT * FROM wallet_txns WHERE ${where.join(' AND ')} ORDER BY COALESCE(ts, '9999') DESC LIMIT ${limit}`, args).map(present);
}
