/**
 * NZD Portfolio Tracker — shared domain types
 * Currency default: NZD. Display timezone: Pacific/Auckland.
 * Never invent live prices, miner secondary-market values, or stone valuations.
 */

export type CurrencyCode = 'NZD' | 'USD' | 'AUD' | 'EUR' | 'GBP';

export type AccountType =
  | 'cheque'
  | 'savings'
  | 'credit'
  | 'loan'
  | 'wallet'
  | 'term_deposit'
  | 'kiwisaver'
  | 'other';

export type TransactionKind = 'debit' | 'credit' | 'transfer';

export type HoldingAssetClass =
  | 'stock'
  | 'crypto'
  | 'gomining_miner'
  | 'art'
  | 'metal'
  | 'stone'
  | 'forex'
  | 'real_estate'
  | 'collectable';

export type MetalKind = 'gold' | 'silver' | 'platinum' | 'palladium';
export type MetalUnit = 'g' | 'oz_t'; // grams or troy ounces

export type QuoteSource =
  | 'manual'
  | 'kraken'
  | 'kraken+frankfurter'
  | 'coingecko'
  | 'coinbase'
  | 'coinbase+frankfurter'
  | 'gomining'
  | 'gomining_extrapolated'
  | 'stub'
  | 'akahu'
  | 'user_valuation'
  | 'search_comp'
  | 'metals_dev'
  | 'gold-api'
  | 'frankfurter'
  | 'btc_fx_ratio'
  | 'identity'
  | 'scryfall'
  | 'pokemontcg.io'
  | 'openfacet'
  | 'yahoo'
  | 'yahoo+frankfurter'

export type QuoteStatus = 'ok' | 'stale' | 'unavailable' | 'stubbed' | 'not_applicable';

/** Bank / cash account (no passwords stored). */
export interface BankAccount {
  id: string;
  name: string;
  institution: string;
  accountType: AccountType;
  currency: CurrencyCode;
  balance: number;
  notes?: string;
  externalId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Transaction source provenance for Spending. */
export type TransactionSource = 'akahu' | 'bank' | 'google_wallet' | 'manual' | 'csv';

/** Imported or manually entered bank transaction. */
export interface Transaction {
  id: string;
  /** Null when not charged to a bank account (e.g. crypto Visa debit card). */
  accountId: string | null;
  /** Display name of charged bank_accounts row (join). */
  accountName?: string | null;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number; // signed; negative = outflow
  kind: TransactionKind;
  categoryId?: string | null;
  currency: CurrencyCode;
  externalId?: string | null;
  createdAt: string;
  /** Payment instrument label (Wallet card name, Nexo/GoMining, bank last4, nickname). */
  cardName?: string | null;
  merchant?: string | null;
  source?: TransactionSource;
  /** Explicit "Use BTC" / "Pays with BTC" — off by default; never auto from category. */
  affectsBtc?: boolean;
  btcHoldingId?: string | null;
  btcHoldingName?: string | null;
  /** Signed BTC already applied to the holding (for display / audit). */
  btcDeltaApplied?: number | null;
  btcNzdRate?: number | null;
  btcAppliedAt?: string | null;
  /** Charity / IR526 receipt under data/uploads/receipts/ */
  receiptPath?: string | null;
  receiptUrl?: string | null;
}

/** spending | income | transfer_out | transfer_in — only spending counts as Budget spend. */
export type BudgetCategoryType = 'spending' | 'income' | 'transfer_out' | 'transfer_in';

export interface BudgetCategory {
  id: string;
  name: string;
  parentId?: string | null;
  colour?: string;
  /** Category kind; prefer over isIncome. */
  type: BudgetCategoryType;
  /** True iff type === 'income' (legacy). Transfer in/out are never income. */
  isIncome: boolean;
  sortOrder: number;
}


/** Creditor kind for I-owe debts. */
export type DebtCreditorKind = 'person' | 'corporation';

/** Product kind recorded on a debt. Blank until the user chooses one. */
export type DebtProductKind =
  | 'credit_card'
  | 'personal_loan'
  | 'student_loan'
  | 'car_loan'
  | 'mortgage'
  | 'bnpl';

/** When recurring interest is added. Null means interest does not recur. */
export type DebtInterestPeriod = 'month' | 'year';

/** Fields the user can save on a debt. Omitted numbers stay unset. */
export interface DebtWriteBody {
  name?: string;
  kind?: DebtCreditorKind;
  notes?: string | null;
  outstandingNzd?: number;
  productKind?: DebtProductKind | null;
  isLoan?: boolean;
  interestPeriod?: DebtInterestPeriod | null;
  interestRatePercent?: number | null;
  minimumPaymentNzd?: number | null;
  actualPaymentNzd?: number | null;
  remainingTermMonths?: number | null;
  interestPaidNzd?: number | null;
}

/** Someone / company the signed-in user owes (debt, NZD). */
export interface DebtPerson {
  id: string;
  name: string;
  /** person (default) or corporation (company). */
  kind: DebtCreditorKind;
  notes?: string | null;
  outstandingNzd: number;
  createdAt: string;
  updatedAt: string;
  repaidTotalNzd?: number;
  productKind?: DebtProductKind | null;
  isLoan?: boolean;
  interestPeriod?: DebtInterestPeriod | null;
  interestRatePercent?: number | null;
  minimumPaymentNzd?: number | null;
  actualPaymentNzd?: number | null;
  remainingTermMonths?: number | null;
  interestPaidNzd?: number | null;
  /** Interest the schedule has already added to the balance. */
  interestChargedNzd?: number;
  /** Actual payment ÷ income recorded in incomeMonth. Null when either figure is missing. */
  debtToIncome?: number | null;
  incomeMonth?: string | null;
  recordedIncomeNzd?: number | null;
  /** Null when the payoff cannot be counted from entered figures. */
  projectionText?: string | null;
}

/** Repayment toward a debt person. Date ≥ 2026-10-01. */
export interface DebtRepayment {
  id: string;
  personId: string;
  personName?: string | null;
  amountNzd: number;
  date: string; // YYYY-MM-DD
  notes?: string | null;
  transactionId?: string | null;
  createdAt: string;
}

/**
 * Named NZD savings goal for the signed-in user.
 * Stored: name, targetNzd, currentAmountNzd, deadline.
 * Counted on read from those figures: remainingNzd, percentComplete,
 * requiredWeeklySavingNzd, requiredMonthlySavingNzd, estimatedCompletion.
 * currentAmountNzd is not added to net worth.
 */
export interface SavingsGoal {
  id: string;
  name: string;
  notes: string | null;
  /** Goal amount, NZD. */
  targetNzd: number;
  /** Amount saved toward the goal so far, NZD. */
  currentAmountNzd: number;
  /** YYYY-MM-DD, or null when no deadline is set. */
  deadline: string | null;
  currency: 'NZD';
  timezone: 'Pacific/Auckland';
  /** Pacific/Auckland calendar date the progress figures were counted on. */
  asOf: string;
  /** max(0, targetNzd − currentAmountNzd), NZD. */
  remainingNzd: number;
  /**
   * currentAmountNzd / targetNzd × 100.
   * A percent, not a fraction: 25 means 25%. May exceed 100.
   */
  percentComplete: number;
  /**
   * Whole calendar days from asOf to deadline.
   * Negative when the deadline has passed. Null when deadline is null.
   */
  daysRemaining: number | null;
  /**
   * NZD to save each week to finish by the deadline.
   * Null when that pace is not defined. 0 when nothing remains.
   */
  requiredWeeklySavingNzd: number | null;
  /**
   * NZD to save each month to finish by the deadline.
   * A month is 365.25 / 12 days. Null when that pace is not defined.
   */
  requiredMonthlySavingNzd: number | null;
  /**
   * YYYY-MM-DD the goal is met at the required pace, or null.
   * Today (asOf) once currentAmountNzd has reached targetNzd.
   * The deadline while a gap is still open and the deadline is today or later.
   */
  estimatedCompletion: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields the user can save on a savings goal. */
export interface SavingsGoalWriteBody {
  name?: string;
  notes?: string | null;
  targetNzd?: number;
  currentAmountNzd?: number;
  /** YYYY-MM-DD, null, or '' to clear. */
  deadline?: string | null;
}

/**
 * One donation in the signed-in user's ledger (NZD).
 * Stored on its own. It is not a transaction and it is not a receipt file.
 * Tax-year fields are counted from `date` on read.
 */
export interface Donation {
  id: string;
  /** YYYY-MM-DD. Calendar date the gift was made. */
  date: string;
  /** Charity or other recipient. */
  recipient: string;
  /** Gift amount in NZD, rounded to cents. Greater than 0. */
  amountNzd: number;
  notes: string | null;
  /** http(s) link to supporting evidence, or null. Not a stored receipt file. */
  evidenceUrl: string | null;
  /**
   * Optional id of this user's transaction that already has a receipt.
   * The receipt file stays on that transaction.
   */
  receiptTransactionId: string | null;
  /** Receipt path copied from the linked transaction, or null. */
  receiptPath: string | null;
  /** `/api/uploads/...` for receiptPath, or null. */
  receiptUrl: string | null;
  currency: 'NZD';
  timezone: 'Pacific/Auckland';
  /** NZ tax year the date falls in, labelled by the year ending 31 March. */
  taxYear: number;
  /** Inclusive start, YYYY-MM-DD (1 April). */
  taxYearStart: string;
  /** Inclusive end, YYYY-MM-DD (31 March). */
  taxYearEnd: string;
  createdAt: string;
  updatedAt: string;
}

/** Fields the user can save on a donation. */
export interface DonationWriteBody {
  /** YYYY-MM-DD. */
  date?: string;
  recipient?: string;
  /** NZD. */
  amountNzd?: number;
  notes?: string | null;
  /** http(s) URL, null, or '' to clear. */
  evidenceUrl?: string | null;
  /** Transaction id, null, or '' to clear. */
  receiptTransactionId?: string | null;
}

/**
 * Counted totals for one NZ tax year (1 April–31 March).
 * Amounts are NZD.
 */
export interface DonationTaxYearTotals {
  taxYear: number;
  taxYearStart: string;
  taxYearEnd: string;
  /** Donations whose date falls in this tax year. */
  count: number;
  /** Sum of amountNzd for those donations. */
  totalAmountNzd: number;
  /** Donations with amountNzd of at least 5. */
  eligibleCount: number;
  /** Sum of donations of at least $5. Donations under $5 are not pooled. */
  eligibleAmountNzd: number;
  /** Donations with amountNzd under 5. */
  belowMinimumCount: number;
  /** Sum of donations under $5. */
  belowMinimumAmountNzd: number;
  /**
   * Estimate of the IR526 credit: eligibleAmountNzd / 3, rounded to cents.
   * Not reduced by the taxable-income cap. See DonationSummary.estimateNote.
   */
  estimatedTaxCreditNzd: number;
  estimateLabel: 'estimate';
  /** A donation below this (NZD) is excluded from the credit estimate. */
  minimumDonationNzd: 5;
  creditRate: '1/3';
  /** Taxable income is not stored, so the one-third income cap is not applied. */
  incomeCapApplied: false;
}

/** Tax-year donation totals for the signed-in user. */
export interface DonationSummary {
  currency: 'NZD';
  timezone: 'Pacific/Auckland';
  /** Pacific/Auckland date the summary was counted on. */
  asOf: string;
  /** Tax year that contains asOf. */
  currentTaxYear: number;
  /** Tax year described by `selected`. From ?taxYear=, or currentTaxYear. */
  taxYear: number;
  estimateLabel: 'estimate';
  /** Plain-language rule for estimatedTaxCreditNzd. */
  estimateNote: string;
  /** How the 1 April–31 March label is chosen. */
  taxYearNote: string;
  minimumDonationNzd: 5;
  creditRate: '1/3';
  incomeCapApplied: false;
  selected: DonationTaxYearTotals;
  /** Newest tax year first. Includes years with donations, the current year, and `taxYear`. */
  years: DonationTaxYearTotals[];
}

export interface DebtSummary {
  outstandingTotalNzd: number;
  /** Total creditors (people + corporations). */
  personCount: number;
  personKindCount?: number;
  corporationCount?: number;
  repaidTotalNzd: number;
  year: number | null;
  asOf: string;
  /** Income recorded in incomeMonth. Null when that month has no income records. */
  recordedIncomeNzd?: number | null;
  incomeMonth?: string | null;
}

export type IncomeKind = 'cash' | 'crypto';

/** Recorded income inflow (Spending → Income). Date ≥ 2026-10-01. */
export interface IncomeRecord {
  id: string;
  date: string;
  amountNzd: number;
  kind: IncomeKind;
  description: string;
  accountId?: string | null;
  accountName?: string | null;
  accountType?: string | null;
  /** Income category (Salary, Mining, …); defaults to cat-income. */
  categoryId?: string | null;
  categoryName?: string | null;
  cryptoAsset?: string | null;
  cryptoAmount?: number | null;
  holdingId?: string | null;
  holdingName?: string | null;
  transactionId?: string | null;
  notes?: string | null;
  createdAt: string;
  /** Set when this income row mirrors one dividend the same user recorded. */
  dividendEventId?: string | null;
  /**
   * `record` = income_records row (Add income / crypto / mirrored dividend).
   * `category_txn` = bank sync / tagged income-category credit not linked from a record.
   */
  origin?: 'record' | 'category_txn';
  /** transactions.source when origin is category_txn (akahu | bank | manual | …). */
  txnSource?: string | null;
}

/** Category remembered for a payee this user has used. */
export interface PayeeSetting {
  name: string;
  categoryId: string | null;
  categoryName: string | null;
}

/** Planned income line for one income category in a month (YYYY-MM). */
export interface IncomePlan {
  id: string;
  yearMonth: string;
  categoryId: string;
  categoryName?: string | null;
  amountNzd: number;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Planned vs received for one income category. */
export interface IncomeCategorySummary {
  categoryId: string;
  categoryName: string;
  plannedNzd: number;
  actualNzd: number;
  remainingNzd: number;
  recordCount: number;
  plan: IncomePlan | null;
}

export interface IncomeMonthSummary {
  yearMonth: string;
  periodStart: string;
  periodEnd: string;
  plannedNzd: number;
  /** income_records + unlinked is_income inflows (deduped). */
  actualNzd: number;
  recordsTotalNzd: number;
  categoryCreditsExtraNzd: number;
  recordCount: number;
  categoryCreditCount?: number;
  receivedItemCount?: number;
  remainingNzd: number;
  /** @deprecated prefer plans / categories */
  plan: IncomePlan | null;
  plans?: IncomePlan[];
  categories?: IncomeCategorySummary[];
}

export interface Budget {
  id: string;
  categoryId: string;
  periodStart: string;
  periodEnd: string;
  amountNzd: number;
  notes?: string;
  /** YYYY-MM when this row is a calendar-month plan */
  yearMonth?: string | null;
}

/**
 * Home-screen month from budget rows already stored for the signed-in user.
 * Amounts are NZD. `savingsRate` is a fraction of income, same kind of ratio as
 * `debtToIncome`: 0.25 means 25%, not 25. Null when income is zero or negative.
 */
export interface HomeMonthSnapshot {
  /** Calendar month in Pacific/Auckland, YYYY-MM. */
  yearMonth: string;
  /** Inclusive first day, YYYY-MM-DD. */
  periodStart: string;
  /** Inclusive last day, YYYY-MM-DD. */
  periodEnd: string;
  currency: 'NZD';
  timezone: 'Pacific/Auckland';
  /** Received income: income records plus unlinked income-category credits. */
  incomeNzd: number;
  /** Spending-category outflows plus unlinked debt repayments. Transfers are excluded. */
  spendingNzd: number;
  /** incomeNzd − spendingNzd. */
  savingsNzd: number;
  /**
   * savingsNzd / incomeNzd.
   * A fraction of income, not a percent. Null when incomeNzd is not positive.
   */
  savingsRate: number | null;
}

/** Where a projection figure came from. */
export type ProjectionAssumptionSource = 'user_data' | 'default' | 'query';

export interface ProjectionAssumption {
  value: number | null;
  source: ProjectionAssumptionSource;
  reason: string | null;
}

/** One month of the forward projection. Amounts are NZD. `date` is YYYY-MM-DD. */
export interface ProjectionPoint {
  date: string;
  monthIndex: number;
  netWorthNzd: number;
  compoundingAssetsNzd: number;
  /** Cumulative budget saving added. Null when no monthly saving is known. */
  savingsAddedNzd: number | null;
  /** Cumulative KiwiSaver contributions added. Null when none were observed. */
  kiwiSaverContributionsAddedNzd: number | null;
  debtOutstandingNzd: number;
  bankLiabilitiesNzd: number;
  propertyMortgageNzd: number;
}

export interface ProjectionDebtPath {
  id: string;
  name: string;
  startingBalanceNzd: number;
  endingBalanceNzd: number;
  annualRatePercent: number | null;
  interestPeriod: 'month' | 'year' | null;
  actualPaymentNzd: number | null;
  stepped: boolean;
  paysDown: boolean | null;
  reason: string | null;
}

/**
 * Educational forward view of the signed-in user's net worth and savings.
 * Month 0 is today in Pacific/Auckland. Later points are monthly.
 * Formulas are on `formula`. Every rate that is not taken from stored rows
 * is named in `assumptions` with its source.
 */
export interface ProjectionResponse {
  currency: 'NZD';
  timezone: 'Pacific/Auckland';
  asOf: string;
  horizonMonths: number;
  note: string;
  formula: {
    netWorth: string;
    compoundingAssets: string;
    monthlySaving: string;
    debt: string;
  };
  starting: {
    netWorthNzd: number;
    compoundingAssetsNzd: number;
    bankLiabilitiesNzd: number;
    debtOutstandingNzd: number;
    propertyMortgageNzd: number;
    kiwiSaverNzd: number | null;
  };
  assumptions: {
    annualReturnPercent: ProjectionAssumption & { compounding: 'monthly' };
    monthlySavingNzd: ProjectionAssumption & {
      windowMonths: number;
      windowStart: string;
      windowEnd: string;
      incomeNzd: number | null;
      spendingNzd: number | null;
      monthsWithActivity: number;
      observedMonthlyNzd: number | null;
    };
    inflationPercent: ProjectionAssumption;
    kiwiSaverContributionMonthlyNzd: ProjectionAssumption;
    dividends: ProjectionAssumption;
    savingsGoals: ProjectionAssumption;
  };
  debts: ProjectionDebtPath[];
  propertyMortgage: {
    balanceNzd: number;
    stepped: false;
    reason: string;
  };
  bankLiabilities: {
    balanceNzd: number;
    stepped: false;
    reason: string;
  };
  points: ProjectionPoint[];
  savings: {
    monthlyNzd: number | null;
    points: Array<{ date: string; monthIndex: number; cumulativeNzd: number }> | null;
  };
}

export interface HoldingBase {
  id: string;
  assetClass: HoldingAssetClass;
  name: string;
  notes?: string;
  costBasisNzd: number | null;
  acquiredAt?: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Provider logo URL (Akahu/Sharesies instrument logo, etc.).
   * Icons only — never used for prices. Tried before CDN fallbacks.
   */
  logoUrl?: string | null;
}

export interface StockHolding extends HoldingBase {
  assetClass: 'stock';
  symbol: string;
  shares: number;
  exchange?: string | null;
}

export interface CryptoHolding extends HoldingBase {
  assetClass: 'crypto';
  asset: string; // e.g. BTC, ETH, GMT (GoMining token balance)
  amount: number;
}

/**
 * GoMining digital miner (https://gomining.com/) — first-class holding.
 * Tracks individual miners (multiple supported), not only GMT token balance.
 * GMT token can also be recorded as a CryptoHolding with asset "GMT".
 * Market value: manual entry or GoMiningQuoteProvider stub — NEVER invent.
 */
export interface GoMiningMinerHolding extends HoldingBase {
  assetClass: 'gomining_miner';
  /** User-facing identifier / nickname for this miner */
  minerName: string;
  /** Optional platform / marketplace id */
  minerExternalId?: string | null;
  /** Hashrate in TH/s (fractional OK) */
  hashrateThs: number;
  /** Energy efficiency W/TH if known (from GoMining app) */
  energyEfficiencyWth?: number | null;
  /** Rarity label from GoMining (e.g. Common, Uncommon, Rare, …) */
  rarity?: string | null;
  /** Miner level */
  level?: number | null;
  /** Estimated secondary-market / marketplace value in NZD — null until set */
  estimatedValueNzd: number | null;
  estimatedValueAt?: string | null;
  estimatedValueSource?: QuoteSource | null;
}

/**
 * Art — fractional (Masterworks-style) or physical piece.
 * No Masterworks API: manual entry only. Never invent valuations.
 * Value = lastValuationNzd if set, else purchasePriceNzd.
 */
export type ArtKind = 'fractional' | 'physical';

export interface ArtHolding extends HoldingBase {
  assetClass: 'art';
  /** fractional = Masterworks-style share; physical = owned piece (usually 100%). */
  artKind?: ArtKind | null;
  ownershipPct: number;
  purchasePriceNzd: number | null;
  purchaseDate?: string | null;
  lastValuationNzd?: number | null;
  lastValuationAt?: string | null;
  artworkTitle?: string;
  artist?: string;
  /** User appraisal / platform notes (manual only). */
  valuationSource?: QuoteSource | null;
  valuationNotes?: string | null;
  /** Physical piece photo under data/uploads/art/ */
  photoPath?: string | null;
  photoUrl?: string | null;
}

export interface MetalHolding extends HoldingBase {
  assetClass: 'metal';
  metal: MetalKind;
  amount: number;
  unit: MetalUnit;
}

/**
 * Precious stones — comps via search later.
 * NEVER invent valuations; valuationNzd stays null until user or search provides it.
 */
export interface StoneHolding extends HoldingBase {
  assetClass: 'stone';
  stoneType: string;
  carat: number;
  clarity?: string | null;
  cut?: string | null;
  colour?: string | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  depthMm?: number | null;
  valuationNzd: number | null;
  valuationSource?: QuoteSource | null;
  valuationNotes?: string | null;
}

/**
 * Foreign cash held outside NZ bank accounts (e.g. Revolut USD/EUR/GBP).
 * Valued in NZD via Frankfurter (never invent rates).
 */
export interface ForexHolding extends HoldingBase {
  assetClass: 'forex';
  /** ISO 4217 currency code (USD, EUR, GBP, …) */
  currency: string;
  /** Amount in foreign currency */
  amount: number;
  /** Wallet / source label e.g. Revolut */
  source?: string | null;
}


/** Property with manual market value NZD and optional mortgage liability. */
export interface RealEstateHolding extends HoldingBase {
  assetClass: 'real_estate';
  /** Owned / market value NZD (manual — never invented) */
  propertyValueNzd: number;
  /** Mortgage outstanding NZD (manual liability) */
  mortgageOutstandingNzd: number;
  /** Equity = propertyValueNzd − mortgageOutstandingNzd */
  equityNzd?: number;
  /** Relative path under data/uploads (served at /api/uploads/…) */
  photoPath?: string | null;
  photoUrl?: string | null;
}

/** mtg | pokemon | other | custom manual slug (e.g. figurines, sealed). */
export type CollectableCardGame = 'mtg' | 'pokemon' | 'other' | (string & {});

/**
 * Trading cards (MTG via Scryfall, Pokémon via pokemontcg.io).
 * Market NZD from public API × Frankfurter — never invent.
 */
export type MtgColour = 'W' | 'U' | 'B' | 'R' | 'G';

export interface CollectableHolding extends HoldingBase {
  assetClass: 'collectable';
  cardGame: CollectableCardGame;
  cardSet?: string | null;
  cardNumber?: string | null;
  cardFinish?: string | null;
  cardApiId?: string | null;
  cardImageUrl?: string | null;
  /** MTG colour identity (WUBRG). Empty array = colourless. Null = unknown / N/A. */
  cardColours?: MtgColour[] | null;
  /** common | uncommon | rare | mythic (plus special/bonus) */
  cardRarity?: string | null;
  /** Quantity owned */
  quantity: number;
  /** Unit market NZD from API (null if unavailable) */
  unitPriceNzd?: number | null;
  marketValueNzd?: number | null;
  quoteAsOf?: string | null;
  quoteNotes?: string | null;
  valuationNzd?: number | null;
  valuationSource?: QuoteSource | null;
}

export type Holding =
  | StockHolding
  | CryptoHolding
  | GoMiningMinerHolding
  | ArtHolding
  | MetalHolding
  | StoneHolding
  | ForexHolding
  | RealEstateHolding
  | CollectableHolding;

export interface PriceQuote {
  id: string;
  assetKey: string; // e.g. STOCK:AAPL, CRYPTO:BTC, GOMINING:miner:<id>, METAL:gold:oz_t
  currency: CurrencyCode;
  price: number | null;
  status: QuoteStatus;
  source: QuoteSource;
  asOf: string;
  notes?: string | null;
}

export interface ValuationSnapshot {
  id: string;
  takenAt: string;
  totalNzd: number;
  breakdownJson: string;
  notes?: string | null;
}

export interface NetWorthSummary {
  cashNzd: number;
  cashLiabilitiesNzd?: number;
  stocksNzd: number | null;
  cryptoNzd: number | null;
  /** GoMining digital miners (estimated marketplace value or cost basis fallback) */
  gominingMinersNzd: number | null;
  artNzd: number | null;
  metalsNzd: number | null;
  stonesNzd: number | null;
  /** Foreign cash (Revolut etc.) via Frankfurter → NZD */
  forexNzd: number | null;
  /** Real estate gross property value (manual) */
  realEstateNzd: number | null;
  /** Sum of mortgages on real estate */
  realEstateMortgageNzd?: number | null;
  /** Gross value − mortgage */
  realEstateEquityNzd?: number | null;
  /** Collectables (cards) market NZD when quotes ok */
  collectablesNzd: number | null;
  /** Sharesies KiwiSaver (read-only) */
  kiwiSaverNzd: number | null;
  /** Sum of debt_people.outstanding_nzd */
  debtOutstandingNzd?: number;
  debtPersonCount?: number;
  /** Assets before subtracting personal debt */
  assetsKnownNzd?: number;
  /** Net worth = assetsKnownNzd − debtOutstandingNzd */
  totalKnownNzd: number;
  hasUnavailableQuotes: boolean;
  asOf: string;
}

/** Quote provider contract — stubs must return unavailable/stubbed, never fake prices. */
export interface QuoteResult {
  assetKey: string;
  currency: CurrencyCode;
  price: number | null;
  status: QuoteStatus;
  source: QuoteSource;
  asOf: string | null;
  message?: string | null;
}

export interface QuoteProvider {
  readonly id: string;
  readonly name: string;
  getQuote(assetKey: string): Promise<QuoteResult>;
  getQuotes?(assetKeys: string[]): Promise<QuoteResult[]>;
}


/**
 * KiwiSaver (NZ) — read-only observe for net worth (not trading).
 * Sharesies via Akahu; bank-held schemes via manual entry / CSV
 * (IRD/Akahu bank KS not available). Never scrape. Never store passwords.
 */
export interface KiwiSaverFundAllocation {
  fundName: string;
  /** Percentage 0–100 of account balance, or null if only NZD amount known */
  allocationPct: number | null;
  balanceNzd: number | null;
  /** Per-holding returns from Akahu portfolio item when NZD */
  returnsNzd?: number | null;
  shares?: number | null;
  symbol?: string;
  logo?: string;
  fundId?: string;
  currency?: string;
}

export type KiwiSaverConnectionStatus =
  | 'off'
  | 'csv_import'
  | 'official_pending'
  | 'akahu'
  | 'manual';

export interface KiwiSaverAccount {
  id: string;
  name: string;
  /**
   * `sharesies` for Akahu/Sharesies path; otherwise bank/provider label
   * (e.g. ANZ, Westpac, Kiwibank) for manual/CSV bank-held schemes.
   */
  provider: string;
  /** Scheme / fund manager label if known */
  schemeName: string | null;
  balanceNzd: number;
  /** Akahu meta.breakdown.returns, or manual/CSV returns when entered */
  returnsNzd: number | null;
  /** Derived: balance − returns when both real; else null */
  amountInvestedNzd: number | null;
  /** Derived: returns / amountInvested × 100 when amountInvested > 0 */
  returnPct: number | null;
  /** Always null — not exposed as a separate field for Akahu or bank manual */
  governmentContributionNzd: number | null;
  governmentContributionStatus: 'unavailable';
  governmentContributionNote: string;
  pir: number | null;
  fundMix: KiwiSaverFundAllocation[];
  portfolioSumNzd: number | null;
  residualNzd: number | null;
  residualNote: string | null;
  /** When balance was last observed (Akahu/manual/CSV) */
  observedAt: string | null;
  /** Connection: off | csv_import | official_pending | akahu | manual */
  connectionStatus: KiwiSaverConnectionStatus;
  /**
   * Honest provenance for UI: akahu | manual | csv.
   * Derived from connectionStatus / externalId — never pretend CSV is Akahu.
   */
  dataSource: 'akahu' | 'manual' | 'csv' | 'other';
  dataSourceLabel: string;
  notes: string | null;
  activityStatus: string | null;
  activityNote: string | null;
  externalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KiwiSaverHistoryPoint {
  at: string;
  balanceNzd: number;
  returnsNzd: number | null;
  source: string;
}

export interface KiwiSaverHistoryResponse {
  status: 'ok' | 'empty' | 'unavailable';
  message: string | null;
  source: string;
  accountId: string | null;
  points: KiwiSaverHistoryPoint[];
}

export interface KiwiSaverActivityItem {
  id: string;
  date: string;
  description: string;
  amountNzd: number;
  txnType: string | null;
  source: string;
  externalId: string | null;
}

export interface KiwiSaverActivityResponse {
  status: string;
  message: string | null;
  items: KiwiSaverActivityItem[];
  governmentContributionNzd: number | null;
  governmentContributionStatus: string;
  governmentContributionNote?: string;
}

export interface SharesiesCsvImportResult {
  ok: boolean;
  message: string;
  rowsParsed: number;
  accountId: string | null;
}

export interface AppSettings {
  defaultCurrency: CurrencyCode;
  timezone: string;
  locale: string;
}

/** Form payload for creating/editing a GoMining miner */
export interface GoMiningMinerInput {
  minerName: string;
  minerExternalId?: string | null;
  hashrateThs: number;
  energyEfficiencyWth?: number | null;
  rarity?: string | null;
  level?: number | null;
  costBasisNzd?: number | null;
  acquiredAt?: string | null;
  estimatedValueNzd?: number | null;
  notes?: string | null;
}


/** Saved GoMining section settings (app_settings). Discount applies to maintenance only. */
export interface GoMiningSettings {
  discountPct: number;
  btcUsd: number | null;
  networkHashrateEhs: number | null;
  dailyBtcIssuance: number | null;
  kWhCostUsd: number | null;
  /** Live GoMining pool income — preferred Pool Reward input (never invent). */
  income?: {
    poolIncomeUsdPerTh: number | null;
    poolIncomeBtcPerTh: number | null;
    poolIncomeSatPerTh: number | null;
    btcCourseInUsd: number | null;
    status: 'ok' | 'unavailable';
    source: string;
    asOf: string | null;
    message: string | null;
  };
  /** Live Bitcoin network EH/s — Academy fallback when income unavailable. */
  networkHashrate?: {
    networkHashrateEhs: number | null;
    status: 'ok' | 'unavailable';
    source: string;
    asOf: string | null;
    message: string | null;
  };
  defaults: {
    kWhCostUsd: number;
    dailyBtcIssuance: number;
    discountAppliesTo: 'maintenance_fees_only';
    note: string;
  };
}

/** Public-feed headline. Never synthesized by the app. */
export interface NewsStory {
  title: string;
  url: string;
  publisher: string | null;
  publishedAt: string | null;
  /** Feed the story was read from (Google News, BBC News). */
  sourceName: string;
  /** World-section label, otherwise null. */
  topic: string | null;
}

export type NewsSectionStatus = 'ok' | 'empty' | 'error';
export type NewsSectionKind = 'holdings' | 'world';

export interface NewsSection {
  id: string;
  title: string;
  kind: NewsSectionKind;
  /** Labels for this user's own holdings that opened the section. */
  matched: string[];
  matchedCount: number;
  status: NewsSectionStatus;
  message: string | null;
  sources: string[];
  items: NewsStory[];
}

export interface NewsFeedResponse {
  fetchedAt: string;
  sections: NewsSection[];
}

/** Read-only crypto wallet (public address only — never keys or recovery phrases). */
export type WalletNetwork = 'ethereum' | 'polygon' | 'base' | 'arbitrum' | 'bitcoin' | 'solana';

export type Wallet = {
  id: string;
  name: string;
  network: WalletNetwork;
  address: string;
  status: 'connected' | 'syncing' | 'error';
  statusMessage: string | null;
  lastSynced: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WalletNetworkInfo = {
  network: WalletNetwork;
  label: string;
  family: 'evm' | 'bitcoin' | 'solana';
  nativeSymbol: string;
  syncable: boolean;
  configured: boolean;
};

export type WalletValuationItem = {
  asset: { kind: 'native' | 'token'; symbol: string; name: string; decimals: number; contract: string | null };
  amountRaw: string;
  amount: string;
  status: 'priced' | 'stale' | 'unpriced';
  priceNzd: number | null;
  valueNzd: number | null;
  pricedAt: string | null;
  priceSource: string | null;
  message: string | null;
};

export type WalletValuation =
  | {
      ok: true;
      fetchedAt: string;
      currency: 'NZD';
      items: WalletValuationItem[];
      totalNzd: number;
      complete: boolean;
      pricedAt: string | null;
      hasStalePrices: boolean;
    }
  | { ok: false; error: string; code: string; retryAfterSec: number | null };

export type WalletsValuationResponse = {
  currency: 'NZD';
  totalNzd: number;
  complete: boolean;
  pricedAt: string | null;
  hasStalePrices: boolean;
  failedWallets: number;
  wallets: Array<{ wallet: Wallet; valuation: WalletValuation }>;
};
