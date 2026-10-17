/**
 * Crypto mining cards (KAN-85): each miner is Manual hardware (the user's own rig) or Cloud mining
 * (a hosted plan) with a provider. The stored asset class stays `gomining_miner` and the Settings
 * key stays `gomining`, so existing data needs no migration; only the labels changed.
 *
 * Providers: a registry key (below) or, for a service not listed, the name the user typed. A new
 * provider is one more entry here. Features tied to one provider (GoMining's marketplace value,
 * pool reward and discount model, and the Projections mining plan) check `isGoMiningMiner`.
 */

export const MINING_TYPES = ['hardware', 'cloud'] as const;
export type MiningType = (typeof MINING_TYPES)[number];

export const MINING_TYPE_LABEL: Record<MiningType, string> = {
  hardware: 'Manual hardware',
  cloud: 'Cloud mining',
};

export type MiningProvider = { key: string; label: string };

export const MINING_PROVIDERS: MiningProvider[] = [{ key: 'gomining', label: 'GoMining' }];

export const GOMINING = 'gomining';

/** Class name shown wherever the asset class appears (Settings, Dashboard, Portfolio, History…). */
export const CRYPTO_MINING_LABEL = 'Crypto mining';

type MinerLike = { miningType?: string | null; miningProvider?: string | null };

/** Rows saved before KAN-85 have no type: they were all GoMining cloud miners. */
export function minerType(h: MinerLike): MiningType {
  return h.miningType === 'hardware' ? 'hardware' : 'cloud';
}

export function minerProvider(h: MinerLike): string | null {
  if (minerType(h) === 'hardware') return null;
  const p = typeof h.miningProvider === 'string' ? h.miningProvider.trim() : '';
  return p || GOMINING;
}

export function isGoMiningMiner(h: MinerLike): boolean {
  return minerProvider(h) === GOMINING;
}

/** "GoMining", or the name typed for an unlisted provider. */
export function providerLabel(provider: string | null): string | null {
  if (!provider) return null;
  return MINING_PROVIDERS.find((p) => p.key === provider)?.label ?? provider;
}

/**
 * Validate type and provider from a request body. A listed provider is matched by key or label
 * (case-insensitive); anything else is kept as typed (max 60 chars). Hardware has no provider.
 */
export function parseMiningTag(
  rawType: unknown,
  rawProvider: unknown,
): { ok: true; miningType: MiningType; miningProvider: string | null } | { ok: false; error: string } {
  if (rawType != null && rawType !== '' && !(MINING_TYPES as readonly unknown[]).includes(rawType)) {
    return { ok: false, error: 'Mining type must be Manual hardware or Cloud mining' };
  }
  const miningType: MiningType = rawType === 'hardware' ? 'hardware' : 'cloud';
  if (miningType === 'hardware') return { ok: true, miningType, miningProvider: null };
  const text = typeof rawProvider === 'string' ? rawProvider.trim().slice(0, 60) : '';
  if (!text) return { ok: true, miningType, miningProvider: GOMINING };
  const listed = MINING_PROVIDERS.find((p) => p.key === text.toLowerCase() || p.label.toLowerCase() === text.toLowerCase());
  return { ok: true, miningType, miningProvider: listed?.key ?? text };
}
