/**
 * Household PAYE (KAN-79): combined pay, tax and take-home for members who opt in.
 *
 * NZ taxes each person on their own; there's no joint filing. Each member is worked out
 * separately with the PAYE engine the PAYE page uses (src/lib/payeCalc.ts), for the tax year
 * being viewed, and the household figures are just the sum.
 *
 * - Opting in stores a member's PAYE inputs (and/or a flag to include their saved pay sources).
 *   Members who haven't opted in are never shown, not even by name.
 * - Owners and adults see each opted-in member's figures; viewers see household totals only.
 * - What-ifs (hours, salary, stopping work, KiwiSaver rate) are owners and adults only, since
 *   comparing totals would reveal one member's figures.
 * - The activity log never records amounts.
 * - Changing anything needs the household's Plus plan; opting out is always allowed.
 */
import type { Database } from 'sql.js';
import { queryAll, queryOne, run } from '../db/index.ts';
import { roundMoney } from '../debts/model.ts';
import { calculatePaye, type EmploymentKind, type PayFrequency, type PayeBreakdown } from '../../src/lib/payeCalc.ts';
import { CURRENT_PAY_TAX_YEAR, PAY_TAX_YEARS, PAY_TAX_YEAR_OPTIONS, payTaxYearRates } from '../../src/lib/payeRates.ts';
import { calculatePieceRate, outputPaySourceFigures, type OutputPaySourceInputs } from '../../src/lib/outputPayCalc.ts';
import { householdActive, logActivity, membershipOf, type Membership } from './store.ts';

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code?: string };
const fail = (status: number, error: string, code?: string): { ok: false; status: number; error: string; code?: string } => ({ ok: false, status, error, code });
const PLAN_REQUIRED = () => fail(402, 'Households are part of KoruLedger Plus.', 'PLAN_REQUIRED');

/** What a member shares: the PAYE page's main inputs. Payroll giving and investing credits aren't included. */
export type PayInputs = {
  amount: number;
  frequency: PayFrequency;
  hoursPerWeek: number;
  employment: EmploymentKind;
  secondaryTotalAnnualIncome: number;
  otherAnnualGross: number;
  kiwiSaverOptIn: boolean;
  kiwiSaverEmployeeRatePct: number;
  kiwiSaverEmployerRatePct: number;
  salarySacrifice: boolean;
  studentLoan: boolean;
  ietc: boolean;
};

/** Annual NZD. paye = income tax after IETC (ACC shown separately). */
export type PayFigures = { grossNzd: number; payeNzd: number; accNzd: number; kiwiSaverNzd: number; studentLoanNzd: number; netNzd: number };
export type PayLine = PayFigures & {
  label: string;
  kind: 'salary' | 'piece' | 'schedular' | 'share_of_catch';
  taxCode: string | null;
  onPaye: boolean;
  /** Income tax before credits (no ACC), and hours a week: for Working for Families. */
  incomeTaxNzd: number;
  hoursPerWeek: number;
};
export type MemberPay = { memberId: string; name: string; isMe: boolean; lines: PayLine[]; totals: PayFigures };

export type HouseholdPayeView = {
  taxYear: number;
  years: { startYear: number; label: string; current: boolean }[];
  /** Owners and adults: each opted-in member's figures and what-ifs. Viewers: totals only. */
  canSeeMembers: boolean;
  canEdit: boolean;
  active: boolean;
  members: MemberPay[];
  /** How many members are included (shown only with the totals, never who is missing). */
  includedCount: number;
  totals: PayFigures;
  netPerPeriod: { week: number; fortnight: number; month: number; year: number };
  mine: { optedIn: boolean; inputs: PayInputs | null; includePaySources: boolean; paySourceCount: number };
  feedBudget: boolean;
};

const FREQUENCIES: PayFrequency[] = ['hour', 'week', 'fortnight', 'month', 'year'];
const MAX_AMOUNT = 10_000_000;
const ZERO: PayFigures = { grossNzd: 0, payeNzd: 0, accNzd: 0, kiwiSaverNzd: 0, studentLoanNzd: 0, netNzd: 0 };

function numIn(raw: unknown, label: string, max: number): number | string {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : 0;
  if (!Number.isFinite(n) || n < 0 || n > max) return `${label} must be a number from 0 to ${max.toLocaleString('en-NZ')}`;
  return n;
}

export function parsePayInputs(raw: unknown): { ok: true; value: PayInputs } | { ok: false; error: string } {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'Enter your pay' };
  const frequency = o.frequency as PayFrequency;
  if (!FREQUENCIES.includes(frequency)) return { ok: false, error: 'Choose how often the amount is paid' };
  const nums: Record<string, number> = {};
  for (const [key, label, max] of [
    ['amount', 'Pay', MAX_AMOUNT],
    ['hoursPerWeek', 'Hours per week', 168],
    ['secondaryTotalAnnualIncome', 'Total annual income', MAX_AMOUNT],
    ['otherAnnualGross', 'Other annual pay', MAX_AMOUNT],
    ['kiwiSaverEmployeeRatePct', 'KiwiSaver rate', 100],
    ['kiwiSaverEmployerRatePct', 'Employer KiwiSaver rate', 100],
  ] as const) {
    const n = numIn(o[key], label, max);
    if (typeof n === 'string') return { ok: false, error: n };
    nums[key] = n;
  }
  if (!(nums.amount > 0)) return { ok: false, error: 'Enter your pay' };
  if (frequency === 'hour' && !(nums.hoursPerWeek > 0)) return { ok: false, error: 'Enter hours per week' };
  return {
    ok: true,
    value: {
      amount: nums.amount,
      frequency,
      hoursPerWeek: nums.hoursPerWeek,
      employment: o.employment === 'secondary' ? 'secondary' : 'primary',
      secondaryTotalAnnualIncome: nums.secondaryTotalAnnualIncome,
      otherAnnualGross: nums.otherAnnualGross,
      kiwiSaverOptIn: o.kiwiSaverOptIn === true,
      kiwiSaverEmployeeRatePct: nums.kiwiSaverEmployeeRatePct,
      kiwiSaverEmployerRatePct: nums.kiwiSaverEmployerRatePct,
      salarySacrifice: o.salarySacrifice === true,
      studentLoan: o.studentLoan === true,
      ietc: o.ietc === true,
    },
  };
}

/** A tax year with published rates; anything else is the current year. */
export function pickTaxYear(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && PAY_TAX_YEARS[n] ? n : CURRENT_PAY_TAX_YEAR;
}

function fromBreakdown(b: PayeBreakdown): PayFigures {
  return {
    grossNzd: b.annualGross,
    payeNzd: roundMoney(Math.max(0, b.payeNetOfCredits - b.acc)),
    accNzd: b.acc,
    kiwiSaverNzd: b.kiwiSaverEmployee,
    studentLoanNzd: b.studentLoan,
    netNzd: b.takeHome,
  };
}

function sum(list: PayFigures[]): PayFigures {
  const out = { ...ZERO };
  for (const f of list) for (const k of Object.keys(out) as (keyof PayFigures)[]) out[k] += f[k];
  for (const k of Object.keys(out) as (keyof PayFigures)[]) out[k] = roundMoney(out[k]);
  return out;
}

const PAY_TYPE_LABEL = { piece: 'Piece rate', schedular: 'Contract (schedular)', share_of_catch: 'Share of catch' } as const;

/** One member's pay for a tax year: their salary or wages, plus saved pay sources if they chose to include them. */
export function memberLines(db: Database, userId: string, inputs: PayInputs | null, includePaySources: boolean, taxYear: number): PayLine[] {
  const rates = payTaxYearRates(taxYear);
  const lines: PayLine[] = [];
  if (inputs) {
    const b = calculatePaye({ ...inputs, taxYear, payrollGivingAnnual: 0 });
    lines.push({ label: 'Salary or wages', kind: 'salary', taxCode: b.taxCode, onPaye: true, incomeTaxNzd: b.incomeTax, hoursPerWeek: inputs.hoursPerWeek || 40, ...fromBreakdown(b) });
  }
  if (includePaySources) {
    const rows = queryAll<{ name: string; inputs_json: string }>(db, `SELECT name, inputs_json FROM pay_sources WHERE user_id = ? ORDER BY created_at`, [userId]);
    for (const row of rows) {
      let src: OutputPaySourceInputs;
      try {
        src = JSON.parse(row.inputs_json) as OutputPaySourceInputs;
      } catch {
        continue;
      }
      const label = `${row.name} · ${PAY_TYPE_LABEL[src.payType] ?? 'Pay source'}`;
      if (src.payType === 'piece') {
        const p = calculatePieceRate(src.piece, src.paye, rates).paye;
        lines.push({ label, kind: 'piece', taxCode: p.taxCode, onPaye: true, incomeTaxNzd: p.incomeTax, hoursPerWeek: src.piece.hoursPerWeek || 0, ...fromBreakdown(p) });
      } else {
        // Contract and share-of-catch pay isn't taxed through payroll: gross and what's received only.
        const f = outputPaySourceFigures(src, rates);
        lines.push({ label, kind: src.payType, taxCode: null, onPaye: false, incomeTaxNzd: 0, hoursPerWeek: 0, ...ZERO, grossNzd: roundMoney(f.weeklyGross * 52), netNzd: roundMoney(f.weeklyNet * 52) });
      }
    }
  }
  return lines;
}

type PayRow = { user_id: string; inputs_json: string | null; include_pay_sources: number };

function readInputs(row: PayRow): PayInputs | null {
  if (!row.inputs_json) return null;
  try {
    return JSON.parse(row.inputs_json) as PayInputs;
  } catch {
    return null;
  }
}

function payRows(db: Database, householdId: string): PayRow[] {
  // Only current members: a row can't outlive membership, but join to be sure.
  return queryAll<PayRow>(
    db,
    `SELECT p.user_id, p.inputs_json, p.include_pay_sources FROM household_pay p
     JOIN household_members m ON m.household_id = p.household_id AND m.user_id = p.user_id
     WHERE p.household_id = ? ORDER BY m.joined_at`,
    [householdId],
  );
}

/** One member's shared pay for a tax year, or null when they don't share it. */
export function sharedPayOf(db: Database, householdId: string, userId: string, taxYear: number): PayLine[] | null {
  const row = payRows(db, householdId).find((r) => r.user_id === userId);
  return row ? memberLines(db, userId, readInputs(row), row.include_pay_sources === 1, taxYear) : null;
}

export function nameOf(db: Database, userId: string): string {
  const u = queryOne<{ first_name: string | null; last_name: string | null; email: string }>(db, `SELECT first_name, last_name, email FROM users WHERE id = ?`, [userId]);
  return u ? [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email.split('@')[0] : 'Member';
}

type Override = { memberId: string; inputs?: PayInputs | null; stop?: boolean };

function computeMembers(db: Database, householdId: string, viewerId: string, taxYear: number, override?: Override): MemberPay[] {
  const out: MemberPay[] = [];
  for (const row of payRows(db, householdId)) {
    const o = override && override.memberId === row.user_id ? override : null;
    if (o?.stop) continue;
    const inputs = o && o.inputs !== undefined ? o.inputs : readInputs(row);
    const lines = memberLines(db, row.user_id, inputs, row.include_pay_sources === 1, taxYear);
    out.push({ memberId: row.user_id, name: nameOf(db, row.user_id), isMe: row.user_id === viewerId, lines, totals: sum(lines) });
  }
  return out;
}

function perPeriod(annual: number) {
  return { week: roundMoney(annual / 52), fortnight: roundMoney(annual / 26), month: roundMoney(annual / 12), year: roundMoney(annual) };
}

const canEditRole = (m: Membership) => m.role === 'owner' || m.role === 'adult';

export function householdPaye(db: Database, userId: string, yearRaw?: unknown): Result<HouseholdPayeView> {
  const m = membershipOf(db, userId);
  if (!m) return fail(404, 'You are not in a household');
  const taxYear = pickTaxYear(yearRaw);
  const members = computeMembers(db, m.householdId, userId, taxYear);
  const totals = sum(members.map((x) => x.totals));
  const mineRow = queryOne<PayRow>(db, `SELECT user_id, inputs_json, include_pay_sources FROM household_pay WHERE household_id = ? AND user_id = ?`, [m.householdId, userId]);
  const paySourceCount = Number(queryOne<{ c: number }>(db, `SELECT COUNT(*) AS c FROM pay_sources WHERE user_id = ?`, [userId])?.c ?? 0);
  const settings = queryOne<{ feed_budget: number }>(db, `SELECT feed_budget FROM household_pay_settings WHERE household_id = ?`, [m.householdId]);
  const seeMembers = canEditRole(m);
  return {
    ok: true,
    value: {
      taxYear,
      years: PAY_TAX_YEAR_OPTIONS.map((y) => ({ startYear: y.startYear, label: y.label, current: y.startYear === CURRENT_PAY_TAX_YEAR })),
      canSeeMembers: seeMembers,
      canEdit: seeMembers && householdActive(db, m),
      active: householdActive(db, m),
      members: seeMembers ? members : [],
      includedCount: members.length,
      totals,
      netPerPeriod: perPeriod(totals.netNzd),
      mine: {
        optedIn: !!mineRow,
        inputs: mineRow ? readInputs(mineRow) : null,
        includePaySources: mineRow?.include_pay_sources === 1,
        paySourceCount,
      },
      feedBudget: settings?.feed_budget === 1,
    },
  };
}

/** Opt in, or change what you share. Body: { inputs: PayInputs | null, includePaySources: boolean }. */
export function setMyPay(db: Database, userId: string, body: unknown): Result<HouseholdPayeView> {
  const m = membershipOf(db, userId);
  if (!m) return fail(404, 'You are not in a household');
  if (!householdActive(db, m)) return PLAN_REQUIRED();
  const b = (body ?? {}) as { inputs?: unknown; includePaySources?: unknown };
  let inputs: PayInputs | null = null;
  if (b.inputs != null) {
    const p = parsePayInputs(b.inputs);
    if (!p.ok) return fail(400, p.error);
    inputs = p.value;
  }
  const includePaySources = b.includePaySources === true;
  if (!inputs && !includePaySources) return fail(400, 'Enter your pay or include your saved pay sources');
  const existed = queryOne(db, `SELECT 1 FROM household_pay WHERE household_id = ? AND user_id = ?`, [m.householdId, userId]);
  run(
    db,
    `INSERT INTO household_pay (household_id, user_id, inputs_json, include_pay_sources, updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(household_id, user_id) DO UPDATE SET inputs_json = excluded.inputs_json, include_pay_sources = excluded.include_pay_sources, updated_at = excluded.updated_at`,
    [m.householdId, userId, inputs ? JSON.stringify(inputs) : null, includePaySources ? 1 : 0, new Date().toISOString()],
  );
  // Never log amounts.
  logActivity(db, m.householdId, userId, existed ? 'updated the pay they share' : 'started sharing their pay');
  return householdPaye(db, userId);
}

/** Opt out. Always allowed, even without Plus. */
export function clearMyPay(db: Database, userId: string): Result<HouseholdPayeView> {
  const m = membershipOf(db, userId);
  if (!m) return fail(404, 'You are not in a household');
  const existed = queryOne(db, `SELECT 1 FROM household_pay WHERE household_id = ? AND user_id = ?`, [m.householdId, userId]);
  if (existed) {
    run(db, `DELETE FROM household_pay WHERE household_id = ? AND user_id = ?`, [m.householdId, userId]);
    logActivity(db, m.householdId, userId, 'stopped sharing their pay');
  }
  return householdPaye(db, userId);
}

/** Owners and adults: show combined take-home as the shared budgets' money in. */
export function setFeedBudget(db: Database, userId: string, body: unknown): Result<HouseholdPayeView> {
  const m = membershipOf(db, userId);
  if (!m) return fail(404, 'You are not in a household');
  if (!canEditRole(m)) return fail(403, 'Only adults can change this');
  if (!householdActive(db, m)) return PLAN_REQUIRED();
  const on = (body as { feedBudget?: unknown } | null)?.feedBudget === true;
  run(
    db,
    `INSERT INTO household_pay_settings (household_id, feed_budget, updated_at) VALUES (?,?,?)
     ON CONFLICT(household_id) DO UPDATE SET feed_budget = excluded.feed_budget, updated_at = excluded.updated_at`,
    [m.householdId, on ? 1 : 0, new Date().toISOString()],
  );
  logActivity(db, m.householdId, userId, on ? 'turned on take-home pay as budget money in' : 'turned off take-home pay as budget money in');
  return householdPaye(db, userId);
}

/** Combined take-home per month for this tax year, when the household feeds it into budgets; else null. */
export function budgetMoneyIn(db: Database, householdId: string): { monthlyNzd: number; includedCount: number } | null {
  const s = queryOne<{ feed_budget: number }>(db, `SELECT feed_budget FROM household_pay_settings WHERE household_id = ?`, [householdId]);
  if (s?.feed_budget !== 1) return null;
  const members = computeMembers(db, householdId, '', CURRENT_PAY_TAX_YEAR);
  return { monthlyNzd: roundMoney(sum(members.map((x) => x.totals)).netNzd / 12), includedCount: members.length };
}

export type WhatIfChange =
  | { kind: 'hours'; hoursPerWeek: number }
  | { kind: 'salary'; annualNzd: number }
  | { kind: 'stop' }
  | { kind: 'kiwisaver'; ratePct: number };

export type WhatIfResult = {
  taxYear: number;
  memberName: string;
  description: string;
  before: PayFigures;
  after: PayFigures;
  memberBefore: PayFigures;
  memberAfter: PayFigures;
  netChangePerPeriod: { week: number; fortnight: number; month: number; year: number };
  notes: string[];
};

/**
 * Owners and adults: how household take-home changes if one opted-in member changes their
 * hours, salary or KiwiSaver rate, or stops work. Changes apply to their salary or wages;
 * stopping work removes all of their pay, saved pay sources included.
 */
export function whatIf(db: Database, userId: string, body: unknown): Result<WhatIfResult> {
  const m = membershipOf(db, userId);
  if (!m) return fail(404, 'You are not in a household');
  if (!canEditRole(m)) return fail(403, 'Only adults can try what-ifs');
  const b = (body ?? {}) as { memberId?: unknown; taxYear?: unknown; change?: Record<string, unknown> };
  const taxYear = pickTaxYear(b.taxYear);
  const row = typeof b.memberId === 'string' ? payRows(db, m.householdId).find((r) => r.user_id === b.memberId) : undefined;
  if (!row) return fail(404, 'That member isn’t sharing their pay');
  const c = b.change ?? {};
  const current = readInputs(row);
  const name = nameOf(db, row.user_id);
  const notes: string[] = [];
  let override: Override;
  let description: string;
  if (c.kind === 'stop') {
    override = { memberId: row.user_id, stop: true };
    description = `${name} stops work`;
  } else {
    if (!current) return fail(400, `${name} shares only saved pay sources, so there’s no salary or wages to change`);
    const next = { ...current };
    if (c.kind === 'hours') {
      const h = Number(c.hoursPerWeek);
      if (!Number.isFinite(h) || h <= 0 || h > 168) return fail(400, 'Hours per week must be from 1 to 168');
      const was = current.hoursPerWeek > 0 ? current.hoursPerWeek : 40;
      if (current.frequency !== 'hour') {
        next.amount = (current.amount * h) / was;
        notes.push(`Pay is scaled from ${was} to ${h} hours a week.`);
      }
      next.hoursPerWeek = h;
      description = `${name} works ${h} hours a week`;
    } else if (c.kind === 'salary') {
      const a = Number(c.annualNzd);
      if (!Number.isFinite(a) || a <= 0 || a > MAX_AMOUNT) return fail(400, 'Enter a yearly salary');
      next.amount = a;
      next.frequency = 'year';
      description = `${name} earns ${a.toLocaleString('en-NZ', { style: 'currency', currency: 'NZD' })} a year`;
    } else if (c.kind === 'kiwisaver') {
      const r = Number(c.ratePct);
      const allowed = payTaxYearRates(taxYear).kiwiSaverEmployeeRates;
      if (r !== 0 && !allowed.includes(r)) return fail(400, `Choose a KiwiSaver rate of ${allowed.join('%, ')}%, or 0 for none`);
      next.kiwiSaverOptIn = r > 0;
      next.kiwiSaverEmployeeRatePct = r;
      description = r > 0 ? `${name} contributes ${r}% to KiwiSaver` : `${name} stops KiwiSaver contributions`;
    } else {
      return fail(400, 'Choose a what-if');
    }
    override = { memberId: row.user_id, inputs: next };
  }
  const beforeMembers = computeMembers(db, m.householdId, userId, taxYear);
  const afterMembers = computeMembers(db, m.householdId, userId, taxYear, override);
  const before = sum(beforeMembers.map((x) => x.totals));
  const after = sum(afterMembers.map((x) => x.totals));
  return {
    ok: true,
    value: {
      taxYear,
      memberName: name,
      description,
      before,
      after,
      memberBefore: beforeMembers.find((x) => x.memberId === row.user_id)?.totals ?? ZERO,
      memberAfter: afterMembers.find((x) => x.memberId === row.user_id)?.totals ?? ZERO,
      netChangePerPeriod: perPeriod(after.netNzd - before.netNzd),
      notes,
    },
  };
}
