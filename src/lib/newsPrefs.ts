/**
 * Per-user news page settings, stored in users.preferences_json.news
 * (same blob as asset classes, onboarding, and value search).
 * Read and saved lists are headline URLs from the feeds — never titles.
 */
export type NewsUserState = {
  readUrls: string[];
  savedUrls: string[];
  /** Collapse same-day price-move headlines that share a chip. */
  groupDailyPriceUpdates: boolean;
  /** Closed (zero-quantity) positions stay out of the feed and the sidebar. */
  includeClosedPositions: boolean;
};

const URL_CAP = 400;
const URL_MAX = 2000;

export function defaultNewsUserState(): NewsUserState {
  return {
    readUrls: [],
    savedUrls: [],
    groupDailyPriceUpdates: true,
    includeClosedPositions: false,
  };
}

function cleanUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const url = item.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) continue;
    if (url.length > URL_MAX) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out.slice(-URL_CAP);
}

export function normalizeNewsUserState(raw: unknown): NewsUserState {
  const base = defaultNewsUserState();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  base.readUrls = cleanUrls(o.readUrls);
  base.savedUrls = cleanUrls(o.savedUrls);
  if (typeof o.groupDailyPriceUpdates === 'boolean') base.groupDailyPriceUpdates = o.groupDailyPriceUpdates;
  if (typeof o.includeClosedPositions === 'boolean') base.includeClosedPositions = o.includeClosedPositions;
  return base;
}

/** Replace only the fields present on the patch. Unknown shapes are ignored. */
export function applyNewsUserPatch(current: NewsUserState, patch: unknown): NewsUserState {
  const next: NewsUserState = {
    ...current,
    readUrls: [...current.readUrls],
    savedUrls: [...current.savedUrls],
  };
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return next;
  const o = patch as Record<string, unknown>;
  if ('readUrls' in o) next.readUrls = cleanUrls(o.readUrls);
  if ('savedUrls' in o) next.savedUrls = cleanUrls(o.savedUrls);
  if (typeof o.groupDailyPriceUpdates === 'boolean') next.groupDailyPriceUpdates = o.groupDailyPriceUpdates;
  if (typeof o.includeClosedPositions === 'boolean') next.includeClosedPositions = o.includeClosedPositions;
  return next;
}

export function newsFromPreferences(preferencesJson: string | null | undefined): NewsUserState {
  if (preferencesJson == null || String(preferencesJson).trim() === '') return defaultNewsUserState();
  try {
    const parsed = JSON.parse(String(preferencesJson)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultNewsUserState();
    return normalizeNewsUserState((parsed as Record<string, unknown>).news);
  } catch {
    return defaultNewsUserState();
  }
}

/** Keep every other preference key. Only `news` is replaced. */
export function mergeNewsIntoPreferences(
  preferencesJson: string | null | undefined,
  state: NewsUserState,
): string {
  let prefs: Record<string, unknown> = {};
  if (preferencesJson != null && String(preferencesJson).trim() !== '') {
    try {
      const parsed = JSON.parse(String(preferencesJson)) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        prefs = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      prefs = {};
    }
  }
  prefs.news = normalizeNewsUserState(state);
  return JSON.stringify(prefs);
}

export function withReadUrl(state: NewsUserState, url: string): NewsUserState {
  if (state.readUrls.includes(url)) return state;
  return applyNewsUserPatch(state, { readUrls: [...state.readUrls, url] });
}

export function withSavedUrl(state: NewsUserState, url: string, saved: boolean): NewsUserState {
  const has = state.savedUrls.includes(url);
  if (saved === has) return state;
  const savedUrls = saved ? [...state.savedUrls, url] : state.savedUrls.filter((item) => item !== url);
  return applyNewsUserPatch(state, { savedUrls });
}

export function withAllRead(state: NewsUserState, urls: string[]): NewsUserState {
  return applyNewsUserPatch(state, { readUrls: [...state.readUrls, ...urls] });
}
