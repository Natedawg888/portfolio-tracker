/**
 * Suggest PAYE investing credits from real savings-interest/dividend income.
 *
 * This is deliberately conservative: only explicit income records or imported/
 * synced income-category transactions can contribute, and only rows that are
 * savings interest or dividends are considered. A plain income amount is not a
 * tax credit; the row must also explicitly identify the credit kind (RWT,
 * imputation, PIE, or foreign). Never emit $0 placeholder rows.
 */

import type { PersistedCreditDraft } from './payePrefs';
import type { InvestingCreditKind } from './payeRates';

/** Inclusive NZ tax-year bounds for the rates in payeRates.ts (1 Apr 2026 – 31 Mar 2027). */
export const PAYE_TAX_YEAR_START = '2026-04-01';
export const PAYE_TAX_YEAR_END = '2027-03-31';

export const DIVIDENDS_INCOME_CATEGORY_ID = 'cat-income-dividends';

type IncomeOrigin = 'record' | 'category_txn';

export type PortfolioIncomeLike = {
  amountNzd: number;
  kind?: 'cash' | 'crypto';
  date?: string;
  categoryId?: string | null;
  categoryName?: string | null;
  description?: string | null;
  notes?: string | null;
  /** Only explicit Add-income rows and real imported/synced transactions qualify. */
  origin?: IncomeOrigin;
  /** Present when the API can identify the source account (e.g. savings). */
  accountType?: string | null;
};

const CREDIT_KIND_PATTERNS: { kind: InvestingCreditKind; re: RegExp }[] = [
  { kind: 'imputation', re: /\b(imputation|imc\b|ica\b)/i },
  { kind: 'rwt', re: /\b(rwt|resident\s+withholding)\b/i },
  {
    kind: 'pie',
    re: /\bpie\b.*\b(credit|tax\s*credit)\b|\b(credit|tax\s*credit)\b.*\bpie\b/i,
  },
  {
    kind: 'foreign',
    re: /\b(foreign\s+tax(\s+credit)?|ftc)\b/i,
  },
];

function detectCreditKind(text: string): InvestingCreditKind | null {
  const t = text.trim();
  if (!t) return null;
  for (const row of CREDIT_KIND_PATTERNS) {
    if (row.re.test(t)) return row.kind;
  }
  return null;
}

function portfolioCreditId(kind: InvestingCreditKind): string {
  return `portfolio-${kind}`;
}

/**
 * True only for savings interest or dividend rows. The seeded dividends &
 * interest category is authoritative; free-text/account matching also covers
 * real bank transactions that were imported without that category.
 */
function isSavingsInterestOrDividend(row: PortfolioIncomeLike, text: string): boolean {
  if (
    row.categoryId === DIVIDENDS_INCOME_CATEGORY_ID ||
    (typeof row.categoryId === 'string' && row.categoryId.startsWith(`${DIVIDENDS_INCOME_CATEGORY_ID}__`))
  ) return true;

  const category = (row.categoryName ?? '').toLowerCase();
  if (/\bdividend(?:s)?\b/.test(category)) return true;

  const haystack = text.toLowerCase();
  if (/\bdividend(?:s)?\b/.test(haystack)) return true;

  // A savings account plus an interest description is a savings-interest txn.
  const accountType = (row.accountType ?? '').toLowerCase();
  if (/\bsavings?\b/.test(accountType) && /\binterest\b/.test(haystack)) return true;

  // Also accept an explicit “savings interest” description when account type
  // is unavailable (as with older API responses and manual income records).
  return /\bsavings?\s+(?:account\s+)?interest\b|\binterest\s+(?:from|on)\s+savings?\b/.test(
    haystack,
  );
}

/**
 * Build drafts from real savings-interest/dividend income rows that explicitly
 * name a tax-credit kind and have amountNzd > 0. Plain dividends/interest
 * without credit wording → nothing (estimating RWT would invent).
 */
export function investingCreditsFromPortfolioIncome(
  rows: PortfolioIncomeLike[],
): PersistedCreditDraft[] {
  const sums = new Map<InvestingCreditKind, number>();

  for (const row of rows) {
    if (row.origin !== 'record' && row.origin !== 'category_txn') continue;
    if (row.kind && row.kind !== 'cash') continue;

    const amount = Number(row.amountNzd);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const text = [row.description, row.notes, row.categoryName]
      .filter((s) => typeof s === 'string' && s.trim())
      .join(' · ');
    if (!isSavingsInterestOrDividend(row, text)) continue;

    const kind = detectCreditKind(text);
    if (!kind) continue;

    sums.set(kind, (sums.get(kind) ?? 0) + amount);
  }

  const drafts: PersistedCreditDraft[] = [];
  for (const [kind, total] of sums) {
    if (!(total > 0)) continue;
    drafts.push({
      id: portfolioCreditId(kind),
      kind,
      label: '',
      annualAmount: String(Math.round((total + Number.EPSILON) * 100) / 100),
    });
  }
  return drafts;
}

/**
 * Drop invented $0 defaults / stale portfolio rows; keep manual rows; append
 * portfolio suggestions only for kinds not already covered manually.
 */
export function mergePortfolioInvestingCredits(
  existing: PersistedCreditDraft[],
  fromPortfolio: PersistedCreditDraft[],
): PersistedCreditDraft[] {
  const manual = existing.filter((d) => {
    if (d.id.startsWith('portfolio-')) return false;
    // Legacy first-visit seeds (imputation + RWT at $0) — remove when still empty.
    if (d.id.startsWith('default-') && !(Number(d.annualAmount) > 0)) return false;
    return true;
  });

  const manualKinds = new Set(manual.map((d) => d.kind));
  const toAdd = fromPortfolio.filter(
    (d) => Number(d.annualAmount) > 0 && !manualKinds.has(d.kind),
  );

  return [...manual, ...toAdd];
}

/** True when a draft has a real positive annual NZD amount. */
export function hasRealCreditAmount(draft: PersistedCreditDraft): boolean {
  const n = Number(draft.annualAmount);
  return Number.isFinite(n) && n > 0;
}
