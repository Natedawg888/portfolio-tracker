/**
 * TODO: Parse Kiwibank OFX / QFX downloads (STMTTRN) into Transaction[].
 * Prefer FITID as externalId when present.
 * Docs: docs/KIWIBANK_PLAN.md, docs/IMPORT_FORMATS.md
 */

import type { Transaction } from '../types';
import type { ImportResult } from './types';

export function parseKiwibankOfx(_ofxText: string, _accountId: string): ImportResult<Transaction> {
  // TODO: XML/SGML OFX parse → Transaction[]
  throw new Error('TODO: implement parseKiwibankOfx');
}
