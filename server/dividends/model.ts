/**
 * Dividend record maths.
 * Totals, yield, growth, and the forecast use only amounts the user stored.
 * Missing FX rates stay missing. Imputation credits are not cash.
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
    note: string;
  };
  upcoming: Array<DividendRecord & { netNzd: number | null }>;
  history: Array<DividendRecord & { netNzd: number | null }>;
};

export const DIVIDEND_DISCLAIMER =
  'Personal record of dividends you enter. Totals use your amounts and the FX rates you record. ' +
  'The forecast repeats your own history or adds up payments you stated. ' +
  'It is not financial advice and it is not a market forecast.';

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

function yearFigures(
  rows: Array<DividendRecord & { netNzd: number | null }>,
  year: number,
  today: string,
): { netNzd: number | null; paidCount: number; unconvertedCount: number } {
  const paid = rows.filter((row) => paidInYear(row, year, today));
  const converted = paid.filter((row) => row.netNzd != null);
  const unconvertedCount = paid.length - converted.length;
  if (paid.length === 0) return { netNzd: null, paidCount: 0, unconvertedCount: 0 };
  if (converted.length === 0) return { netNzd: null, paidCount: paid.length, unconvertedCount };
  const netNzd = converted.reduce((sum, row) => sum + (row.netNzd ?? 0), 0);
  return { netNzd, paidCount: paid.length, unconvertedCount };
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
  const previous = yearFigures(rows, previousYear, today);
  const growthAvailable = previous.netNzd != null && yearFiguresNow.netNzd != null && previous.netNzd > 0;
  const growth = {
    available: growthAvailable,
    fromYear: previousYear,
    toYear: year,
    previousNzd: previous.netNzd,
    currentNzd: yearFiguresNow.netNzd,
    changePct: growthAvailable
      ? ((yearFiguresNow.netNzd! - previous.netNzd!) / previous.netNzd!) * 100
      : null,
    note: growthAvailable
      ? `Change in recorded net dividends, ${previousYear} to ${year}, using rows with an FX rate. Not a forecast.`
      : `Dividend growth needs paid dividends with an NZD amount in both ${previousYear} and ${year}.`,
  };

  const windowStart = shiftMonths(today, -12);
  const trailing = paid.filter(
    (row) => row.paymentDate >= windowStart && row.paymentDate <= today && row.netNzd != null,
  );
  const trailingIds = [...new Set(trailing.map((row) => row.holdingId))];
  const holdingById = new Map(input.holdings.map((holding) => [holding.id, holding]));
  let yieldResult: DividendDashboard['yield'];
  if (trailing.length === 0) {
    yieldResult = {
      available: false,
      trailingNetNzd: null,
      denominatorNzd: null,
      yieldPct: null,
      basis: null,
      note: 'Yield needs paid dividends with an NZD amount in the last 12 months, and a cost basis or saved quote on those holdings.',
    };
  } else if (trailingIds.some((id) => !id || !holdingById.has(id))) {
    yieldResult = {
      available: false,
      trailingNetNzd: trailing.reduce((sum, row) => sum + (row.netNzd ?? 0), 0),
      denominatorNzd: null,
      yieldPct: null,
      basis: null,
      note: 'Yield is not calculated while a recorded dividend is no longer linked to one of your holdings.',
    };
  } else {
    const parts = trailingIds.map((id) => holdingDenominator(holdingById.get(id!)!));
    if (parts.some((part) => part == null)) {
      yieldResult = {
        available: false,
        trailingNetNzd: trailing.reduce((sum, row) => sum + (row.netNzd ?? 0), 0),
        denominatorNzd: null,
        yieldPct: null,
        basis: null,
        note: 'Yield needs a cost basis or a saved NZD quote on every holding that paid a dividend in the last 12 months.',
      };
    } else {
      const known = parts as Array<{ value: number; basis: 'quote' | 'cost' }>;
      const denominatorNzd = known.reduce((sum, part) => sum + part.value, 0);
      const trailingNetNzd = trailing.reduce((sum, row) => sum + (row.netNzd ?? 0), 0);
      const bases = new Set(known.map((part) => part.basis));
      const basis = bases.size === 1 ? [...bases][0]! : 'mixed';
      yieldResult = {
        available: denominatorNzd > 0,
        trailingNetNzd,
        denominatorNzd,
        yieldPct: denominatorNzd > 0 ? (trailingNetNzd / denominatorNzd) * 100 : null,
        basis,
        note: basis === 'quote'
          ? 'Trailing 12-month recorded net dividends divided by saved NZD quotes on those holdings. Not a live market yield.'
          : basis === 'cost'
            ? 'Trailing 12-month recorded net dividends divided by your recorded cost basis. Not a live market yield.'
            : 'Trailing 12-month recorded net dividends divided by saved quotes where you have them, otherwise cost basis.',
      };
    }
  }

  const stated = upcoming.filter((row) => row.netNzd != null);
  const historyCount = trailing.length;
  const forecast: DividendDashboard['forecast'] = {
    heading: 'Projection from your records',
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
    note: 'The history figure repeats net dividends you already recorded over the last 12 months. Upcoming amounts are only payments you entered yourself. This is not a market forecast.',
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
