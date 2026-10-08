/**
 * Pure view helpers for the Projections page.
 * The page renders the API response; these functions only choose words and form state.
 */
import { formatNzd } from '../api/client';

export const HORIZONS: Array<{ months: number; label: string }> = [
  { months: 12, label: '1 year' },
  { months: 24, label: '2 years' },
  { months: 60, label: '5 years' },
  { months: 120, label: '10 years' },
  { months: 240, label: '20 years' },
  { months: 360, label: '30 years' },
];
export const WINDOWS = [3, 6, 12];

/** Same limits the API enforces (server/projections/model.ts). */
const RETURN_RANGE = [-50, 50] as const;
const SAVING_LIMIT = 10_000_000;

export type Inputs = { months: number; window: number; returnPct: string; saving: string };

function inRange(raw: string, min: number, max: number): boolean {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isFinite(n) && n >= min && n <= max;
}

/** URL → inputs. Out-of-range values (e.g. a hand-edited link) are dropped and reported. */
export function readInputs(params: URLSearchParams): Inputs & { ignored: string[] } {
  const months = Number(params.get('months'));
  const window = Number(params.get('savingWindowMonths'));
  const ignored: string[] = [];
  let returnPct = params.get('annualReturnPercent') ?? '';
  if (returnPct !== '' && !inRange(returnPct, RETURN_RANGE[0], RETURN_RANGE[1])) {
    ignored.push(`yearly return must be between ${RETURN_RANGE[0]}% and ${RETURN_RANGE[1]}%`);
    returnPct = '';
  }
  let saving = params.get('monthlySavingNzd') ?? '';
  if (saving !== '' && !inRange(saving, -SAVING_LIMIT, SAVING_LIMIT)) {
    ignored.push('monthly saving must be a number up to $10,000,000');
    saving = '';
  }
  return {
    months: HORIZONS.some((h) => h.months === months) ? months : 12,
    window: WINDOWS.includes(window) ? window : 3,
    returnPct,
    saving,
    ignored,
  };
}

/** Fields the scenario form should show for the URL that is applied right now. */
export function formFieldsFromSearch(params: URLSearchParams): Inputs {
  const applied = readInputs(params);
  return {
    months: applied.months,
    window: applied.window,
    returnPct: applied.returnPct,
    saving: applied.saving,
  };
}

export type FlatLineFacts = {
  annualReturnPercent: number | null;
  /** Starting balance the yearly return is applied to. */
  compoundingAssetsNzd: number;
  monthlySavingNzd: number | null;
  /** True when at least one debt is stepped with a saved payment. */
  debtHasSavedPayment: boolean;
};

function percentText(value: number): string {
  if (Number.isInteger(value)) return `${value}%`;
  return `${Math.round(value * 1000) / 1000}%`;
}

function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/**
 * Why a projection line does not move. Wording follows the assumption values:
 * "the return is 0%" only when that assumption is 0. A non-zero return with no
 * compounding assets has nothing to grow.
 */
export function flatLineNote(facts: FlatLineFacts): string {
  const reasons: string[] = [];
  const ret = facts.annualReturnPercent;
  const nothingToGrow = Math.abs(facts.compoundingAssetsNzd) < 0.005;

  if (ret == null) {
    reasons.push('no yearly return is set');
  } else if (ret === 0) {
    reasons.push('the return is 0%');
  } else if (nothingToGrow) {
    reasons.push(
      `the yearly return is ${percentText(ret)}, but there is nothing for that return to grow`,
    );
  } else {
    reasons.push(`the yearly return is ${percentText(ret)}`);
  }

  if (facts.monthlySavingNzd == null) {
    reasons.push('there is no saving figure (no income or spending recorded in the budget months)');
  } else if (facts.monthlySavingNzd === 0) {
    reasons.push('there is no monthly saving');
  } else {
    reasons.push(`monthly saving is ${formatNzd(facts.monthlySavingNzd)}`);
  }

  if (!facts.debtHasSavedPayment) {
    reasons.push('no debt has a saved payment');
  }

  return `The line is flat because nothing in this scenario changes your balances: ${joinClauses(reasons)}. Enter a yearly return or a monthly saving above to see a scenario.`;
}

/** One cache entry per URL scenario, so a saved scenario cannot paint over a different link. */
export function projectionCacheKey(input: Inputs): string {
  return `projections:${input.months}:${input.window}:${encodeURIComponent(input.returnPct)}:${encodeURIComponent(input.saving)}`;
}

/**
 * What may paint when the URL scenario changes.
 * Only the cache entry for this scenario is accepted. A miss is empty — the
 * previous scenario's figures, cached or not, are not carried over.
 */
export function paintScenarioCache<T>(cachedForThisScenario: T | null | undefined):
  | { kind: 'cached'; data: T }
  | { kind: 'empty' } {
  if (cachedForThisScenario == null) return { kind: 'empty' };
  return { kind: 'cached', data: cachedForThisScenario };
}

/**
 * A failed fetch may keep this scenario's own cache (stale-while-revalidate).
 * It must clear the screen when this scenario has no cache, so another
 * scenario's numbers cannot sit under the error.
 */
export function scenarioRequestFailure(cachedForThisScenario: boolean):
  | { kind: 'keep-cache' }
  | { kind: 'error' } {
  if (cachedForThisScenario) return { kind: 'keep-cache' };
  return { kind: 'error' };
}
