/**
 * New Pro checkout is off until Pro includes bank connect.
 *
 * PRO_PLAN_ENABLED=1 (also true, yes, or on) turns it back on. Read on every request.
 * Existing Pro grants, Stripe subscriptions and `npm run plan:set` do not use this flag.
 * The Stripe catalog entries for Pro stay in catalog.ts either way.
 */
const ON = new Set(['1', 'true', 'yes', 'on']);

export function proPlanEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return ON.has(String(env.PRO_PLAN_ENABLED ?? '').trim().toLowerCase());
}
