/**
 * Precious-metal unit helpers for Value Search display.
 * Canonical spot is always NZD per troy ounce; grams use the exact conventional factor.
 * Never invents prices — only converts a known NZD/oz_t.
 */

export type MetalDisplayUnit = 'oz_t' | 'g';

/** Grams per troy ounce (exact conventional factor). */
export const TROY_OZ_GRAMS = 31.1034768;

const STORAGE_KEY = 'valueSearch.metalDisplayUnit';

export function nzdPerOzToDisplay(
  nzdPerOzT: number | null | undefined,
  unit: MetalDisplayUnit,
): number | null {
  if (nzdPerOzT == null || !Number.isFinite(nzdPerOzT)) return null;
  return unit === 'oz_t' ? nzdPerOzT : nzdPerOzT / TROY_OZ_GRAMS;
}

export function metalUnitLabel(unit: MetalDisplayUnit): string {
  return unit === 'oz_t' ? 'NZD / oz t' : 'NZD / g';
}

export function loadMetalDisplayUnit(): MetalDisplayUnit {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'g' || v === 'oz_t') return v;
  } catch {
    /* ignore */
  }
  return 'oz_t';
}

export function saveMetalDisplayUnit(unit: MetalDisplayUnit): void {
  try {
    localStorage.setItem(STORAGE_KEY, unit);
  } catch {
    /* ignore */
  }
}
