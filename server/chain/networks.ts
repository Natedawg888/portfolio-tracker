/**
 * Per-network chain facts adapters need. Keyed by WalletNetwork so TypeScript
 * forces every new network in WALLET_NETWORKS to declare its native asset.
 */
import type { WalletNetwork } from '../lib/walletAddress.ts';
import type { ChainAsset } from './types.ts';

type NetworkChainInfo = {
  nativeAsset: ChainAsset;
  /** EIP-155 chain id for EVM networks; null otherwise. */
  evmChainId: number | null;
};

function native(symbol: string, name: string, decimals: number): ChainAsset {
  return { kind: 'native', symbol, name, decimals, contract: null };
}

export const NETWORK_CHAIN_INFO: Record<WalletNetwork, NetworkChainInfo> = {
  ethereum: { nativeAsset: native('ETH', 'Ether', 18), evmChainId: 1 },
  polygon: { nativeAsset: native('POL', 'Polygon Ecosystem Token', 18), evmChainId: 137 },
  base: { nativeAsset: native('ETH', 'Ether', 18), evmChainId: 8453 },
  arbitrum: { nativeAsset: native('ETH', 'Ether', 18), evmChainId: 42161 },
  bitcoin: { nativeAsset: native('BTC', 'Bitcoin', 8), evmChainId: null },
  solana: { nativeAsset: native('SOL', 'Solana', 9), evmChainId: null },
};

/** Format a smallest-unit integer string as a decimal string (no float rounding). */
export function formatUnits(amountRaw: string, decimals: number): string {
  if (!/^-?\d+$/.test(amountRaw)) throw new Error('amountRaw must be an integer string');
  const neg = amountRaw.startsWith('-');
  const digits = (neg ? amountRaw.slice(1) : amountRaw).replace(/^0+(?=\d)/, '');
  if (decimals === 0) return (neg && digits !== '0' ? '-' : '') + digits;
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const frac = padded.slice(-decimals).replace(/0+$/, '');
  const out = frac ? `${whole}.${frac}` : whole;
  return neg && out !== '0' ? `-${out}` : out;
}
