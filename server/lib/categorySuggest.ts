/**
 * One-tap category suggestions for the Budget triage card (uncategorised transactions).
 *
 * Up to 3 categories per transaction, most likely first:
 *   1. the category saved for this payee (Payee settings);
 *   2. how the same payee was categorised before (same merchant words, else similar
 *      wording, matched as categoryPredict does), money in and money out kept apart,
 *      recent use weighted up;
 *   3. to fill the rest: the user's most-used categories for that direction.
 * A category whose type contradicts the direction (money in → Transfer out, etc.)
 * is never suggested.
 * Unlike categoryPredict this never needs a clear majority, because the user picks;
 * it also never writes anything.
 */
import type { Database } from 'sql.js';
import { queryAll } from '../db/index.ts';
import { categoryForPayee } from '../payees/store.ts';
import { merchantTokens } from './categoryPredict.ts';
import { categoryDirectionMismatch, normalizeCategoryType } from '../../src/lib/categoryTypes.ts';

export type SuggestionSource = 'payee' | 'history' | 'popular';
export type CategorySuggestion = { categoryId: string; source: SuggestionSource };
export type TxnSuggestions = { transactionId: string; suggestions: CategorySuggestion[] };

export const MAX_SUGGESTIONS = 3;
const HALF_LIFE_DAYS = 180;
/** Share of the shorter name's merchant words that must match, as in categoryPredict. */
const SIMILARITY_NEEDED = 0.6;

type Txn = { id: string; merchant?: string | null; description?: string | null; amount: number };

function tokensOf(merchant: string | null | undefined, description: string | null | undefined): string[] {
  return merchantTokens(merchant?.trim() ? merchant : `${merchant ?? ''} ${description ?? ''}`);
}

function ranked(weights: Map<string, number> | undefined): string[] {
  if (!weights) return [];
  return [...weights].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
}

export function suggestCategories(db: Database, userId: string, txns: Txn[], nowMs = Date.now()): TxnSuggestions[] {
  const history = queryAll<{
    merchant: string | null;
    description: string | null;
    amount: number;
    date: string;
    category_id: string;
    type: string | null;
    is_income: number | null;
  }>(
    db,
    `SELECT t.merchant, t.description, t.amount, t.date, t.category_id, c.type, c.is_income
     FROM transactions t
     JOIN budget_categories c ON c.id = t.category_id AND c.user_id = t.user_id
     WHERE t.user_id = ? AND t.category_id IS NOT NULL
     ORDER BY t.date DESC
     LIMIT 5000`,
    [userId],
  );

  type Past = { dir: 'in' | 'out'; key: string; tokens: string[]; categoryId: string; w: number };
  const past: Past[] = [];
  const popular = new Map<'in' | 'out', Map<string, number>>([
    ['in', new Map()],
    ['out', new Map()],
  ]);
  const typeOf = new Map<string, ReturnType<typeof normalizeCategoryType>>();
  for (const h of history) {
    typeOf.set(h.category_id, normalizeCategoryType(h.type, h.is_income));
    const dir = Number(h.amount) < 0 ? 'out' : 'in';
    const counts = popular.get(dir)!;
    counts.set(h.category_id, (counts.get(h.category_id) ?? 0) + 1);
    const tokens = tokensOf(h.merchant, h.description);
    if (tokens.length === 0) continue;
    const ageDays = Math.max(0, (nowMs - Date.parse(`${h.date}T00:00:00Z`)) / 86_400_000);
    const w = Number.isFinite(ageDays) ? 0.5 ** (ageDays / HALF_LIFE_DAYS) : 1;
    past.push({ dir, key: tokens.join(' '), tokens, categoryId: h.category_id, w });
  }

  /** Category weights from the same payee, else from similarly worded payees. */
  const payeeHistory = (dir: 'in' | 'out', tokens: string[]): Map<string, number> => {
    const weights = new Map<string, number>();
    if (tokens.length === 0) return weights;
    const key = tokens.join(' ');
    const sameWay = past.filter((p) => p.dir === dir);
    let matches = sameWay.filter((p) => p.key === key).map((p) => ({ p, w: p.w }));
    if (matches.length === 0) {
      const mine = new Set(tokens);
      matches = sameWay
        .map((p) => ({ p, sim: p.tokens.filter((t) => mine.has(t)).length / Math.min(p.tokens.length, mine.size) }))
        .filter((m) => m.sim >= SIMILARITY_NEEDED)
        .map((m) => ({ p: m.p, w: m.p.w * m.sim }));
    }
    for (const { p, w } of matches) weights.set(p.categoryId, (weights.get(p.categoryId) ?? 0) + w);
    return weights;
  };

  return txns.map((t) => {
    const dir = Number(t.amount) < 0 ? 'out' : 'in';
    const out: CategorySuggestion[] = [];
    const add = (categoryId: string | null, source: SuggestionSource) => {
      if (!categoryId || out.length >= MAX_SUGGESTIONS || out.some((s) => s.categoryId === categoryId)) return;
      const type = typeOf.get(categoryId);
      if (type && categoryDirectionMismatch(type, Number(t.amount))) return;
      out.push({ categoryId, source });
    };
    for (const name of [t.merchant, t.description]) {
      if (name?.trim()) add(categoryForPayee(db, userId, name), 'payee');
    }
    for (const id of ranked(payeeHistory(dir, tokensOf(t.merchant, t.description)))) add(id, 'history');
    for (const id of ranked(popular.get(dir))) add(id, 'popular');
    return { transactionId: t.id, suggestions: out };
  });
}
