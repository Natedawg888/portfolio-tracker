/**
 * Debt interest schedule and payoff projection.
 * Every figure comes from the caller. This module has no sample balances,
 * rates, or payments.
 *
 * Interest rate is an annual percent the user entered (12.5 means 12.5% per year).
 * Monthly: at the start of each month, add balance × rate / 100 / 12.
 * Yearly: at the start of each year (1 January), add balance × rate / 100.
 * A period is skipped when no rate is saved yet, so a rate entered later is not
 * written backwards onto earlier period starts.
 */

export const DEBT_PRODUCT_KINDS = [
  'credit_card',
  'personal_loan',
  'student_loan',
  'car_loan',
  'mortgage',
  'bnpl',
] as const;

export type DebtProductKind = (typeof DEBT_PRODUCT_KINDS)[number];
export type InterestPeriod = 'month' | 'year';
export type CreditorKind = 'person' | 'corporation';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DebtInput = {
  name: string;
  kind: CreditorKind;
  notes: string | null;
  outstandingNzd: number;
  productKind: DebtProductKind | null;
  isLoan: boolean;
  interestPeriod: InterestPeriod | null;
  interestRatePercent: number | null;
  minimumPaymentNzd: number | null;
  actualPaymentNzd: number | null;
  remainingTermMonths: number | null;
  interestPaidNzd: number | null;
};

export type PayoffProjection =
  | { kind: 'blank' }
  | { kind: 'does_not_pay_down' }
  | { kind: 'debt_free'; years: number; months: number; totalMonths: number };

export type InterestRollInput = {
  balance: number;
  annualRatePercent: number | null;
  interestPeriod: InterestPeriod | null;
  /** Last date already considered. Null until a rate and period are both saved. */
  postedThrough: string | null;
  asOf: string;
};

export type InterestRollResult = {
  balance: number;
  interestAdded: number;
  postedThrough: string | null;
  appliedStarts: string[];
};

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function parseUtc(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatUtcDate(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  const dt = parseUtc(iso);
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatUtcDate(dt);
}

/** Pacific/Auckland calendar date as YYYY-MM-DD. */
export function aucklandToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

export function monthBounds(asOf: string): { from: string; to: string; yearMonth: string } | null {
  if (!isIsoDate(asOf)) return null;
  const [y, m] = asOf.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return {
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(last).padStart(2, '0')}`,
    yearMonth: `${y}-${mm}`,
  };
}

export function isPeriodStart(iso: string, period: InterestPeriod): boolean {
  if (!isIsoDate(iso)) return false;
  const [, month, day] = iso.split('-').map(Number);
  if (day !== 1) return false;
  if (period === 'month') return true;
  return month === 1;
}

/** First period start strictly after `afterExclusive`. */
export function nextPeriodStart(afterExclusive: string, period: InterestPeriod): string {
  const dt = parseUtc(afterExclusive);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth();
  if (period === 'year') {
    const jan1 = `${y}-01-01`;
    if (jan1 > afterExclusive) return jan1;
    return `${y + 1}-01-01`;
  }
  const firstThisMonth = formatUtcDate(new Date(Date.UTC(y, m, 1)));
  if (firstThisMonth > afterExclusive) return firstThisMonth;
  return formatUtcDate(new Date(Date.UTC(y, m + 1, 1)));
}

/**
 * When a schedule is first saved on a period-start day, the cursor sits on the
 * day before so that start can still be posted. On any other day the cursor is
 * today, which leaves earlier starts in the same period unposted.
 */
export function seedPostedThrough(asOf: string, period: InterestPeriod): string {
  if (isPeriodStart(asOf, period)) return addDays(asOf, -1);
  return asOf;
}

export function periodStartsAfter(
  afterExclusive: string,
  throughInclusive: string,
  period: InterestPeriod,
): string[] {
  if (!isIsoDate(afterExclusive) || !isIsoDate(throughInclusive)) return [];
  const out: string[] = [];
  let cursor = nextPeriodStart(afterExclusive, period);
  while (cursor <= throughInclusive) {
    out.push(cursor);
    cursor = nextPeriodStart(cursor, period);
  }
  return out;
}

export function interestForPeriod(
  balance: number,
  annualRatePercent: number,
  period: InterestPeriod,
): number {
  if (!(balance > 0) || !(annualRatePercent > 0)) return 0;
  const fraction = annualRatePercent / 100;
  const raw = period === 'month' ? (balance * fraction) / 12 : balance * fraction;
  return roundMoney(raw);
}

export function rollScheduledInterest(input: InterestRollInput): InterestRollResult {
  const balance = Number.isFinite(input.balance) ? roundMoney(input.balance) : 0;
  const period = input.interestPeriod;
  const unchanged: InterestRollResult = {
    balance,
    interestAdded: 0,
    postedThrough: input.postedThrough,
    appliedStarts: [],
  };
  if (period == null || !isIsoDate(input.asOf)) return unchanged;

  const rate = input.annualRatePercent;
  const rateReady = rate != null && Number.isFinite(rate) && rate >= 0;
  let through = input.postedThrough && isIsoDate(input.postedThrough)
    ? input.postedThrough
    : seedPostedThrough(input.asOf, period);

  if (!rateReady) {
    // No saved rate: step past period starts that are already over, and hold
    // the cursor only when today itself is the start still waiting for a rate.
    const pending = periodStartsAfter(through, input.asOf, period);
    for (const start of pending) {
      if (start < input.asOf) through = start;
    }
    const heldForToday = pending.some((start) => start === input.asOf);
    if (!heldForToday && input.asOf > through) through = input.asOf;
    return { balance, interestAdded: 0, postedThrough: through, appliedStarts: [] };
  }

  const starts = periodStartsAfter(through, input.asOf, period);
  let nextBalance = balance;
  let added = 0;
  for (const start of starts) {
    const interest = interestForPeriod(nextBalance, rate, period);
    nextBalance = roundMoney(nextBalance + interest);
    added = roundMoney(added + interest);
    through = start;
  }
  if (input.asOf > through) through = input.asOf;
  return {
    balance: nextBalance,
    interestAdded: added,
    postedThrough: through,
    appliedStarts: starts,
  };
}

export function debtToIncomeRatio(
  actualPaymentNzd: number | null,
  recordedIncomeNzd: number | null,
): number | null {
  if (actualPaymentNzd == null || recordedIncomeNzd == null) return null;
  if (!Number.isFinite(actualPaymentNzd) || !Number.isFinite(recordedIncomeNzd)) return null;
  if (recordedIncomeNzd <= 0) return null;
  return actualPaymentNzd / recordedIncomeNzd;
}

export function formatYearMonthSpan(years: number, months: number): string {
  const parts: string[] = [];
  if (years === 1) parts.push('1 year');
  else if (years > 1) parts.push(`${years} years`);
  if (months === 1) parts.push('1 month');
  else if (months > 1) parts.push(`${months} months`);
  if (parts.length === 0) return '0 months';
  return parts.join(' ');
}

/**
 * Forward payoff from the balance, annual rate, and actual monthly payment
 * passed in. Interest is added at the start of each projected month, or at
 * the start of each projected year, before that month's payment.
 */
export function projectPayoff(input: {
  balance: number | null;
  annualRatePercent: number | null;
  actualPayment: number | null;
  interestPeriod: InterestPeriod | null;
}): PayoffProjection {
  const balance = input.balance;
  if (balance == null || !Number.isFinite(balance)) return { kind: 'blank' };
  if (balance <= 0) return { kind: 'debt_free', years: 0, months: 0, totalMonths: 0 };

  const payment = input.actualPayment;
  if (payment == null || !Number.isFinite(payment)) return { kind: 'blank' };

  const period = input.interestPeriod;
  const rate = input.annualRatePercent;
  if (period && (rate == null || !Number.isFinite(rate))) return { kind: 'blank' };
  if (rate != null && rate < 0) return { kind: 'blank' };
  if (!(payment > 0)) return { kind: 'does_not_pay_down' };

  const activeRate = period && rate != null ? rate : 0;
  if (period === 'month' && activeRate > 0) {
    const interest = interestForPeriod(balance, activeRate, 'month');
    if (payment <= interest) return { kind: 'does_not_pay_down' };
  }
  if (period === 'year' && activeRate > 0) {
    const interest = interestForPeriod(balance, activeRate, 'year');
    if (roundMoney(payment * 12) <= interest) return { kind: 'does_not_pay_down' };
  }

  let remaining = roundMoney(balance);
  let monthsElapsed = 0;
  const maxMonths = 100 * 12;
  while (remaining > 0.004 && monthsElapsed < maxMonths) {
    if (period === 'month' && activeRate > 0) {
      remaining = roundMoney(remaining + interestForPeriod(remaining, activeRate, 'month'));
    } else if (period === 'year' && activeRate > 0 && monthsElapsed % 12 === 0) {
      remaining = roundMoney(remaining + interestForPeriod(remaining, activeRate, 'year'));
    }
    monthsElapsed += 1;
    if (remaining <= payment) {
      remaining = 0;
      break;
    }
    remaining = roundMoney(remaining - payment);
  }
  if (remaining > 0.004) return { kind: 'does_not_pay_down' };
  return {
    kind: 'debt_free',
    years: Math.floor(monthsElapsed / 12),
    months: monthsElapsed % 12,
    totalMonths: monthsElapsed,
  };
}

export function payoffSentence(projection: PayoffProjection): string | null {
  if (projection.kind === 'blank') return null;
  if (projection.kind === 'does_not_pay_down') {
    return 'At your current repayment rate: this debt does not pay down.';
  }
  if (projection.years === 0 && projection.months === 0) return 'Debt-free now.';
  return `At your current repayment rate: Debt-free in ${formatYearMonthSpan(projection.years, projection.months)}.`;
}

export function normaliseCreditorKind(raw: unknown): CreditorKind {
  const k = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (k === 'corporation' || k === 'company' || k === 'corp') return 'corporation';
  return 'person';
}

export function parseProductKind(
  raw: unknown,
): { ok: true; value: DebtProductKind | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') {
    return { ok: false, error: 'productKind must be a debt kind or blank' };
  }
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, DebtProductKind> = {
    credit_card: 'credit_card',
    creditcard: 'credit_card',
    personal_loan: 'personal_loan',
    personalloan: 'personal_loan',
    student_loan: 'student_loan',
    studentloan: 'student_loan',
    car_loan: 'car_loan',
    carloan: 'car_loan',
    auto_loan: 'car_loan',
    mortgage: 'mortgage',
    bnpl: 'bnpl',
    buy_now_pay_later: 'bnpl',
  };
  const kind = aliases[v];
  if (!kind) {
    return {
      ok: false,
      error: 'productKind must be credit_card, personal_loan, student_loan, car_loan, mortgage, or bnpl',
    };
  }
  return { ok: true, value: kind };
}

export function parseInterestPeriod(
  raw: unknown,
): { ok: true; value: InterestPeriod | null } | { ok: false; error: string } {
  if (raw == null || raw === '' || raw === 'none') return { ok: true, value: null };
  if (typeof raw !== 'string') {
    return { ok: false, error: 'interestPeriod must be month, year, or blank' };
  }
  const v = raw.trim().toLowerCase();
  if (v === 'month' || v === 'monthly') return { ok: true, value: 'month' };
  if (v === 'year' || v === 'yearly' || v === 'annual') return { ok: true, value: 'year' };
  if (v === 'none' || v === 'no') return { ok: true, value: null };
  return { ok: false, error: 'interestPeriod must be month, year, or blank' };
}

function parseRequiredAmount(
  raw: unknown,
  label: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: `${label} must be a non-negative number` };
  }
  return { ok: true, value: roundMoney(n) };
}

function parseOptionalAmount(
  raw: unknown,
  label: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null };
  const parsed = parseRequiredAmount(raw, label);
  if (!parsed.ok) return { ok: false, error: `${label} must be a non-negative number or blank` };
  return parsed;
}

function parseOptionalRate(
  raw: unknown,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const parsed = parseOptionalAmount(raw, 'interestRatePercent');
  if (!parsed.ok) return parsed;
  if (parsed.value != null && parsed.value > 100) {
    return { ok: false, error: 'interestRatePercent must be between 0 and 100, or blank' };
  }
  return parsed;
}

function parseOptionalMonths(
  raw: unknown,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null };
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) {
    return { ok: false, error: 'remainingTermMonths must be a whole number of months or blank' };
  }
  return { ok: true, value: n };
}

function parseIsLoan(raw: unknown): { ok: true; value: boolean } | { ok: false; error: string } {
  if (typeof raw === 'boolean') return { ok: true, value: raw };
  return { ok: false, error: 'isLoan must be true or false' };
}

function hasKey(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function asBody(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

export function parseCreateDebt(
  body: unknown,
): { ok: true; value: DebtInput } | { ok: false; error: string } {
  const b = asBody(body);
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return { ok: false, error: 'name is required' };
  const outstanding = parseRequiredAmount(b.outstandingNzd ?? 0, 'outstandingNzd');
  if (!outstanding.ok) return outstanding;
  const product = parseProductKind(hasKey(b, 'productKind') ? b.productKind : null);
  if (!product.ok) return product;
  const period = parseInterestPeriod(hasKey(b, 'interestPeriod') ? b.interestPeriod : null);
  if (!period.ok) return period;
  const rate = parseOptionalRate(hasKey(b, 'interestRatePercent') ? b.interestRatePercent : null);
  if (!rate.ok) return rate;
  const minimum = parseOptionalAmount(
    hasKey(b, 'minimumPaymentNzd') ? b.minimumPaymentNzd : null,
    'minimumPaymentNzd',
  );
  if (!minimum.ok) return minimum;
  const actual = parseOptionalAmount(
    hasKey(b, 'actualPaymentNzd') ? b.actualPaymentNzd : null,
    'actualPaymentNzd',
  );
  if (!actual.ok) return actual;
  const term = parseOptionalMonths(hasKey(b, 'remainingTermMonths') ? b.remainingTermMonths : null);
  if (!term.ok) return term;
  const interestPaid = parseOptionalAmount(
    hasKey(b, 'interestPaidNzd') ? b.interestPaidNzd : null,
    'interestPaidNzd',
  );
  if (!interestPaid.ok) return interestPaid;
  let isLoan = false;
  if (hasKey(b, 'isLoan')) {
    const parsed = parseIsLoan(b.isLoan);
    if (!parsed.ok) return parsed;
    isLoan = parsed.value;
  }
  const notes =
    typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim() : null;
  return {
    ok: true,
    value: {
      name,
      kind: normaliseCreditorKind(b.kind ?? b.type),
      notes,
      outstandingNzd: outstanding.value,
      productKind: product.value,
      isLoan,
      interestPeriod: period.value,
      interestRatePercent: rate.value,
      minimumPaymentNzd: minimum.value,
      actualPaymentNzd: actual.value,
      remainingTermMonths: term.value,
      interestPaidNzd: interestPaid.value,
    },
  };
}

export function parsePatchDebt(
  body: unknown,
): { ok: true; value: Partial<DebtInput> } | { ok: false; error: string } {
  const b = asBody(body);
  const patch: Partial<DebtInput> = {};
  if (hasKey(b, 'name')) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) return { ok: false, error: 'name is required' };
    patch.name = name;
  }
  if (hasKey(b, 'kind') || hasKey(b, 'type')) {
    patch.kind = normaliseCreditorKind(hasKey(b, 'kind') ? b.kind : b.type);
  }
  if (hasKey(b, 'notes')) {
    if (b.notes != null && typeof b.notes !== 'string') {
      return { ok: false, error: 'notes must be a string or null' };
    }
    patch.notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim() : null;
  }
  if (hasKey(b, 'outstandingNzd')) {
    const outstanding = parseRequiredAmount(b.outstandingNzd, 'outstandingNzd');
    if (!outstanding.ok) return outstanding;
    patch.outstandingNzd = outstanding.value;
  }
  if (hasKey(b, 'productKind')) {
    const product = parseProductKind(b.productKind);
    if (!product.ok) return product;
    patch.productKind = product.value;
  }
  if (hasKey(b, 'isLoan')) {
    const parsed = parseIsLoan(b.isLoan);
    if (!parsed.ok) return parsed;
    patch.isLoan = parsed.value;
  }
  if (hasKey(b, 'interestPeriod')) {
    const period = parseInterestPeriod(b.interestPeriod);
    if (!period.ok) return period;
    patch.interestPeriod = period.value;
  }
  if (hasKey(b, 'interestRatePercent')) {
    const rate = parseOptionalRate(b.interestRatePercent);
    if (!rate.ok) return rate;
    patch.interestRatePercent = rate.value;
  }
  if (hasKey(b, 'minimumPaymentNzd')) {
    const minimum = parseOptionalAmount(b.minimumPaymentNzd, 'minimumPaymentNzd');
    if (!minimum.ok) return minimum;
    patch.minimumPaymentNzd = minimum.value;
  }
  if (hasKey(b, 'actualPaymentNzd')) {
    const actual = parseOptionalAmount(b.actualPaymentNzd, 'actualPaymentNzd');
    if (!actual.ok) return actual;
    patch.actualPaymentNzd = actual.value;
  }
  if (hasKey(b, 'remainingTermMonths')) {
    const term = parseOptionalMonths(b.remainingTermMonths);
    if (!term.ok) return term;
    patch.remainingTermMonths = term.value;
  }
  if (hasKey(b, 'interestPaidNzd')) {
    const interestPaid = parseOptionalAmount(b.interestPaidNzd, 'interestPaidNzd');
    if (!interestPaid.ok) return interestPaid;
    patch.interestPaidNzd = interestPaid.value;
  }
  return { ok: true, value: patch };
}
