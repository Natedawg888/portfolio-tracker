/**
 * When someone ticks "I run a business" and their plan includes business management,
 * give them one business to open if they don't have one yet. Never deletes or renames.
 */
import type { Database } from 'sql.js';
import { parseRunsBusiness } from '../../src/lib/runsBusiness.ts';
import { queryOne } from '../db/index.ts';
import { hasFeature } from '../lib/entitlements.ts';
import { createBusiness, parseBusiness } from './store.ts';

export function ensureStarterBusiness(db: Database, userId: string): boolean {
  if (!hasFeature(db, userId, 'business_manage')) return false;
  const prefs = queryOne<{ preferences_json: string | null }>(db, `SELECT preferences_json FROM users WHERE id = ?`, [userId]);
  if (!parseRunsBusiness(prefs?.preferences_json)) return false;
  const existing = queryOne<{ id: string }>(db, `SELECT id FROM businesses WHERE user_id = ? LIMIT 1`, [userId]);
  if (existing) return false;
  const parsed = parseBusiness({ name: 'My business', type: 'sole_trader' });
  if (!parsed.ok) return false;
  createBusiness(db, userId, parsed.value);
  return true;
}
