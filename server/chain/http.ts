/**
 * Shared transport for chain adapters: JSON-RPC POST and REST GET with timeouts.
 * Every failure becomes a ChainProviderError whose message names the network and
 * status only — never the endpoint URL or key (and is passed through redaction anyway).
 */
import { WALLET_NETWORKS } from '../lib/walletAddress.ts';
import { redactChainSecrets, type ChainEndpoint } from './config.ts';
import { ChainProviderError } from './types.ts';

const DEFAULT_TIMEOUT_MS = 15_000;
const USER_AGENT = 'portfolio-tracker/wallets (read-only)';

/** Header name used when CHAIN_<NETWORK>_API_KEY is set; adapters may override. */
export const DEFAULT_API_KEY_HEADER = 'x-api-key';

type RequestOpts = {
  timeoutMs?: number;
  /** Header to carry endpoint.apiKey (null = do not send the key as a header). */
  apiKeyHeader?: string | null;
};

function fail(endpoint: ChainEndpoint, code: ChainProviderError['code'], detail: string, retryAfter: number | null = null) {
  const label = WALLET_NETWORKS[endpoint.network].label;
  return new ChainProviderError(
    code,
    endpoint.network,
    redactChainSecrets(`${label} provider ${detail}`),
    retryAfter,
  );
}

function parseRetryAfter(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : null;
}

async function request(
  endpoint: ChainEndpoint,
  url: string,
  init: { method: 'GET' | 'POST'; body?: string },
  opts: RequestOpts,
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': USER_AGENT };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const keyHeader = opts.apiKeyHeader === undefined ? DEFAULT_API_KEY_HEADER : opts.apiKeyHeader;
  if (endpoint.apiKey && keyHeader) headers[keyHeader] = endpoint.apiKey;

  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers,
      body: init.body,
      redirect: 'error', // never forward a key-bearing request to another host
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') throw fail(endpoint, 'timeout', 'timed out');
    throw fail(endpoint, 'network_error', 'could not be reached');
  }

  if (res.status === 429) {
    throw fail(endpoint, 'rate_limited', 'rate limit reached', parseRetryAfter(res.headers.get('retry-after')));
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw fail(endpoint, 'upstream_error', `returned HTTP ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    throw fail(endpoint, 'upstream_error', 'returned a response that is not JSON');
  }
}

let rpcId = 0;

/** JSON-RPC 2.0 call against endpoint.url (EVM / Solana). Returns `result`. */
export async function jsonRpc<T>(
  endpoint: ChainEndpoint,
  method: string,
  params: unknown[] | Record<string, unknown>,
  opts: RequestOpts = {},
): Promise<T> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params });
  const json = (await request(endpoint, endpoint.url, { method: 'POST', body }, opts)) as {
    result?: T;
    error?: { code?: number; message?: string };
  };
  if (json && typeof json === 'object' && json.error) {
    const code = json.error.code;
    // -32005 (EVM) / 429-ish messages: provider-side rate limiting via JSON-RPC.
    if (code === -32005 || /rate|limit|too many/i.test(json.error.message ?? '')) {
      throw fail(endpoint, 'rate_limited', 'rate limit reached');
    }
    const msg = String(json.error.message ?? 'error').slice(0, 200);
    throw fail(endpoint, 'upstream_error', `RPC ${method} failed (${code ?? '?'}): ${msg}`);
  }
  if (!json || typeof json !== 'object' || !('result' in json)) {
    throw fail(endpoint, 'upstream_error', `RPC ${method} returned no result`);
  }
  return json.result as T;
}

/** REST GET relative to endpoint.url (e.g. Esplora `/address/:addr`). */
export async function getJson<T>(endpoint: ChainEndpoint, path: string, opts: RequestOpts = {}): Promise<T> {
  const base = endpoint.url.replace(/\/+$/, '');
  return (await request(endpoint, `${base}/${path.replace(/^\/+/, '')}`, { method: 'GET' }, opts)) as T;
}
