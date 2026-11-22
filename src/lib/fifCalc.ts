/**
 * Foreign investment fund (FIF) income for an NZ-resident individual (KAN-92). Amounts are NZD.
 * Estimate only, not tax advice. Rules and the worked examples come from IRD IR461 Guide to
 * foreign investment funds (April 2026) and Income Tax Act 2007 ss EX 51 (CV) and EX 52 (FDR).
 *
 * Tax years are keyed by the calendar year they start, like payeRates.ts:
 * 2026 = 1 April 2026 – 31 March 2027.
 *
 * Threshold (de minimis): the FIF rules apply for the whole year if the total cost of attributing
 * interests is over the threshold on any day in the year. Market value doesn't count, and the
 * first $50,000 is not exempt once it's crossed. Under it, dividends are taxed as received.
 *
 * Fair dividend rate (FDR), per interest: 5% × opening market value + quick-sale adjustment.
 * Quick-sale adjustment, only when units were both bought and sold in the year:
 *   lesser of the peak holding amount and the actual gain, and nothing when there is no gain.
 *   Peak holding amount = 5% × peak holding differential × average cost.
 *   Peak holding differential = lesser of (peak − opening units) and (peak − closing units).
 *   Average cost = cost of the year's purchases ÷ units bought in the year.
 *   Actual gain = proceeds of each sale, to the extent it follows purchases earlier in the year,
 *   less those units × average cost.
 *
 * Comparative value (CV), per interest: (closing value + sale proceeds + distributions)
 *   − (opening value + purchase costs). An individual totals CV across the portfolio, and a
 *   total loss is reduced to zero.
 *
 * Individuals may use whichever of FDR and CV is lower for the year, the same method for every
 * interest where they can choose. A tie keeps FDR.
 */

export const FIF_SOURCE_LABEL = 'IRD IR461 Guide to foreign investment funds';
export const FIF_SOURCE_URL =
  'https://www.ird.govt.nz/income-tax/income-tax-for-businesses-and-organisations/types-of-business-income/foreign-investment-funds-fifs';

export const FDR_RATE = 0.05;

/**
 * De minimis threshold by tax-year start year. A Bill introduced 10 September 2026 would raise
 * it to $100,000 from 2026/27; it isn't law, so 2026 stays at $50,000 until it passes.
 */
export const FIF_DE_MINIMIS_NZD: Readonly<Record<number, number>> = {
  2025: 50_000,
  2026: 50_000,
};
const FIF_DE_MINIMIS_DEFAULT_NZD = 50_000;

export function fifDeMinimisNzd(taxYearStart: number): number {
  return FIF_DE_MINIMIS_NZD[taxYearStart] ?? FIF_DE_MINIMIS_DEFAULT_NZD;
}

export function fifTaxYearBounds(taxYearStart: number): { start: string; end: string } {
  return { start: `${taxYearStart}-04-01`, end: `${taxYearStart + 1}-03-31` };
}

/** Tax year (by start year) a YYYY-MM-DD date falls in. */
export function fifTaxYearForDate(ymd: string): number {
  const [y, m] = ymd.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// Threshold
// ---------------------------------------------------------------------------

/**
 * Cost of one attributing interest and when it was held. heldFrom null = held before the year;
 * heldTo null = still held after the year. The interest counts from heldFrom through heldTo.
 */
export type FifCostSpan = { costNzd: number; heldFrom: string | null; heldTo: string | null };

export type FifThresholdResult = {
  thresholdNzd: number;
  /** Largest total cost on any day in the year. */
  peakCostNzd: number;
  /** First day the peak was reached, or null when nothing was held. */
  peakCostDate: string | null;
  /** True when the peak is over the threshold: the FIF rules apply for the whole year. */
  applies: boolean;
};

export function fifThreshold(spans: FifCostSpan[], taxYearStart: number): FifThresholdResult {
  const { start, end } = fifTaxYearBounds(taxYearStart);
  const thresholdNzd = fifDeMinimisNzd(taxYearStart);
  // +cost on the first day held, −cost the day after the last day held.
  const deltas = new Map<string, number>();
  const bump = (day: string, n: number) => deltas.set(day, (deltas.get(day) ?? 0) + n);
  for (const s of spans) {
    if (!(s.costNzd > 0)) continue;
    const from = s.heldFrom == null || s.heldFrom < start ? start : s.heldFrom;
    const to = s.heldTo == null || s.heldTo > end ? end : s.heldTo;
    if (from > end || to < start || to < from) continue;
    bump(from, s.costNzd);
    bump(nextDay(to), -s.costNzd);
  }
  let running = 0;
  let peakCostNzd = 0;
  let peakCostDate: string | null = null;
  for (const day of [...deltas.keys()].sort()) {
    running += deltas.get(day) ?? 0;
    if (day <= end && running > peakCostNzd + 1e-9) {
      peakCostNzd = running;
      peakCostDate = day;
    }
  }
  peakCostNzd = r2(peakCostNzd);
  return { thresholdNzd, peakCostNzd, peakCostDate, applies: peakCostNzd > thresholdNzd };
}

function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// FDR and CV for one interest
// ---------------------------------------------------------------------------

export type FifTrade = { date: string; kind: 'buy' | 'sell'; units: number; amountNzd: number };

export type FifInterestYear = {
  id: string;
  label: string;
  /** Market value at the start of the year (0 when bought during it). */
  openingValueNzd: number;
  openingUnits: number;
  /** Market value at the end of the year; null when not known yet. */
  closingValueNzd: number | null;
  /** Buys and sells in the year, any order (sorted by date here). */
  trades: FifTrade[];
  /** Dividends and other distributions received in the year. */
  distributionsNzd: number;
};

export type QuickSaleResult = {
  peakUnits: number;
  closingUnits: number;
  peakHoldingDifferential: number;
  averageCostNzd: number;
  peakHoldingAmountNzd: number;
  actualGainNzd: number;
  adjustmentNzd: number;
};

export function quickSaleAdjustment(openingUnits: number, trades: FifTrade[]): QuickSaleResult {
  const sorted = [...trades].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let units = openingUnits;
  let peakUnits = openingUnits;
  let boughtUnits = 0;
  let boughtCost = 0;
  for (const t of sorted) {
    units += t.kind === 'buy' ? t.units : -t.units;
    if (t.kind === 'buy') {
      boughtUnits += t.units;
      boughtCost += t.amountNzd;
    }
    peakUnits = Math.max(peakUnits, units);
  }
  const closingUnits = units;
  const averageCostNzd = boughtUnits > 0 ? boughtCost / boughtUnits : 0;
  const hasBuy = sorted.some((t) => t.kind === 'buy');
  const hasSell = sorted.some((t) => t.kind === 'sell');
  const peakHoldingDifferential = Math.max(0, Math.min(peakUnits - openingUnits, peakUnits - closingUnits));
  const peakHoldingAmountNzd = FDR_RATE * peakHoldingDifferential * averageCostNzd;

  // A sale is a quick sale to the extent it follows purchases earlier in the year that
  // earlier quick sales haven't already used up.
  let unmatchedBought = 0;
  let actualGainNzd = 0;
  for (const t of sorted) {
    if (t.kind === 'buy') {
      unmatchedBought += t.units;
      continue;
    }
    const quick = Math.min(t.units, unmatchedBought);
    if (quick <= 0 || !(t.units > 0)) continue;
    unmatchedBought -= quick;
    actualGainNzd += t.amountNzd * (quick / t.units) - quick * averageCostNzd;
  }
  const adjustmentNzd =
    hasBuy && hasSell ? Math.max(0, Math.min(peakHoldingAmountNzd, actualGainNzd)) : 0;
  return {
    peakUnits,
    closingUnits,
    peakHoldingDifferential,
    averageCostNzd: r2(averageCostNzd),
    peakHoldingAmountNzd: r2(peakHoldingAmountNzd),
    actualGainNzd: r2(actualGainNzd),
    adjustmentNzd: r2(adjustmentNzd),
  };
}

export type FifInterestResult = {
  id: string;
  label: string;
  fdrOpeningNzd: number;
  quickSale: QuickSaleResult;
  fdrIncomeNzd: number;
  /** Before the portfolio loss is reduced to zero; null when the closing value isn't known. */
  cvIncomeNzd: number | null;
};

export function fifInterestIncome(i: FifInterestYear): FifInterestResult {
  const fdrOpeningNzd = r2(FDR_RATE * Math.max(0, i.openingValueNzd));
  const quickSale = quickSaleAdjustment(i.openingUnits, i.trades);
  const sum = (kind: FifTrade['kind']) =>
    i.trades.filter((t) => t.kind === kind).reduce((s, t) => s + t.amountNzd, 0);
  const cvIncomeNzd =
    i.closingValueNzd == null
      ? null
      : r2(i.closingValueNzd + sum('sell') + i.distributionsNzd - (i.openingValueNzd + sum('buy')));
  return {
    id: i.id,
    label: i.label,
    fdrOpeningNzd,
    quickSale,
    fdrIncomeNzd: r2(fdrOpeningNzd + quickSale.adjustmentNzd),
    cvIncomeNzd,
  };
}

// ---------------------------------------------------------------------------
// Portfolio for the year
// ---------------------------------------------------------------------------

export type FifMethod = 'fdr' | 'cv';

export type FifYearResult = {
  taxYearStart: number;
  threshold: FifThresholdResult;
  interests: FifInterestResult[];
  fdrTotalNzd: number;
  /** Portfolio CV after a loss is reduced to zero; null when any closing value is unknown. */
  cvTotalNzd: number | null;
  /** CV before the zero floor, for showing a loss. */
  cvRawTotalNzd: number | null;
  /** null when the FIF rules don't apply. */
  method: FifMethod | null;
  /** FIF income to return: 0 when the rules don't apply. */
  fifIncomeNzd: number;
  /** Dividends taxed as received when the rules don't apply; 0 when they do. */
  dividendsTaxableNzd: number;
};

export function fifYear(input: {
  taxYearStart: number;
  spans: FifCostSpan[];
  interests: FifInterestYear[];
}): FifYearResult {
  const threshold = fifThreshold(input.spans, input.taxYearStart);
  const interests = input.interests.map(fifInterestIncome);
  const fdrTotalNzd = r2(interests.reduce((s, i) => s + i.fdrIncomeNzd, 0));
  const cvKnown = interests.every((i) => i.cvIncomeNzd != null);
  const cvRawTotalNzd = cvKnown ? r2(interests.reduce((s, i) => s + (i.cvIncomeNzd ?? 0), 0)) : null;
  const cvTotalNzd = cvRawTotalNzd == null ? null : Math.max(0, cvRawTotalNzd);
  const distributions = r2(input.interests.reduce((s, i) => s + i.distributionsNzd, 0));
  if (!threshold.applies) {
    return {
      taxYearStart: input.taxYearStart,
      threshold,
      interests,
      fdrTotalNzd,
      cvTotalNzd,
      cvRawTotalNzd,
      method: null,
      fifIncomeNzd: 0,
      dividendsTaxableNzd: distributions,
    };
  }
  const method: FifMethod = cvTotalNzd != null && cvTotalNzd < fdrTotalNzd ? 'cv' : 'fdr';
  return {
    taxYearStart: input.taxYearStart,
    threshold,
    interests,
    fdrTotalNzd,
    cvTotalNzd,
    cvRawTotalNzd,
    method,
    fifIncomeNzd: method === 'cv' ? (cvTotalNzd ?? 0) : fdrTotalNzd,
    dividendsTaxableNzd: 0,
  };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * nz: NZ-listed, not a FIF. nz_fund: Sharesies-style NZ fund (a PIE), not a FIF.
 * asx_exempt: ASX-listed, assumed to be an Australian-resident company keeping a franking
 * account (IR461's ASX exemption; IRD's tool at ird.govt.nz/fif-australia-tool checks a share).
 * fif: any other listing, an attributing interest by default.
 * user_exempt: the user says it isn't an attributing interest (e.g. an exempt fund we can't detect).
 */
export type FifClass = 'nz' | 'nz_fund' | 'asx_exempt' | 'fif' | 'user_exempt';

/** The user's choice for one holding: count it as a FIF, or not. Null = use the automatic class. */
export type FifOverride = 'fif' | 'exempt';

export function applyFifOverride(auto: FifClass, override: FifOverride | null | undefined): FifClass {
  if (override === 'fif') return 'fif';
  if (override === 'exempt') return auto === 'fif' ? 'user_exempt' : auto;
  return auto;
}

export function classifyFif(symbol: string | null | undefined, exchange: string | null | undefined): FifClass {
  const sym = (symbol ?? '').trim().toUpperCase();
  const ex = (exchange ?? '').trim().toUpperCase();
  const sks = /^SKS\.([A-Z]+)\./.exec(sym);
  const market = sks?.[1] ?? '';
  if (market === 'FUND' || ex === 'FUND') return 'nz_fund';
  if (market === 'NZX' || ex.includes('NZX') || ex === 'NZ' || /\.NZ$/.test(sym)) return 'nz';
  if (market === 'ASX' || ex.includes('ASX') || ex === 'AU' || /\.AX$/.test(sym)) return 'asx_exempt';
  return 'fif';
}

export const FIF_CLASS_LABEL: Record<FifClass, string> = {
  nz: 'NZ-listed, not a FIF',
  nz_fund: 'NZ fund (PIE), not a FIF',
  asx_exempt: 'ASX-listed, exempt',
  fif: 'Foreign, counts as a FIF',
  user_exempt: 'Marked not a FIF by you',
};
