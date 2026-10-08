/**
 * Per-network provider pacing + rate-limit windows, shared by the sync job and
 * valuation so neither calls a network the provider asked us to back off from.
 */
import type { WalletNetwork } from '../lib/walletAddress.ts';

const networkLastCall = new Map<WalletNetwork, number>();
const networkBlockedUntil = new Map<WalletNetwork, number>();

function minGapMs(): number {
  const ms = Number(process.env.WALLET_SYNC_MIN_GAP_MS);
  return Number.isFinite(ms) && ms >= 0 ? ms : 1500;
}

/** Seconds until the network may be called again after a provider rate limit; 0 when clear. */
export function networkBlockedSec(network: WalletNetwork, now = Date.now()): number {
  const until = networkBlockedUntil.get(network) ?? 0;
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

export function blockNetwork(network: WalletNetwork, ms: number): void {
  networkBlockedUntil.set(network, Math.max(networkBlockedUntil.get(network) ?? 0, Date.now() + ms));
}

/** Wait so calls to one network are at least WALLET_SYNC_MIN_GAP_MS apart. */
export async function paceNetwork(network: WalletNetwork): Promise<void> {
  const wait = (networkLastCall.get(network) ?? 0) + minGapMs() - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  networkLastCall.set(network, Date.now());
}

/** Tests only. */
export function resetRateLimitsForTest(): void {
  networkLastCall.clear();
  networkBlockedUntil.clear();
}
