/**
 * Snapshot prefs stored in users.preferences_json.snapshots.
 */

export type SnapshotPrefs = {
  /** Save one 'auto' snapshot a day when the Dashboard loads net worth. */
  dailySnapshot: boolean;
};

export function defaultSnapshotPrefs(): SnapshotPrefs {
  return { dailySnapshot: true };
}

export function normalizeSnapshotPrefs(raw: unknown): SnapshotPrefs {
  const base = defaultSnapshotPrefs();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;
  if (typeof o.dailySnapshot === 'boolean') base.dailySnapshot = o.dailySnapshot;
  return base;
}
