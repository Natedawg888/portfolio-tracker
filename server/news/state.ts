/**
 * Read and write the signed-in user's news settings inside preferences_json.
 * Other preference keys are left as they are.
 */
import { getDb, queryOne, run } from '../db/index.ts';
import {
  applyNewsUserPatch,
  mergeNewsIntoPreferences,
  newsFromPreferences,
  type NewsUserState,
} from '../../src/lib/newsPrefs.ts';

export async function readNewsState(userId: string): Promise<NewsUserState> {
  const db = await getDb();
  const row = queryOne<{ preferences_json: string | null }>(
    db,
    `SELECT preferences_json FROM users WHERE id = ?`,
    [userId],
  );
  return newsFromPreferences(row?.preferences_json);
}

export async function saveNewsState(userId: string, patch: unknown): Promise<NewsUserState | null> {
  const db = await getDb();
  const row = queryOne<{ preferences_json: string | null }>(
    db,
    `SELECT preferences_json FROM users WHERE id = ?`,
    [userId],
  );
  if (!row) return null;
  const next = applyNewsUserPatch(newsFromPreferences(row.preferences_json), patch);
  run(db, `UPDATE users SET preferences_json = ?, updated_at = ? WHERE id = ?`, [
    mergeNewsIntoPreferences(row.preferences_json, next),
    new Date().toISOString(),
    userId,
  ]);
  return next;
}
