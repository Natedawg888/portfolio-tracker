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
  'bonds',
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
  bonds: 'Bonds & term deposits',
  other: 'Other (art, stones, collectables, forex)',
};

/** Query parameter names, e.g. returnShares=7&addShares=500. */
export function returnParam(key: ProjectionClassKey): string {
  return `return${key[0].toUpperCase()}${key.slice(1)}`;
}

export function addParam(key: ProjectionClassKey): string {
  return `add${key[0].toUpperCase()}${key.slice(1)}`;
}

/** Per-class yearly step-up of the monthly addition, e.g. growShares=50. */
export function growParam(key: ProjectionClassKey): string {
  return `grow${key[0].toUpperCase()}${key.slice(1)}`;
}

/** Per-class values the user may set. null / missing = not set. */
export type ProjectionClassValues = Partial<Record<ProjectionClassKey, number | null>>;

export type SavedProjectionAssumptions = {
  returns: ProjectionClassValues;
  contributions: ProjectionClassValues;
  mining?: MiningPlan;
  /** Yearly step-up of monthly additions, % (default for classes without their own). */
  additionGrowthPct?: number;
  /** Per-class yearly step-up, %. */
  growth?: ProjectionClassValues;
};

export const ADD_GROWTH_PARAM = 'addGrowth';
export const ADD_GROWTH_LIMITS = [0, 500] as const;

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
    mining: normalizeMiningPlan(o.mining),
    growth: normalizeClassValues(o.growth, 0, 500),
    ...(() => {
      const g = Number(o.additionGrowthPct);
      return o.additionGrowthPct != null && o.additionGrowthPct !== '' && Number.isFinite(g) && g >= ADD_GROWTH_LIMITS[0] && g <= ADD_GROWTH_LIMITS[1]
        ? { additionGrowthPct: Math.round(g * 100) / 100 }
        : {};
    })(),
  };
}

/**
 * GoMining mining plan for the projection: add TH, improve efficiency, and where rewards go.
 * Every field is optional; a missing field means "no change" (rewards kept as BTC).
 */
export type MiningPlan = {
  addThPerMonth?: number;
  addThOnce?: number;
  /** W/TH of TH added (blank = current fleet average). */
  newThWth?: number;
  /** NZD per TH, for buying TH and reinvesting rewards. */
  thPriceNzd?: number;
  /** W/TH taken off every month by upgrades, down to 12 W/TH. */
  wthDropPerMonth?: number;
  /** NZD spent on upgrades each month while still improving. */
  upgradeCostPerMonthNzd?: number;
  rewardsTo?: 'crypto' | 'cash' | 'reinvest';
  /** Yearly change in pool reward per TH, % (network growth). */
  rewardChangePct?: number;
};

type NumField = Exclude<keyof MiningPlan, 'rewardsTo'>;

/** Link parameter and allowed range for each numeric mining field. */
export const MINING_PLAN_FIELDS: Record<NumField, { param: string; min: number; max: number; label: string }> = {
  addThPerMonth: { param: 'miningAddTh', min: 0, max: 1_000_000, label: 'TH added each month' },
  addThOnce: { param: 'miningAddThOnce', min: 0, max: 10_000_000, label: 'TH added once' },
  newThWth: { param: 'miningNewWth', min: 12, max: 200, label: 'W/TH of added TH' },
  thPriceNzd: { param: 'miningThPrice', min: 0, max: 1_000_000, label: 'Price per TH' },
  wthDropPerMonth: { param: 'miningWthDrop', min: 0, max: 50, label: 'W/TH lower each month' },
  upgradeCostPerMonthNzd: { param: 'miningUpgradeCost', min: 0, max: 10_000_000, label: 'Upgrade cost each month' },
  rewardChangePct: { param: 'miningRewardChange', min: -90, max: 100, label: 'Yearly change in reward per TH' },
};

export const MINING_REWARDS_TO_PARAM = 'miningRewardsTo';

export function normalizeMiningPlan(raw: unknown): MiningPlan {
  const out: MiningPlan = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  for (const [key, f] of Object.entries(MINING_PLAN_FIELDS) as [NumField, (typeof MINING_PLAN_FIELDS)[NumField]][]) {
    const v = o[key];
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    if (Number.isFinite(n) && n >= f.min && n <= f.max) out[key] = Math.round(n * 10000) / 10000;
  }
  if (o.rewardsTo === 'crypto' || o.rewardsTo === 'cash' || o.rewardsTo === 'reinvest') out.rewardsTo = o.rewardsTo;
  return out;
}
