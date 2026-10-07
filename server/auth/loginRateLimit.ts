/**
 * In-memory brute-force limits for sign-in (KAN-16). Counts failures per account and per
 * client address in a sliding 15-minute window; a success clears the account's count.
 * Memory only: a restart resets it, which is acceptable for a single-process app.
 */
const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_ACCOUNT = 10;
export const MAX_FAILURES_PER_CLIENT = 50;

type Bucket = { failures: number[] };
const accounts = new Map<string, Bucket>();
const clients = new Map<string, Bucket>();

function recent(map: Map<string, Bucket>, key: string, now: number): number[] {
  const b = map.get(key);
  if (!b) return [];
  b.failures = b.failures.filter((t) => now - t < WINDOW_MS);
  if (b.failures.length === 0) map.delete(key);
  return b.failures;
}

/** Seconds until another attempt is allowed, or 0 when not limited. */
export function loginBlockedSec(accountKey: string, clientKey: string, now = Date.now()): number {
  const waits: number[] = [];
  const a = recent(accounts, accountKey, now);
  if (a.length >= MAX_FAILURES_PER_ACCOUNT) waits.push(a[0] + WINDOW_MS - now);
  const c = recent(clients, clientKey, now);
  if (c.length >= MAX_FAILURES_PER_CLIENT) waits.push(c[0] + WINDOW_MS - now);
  return waits.length ? Math.ceil(Math.max(...waits) / 1000) : 0;
}

export function recordLoginFailure(accountKey: string, clientKey: string, now = Date.now()): void {
  for (const [map, key] of [
    [accounts, accountKey],
    [clients, clientKey],
  ] as const) {
    const b = map.get(key) ?? { failures: [] };
    b.failures.push(now);
    map.set(key, b);
  }
}

export function clearLoginFailures(accountKey: string): void {
  accounts.delete(accountKey);
}

/** Tests only. */
export function resetLoginRateLimitForTest(): void {
  accounts.clear();
  clients.clear();
}
