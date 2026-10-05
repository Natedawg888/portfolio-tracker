/**
 * Dividend record maths.
 * Totals, yield, and growth use only amounts the user stored.
 * The forecast may also repeat the next date from Yahoo Finance dividend
 * history for a stock or ETF the same user holds. That amount is the last
 * published cash dividend per share times their shares. Missing figures stay
 * missing. Missing FX rates stay missing. Imputation credits are not cash.
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

/**
 * Next payment for one holding, taken from published dividend history.
 * `projected` repeats the gap the published dates already showed.
 * `published` uses a future date and amount the source itself listed.
 */
export type DetectedDividend = {
  holdingId: string;
  name: string;
  symbol: string;
  dividendPerShare: number;
  sharesHeld: number;
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
};

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
  upcoming: Array<DividendRecord & { netNzd: number | null }>;
  history: Array<DividendRecord & { netNzd: number | null }>;
};

export const DIVIDEND_DISCLAIMER =
  'Personal record of dividends you enter. Totals use your amounts and the FX rates you record. ' +
  'The forecast repeats your own history, adds up payments you stated, or projects the next payment from published dividend history on stocks and ETFs you hold. ' +
  'It is not financial advice and it is not a market forecast.';

export const DIVIDEND_FORECAST_NOTE =
  'The history figure repeats net dividends you already recorded over the last 12 months. ' +
  'Upcoming amounts are only payments you entered yourself. ' +
  'A stock or ETF you hold is added only when Yahoo Finance has published a dividend for it. ' +
  'The projected date repeats the gap between those published dates, and the amount is the last cash dividend per share times your shares. ' +
  'A holding is left out when that source has no dividend figure, or when you already entered an upcoming payment for it. ' +
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

function withNzd(row: DividendRecord): DividendRecord & { netNzd: number | null } {
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

/**
 * Next payment for one holding, or null when the published history does not support one.
 * The cash amount is the last positive published dividend per share times shares held.
 * The date is either a future date the source published, or the last published date
 * shifted by the gap the latest dates already showed. No yield is calculated.
 */
export function projectDividendFromHistory(input: {
  holdingId: string;
  name: string;
  symbol: string;
  shares: number;
  series: PublishedDividendSeries | null;
  today: string;
  fxRateToNzd: number | null;
}): DetectedDividend | null {
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

  const finish = (args: {
    dividendPerShare: number;
    paymentDate: string;
    lastPaidDate: string;
    intervalMonths: 1 | 3 | 6 | 12 | null;
    historyCount: number;
    basis: 'projected' | 'published';
  }): DetectedDividend => {
    const amount = input.shares * args.dividendPerShare;
    return {
      holdingId: input.holdingId,
      name: input.name,
      symbol,
      dividendPerShare: args.dividendPerShare,
      sharesHeld: input.shares,
      amount,
      currency,
      amountNzd: fx == null ? null : amount * fx,
      fxRateToNzd: fx,
      lastPaidDate: args.lastPaidDate,
      paymentDate: args.paymentDate,
      intervalMonths: args.intervalMonths,
      historyCount: args.historyCount,
      basis: args.basis,
      source: 'yahoo',
    };
  };

  if (future.length > 0) {
    const paymentDate = future[0]!;
    const dividendPerShare = byDate.get(paymentDate);
    if (dividendPerShare == null || !(dividendPerShare > 0)) return null;
    const lastPaidDate = past.length > 0 ? past[past.length - 1]! : paymentDate;
    return finish({
      dividendPerShare,
      paymentDate,
      lastPaidDate,
      intervalMonths: null,
      historyCount: dates.length,
      basis: 'published',
    });
  }

  if (past.length < 3) return null;
  const last = past[past.length - 1]!;
  const prev = past[past.length - 2]!;
  const prev2 = past[past.length - 3]!;
  const recent = cadenceMonths(prev, last);
  const prior = cadenceMonths(prev2, prev);
  if (recent == null || recent !== prior) return null;
  const paymentDate = shiftMonths(last, recent);
  if (!(paymentDate > input.today)) return null;
  const dividendPerShare = byDate.get(last);
  if (dividendPerShare == null || !(dividendPerShare > 0)) return null;
  return finish({
    dividendPerShare,
    paymentDate,
    lastPaidDate: last,
    intervalMonths: recent,
    historyCount: past.length,
    basis: 'projected',
  });
}

function detectedIsConsistent(row: DetectedDividend): boolean {
  if (row.source !== 'yahoo') return false;
  if (row.basis !== 'projected' && row.basis !== 'published') return false;
  if (row.basis === 'projected' && row.intervalMonths !== 1 && row.intervalMonths !== 3 && row.intervalMonths !== 6 && row.intervalMonths !== 12) {
    return false;
  }
  if (row.basis === 'published' && row.intervalMonths != null) return false;
  if (!Number.isFinite(row.dividendPerShare) || !(row.dividendPerShare > 0)) return false;
  if (!Number.isFinite(row.sharesHeld) || !(row.sharesHeld > 0)) return false;
  if (!Number.isFinite(row.amount) || !(row.amount > 0)) return false;
  if (Math.abs(row.amount - row.sharesHeld * row.dividendPerShare) > MONEY_EPS) return false;
  if (!isYmd(row.paymentDate) || !isYmd(row.lastPaidDate)) return false;
  if (!/^[A-Z]{3}$/.test(row.currency)) return false;
  if (!Number.isInteger(row.historyCount) || row.historyCount < 1) return false;
  if (row.amountNzd == null) return row.currency !== 'NZD' && row.fxRateToNzd == null;
  if (row.fxRateToNzd == null || !(row.fxRateToNzd > 0) || !Number.isFinite(row.amountNzd)) return false;
  return Math.abs(row.amountNzd - row.amount * row.fxRateToNzd) <= MONEY_EPS;
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
  const rows = input.events.map(withNzd);
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
  const detected = (input.detected ?? [])
    .filter(detectedIsConsistent)
    .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate) || a.name.localeCompare(b.name));
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
