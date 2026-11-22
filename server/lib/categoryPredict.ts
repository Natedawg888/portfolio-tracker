/**
 * Guess a transaction's category from the user's own history (bank sync + "Automatic"
 * on Add transaction). Order:
 *   1. the category saved for this payee (an explicit rule always wins);
 *   2. bank transfer wording (KAN-21): "Deposit from …" / "Transfer from …" → the user's Transfer in
 *      category, "Transfer to …" → their Transfer out category (when they have one);
 *   3. the user's categorised transactions with the same merchant / description;
 *   4. similar wording (store numbers, locations and card noise ignored). A suburb on its own
 *      isn't enough: "ELLERSLIE SUPERMARKET" doesn't borrow "ELLERSLIE RACECOURSE"'s category.
 * Only past transactions in the same direction count (spend vs money in), only the
 * user's own categories are returned, and a guess is made only when history agrees
 * clearly — otherwise the transaction stays uncategorised. Never overwrites a category.
 */
import type { Database } from 'sql.js';
import { queryAll } from '../db/index.ts';
import { categoryForPayee } from '../payees/store.ts';

export type CategoryGuess = { categoryId: string; reason: 'payee' | 'transfer_wording' | 'same_payee' | 'similar' };

/** Words that don't identify a merchant (locations, payment rails, company suffixes). */
const NOISE = new Set([
  'nz', 'nzl', 'new', 'zealand', 'ltd', 'limited', 'llc', 'inc', 'co', 'com', 'www', 'the', 'and',
  'pos', 'eftpos', 'visa', 'debit', 'credit', 'card', 'purchase', 'payment', 'pay', 'paywave', 'contactless',
  'auckland', 'akl', 'wellington', 'wgtn', 'christchurch', 'chch', 'hamilton', 'tauranga', 'dunedin',
  'napier', 'hastings', 'nelson', 'rotorua', 'palmerston', 'north', 'south', 'central', 'cbd',
]);

/**
 * Suburbs and towns that appear after a merchant's name. They stay in the tokens (two branches of
 * one shop still match), but sharing only a place name isn't a match (KAN-21: Ellerslie).
 */
const PLACES = new Set([
  'ellerslie', 'ponsonby', 'grey', 'lynn', 'kingsland', 'newmarket', 'parnell', 'remuera', 'epsom', 'mt', 'mount', 'eden',
  'albert', 'roskill', 'wellesley', 'takapuna', 'albany', 'devonport', 'henderson', 'manukau', 'papakura', 'botany',
  'howick', 'pakuranga', 'penrose', 'onehunga', 'panmure', 'glen', 'innes', 'sylvia', 'park', 'st', 'lukes', 'herne', 'bay',
  'point', 'chevalier', 'avondale', 'blockhouse', 'glenfield', 'birkenhead', 'northcote', 'milford', 'orewa', 'silverdale',
  'westgate', 'lincoln', 'te', 'atatu', 'mangere', 'otahuhu', 'papatoetoe', 'flat', 'meadowbank', 'kohimarama',
  'mission', 'karori', 'johnsonville', 'petone', 'lower', 'upper', 'hutt', 'porirua', 'riccarton', 'papanui', 'sydenham',
  'hornby', 'frankton', 'queenstown', 'taupo', 'whangarei', 'gisborne', 'invercargill', 'timaru', 'blenheim', 'whanganui',
  'levin', 'masterton', 'cambridge', 'pukekohe', 'mosgiel', 'rolleston', 'kapiti', 'paraparaumu', 'mall', 'westfield',
]);

/** Bank transfer wording (KAN-21). Matched at the start of the description or merchant. */
const TRANSFER_IN_RE = /^\s*(deposit|transfer)\s+from\b/i;
const TRANSFER_OUT_RE = /^\s*transfer\s+to\b/i;

/** "Deposit from J SMITH" → 'transfer_in'; "Transfer to SAVINGS" → 'transfer_out'; else null. */
export function transferWordingType(text: string | null | undefined): 'transfer_in' | 'transfer_out' | null {
  if (!text) return null;
  if (TRANSFER_IN_RE.test(text)) return 'transfer_in';
  if (TRANSFER_OUT_RE.test(text)) return 'transfer_out';
  return null;
}

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

  // The user's own Transfer in / Transfer out categories, preferring one named that way.
  const transferCats = queryAll<{ id: string; name: string; type: string }>(
    db,
    `SELECT id, name, type FROM budget_categories WHERE user_id = ? AND type IN ('transfer_in', 'transfer_out') ORDER BY sort_order, name`,
    [userId],
  );
  const transferCategory = (type: 'transfer_in' | 'transfer_out'): string | null => {
    const mine = transferCats.filter((c) => c.type === type);
    const named = mine.find((c) => c.name.trim().toLowerCase() === (type === 'transfer_in' ? 'transfer in' : 'transfer out'));
    return (named ?? mine[0])?.id ?? null;
  };

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

    // Bank transfer wording, when the direction agrees with the amount.
    for (const name of [description, merchant]) {
      const kind = transferWordingType(name);
      if (!kind) continue;
      if ((kind === 'transfer_in') !== Number(amount) > 0) break;
      const id = transferCategory(kind);
      if (id) return { categoryId: id, reason: 'transfer_wording' };
      break;
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
        const sharedTokens = row.tokens.filter((t) => mine.has(t));
        // Only a place in common ("Ellerslie") isn't the same merchant.
        if (!sharedTokens.some((t) => !PLACES.has(t))) return { row, sim: 0 };
        const shared = sharedTokens.length;
        const sim = shared / Math.min(row.tokens.length, mine.size);
        return { row, sim };
      })
      .filter((m) => m.sim >= SIMILARITY_NEEDED);
    const guess = vote(similar.map(({ row, sim }) => ({ row, w: row.weight * sim })));
    return guess ? { categoryId: guess, reason: 'similar' } : null;
  };
}
