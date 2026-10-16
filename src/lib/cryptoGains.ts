/**
 * Crypto cost basis and gains (KAN-47). Pure: works only on the ledger it's given.
 *
 * IRD (Calculating cryptoasset income): the cost of cryptoassets disposed of can be worked out
 * with first-in first-out (FIFO) or weighted average cost (WAC); income = sale price − purchase
 * cost − transaction fees; crypto received as payment (mining, staking here) costs its value when
 * received; unrealised gains aren't taxable. This is an estimate for records, not tax advice.
 *
 * What each kind does to the asset's holdings:
 *   buy, swap (receive leg), staking_reward, airdrop, income → acquire at their NZD value (+ fee on buys)
 *   sell, swap (give leg), spend, gift_out, fee            → dispose (sell / spend: proceeds = NZD
 *       value − fee; gift and fee: proceeds = NZD value, usually 0 for a fee)
 *   transfer_in / transfer_out (between your own wallets), defi_deposit / defi_withdraw
 *                                                          → no change (still yours)
 * Staking rewards, airdrops and income are also counted as income at their NZD value.
 */

export const CRYPTO_TXN_KINDS = [
  'buy',
  'sell',
  'swap',
  'transfer_in',
  'transfer_out',
  'staking_reward',
  'airdrop',
  'income',
  'spend',
  'gift_out',
  'fee',
  'defi_deposit',
  'defi_withdraw',
] as const;
export type CryptoTxnKind = (typeof CRYPTO_TXN_KINDS)[number];

export const KIND_LABEL: Record<CryptoTxnKind, string> = {
  buy: 'Buy',
  sell: 'Sell',
  swap: 'Swap',
  transfer_in: 'Transfer in (own wallet)',
  transfer_out: 'Transfer out (own wallet)',
  staking_reward: 'Staking reward',
  airdrop: 'Airdrop',
  income: 'Paid in crypto',
  spend: 'Spent',
  gift_out: 'Gift sent',
  fee: 'Network fee',
  defi_deposit: 'DeFi deposit',
  defi_withdraw: 'DeFi withdrawal',
};

/** Kinds that need an NZD value to work out cost or proceeds. */
export const NEEDS_VALUE: ReadonlySet<CryptoTxnKind> = new Set(['buy', 'sell', 'swap', 'staking_reward', 'airdrop', 'income', 'spend', 'gift_out']);
const ACQUIRE: ReadonlySet<CryptoTxnKind> = new Set(['buy', 'staking_reward', 'airdrop', 'income']);
const DISPOSE: ReadonlySet<CryptoTxnKind> = new Set(['sell', 'spend', 'gift_out', 'fee']);
const INCOME: ReadonlySet<CryptoTxnKind> = new Set(['staking_reward', 'airdrop', 'income']);

export type CostMethod = 'fifo' | 'wac';

export type LedgerTxn = {
  id: string;
  /** 'YYYY-MM-DD' */
  date: string;
  kind: CryptoTxnKind;
  asset: string;
  amount: number;
  /** NZD value of `amount` at the time (for a swap: of what was given). null = not known yet. */
  nzdValue: number | null;
  feeNzd: number;
  /** Swap only: what was received. */
  toAsset?: string | null;
  toAmount?: number | null;
};

export type Disposal = {
  txnId: string;
  date: string;
  asset: string;
  amount: number;
  proceedsNzd: number;
  costNzd: number;
  gainNzd: number;
  /** Units disposed beyond what the ledger shows you held (cost counted as 0 for them). */
  shortfall: number;
};

export type AssetPosition = {
  asset: string;
  quantity: number;
  costNzd: number;
  /** Cost per unit (WAC pool, or FIFO lots averaged). */
  avgCostNzd: number | null;
  /** Some of it came in without an NZD value, so its cost (and any gain) isn't known yet. */
  costIncomplete: boolean;
};

export type GainsResult = {
  method: CostMethod;
  disposals: Disposal[];
  positions: AssetPosition[];
  /** Income at receipt (staking, airdrops, paid in crypto), by txn. */
  income: { txnId: string; date: string; asset: string; kind: CryptoTxnKind; amount: number; nzdValue: number }[];
  /** Txns that need an NZD value and don't have one (left out of the money figures). */
  missingValue: string[];
  /** Assets sold beyond what the ledger shows you held. */
  shortfalls: string[];
};

const EPS = 1e-12;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const up = (s: string) => s.trim().toUpperCase();

type Lot = { qty: number; cost: number };

export function computeGains(ledger: LedgerTxn[], method: CostMethod): GainsResult {
  const ordered = [...ledger].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const lots = new Map<string, Lot[]>();
  const pool = (asset: string) => {
    const k = up(asset);
    if (!lots.has(k)) lots.set(k, []);
    return lots.get(k)!;
  };
  const disposals: Disposal[] = [];
  const income: GainsResult['income'] = [];
  const missingValue: string[] = [];
  const shortfalls = new Set<string>();
  const incomplete = new Set<string>();

  const acquire = (asset: string, qty: number, cost: number) => {
    if (!(qty > 0)) return;
    const p = pool(asset);
    if (method === 'wac') {
      if (!p.length) p.push({ qty: 0, cost: 0 });
      p[0].qty += qty;
      p[0].cost += cost;
    } else {
      p.push({ qty, cost });
    }
  };
  /** Remove qty; returns the cost of what was removed and any shortfall. */
  const remove = (asset: string, qty: number): { cost: number; shortfall: number } => {
    const p = pool(asset);
    let left = qty;
    let cost = 0;
    while (left > EPS && p.length) {
      const lot = p[0];
      const take = Math.min(lot.qty, left);
      const part = lot.qty > EPS ? (lot.cost * take) / lot.qty : 0;
      cost += part;
      lot.qty -= take;
      lot.cost -= part;
      left -= take;
      if (lot.qty <= EPS) {
        if (method === 'wac') {
          lot.qty = 0;
          lot.cost = 0;
          break;
        }
        p.shift();
      }
    }
    return { cost, shortfall: left > EPS ? left : 0 };
  };

  for (const t of ordered) {
    const value = t.nzdValue;
    if (NEEDS_VALUE.has(t.kind) && value == null) {
      missingValue.push(t.id);
      // Still move the units so later quantities stay right; money figures skip this txn.
    }
    const fee = Math.max(0, t.feeNzd || 0);
    if (ACQUIRE.has(t.kind)) {
      if (value == null) incomplete.add(up(t.asset));
      acquire(t.asset, t.amount, (value ?? 0) + (t.kind === 'buy' ? fee : 0));
      if (INCOME.has(t.kind) && value != null) income.push({ txnId: t.id, date: t.date, asset: up(t.asset), kind: t.kind, amount: t.amount, nzdValue: r2(value) });
    } else if (DISPOSE.has(t.kind) || t.kind === 'swap') {
      const { cost, shortfall } = remove(t.asset, t.amount);
      if (shortfall > 0) shortfalls.add(up(t.asset));
      const proceeds = t.kind === 'fee' ? (value ?? 0) : (value ?? 0) - (t.kind === 'sell' || t.kind === 'spend' || t.kind === 'swap' ? fee : 0);
      if (value != null || t.kind === 'fee') {
        disposals.push({ txnId: t.id, date: t.date, asset: up(t.asset), amount: t.amount, proceedsNzd: r2(proceeds), costNzd: r2(cost), gainNzd: r2(proceeds - cost), shortfall });
      }
      // A swap acquires what was received at the value of what was given.
      if (t.kind === 'swap' && t.toAsset && t.toAmount && t.toAmount > 0) {
        if (value == null) incomplete.add(up(t.toAsset));
        acquire(t.toAsset, t.toAmount, value ?? 0);
      }
    }
    // transfers and DeFi deposits / withdrawals: no change.
  }

  const positions: AssetPosition[] = [...lots.entries()]
    .map(([asset, p]) => {
      const quantity = p.reduce((s, l) => s + l.qty, 0);
      const cost = p.reduce((s, l) => s + l.cost, 0);
      return { asset, quantity: Math.round(quantity * 1e10) / 1e10, costNzd: r2(cost), avgCostNzd: quantity > EPS ? r2(cost / quantity) : null, costIncomplete: incomplete.has(asset) };
    })
    .filter((p) => p.quantity > 1e-9)
    .sort((a, b) => a.asset.localeCompare(b.asset));

  return { method, disposals, positions, income, missingValue, shortfalls: [...shortfalls] };
}

/** NZ tax year (by start year) of a date: 1 April – 31 March. */
export function cryptoTaxYear(ymd: string): number {
  const [y, m] = ymd.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

/** Realised gains and income for one tax year. */
export function yearSummary(g: GainsResult, startYear: number): { realisedNzd: number; proceedsNzd: number; costNzd: number; incomeNzd: number; disposals: number } {
  const ds = g.disposals.filter((d) => cryptoTaxYear(d.date) === startYear);
  const inc = g.income.filter((i) => cryptoTaxYear(i.date) === startYear);
  return {
    realisedNzd: r2(ds.reduce((s, d) => s + d.gainNzd, 0)),
    proceedsNzd: r2(ds.reduce((s, d) => s + d.proceedsNzd, 0)),
    costNzd: r2(ds.reduce((s, d) => s + d.costNzd, 0)),
    incomeNzd: r2(inc.reduce((s, i) => s + i.nzdValue, 0)),
    disposals: ds.length,
  };
}

/**
 * Suggested kind for an imported on-chain transfer (the user confirms before anything is saved).
 *   - to / from another of your wallets → transfer out / in
 *   - one out and one in with the same transaction hash → swap
 *   - repeated small incoming amounts of one asset from one sender with nothing sent back → staking reward
 *   - other incoming → buy?  other outgoing → sell?  (flagged as guesses)
 */
export type ImportedTransfer = { ref: string; hash: string; date: string; direction: 'in' | 'out' | 'self'; asset: string; amount: number; counterparty: string | null };
export type Suggestion = { kind: CryptoTxnKind; reason: string; confident: boolean; pairRef?: string };

export function suggestKinds(items: ImportedTransfer[], ownAddresses: string[]): Map<string, Suggestion> {
  const own = new Set(ownAddresses.map((a) => a.toLowerCase()));
  const out = new Map<string, Suggestion>();
  const byHash = new Map<string, ImportedTransfer[]>();
  for (const t of items) byHash.set(t.hash, [...(byHash.get(t.hash) ?? []), t]);
  // Senders who pay in repeatedly and are never paid.
  const inCount = new Map<string, number>();
  const paid = new Set<string>();
  for (const t of items) {
    const cp = t.counterparty?.toLowerCase();
    if (!cp) continue;
    if (t.direction === 'in') inCount.set(`${cp}|${up(t.asset)}`, (inCount.get(`${cp}|${up(t.asset)}`) ?? 0) + 1);
    if (t.direction === 'out') paid.add(cp);
  }
  for (const t of items) {
    const cp = t.counterparty?.toLowerCase() ?? '';
    const legs = byHash.get(t.hash) ?? [];
    const other = legs.find((l) => l.ref !== t.ref && l.direction !== t.direction && l.direction !== 'self');
    if (t.direction === 'self') out.set(t.ref, { kind: 'transfer_out', reason: 'Sent to itself', confident: true });
    else if (cp && own.has(cp)) out.set(t.ref, { kind: t.direction === 'in' ? 'transfer_in' : 'transfer_out', reason: 'Between your own wallets', confident: true });
    else if (other) out.set(t.ref, { kind: 'swap', reason: 'Sent and received in the same transaction', confident: true, pairRef: other.ref });
    else if (t.direction === 'in' && cp && (inCount.get(`${cp}|${up(t.asset)}`) ?? 0) >= 3 && !paid.has(cp)) {
      out.set(t.ref, { kind: 'staking_reward', reason: 'Regular payments from the same sender', confident: false });
    } else out.set(t.ref, { kind: t.direction === 'in' ? 'buy' : 'sell', reason: t.direction === 'in' ? 'Received from outside your wallets' : 'Sent outside your wallets', confident: false });
  }
  return out;
}
