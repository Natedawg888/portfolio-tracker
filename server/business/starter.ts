/**
 * When someone ticks "I run a business" and their plan includes business management,
 * give them one business to open if they don't have one yet. The profile remembers that
 * this already happened, so deleting every business does not create another. Never renames.
 */
import type { Database } from 'sql.js';
import { parseRunsBusiness, starterBusinessCreated, withStarterBusinessCreated } from '../../src/lib/runsBusiness.ts';
import { queryOne, run } from '../db/index.ts';
import { hasFeature } from '../lib/entitlements.ts';
import { createBusiness, parseBusiness } from './store.ts';

export function ensureStarterBusiness(db: Database, userId: string): boolean {
  if (!hasFeature(db, userId, 'business_manage')) return false;
  const prefs = queryOne<{ preferences_json: string | null }>(db, `SELECT preferences_json FROM users WHERE id = ?`, [userId]);
  const json = prefs?.preferences_json ?? null;
  if (!parseRunsBusiness(json) || starterBusinessCreated(json)) return false;
  const existing = queryOne<{ id: string }>(db, `SELECT id FROM businesses WHERE user_id = ? LIMIT 1`, [userId]);
  if (existing) return false;
  const parsed = parseBusiness({ name: 'My business', type: 'sole_trader' });
  if (!parsed.ok) return false;
  createBusiness(db, userId, parsed.value);
  run(db, `UPDATE users SET preferences_json = ?, updated_at = ? WHERE id = ?`, [withStarterBusinessCreated(json), new Date().toISOString(), userId]);
  return true;
}
