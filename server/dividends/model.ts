/**
 * Dividend record maths.
 * Totals, yield, and growth use only amounts the user stored.
 * The forecast repeats published Yahoo Finance dividend history for a stock
 * or ETF the same user holds, through the next 12 months. Each amount is the
 * last published cash dividend per share times a projected share count.
 * That count starts at the shares they own. Reinvest on spends that payment's
 * net cash on more of the same holding inside the forecast only, so later
 * predicted payments compound. The stored holding quantity is not changed.
 * Missing figures stay missing. Missing FX rates stay missing. A share price
 * is never invented. Imputation credits are not cash. This is not advice.
 */

export type DividendRecord = {
  id: string;
  holdingId: string | null;
  companyName: string;
  symbol: string | null;
  sharesHeld: number;
  dividendPerShare: number;
  grossDividend: number;
  taxWithholding: number;
  imputationCredits: number;
  netDividend: number;
  paymentDate: string;
  currency: string;
  fxRateToNzd: number | null;
  reinvested: boolean;
  reinvestedAmount: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HoldingValueInput = {
  id: string;
  name: string;
  symbol: string | null;
  shares: number | null;
  costBasisNzd: number | null;
  /** NZD per share from a saved quote with status ok. Never a guessed price. */
  quotedPriceNzd: number | null;
};

/** One cash dividend Yahoo Finance published for a symbol. Amounts are per share. */
export type PublishedDividendPayment = {
  date: string;
  amountPerShare: number;
};

/** Dividend events parsed from the Yahoo chart this app already uses for equity prices. */
export type PublishedDividendSeries = {
  source: 'yahoo';
  currency: string;
  payments: PublishedDividendPayment[];
};

export type ReinvestmentStatus = 'off' | 'applied' | 'unavailable';

/**
 * What one reinvest toggle did to the forecast.
 * `applied` adds `sharesAdded` to later predicted payments of the same holding.
 * `unavailable` leaves the projected share count unchanged.
 */
export type ReinvestmentEffect = {
  status: ReinvestmentStatus;
  /** Extra shares this payment adds for later predicted payments. Null when it does not. */
  sharesAdded: number | null;
  pricePerShareNzd: number | null;
  /** `quote` is a saved NZD quote. `cost` is cost basis divided by shares owned. */
  priceSource: 'quote' | 'cost' | null;
  note: string | null;
};

export const REINVEST_OFF: ReinvestmentEffect = {
  status: 'off',
  sharesAdded: null,
  pricePerShareNzd: null,
  priceSource: null,
  note: null,
};

export const REINVEST_NO_PRICE_NOTE =
  'Reinvestment could not be applied. There is no saved quote or recorded price to turn this net cash into shares.';

export const REINVEST_NO_FX_NOTE =
  'Reinvestment could not be applied. There is no FX rate to turn this net cash into shares.';

export const REINVEST_UNLINKED_NOTE =
  'Reinvestment could not be applied. This payment is not linked to a holding, so it cannot buy more of the same holding.';

/** Predicted payments run from the day after today through this many months. */
export const DIVIDEND_FORECAST_HORIZON_MONTHS = 12;

/**
 * One predicted payment for a holding, taken from published dividend history.
 * `projected` repeats the gap the published dates already showed.
 * `published` uses a future date and amount the source itself listed.
 * `sharesHeld` is the projected share count used for this payment.
 * `ownedShares` is the quantity stored on the holding and is not changed here.
 */
export type DetectedDividend = {
  /** Stable id for this forecast row: holding id, a colon, then the payment date. */
  id: string;
  holdingId: string;
  name: string;
  symbol: string;
  dividendPerShare: number;
  /** Projected shares used for this payment's cash amount. */
  sharesHeld: number;
  /** Shares stored on the holding. Reinvestment does not change this. */
  ownedShares: number;
  /** Same as sharesHeld. Named so the forecast count is obvious beside owned shares. */
  projectedShares: number;
  /** Shares times the published cash dividend per share. Tax is not estimated. */
  amount: number;
  currency: string;
  amountNzd: number | null;
  fxRateToNzd: number | null;
  lastPaidDate: string;
  paymentDate: string;
  /** 1, 3, 6, or 12 when the date was projected from that gap. Null when the date was published. */
  intervalMonths: 1 | 3 | 6 | 12 | null;
  historyCount: number;
  basis: 'projected' | 'published';
  source: 'yahoo';
  /** On spends this payment's net cash on more of the same holding inside the forecast. */
  reinvested: boolean;
  reinvestment: ReinvestmentEffect;
};

export type DividendView = DividendRecord & {
  netNzd: number | null;
  reinvestment: ReinvestmentEffect;
};

/** `holdingId:paymentDate` identifies one forecast row for the reinvest toggle. */
export function forecastReinvestKey(holdingId: string, paymentDate: string): string {
  return `${holdingId}:${paymentDate}`;
}

export type ComputedDividend = {
  sharesHeld: number;
  dividendPerShare: number;
  grossDividend: number;
  taxWithholding: number;
  imputationCredits: number;
  netDividend: number;
  paymentDate: string;
  currency: string;
  fxRateToNzd: number | null;
  reinvested: boolean;
  reinvestedAmount: number | null;
};

export type MonthTotal = {
  yearMonth: string;
  label: string;
  netNzd: number | null;
  paidCount: number;
  unconvertedCount: number;
};

export type YearTotal = {
  year: number;
  netNzd: number | null;
  paidCount: number;
  unconvertedCount: number;
};

export type DividendDashboard = {
  year: number;
  today: string;
  disclaimer: string;
  hasEvents: boolean;
  yearIncomeNzd: number | null;
  yearPaidCount: number;
  yearUnconvertedCount: number;
  month: MonthTotal | null;
  months: MonthTotal[];
  annual: YearTotal[];
  growth: {
    available: boolean;
    fromYear: number;
    toYear: number;
    /** Inclusive end of the prior-year window (1 Jan through this date). */
    previousThrough: string | null;
    /** Inclusive end of the selected-year window (1 Jan through this date). */
    currentThrough: string | null;
    previousNzd: number | null;
    currentNzd: number | null;
    changePct: number | null;
    note: string;
  };
  yield: {
    available: boolean;
    trailingNetNzd: number | null;
    denominatorNzd: number | null;
    yieldPct: number | null;
    basis: 'quote' | 'cost' | 'mixed' | null;
    note: string;
  };
  forecast: {
    heading: string;
    historyRunRateNzd: number | null;
    historyCount: number;
    historyWindowStart: string;
    statedUpcomingNzd: number | null;
    statedUpcomingCount: number;
    statedUnconvertedCount: number;
    /** Next payments projected from published history for this user's stock and ETF holdings. */
    detected: DetectedDividend[];
    detectedNzd: number | null;
    detectedCount: number;
    detectedUnconvertedCount: number;
    note: string;
  };
  upcoming: DividendView[];
  history: DividendView[];
};

export const DIVIDEND_DISCLAIMER =
  'Personal record of dividends you enter. Totals use your amounts and the FX rates you record. ' +
  'The forecast repeats your own history, adds up payments you stated, or projects payments over the next 12 months from published dividend history on stocks and ETFs you hold. ' +
  'Reinvest on buys more of the same holding inside that forecast only. It does not change the shares you own. ' +
  'It is not financial advice and it is not a market forecast.';

export const DIVIDEND_FORECAST_NOTE =
  'The history figure repeats net dividends you already recorded over the last 12 months. ' +
  'Upcoming amounts are only payments you entered yourself. ' +
  'A stock or ETF you hold is added only when Yahoo Finance has published a dividend for it. ' +
  'Predicted payments cover the next 12 months. The date repeats the gap between those published dates, and the amount is the last cash dividend per share times a projected share count. ' +
  'The projected share count starts at the shares you own. Reinvest does not change that stored quantity. ' +
  'When reinvest is on, that payment\'s net cash buys more of the same holding, and later predicted payments use the extra shares. ' +
  'Reinvestment is left unchanged when there is no saved quote or recorded price. ' +
  'A holding is left out when that source has no dividend figure. A payment you already entered is not repeated; later predicted payments for that holding can still appear. ' +
  'Forecast rows are not saved as dividend or income records. ' +
  'This is not financial advice and it is not a market forecast.';

const MONEY_EPS = 1e-6;

export function todayAucklandYmd(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

export function isYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Shift a calendar date by whole months, clamping the day to the target month. */
export function shiftMonths(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + delta, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  const out = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day));
  const yy = out.getUTCFullYear();
  const mm = String(out.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(out.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, 1));
  return new Intl.DateTimeFormat('en-NZ', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function netInNzd(netDividend: number, fxRateToNzd: number | null): number | null {
  if (fxRateToNzd == null || !(fxRateToNzd > 0) || !Number.isFinite(netDividend)) return null;
  return netDividend * fxRateToNzd;
}

export function computeDividend(raw: {
  sharesHeld: unknown;
  dividendPerShare: unknown;
  taxWithholding?: unknown;
  imputationCredits?: unknown;
  paymentDate: unknown;
  currency?: unknown;
  fxRateToNzd?: unknown;
  reinvested?: unknown;
  reinvestedAmount?: unknown;
}): { ok: true; value: ComputedDividend } | { ok: false; error: string } {
  const sharesHeld = finiteNumber(raw.sharesHeld);
  const dividendPerShare = finiteNumber(raw.dividendPerShare);
  const taxWithholding = raw.taxWithholding == null || raw.taxWithholding === ''
    ? 0
    : finiteNumber(raw.taxWithholding);
  const imputationCredits = raw.imputationCredits == null || raw.imputationCredits === ''
    ? 0
    : finiteNumber(raw.imputationCredits);
  if (sharesHeld == null || sharesHeld <= 0) {
    return { ok: false, error: 'Shares held must be greater than zero.' };
  }
  if (dividendPerShare == null || dividendPerShare < 0) {
    return { ok: false, error: 'Dividend per share must be zero or greater.' };
  }
  if (taxWithholding == null || taxWithholding < 0) {
    return { ok: false, error: 'Tax/withholding must be zero or greater.' };
  }
  if (imputationCredits == null || imputationCredits < 0) {
    return { ok: false, error: 'Imputation credits must be zero or greater.' };
  }
  if (typeof raw.paymentDate !== 'string' || !isYmd(raw.paymentDate)) {
    return { ok: false, error: 'Payment date must be a real calendar date (YYYY-MM-DD).' };
  }
  const currency = (typeof raw.currency === 'string' && raw.currency.trim()
    ? raw.currency.trim().toUpperCase()
    : 'NZD');
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: 'Currency must be a 3-letter code such as NZD or USD.' };
  }

  const grossDividend = sharesHeld * dividendPerShare;
  if (taxWithholding - grossDividend > MONEY_EPS) {
    return { ok: false, error: 'Tax/withholding cannot be more than the gross dividend.' };
  }
  const netDividend = grossDividend - taxWithholding;

  let fxRateToNzd: number | null;
  if (currency === 'NZD') {
    fxRateToNzd = 1;
  } else if (raw.fxRateToNzd == null || raw.fxRateToNzd === '') {
    fxRateToNzd = null;
  } else {
    const rate = finiteNumber(raw.fxRateToNzd);
    if (rate == null || rate <= 0) {
      return { ok: false, error: 'FX rate to NZD must be greater than zero, or left blank.' };
    }
    fxRateToNzd = rate;
  }

  const reinvested = raw.reinvested === true || raw.reinvested === 1 || raw.reinvested === '1' || raw.reinvested === 'true';
  let reinvestedAmount: number | null = null;
  if (reinvested) {
    const amount = finiteNumber(raw.reinvestedAmount);
    if (amount == null || amount <= 0) {
      return { ok: false, error: 'Enter the amount reinvested in the payment currency.' };
    }
    if (amount - netDividend > MONEY_EPS) {
      return { ok: false, error: 'Reinvested amount cannot be more than the net dividend.' };
    }
    reinvestedAmount = amount;
  }

  return {
    ok: true,
    value: {
      sharesHeld,
      dividendPerShare,
      grossDividend,
      taxWithholding,
      imputationCredits,
      netDividend,
      paymentDate: raw.paymentDate,
      currency,
      fxRateToNzd,
      reinvested,
      reinvestedAmount,
    },
  };
}

function withNzd(row: DividendRecord & { reinvestment: ReinvestmentEffect }): DividendView {
  return { ...row, netNzd: netInNzd(row.netDividend, row.fxRateToNzd) };
}

function paidInYear(row: DividendRecord & { netNzd: number | null }, year: number, today: string): boolean {
  return row.paymentDate <= today && row.paymentDate.startsWith(`${year}-`);
}

type MoneyFigures = { netNzd: number | null; paidCount: number; unconvertedCount: number };

function figuresFor(paid: Array<DividendRecord & { netNzd: number | null }>): MoneyFigures {
  const converted = paid.filter((row) => row.netNzd != null);
  const unconvertedCount = paid.length - converted.length;
  if (paid.length === 0) return { netNzd: null, paidCount: 0, unconvertedCount: 0 };
  if (converted.length === 0) return { netNzd: null, paidCount: paid.length, unconvertedCount };
  const netNzd = converted.reduce((sum, row) => sum + (row.netNzd ?? 0), 0);
  return { netNzd, paidCount: paid.length, unconvertedCount };
}

function yearFigures(
  rows: Array<DividendRecord & { netNzd: number | null }>,
  year: number,
  today: string,
): MoneyFigures {
  return figuresFor(rows.filter((row) => paidInYear(row, year, today)));
}

function rangeFigures(
  rows: Array<DividendRecord & { netNzd: number | null }>,
  start: string,
  end: string,
): MoneyFigures {
  return figuresFor(rows.filter((row) => row.paymentDate >= start && row.paymentDate <= end));
}

const EMPTY_FIGURES: MoneyFigures = { netNzd: null, paidCount: 0, unconvertedCount: 0 };

/** Last calendar day that still falls in `year` and on or before `today`. */
function windowEnd(year: number, today: string): string | null {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  if (today < start) return null;
  return today < end ? today : end;
}

/** Same month and day in another year. 29 February lands on 28 February when the target year is not a leap year. */
function shiftYears(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const year = (y ?? 1970) + delta;
  const month = m ?? 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d ?? 1, last);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTH_SHORT[(m ?? 1) - 1]} ${y}`;
}

function growthNote(input: {
  available: boolean;
  fromYear: number;
  toYear: number;
  previousThrough: string | null;
  currentThrough: string | null;
}): string {
  const partial = input.currentThrough != null && !input.currentThrough.endsWith('-12-31');
  if (partial && input.previousThrough && input.currentThrough) {
    const previousLabel = `1 Jan ${input.fromYear}–${dayLabel(input.previousThrough)}`;
    const currentLabel = `1 Jan ${input.toYear}–${dayLabel(input.currentThrough)}`;
    if (input.available) {
      return `Recorded net dividends for ${previousLabel} compared with ${currentLabel}. Same dates in each year, using rows with an FX rate. Not a full-year change and not a forecast.`;
    }
    return `Dividend growth needs paid dividends with an NZD amount for both ${previousLabel} and ${currentLabel}. Payments outside those dates are not included.`;
  }
  if (input.available) {
    return `Change in recorded net dividends, ${input.fromYear} to ${input.toYear}, using rows with an FX rate. Not a forecast.`;
  }
  return `Dividend growth needs paid dividends with an NZD amount in both ${input.fromYear} and ${input.toYear}.`;
}

function daysBetween(start: string, end: string): number {
  const [ys, ms, ds] = start.split('-').map(Number);
  const [ye, me, de] = end.split('-').map(Number);
  const a = Date.UTC(ys ?? 1970, (ms ?? 1) - 1, ds ?? 1);
  const b = Date.UTC(ye ?? 1970, (me ?? 1) - 1, de ?? 1);
  return Math.round((b - a) / 86_400_000);
}

/** Map a gap between two published dates onto a cadence those dates actually support. */
function cadenceMonths(from: string, to: string): 1 | 3 | 6 | 12 | null {
  const days = daysBetween(from, to);
  if (days >= 25 && days <= 40) return 1;
  if (days >= 80 && days <= 110) return 3;
  if (days >= 150 && days <= 210) return 6;
  if (days >= 330 && days <= 400) return 12;
  return null;
}

function fxForCurrency(currency: string, fxRateToNzd: number | null): number | null {
  if (currency === 'NZD') return 1;
  if (fxRateToNzd == null || !(fxRateToNzd > 0) || !Number.isFinite(fxRateToNzd)) return null;
  return fxRateToNzd;
}

type DividendProjectionInput = {
  holdingId: string;
  name: string;
  symbol: string;
  shares: number;
  series: PublishedDividendSeries | null;
  today: string;
  fxRateToNzd: number | null;
};

type ProjectionPlan = {
  symbol: string;
  currency: string;
  fx: number | null;
  dividendPerShare: number;
  firstPaymentDate: string;
  lastPaidDate: string;
  /** Cadence used to step later dates. Null when later dates would be invented. */
  intervalMonths: 1 | 3 | 6 | 12 | null;
  historyCount: number;
  firstBasis: 'projected' | 'published';
};

function matchingCadence(dates: string[]): 1 | 3 | 6 | 12 | null {
  if (dates.length < 3) return null;
  const a = dates[dates.length - 3]!;
  const b = dates[dates.length - 2]!;
  const c = dates[dates.length - 1]!;
  const recent = cadenceMonths(b, c);
  const prior = cadenceMonths(a, b);
  if (recent == null || recent !== prior) return null;
  return recent;
}

function parseProjection(input: DividendProjectionInput): ProjectionPlan | null {
  const series = input.series;
  if (!series || series.source !== 'yahoo') return null;
  if (!Number.isFinite(input.shares) || !(input.shares > 0)) return null;
  if (!isYmd(input.today)) return null;
  const currency = series.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  const symbol = input.symbol.trim();
  if (!symbol) return null;

  const byDate = new Map<string, number>();
  for (const payment of series.payments) {
    if (!payment || !isYmd(payment.date)) return null;
    if (!Number.isFinite(payment.amountPerShare) || !(payment.amountPerShare > 0)) continue;
    const existing = byDate.get(payment.date);
    if (existing == null) {
      byDate.set(payment.date, payment.amountPerShare);
      continue;
    }
    if (Math.abs(existing - payment.amountPerShare) > MONEY_EPS) return null;
  }

  const dates = [...byDate.keys()].sort();
  const future = dates.filter((date) => date > input.today);
  const past = dates.filter((date) => date <= input.today);
  const fx = fxForCurrency(currency, input.fxRateToNzd);

  if (future.length > 0) {
    const paymentDate = future[0]!;
    const dividendPerShare = byDate.get(paymentDate);
    if (dividendPerShare == null || !(dividendPerShare > 0)) return null;
    const lastPaidDate = past.length > 0 ? past[past.length - 1]! : paymentDate;
    const throughFirst = dates.filter((date) => date <= paymentDate);
    return {
      symbol,
      currency,
      fx,
      dividendPerShare,
      firstPaymentDate: paymentDate,
      lastPaidDate,
      intervalMonths: matchingCadence(throughFirst),
      historyCount: dates.length,
      firstBasis: 'published',
    };
  }

  if (past.length < 3) return null;
  const intervalMonths = matchingCadence(past);
  if (intervalMonths == null) return null;
  const last = past[past.length - 1]!;
  const paymentDate = shiftMonths(last, intervalMonths);
  if (!(paymentDate > input.today)) return null;
  const dividendPerShare = byDate.get(last);
  if (dividendPerShare == null || !(dividendPerShare > 0)) return null;
  return {
    symbol,
    currency,
    fx,
    dividendPerShare,
    firstPaymentDate: paymentDate,
    lastPaidDate: last,
    intervalMonths,
    historyCount: past.length,
    firstBasis: 'projected',
  };
}

function forecastDates(first: string, interval: 1 | 3 | 6 | 12 | null, today: string): string[] {
  const dates = [first];
  if (interval == null) return dates;
  const horizonEnd = shiftMonths(today, DIVIDEND_FORECAST_HORIZON_MONTHS);
  if (first > horizonEnd) return dates;
  let cursor = first;
  while (dates.length < 24) {
    const next = shiftMonths(cursor, interval);
    if (!(next > cursor) || next > horizonEnd) break;
    dates.push(next);
    cursor = next;
  }
  return dates;
}

function detectedFromPlan(
  input: DividendProjectionInput,
  plan: ProjectionPlan,
  paymentDate: string,
  basis: 'projected' | 'published',
  intervalMonths: 1 | 3 | 6 | 12 | null,
): DetectedDividend {
  const amount = input.shares * plan.dividendPerShare;
  return {
    id: forecastReinvestKey(input.holdingId, paymentDate),
    holdingId: input.holdingId,
    name: input.name,
    symbol: plan.symbol,
    dividendPerShare: plan.dividendPerShare,
    sharesHeld: input.shares,
    ownedShares: input.shares,
    projectedShares: input.shares,
    amount,
    currency: plan.currency,
    amountNzd: plan.fx == null ? null : amount * plan.fx,
    fxRateToNzd: plan.fx,
    lastPaidDate: plan.lastPaidDate,
    paymentDate,
    intervalMonths,
    historyCount: plan.historyCount,
    basis,
    source: 'yahoo',
    reinvested: false,
    reinvestment: REINVEST_OFF,
  };
}

/**
 * Next payment for one holding, or null when the published history does not support one.
 * The cash amount is the last positive published dividend per share times shares held.
 * The date is either a future date the source published, or the last published date
 * shifted by the gap the latest dates already showed. No yield is calculated.
 */
export function projectDividendFromHistory(input: DividendProjectionInput): DetectedDividend | null {
  const plan = parseProjection(input);
  if (!plan) return null;
  const intervalMonths = plan.firstBasis === 'published' ? null : plan.intervalMonths;
  return detectedFromPlan(input, plan, plan.firstPaymentDate, plan.firstBasis, intervalMonths);
}

/**
 * Predicted payments for one holding through the next 12 months.
 * The first row is the same payment `projectDividendFromHistory` returns.
 * Later rows repeat that per-share amount on the same gap. They are not saved.
 */
export function projectDividendSchedule(input: DividendProjectionInput): DetectedDividend[] {
  const plan = parseProjection(input);
  if (!plan) return [];
  return forecastDates(plan.firstPaymentDate, plan.intervalMonths, input.today).map((paymentDate, index) => {
    const basis = index === 0 ? plan.firstBasis : 'projected';
    const intervalMonths = basis === 'published' ? null : plan.intervalMonths;
    return detectedFromPlan(input, plan, paymentDate, basis, intervalMonths);
  });
}

function reinvestmentShapeOk(row: DetectedDividend): boolean {
  const effect = row.reinvestment;
  if (!effect || !row.id) return false;
  if (typeof row.reinvested !== 'boolean') return false;
  if (effect.status !== 'off' && effect.status !== 'applied' && effect.status !== 'unavailable') return false;
  if (effect.status === 'applied') return effect.sharesAdded != null && effect.sharesAdded > 0;
  return effect.sharesAdded == null;
}

function detectedIsConsistent(row: DetectedDividend): boolean {
  if (row.source !== 'yahoo') return false;
  if (row.basis !== 'projected' && row.basis !== 'published') return false;
  if (row.basis === 'projected' && row.intervalMonths !== 1 && row.intervalMonths !== 3 && row.intervalMonths !== 6 && row.intervalMonths !== 12) {
    return false;
  }
  if (row.basis === 'published' && row.intervalMonths != null) return false;
  if (!Number.isFinite(row.dividendPerShare) || !(row.dividendPerShare > 0)) return false;
  if (!Number.isFinite(row.ownedShares) || !(row.ownedShares > 0)) return false;
  if (!Number.isFinite(row.sharesHeld) || !(row.sharesHeld > 0)) return false;
  if (!Number.isFinite(row.projectedShares) || !(row.projectedShares > 0)) return false;
  if (Math.abs(row.projectedShares - row.sharesHeld) > MONEY_EPS) return false;
  if (!Number.isFinite(row.amount) || !(row.amount > 0)) return false;
  if (Math.abs(row.amount - row.sharesHeld * row.dividendPerShare) > MONEY_EPS) return false;
  if (!isYmd(row.paymentDate) || !isYmd(row.lastPaidDate)) return false;
  if (!/^[A-Z]{3}$/.test(row.currency)) return false;
  if (!Number.isInteger(row.historyCount) || row.historyCount < 1) return false;
  if (!reinvestmentShapeOk(row)) return false;
  if (row.amountNzd == null) return row.currency !== 'NZD' && row.fxRateToNzd == null;
  if (row.fxRateToNzd == null || !(row.fxRateToNzd > 0) || !Number.isFinite(row.amountNzd)) return false;
  return Math.abs(row.amountNzd - row.amount * row.fxRateToNzd) <= MONEY_EPS;
}

/**
 * Saved NZD quote when one exists. Otherwise cost basis divided by the shares owned.
 * Never a guessed market price.
 */
export function recordedSharePriceNzd(
  holding: HoldingValueInput | null | undefined,
): { priceNzd: number; source: 'quote' | 'cost' } | null {
  if (!holding) return null;
  if (holding.quotedPriceNzd != null && Number.isFinite(holding.quotedPriceNzd) && holding.quotedPriceNzd > 0) {
    return { priceNzd: holding.quotedPriceNzd, source: 'quote' };
  }
  if (
    holding.costBasisNzd != null
    && holding.costBasisNzd > 0
    && holding.shares != null
    && holding.shares > 0
  ) {
    const priceNzd = holding.costBasisNzd / holding.shares;
    if (Number.isFinite(priceNzd) && priceNzd > 0) return { priceNzd, source: 'cost' };
  }
  return null;
}

function appliedNote(source: 'quote' | 'cost'): string {
  const priceSentence = source === 'quote'
    ? 'The share price is the saved NZD quote.'
    : 'The share price is the recorded cost per share (cost basis divided by the shares you own). There is no saved quote.';
  return `${priceSentence} This net cash buys more of the same holding in the forecast only. The shares you own stay as recorded. Later predicted payments for this holding use the extra shares. Not financial advice.`;
}

function effectForCash(args: {
  reinvested: boolean;
  cashInPaymentCurrency: number;
  currency: string;
  fxRateToNzd: number | null;
  price: { priceNzd: number; source: 'quote' | 'cost' } | null;
  linked: boolean;
}): ReinvestmentEffect {
  if (!args.reinvested) return REINVEST_OFF;
  if (!args.linked) {
    return {
      status: 'unavailable',
      sharesAdded: null,
      pricePerShareNzd: null,
      priceSource: null,
      note: REINVEST_UNLINKED_NOTE,
    };
  }
  if (!args.price) {
    return {
      status: 'unavailable',
      sharesAdded: null,
      pricePerShareNzd: null,
      priceSource: null,
      note: REINVEST_NO_PRICE_NOTE,
    };
  }
  const fx = fxForCurrency(args.currency, args.fxRateToNzd);
  if (fx == null) {
    return {
      status: 'unavailable',
      sharesAdded: null,
      pricePerShareNzd: args.price.priceNzd,
      priceSource: args.price.source,
      note: REINVEST_NO_FX_NOTE,
    };
  }
  const cashNzd = args.cashInPaymentCurrency * fx;
  if (!(cashNzd > 0) || !Number.isFinite(cashNzd)) {
    return {
      status: 'unavailable',
      sharesAdded: null,
      pricePerShareNzd: args.price.priceNzd,
      priceSource: args.price.source,
      note: REINVEST_NO_PRICE_NOTE,
    };
  }
  const sharesAdded = cashNzd / args.price.priceNzd;
  if (!(sharesAdded > 0) || !Number.isFinite(sharesAdded)) {
    return {
      status: 'unavailable',
      sharesAdded: null,
      pricePerShareNzd: args.price.priceNzd,
      priceSource: args.price.source,
      note: REINVEST_NO_PRICE_NOTE,
    };
  }
  return {
    status: 'applied',
    sharesAdded,
    pricePerShareNzd: args.price.priceNzd,
    priceSource: args.price.source,
    note: appliedNote(args.price.source),
  };
}

function recordedReinvestCash(event: DividendRecord): number {
  if (event.reinvestedAmount != null && event.reinvestedAmount > 0) return event.reinvestedAmount;
  return event.netDividend > 0 ? event.netDividend : 0;
}

/**
 * Annotate recorded payments and rebuild forecast amounts from a projected share count.
 * Owned shares stay the base. Reinvested net cash adds shares for later predicted payments only.
 */
export function applyDividendReinvestment(input: {
  events: DividendRecord[];
  holdings: HoldingValueInput[];
  detected: DetectedDividend[];
}): { events: Array<DividendRecord & { reinvestment: ReinvestmentEffect }>; detected: DetectedDividend[] } {
  const holdingById = new Map(input.holdings.map((holding) => [holding.id, holding]));
  const priceByHolding = new Map(
    input.holdings.map((holding) => [holding.id, recordedSharePriceNzd(holding)]),
  );

  const events = input.events.map((event) => {
    const holding = event.holdingId ? holdingById.get(event.holdingId) ?? null : null;
    return {
      ...event,
      reinvestment: effectForCash({
        reinvested: event.reinvested,
        cashInPaymentCurrency: recordedReinvestCash(event),
        currency: event.currency,
        fxRateToNzd: event.fxRateToNzd,
        price: holding ? priceByHolding.get(holding.id) ?? null : null,
        linked: holding != null,
      }),
    };
  });

  const recordedExtras = new Map<string, Array<{ date: string; shares: number }>>();
  for (const event of events) {
    if (event.reinvestment.status !== 'applied' || event.reinvestment.sharesAdded == null || !event.holdingId) {
      continue;
    }
    const list = recordedExtras.get(event.holdingId) ?? [];
    list.push({ date: event.paymentDate, shares: event.reinvestment.sharesAdded });
    recordedExtras.set(event.holdingId, list);
  }

  const groups = new Map<string, DetectedDividend[]>();
  for (const row of input.detected) {
    const list = groups.get(row.holdingId) ?? [];
    list.push(row);
    groups.set(row.holdingId, list);
  }

  const detected: DetectedDividend[] = [];
  for (const [holdingId, rows] of groups) {
    const sorted = [...rows].sort(
      (a, b) => a.paymentDate.localeCompare(b.paymentDate) || a.symbol.localeCompare(b.symbol),
    );
    const price = priceByHolding.get(holdingId) ?? null;
    const linked = holdingById.has(holdingId);
    let forecastExtra = 0;
    let pendingShares = 0;
    let pendingDate: string | null = null;
    for (const row of sorted) {
      if (pendingDate != null && row.paymentDate !== pendingDate) {
        forecastExtra += pendingShares;
        pendingShares = 0;
      }
      pendingDate = row.paymentDate;
      const recordedExtra = (recordedExtras.get(holdingId) ?? [])
        .filter((item) => item.date < row.paymentDate)
        .reduce((sum, item) => sum + item.shares, 0);
      const projectedShares = row.ownedShares + recordedExtra + forecastExtra;
      const amount = projectedShares * row.dividendPerShare;
      const fx = row.fxRateToNzd;
      const reinvestment = effectForCash({
        reinvested: row.reinvested,
        cashInPaymentCurrency: amount,
        currency: row.currency,
        fxRateToNzd: fx,
        price,
        linked,
      });
      if (reinvestment.status === 'applied' && reinvestment.sharesAdded != null) {
        pendingShares += reinvestment.sharesAdded;
      }
      detected.push({
        ...row,
        sharesHeld: projectedShares,
        projectedShares,
        amount,
        amountNzd: fx == null ? null : amount * fx,
        reinvestment,
      });
    }
  }

  return { events, detected };
}

function holdingDenominator(holding: HoldingValueInput): { value: number; basis: 'quote' | 'cost' } | null {
  if (
    holding.quotedPriceNzd != null
    && holding.quotedPriceNzd > 0
    && holding.shares != null
    && holding.shares > 0
  ) {
    return { value: holding.quotedPriceNzd * holding.shares, basis: 'quote' };
  }
  if (holding.costBasisNzd != null && holding.costBasisNzd > 0) {
    return { value: holding.costBasisNzd, basis: 'cost' };
  }
  return null;
}

export function buildDividendDashboard(input: {
  events: DividendRecord[];
  holdings: HoldingValueInput[];
  year: number;
  today?: string;
  detected?: DetectedDividend[];
}): DividendDashboard {
  const today = input.today && isYmd(input.today) ? input.today : todayAucklandYmd();
  const year = input.year;
  const reinvestedRows = applyDividendReinvestment({
    events: input.events,
    holdings: input.holdings,
    detected: (input.detected ?? []).filter(detectedIsConsistent),
  });
  const rows = reinvestedRows.events.map(withNzd);
  const paid = rows.filter((row) => row.paymentDate <= today);
  const upcoming = rows
    .filter((row) => row.paymentDate > today)
    .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate) || a.companyName.localeCompare(b.companyName));
  const history = [...paid].sort(
    (a, b) => b.paymentDate.localeCompare(a.paymentDate) || a.companyName.localeCompare(b.companyName),
  );

  const yearFiguresNow = yearFigures(rows, year, today);
  const months: MonthTotal[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
    const inMonth = paid.filter((row) => row.paymentDate.startsWith(yearMonth));
    const converted = inMonth.filter((row) => row.netNzd != null);
    months.push({
      yearMonth,
      label: monthLabel(yearMonth),
      netNzd: inMonth.length === 0 || converted.length === 0
        ? null
        : converted.reduce((sum, row) => sum + (row.netNzd ?? 0), 0),
      paidCount: inMonth.length,
      unconvertedCount: inMonth.length - converted.length,
    });
  }

  const currentYear = Number(today.slice(0, 4));
  let month: MonthTotal | null = null;
  if (year === currentYear) {
    month = months[Number(today.slice(5, 7)) - 1] ?? null;
  } else {
    month = [...months].reverse().find((item) => item.paidCount > 0) ?? null;
  }

  const years = new Set<number>();
  for (const row of paid) years.add(Number(row.paymentDate.slice(0, 4)));
  const annual = [...years]
    .sort((a, b) => b - a)
    .map((itemYear) => ({ year: itemYear, ...yearFigures(rows, itemYear, today) }));

  const previousYear = year - 1;
  const currentThrough = windowEnd(year, today);
  const previousThrough = currentThrough ? shiftYears(currentThrough, -1) : null;
  const currentWindow = currentThrough
    ? rangeFigures(rows, `${year}-01-01`, currentThrough)
    : EMPTY_FIGURES;
  const previousWindow = previousThrough
    ? rangeFigures(rows, `${previousYear}-01-01`, previousThrough)
    : EMPTY_FIGURES;
  const growthAvailable = previousWindow.netNzd != null && currentWindow.netNzd != null && previousWindow.netNzd > 0;
  const growth = {
    available: growthAvailable,
    fromYear: previousYear,
    toYear: year,
    previousThrough,
    currentThrough,
    previousNzd: previousWindow.netNzd,
    currentNzd: currentWindow.netNzd,
    changePct: growthAvailable
      ? ((currentWindow.netNzd! - previousWindow.netNzd!) / previousWindow.netNzd!) * 100
      : null,
    note: growthNote({
      available: growthAvailable,
      fromYear: previousYear,
      toYear: year,
      previousThrough,
      currentThrough,
    }),
  };

  const windowStart = shiftMonths(today, -12);
  const trailing = paid.filter(
    (row) => row.paymentDate >= windowStart && row.paymentDate <= today && row.netNzd != null,
  );
  const holdingById = new Map(input.holdings.map((holding) => [holding.id, holding]));
  const linkedTrailing = trailing.filter(
    (row) => row.holdingId != null && row.holdingId !== '' && holdingById.has(row.holdingId),
  );
  const omittedUnlinked = trailing.length - linkedTrailing.length;
  let yieldResult: DividendDashboard['yield'];
  if (linkedTrailing.length === 0) {
    yieldResult = {
      available: false,
      trailingNetNzd: null,
      denominatorNzd: null,
      yieldPct: null,
      basis: null,
      note: trailing.length === 0
        ? 'Yield needs paid dividends with an NZD amount in the last 12 months, and a cost basis or saved quote on those holdings.'
        : 'Yield leaves out dividends that are no longer linked to one of your holdings. Nothing in the last 12 months is still linked, so yield is not calculated.',
    };
  } else {
    const trailingIds = [...new Set(linkedTrailing.map((row) => row.holdingId as string))];
    const parts = trailingIds.map((id) => holdingDenominator(holdingById.get(id)!));
    const trailingNetNzd = linkedTrailing.reduce((sum, row) => sum + (row.netNzd ?? 0), 0);
    if (parts.some((part) => part == null)) {
      yieldResult = {
        available: false,
        trailingNetNzd,
        denominatorNzd: null,
        yieldPct: null,
        basis: null,
        note: omittedUnlinked > 0
          ? 'Yield needs a cost basis or a saved NZD quote on every holding that paid a linked dividend in the last 12 months. Dividends no longer linked to a holding are left out.'
          : 'Yield needs a cost basis or a saved NZD quote on every holding that paid a dividend in the last 12 months.',
      };
    } else {
      const known = parts as Array<{ value: number; basis: 'quote' | 'cost' }>;
      const denominatorNzd = known.reduce((sum, part) => sum + part.value, 0);
      const bases = new Set(known.map((part) => part.basis));
      const basis = bases.size === 1 ? [...bases][0]! : 'mixed';
      const basisNote = basis === 'quote'
        ? 'Trailing 12-month recorded net dividends divided by saved NZD quotes on those holdings. Not a live market yield.'
        : basis === 'cost'
          ? 'Trailing 12-month recorded net dividends divided by your recorded cost basis. Not a live market yield.'
          : 'Trailing 12-month recorded net dividends divided by saved quotes where you have them, otherwise cost basis.';
      yieldResult = {
        available: denominatorNzd > 0,
        trailingNetNzd,
        denominatorNzd,
        yieldPct: denominatorNzd > 0 ? (trailingNetNzd / denominatorNzd) * 100 : null,
        basis,
        note: omittedUnlinked > 0
          ? `${basisNote} Dividends no longer linked to a holding are left out.`
          : basisNote,
      };
    }
  }

  const stated = upcoming.filter((row) => row.netNzd != null);
  const historyCount = trailing.length;
  const detected = [...reinvestedRows.detected].sort(
    (a, b) => a.paymentDate.localeCompare(b.paymentDate) || a.name.localeCompare(b.name),
  );
  const detectedConverted = detected.filter((row) => row.amountNzd != null);
  const forecast: DividendDashboard['forecast'] = {
    heading: 'Projection from your records and published history',
    historyRunRateNzd: historyCount > 0
      ? trailing.reduce((sum, row) => sum + (row.netNzd ?? 0), 0)
      : null,
    historyCount,
    historyWindowStart: windowStart,
    statedUpcomingNzd: stated.length > 0
      ? stated.reduce((sum, row) => sum + (row.netNzd ?? 0), 0)
      : null,
    statedUpcomingCount: upcoming.length,
    statedUnconvertedCount: upcoming.length - stated.length,
    detected,
    detectedNzd: detectedConverted.length > 0
      ? detectedConverted.reduce((sum, row) => sum + (row.amountNzd ?? 0), 0)
      : null,
    detectedCount: detected.length,
    detectedUnconvertedCount: detected.length - detectedConverted.length,
    note: DIVIDEND_FORECAST_NOTE,
  };

  return {
    year,
    today,
    disclaimer: DIVIDEND_DISCLAIMER,
    hasEvents: rows.length > 0,
    yearIncomeNzd: yearFiguresNow.netNzd,
    yearPaidCount: yearFiguresNow.paidCount,
    yearUnconvertedCount: yearFiguresNow.unconvertedCount,
    month,
    months,
    annual,
    growth,
    yield: yieldResult,
    forecast,
    upcoming,
    history,
  };
}
