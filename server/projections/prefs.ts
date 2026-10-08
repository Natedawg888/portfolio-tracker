/**
 * Per-user saved projection assumptions: a yearly return and a monthly addition per
 * asset class, stored in users.preferences_json under `projectionAssumptions`.
 * Values are the user's own; nothing here is a market forecast.
 */
import type { Database } from 'sql.js';
import { queryOne, run } from '../db/index.ts';
import { normalizeSavedAssumptions, type SavedProjectionAssumptions } from '../../src/lib/projectionClasses.ts';

function readPrefs(db: Database, userId: string): Record<string, unknown> {
  const row = queryOne<{ preferences_json?: string | null }>(db, `SELECT preferences_json FROM users WHERE id = ?`, [userId]);
  if (!row?.preferences_json) return {};
  try {
    const parsed = JSON.parse(row.preferences_json) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function loadSavedAssumptions(db: Database, userId: string): SavedProjectionAssumptions {
  return normalizeSavedAssumptions(readPrefs(db, userId).projectionAssumptions);
}

/** Replace the saved set. Unknown classes and out-of-range numbers are dropped. */
export function saveAssumptions(db: Database, userId: string, raw: unknown): SavedProjectionAssumptions {
  const next = normalizeSavedAssumptions(raw);
  const prefs = readPrefs(db, userId);
  prefs.projectionAssumptions = next;
  run(db, `UPDATE users SET preferences_json = ?, updated_at = ? WHERE id = ?`, [
    JSON.stringify(prefs),
    new Date().toISOString(),
    userId,
  ]);
  return next;
}
