/**
 * Blockchain provider abstraction — shared shapes for read-only wallet data.
 *
 * Adapters (Bitcoin, EVM, Solana …) implement ChainProvider. Portfolio code only
 * talks to server/chain/service.ts, so adding a network never touches aggregation.
 * Amounts are integer strings in the asset's smallest unit (wei, sats, lamports)
 * plus `decimals` — never floats, never stored as source of truth.
 */
import type { WalletNetwork } from '../lib/walletAddress.ts';
import type { ChainEndpoint } from './config.ts';

export type ChainAsset = {
  /** 'native' for ETH/BTC/SOL…; 'token' for ERC-20 / SPL. */
  kind: 'native' | 'token';
  symbol: string;
  name: string;
  decimals: number;
  /** ERC-20 contract or SPL mint address; null for native assets. */
  contract: string | null;
};

export type ChainBalance = {
  asset: ChainAsset;
  /** Smallest-unit integer as a decimal string (e.g. wei). */
  amountRaw: string;
};

export type ChainTransaction = {
  hash: string;
  /** ISO time; null while unconfirmed or when the chain does not report it. */
  timestamp: string | null;
  status: 'confirmed' | 'pending' | 'failed';
  /** Relative to the wallet address. */
  direction: 'in' | 'out' | 'self';
  asset: ChainAsset;
  amountRaw: string;
  /** Network fee paid by this wallet (native smallest unit), when it paid one. */
  feeRaw: string | null;
  counterparty: string | null;
};

export type TransactionPage = {
  transactions: ChainTransaction[];
  /** Opaque cursor for the next (older) page; null when there are no more. */
  nextCursor: string | null;
};

export type ProviderContext = {
  network: WalletNetwork;
  /** Resolved server-side endpoint (may embed a key) — adapters must never return it. */
  endpoint: ChainEndpoint;
};

export interface ChainProvider {
  id: string;
  label: string;
  /** Whether this adapter can serve the network (e.g. EVM adapter: every `evm` family network). */
  supports(network: WalletNetwork): boolean;
  /** Native + token balances for a public address. */
  getBalances(ctx: ProviderContext, address: string): Promise<ChainBalance[]>;
  /** Newest-first transaction history for a public address. */
  getTransactions(
    ctx: ProviderContext,
    address: string,
    opts: { cursor?: string | null; limit: number },
  ): Promise<TransactionPage>;
}

export type ChainErrorCode =
  | 'unsupported_network' // no adapter registered yet
  | 'not_configured' // endpoint missing / invalid in env
  | 'rate_limited'
  | 'timeout'
  | 'upstream_error' // provider replied with an error / bad payload
  | 'network_error'; // DNS / connection failure

/** Error safe to show users and store in wallets.status_message — never contains keys or endpoint URLs. */
export class ChainProviderError extends Error {
  readonly code: ChainErrorCode;
  readonly network: WalletNetwork;
  /** Seconds to wait before retrying, when the provider said so (429 Retry-After). */
  readonly retryAfterSec: number | null;

  constructor(
    code: ChainErrorCode,
    network: WalletNetwork,
    message: string,
    retryAfterSec: number | null = null,
  ) {
    super(message);
    this.name = 'ChainProviderError';
    this.code = code;
    this.network = network;
    this.retryAfterSec = retryAfterSec;
  }

  /** Transient failures worth retrying with backoff. */
  get retryable(): boolean {
    return this.code === 'rate_limited' || this.code === 'timeout' || this.code === 'network_error';
  }
}
