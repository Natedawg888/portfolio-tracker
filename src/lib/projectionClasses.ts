/**
 * Asset classes the projection grows separately, each with its own yearly return and
 * monthly addition. Shared by the API (server/projections) and the Projections page.
 * Returns are never invented: a class with no rate set uses the default return (0% unless
 * the user sets one).
 */

export const PROJECTION_CLASS_KEYS = [
  'cash',
  'shares',
  'kiwiSaver',
  'crypto',
  'mining',
  'metals',
  'property',
  'other',
] as const;

export type ProjectionClassKey = (typeof PROJECTION_CLASS_KEYS)[number];

export const PROJECTION_CLASS_LABELS: Record<ProjectionClassKey, string> = {
  cash: 'Cash',
  shares: 'Shares & funds',
  kiwiSaver: 'KiwiSaver',
  crypto: 'Crypto',
  mining: 'Mining (GoMining)',
  metals: 'Metals',
  property: 'Property',
  other: 'Other (art, stones, collectables, forex)',
};

/** Query parameter names, e.g. returnShares=7&addShares=500. */
export function returnParam(key: ProjectionClassKey): string {
  return `return${key[0].toUpperCase()}${key.slice(1)}`;
}

export function addParam(key: ProjectionClassKey): string {
  return `add${key[0].toUpperCase()}${key.slice(1)}`;
}

/** Per-class values the user may set. null / missing = not set. */
export type ProjectionClassValues = Partial<Record<ProjectionClassKey, number | null>>;

export type SavedProjectionAssumptions = {
  returns: ProjectionClassValues;
  contributions: ProjectionClassValues;
};

export const RETURN_LIMITS = [-50, 50] as const;
export const ADD_LIMIT = 10_000_000;

/** Keep only known classes with finite, in-range numbers. */
export function normalizeClassValues(raw: unknown, min: number, max: number): ProjectionClassValues {
  const out: ProjectionClassValues = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  for (const key of PROJECTION_CLASS_KEYS) {
    const v = o[key];
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    if (Number.isFinite(n) && n >= min && n <= max) out[key] = Math.round(n * 10000) / 10000;
  }
  return out;
}

export function normalizeSavedAssumptions(raw: unknown): SavedProjectionAssumptions {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    returns: normalizeClassValues(o.returns, RETURN_LIMITS[0], RETURN_LIMITS[1]),
    contributions: normalizeClassValues(o.contributions, -ADD_LIMIT, ADD_LIMIT),
  };
}
