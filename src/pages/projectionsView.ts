/**
 * Pure view helpers for the Projections page.
 * The page renders the API response; these functions only choose words and form state.
 */
import { formatNzd } from '../api/client';
import {
  ADD_LIMIT,
  PROJECTION_CLASS_KEYS,
  PROJECTION_CLASS_LABELS,
  RETURN_LIMITS,
  addParam,
  growParam,
  returnParam,
  MINING_PLAN_FIELDS,
  MINING_REWARDS_TO_PARAM,
  ADD_GROWTH_PARAM,
  ADD_GROWTH_LIMITS,
  type MiningPlan,
  type ProjectionClassKey,
} from '../lib/projectionClasses';

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

/** Per-class text fields; '' = not set in this scenario. */
export type ClassFields = Record<ProjectionClassKey, string>;

export type Inputs = {
  months: number;
  window: number;
  returnPct: string;
  saving: string;
  classReturns: ClassFields;
  classAdds: ClassFields;
  /** Per-class yearly increase in what's added, %. */
  classGrowth: ClassFields;
  /** Mining plan text fields; '' = not set. */
  mining: MiningFields;
  /** Yearly step-up of monthly additions, %; '' = not set. */
  addGrowth: string;
};

export type MiningNumKey = keyof typeof MINING_PLAN_FIELDS;
export type MiningFields = Record<MiningNumKey, string> & { rewardsTo: '' | 'crypto' | 'cash' | 'reinvest' };

export function emptyMiningFields(): MiningFields {
  return {
    ...(Object.fromEntries(Object.keys(MINING_PLAN_FIELDS).map((k) => [k, ''])) as Record<MiningNumKey, string>),
    rewardsTo: '',
  };
}

/** Mining fields that are set, as numbers, for the API. */
export function miningPlanFromFields(f: MiningFields): MiningPlan {
  const out: MiningPlan = {};
  for (const key of Object.keys(MINING_PLAN_FIELDS) as MiningNumKey[]) {
    if (f[key].trim() !== '') out[key] = Number(f[key]);
  }
  if (f.rewardsTo) out.rewardsTo = f.rewardsTo;
  return out;
}

export function emptyClassFields(): ClassFields {
  return Object.fromEntries(PROJECTION_CLASS_KEYS.map((k) => [k, ''])) as ClassFields;
}

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
  const classReturns = emptyClassFields();
  const classAdds = emptyClassFields();
  const classGrowth = emptyClassFields();
  for (const key of PROJECTION_CLASS_KEYS) {
    const g = params.get(growParam(key)) ?? '';
    if (g !== '') {
      if (inRange(g, 0, 500)) classGrowth[key] = g;
      else ignored.push(`${PROJECTION_CLASS_LABELS[key]} yearly increase must be 0–500%`);
    }
    const r = params.get(returnParam(key)) ?? '';
    if (r !== '') {
      if (inRange(r, RETURN_LIMITS[0], RETURN_LIMITS[1])) classReturns[key] = r;
      else ignored.push(`${PROJECTION_CLASS_LABELS[key]} return must be between ${RETURN_LIMITS[0]}% and ${RETURN_LIMITS[1]}%`);
    }
    const a = params.get(addParam(key)) ?? '';
    if (a !== '') {
      if (inRange(a, -ADD_LIMIT, ADD_LIMIT)) classAdds[key] = a;
      else ignored.push(`${PROJECTION_CLASS_LABELS[key]} monthly addition must be a number up to $10,000,000`);
    }
  }
  const mining = emptyMiningFields();
  for (const key of Object.keys(MINING_PLAN_FIELDS) as MiningNumKey[]) {
    const f = MINING_PLAN_FIELDS[key];
    const v = params.get(f.param) ?? '';
    if (v === '') continue;
    if (inRange(v, f.min, f.max)) mining[key] = v;
    else ignored.push(`${f.label} must be between ${f.min} and ${f.max}`);
  }
  const to = params.get(MINING_REWARDS_TO_PARAM) ?? '';
  if (to === 'crypto' || to === 'cash' || to === 'reinvest') mining.rewardsTo = to;
  else if (to !== '') ignored.push('mining rewards must go to crypto, cash or reinvest');
  let addGrowth = params.get(ADD_GROWTH_PARAM) ?? '';
  if (addGrowth !== '' && !inRange(addGrowth, ADD_GROWTH_LIMITS[0], ADD_GROWTH_LIMITS[1])) {
    ignored.push(`yearly increase in what's added must be ${ADD_GROWTH_LIMITS[0]}–${ADD_GROWTH_LIMITS[1]}%`);
    addGrowth = '';
  }
  return {
    months: HORIZONS.some((h) => h.months === months) ? months : 12,
    window: WINDOWS.includes(window) ? window : 3,
    returnPct,
    saving,
    classReturns,
    classAdds,
    classGrowth,
    mining,
    addGrowth,
    ignored,
  };
}

/** Form → URL. Only fields with a value are written, so links stay short. */
export function inputsToParams(form: Inputs): URLSearchParams {
  const next = new URLSearchParams();
  next.set('months', String(form.months));
  if (form.window !== 3) next.set('savingWindowMonths', String(form.window));
  if (form.returnPct.trim() !== '') next.set('annualReturnPercent', form.returnPct.trim());
  if (form.saving.trim() !== '') next.set('monthlySavingNzd', form.saving.trim());
  for (const key of PROJECTION_CLASS_KEYS) {
    if (form.classReturns[key].trim() !== '') next.set(returnParam(key), form.classReturns[key].trim());
    if (form.classAdds[key].trim() !== '') next.set(addParam(key), form.classAdds[key].trim());
    if (form.classGrowth[key].trim() !== '') next.set(growParam(key), form.classGrowth[key].trim());
  }
  for (const key of Object.keys(MINING_PLAN_FIELDS) as MiningNumKey[]) {
    if (form.mining[key].trim() !== '') next.set(MINING_PLAN_FIELDS[key].param, form.mining[key].trim());
  }
  if (form.mining.rewardsTo) next.set(MINING_REWARDS_TO_PARAM, form.mining.rewardsTo);
  if (form.addGrowth.trim() !== '') next.set(ADD_GROWTH_PARAM, form.addGrowth.trim());
  return next;
}

/** Per-class numbers for the API call (only the ones set). */
export function classNumbers(fields: ClassFields): Partial<Record<ProjectionClassKey, number>> {
  const out: Partial<Record<ProjectionClassKey, number>> = {};
  for (const key of PROJECTION_CLASS_KEYS) if (fields[key].trim() !== '') out[key] = Number(fields[key]);
  return out;
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
  const classes =
    PROJECTION_CLASS_KEYS.map((k) => `${input.classReturns[k]}/${input.classAdds[k]}/${input.classGrowth[k]}`).join(',') +
    `|${Object.values(input.mining).join(',')}|${input.addGrowth}`;
  return `projections:${input.months}:${input.window}:${encodeURIComponent(input.returnPct)}:${encodeURIComponent(input.saving)}:${encodeURIComponent(classes)}`;
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

export type ScenarioFrame<T> = {
  /** Form fields for the URL that is applied right now. */
  form: Inputs;
  /** This scenario's cache entry, or null when this URL has none. */
  data: T | null;
  /** True when `data` is this scenario's cache and can count as already loaded. */
  loaded: boolean;
};

/**
 * Form fields and cached figures for one projections URL.
 * Used on the first paint and again when the URL changes without remounting
 * (the Projections nav link clears the query while the page stays mounted).
 * `readCache` is only asked for this URL's key, so another scenario's entry
 * cannot be returned.
 */
export function scenarioFrameFromSearch<T>(
  params: URLSearchParams,
  readCache: (key: string) => T | null | undefined,
): ScenarioFrame<T> {
  const applied = readInputs(params);
  const paint = paintScenarioCache(readCache(projectionCacheKey(applied)));
  return {
    form: {
      months: applied.months,
      window: applied.window,
      returnPct: applied.returnPct,
      saving: applied.saving,
      classReturns: applied.classReturns,
      classAdds: applied.classAdds,
      classGrowth: applied.classGrowth,
      mining: applied.mining,
      addGrowth: applied.addGrowth,
    },
    data: paint.kind === 'cached' ? paint.data : null,
    loaded: paint.kind === 'cached',
  };
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** "10 years" for a known horizon; otherwise a plain month count. */
export function horizonPhrase(months: number): string {
  const known = HORIZONS.find((h) => h.months === months);
  if (known) return known.label;
  if (months > 0 && months % 12 === 0) {
    const years = months / 12;
    return years === 1 ? '1 year' : `${years} years`;
  }
  return `${months} months`;
}

/** Compact range label: 120 → "10Y". */
export function horizonPill(months: number): string {
  if (months > 0 && months % 12 === 0) return `${months / 12}Y`;
  return `${months}M`;
}

export type ProjectionFigureInput = {
  startNetWorthNzd: number | null;
  endNetWorthNzd: number | null;
  /** Null when the response has no asset-class breakdown. An empty list sums to 0. */
  classAddedNzd: number[] | null;
  classGrowthNzd: number[] | null;
  /** Cumulative budget saving at the horizon. Null when no saving figure exists. */
  savingsAddedNzd: number | null;
  /** Cumulative KiwiSaver contributions. Null when none were observed. */
  kiwiSaverAddedNzd: number | null;
};

export type ProjectionFigures = {
  todayNzd: number | null;
  endNzd: number | null;
  youAddNzd: number | null;
  growthNzd: number | null;
};

/** Sum a list of real numbers. Any non-finite value makes the whole sum unavailable. */
export function sumMoney(values: number[] | null | undefined): number | null {
  if (values == null) return null;
  let sum = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) return null;
    sum += value;
  }
  return roundCents(sum);
}

/**
 * Headline figures from a projection response.
 * "You add" is the asset-class additions when that breakdown exists (that is what
 * the model actually adds). Otherwise it is budget saving plus KiwiSaver contributions.
 * Missing pieces stay null so the page can show "—".
 */
export function projectionFigures(input: ProjectionFigureInput): ProjectionFigures {
  let youAdd: number | null;
  if (input.classAddedNzd != null) {
    youAdd = sumMoney(input.classAddedNzd);
  } else {
    const saving = finiteOrNull(input.savingsAddedNzd);
    const kiwi = finiteOrNull(input.kiwiSaverAddedNzd);
    youAdd = saving == null && kiwi == null ? null : roundCents((saving ?? 0) + (kiwi ?? 0));
  }
  return {
    todayNzd: finiteOrNull(input.startNetWorthNzd),
    endNzd: finiteOrNull(input.endNetWorthNzd),
    youAddNzd: youAdd,
    growthNzd: sumMoney(input.classGrowthNzd),
  };
}

/** "Today $1 · you add $2 · growth $3". The formatter decides how a missing amount reads. */
export function projectionBreakdown(
  figures: ProjectionFigures,
  formatMoney: (value: number | null) => string,
): string {
  return `Today ${formatMoney(figures.todayNzd)} · you add ${formatMoney(figures.youAddNzd)} · growth ${formatMoney(figures.growthNzd)}`;
}

export type DatedWorth = { date: string; monthIndex: number; netWorthNzd: number };

/** Beyond two years, one point a year (plus the last month) keeps the line readable. */
export function sampleProjectionPoints<T extends { monthIndex: number }>(points: T[], horizonMonths: number): T[] {
  if (horizonMonths > 24) {
    return points.filter((point) => point.monthIndex % 12 === 0 || point.monthIndex === horizonMonths);
  }
  return points;
}

/**
 * Additions are a straight ramp when nothing steps them up and no month-by-month
 * schedule (mining flows) replaces the constant amount.
 */
export function additionsAreEven(input: {
  defaultGrowthPercent: number | null;
  classGrowthPercents: Array<number | null | undefined>;
  hasMonthlySchedule: boolean;
}): boolean {
  if (input.hasMonthlySchedule) return false;
  const percents = [input.defaultGrowthPercent ?? 0, ...input.classGrowthPercents.map((value) => value ?? 0)];
  return percents.every((value) => value === 0);
}

/**
 * "Today plus what you add" from real totals.
 * Even additions: each sampled month is today + the share of the horizon total (exact for a constant monthly amount).
 * Uneven additions: only the two real endpoints, today and today + the total. No invented months in between.
 * Null when the total added is unknown or there is no starting point.
 */
export function todayPlusAddedPoints(
  points: DatedWorth[],
  youAddNzd: number | null,
  even: boolean,
): Array<{ at: string; value: number }> | null {
  if (youAddNzd == null || points.length === 0) return null;
  const start = points[0];
  if (!Number.isFinite(start.netWorthNzd)) return null;
  const horizon = points[points.length - 1]?.monthIndex ?? 0;
  const at = (point: DatedWorth): { at: string; value: number } => {
    const share = horizon === 0 ? 0 : point.monthIndex / horizon;
    return { at: point.date, value: roundCents(start.netWorthNzd + youAddNzd * share) };
  };
  if (!even) {
    const end = points[points.length - 1];
    return end === start ? [at(start)] : [at(start), at(end)];
  }
  return points.map(at);
}

/** Typed scenario text wins. A blank field shows the figure the projection is already using. */
export function typedOrInUse(typed: string, inUse: number | null): number | null {
  const text = typed.trim();
  if (text !== '') {
    const parsed = Number(text);
    if (Number.isFinite(parsed)) return parsed;
  }
  return finiteOrNull(inUse);
}

/** Whole percents stay whole. One decimal otherwise. Missing stays "—". */
export function sliderPercentLabel(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}%`;
}

/** Slider runs to 100% unless the figure in use is already higher (the API allows 500). */
export function growthSliderMax(value: number | null): number {
  if (value == null || !Number.isFinite(value) || value <= 100) return 100;
  return Math.min(500, Math.ceil(value));
}

export function yearlyIncreaseCaption(percent: number | null): string {
  if (percent == null || percent === 0) return 'Same amount every year';
  return 'Steps up by this much each year';
}

/**
 * A saving slider that always includes 0, the amount in use, and the budget average.
 * The top stays at least $2,000 so a $0 scenario can still be dragged upward.
 */
export function savingSliderBounds(value: number | null, observed: number | null): { min: number; max: number; step: number } {
  const current = finiteOrNull(value) ?? 0;
  const seen = finiteOrNull(observed) ?? 0;
  const low = Math.min(0, current, seen);
  const high = Math.max(2000, current, seen, Math.abs(seen) * 2);
  const min = Math.floor(low / 50) * 50;
  const max = Math.max(Math.ceil(high / 50) * 50, min + 50);
  const span = max - min;
  const step = span > 20_000 ? 100 : span > 5_000 ? 50 : 10;
  return { min, max, step };
}

export function budgetAverageLabel(windowMonths: number, amountLabel: string): string {
  const months = Number.isFinite(windowMonths) && windowMonths > 0 ? windowMonths : 3;
  return `Budget average (last ${months} ${months === 1 ? 'month' : 'months'}): ${amountLabel}`;
}

export function canUseBudgetAverage(observed: number | null): boolean {
  return observed != null && Number.isFinite(observed);
}

/** The observed average, in cents, as the saving field text. */
export function budgetAverageInput(observed: number): string {
  return String(roundCents(observed));
}
