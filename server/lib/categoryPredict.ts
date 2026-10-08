/**
 * Guess a transaction's category from the user's own history (bank sync + "Automatic"
 * on Add transaction). Order:
 *   1. the category saved for this payee (an explicit rule always wins);
 *   2. the user's categorised transactions with the same merchant / description;
 *   3. similar wording (store numbers, locations and card noise ignored).
 * Only past transactions in the same direction count (spend vs money in), only the
 * user's own categories are returned, and a guess is made only when history agrees
 * clearly — otherwise the transaction stays uncategorised. Never overwrites a category.
 */
import type { Database } from 'sql.js';
import { queryAll } from '../db/index.ts';
import { categoryForPayee } from '../payees/store.ts';

export type CategoryGuess = { categoryId: string; reason: 'payee' | 'same_payee' | 'similar' };

/** Words that don't identify a merchant (locations, payment rails, company suffixes). */
const NOISE = new Set([
  'nz', 'nzl', 'new', 'zealand', 'ltd', 'limited', 'llc', 'inc', 'co', 'com', 'www', 'the', 'and',
  'pos', 'eftpos', 'visa', 'debit', 'credit', 'card', 'purchase', 'payment', 'pay', 'paywave', 'contactless',
  'auckland', 'akl', 'wellington', 'wgtn', 'christchurch', 'chch', 'hamilton', 'tauranga', 'dunedin',
  'napier', 'hastings', 'nelson', 'rotorua', 'palmerston', 'north', 'south', 'central', 'cbd',
]);

/** "COUNTDOWN 1234 AUCKLAND NZ" → ["countdown"]; "Night'n Day" and "Night n Day" → ["night", "day"]. */
export function merchantTokens(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !/\d/.test(w) && !NOISE.has(w));
  return [...new Set(words)];
}

function exactKey(text: string): string {
  return merchantTokens(text).join(' ');
}

type HistoryRow = { key: string; tokens: string[]; categoryId: string; debit: boolean; weight: number };

const SHARE_NEEDED = 0.6;
const SIMILARITY_NEEDED = 0.6;
const HALF_LIFE_DAYS = 180;

export type CategoryPredictor = (txn: { merchant?: string | null; description?: string | null; amount: number }) => CategoryGuess | null;

/** Build once per sync; reads the user's categorised history a single time. */
export function createCategoryPredictor(db: Database, userId: string, nowMs = Date.now()): CategoryPredictor {
  const rows = queryAll<{ merchant: string | null; description: string | null; amount: number; date: string; category_id: string }>(
    db,
    `SELECT t.merchant, t.description, t.amount, t.date, t.category_id
     FROM transactions t
     JOIN budget_categories c ON c.id = t.category_id AND c.user_id = t.user_id
     WHERE t.user_id = ? AND t.category_id IS NOT NULL
     ORDER BY t.date DESC
     LIMIT 5000`,
    [userId],
  );
  const history: HistoryRow[] = [];
  for (const r of rows) {
    const text = `${r.merchant ?? ''} ${r.description ?? ''}`;
    const tokens = merchantTokens(r.merchant?.trim() ? r.merchant : text);
    if (tokens.length === 0) continue;
    const ageDays = Math.max(0, (nowMs - Date.parse(`${r.date}T00:00:00Z`)) / 86_400_000);
    history.push({
      key: tokens.join(' '),
      tokens,
      categoryId: r.category_id,
      debit: Number(r.amount) < 0,
      // Recent habits count more (a merchant can move category over time).
      weight: Number.isFinite(ageDays) ? 0.5 ** (ageDays / HALF_LIFE_DAYS) : 1,
    });
  }

  const vote = (matches: Array<{ row: HistoryRow; w: number }>): string | null => {
    if (matches.length === 0) return null;
    const totals = new Map<string, number>();
    let all = 0;
    for (const { row, w } of matches) {
      totals.set(row.categoryId, (totals.get(row.categoryId) ?? 0) + w);
      all += w;
    }
    const [best, score] = [...totals].sort((a, b) => b[1] - a[1])[0];
    return score / all >= SHARE_NEEDED ? best : null;
  };

  return ({ merchant, description, amount }) => {
    for (const name of [merchant, description]) {
      if (!name?.trim()) continue;
      const saved = categoryForPayee(db, userId, name);
      if (saved) return { categoryId: saved, reason: 'payee' };
    }

    const debit = Number(amount) < 0;
    const sameWay = history.filter((h) => h.debit === debit);
    const ownText = merchant?.trim() ? merchant : `${merchant ?? ''} ${description ?? ''}`;
    const key = exactKey(ownText);
    if (!key) return null;

    const exact = vote(sameWay.filter((h) => h.key === key).map((row) => ({ row, w: row.weight })));
    if (exact) return { categoryId: exact, reason: 'same_payee' };

    const mine = new Set(key.split(' '));
    const similar = sameWay
      .map((row) => {
        // Overlap with the shorter name: "Night n Day Ponsonby" ≈ "NIGHT N DAY GREY LYNN".
        const shared = row.tokens.filter((t) => mine.has(t)).length;
        const sim = shared / Math.min(row.tokens.length, mine.size);
        return { row, sim };
      })
      .filter((m) => m.sim >= SIMILARITY_NEEDED);
    const guess = vote(similar.map(({ row, sim }) => ({ row, w: row.weight * sim })));
    return guess ? { categoryId: guess, reason: 'similar' } : null;
  };
}
