/**
 * Chain endpoint config from env — server-side only, never sent to the browser.
 *
 *   CHAIN_<NETWORK>_RPC_URL   e.g. CHAIN_ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/<key>
 *   CHAIN_<NETWORK>_API_KEY   optional key for data providers that take it as a header
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

export function envKeys(network: WalletNetwork): { url: string; apiKey: string } {
  const p = `CHAIN_${network.toUpperCase()}`;
  return { url: `${p}_RPC_URL`, apiKey: `${p}_API_KEY` };
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
    const url = process.env[keys.url]?.trim();
    const apiKey = process.env[keys.apiKey]?.trim();
    if (apiKey) secrets.add(apiKey);
    if (url) {
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
