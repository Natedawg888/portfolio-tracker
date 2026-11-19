/**
 * Where Stripe Checkout may send the browser afterwards (KAN-52, onboarding plan step).
 * The client may ask for an in-app path; anything else falls back to Settings.
 * Only the path is kept — query strings, hashes and other origins are dropped —
 * and the server adds `billing=success` or `billing=cancelled` itself.
 */

export const BILLING_RETURN_PATHS = ['/settings', '/register', '/', '/business'] as const;
export type BillingReturnPath = (typeof BILLING_RETURN_PATHS)[number];

export const DEFAULT_BILLING_RETURN: BillingReturnPath = '/settings';

const ALLOWED = new Set<string>(BILLING_RETURN_PATHS);

function isAllowed(path: string): path is BillingReturnPath {
  return ALLOWED.has(path);
}

/**
 * An internal return path, or Settings when `raw` is missing or not on the allowlist.
 * Rejects other origins, protocol-relative URLs, backslashes, control characters and
 * paths that normalise off the list.
 */
export function billingReturnPath(raw: unknown): BillingReturnPath {
  if (typeof raw !== 'string') return DEFAULT_BILLING_RETURN;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 256) return DEFAULT_BILLING_RETURN;
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return DEFAULT_BILLING_RETURN;
  if (trimmed.includes('\\') || trimmed.includes('://') || trimmed.includes('@')) return DEFAULT_BILLING_RETURN;
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return DEFAULT_BILLING_RETURN;
  }

  let url: URL;
  try {
    url = new URL(trimmed, 'https://koruledger.invalid');
  } catch {
    return DEFAULT_BILLING_RETURN;
  }
  if (url.origin !== 'https://koruledger.invalid' || url.username || url.password) return DEFAULT_BILLING_RETURN;

  let path = url.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  try {
    path = decodeURIComponent(path);
  } catch {
    return DEFAULT_BILLING_RETURN;
  }
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('://') || path.includes('..')) {
    return DEFAULT_BILLING_RETURN;
  }
  return isAllowed(path) ? path : DEFAULT_BILLING_RETURN;
}

/** Absolute Checkout success or cancel URL on `baseUrl` for an allowlisted return path. */
export function billingResultUrl(baseUrl: string, returnTo: unknown, billing: 'success' | 'cancelled'): string {
  const base = baseUrl.replace(/\/+$/, '');
  const path = billingReturnPath(returnTo);
  if (path === '/settings') return `${base}/settings?tab=account&billing=${billing}`;
  if (path === '/business') return `${base}/business?setup=1&billing=${billing}`;
  if (path === '/') return `${base}/?billing=${billing}`;
  return `${base}/register?billing=${billing}`;
}
