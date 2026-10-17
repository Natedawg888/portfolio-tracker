/**
 * KoruLedger (NZD) — shared domain types
 * Currency default: NZD. Display timezone: Pacific/Auckland.
 * Never invent live prices, miner secondary-market values, or stone valuations.
 */

import type { OutputPaySourceInputs, OutputPayType } from '../lib/outputPayCalc';
import type { DuePreset, GstMode, InvoiceStatus, InvoiceStoredStatus } from '../lib/invoiceCalc';
import type { MiningPlan, ProjectionClassKey } from '../lib/projectionClasses';
import type { MiningProjection } from '../lib/miningProjection';
import type { Cadence, PossiblePayment, RecurringKind, RecurringStatus, RecurringSuggestion } from '../lib/recurring';
import type { WarrantyStatus } from '../lib/warranty';
import type { RentalCategory, RentalEntryKind } from '../lib/rental';
import type { RentFrequency } from '../lib/rentalRooms';
import type { CommodityCategory, CommodityUnit, PriceBasis } from '../lib/commodities';
import type { MiningType } from '../lib/miningProviders';

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

/** Budget triage: up to 3 categories for an uncategorised transaction, most likely first. */
export interface TxnCategorySuggestions {
  transactionId: string;
  suggestions: Array<{ categoryId: string; source: 'payee' | 'history' | 'popular' }>;
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
  /** Savings account linked to this goal (its balance is the amount saved), or null. */
  accountId: string | null;
  /** "Name · Institution" of the linked account. */
  accountName: string | null;
  /** 'account' when currentAmountNzd is the linked account's balance; 'manual' when typed. */
  amountSource: 'account' | 'manual';
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
  /** NZD bank account id, or null to unlink. */
  accountId?: string | null;
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
  /** Expected monthly income from saved pay sources (KAN-70). Null when none are saved. */
  expectedPay?: PaySourcesExpected | null;
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
  /** Expected monthly income from saved pay sources (KAN-70). Null when none are saved. */
  expectedPay?: PaySourcesExpected | null;
  /** Where spendingNzd went. Null when nothing was spent. */
  spendingBreakdown?: SpendingBreakdown | null;
}

export interface SpendingBreakdownRow {
  label: string;
  amountNzd: number;
}

/**
 * Month spending by category (every category, largest first), or, when no
 * spending is categorised, the top 5 merchants. Merchant rows need not add up
 * to the month total.
 */
export interface SpendingBreakdown {
  by: 'category' | 'merchant';
  rows: SpendingBreakdownRow[];
}

/** A pay calculation saved as an income source (piece rate, contract, share of catch). */
export interface PaySource {
  id: string;
  name: string;
  payType: OutputPayType;
  /** Tax year (start year) whose rates were used. */
  taxYear: number;
  inputs: OutputPaySourceInputs | null;
  weeklyGrossNzd: number;
  /** Typical weekly amount that lands in your pocket. */
  weeklyNetNzd: number;
  /** weeklyNetNzd × 52 ÷ 12. */
  monthlyNetNzd: number;
  createdAt: string;
  updatedAt: string;
}

/** Saved pay sources added up as expected income. */
export interface PaySourcesExpected {
  count: number;
  weeklyNetNzd: number;
  monthlyNetNzd: number;
  sources: Array<{ id: string; name: string; payType: OutputPayType; weeklyNetNzd: number }>;
}

export interface ProjectionMining {
  status: 'ok' | 'unavailable' | 'no_miners';
  reason: string | null;
  plan: MiningPlan & { rewardsTo: 'crypto' | 'cash' | 'reinvest' };
  inputs: {
    th: number;
    avgWth: number | null;
    poolSatPerThDay: number | null;
    btcUsd: number | null;
    btcNzd: number | null;
    kWhCostUsd: number;
    discountPct: number;
    btcPriceChangePctYear: number;
    rewardChangePctYear: number;
    recordedMiningIncomeMonthlyNzd: number;
    asOf: string | null;
  } | null;
  projection: MiningProjection | null;
}

export interface ProjectionAssetClass {
  key: ProjectionClassKey;
  label: string;
  startNzd: number;
  endNzd: number;
  annualReturnPercent: number;
  /** saved = the user's saved default for this class. */
  returnSource: 'user_data' | 'default' | 'query' | 'saved';
  monthlyAdditionNzd: number | null;
  additionSource: 'user_data' | 'default' | 'query' | 'saved';
  additionReason: string | null;
  addedNzd: number;
  growthNzd: number;
  /** This class's yearly increase in what's added, %. */
  additionGrowthPercentYear?: number;
  growthSource?: 'user_data' | 'default' | 'query' | 'saved';
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
  /** Value of each asset class at this point. */
  byClassNzd?: Partial<Record<ProjectionClassKey, number>>;
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
  /** Classes hidden in Settings → Categories & assets that hold something; left out of the projection. */
  hiddenClasses?: { key: string; label: string; nzd: number }[];
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
      /** Monthly take-home from saved pay sources, used when the window has no recorded income. */
      expectedPayMonthlyNzd?: number | null;
      /** True when expectedPayMonthlyNzd stood in for recorded income. */
      usedExpectedPay?: boolean;
    };
    inflationPercent: ProjectionAssumption;
    kiwiSaverContributionMonthlyNzd: ProjectionAssumption;
    dividends: ProjectionAssumption;
    savingsGoals: ProjectionAssumption;
  };
  /** Each asset class grown on its own return with its own monthly addition. */
  assetClasses: ProjectionAssetClass[];
  /** Yearly step-up of monthly additions. */
  additionGrowthPercentYear?: { value: number; source: 'default' | 'query' | 'saved'; reason: string };
  /** GoMining rewards from the live model, with the user's plan (add TH, upgrade W/TH, reinvest). */
  mining?: ProjectionMining;
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
 * Crypto mining card (asset class key `gomining_miner`, kept from before KAN-85): the user's own
 * rig (hardware) or a cloud mining plan with a provider (GoMining, or another named service).
 * Tracks individual miners (multiple supported), not only GMT token balance.
 * GMT token can also be recorded as a CryptoHolding with asset "GMT".
 * Market value: manual entry or GoMiningQuoteProvider stub — NEVER invent.
 */
export interface GoMiningMinerHolding extends HoldingBase {
  assetClass: 'gomining_miner';
  /** User-facing identifier / nickname for this miner */
  minerName: string;
  miningType: MiningType;
  /** Cloud only: provider key from MINING_PROVIDERS, or the name typed. Null for hardware. */
  miningProvider: string | null;
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
  /** Vehicles counted in net worth (KAN-65): recorded value, loans entered on them, the difference. */
  vehiclesNzd?: number | null;
  vehicleLoansNzd?: number | null;
  vehiclesEquityNzd?: number | null;
  /** Businesses counted in net worth (KAN-84): each one's value (assets plus linked produce). */
  businessAssetsNzd?: number | null;
  /** DeFi positions counted in net worth (KAN-47). */
  defiNzd?: number | null;
  /** Bonds and term deposits (KAN-80), and the term-deposit part. */
  bondsNzd?: number | null;
  bondsTermDepositsNzd?: number | null;
  /** Commodities (KAN-81): values the user set; and whether Plus shows them in the asset mix. */
  commoditiesNzd?: number | null;
  commoditiesExposure?: boolean;
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
  miningType?: MiningType;
  miningProvider?: string | null;
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

/** Saved on the user (preferences_json.news), not in the browser. */
export interface NewsUserState {
  readUrls: string[];
  savedUrls: string[];
  groupDailyPriceUpdates: boolean;
  includeClosedPositions: boolean;
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

/** Business details printed on the user's invoices (KAN-71). */
export interface BusinessProfile {
  businessName: string;
  address: string;
  email: string;
  phone: string;
  bankAccount: string;
  gstRegistered: boolean;
  gstNumber: string;
  nzbn: string;
  invoicePrefix: string;
}

export interface InvoiceClient {
  id: string;
  /** The business this client belongs to (KAN-84). */
  businessId: string | null;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  reference: string;
  notes: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

/** What a client form sends. */
export interface InvoiceClientWriteBody {
  businessId?: string | null;
  name: string;
  contactPerson?: string;
  email: string;
  phone?: string;
  address: string;
  reference: string;
  notes?: string;
  status?: 'active' | 'inactive';
}

// ---------------------------------------------------------------- Business (KAN-84)

export type BusinessTypeValue = 'sole_trader' | 'partnership' | 'company' | 'hobby';
export type BusinessAssetCategory = 'livestock' | 'beehives' | 'equipment' | 'vehicle' | 'stock' | 'other';
export type BusinessMovementKind = 'purchase' | 'birth' | 'sale' | 'death' | 'loss';

export interface Business {
  id: string;
  name: string;
  type: BusinessTypeValue;
  industry: string;
  nzbn: string;
  gstRegistered: boolean;
  gstNumber: string;
  /** Printed on invoices and used as their Reply-To. */
  email: string;
  address: string;
  phone: string;
  bankAccount: string;
  invoicePrefix: string;
  logoUrl: string | null;
  clientsEnabled: boolean;
  /** Its assets count in net worth, History and Projections. */
  countInNetWorth: boolean;
  /** Existing invoices and clients were attached to this one; it is used when none is picked. */
  isDefault: boolean;
  /** Archived: hidden from Business, net worth and pickers, kept with its invoices. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type BusinessWriteBody = Omit<Business, 'id' | 'logoUrl' | 'isDefault' | 'archivedAt' | 'createdAt' | 'updatedAt'>;

export interface BusinessTotals {
  incomeNzd: number;
  expensesNzd: number;
  netNzd: number;
  /** User-entered asset values; null when no asset has a value yet. */
  assetsNzd: number | null;
  /** Educational GST-collected estimate for GST-registered businesses (3/23 of income); null otherwise. */
  gstCollectedEstimateNzd: number | null;
  outstandingNzd: number;
}

export interface BusinessCard extends Business {
  totals: BusinessTotals;
  assetCount: number;
  clientCount: number;
  invoiceCount: number;
  /** Active employees. */
  employeeCount: number;
  /** Recorded in the selected tax year: invoices issued and items tagged (invoice payments, income, transactions). */
  activity: { invoices: number; tagged: number };
}

export interface BusinessListResponse {
  today: string;
  /** Tax year named by the year it ends in (2027 = 1 Apr 2026 – 31 Mar 2027). */
  taxYear: number;
  taxYears: number[];
  /** Active businesses. */
  businesses: BusinessCard[];
  /** Archived businesses, newest first. */
  archived: ArchivedBusiness[];
}

export interface ArchivedBusiness {
  id: string;
  name: string;
  type: BusinessTypeValue;
  logoUrl: string | null;
  archivedAt: string;
  /** A business with invoices stays archived; one without can be deleted. */
  invoiceCount: number;
}

export interface BusinessAssetMovement {
  id: string;
  assetId: string;
  date: string;
  kind: BusinessMovementKind;
  quantity: number;
  amountNzd: number | null;
  notes: string;
  createdAt: string;
}

export interface BusinessAsset {
  id: string;
  businessId: string;
  category: BusinessAssetCategory;
  name: string;
  quantity: number;
  unit: string;
  costNzd: number | null;
  valueMode: 'total' | 'per_unit';
  /** The total, or the value per unit when valueMode is per_unit. */
  valueNzd: number | null;
  valuedOn: string | null;
  /** valueNzd applied to the quantity; null when no value is entered. */
  currentValueNzd: number | null;
  animalType: string;
  tag: string;
  location: string;
  status: 'active' | 'dead' | 'sold';
  notes: string;
  movements: BusinessAssetMovement[];
  createdAt: string;
  updatedAt: string;
}

export interface BusinessAssetWriteBody {
  category: BusinessAssetCategory;
  name: string;
  quantity: number;
  unit?: string;
  costNzd?: number | null;
  valueMode?: 'total' | 'per_unit';
  valueNzd?: number | null;
  valuedOn?: string | null;
  animalType?: string;
  tag?: string;
  location?: string;
  status?: 'active' | 'dead' | 'sold';
  notes?: string;
}

/** A transaction or income row tagged to a business (or one that could be). */
export interface BusinessMoneyItem {
  kind: 'transaction' | 'income';
  id: string;
  date: string;
  description: string;
  /** Money in is positive, money out negative. */
  amountNzd: number;
  businessId: string | null;
  /** Counted elsewhere already (an invoice payment, or a deposit an income row is linked to), so not added again. */
  countedVia: 'invoice' | 'income' | null;
}

/** A commodity held as a business's produce. The price is the one the user set on it, with its date. */
export interface BusinessProduce {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  valueNzd: number | null;
  unitPriceNzd: number | null;
  valueOn: string | null;
  /** Price over 30 days old, or undated. */
  stale: boolean;
}

export interface BusinessDetail {
  today: string;
  taxYear: number;
  taxYears: number[];
  business: Business;
  totals: BusinessTotals;
  assets: BusinessAsset[];
  clients: (InvoiceClient & { billedNzd: number; outstandingNzd: number })[];
  invoices: InvoiceSummary[];
  /** Tagged items in the tax year, newest first. */
  money: BusinessMoneyItem[];
  /** Commodities linked as produce held (valued and counted on Portfolio → Commodities). */
  produce: BusinessProduce[];
  employees: BusinessEmployee[];
}

/** Someone the business employs. Records only: nothing is paid from the app. */
export interface BusinessEmployee {
  id: string;
  businessId: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  address: string;
  /** NZ format, 12-3456-7890123-00. */
  bankAccount: string;
  payRateNzd: number | null;
  payUnit: 'hour' | 'day' | 'week' | 'fortnight' | 'month' | 'year';
  payFrequency: 'weekly' | 'fortnightly' | 'four_weekly' | 'monthly';
  /** The pay date as entered. */
  payDate: string | null;
  /** The next pay day on or after today, rolled on from payDate. */
  nextPayDate: string | null;
  startDate: string | null;
  status: 'active' | 'inactive';
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type BusinessEmployeeWriteBody = Omit<BusinessEmployee, 'id' | 'businessId' | 'nextPayDate' | 'createdAt' | 'updatedAt'>;

export interface BusinessClientView {
  client: InvoiceClient;
  businessName: string;
  invoices: InvoiceSummary[];
  /** Sent invoices (void ones left out). */
  billedNzd: number;
  outstandingNzd: number;
  lastPayment: { date: string; amountNzd: number; invoiceNumber: string } | null;
}

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  lineTotalNzd: number;
}

export interface InvoicePayment {
  id: string;
  date: string;
  amountNzd: number;
  method: string;
  notes: string;
  /** Income record this payment added to the budget, when it was added. */
  incomeRecordId: string | null;
  createdAt: string;
}

export type InvoiceSendChannel = 'resend' | 'email_app' | 'share';

export interface InvoiceSendLog {
  id: string;
  kind: 'invoice' | 'reminder';
  /** resend = sent by the app; email_app / share = the user sent it themselves. */
  channel: InvoiceSendChannel;
  recipients: string[];
  subject: string;
  status: 'sent' | 'failed';
  error: string | null;
  sentAt: string;
}

/** One row of the invoice list. */
export interface InvoiceSummary {
  id: string;
  businessId: string | null;
  businessName: string;
  number: string;
  status: InvoiceStatus;
  storedStatus: InvoiceStoredStatus;
  clientId: string | null;
  clientName: string;
  issueDate: string;
  dueDate: string;
  totalNzd: number;
  amountDueNzd: number;
  paidNzd: number;
  balanceNzd: number;
  sentAt: string | null;
}

export interface Invoice extends InvoiceSummary {
  clientEmail: string;
  clientAddress: string;
  clientReference: string;
  duePreset: DuePreset;
  reference: string;
  gstMode: GstMode;
  withholdingRatePct: number | null;
  notes: string;
  paymentInstructions: string;
  /** Business details as printed on this invoice. */
  business: BusinessProfile;
  lines: InvoiceLine[];
  subtotalNzd: number;
  gstNzd: number;
  withholdingNzd: number;
  /** Title printed on the invoice: "Tax invoice" when GST registered. */
  title: 'Tax invoice' | 'Invoice';
  shareUrl: string | null;
  payments: InvoicePayment[];
  sends: InvoiceSendLog[];
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceListResponse {
  invoices: InvoiceSummary[];
  totals: {
    outstandingNzd: number;
    overdueNzd: number;
    paidThisMonthNzd: number;
    paidTaxYearNzd: number;
    /** NZ tax year start (YYYY-04-01) used for paidTaxYearNzd. */
    taxYearStart: string;
  };
  nextNumber: string;
  /** False when email sending isn't configured on this server. */
  emailEnabled: boolean;
}

/** What a share link shows: the invoice itself and nothing else. */
export interface PublicInvoice {
  number: string;
  title: 'Tax invoice' | 'Invoice';
  status: InvoiceStatus;
  business: BusinessProfile;
  clientName: string;
  clientEmail: string;
  clientAddress: string;
  clientReference: string;
  issueDate: string;
  dueDate: string;
  reference: string;
  gstMode: GstMode;
  lines: InvoiceLine[];
  subtotalNzd: number;
  gstNzd: number;
  totalNzd: number;
  withholdingRatePct: number | null;
  withholdingNzd: number;
  amountDueNzd: number;
  paidNzd: number;
  balanceNzd: number;
  notes: string;
  paymentInstructions: string;
}

/** A saved bill or subscription (KAN-26). */
export interface RecurringItem {
  id: string;
  name: string;
  /** Links the item to its transactions; null for items added by hand without a payee. */
  merchantKey: string | null;
  kind: RecurringKind;
  amountNzd: number;
  /** amountNzd converted to a monthly figure for its cadence. */
  monthlyNzd: number;
  cadence: Cadence;
  /** Active items: first due date on or after today. Paused / cancelled: the saved date. */
  nextDue: string;
  categoryId: string | null;
  categoryName: string | null;
  status: RecurringStatus;
  source: 'detected' | 'manual';
  notes: string;
  /** Latest matching payment in the last 15 months. */
  lastPaidDate: string | null;
  lastPaidNzd: number | null;
  /** Active items with no last paid: a recent payment that looks like this bill, to link. */
  possiblePayment: PossiblePayment | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringListResponse {
  today: string;
  items: RecurringItem[];
  /** Repeating payments found in transactions that aren't saved or dismissed yet. */
  suggestions: Array<Omit<RecurringSuggestion, 'transactionIds'> & { transactionCount: number }>;
  dismissedCount: number;
  totals: {
    /** Active items only. */
    monthlyNzd: number;
    yearlyNzd: number;
    dueNext30DaysNzd: number;
    activeCount: number;
  };
}

/** GET /api/health-score (KAN-55). */
export type HealthScoreResponse = import('../lib/healthScore').HealthScore & {
  asOf: string;
  windowStart: string | null;
  windowEnd: string | null;
};

/** A money-out transaction a warranty can be linked to (KAN-61). */
export interface WarrantyPurchase {
  id: string;
  date: string;
  description: string;
  /** Positive amount paid. */
  amountNzd: number;
  /** `/api/uploads/...` when the transaction has a receipt, else null. */
  receiptUrl: string | null;
}

/** Warranty on something the user bought (KAN-61). */
export interface Warranty {
  id: string;
  itemName: string;
  retailer: string;
  priceNzd: number | null;
  startsOn: string;
  /** Last day of cover. */
  endsOn: string;
  status: WarrantyStatus;
  /** Days of cover left counting today; negative once expired. */
  daysLeft: number;
  notes: string;
  /** Linked purchase; null when not linked or the transaction was deleted. */
  transactionId: string | null;
  purchase: WarrantyPurchase | null;
  /** The warranty's own receipt / warranty card, `/api/uploads/warranties/...`. */
  receiptUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WarrantyListResponse {
  today: string;
  /** Soonest ending first; expired after the rest, most recently expired first. */
  items: Warranty[];
  expiringSoonDays: number;
  totals: { active: number; expiring: number; expired: number };
}

/** How a rental property is let (KAN-83): the whole place, or room by room. */
export type RentalLetType = 'whole' | 'rooms';

/** A rental property (KAN-66). */
export interface RentalProperty {
  id: string;
  name: string;
  address: string;
  notes: string;
  letType: RentalLetType;
  /** The user lives here and lets rooms (boarders / flatmates). Only with letType 'rooms'. */
  ownHome: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Money in or out on a rental property (KAN-66). amountNzd is always positive. */
export interface RentalEntry {
  id: string;
  propertyId: string;
  date: string;
  kind: RentalEntryKind;
  category: RentalCategory;
  amountNzd: number;
  description: string;
  /** Rent received for this room (KAN-83). Income on a property let by room only. */
  roomId: string | null;
  /** Expense split across the property's rooms by share; false = an owner cost (KAN-83). */
  shared: boolean;
  /** User asked for this entry to count in Budget / Income. */
  addToMoney: boolean;
  /**
   * The entry currently shows in Budget / Income (as an income row or a spending
   * transaction). False when not asked for, dated before those views start, or the
   * mirrored row was deleted there.
   */
  inMoneyViews: boolean;
  /** Expense matched to this bank / imported debit instead of adding its own transaction. */
  bankMatch: { date: string; description: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface RentalListResponse {
  today: string;
  /** Budget and Income count rental entries from this date. */
  moneyViewsFrom: string;
  /** Oldest first by name. */
  properties: RentalProperty[];
  /** Newest first. */
  entries: RentalEntry[];
  /** Rooms of properties let by room, in the order added. */
  rooms: RentalRoom[];
  /** Newest start first. */
  tenancies: RentalTenancy[];
}

/** A room let in a property (KAN-83). */
export interface RentalRoom {
  id: string;
  propertyId: string;
  name: string;
  /** e.g. ensuite, furnished */
  note: string;
  /** Weight for splitting shared expenses across the property's rooms. */
  share: number;
  createdAt: string;
  updatedAt: string;
}

/** Someone renting a room (KAN-83). Display name only; no contact details. */
export interface RentalTenancy {
  id: string;
  roomId: string;
  tenantLabel: string;
  rentAmount: number;
  rentFrequency: RentFrequency;
  billsIncluded: boolean;
  startDate: string;
  endDate: string | null;
  bondAmount: number;
  /** Bond lodged with Tenancy Services. */
  bondLodged: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Shopping lists (KAN-74). */
export interface ShoppingListSummary {
  id: string;
  name: string;
  categoryId: string | null;
  itemCount: number;
  tickedCount: number;
  estimatedTotalNzd: number;
  updatedAt: string;
}

export interface ShoppingItem {
  id: string;
  name: string;
  quantity: number;
  /** Price of one unit; null when unknown. */
  estPriceNzd: number | null;
  lineTotalNzd: number | null;
  categoryId: string | null;
  ticked: boolean;
  /** Key used to look up shared prices: the corrected match, else the normalised name. */
  productKey: string;
  matchCorrected: boolean;
}

export interface ShoppingBudgetLine {
  categoryId: string;
  categoryName: string;
  /** Unticked items in this category. */
  toBuyNzd: number;
  /** This month's plans for the category; null when there is no plan. */
  plannedNzd: number | null;
  spentNzd: number;
  remainingNzd: number | null;
}

export interface ShoppingListDetail {
  id: string;
  name: string;
  categoryId: string | null;
  updatedAt: string;
  items: ShoppingItem[];
  totals: { estimatedNzd: number; toBuyNzd: number; unpricedCount: number };
  budget: ShoppingBudgetLine[];
}

export type ShoppingChain = 'woolworths' | 'paknsave' | 'newworld' | 'freshchoice' | 'supervalue' | 'foursquare' | 'warehouse' | 'costco';

export interface ShoppingStore {
  chain: ShoppingChain;
  branch: string;
}

export interface ShoppingPrefs {
  contributePrices: boolean;
  stores: ShoppingStore[];
  windowDays: number;
}

export interface ShoppingStoreComparison {
  chain: ShoppingChain;
  chainLabel: string;
  branch: string;
  total: number;
  pricedCount: number;
  items: Record<string, { unitPrice: number; lineTotal: number; observedOn: string } | null>;
}

export interface ShoppingCompareResponse {
  itemCount: number;
  stores: ShoppingStoreComparison[];
  cheapest: ShoppingStore | null;
  split: { total: number; pricedCount: number; savingVsCheapest: number | null } | null;
  windowDays: number;
  from: string;
  to: string;
}

/** Households (KAN-77). */
export type HouseholdRole = 'owner' | 'adult' | 'viewer';

export interface HouseholdView {
  plan: { householdFeature: boolean };
  household: null | {
    id: string;
    name: string;
    /** False when the owner's plan no longer covers households. */
    active: boolean;
    myRole: HouseholdRole;
    members: { userId: string; name: string; email: string; role: HouseholdRole; joinedAt: string; isMe: boolean }[];
    /** Pending invites; only the owner receives them. */
    invites: { id: string; email: string; role: HouseholdRole; createdAt: string; expiresAt: string; expired: boolean }[];
    activity: { id: string; actorName: string; action: string; detail: string; createdAt: string }[];
  };
}

/** Household sharing (KAN-77 phase 2). */
export type HouseholdShareKind = 'budget' | 'bill' | 'goal' | 'holding' | 'account';
export type HouseholdShareable = Record<HouseholdShareKind, { id: string; name: string; detail: string; shared: boolean }[]>;
export interface HouseholdDashboard {
  canEdit: boolean;
  month: string;
  netWorth: {
    totalNzd: number;
    holdings: { id: string; owner: string; name: string; valueNzd: number }[];
    accounts: { id: string; owner: string; name: string; balanceNzd: number }[];
    unvalued: number;
  };
  budgets: { id: string; owner: string; name: string; plannedNzd: number | null; spentNzd: number; remainingNzd: number | null }[];
  bills: { id: string; owner: string; name: string; amountNzd: number; nextDue: string; cadence: string }[];
  goals: { id: string; owner: string; name: string; targetNzd: number; currentAmountNzd: number; deadline: string | null; amountSource: 'account' | 'manual' }[];
  transactions: { id: string; member: string; account: string; date: string; description: string; amountNzd: number; splitId: string | null }[];
  /** KAN-79: combined monthly take-home as money in, when the household turns it on. */
  moneyIn: { monthlyNzd: number; includedCount: number; plannedNzd: number; leftNzd: number } | null;
}

/** Household splits and settle-up (KAN-77 phase 3). */
export type HouseholdSplitMethod = 'equal' | 'percent' | 'amount';
export interface HouseholdSplitsView {
  canEdit: boolean;
  members: { id: string; name: string }[];
  splits: {
    id: string;
    transactionId: string;
    payerId: string;
    payer: string;
    description: string;
    date: string;
    totalNzd: number;
    method: HouseholdSplitMethod;
    shares: { memberId: string; name: string; amountNzd: number; input: number | null }[];
  }[];
  settlements: { id: string; fromId: string; from: string; toId: string; to: string; amountNzd: number; paidOn: string; note: string }[];
  balances: { memberId: string; name: string; netNzd: number; left: boolean }[];
  suggestions: { fromId: string; from: string; toId: string; to: string; amountNzd: number }[];
}

/** Household PAYE (KAN-79). Annual NZD; payeNzd is income tax after IETC, ACC is separate. */
export interface HouseholdPayFigures {
  grossNzd: number;
  payeNzd: number;
  accNzd: number;
  kiwiSaverNzd: number;
  studentLoanNzd: number;
  netNzd: number;
}
export interface HouseholdPayInputs {
  amount: number;
  frequency: 'hour' | 'week' | 'fortnight' | 'month' | 'year';
  hoursPerWeek: number;
  employment: 'primary' | 'secondary';
  secondaryTotalAnnualIncome: number;
  otherAnnualGross: number;
  kiwiSaverOptIn: boolean;
  kiwiSaverEmployeeRatePct: number;
  kiwiSaverEmployerRatePct: number;
  salarySacrifice: boolean;
  studentLoan: boolean;
  ietc: boolean;
}
export interface HouseholdPayeView {
  taxYear: number;
  years: { startYear: number; label: string; current: boolean }[];
  canSeeMembers: boolean;
  canEdit: boolean;
  active: boolean;
  members: {
    memberId: string;
    name: string;
    isMe: boolean;
    lines: (HouseholdPayFigures & { label: string; kind: 'salary' | 'piece' | 'schedular' | 'share_of_catch'; taxCode: string | null; onPaye: boolean })[];
    totals: HouseholdPayFigures;
  }[];
  includedCount: number;
  totals: HouseholdPayFigures;
  netPerPeriod: { week: number; fortnight: number; month: number; year: number };
  mine: { optedIn: boolean; inputs: HouseholdPayInputs | null; includePaySources: boolean; paySourceCount: number };
  feedBudget: boolean;
}
export type HouseholdWhatIfChange =
  | { kind: 'hours'; hoursPerWeek: number }
  | { kind: 'salary'; annualNzd: number }
  | { kind: 'stop' }
  | { kind: 'kiwisaver'; ratePct: number };
export interface HouseholdWhatIfResult {
  taxYear: number;
  memberName: string;
  description: string;
  before: HouseholdPayFigures;
  after: HouseholdPayFigures;
  memberBefore: HouseholdPayFigures;
  memberAfter: HouseholdPayFigures;
  netChangePerPeriod: { week: number; fortnight: number; month: number; year: number };
  notes: string[];
}

/** Working for Families estimate (KAN-79). Annual NZD unless noted; weekly amounts are rounded down. */
export interface WffAmounts {
  ftc: number;
  iwtc: number;
  mftc: number;
  bestStart: number;
  total: number;
}
export interface HouseholdFamilyView {
  taxYear: number;
  yearLabel: string;
  canEdit: boolean;
  members: { id: string; name: string }[];
  partners: { memberId: string; name: string; sharesPay: boolean }[];
  children: { id: string; birthMonth: string; memberId: string | null; memberName: string | null }[];
  mainBenefit: boolean;
  rates: { checkedOn: string; sources: { label: string; url: string }[] } | null;
  missing: string | null;
  familyIncomeNzd: number | null;
  estimate: {
    annual: WffAmounts;
    weekly: WffAmounts;
    abated: { ftc: number; iwtc: number; bestStart: number };
    full: { ftc: number; iwtc: number; bestStart: number };
    dependentChildren: number;
    bestStartChildren: number;
    notes: string[];
  } | null;
}

/** Payslips (KAN-78). */
export type PayslipFrequency = 'weekly' | 'fortnightly' | 'four_weekly' | 'monthly' | 'other';
export interface PayslipWriteBody {
  paySourceId: string | null;
  employer: string;
  frequency: PayslipFrequency;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  taxCode: string;
  hours: number | null;
  hourlyRate: number | null;
  grossNzd: number;
  payeNzd: number;
  /** null when the payslip includes ACC in PAYE. */
  accNzd: number | null;
  kiwiSaverEmployeeNzd: number;
  kiwiSaverRatePct: number | null;
  kiwiSaverEmployerNzd: number;
  esctNzd: number;
  studentLoanNzd: number;
  otherDeductionsNzd: number;
  allowancesNzd: number;
  netNzd: number;
  addToIncome: boolean;
  notes: string;
}
export type PayslipCheck =
  | {
      status: 'checked';
      allOk: boolean;
      taxYear: number;
      items: { key: string; label: string; actual: number; expected: number; difference: number; ok: boolean; note?: string }[];
      tolerance: string;
      notes: string[];
    }
  | { status: 'not_checked'; reason: string };
export interface Payslip extends PayslipWriteBody {
  id: string;
  employerKey: string;
  taxYear: number;
  fileUrl: string | null;
  netCheck: { expected: number; matches: boolean };
  check: PayslipCheck | null;
  income: { inIncome: boolean; bankMatch: { transactionId: string; date: string; description: string; amountNzd: number } | null; reason: string | null };
}
export interface PayslipsView {
  plan: { plus: boolean; freeLimit: number; usedThisYear: number };
  taxYear: number;
  years: { startYear: number; label: string }[];
  payslips: Payslip[];
  ytd: {
    count: number;
    grossNzd: number;
    taxNzd: number;
    accNzd: number;
    kiwiSaverNzd: number;
    studentLoanNzd: number;
    netNzd: number;
    bySource: { sourceKey: string; employer: string; count: number; grossNzd: number; netNzd: number; missing: { after: string; before: string }[] }[];
  };
  history: { payDate: string; employer: string; grossNzd: number; netNzd: number }[];
  paySources: { id: string; name: string }[];
  /** Saved as payslips are added, newest first, with their latest payslip's details. */
  employers: {
    key: string;
    name: string;
    count: number;
    lastPayDate: string;
    usual: { paySourceId: string | null; frequency: PayslipFrequency; taxCode: string; hours: number | null; hourlyRate: number | null; kiwiSaverRatePct: number | null; accInPaye: boolean };
  }[];
  employer: string | null;
}

/** Vehicles (KAN-65). */
export type VehicleCostFrequency = 'week' | 'fortnight' | 'month' | 'quarter' | 'year';
export type VehicleCostKind = 'fuel' | 'charging' | 'insurance' | 'registration' | 'wof' | 'servicing' | 'tyres' | 'ruc' | 'parking' | 'other';
export interface VehicleWriteBody {
  name: string;
  kind: 'car' | 'ute' | 'van' | 'motorbike' | 'campervan' | 'truck' | 'boat' | 'trailer' | 'other';
  make: string;
  model: string;
  year: number | null;
  plate: string;
  purchaseDate: string | null;
  purchasePriceNzd: number | null;
  valueNzd: number | null;
  valuedOn: string | null;
  countInNetWorth: boolean;
  loan: {
    kind: 'none' | 'manual' | 'account';
    accountId: string | null;
    balanceNzd: number | null;
    lender: string;
    ratePct: number | null;
    repaymentNzd: number | null;
    repaymentFrequency: VehicleCostFrequency | null;
  };
  runningCosts: { kind: VehicleCostKind; amountNzd: number; frequency: VehicleCostFrequency; label?: string }[];
  odometer: { reading: number | null; unit: 'km' | 'mi'; readOn: string | null; atPurchase: number | null };
  /** % a year, diminishing value, for an estimated value. */
  depreciationPct: number | null;
  notes: string;
}
type VehiclePerPeriod = { week: number; month: number; year: number };
export interface Vehicle extends VehicleWriteBody {
  id: string;
  estimate: { valueNzd: number; years: number; ratePct: number } | null;
  distance: { perYear: number; unit: 'km' | 'mi'; runningCostPerUnit: number | null } | null;
  loanOwedNzd: number | null;
  loanAccountName: string | null;
  equityNzd: number | null;
  costToOwn: { running: VehiclePerPeriod; loan: VehiclePerPeriod; total: VehiclePerPeriod; byKind: { kind: VehicleCostKind; label: string; year: number }[] };
  createdAt: string;
  updatedAt: string;
}
export interface VehiclesView {
  vehicles: Vehicle[];
  totals: { count: number; valueNzd: number; loansNzd: number; equityNzd: number; runningPerMonthNzd: number; costToOwnPerMonthNzd: number };
  loanAccounts: { id: string; name: string; balanceNzd: number }[];
}

/** Advanced crypto (KAN-47, Pro). */
export type CryptoTxnKind = 'buy' | 'sell' | 'swap' | 'transfer_in' | 'transfer_out' | 'staking_reward' | 'airdrop' | 'income' | 'spend' | 'gift_out' | 'fee' | 'defi_deposit' | 'defi_withdraw';
export interface CryptoTxnBody {
  date: string;
  kind: CryptoTxnKind;
  asset: string;
  amount: number;
  nzdValue: number | null;
  priceSource?: string;
  feeNzd: number;
  toAsset?: string | null;
  toAmount?: number | null;
  counterparty?: string | null;
  notes: string;
}
export interface CryptoTxn extends CryptoTxnBody {
  id: string;
  priceSource: string;
  walletId: string | null;
  imported: boolean;
  needsValue: boolean;
}
export type DefiKind = 'lending' | 'liquidity' | 'staking' | 'vault' | 'borrow' | 'other';
export interface DefiPosition {
  id: string;
  protocol: string;
  kind: DefiKind;
  network: string;
  assets: string;
  valueNzd: number;
  valuedOn: string | null;
  countInNetWorth: boolean;
  notes: string;
}
export interface DefiView {
  positions: DefiPosition[];
  netNzd: number;
}
export interface CryptoSummary {
  costMethod: 'fifo' | 'wac';
  taxYear: number;
  years: { startYear: number; label: string }[];
  year: { realisedNzd: number; proceedsNzd: number; costNzd: number; incomeNzd: number; disposals: number };
  positions: { asset: string; quantity: number; costNzd: number; avgCostNzd: number | null; costIncomplete: boolean; priceNzd: number | null; valueNzd: number | null; unrealisedNzd: number | null; priceStatus: string }[];
  unrealisedNzd: number;
  disposals: { txnId: string; date: string; asset: string; amount: number; proceedsNzd: number; costNzd: number; gainNzd: number; shortfall: number }[];
  income: { txnId: string; date: string; asset: string; kind: CryptoTxnKind; amount: number; nzdValue: number }[];
  missingValue: number;
  shortfalls: string[];
  txns: CryptoTxn[];
  defi: DefiView;
  wallets: { id: string; name: string; network: string }[];
}
export interface CryptoImportCandidate {
  ref: string;
  hash: string;
  date: string;
  direction: 'in' | 'out' | 'self';
  asset: string;
  amount: number;
  counterparty: string | null;
  network: string;
  suggestion: { kind: CryptoTxnKind; reason: string; confident: boolean; pairRef?: string };
  nzdValue: number | null;
  priceSource: string | null;
  priceNote: string | null;
}

/** Bonds and term deposits (KAN-80). Amounts are in the holding's currency unless named …Nzd. */
export type BondKind = 'govt' | 'corporate' | 'td';
export type CouponFrequency = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | 'maturity';
export interface BondWriteBody {
  name: string;
  kind: BondKind;
  faceValue: number;
  purchasePrice: number;
  purchaseDate: string;
  ratePct: number;
  frequency: CouponFrequency;
  maturityDate: string;
  currency: string;
  code: string;
  rwtPct: number | null;
  valueAmount: number | null;
  valueOn: string | null;
  linkedAccountId: string | null;
  notes: string;
}
export interface Bond extends BondWriteBody {
  id: string;
  status: 'active' | 'repaid' | 'rolled';
  closedOn: string | null;
  rolledFromId: string | null;
  value: number;
  valueSource: 'recorded' | 'cost';
  valueNzd: number | null;
  countedInCash: boolean;
  linkedAccountName: string | null;
  nextCoupon: { date: string; net: number } | null;
  yearlyIncome: number;
  alert: { level: 'matured' | '30' | '90'; days: number } | null;
}
export interface BondPayment {
  date: string;
  kind: 'coupon' | 'principal';
  gross: number;
  net: number;
  bondId: string;
  bondName: string;
  currency: string;
  skipped: boolean;
  recorded: number | null;
  inIncome: boolean;
}
export interface BondsView {
  plus: boolean;
  bonds: Bond[];
  totals: { valueNzd: number; bondsNzd: number; termDepositsNzd: number; unvalued: number; yearlyIncomeNzd: number };
  calendar: BondPayment[] | null;
  recent: BondPayment[] | null;
  alerts: { bondId: string; name: string; maturityDate: string; level: 'matured' | '30' | '90'; days: number }[] | null;
  termDepositAccounts: { id: string; name: string; balanceNzd: number }[];
}

/** Commodities (KAN-81). All amounts NZD. priceNzd is per unit or a total (priceBasis). */
export interface CommodityWriteBody {
  name: string;
  preset: string | null;
  category: CommodityCategory;
  quantity: number;
  unit: CommodityUnit;
  costNzd: number | null;
  priceNzd: number | null;
  priceBasis: PriceBasis;
  valueOn: string | null;
  notes: string;
}

export interface Commodity extends CommodityWriteBody {
  id: string;
  updatedAt: string;
  /** Produce of this business: its value counts in the business, not in Commodities (KAN-84). */
  businessId?: string | null;
  businessName?: string | null;
  valueNzd: number | null;
  unitPriceNzd: number | null;
  returnNzd: number | null;
  returnPct: number | null;
  ageDays: number | null;
  stale: boolean;
}

export interface CommoditiesView {
  plus: boolean;
  commodities: Commodity[];
  totals: { valueNzd: number; costNzd: number; returnNzd: number; unvalued: number; stale: number };
}
