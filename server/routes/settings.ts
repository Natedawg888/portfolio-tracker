/**
 * App settings — includes GoMining discount + optional network params for earnings model.
 * Never invents BTC/USD, pool sat/TH, or network hashrate; empty values stay null stubs.
 *
 * Live feeds on GET/PATCH /gomining:
 *   - fx: CoinGecko BTC/USD+NZD (btc.ts)
 *   - income: GoMining nft-income-aggregation pool payouts per TH (gominingIncome.ts)
 *   - networkHashrate: mempool.space / blockchain.info EH/s — Academy fallback only
 */
import { Router } from 'express';
import { getDb, queryAll, queryOne, run } from '../db/index.ts';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import {
  ASSET_CLASS_PREF_OPTIONS,
  defaultAssetClassPrefs,
  normalizeAssetClassPrefs,
  type AssetClassPrefs,
} from '../../src/lib/assetClassPrefs.ts';
import {
  mergeOnboardingIntoPreferencesJson,
  parseOnboardingFromPreferencesJson,
  preferencesWithAkahuSkippedUnlessRequired,
} from '../../src/lib/onboardingPrefs.ts';
import {
  defaultValueSearchPrefs,
  normalizeValueSearchPrefs,
  type ValueSearchPrefs,
} from '../../src/lib/valueSearchPrefs.ts';
import {
  GOMINING_DEFAULT_KWH_USD,
  BTC_DAILY_ISSUANCE_DEFAULT,
  clampDiscountPct,
} from '../../src/lib/gominingEarnings.ts';
import {
  employeeRateView,
  readKiwiSaverEmployeeRate,
  saveKiwiSaverEmployeeRate,
} from '../kiwisaver/employeeRate.ts';
import { fetchBtcFx } from '../quotes/btc.ts';
import { fetchGoMiningIncome } from '../quotes/gominingIncome.ts';
import { fetchNetworkHashrate } from '../quotes/hashrate.ts';

const router = Router();

const GOMINING_KEYS = [
  'gominingDiscountPct',
  'gominingBtcUsd',
  'gominingNetworkHashrateEhs',
  'gominingDailyBtcIssuance',
  'gominingKwhCostUsd',
] as const;

export type GoMiningSettings = {
  discountPct: number;
  btcUsd: number | null;
  networkHashrateEhs: number | null;
  dailyBtcIssuance: number | null;
  kWhCostUsd: number | null;
  /** Live BTC FX from CoinGecko — null prices if unavailable (never invent) */
  fx?: {
    btcUsd: number | null;
    btcNzd: number | null;
    status: 'ok' | 'unavailable';
    source: string;
    asOf: string | null;
    message: string | null;
  };
  /**
   * Live GoMining pool income (preferred Pool Reward input).
   * Docs: daily pool payouts per TH — https://docs.gomining.com/en/product/miners/rewards
   */
  income?: {
    poolIncomeUsdPerTh: number | null;
    poolIncomeBtcPerTh: number | null;
    poolIncomeSatPerTh: number | null;
    btcCourseInUsd: number | null;
    electricityUsdPerThPerWt: number | null;
    serviceUsdPerTh: number | null;
    impliedKwhCostUsd: number | null;
    goBtcPaySatPerTh: number;
    goBtcPayBtcPerTh: number;
    goBtcPayStatus: 'ok' | 'unavailable';
    goBtcPayMessage: string | null;
    status: 'ok' | 'unavailable';
    source: string;
    asOf: string | null;
    message: string | null;
    recordId: number | null;
  };
  /**
   * Live Bitcoin network EH/s — Academy fallback when GoMining income unavailable.
   * Manual gominingNetworkHashrateEhs still overrides when set.
   */
  networkHashrate?: {
    networkHashrateEhs: number | null;
    status: 'ok' | 'unavailable';
    source: string;
    asOf: string | null;
    message: string | null;
  };
  /**
   * Effective inputs the UI should use for estimates (manual override > live).
   */
  effective?: {
    networkHashrateEhs: number | null;
    networkHashrateSource: 'manual' | 'mempool.space' | 'blockchain.info' | 'none';
    poolIncomeUsdPerTh: number | null;
    poolIncomeBtcPerTh: number | null;
    poolIncomeSource: 'gomining_api' | 'none';
  };
  /** Documented defaults used when fields are null */
  defaults: {
    kWhCostUsd: number;
    dailyBtcIssuance: number;
    discountAppliesTo: 'electricity_and_service';
    note: string;
  };
};

function parseNullableNumber(raw: string | undefined | null): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function readGoMiningSettings(
  settingsMap: Record<string, string>,
): GoMiningSettings {
  return {
    discountPct: clampDiscountPct(parseNullableNumber(settingsMap.gominingDiscountPct) ?? 0),
    btcUsd: parseNullableNumber(settingsMap.gominingBtcUsd),
    networkHashrateEhs: parseNullableNumber(settingsMap.gominingNetworkHashrateEhs),
    dailyBtcIssuance: parseNullableNumber(settingsMap.gominingDailyBtcIssuance),
    kWhCostUsd: parseNullableNumber(settingsMap.gominingKwhCostUsd),
    defaults: {
      kWhCostUsd: GOMINING_DEFAULT_KWH_USD,
      dailyBtcIssuance: BTC_DAILY_ISSUANCE_DEFAULT,
      discountAppliesTo: 'electricity_and_service',
      note:
        'Net sat/TH/day = PR + GBP − C1 − C2. Discount % applies to both Electricity (C1) and Service (C2) — not secondary-market NZD value. ' +
        'Default kWh $0.05 (app). Pool Reward from GoMining nft-income-aggregation only (never invent). ' +
        'GoBTC Pay (GBP) when API exposes it, else 0. Academy network-share is fallback only.',
    },
  };
}

async function withLiveFeeds(
  base: GoMiningSettings,
  force: boolean,
): Promise<GoMiningSettings> {
  const [fx, income, networkHashrate] = await Promise.all([
    fetchBtcFx(force),
    fetchGoMiningIncome(force),
    fetchNetworkHashrate(force),
  ]);

  const manualEhs = base.networkHashrateEhs;
  const liveEhs =
    networkHashrate.status === 'ok' ? networkHashrate.networkHashrateEhs : null;
  const effectiveEhs = manualEhs ?? liveEhs;
  const networkHashrateSource: NonNullable<GoMiningSettings['effective']>['networkHashrateSource'] =
    manualEhs != null
      ? 'manual'
      : liveEhs != null && networkHashrate.source !== 'stub'
        ? (networkHashrate.source as 'mempool.space' | 'blockchain.info')
        : 'none';

  const poolUsd =
    income.status === 'ok' ? income.poolIncomeUsdPerTh : null;
  const poolBtc =
    income.status === 'ok' ? income.poolIncomeBtcPerTh : null;

  return {
    ...base,
    fx: {
      btcUsd: fx.btcUsd,
      btcNzd: fx.btcNzd,
      status: fx.status,
      source: fx.source,
      asOf: fx.asOf,
      message: fx.message,
    },
    income: {
      poolIncomeUsdPerTh: income.poolIncomeUsdPerTh,
      poolIncomeBtcPerTh: income.poolIncomeBtcPerTh,
      poolIncomeSatPerTh: income.poolIncomeSatPerTh,
      btcCourseInUsd: income.btcCourseInUsd,
      electricityUsdPerThPerWt: income.electricityUsdPerThPerWt,
      serviceUsdPerTh: income.serviceUsdPerTh,
      impliedKwhCostUsd: income.impliedKwhCostUsd,
      goBtcPaySatPerTh: income.goBtcPaySatPerTh,
      goBtcPayBtcPerTh: income.goBtcPayBtcPerTh,
      goBtcPayStatus: income.goBtcPayStatus,
      goBtcPayMessage: income.goBtcPayMessage,
      status: income.status,
      source: income.source,
      asOf: income.asOf,
      message: income.message,
      recordId: income.recordId,
    },
    networkHashrate: {
      networkHashrateEhs: networkHashrate.networkHashrateEhs,
      status: networkHashrate.status,
      source: networkHashrate.source,
      asOf: networkHashrate.asOf,
      message: networkHashrate.message,
    },
    effective: {
      networkHashrateEhs: effectiveEhs,
      networkHashrateSource,
      poolIncomeUsdPerTh: poolUsd,
      poolIncomeBtcPerTh: poolBtc,
      poolIncomeSource: poolUsd != null ? 'gomining_api' : 'none',
    },
  };
}

router.get('/', async (_req, res) => {
  const db = await getDb();
  const rows = queryAll<{ key: string; value: string }>(db, 'SELECT key, value FROM app_settings');
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json({
    defaultCurrency: map.defaultCurrency ?? 'NZD',
    timezone: map.timezone ?? 'Pacific/Auckland',
    locale: map.locale ?? 'en-NZ',
    gomining: readGoMiningSettings(map),
  });
});

router.get('/gomining', async (req, res) => {
  const db = await getDb();
  const rows = queryAll<{ key: string; value: string }>(
    db,
    `SELECT key, value FROM app_settings WHERE key IN (${GOMINING_KEYS.map(() => '?').join(',')})`,
    [...GOMINING_KEYS],
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const force = req.query.refresh === '1' || req.query.refresh === 'true';
  const base = readGoMiningSettings(map);
  res.json(await withLiveFeeds(base, force));
});

router.patch('/gomining', async (req, res) => {
  const db = await getDb();
  const b = req.body ?? {};

  function upsert(key: string, value: string) {
    run(db, `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [
      key,
      value,
    ]);
  }

  if (b.discountPct !== undefined) {
    upsert('gominingDiscountPct', String(clampDiscountPct(Number(b.discountPct))));
  }
  if (b.btcUsd !== undefined) {
    const v = b.btcUsd === null || b.btcUsd === '' ? '' : String(Number(b.btcUsd));
    if (v !== '' && !Number.isFinite(Number(v))) {
      return res.status(400).json({ error: 'btcUsd must be a number or null' });
    }
    upsert('gominingBtcUsd', v);
  }
  if (b.networkHashrateEhs !== undefined) {
    const v =
      b.networkHashrateEhs === null || b.networkHashrateEhs === ''
        ? ''
        : String(Number(b.networkHashrateEhs));
    if (v !== '' && !Number.isFinite(Number(v))) {
      return res.status(400).json({ error: 'networkHashrateEhs must be a number or null' });
    }
    upsert('gominingNetworkHashrateEhs', v);
  }
  if (b.dailyBtcIssuance !== undefined) {
    const v =
      b.dailyBtcIssuance === null || b.dailyBtcIssuance === ''
        ? ''
        : String(Number(b.dailyBtcIssuance));
    if (v !== '' && !Number.isFinite(Number(v))) {
      return res.status(400).json({ error: 'dailyBtcIssuance must be a number or null' });
    }
    upsert('gominingDailyBtcIssuance', v);
  }
  if (b.kWhCostUsd !== undefined) {
    const v = b.kWhCostUsd === null || b.kWhCostUsd === '' ? '' : String(Number(b.kWhCostUsd));
    if (v !== '' && !Number.isFinite(Number(v))) {
      return res.status(400).json({ error: 'kWhCostUsd must be a number or null' });
    }
    upsert('gominingKwhCostUsd', v);
  }

  const rows = queryAll<{ key: string; value: string }>(
    db,
    `SELECT key, value FROM app_settings WHERE key IN (${GOMINING_KEYS.map(() => '?').join(',')})`,
    [...GOMINING_KEYS],
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const base = readGoMiningSettings(map);
  res.json(await withLiveFeeds(base, false));
});


const COLLECTABLE_TYPES_KEY = 'collectableTypes';

export type CollectableTypeKind = 'mtg' | 'pokemon' | 'manual';

export type CollectableTypeDef = {
  id: string;
  title: string;
  kind: CollectableTypeKind;
  blurb?: string;
};

const PRESET_TYPES: Record<string, CollectableTypeDef> = {
  mtg: {
    id: 'mtg',
    title: 'MTG',
    kind: 'mtg',
    blurb: 'Magic: The Gathering · Scryfall → NZD',
  },
  pokemon: {
    id: 'pokemon',
    title: 'Pokémon',
    kind: 'pokemon',
    blurb: 'Pokémon TCG · pokemontcg.io → NZD',
  },
  other: {
    id: 'other',
    title: 'Figurines / other',
    kind: 'manual',
    blurb: 'Manual appraisal NZD · optional photo',
  },
};

function slugifyTypeId(raw: string): string | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
  if (!s || s.length > 40) return null;
  return s;
}

function normalizeTypeDef(raw: unknown): CollectableTypeDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  let id = slugifyTypeId(String(o.id ?? o.key ?? o.slug ?? ''));
  if (!id) return null;
  let kind: CollectableTypeKind =
    o.kind === 'mtg' || o.kind === 'pokemon' || o.kind === 'manual'
      ? o.kind
      : id === 'mtg'
        ? 'mtg'
        : id === 'pokemon'
          ? 'pokemon'
          : 'manual';
  // Force preset ids to matching kind
  if (id === 'mtg') kind = 'mtg';
  if (id === 'pokemon') kind = 'pokemon';
  if (kind === 'mtg') id = 'mtg';
  if (kind === 'pokemon') id = 'pokemon';
  const preset = PRESET_TYPES[id];
  const title = String(o.title ?? o.name ?? preset?.title ?? id).trim() || id;
  const blurb =
    o.blurb != null
      ? String(o.blurb)
      : preset?.blurb ??
        (kind === 'manual' ? 'Manual appraisal NZD · optional photo' : undefined);
  return { id, title, kind, blurb };
}

function readCollectableTypes(map: Record<string, string>): CollectableTypeDef[] {
  const raw = map[COLLECTABLE_TYPES_KEY];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: CollectableTypeDef[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      const def = normalizeTypeDef(item);
      if (!def || seen.has(def.id)) continue;
      seen.add(def.id);
      out.push(def);
    }
    return out;
  } catch {
    return [];
  }
}

router.get('/collectable-types', async (_req, res) => {
  const db = await getDb();
  const rows = queryAll<{ key: string; value: string }>(db, 'SELECT key, value FROM app_settings');
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json({
    types: readCollectableTypes(map),
    presets: Object.values(PRESET_TYPES),
  });
});

router.put('/collectable-types', async (req, res) => {
  const body = req.body ?? {};
  const list = Array.isArray(body.types) ? body.types : null;
  if (!list) {
    return res.status(400).json({ error: 'types array required' });
  }
  const out: CollectableTypeDef[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const def = normalizeTypeDef(item);
    if (!def || seen.has(def.id)) continue;
    seen.add(def.id);
    out.push(def);
  }
  const db = await getDb();
  run(db, `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [
    COLLECTABLE_TYPES_KEY,
    JSON.stringify(out),
  ]);
  res.json({ types: out, presets: Object.values(PRESET_TYPES) });
});


async function loadUserAssetClassPrefs(userId: string): Promise<AssetClassPrefs> {
  const db = await getDb();
  const row = queryOne<{ preferences_json: string | null }>(
    db,
    `SELECT preferences_json FROM users WHERE id = ?`,
    [userId],
  );
  if (!row?.preferences_json) return defaultAssetClassPrefs();
  try {
    const parsed = JSON.parse(row.preferences_json) as { assetClasses?: unknown };
    return normalizeAssetClassPrefs(parsed?.assetClasses ?? parsed);
  } catch {
    return defaultAssetClassPrefs();
  }
}

async function loadUserValueSearchPrefs(userId: string): Promise<ValueSearchPrefs> {
  const db = await getDb();
  const row = queryOne<{ preferences_json: string | null }>(
    db,
    `SELECT preferences_json FROM users WHERE id = ?`,
    [userId],
  );
  if (!row?.preferences_json) return defaultValueSearchPrefs();
  try {
    const parsed = JSON.parse(row.preferences_json) as { valueSearch?: unknown };
    return normalizeValueSearchPrefs(parsed?.valueSearch);
  } catch {
    return defaultValueSearchPrefs();
  }
}

async function saveUserAssetClassPrefs(
  userId: string,
  prefs: AssetClassPrefs,
  valueSearch?: ValueSearchPrefs,
): Promise<{ prefs: AssetClassPrefs; valueSearch: ValueSearchPrefs }> {
  const db = await getDb();
  const row = queryOne<{ preferences_json: string | null; email: string }>(
    db,
    `SELECT preferences_json, email FROM users WHERE id = ?`,
    [userId],
  );
  let existing: Record<string, unknown> = {};
  if (row?.preferences_json) {
    try {
      const parsed = JSON.parse(row.preferences_json);
      if (parsed && typeof parsed === 'object') existing = parsed as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  const nextValueSearch = normalizeValueSearchPrefs(
    valueSearch ?? existing.valueSearch ?? defaultValueSearchPrefs(),
  );
  // Persist asset toggles + Value Search tool prefs; mark signup asset step done.
  // Non-Nathan accounts keep Akahu marked skipped (same as "Skip / do later").
  const withAssets = { ...existing, assetClasses: prefs, valueSearch: nextValueSearch };
  const merged = mergeOnboardingIntoPreferencesJson(JSON.stringify(withAssets), {
    assetClassesDone: true,
  });
  const applied = preferencesWithAkahuSkippedUnlessRequired(merged, row?.email);
  const nextJson = applied.json ?? merged;
  const now = new Date().toISOString();
  run(
    db,
    `UPDATE users SET preferences_json = ?, updated_at = ? WHERE id = ?`,
    [nextJson, now, userId],
  );
  return { prefs, valueSearch: nextValueSearch };
}

router.get('/kiwisaver-employee-rate', async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const db = await getDb();
  const rate = readKiwiSaverEmployeeRate(db, req.user.id);
  res.json(employeeRateView(rate.employeeRatePct, rate.saved));
});

router.put('/kiwisaver-employee-rate', async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const db = await getDb();
  const body = req.body ?? {};
  const saved = saveKiwiSaverEmployeeRate(db, req.user.id, body.employeeRatePct ?? body.rate);
  if (!saved.ok) {
    res.status(saved.status).json({ error: saved.error });
    return;
  }
  res.json(employeeRateView(saved.employeeRatePct, true));
});

router.get('/asset-classes', async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const enabled = await loadUserAssetClassPrefs(req.user.id);
  const valueSearch = await loadUserValueSearchPrefs(req.user.id);
  res.json({
    enabled,
    options: ASSET_CLASS_PREF_OPTIONS,
    valueSearch,
  });
});

router.put('/asset-classes', async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const body = req.body ?? {};
  const raw = body.enabled ?? body.assetClasses ?? body;
  const enabled = normalizeAssetClassPrefs(raw);
  const valueSearchPatch =
    body.valueSearch !== undefined ? normalizeValueSearchPrefs(body.valueSearch) : undefined;
  const saved = await saveUserAssetClassPrefs(req.user.id, enabled, valueSearchPatch);
  res.json({
    enabled: saved.prefs,
    options: ASSET_CLASS_PREF_OPTIONS,
    valueSearch: saved.valueSearch,
  });
});


router.get('/onboarding', async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const db = await getDb();
  const row = queryOne<{ preferences_json: string | null; email: string }>(
    db,
    `SELECT preferences_json, email FROM users WHERE id = ?`,
    [req.user.id],
  );
  const applied = preferencesWithAkahuSkippedUnlessRequired(row?.preferences_json, row?.email);
  let preferencesJson = row?.preferences_json ?? null;
  if (applied.changed && applied.json != null) {
    preferencesJson = applied.json;
    const now = new Date().toISOString();
    run(
      db,
      `UPDATE users SET preferences_json = ?, updated_at = ? WHERE id = ?`,
      [applied.json, now, req.user.id],
    );
  }
  const parsed = parseOnboardingFromPreferencesJson(preferencesJson);
  res.json({
    onboardingComplete: parsed.complete,
    onboarding: parsed.flags ?? {
      assetClassesDone: true,
      budgetCategoriesDone: true,
      akahuStepDone: true,
    },
  });
});

/** Mark required budget-categories signup step complete (after user confirms list). */
router.put('/onboarding', async (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  const body = req.body ?? {};
  const patch: {
    assetClassesDone?: boolean;
    budgetCategoriesDone?: boolean;
    akahuStepDone?: boolean;
  } = {};
  if (body.budgetCategoriesDone === true) patch.budgetCategoriesDone = true;
  if (body.assetClassesDone === true) patch.assetClassesDone = true;
  if (body.akahuStepDone === true) patch.akahuStepDone = true;
  if (Object.keys(patch).length === 0) {
    res.status(400).json({
      error: 'Provide budgetCategoriesDone, assetClassesDone, and/or akahuStepDone as true',
      code: 'INVALID_BODY',
    });
    return;
  }
  const db = await getDb();
  const row = queryOne<{ preferences_json: string | null; email: string }>(
    db,
    `SELECT preferences_json, email FROM users WHERE id = ?`,
    [req.user.id],
  );
  const merged = mergeOnboardingIntoPreferencesJson(row?.preferences_json, patch);
  const applied = preferencesWithAkahuSkippedUnlessRequired(merged, row?.email);
  const nextJson = applied.json ?? merged;
  const now = new Date().toISOString();
  run(
    db,
    `UPDATE users SET preferences_json = ?, updated_at = ? WHERE id = ?`,
    [nextJson, now, req.user.id],
  );
  const parsed = parseOnboardingFromPreferencesJson(nextJson);
  res.json({
    onboardingComplete: parsed.complete,
    onboarding: parsed.flags ?? {
      assetClassesDone: true,
      budgetCategoriesDone: true,
      akahuStepDone: true,
    },
  });
});

export default router;

