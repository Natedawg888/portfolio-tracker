/**
 * Plans and what they unlock (KAN-77). Checked on the server only; the client just shows the
 * result. Until billing exists, the operator grants plans in either of two ways:
 *   - PLAN_PLUS_EMAILS / PLAN_PRO_EMAILS: comma-separated emails, read on every check (set
 *     them as Railway variables; no database write, survives redeploys);
 *   - `npm run plan:set -- <email> <free|plus|pro>` writes user_entitlements. Stop the API
 *     first: it keeps the database in memory and would overwrite the change.
 * The higher of the two wins. Anyone else is on the free plan.
 */
import type { Database } from 'sql.js';
import { queryOne, run } from '../db/index.ts';

export const PLANS = ['free', 'plus', 'pro'] as const;
export type Plan = (typeof PLANS)[number];
export type Feature = 'household' | 'payslips' | 'crypto_pro' | 'bonds_plus' | 'commodities_plus';

const FEATURES: Record<Feature, readonly Plan[]> = {
  household: ['plus', 'pro'],
  /** Payslips (KAN-78): unlimited payslips, the PAYE check, and net pay into Income linked to the bank. */
  payslips: ['plus', 'pro'],
  /** Advanced crypto (KAN-47): ledger, cost basis and gains, staking income, DeFi positions, wallet import. */
  crypto_pro: ['pro'],
  /** Bonds (KAN-80): coupon calendar, coupons into Income, projections and maturity alerts. */
  bonds_plus: ['plus', 'pro'],
  /** Commodities (KAN-81): Commodities as its own class in the asset mix and on the Economic cycle page. */
  commodities_plus: ['plus', 'pro'],
};

export function isPlan(v: unknown): v is Plan {
  return (PLANS as readonly unknown[]).includes(v);
}

function envList(name: string): Set<string> {
  return new Set((process.env[name] ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
}

export function planOf(db: Database, userId: string): Plan {
  const r = queryOne<{ plan: string; email: string }>(
    db,
    `SELECT e.plan, u.email FROM users u LEFT JOIN user_entitlements e ON e.user_id = u.id WHERE u.id = ?`,
    [userId],
  );
  if (!r) return 'free';
  const stored: Plan = isPlan(r.plan) ? r.plan : 'free';
  const email = String(r.email ?? '').toLowerCase();
  const fromEnv: Plan = envList('PLAN_PRO_EMAILS').has(email) ? 'pro' : envList('PLAN_PLUS_EMAILS').has(email) ? 'plus' : 'free';
  return PLANS.indexOf(fromEnv) > PLANS.indexOf(stored) ? fromEnv : stored;
}

export function hasFeature(db: Database, userId: string, feature: Feature): boolean {
  return FEATURES[feature].includes(planOf(db, userId));
}

export function setPlan(db: Database, userId: string, plan: Plan, note = ''): void {
  run(
    db,
    `INSERT INTO user_entitlements (user_id, plan, note, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, note = excluded.note, updated_at = excluded.updated_at`,
    [userId, plan, note, new Date().toISOString()],
  );
}
