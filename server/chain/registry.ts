/**
 * Chain provider registry. Adapters register once at import time
 * (see server/chain/index.ts); lookups pick the first provider that supports a network.
 */
import type { WalletNetwork } from '../lib/walletAddress.ts';
import type { ChainProvider } from './types.ts';

const providers: ChainProvider[] = [];

export function registerChainProvider(provider: ChainProvider): void {
  if (providers.some((p) => p.id === provider.id)) {
    throw new Error(`Chain provider "${provider.id}" is already registered`);
  }
  providers.push(provider);
}

export function getChainProvider(network: WalletNetwork): ChainProvider | null {
  return providers.find((p) => p.supports(network)) ?? null;
}

export function listChainProviders(): readonly ChainProvider[] {
  return providers;
}

/** Tests only: drop all registrations. */
export function resetChainProvidersForTest(): void {
  providers.length = 0;
}
