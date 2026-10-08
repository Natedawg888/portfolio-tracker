/**
 * Savings-goal progress from figures the user stored.
 * Amounts are NZD. Dates are calendar dates (YYYY-MM-DD). No interest, no
 * bank history, and no separate savings rate are assumed — those are not stored.
 *
 * remaining = max(0, target − current), rounded to cents.
 *
 * percentComplete = current / target × 100, rounded to 2 decimals.
 * It is a percent (25 means 25%), not a fraction. It may exceed 100 when
 * current is above the target. Target is stored only when it is positive.
 *
 * daysRemaining = deadline − asOf in whole calendar days.
 * asOf is the Pacific/Auckland date the figures are counted on.
 * Null when no deadline is stored. Negative when the deadline is before asOf.
 *
 * requiredWeeklySavingNzd and requiredMonthlySavingNzd are the constant NZD
 * amounts which cover `remaining` by the deadline. A week is 7 days. A mean
 * Gregorian month is 365.25 / 12 days (30.4375).
 *
 * - remaining is 0: both are 0. Nothing more is required.
 * - no deadline, or daysRemaining < 0: both are null. A past date cannot
 *   define a future weekly or monthly amount.
 * - daysRemaining is 0: both equal remaining. The gap is due today, so it is
 *   not spread across a later week or month.
 * - daysRemaining > 0:
 *     weekly  = remaining × 7 / daysRemaining
 *     monthly = remaining × (365.25 / 12) / daysRemaining
 *   each rounded to cents.
 *
 * estimatedCompletion is YYYY-MM-DD or null:
 * - remaining is 0: asOf. The goal is already met. The day it was first
 *   reached is not stored, so the date reported is the day it is counted.
 * - deadline on or after asOf, with a gap still open: the deadline. That is
 *   the date the required weekly or monthly amount finishes the goal.
 * - otherwise null. No pace is stored, so a date after a missed deadline is
 *   not invented, and a goal with no deadline has no completion date.
 */

import { isIsoDate, roundMoney } from '../debts/model.ts';

export const WEEK_DAYS = 7;
/** Mean Gregorian month: 365.25 / 12 = 30.4375 days. */
export const MEAN_MONTH_DAYS = 365.25 / 12;

export type SavingsGoalInput = {
  name: string;
  notes: string | null;
  targetNzd: number;
  currentAmountNzd: number;
  deadline: string | null;
  /** Savings account for this goal; its balance becomes the amount saved. Null = typed by hand. */
  accountId?: string | null;
};

export const MAX_NOTES_LENGTH = 500;

export type SavingsGoalProgress = {
  asOf: string;
  currency: 'NZD';
  timezone: 'Pacific/Auckland';
  remainingNzd: number;
  /** Percent, not a fraction. 25 means 25%. May exceed 100. */
  percentComplete: number;
  /** Whole days from asOf to deadline. Null when no deadline is stored. */
  daysRemaining: number | null;
  /** NZD per week. Null when a weekly pace is not defined. */
  requiredWeeklySavingNzd: number | null;
  /** NZD per month. Null when a monthly pace is not defined. */
  requiredMonthlySavingNzd: number | null;
  /** YYYY-MM-DD, or null when a completion date cannot be counted. */
  estimatedCompletion: string | null;
};

function utcDayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Whole calendar days from `fromIso` to `toIso` (to − from). */
export function calendarDaysBetween(fromIso: string, toIso: string): number | null {
  if (!isIsoDate(fromIso) || !isIsoDate(toIso)) return null;
  return utcDayNumber(toIso) - utcDayNumber(fromIso);
}

export function savingsGoalProgress(input: {
  targetNzd: number;
  currentAmountNzd: number;
  deadline: string | null;
  asOf: string;
}): SavingsGoalProgress {
  const target = roundMoney(input.targetNzd);
  const current = roundMoney(input.currentAmountNzd);
  const remainingNzd = roundMoney(Math.max(0, target - current));
  const percentComplete = target > 0 ? roundMoney((current / target) * 100) : 0;
  const deadline = input.deadline && isIsoDate(input.deadline) ? input.deadline : null;
  const daysRemaining =
    deadline && isIsoDate(input.asOf) ? calendarDaysBetween(input.asOf, deadline) : null;

  const base = {
    asOf: input.asOf,
    currency: 'NZD' as const,
    timezone: 'Pacific/Auckland' as const,
    remainingNzd,
    percentComplete,
    daysRemaining,
  };

  if (remainingNzd === 0) {
    return {
      ...base,
      requiredWeeklySavingNzd: 0,
      requiredMonthlySavingNzd: 0,
      estimatedCompletion: isIsoDate(input.asOf) ? input.asOf : null,
    };
  }

  if (daysRemaining == null || daysRemaining < 0) {
    return {
      ...base,
      requiredWeeklySavingNzd: null,
      requiredMonthlySavingNzd: null,
      estimatedCompletion: null,
    };
  }

  if (daysRemaining === 0) {
    return {
      ...base,
      requiredWeeklySavingNzd: remainingNzd,
      requiredMonthlySavingNzd: remainingNzd,
      estimatedCompletion: deadline,
    };
  }

  return {
    ...base,
    requiredWeeklySavingNzd: roundMoney((remainingNzd * WEEK_DAYS) / daysRemaining),
    requiredMonthlySavingNzd: roundMoney((remainingNzd * MEAN_MONTH_DAYS) / daysRemaining),
    estimatedCompletion: deadline,
  };
}

function asBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

function hasKey(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function parseName(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) return { ok: false, error: 'name is required' };
  return { ok: true, value: name };
}

function parseNotes(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: 'notes must be a string or null' };
  const notes = raw.trim();
  if (notes.length > MAX_NOTES_LENGTH) return { ok: false, error: `notes must be ${MAX_NOTES_LENGTH} characters or fewer` };
  return { ok: true, value: notes || null };
}

function parseAccountId(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string' || raw.trim().length > 100) return { ok: false, error: 'accountId must be a string or null' };
  return { ok: true, value: raw.trim() };
}

function parseMoney(
  raw: unknown,
  label: string,
  mode: 'positive' | 'non-negative',
): { ok: true; value: number } | { ok: false; error: string } {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim()
        ? Number(raw.trim())
        : Number.NaN;
  const fail = mode === 'positive'
    ? `${label} must be a positive number`
    : `${label} must be a non-negative number`;
  if (!Number.isFinite(n)) return { ok: false, error: fail };
  const value = roundMoney(n);
  if (mode === 'positive' ? !(value > 0) : value < 0) return { ok: false, error: fail };
  return { ok: true, value };
}

function parseDeadline(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: 'deadline must be YYYY-MM-DD or blank' };
  const value = raw.trim();
  if (!isIsoDate(value)) return { ok: false, error: 'deadline must be YYYY-MM-DD or blank' };
  return { ok: true, value };
}

export function parseCreateSavingsGoal(
  body: unknown,
): { ok: true; value: SavingsGoalInput } | { ok: false; error: string } {
  const b = asBody(body);
  const name = parseName(b.name);
  if (!name.ok) return name;
  const target = parseMoney(b.targetNzd, 'targetNzd', 'positive');
  if (!target.ok) return target;
  const current = hasKey(b, 'currentAmountNzd')
    ? parseMoney(b.currentAmountNzd, 'currentAmountNzd', 'non-negative')
    : { ok: true as const, value: 0 };
  if (!current.ok) return current;
  const deadline = hasKey(b, 'deadline')
    ? parseDeadline(b.deadline)
    : { ok: true as const, value: null };
  if (!deadline.ok) return deadline;
  const notes = hasKey(b, 'notes') ? parseNotes(b.notes) : { ok: true as const, value: null };
  if (!notes.ok) return notes;
  const accountId = hasKey(b, 'accountId') ? parseAccountId(b.accountId) : { ok: true as const, value: null };
  if (!accountId.ok) return accountId;
  return {
    ok: true,
    value: {
      name: name.value,
      notes: notes.value,
      targetNzd: target.value,
      currentAmountNzd: current.value,
      deadline: deadline.value,
      accountId: accountId.value,
    },
  };
}

export function parsePatchSavingsGoal(
  body: unknown,
): { ok: true; value: Partial<SavingsGoalInput> } | { ok: false; error: string } {
  const b = asBody(body);
  const patch: Partial<SavingsGoalInput> = {};
  if (hasKey(b, 'name')) {
    const name = parseName(b.name);
    if (!name.ok) return name;
    patch.name = name.value;
  }
  if (hasKey(b, 'notes')) {
    const notes = parseNotes(b.notes);
    if (!notes.ok) return notes;
    patch.notes = notes.value;
  }
  if (hasKey(b, 'targetNzd')) {
    const target = parseMoney(b.targetNzd, 'targetNzd', 'positive');
    if (!target.ok) return target;
    patch.targetNzd = target.value;
  }
  if (hasKey(b, 'currentAmountNzd')) {
    const current = parseMoney(b.currentAmountNzd, 'currentAmountNzd', 'non-negative');
    if (!current.ok) return current;
    patch.currentAmountNzd = current.value;
  }
  if (hasKey(b, 'deadline')) {
    const deadline = parseDeadline(b.deadline);
    if (!deadline.ok) return deadline;
    patch.deadline = deadline.value;
  }
  if (hasKey(b, 'accountId')) {
    const accountId = parseAccountId(b.accountId);
    if (!accountId.ok) return accountId;
    patch.accountId = accountId.value;
  }
  return { ok: true, value: patch };
}
