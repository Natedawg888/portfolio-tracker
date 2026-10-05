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

export type ProjectionQuery = {
  months: number;
  savingWindowMonths: number;
  annualReturnPercent: number | null;
  monthlySavingNzd: number | null;
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

  return {
    ok: true,
    value: {
      months: months.value,
      savingWindowMonths: savingWindowMonths.value,
      annualReturnPercent,
      monthlySavingNzd,
    },
  };
}
