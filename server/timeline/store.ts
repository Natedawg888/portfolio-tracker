/**
 * Financial timeline (KAN-62): one chronological list of the signed-in user's money events.
 *
 * Sources (all scoped to user_id, real rows only):
 * - bank: transactions (bank sync, CSV, manual) with their category, NZD.
 * - crypto: on-chain wallet transactions stored by the sync job (wallet_txns, KAN-43; spam and
 *   unknown tokens left out) and the Pro crypto ledger (crypto_txns), in coin units.
 * - dividend: paid dividend events, gross, in their currency.
 * - milestone: the first day net worth (daily / manual snapshots) reached each new level:
 *   every $10,000 up to $100,000, then every $50,000 up to $1m, then every $250,000.
 * Filterable by type and date range (default: the last 90 days), newest first.
 */
import type { Database } from 'sql.js';
import { queryAll, queryOne } from '../db/index.ts';
import { formatUnits } from '../chain/networks.ts';

export const TIMELINE_TYPES = ['bank', 'crypto', 'dividend', 'milestone'] as const;
export type TimelineType = (typeof TIMELINE_TYPES)[number];

export type TimelineEvent = {
  id: string;
  /** YYYY-MM-DD (Pacific/Auckland for snapshots; as stored for the rest). */
  date: string;
  type: TimelineType;
  title: string;
  detail: string | null;
  /** NZD when the event has one (bank, milestone, ledger with a value). */
  amountNzd: number | null;
  /** Units for crypto and foreign dividends, e.g. "0.5 ETH", "USD 12.40". */
  amountText: string | null;
  direction: 'in' | 'out' | null;
  /** Where to open it in the app. */
  link: string | null;
};

export type TimelineQuery = { from: string; to: string; types: TimelineType[]; limit: number };

const MAX_LIMIT = 1000;

function tableExists(db: Database, name: string): boolean {
  return Boolean(queryOne(db, `SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?`, [name]));
}

/** Net-worth levels that count as milestones, ascending, up to `max`. */
export function milestoneLevels(max: number): number[] {
  const out: number[] = [];
  for (let v = 10_000; v <= Math.min(max, 100_000); v += 10_000) out.push(v);
  for (let v = 150_000; v <= Math.min(max, 1_000_000); v += 50_000) out.push(v);
  for (let v = 1_250_000; v <= max; v += 250_000) out.push(v);
  return out;
}

/** First date each level was reached, from snapshots in time order (a level is only counted once). */
export function netWorthMilestones(points: readonly { date: string; totalNzd: number }[]): { date: string; level: number }[] {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const reached = new Set<number>();
  const out: { date: string; level: number }[] = [];
  for (const p of sorted) {
    for (const level of milestoneLevels(p.totalNzd)) {
      if (reached.has(level)) continue;
      reached.add(level);
      out.push({ date: p.date, level });
    }
  }
  return out;
}

const nzd = (n: number) => `$${Math.round(n).toLocaleString('en-NZ')}`;
const aucklandDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });

export function timelineEvents(db: Database, userId: string, q: TimelineQuery): TimelineEvent[] {
  const want = new Set(q.types);
  const events: TimelineEvent[] = [];

  if (want.has('bank')) {
    const rows = queryAll<{ id: string; date: string; description: string; merchant: string | null; amount: number; category: string | null; account: string | null }>(
      db,
      `SELECT t.id, t.date, t.description, t.merchant, t.amount, c.name AS category, a.name AS account
       FROM transactions t
       LEFT JOIN budget_categories c ON c.id = t.category_id AND c.user_id = t.user_id
       LEFT JOIN bank_accounts a ON a.id = t.account_id AND a.user_id = t.user_id
       WHERE t.user_id = ? AND t.date >= ? AND t.date <= ?`,
      [userId, q.from, q.to],
    );
    for (const r of rows) {
      const amount = Number(r.amount);
      events.push({
        id: `bank:${r.id}`,
        date: r.date.slice(0, 10),
        type: 'bank',
        title: (r.merchant?.trim() || r.description?.trim() || 'Transaction').slice(0, 120),
        detail: [r.category, r.account].filter(Boolean).join(' · ') || null,
        amountNzd: Math.round(amount * 100) / 100,
        amountText: null,
        direction: amount < 0 ? 'out' : 'in',
        link: '/spending',
      });
    }
  }

  if (want.has('crypto')) {
    if (tableExists(db, 'wallet_txns')) {
      const rows = queryAll<{ id: string; ts: string | null; kind: string; direction: 'in' | 'out' | 'self'; symbol: string; amount_raw: string; decimals: number; status: string; network: string; wallet: string | null }>(
        db,
        `SELECT w.id, w.ts, w.kind, w.direction, w.symbol, w.amount_raw, w.decimals, w.status, w.network, wl.name AS wallet
         FROM wallet_txns w LEFT JOIN wallets wl ON wl.id = w.wallet_id AND wl.user_id = w.user_id
         WHERE w.user_id = ? AND w.hidden = 0 AND w.ts IS NOT NULL AND w.ts >= ? AND w.ts <= ?`,
        [userId, `${q.from}T00:00:00.000Z`, `${q.to}T23:59:59.999Z`],
      );
      const verb: Record<string, string> = { received: 'Received', sent: 'Sent', transfer: 'Moved between your wallets', staking: 'Staking reward', swap: 'Swap' };
      for (const r of rows) {
        events.push({
          id: `wallet:${r.id}`,
          date: aucklandDay(r.ts!),
          type: 'crypto',
          title: `${verb[r.kind] ?? 'Transaction'}: ${formatUnits(r.amount_raw, Number(r.decimals))} ${r.symbol}`,
          detail: [r.wallet, r.status === 'pending' ? 'pending' : r.status === 'failed' ? 'failed' : null].filter(Boolean).join(' · ') || null,
          amountNzd: null,
          amountText: `${formatUnits(r.amount_raw, Number(r.decimals))} ${r.symbol}`,
          direction: r.direction === 'self' ? null : r.direction,
          link: '/portfolio',
        });
      }
    }
    if (tableExists(db, 'crypto_txns')) {
      const rows = queryAll<{ id: string; date: string; kind: string; asset: string; amount: number; nzd_value: number | null; external_ref: string | null }>(
        db,
        `SELECT id, date, kind, asset, amount, nzd_value, external_ref FROM crypto_txns WHERE user_id = ? AND date >= ? AND date <= ?`,
        [userId, q.from, q.to],
      );
      const outKinds = new Set(['sell', 'spend', 'gift_out', 'fee', 'transfer_out', 'defi_deposit']);
      for (const r of rows) {
        // On-chain imports are already in the wallet history; show only what the ledger adds.
        if (r.external_ref && tableExists(db, 'wallet_txns')) continue;
        events.push({
          id: `ledger:${r.id}`,
          date: r.date,
          type: 'crypto',
          title: `${r.kind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}: ${Number(r.amount).toLocaleString('en-NZ', { maximumFractionDigits: 8 })} ${r.asset}`,
          detail: 'Crypto ledger',
          amountNzd: r.nzd_value == null ? null : Math.round(Number(r.nzd_value) * 100) / 100,
          amountText: `${Number(r.amount).toLocaleString('en-NZ', { maximumFractionDigits: 8 })} ${r.asset}`,
          direction: outKinds.has(r.kind) ? 'out' : 'in',
          link: '/crypto',
        });
      }
    }
  }

  if (want.has('dividend')) {
    const rows = queryAll<{ id: string; payment_date: string; company_name: string; symbol: string | null; gross_dividend: number; currency: string | null; fx_rate_to_nzd: number | null }>(
      db,
      `SELECT id, payment_date, company_name, symbol, gross_dividend, currency, fx_rate_to_nzd FROM dividend_events
       WHERE user_id = ? AND payment_date >= ? AND payment_date <= ?`,
      [userId, q.from, q.to],
    );
    for (const r of rows) {
      const cur = (r.currency ?? 'NZD').toUpperCase();
      const gross = Number(r.gross_dividend);
      const nzdValue = cur === 'NZD' ? gross : r.fx_rate_to_nzd && r.fx_rate_to_nzd > 0 ? gross * r.fx_rate_to_nzd : null;
      events.push({
        id: `dividend:${r.id}`,
        date: r.payment_date,
        type: 'dividend',
        title: `Dividend: ${r.company_name}${r.symbol ? ` (${r.symbol})` : ''}`,
        detail: 'Gross',
        amountNzd: nzdValue == null ? null : Math.round(nzdValue * 100) / 100,
        amountText: cur === 'NZD' ? null : `${cur} ${gross.toFixed(2)}`,
        direction: 'in',
        link: '/portfolio',
      });
    }
  }

  if (want.has('milestone')) {
    const snaps = queryAll<{ taken_at: string; total_nzd: number }>(db, `SELECT taken_at, total_nzd FROM valuation_snapshots WHERE user_id = ? ORDER BY taken_at`, [userId]);
    const points = snaps.map((s) => ({ date: aucklandDay(s.taken_at), totalNzd: Number(s.total_nzd) })).filter((p) => Number.isFinite(p.totalNzd));
    for (const m of netWorthMilestones(points)) {
      if (m.date < q.from || m.date > q.to) continue;
      events.push({
        id: `milestone:${m.level}`,
        date: m.date,
        type: 'milestone',
        title: `Net worth reached ${nzd(m.level)}`,
        detail: 'From your net worth history',
        amountNzd: m.level,
        amountText: null,
        direction: null,
        link: '/yearly',
      });
    }
  }

  const order: Record<TimelineType, number> = { milestone: 0, dividend: 1, crypto: 2, bank: 3 };
  return events
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : order[a.type] - order[b.type]))
    .slice(0, Math.min(Math.max(1, q.limit), MAX_LIMIT));
}

/** Parse ?from&to&types&limit with defaults: the last 90 days, every type, 500 events. */
export function parseTimelineQuery(query: Record<string, unknown>, today: string): { ok: true; value: TimelineQuery } | { ok: false; error: string } {
  const ymd = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const back = new Date(`${today}T00:00:00Z`);
  back.setUTCDate(back.getUTCDate() - 90);
  const from = query.from == null || query.from === '' ? back.toISOString().slice(0, 10) : ymd(query.from);
  const to = query.to == null || query.to === '' ? today : ymd(query.to);
  if (!from || !to) return { ok: false, error: 'from and to must be YYYY-MM-DD' };
  if (from > to) return { ok: false, error: 'from must be on or before to' };
  let types: TimelineType[] = [...TIMELINE_TYPES];
  if (typeof query.types === 'string' && query.types.trim()) {
    const asked = query.types.split(',').map((t) => t.trim());
    if (!asked.every((t) => (TIMELINE_TYPES as readonly string[]).includes(t))) return { ok: false, error: `types must be from ${TIMELINE_TYPES.join(', ')}` };
    types = asked as TimelineType[];
  }
  const n = Number(query.limit);
  return { ok: true, value: { from, to, types, limit: Number.isFinite(n) && n > 0 ? Math.floor(n) : 500 } };
}
