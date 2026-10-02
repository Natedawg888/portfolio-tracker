/**
 * TODO: Parse Sharesies Holdings summary / Investment holdings CSV into
 * KiwiSaverSnapshot (or invest holdings snapshot).
 * Docs: docs/SHARESIES_KIWISAVER.md
 * Official path: Portfolio → Manage → Download reports (no public Sharesies API).
 * Confirm whether KiwiSaver scheme lines appear in Nathan’s export.
 */

import type { ImportResult, KiwiSaverSnapshot } from './types';

export function parseSharesiesHoldingsCsv(_csvText: string): ImportResult<KiwiSaverSnapshot> {
  // TODO: sniff headers; map ending dollar values → holdings[]; sum balanceNzd
  throw new Error('TODO: implement parseSharesiesHoldingsCsv');
}

export function parseManualKiwiSaverSnapshot(
  _input: Omit<KiwiSaverSnapshot, 'source'> & { source?: KiwiSaverSnapshot['source'] },
): KiwiSaverSnapshot {
  // TODO: validate non-negative balance; require asOf
  throw new Error('TODO: implement parseManualKiwiSaverSnapshot');
}
