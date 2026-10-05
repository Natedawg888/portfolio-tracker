/**
 * Shared wording for whether NZD metal spots are available.
 * Status follows stored quotes, not whether the user holds any metal.
 */
import type { MetalKind, QuoteResult } from '../../src/types/index.ts';
import { METAL_KINDS } from './metals.ts';

export type MetalSpotStatus = 'ok' | 'stale' | 'unavailable';
export type MetalSpotSource = 'gold-api' | 'metals_dev';

export function summarizeStoredMetalSpots(
  spots: Partial<Record<MetalKind, QuoteResult>> | null,
): { status: MetalSpotStatus; source: MetalSpotSource | null } {
  if (!spots) return { status: 'unavailable', source: null };
  const rows = METAL_KINDS.map((metal) => spots[metal]).filter((row): row is QuoteResult => row != null);
  if (rows.length !== METAL_KINDS.length) return { status: 'unavailable', source: null };
  const usable = rows.every(
    (row) =>
      (row.status === 'ok' || row.status === 'stale') &&
      row.price != null &&
      Number.isFinite(row.price) &&
      row.price > 0,
  );
  if (!usable) return { status: 'unavailable', source: null };
  const source: MetalSpotSource = rows.every((row) => row.source === 'metals_dev')
    ? 'metals_dev'
    : 'gold-api';
  const status: MetalSpotStatus = rows.some((row) => row.status === 'stale') ? 'stale' : 'ok';
  return { status, source };
}

/** Sentence used on Dashboard and Portfolio. Names the provider that actually supplied the spots. */
export function metalSpotQuoteNote(input: {
  configured: boolean;
  status: MetalSpotStatus;
  source: MetalSpotSource | null;
}): string {
  const dev = input.source === 'metals_dev' || (input.source == null && input.configured);
  if (input.status === 'ok' || input.status === 'stale') {
    if (dev) {
      return input.status === 'stale'
        ? 'Metals use last-good Metals.Dev spot NZD. Other live marks still stubbed (cost / manual). Never invented.'
        : 'Metals use Metals.Dev spot NZD; other live marks still stubbed (cost / manual). Never invented.';
    }
    return input.status === 'stale'
      ? 'Metals use cached gold-api.com spot NZD (no API key). Other live marks still stubbed (cost / manual). Never invented.'
      : 'Metals use gold-api.com spot NZD (no API key). Other live marks still stubbed (cost / manual). Never invented.';
  }
  if (input.configured) {
    return 'Metals key set but no fresh spot yet — open Portfolio or Value search and Refresh. Other marks stubbed. Never invented.';
  }
  return 'Metal spots unavailable from gold-api.com — totals use cost / manual. Never invented.';
}
