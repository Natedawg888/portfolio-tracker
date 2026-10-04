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
