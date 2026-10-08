/**
 * Query parameters for GET /api/projections.
 * Missing optional numbers use a labelled default inside the projection.
 * Out-of-range values are rejected rather than clamped.
 */
import {
  DEFAULT_HORIZON_MONTHS,
  DEFAULT_SAVING_WINDOW_MONTHS,
  MAX_ANNUAL_RETURN_PERCENT,
  MAX_HORIZON_MONTHS,
  MAX_MONTHLY_SAVING_NZD,
  MAX_SAVING_WINDOW_MONTHS,
  MIN_ANNUAL_RETURN_PERCENT,
} from './model.ts';
import { roundMoney } from '../debts/model.ts';
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
  type ProjectionClassValues,
} from '../../src/lib/projectionClasses.ts';

export type ProjectionQuery = {
  months: number;
  savingWindowMonths: number;
  annualReturnPercent: number | null;
  monthlySavingNzd: number | null;
  /** Per-class yearly returns (returnShares=7 …). Missing classes fall back to saved, then the default. */
  classReturns: ProjectionClassValues;
  /** Per-class monthly additions (addShares=500 …). Missing classes fall back to saved, then observed. */
  classAdditions: ProjectionClassValues;
  /** Mining plan fields set in the scenario (missing = saved, then no change). */
  mining: MiningPlan;
  /** Yearly step-up of monthly additions, % (null = saved, then 0). */
  additionGrowthPct: number | null;
  /** Per-class yearly step-up (growShares=50 …); missing classes use additionGrowthPct. */
  classGrowth: ProjectionClassValues;
};

function oneString(
  value: unknown,
  name: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value == null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') {
    return { ok: false, error: `${name} must be a single value` };
  }
  return { ok: true, value: value.trim() };
}

function wholeNumber(
  raw: string,
  name: string,
  min: number,
  max: number,
): { ok: true; value: number } | { ok: false; error: string } {
  if (!/^-?\d+$/.test(raw)) {
    return { ok: false, error: `${name} must be a whole number from ${min} to ${max}` };
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    return { ok: false, error: `${name} must be a whole number from ${min} to ${max}` };
  }
  return { ok: true, value: n };
}

export function parseProjectionQuery(
  query: Record<string, unknown>,
): { ok: true; value: ProjectionQuery } | { ok: false; error: string } {
  const monthsRaw = oneString(query.months, 'months');
  if (!monthsRaw.ok) return monthsRaw;
  const months = monthsRaw.value == null
    ? { ok: true as const, value: DEFAULT_HORIZON_MONTHS }
    : wholeNumber(monthsRaw.value, 'months', 1, MAX_HORIZON_MONTHS);
  if (!months.ok) return months;

  const windowRaw = oneString(query.savingWindowMonths, 'savingWindowMonths');
  if (!windowRaw.ok) return windowRaw;
  const savingWindowMonths = windowRaw.value == null
    ? { ok: true as const, value: DEFAULT_SAVING_WINDOW_MONTHS }
    : wholeNumber(windowRaw.value, 'savingWindowMonths', 1, MAX_SAVING_WINDOW_MONTHS);
  if (!savingWindowMonths.ok) return savingWindowMonths;

  const returnRaw = oneString(query.annualReturnPercent, 'annualReturnPercent');
  if (!returnRaw.ok) return returnRaw;
  let annualReturnPercent: number | null = null;
  if (returnRaw.value != null) {
    const n = Number(returnRaw.value);
    if (
      !Number.isFinite(n) ||
      n < MIN_ANNUAL_RETURN_PERCENT ||
      n > MAX_ANNUAL_RETURN_PERCENT
    ) {
      return {
        ok: false,
        error: `annualReturnPercent must be a number from ${MIN_ANNUAL_RETURN_PERCENT} to ${MAX_ANNUAL_RETURN_PERCENT}`,
      };
    }
    annualReturnPercent = Math.round(n * 10000) / 10000;
  }

  const savingRaw = oneString(query.monthlySavingNzd, 'monthlySavingNzd');
  if (!savingRaw.ok) return savingRaw;
  let monthlySavingNzd: number | null = null;
  if (savingRaw.value != null) {
    const n = Number(savingRaw.value);
    if (!Number.isFinite(n) || Math.abs(n) > MAX_MONTHLY_SAVING_NZD) {
      return {
        ok: false,
        error: `monthlySavingNzd must be a number from -${MAX_MONTHLY_SAVING_NZD} to ${MAX_MONTHLY_SAVING_NZD}`,
      };
    }
    monthlySavingNzd = roundMoney(n);
  }

  const classReturns: ProjectionClassValues = {};
  const classAdditions: ProjectionClassValues = {};
  const classGrowth: ProjectionClassValues = {};
  for (const key of PROJECTION_CLASS_KEYS) {
    const label = PROJECTION_CLASS_LABELS[key];
    const r = oneString(query[returnParam(key)], returnParam(key));
    if (!r.ok) return r;
    if (r.value != null) {
      const n = Number(r.value);
      if (!Number.isFinite(n) || n < RETURN_LIMITS[0] || n > RETURN_LIMITS[1]) {
        return { ok: false, error: `${label} return must be a number from ${RETURN_LIMITS[0]} to ${RETURN_LIMITS[1]}` };
      }
      classReturns[key] = Math.round(n * 10000) / 10000;
    }
    const a = oneString(query[addParam(key)], addParam(key));
    if (!a.ok) return a;
    if (a.value != null) {
      const n = Number(a.value);
      if (!Number.isFinite(n) || Math.abs(n) > ADD_LIMIT) {
        return { ok: false, error: `${label} monthly addition must be a number from -${ADD_LIMIT} to ${ADD_LIMIT}` };
      }
      classAdditions[key] = roundMoney(n);
    }
    const gr = oneString(query[growParam(key)], growParam(key));
    if (!gr.ok) return gr;
    if (gr.value != null) {
      const n = Number(gr.value);
      if (!Number.isFinite(n) || n < 0 || n > 500) {
        return { ok: false, error: `${label} yearly increase must be 0–500%` };
      }
      classGrowth[key] = Math.round(n * 100) / 100;
    }
  }

  const mining: MiningPlan = {};
  for (const [key, f] of Object.entries(MINING_PLAN_FIELDS) as [keyof typeof MINING_PLAN_FIELDS, (typeof MINING_PLAN_FIELDS)[keyof typeof MINING_PLAN_FIELDS]][]) {
    const raw = oneString(query[f.param], f.param);
    if (!raw.ok) return raw;
    if (raw.value == null) continue;
    const n = Number(raw.value);
    if (!Number.isFinite(n) || n < f.min || n > f.max) {
      return { ok: false, error: `${f.label} must be a number from ${f.min} to ${f.max}` };
    }
    mining[key] = Math.round(n * 10000) / 10000;
  }
  const to = oneString(query[MINING_REWARDS_TO_PARAM], MINING_REWARDS_TO_PARAM);
  if (!to.ok) return to;
  if (to.value != null) {
    if (to.value !== 'crypto' && to.value !== 'cash' && to.value !== 'reinvest') {
      return { ok: false, error: 'miningRewardsTo must be crypto, cash or reinvest' };
    }
    mining.rewardsTo = to.value;
  }

  const growthRaw = oneString(query[ADD_GROWTH_PARAM], ADD_GROWTH_PARAM);
  if (!growthRaw.ok) return growthRaw;
  let additionGrowthPct: number | null = null;
  if (growthRaw.value != null) {
    const g = Number(growthRaw.value);
    if (!Number.isFinite(g) || g < ADD_GROWTH_LIMITS[0] || g > ADD_GROWTH_LIMITS[1]) {
      return { ok: false, error: `Yearly increase in what's added must be ${ADD_GROWTH_LIMITS[0]}–${ADD_GROWTH_LIMITS[1]}%` };
    }
    additionGrowthPct = Math.round(g * 100) / 100;
  }

  return {
    ok: true,
    value: {
      additionGrowthPct,
      classGrowth,
      mining,
      months: months.value,
      savingWindowMonths: savingWindowMonths.value,
      annualReturnPercent,
      monthlySavingNzd,
      classReturns,
      classAdditions,
    },
  };
}
