/**
 * The only chain entry point for portfolio / sync code. Network-agnostic:
 * a new network needs a WALLET_NETWORKS entry, NETWORK_CHAIN_INFO, a default
 * endpoint and a provider that supports it — nothing here or in aggregation changes.
 */
import { WALLET_NETWORKS, type WalletNetwork } from '../lib/walletAddress.ts';
import { resolveChainEndpoint, redactChainSecrets } from './config.ts';
import { getChainProvider } from './registry.ts';
import {
  ChainProviderError,
  type ChainBalance,
  type ChainProvider,
  type ProviderContext,
  type TransactionPage,
} from './types.ts';

export type WalletRef = { network: WalletNetwork; address: string };

export type BalanceSnapshot = {
  network: WalletNetwork;
  address: string;
  providerId: string;
  fetchedAt: string;
  balances: ChainBalance[];
};

export type TransactionSnapshot = TransactionPage & {
  network: WalletNetwork;
  address: string;
  providerId: string;
  fetchedAt: string;
};

const MAX_TX_PAGE = 100;

function prepare(wallet: WalletRef): { provider: ChainProvider; ctx: ProviderContext } {
  const { network } = wallet;
  const label = WALLET_NETWORKS[network]?.label ?? network;
  const provider = getChainProvider(network);
  if (!provider) {
    throw new ChainProviderError('unsupported_network', network, `${label} wallets cannot be synced yet`);
  }
  const resolved = resolveChainEndpoint(network);
  if (!resolved.ok) {
    throw new ChainProviderError('not_configured', network, `${label} provider is not configured: ${resolved.reason}`);
  }
  return { provider, ctx: { network, endpoint: resolved.endpoint } };
}

/** Anything an adapter throws leaves here as a ChainProviderError with secrets redacted. */
function normaliseError(err: unknown, network: WalletNetwork): ChainProviderError {
  if (err instanceof ChainProviderError) {
    return new ChainProviderError(err.code, err.network, redactChainSecrets(err.message), err.retryAfterSec);
  }
  const label = WALLET_NETWORKS[network]?.label ?? network;
  const detail = err instanceof Error ? err.message : String(err);
  return new ChainProviderError(
    'upstream_error',
    network,
    redactChainSecrets(`${label} provider failed: ${detail}`.slice(0, 300)),
  );
}

export async function fetchWalletBalances(wallet: WalletRef): Promise<BalanceSnapshot> {
  const { provider, ctx } = prepare(wallet);
  try {
    const balances = await provider.getBalances(ctx, wallet.address);
    return {
      network: wallet.network,
      address: wallet.address,
      providerId: provider.id,
      fetchedAt: new Date().toISOString(),
      balances,
    };
  } catch (err) {
    throw normaliseError(err, wallet.network);
  }
}

export async function fetchWalletTransactions(
  wallet: WalletRef,
  opts: { cursor?: string | null; limit?: number } = {},
): Promise<TransactionSnapshot> {
  const { provider, ctx } = prepare(wallet);
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 50)), MAX_TX_PAGE);
  try {
    const page = await provider.getTransactions(ctx, wallet.address, { cursor: opts.cursor ?? null, limit });
    return {
      ...page,
      network: wallet.network,
      address: wallet.address,
      providerId: provider.id,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    throw normaliseError(err, wallet.network);
  }
}

/** Client-safe: which networks currently have an adapter (no endpoint details). */
export function isNetworkSyncable(network: WalletNetwork): boolean {
  return getChainProvider(network) !== null && resolveChainEndpoint(network).ok;
}
