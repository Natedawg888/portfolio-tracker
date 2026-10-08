/** Dividend row the signed-in user recorded against one of their stock or ETF holdings. */
export interface DividendEvent {
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
  /** Net cash times the FX rate the user recorded. Null when that rate was left blank. */
  netNzd: number | null;
  reinvested: boolean;
  reinvestedAmount: number | null;
  /** How this payment changes later forecast share counts. It does not change shares owned. */
  reinvestment: DividendReinvestment;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DividendHoldingOption {
  id: string;
  name: string;
  symbol: string | null;
  shares: number | null;
  costBasisNzd: number | null;
}

export interface DividendMonthTotal {
  yearMonth: string;
  label: string;
  netNzd: number | null;
  paidCount: number;
  unconvertedCount: number;
}

/**
 * Result of one reinvest toggle.
 * `applied` — this payment's cash bought extra shares of the same holding for later predicted payments.
 * Recorded payments use net cash, and only when the payment date is after today. Forecast rows use gross cash (per share times projected shares; tax is not estimated).
 * `unavailable` — projected shares were left unchanged. `note` says reinvestment could not be applied.
 * `off` — this payment does not add shares. A paid recorded dividend stays off here because those shares are already in the holding.
 */
export interface DividendReinvestment {
  status: 'off' | 'applied' | 'unavailable';
  /** Extra shares added for later predicted payments of this holding. Null when none are added. */
  sharesAdded: number | null;
  pricePerShareNzd: number | null;
  /** `quote` is a saved NZD quote. `cost` is recorded cost basis divided by shares owned. */
  priceSource: 'quote' | 'cost' | null;
  note: string | null;
}

/** One predicted payment from Yahoo Finance dividend history. Not a saved dividend or income row. */
export interface DetectedDividend {
  /** `holdingId:paymentDate`. Use this as the row identity for the reinvest toggle. */
  id: string;
  holdingId: string;
  name: string;
  symbol: string;
  dividendPerShare: number;
  /** Projected shares used for this payment. */
  sharesHeld: number;
  /** Shares stored on the holding. Reinvestment does not change this. */
  ownedShares: number;
  /** Same number as `sharesHeld`. */
  projectedShares: number;
  amount: number;
  currency: string;
  amountNzd: number | null;
  fxRateToNzd: number | null;
  lastPaidDate: string;
  paymentDate: string;
  intervalMonths: 1 | 3 | 6 | 12 | null;
  historyCount: number;
  basis: 'projected' | 'published';
  source: 'yahoo';
  /** On spends this row's gross cash on more of the same holding. Tax is not estimated. */
  reinvested: boolean;
  reinvestment: DividendReinvestment;
  /** Forecast shares added by reinvesting earlier predicted payments of this holding. */
  reinvestExtraShares: number;
  /** Extra gross cash those shares earn on this payment, in the payment currency. */
  reinvestExtraAmount: number;
  reinvestExtraNzd: number | null;
}

/** `PATCH /api/dividends/:id/reinvest` with `{ reinvested: boolean }`. */
export interface DividendReinvestResponse {
  event: DividendEvent;
  /** Forecast rows for this holding after the toggle. */
  detected: DetectedDividend[];
  /** Shares stored on the holding. Unchanged by the toggle. */
  ownedShares: number | null;
}

/** `PUT /api/dividends/forecast-reinvest` with `{ holdingId, paymentDate, reinvested }`. */
export interface ForecastReinvestResponse {
  holdingId: string;
  paymentDate: string;
  reinvested: boolean;
  /** Forecast rows for this holding after the toggle, including later compounded payments. */
  detected: DetectedDividend[];
  ownedShares: number | null;
}

export interface DividendYearTotal {
  year: number;
  netNzd: number | null;
  paidCount: number;
  unconvertedCount: number;
}

export interface DividendDashboard {
  year: number;
  today: string;
  disclaimer: string;
  hasEvents: boolean;
  /** Paid dividends in the selected year, in NZD. Null when there is nothing to total. */
  yearIncomeNzd: number | null;
  yearPaidCount: number;
  yearUnconvertedCount: number;
  month: DividendMonthTotal | null;
  months: DividendMonthTotal[];
  annual: DividendYearTotal[];
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
    /** Next payments for this user's stock and ETF holdings, from published dividend history. */
    detected: DetectedDividend[];
    detectedNzd: number | null;
    detectedCount: number;
    detectedUnconvertedCount: number;
    /** Holdings set to reinvest every predicted payment. */
    reinvestAllHoldingIds?: string[];
    note: string;
  };
  upcoming: DividendEvent[];
  history: DividendEvent[];
  holdings: DividendHoldingOption[];
}

export interface DividendWriteBody {
  holdingId: string;
  sharesHeld: number;
  dividendPerShare: number;
  taxWithholding: number;
  imputationCredits: number;
  paymentDate: string;
  currency: string;
  fxRateToNzd: number | null;
  reinvested: boolean;
  reinvestedAmount: number | null;
  notes: string | null;
}
