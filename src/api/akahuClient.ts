/**
 * Browser-safe Akahu helpers - tokens never leave the server.
 * Live sync: POST /api/akahu/sync (see server/akahu/).
 * Connect: POST /api/akahu/connect → Akahu OAuth (Full App).
 */

import { api } from './client';

export type AkahuInstitution = {
  connectionId: string;
  name: string;
  logo?: string | null;
  accountCount: number;
  types: string[];
};

export type AkahuConnectionStatus = {
  configured: boolean;
  provider: string;
  baseUrl: string;
  mode: 'none' | 'personal' | 'oauth';
  oauthReady: boolean;
  sharedTokenConfigured: boolean;
  canSync?: boolean;
  sharedTokenOwnerOnly?: boolean;
  needsOwnOAuth?: boolean;
  tokenSource: 'oauth' | 'env' | null;
  connected: boolean;
  oauthConnected: boolean;
  connectedAt: string | null;
  lastSyncAt: string | null;
  institutions: AkahuInstitution[];
  multiUser: 'per_user_oauth' | 'shared_env_token' | 'shared_env_token_owner_only' | 'none';
};

export type AkahuStatus = AkahuConnectionStatus;

export type AkahuSyncResult = {
  ok: boolean;
  stocksUpserted: number;
  cryptoUpserted: number;
  stocksDeleted: number;
  cryptoDeleted: number;
  kiwisaverFunds: number;
  kiwisaverBalanceSynced: boolean;
  cashAccountsUpserted: number;
  stockSymbols: string[];
  cryptoSymbols: string[];
  sources: string[];
  fxSources?: string[];
  error?: string;
};

export type AkahuTxnSyncResult = {
  ok: boolean;
  fetched: number;
  inserted: number;
  updated: number;
  merged?: number;
  /** Uncategorised rows given a category guessed from past transactions */
  categorised?: number;
  skippedNoAccount: number;
  skippedBeforeDate: number;
  sinceDate: string;
  cashAccountsEnsured?: number;
  refreshed?: boolean;
  refreshRateLimited?: boolean;
  error?: string;
};

export function akahuStatus(): Promise<AkahuConnectionStatus> {
  return api.akahu.status();
}

export function akahuSync(): Promise<AkahuSyncResult> {
  return api.akahu.sync();
}

export function akahuSyncTransactions(sinceDate = '2026-10-01'): Promise<AkahuTxnSyncResult> {
  return api.akahu.syncTransactions(sinceDate);
}

export function akahuConnect(): Promise<{ ok: boolean; authorizeUrl: string }> {
  return api.akahu.connect();
}

export function akahuDisconnect(): Promise<{
  ok: boolean;
  disconnected: boolean;
  message?: string;
  revokedAtAkahu?: boolean;
  revokeError?: string;
}> {
  return api.akahu.disconnect();
}

export function akahuRefreshInstitutions(): Promise<{
  ok: boolean;
  institutions: AkahuInstitution[];
  tokenSource?: string;
  error?: string;
}> {
  return api.akahu.institutions();
}
