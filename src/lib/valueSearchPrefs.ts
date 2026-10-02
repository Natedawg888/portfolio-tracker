/**
 * Value Search tool visibility prefs (separate from asset-class holdings toggles).
 * Stored in users.preferences_json.valueSearch.
 */

export type ValueSearchPrefs = {
  /**
   * Show the Currency exchange tool on Value Search.
   * Independent of the Forex asset-class toggle (holdings).
   */
  showCurrencyExchanger: boolean;
};

export function defaultValueSearchPrefs(): ValueSearchPrefs {
  return { showCurrencyExchanger: true };
}

export function normalizeValueSearchPrefs(raw: unknown): ValueSearchPrefs {
  const base = defaultValueSearchPrefs();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;
  if (typeof o.showCurrencyExchanger === 'boolean') {
    base.showCurrencyExchanger = o.showCurrencyExchanger;
  }
  return base;
}
