/**
 * Debt interest schedule and payoff projection, shared by the server (posting
 * interest, payoff text) and the Debts page (timeline, "What if I paid…").
 * server/debts/model.ts re-exports everything here and adds the request parsers.
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

export type DebtMonthStep = {
  balance: number;
  interestAdded: number;
  paymentApplied: number;
};

/**
 * One month of the payoff loop. Interest is added first (every month, or on
 * month indexes 0, 12, 24, … when interest is yearly), then the payment.
 * `monthsElapsed` is how many months have already been applied.
 */
export function advanceDebtOneMonth(input: {
  balance: number;
  annualRatePercent: number;
  actualPayment: number;
  interestPeriod: InterestPeriod | null;
  monthsElapsed: number;
}): DebtMonthStep {
  const before = roundMoney(input.balance);
  if (!(before > 0)) {
    return { balance: 0, interestAdded: 0, paymentApplied: 0 };
  }
  let remaining = before;
  const period = input.interestPeriod;
  const rate = input.annualRatePercent;
  if (period === 'month' && rate > 0) {
    remaining = roundMoney(remaining + interestForPeriod(remaining, rate, 'month'));
  } else if (period === 'year' && rate > 0 && input.monthsElapsed % 12 === 0) {
    remaining = roundMoney(remaining + interestForPeriod(remaining, rate, 'year'));
  }
  const interestAdded = roundMoney(remaining - before);
  const payment = input.actualPayment;
  if (!(payment > 0)) {
    return { balance: remaining, interestAdded, paymentApplied: 0 };
  }
  if (remaining <= payment) {
    return { balance: 0, interestAdded, paymentApplied: remaining };
  }
  return {
    balance: roundMoney(remaining - payment),
    interestAdded,
    paymentApplied: payment,
  };
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
    remaining = advanceDebtOneMonth({
      balance: remaining,
      annualRatePercent: activeRate,
      actualPayment: payment,
      interestPeriod: period,
      monthsElapsed,
    }).balance;
    monthsElapsed += 1;
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

export type PayoffSchedule =
  | { kind: 'blank' }
  | { kind: 'does_not_pay_down' }
  | {
      kind: 'schedule';
      /** Payment applied in each projected month, in order. The last may be smaller. */
      payments: number[];
      totalMonths: number;
    };

/**
 * The months projectPayoff counts, with the payment applied in each. Uses
 * projectPayoff for the blank / does-not-pay-down decision and
 * advanceDebtOneMonth for every month, so the two always agree.
 */
export function payoffSchedule(input: Parameters<typeof projectPayoff>[0]): PayoffSchedule {
  const projection = projectPayoff(input);
  if (projection.kind !== 'debt_free') return projection;
  const period = input.interestPeriod;
  const activeRate = period && input.annualRatePercent != null ? input.annualRatePercent : 0;
  const payments: number[] = [];
  let remaining = roundMoney(input.balance ?? 0);
  for (let monthsElapsed = 0; monthsElapsed < projection.totalMonths; monthsElapsed++) {
    const step = advanceDebtOneMonth({
      balance: remaining,
      annualRatePercent: activeRate,
      actualPayment: input.actualPayment ?? 0,
      interestPeriod: period,
      monthsElapsed,
    });
    payments.push(step.paymentApplied);
    remaining = step.balance;
  }
  return { kind: 'schedule', payments, totalMonths: projection.totalMonths };
}

/**
 * End-month assumption. No payment day is stored on a debt, so the first
 * projected payment is taken to fall in the month after `todayYmd`; payment N
 * then falls N − 1 months after that. Returns YYYY-MM.
 */
export function projectedPaymentMonth(todayYmd: string, paymentNumber: number): string {
  const [y, m] = todayYmd.split('-').map(Number);
  // Month index of the first payment = next month; then one month per payment.
  const index = y * 12 + (m - 1) + 1 + Math.max(0, paymentNumber - 1);
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Smallest monthly payment that more than covers the interest, as projectPayoff tests it. */
export function interestFloorPerMonth(
  balance: number,
  annualRatePercent: number | null,
  interestPeriod: InterestPeriod | null,
): number {
  if (!interestPeriod || annualRatePercent == null || !(annualRatePercent > 0)) return 0;
  if (interestPeriod === 'month') return interestForPeriod(balance, annualRatePercent, 'month');
  return roundMoney(interestForPeriod(balance, annualRatePercent, 'year') / 12);
}

export type PaymentSliderRange = {
  /** Dollars per slider step. */
  step: number;
  /** Slider positions relative to the current payment (0 = current). */
  minOffset: number;
  maxOffset: number;
};

/**
 * "What if I paid…" slider. Positions are whole steps away from the current
 * payment, so position 0 is always exactly the saved payment.
 *   step: $5 under $200 a month, $10 under $1,000, else $50.
 *   lowest: the first step above the interest floor (and at least one step).
 *   highest: 3 × the current payment or the balance, whichever is smaller —
 *            never below the current payment.
 */
export function paymentSliderRange(input: {
  currentPayment: number;
  balance: number;
  annualRatePercent: number | null;
  interestPeriod: InterestPeriod | null;
}): PaymentSliderRange | null {
  const current = input.currentPayment;
  if (!(current > 0) || !(input.balance > 0)) return null;
  const step = current < 200 ? 5 : current < 1000 ? 10 : 50;
  const floor = Math.max(interestFloorPerMonth(input.balance, input.annualRatePercent, input.interestPeriod), 0);
  const lowest = Math.max(step, floor + 0.01);
  const minOffset = Math.min(0, Math.ceil((lowest - current) / step));
  const highest = Math.max(current, Math.min(current * 3, input.balance));
  const maxOffset = Math.max(0, Math.floor((highest - current) / step));
  return { step, minOffset, maxOffset };
}

export function sliderPayment(current: number, range: PaymentSliderRange, offset: number): number {
  return roundMoney(current + offset * range.step);
}
