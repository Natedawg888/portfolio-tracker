/**
 * Server-only Akahu client.
 * Secrets stay in process.env / DB - never expose to the browser.
 * Per-request user token via runWithAkahuCreds (OAuth) or shared env token.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { getAkahuAppCredentials, getAkahuCredentials } from './loadEnv.ts';

const BASE_URL = 'https://api.akahu.io/v1';

type AkahuCredContext = { appId: string; userToken: string };

const akahuAls = new AsyncLocalStorage<AkahuCredContext>();

/** Run Akahu API calls with an explicit user token (per-user OAuth). */
export function runWithAkahuCreds<T>(
  creds: AkahuCredContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return akahuAls.run(creds, fn);
}

function resolveCreds(): { configured: boolean; appId: string | null; userToken: string | null } {
  const ctx = akahuAls.getStore();
  if (ctx?.appId && ctx?.userToken) {
    return { configured: true, appId: ctx.appId, userToken: ctx.userToken };
  }
  // Shared Personal App fallback
  return getAkahuCredentials();
}

export type AkahuConnection = {
  _id: string;
  name: string;
  logo?: string;
  connection_type?: string;
};

export type AkahuPortfolioItem = {
  fund_id?: string;
  value?: number;
  shares?: number;
  returns?: number;
  /** Present on some brokers (e.g. Hatch account breakdown / item fields). */
  cost_basis?: number;
  average_cost?: number;
  average_price?: number;
  name?: string;
  symbol?: string;
  exchange?: string | null;
  currency?: string;
  logo?: string;
};

export type AkahuAccount = {
  _id: string;
  name: string;
  status?: string;
  type: string;
  connection: AkahuConnection;
  balance?: {
    currency?: string;
    current?: number;
    available?: number;
  };
  meta?: {
    portfolio?: AkahuPortfolioItem[];
    [key: string]: unknown;
  };
  formatted_account?: string;
  attributes?: string[];
  refreshed?: Record<string, string>;
};

export type AkahuAccountsResponse = {
  success?: boolean;
  items: AkahuAccount[];
};

/** Settled transaction from GET /transactions (UTC timestamps). */
export type AkahuTransaction = {
  _id: string;
  _account: string;
  _connection?: string;
  _user?: string;
  date: string;
  description: string;
  amount: number;
  balance?: number;
  type: string;
  merchant?: {
    _id?: string;
    name?: string;
    website?: string;
  };
  category?: {
    _id?: string;
    name?: string;
    groups?: Record<string, { _id?: string; name?: string }>;
  };
  meta?: {
    particulars?: string;
    code?: string;
    reference?: string;
    other_account?: string;
    card_suffix?: string;
    logo?: string;
    conversion?: { amount?: number; currency?: string; rate?: number };
    [key: string]: unknown;
  };
  created_at?: string;
  updated_at?: string;
};

export type AkahuTransactionsResponse = {
  success?: boolean;
  items: AkahuTransaction[];
  cursor?: { next?: string | null };
};

async function akahuFetch<T>(path: string): Promise<T> {
  const { configured, appId, userToken } = resolveCreds();
  if (!configured || !appId || !userToken) {
    throw new Error('Akahu not configured (set AKAHU_APP_ID and AKAHU_USER_TOKEN, or Connect via OAuth)');
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${userToken}`,
      'X-Akahu-Id': appId,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Akahu API ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function akahuGetAccounts(): Promise<AkahuAccount[]> {
  const data = await akahuFetch<AkahuAccountsResponse>('/accounts');
  return data.items ?? [];
}

export async function akahuGetMe(): Promise<unknown> {
  return akahuFetch('/me');
}

export type AkahuGetTransactionsOpts = {
  /** ISO datetime - Akahu treats start as exclusive */
  start?: string;
  /** ISO datetime - Akahu treats end as inclusive */
  end?: string;
};

/**
 * Fetch settled transactions with pagination (cursor.next).
 * Docs: https://developers.akahu.nz/reference/get_transactions
 */
export async function akahuGetTransactions(
  opts: AkahuGetTransactionsOpts = {},
): Promise<AkahuTransaction[]> {
  const all: AkahuTransaction[] = [];
  let cursor: string | null | undefined = undefined;
  let pages = 0;
  const maxPages = 50;

  do {
    const params = new URLSearchParams();
    if (opts.start) params.set('start', opts.start);
    if (opts.end) params.set('end', opts.end);
    if (cursor) params.set('cursor', cursor);
    const qs = params.toString();
    const path = qs ? `/transactions?${qs}` : '/transactions';
    const data = await akahuFetch<AkahuTransactionsResponse>(path);
    all.push(...(data.items ?? []));
    cursor = data.cursor?.next ?? null;
    pages += 1;
  } while (cursor && pages < maxPages);

  return all;
}

/**
 * Settled transactions for one account (GET /accounts/{id}/transactions).
 * Returns [] when the account has no TRANSACTIONS attribute / no history.
 */
export async function akahuGetAccountTransactions(
  accountId: string,
  opts: AkahuGetTransactionsOpts = {},
): Promise<AkahuTransaction[]> {
  const all: AkahuTransaction[] = [];
  let cursor: string | null | undefined = undefined;
  let pages = 0;
  const maxPages = 20;

  do {
    const params = new URLSearchParams();
    if (opts.start) params.set('start', opts.start);
    if (opts.end) params.set('end', opts.end);
    if (cursor) params.set('cursor', cursor);
    const qs = params.toString();
    const path = qs
      ? `/accounts/${encodeURIComponent(accountId)}/transactions?${qs}`
      : `/accounts/${encodeURIComponent(accountId)}/transactions`;
    const data = await akahuFetch<AkahuTransactionsResponse>(path);
    all.push(...(data.items ?? []));
    cursor = data.cursor?.next ?? null;
    pages += 1;
  } while (cursor && pages < maxPages);

  return all;
}

export type AkahuRefreshResult = {
  requested: boolean;
  rateLimited: boolean;
  error?: string;
};

/**
 * Request on-demand refresh of all connected accounts (balances + transactions).
 * Akahu enriches asynchronously; 429 if refreshed too recently (~5 min).
 * Docs: https://developers.akahu.nz/reference/post_refresh
 */
export async function akahuRequestRefresh(): Promise<AkahuRefreshResult> {
  const { configured, appId, userToken } = resolveCreds();
  if (!configured || !appId || !userToken) {
    throw new Error('Akahu not configured (set AKAHU_APP_ID and AKAHU_USER_TOKEN, or Connect via OAuth)');
  }
  const res = await fetch(`${BASE_URL}/refresh`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userToken}`,
      'X-Akahu-Id': appId,
      Accept: 'application/json',
    },
  });
  if (res.status === 429) {
    return { requested: false, rateLimited: true };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      requested: false,
      rateLimited: false,
      error: `Akahu refresh ${res.status}: ${text.slice(0, 200) || res.statusText}`,
    };
  }
  return { requested: true, rateLimited: false };
}

/** Latest `refreshed.transactions` ISO across accounts (lexicographic max). */
export function latestTxnRefreshAt(accounts: AkahuAccount[]): string | null {
  let best: string | null = null;
  for (const a of accounts) {
    const t = a.refreshed?.transactions;
    if (t && (!best || t > best)) best = t;
  }
  return best;
}

/**
 * Poll until any account reports a newer transactions refresh than `baseline`,
 * or until timeout.
 */
export async function waitForTxnRefresh(
  baseline: string | null,
  opts: { maxMs?: number; intervalMs?: number } = {},
): Promise<{ waitedMs: number; latest: string | null }> {
  const maxMs = opts.maxMs ?? 20_000;
  const intervalMs = opts.intervalMs ?? 1_500;
  const started = Date.now();
  let latest = baseline;
  while (Date.now() - started < maxMs) {
    const accounts = await akahuGetAccounts();
    latest = latestTxnRefreshAt(accounts);
    if (latest && (!baseline || latest > baseline)) {
      return { waitedMs: Date.now() - started, latest };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { waitedMs: Date.now() - started, latest: latest ?? null };
}

/** Group Akahu accounts into institution summaries for the Connect UI. */
export function institutionsFromAccounts(
  accounts: AkahuAccount[],
): Array<{
  connectionId: string;
  name: string;
  logo?: string | null;
  accountCount: number;
  types: string[];
}> {
  const map = new Map<
    string,
    { connectionId: string; name: string; logo?: string | null; accountCount: number; types: Set<string> }
  >();
  for (const a of accounts) {
    const id = a.connection?._id || a.connection?.name || 'unknown';
    const name = a.connection?.name || 'Unknown';
    let row = map.get(id);
    if (!row) {
      row = {
        connectionId: id,
        name,
        logo: a.connection?.logo ?? null,
        accountCount: 0,
        types: new Set(),
      };
      map.set(id, row);
    }
    row.accountCount += 1;
    if (a.type) row.types.add(a.type);
  }
  return [...map.values()]
    .map((r) => ({
      connectionId: r.connectionId,
      name: r.name,
      logo: r.logo,
      accountCount: r.accountCount,
      types: [...r.types].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Re-export app creds helper for routes that need mode checks. */
export { getAkahuAppCredentials };
