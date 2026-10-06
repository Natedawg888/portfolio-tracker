/**
 * Chain providers barrel. Adapters register here so importing this module
 * (once, from the API entry) makes them available to service.ts:
 *
 *   import { bitcoinProvider } from './bitcoin.ts';
 *   registerChainProvider(bitcoinProvider);
 *
 * Adapters: KAN-35 Bitcoin (here); KAN-36/37 EVM and KAN-38 Solana to follow.
 */
import { bitcoinProvider } from './bitcoin.ts';
import { registerChainProvider, getChainProvider } from './registry.ts';

if (!getChainProvider('bitcoin')) registerChainProvider(bitcoinProvider);

export { registerChainProvider, getChainProvider, listChainProviders } from './registry.ts';
export { fetchWalletBalances, fetchWalletTransactions, isNetworkSyncable } from './service.ts';
export { describeChainConfig, redactChainSecrets } from './config.ts';
export { NETWORK_CHAIN_INFO, formatUnits } from './networks.ts';
export { ChainProviderError } from './types.ts';
export type * from './types.ts';
