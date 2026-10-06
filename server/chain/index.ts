/**
 * Chain providers barrel. Adapters register here so importing this module
 * (once, from the API entry) makes them available to service.ts:
 *
 *   import { bitcoinProvider } from './bitcoin.ts';
 *   registerChainProvider(bitcoinProvider);
 *
 * Adapters land with KAN-35 (Bitcoin), KAN-36/37 (EVM), KAN-38 (Solana).
 */
export { registerChainProvider, getChainProvider, listChainProviders } from './registry.ts';
export { fetchWalletBalances, fetchWalletTransactions, isNetworkSyncable } from './service.ts';
export { describeChainConfig, redactChainSecrets } from './config.ts';
export { NETWORK_CHAIN_INFO, formatUnits } from './networks.ts';
export { ChainProviderError } from './types.ts';
export type * from './types.ts';
