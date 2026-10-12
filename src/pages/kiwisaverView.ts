/**
 * KiwiSaver header view rules. Missing fields are omitted — nothing here is estimated.
 * Run: npm run test:kiwisaver
 */

export type KiwiSaverHeaderSource = {
  name: string | null;
  /** Null on Akahu rows (`scheme_name` is not stored). */
  schemeName: string | null;
  provider: string | null;
  observedAt: string | null;
  pir: number | null;
};

export type KiwiSaverHeaderPart =
  | { kind: 'scheme'; text: string }
  | { kind: 'provider'; text: string }
  | { kind: 'synced'; text: string }
  | { kind: 'pir'; text: string };

/** Moved off the page into the ⓘ next to the sync time. */
export const KIWISAVER_READONLY_NOTE =
  'KiwiSaver via Akahu; synced provider data is read-only. Never scrape. Never store passwords.';

function present(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Scheme slot: stored scheme name when the provider sent one.
 * Akahu leaves `scheme_name` null, so the account name fills that slot.
 */
export function kiwiSaverSchemeLabel(source: {
  name: string | null;
  schemeName: string | null;
}): string | null {
  return present(source.schemeName) ?? present(source.name);
}

export function kiwiSaverPirLabel(pir: number | null): string | null {
  if (typeof pir !== 'number' || !Number.isFinite(pir)) return null;
  return `PIR ${pir}%`;
}

/** Parts of "[scheme] · [provider] · synced [time] · PIR [rate]", nulls dropped. */
export function kiwiSaverHeaderParts(
  source: KiwiSaverHeaderSource | null,
  formatTime: (iso: string) => string,
): KiwiSaverHeaderPart[] {
  if (!source) return [];
  const parts: KiwiSaverHeaderPart[] = [];
  const scheme = kiwiSaverSchemeLabel(source);
  if (scheme) parts.push({ kind: 'scheme', text: scheme });
  const provider = present(source.provider);
  if (provider) parts.push({ kind: 'provider', text: provider });
  const observedAt = present(source.observedAt);
  if (observedAt) {
    const formatted = formatTime(observedAt).trim();
    if (formatted && formatted !== '—') {
      parts.push({ kind: 'synced', text: `synced ${formatted}` });
    }
  }
  const pir = kiwiSaverPirLabel(source.pir);
  if (pir) parts.push({ kind: 'pir', text: pir });
  return parts;
}

export function kiwiSaverHeaderSubline(
  source: KiwiSaverHeaderSource | null,
  formatTime: (iso: string) => string,
): string {
  return kiwiSaverHeaderParts(source, formatTime)
    .map((part) => part.text)
    .join(' · ');
}

/** Same sentences the page used under the old intro, picked from real status. */
export function kiwiSaverSyncNote(input: {
  hasAkahuAccount: boolean;
  akahuConfigured: boolean | null;
}): string {
  if (input.hasAkahuAccount) {
    return 'Akahu KiwiSaver connected — auto-resync on open updates the connected provider account.';
  }
  if (input.akahuConfigured === true) {
    return 'Akahu configured — auto-resync on open updates Sharesies KS only. Bank-held schemes stay manual.';
  }
  if (input.akahuConfigured === false) {
    return 'Akahu not configured on the API server — Sharesies sync unavailable; bank-held manual/CSV still works.';
  }
  return 'Checking Akahu…';
}

/** Sync now is for an Akahu connection or an Akahu scheme, not a manual-only page. */
export function showKiwiSaverSyncButton(input: {
  hasAkahuScheme: boolean;
  akahuConnected: boolean;
}): boolean {
  return input.hasAkahuScheme || input.akahuConnected;
}

/** One scheme is shown directly. The picker is only for a choice. */
export function showKiwiSaverSchemePicker(schemeCount: number): boolean {
  return schemeCount > 1;
}
