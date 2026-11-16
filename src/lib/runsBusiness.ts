/**
 * "I run a business" from signup. Stored on preferences_json next to usage mode.
 * It does not by itself unlock business tools; the plan does.
 */

export function parseRunsBusiness(preferencesJson: string | null | undefined): boolean {
  if (preferencesJson == null || String(preferencesJson).trim() === '') return false;
  try {
    const parsed = JSON.parse(String(preferencesJson)) as Record<string, unknown> | null;
    return Boolean(parsed && typeof parsed === 'object' && parsed.runsBusiness === true);
  } catch {
    return false;
  }
}

/** preferences_json with runsBusiness set; every other key is kept. */
export function mergeRunsBusinessIntoPreferencesJson(preferencesJson: string | null | undefined, runsBusiness: boolean): string {
  let existing: Record<string, unknown> = {};
  if (preferencesJson) {
    try {
      const parsed = JSON.parse(preferencesJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  return JSON.stringify({ ...existing, runsBusiness });
}

function prefsObject(preferencesJson: string | null | undefined): Record<string, unknown> {
  if (!preferencesJson) return {};
  try {
    const parsed = JSON.parse(preferencesJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* start fresh */
  }
  return {};
}

/** True after the one-time “My business” starter has been created. */
export function starterBusinessCreated(preferencesJson: string | null | undefined): boolean {
  return prefsObject(preferencesJson).starterBusinessCreated === true;
}

/** preferences_json marked so a later sync does not create another starter business. */
export function withStarterBusinessCreated(preferencesJson: string | null | undefined): string {
  return JSON.stringify({ ...prefsObject(preferencesJson), starterBusinessCreated: true });
}
