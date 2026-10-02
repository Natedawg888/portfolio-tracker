/**
 * TODO: Parse Kiwibank internet-banking CSV exports into Transaction[].
 * Confirm headers against a real Nathan export (classic vs refreshed UI).
 * Docs: docs/KIWIBANK_PLAN.md, docs/IMPORT_FORMATS.md
 *
 * Expected aliases (provisional): Date, Amount, Memo/Description/Particulars,
 * optional Balance, Code, Reference, Analysis.
 * Dates: typically DD/MM/YYYY (en-NZ). Amounts: detect signed vs debit/credit columns.
 * Never invent rows; return errors for unmapped headers.
 */

import type { Transaction } from '../types';
import type { CsvColumnMap, ImportResult } from './types';

export function sniffKiwibankColumnMap(_headers: string[]): CsvColumnMap {
  // TODO: fuzzy-match known Kiwibank header aliases
  throw new Error('TODO: implement Kiwibank CSV header sniffing');
}

export function parseKiwibankCsv(_csvText: string, _accountId: string): ImportResult<Transaction> {
  // TODO: parse CSV, map to Transaction, build externalId for dedupe
  throw new Error('TODO: implement parseKiwibankCsv');
}
