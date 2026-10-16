/**
 * A user's asset-class switches (Settings → Categories & assets), read on the server so net
 * worth, History and Projections can leave hidden classes out (src/lib/visibleNetWorth.ts).
 */
import type { Database } from 'sql.js';
import { queryOne } from '../db/index.ts';
import { defaultAssetClassPrefs, normalizeAssetClassPrefs, type AssetClassPrefs } from '../../src/lib/assetClassPrefs.ts';

export function readAssetClassPrefs(db: Database, userId: string): AssetClassPrefs {
  const row = queryOne<{ preferences_json: string | null }>(db, `SELECT preferences_json FROM users WHERE id = ?`, [userId]);
  if (!row?.preferences_json) return defaultAssetClassPrefs();
  try {
    const parsed = JSON.parse(row.preferences_json) as { assetClasses?: unknown };
    return normalizeAssetClassPrefs(parsed?.assetClasses ?? parsed);
  } catch {
    return defaultAssetClassPrefs();
  }
}
