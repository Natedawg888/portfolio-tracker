/**
 * Shared import types for bank / wallet / holdings CSV & OFX parsers.
 * See docs/IMPORT_FORMATS.md
 */

import type { CurrencyCode, Transaction } from '../types';

export interface ImportParseError {
  row?: number;
  message: string;
}

export interface ImportResult<T = Transaction> {
  items: T[];
  errors: ImportParseError[];
  sourceLabel: string;
  /** Raw headers sniffed from CSV, if any */
  headers?: string[];
}

export interface CsvColumnMap {
  date?: string;
  description?: string;
  amount?: string;
  debit?: string;
  credit?: string;
  balance?: string;
  currency?: string;
  externalId?: string;
}

export interface KiwiSaverHoldingSnapshot {
  name: string;
  symbol?: string;
  units?: number;
  valueNzd: number;
  currency?: CurrencyCode;
  weightPct?: number;
}

export interface KiwiSaverSnapshot {
  balanceNzd: number;
  holdings: KiwiSaverHoldingSnapshot[];
  asOf: string;
  source: 'sharesies_csv' | 'sharesies_manual' | 'akahu' | 'bank_manual' | 'bank_csv' | 'other';
  provider?: string;
  schemeName?: string | null;
  amountInvestedNzd?: number | null;
  returnsNzd?: number | null;
  notes?: string | null;
}

/** GoMining digital miner — valuation must cite source; never invent prices. */
export interface GoMiningMinerSnapshot {
  minerId: string;
  name: string;
  hashrateTh: number;
  efficiencyWPerTh?: number;
  rarity?: string;
  upgradeLevel?: string | number;
  /** Marketplace / manual estimate in GOMINING tokens */
  estValueGmt?: number | null;
  /** Converted NZD if token price feed available */
  estValueNzd?: number | null;
  valuationSource?: string;
  asOf: string;
}
