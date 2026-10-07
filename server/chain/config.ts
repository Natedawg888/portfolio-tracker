/**
 * Chain endpoint config from env — server-side only, never sent to the browser.
 *
 *   CHAIN_<NETWORK>_RPC_URL   e.g. CHAIN_ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/<key>
 *   CHAIN_<NETWORK>_API_KEY   optional key for data providers that take it as a header
 *   CHAIN_<NETWORK>_INDEXER_URL  EVM only: Blockscout API v2 base for ERC-20 discovery and
 *                             history (plain JSON-RPC can't list an address's tokens)
 *
 * Without an env URL each network falls back to a public keyless endpoint
 * (rate-limited; fine for local use). Values are read on each call so .env
 * loading order does not matter. Use describeChainConfig() for anything client-facing.
 */
import { WALLET_NETWORKS, type WalletNetwork } from '../lib/walletAddress.ts';

export type ChainEndpoint = {
  network: WalletNetwork;
  url: string;
  apiKey: string | null;
  source: 'env' | 'public-default';
};

/** Public keyless defaults (rate-limited). Bitcoin is an Esplora REST base, the rest JSON-RPC. */
export const PUBLIC_DEFAULT_URLS: Record<WalletNetwork, string> = {
  ethereum: 'https://ethereum-rpc.publicnode.com',
  polygon: 'https://polygon-bor-rpc.publicnode.com',
  base: 'https://base-rpc.publicnode.com',
  arbitrum: 'https://arbitrum-one-rpc.publicnode.com',
  bitcoin: 'https://blockstream.info/api',
  solana: 'https://api.mainnet-beta.solana.com',
};

/**
 * Public keyless Blockscout API v2 bases for EVM token discovery and history (KAN-36).
 * Polygon / Base / Arbitrum arrive with KAN-37.
 */
export const PUBLIC_INDEXER_URLS: Partial<Record<WalletNetwork, string>> = {
  ethereum: 'https://eth.blockscout.com/api/v2',
};

export function envKeys(network: WalletNetwork): { url: string; apiKey: string; indexerUrl: string } {
  const p = `CHAIN_${network.toUpperCase()}`;
  return { url: `${p}_RPC_URL`, apiKey: `${p}_API_KEY`, indexerUrl: `${p}_INDEXER_URL` };
}

/** https only; plain http allowed for loopback (local nodes, tests). */
function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

export type EndpointResolution =
  | { ok: true; endpoint: ChainEndpoint }
  | { ok: false; reason: string };

export function resolveChainEndpoint(network: WalletNetwork): EndpointResolution {
  const keys = envKeys(network);
  const envUrl = process.env[keys.url]?.trim() || '';
  const apiKey = process.env[keys.apiKey]?.trim() || null;
  if (envUrl) {
    if (!isAllowedUrl(envUrl)) {
      // Never include the value — it may embed a key.
      return { ok: false, reason: `${keys.url} must be an https URL` };
    }
    return { ok: true, endpoint: { network, url: envUrl, apiKey, source: 'env' } };
  }
  return {
    ok: true,
    endpoint: { network, url: PUBLIC_DEFAULT_URLS[network], apiKey, source: 'public-default' },
  };
}

/**
 * Indexer (Blockscout API v2) for an EVM network: env override, else the public default.
 * The RPC key is never sent to it (apiKey null) — it's a different host.
 */
export function resolveIndexerEndpoint(network: WalletNetwork): EndpointResolution {
  const key = envKeys(network).indexerUrl;
  const envUrl = process.env[key]?.trim() || '';
  if (envUrl) {
    if (!isAllowedUrl(envUrl)) return { ok: false, reason: `${key} must be an https URL` };
    return { ok: true, endpoint: { network, url: envUrl, apiKey: null, source: 'env' } };
  }
  const url = PUBLIC_INDEXER_URLS[network];
  if (!url) return { ok: false, reason: `${key} is not set and there is no public default` };
  return { ok: true, endpoint: { network, url, apiKey: null, source: 'public-default' } };
}

export type ChainConfigStatus = {
  network: WalletNetwork;
  configured: boolean;
  source: ChainEndpoint['source'] | null;
  hasApiKey: boolean;
  /** Env var name to fix when misconfigured (a name, never a value). */
  problem: string | null;
};

/** Redacted, client-safe view: booleans and env var names only — no URLs, hosts or keys. */
export function describeChainConfig(): ChainConfigStatus[] {
  return (Object.keys(WALLET_NETWORKS) as WalletNetwork[]).map((network) => {
    const r = resolveChainEndpoint(network);
    return r.ok
      ? {
          network,
          configured: true,
          source: r.endpoint.source,
          hasApiKey: Boolean(r.endpoint.apiKey),
          problem: null,
        }
      : { network, configured: false, source: null, hasApiKey: false, problem: r.reason };
  });
}

/**
 * Remove every configured chain secret from text (error messages, logs):
 * full env URLs, API keys, and long path/query tokens of env URLs (Alchemy/Infura
 * style /v2/<key>, ?api-key=…). Public default URLs are not secret and stay readable.
 */
export function redactChainSecrets(text: string): string {
  const secrets = new Set<string>();
  for (const network of Object.keys(WALLET_NETWORKS) as WalletNetwork[]) {
    const keys = envKeys(network);
    const apiKey = process.env[keys.apiKey]?.trim();
    if (apiKey) secrets.add(apiKey);
    for (const url of [process.env[keys.url]?.trim(), process.env[keys.indexerUrl]?.trim()]) {
      if (!url) continue;
      secrets.add(url);
      secrets.add(url.replace(/\/+$/, ''));
      try {
        const u = new URL(url);
        for (const part of u.pathname.split('/')) if (part.length >= 12) secrets.add(part);
        for (const v of u.searchParams.values()) if (v.length >= 8) secrets.add(v);
        if (u.password) secrets.add(u.password);
        if (u.username) secrets.add(u.username);
      } catch {
        /* invalid URL — the raw value is already in the set */
      }
    }
  }
  let out = text;
  // Longest first so a full URL is replaced before its embedded key.
  for (const s of [...secrets].sort((a, b) => b.length - a.length)) {
    if (s) out = out.split(s).join('[redacted]');
  }
  // Generic key=value patterns from upstream error bodies.
  return out.replace(/((?:api[-_]?key|apikey|token|access[-_]?key)=)[^&\s"']+/gi, '$1[redacted]');
}
