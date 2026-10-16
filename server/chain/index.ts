/**
 * Chain providers barrel. Adapters register here so importing this module
 * (once, from the API entry) makes them available to service.ts:
 *
 *   import { bitcoinProvider } from './bitcoin.ts';
 *   registerChainProvider(bitcoinProvider);
 *
 * Adapters: KAN-35 Bitcoin, KAN-36/37 EVM (Ethereum, Polygon, Base, Arbitrum); KAN-38 Solana to follow.
 */
import { bitcoinProvider } from './bitcoin.ts';
import { evmProvider } from './evm.ts';
import { registerChainProvider, getChainProvider } from './registry.ts';

if (!getChainProvider('bitcoin')) registerChainProvider(bitcoinProvider);
if (!getChainProvider('ethereum')) registerChainProvider(evmProvider);

export { registerChainProvider, getChainProvider, listChainProviders } from './registry.ts';
export { fetchWalletBalances, fetchWalletTokenTransfers, fetchWalletTransactions, isNetworkSyncable } from './service.ts';
export { describeChainConfig, redactChainSecrets } from './config.ts';
export { startWalletSyncScheduler, stopWalletSyncScheduler } from './sync.ts';
export { NETWORK_CHAIN_INFO, formatUnits } from './networks.ts';
export { ChainProviderError } from './types.ts';
export type * from './types.ts';
