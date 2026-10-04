/**
 * Per-user KiwiSaver employee contribution rate.
 * Stored on the user. The PAYE calculator multiplies gross pay by this rate.
 * This module does not calculate or store a contribution dollar amount.
 */
import type { Database } from 'sql.js';
import { queryOne, run } from '../db/index.ts';
import {
  KIWISAVER_ACCOUNT_DEFAULT_EMPLOYEE_RATE,
  KIWISAVER_DEFAULT_EMPLOYEE_RATE,
  KIWISAVER_EMPLOYEE_RATE_CHOICES,
} from '../../src/lib/payeRates.ts';

export const KIWISAVER_EMPLOYEE_RATE_KEY = 'kiwiSaverEmployeeRatePct';

export type EmployeeRateResult = {
  employeeRatePct: number;
  saved: boolean;
  offeredRates: readonly number[];
  /** IRD minimum employee rate from 1 April 2026. Not a dollar contribution. */
  statutoryDefaultPct: number;
};

type SaveResult =
  | { ok: true; employeeRatePct: number; saved: true }
  | { ok: false; status: number; error: string };

export function parseEmployeeRate(raw: unknown): number | null {
  const n = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && raw.trim() !== ''
      ? Number(raw)
      : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  const rounded = Math.round(n * 100) / 100;
  if (Math.abs(n - rounded) > 1e-8) return null;
  return rounded;
}

function readPrefs(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* keep other fields empty rather than inventing a rate */
  }
  return {};
}

export function employeeRateView(rate: number, saved: boolean): EmployeeRateResult {
  return {
    employeeRatePct: rate,
    saved,
    offeredRates: KIWISAVER_EMPLOYEE_RATE_CHOICES,
    statutoryDefaultPct: KIWISAVER_DEFAULT_EMPLOYEE_RATE,
  };
}

export function readKiwiSaverEmployeeRate(db: Database, userId: string): EmployeeRateResult & { found: boolean } {
  const row = queryOne<{ preferences_json?: string | null }>(
    db,
    `SELECT preferences_json FROM users WHERE id = ?`,
    [userId],
  );
  if (!row) {
    return { ...employeeRateView(KIWISAVER_ACCOUNT_DEFAULT_EMPLOYEE_RATE, false), found: false };
  }
  const prefs = readPrefs(row.preferences_json ?? null);
  const rate = parseEmployeeRate(prefs[KIWISAVER_EMPLOYEE_RATE_KEY]);
  if (rate == null) {
    return { ...employeeRateView(KIWISAVER_ACCOUNT_DEFAULT_EMPLOYEE_RATE, false), found: true };
  }
  return { ...employeeRateView(rate, true), found: true };
}

export function saveKiwiSaverEmployeeRate(db: Database, userId: string, raw: unknown): SaveResult {
  const existing = queryOne<{ preferences_json?: string | null }>(
    db,
    `SELECT preferences_json FROM users WHERE id = ?`,
    [userId],
  );
  if (!existing) return { ok: false, status: 404, error: 'User not found.' };
  const rate = parseEmployeeRate(raw);
  if (rate == null) {
    return {
      ok: false,
      status: 400,
      error: 'Employee contribution rate must be a percentage above 0 and at most 100, with at most two decimal places.',
    };
  }
  const prefs = readPrefs(existing.preferences_json ?? null);
  prefs[KIWISAVER_EMPLOYEE_RATE_KEY] = rate;
  run(
    db,
    `UPDATE users SET preferences_json = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(prefs), new Date().toISOString(), userId],
  );
  return { ok: true, employeeRatePct: rate, saved: true };
}
