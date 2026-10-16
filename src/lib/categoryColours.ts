/**
 * Category colours. A colour saved on the category (Manage categories) wins;
 * otherwise "Auto" gives it a palette colour by its place in the category list (categoryColourFor).
 */
import { normalizeCategoryType } from './categoryTypes';

export const CATEGORY_PALETTE = [
  '#3d9a6a',
  '#4a8fd4',
  '#c47a2c',
  '#9a6ad4',
  '#d45a7a',
  '#5ab8a0',
  '#d4b84a',
  '#6a8fd4',
  '#a07050',
  '#70a0c0',
] as const;

export const UNCATEGORISED_COLOUR = '#6a7585';

/** Accepts #rgb / #rrggbb only, so a stored value can't inject other CSS. */
export function validColour(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : null;
}

export function categoryColour(stored: string | null | undefined, paletteIndex: number): string {
  return validColour(stored) ?? CATEGORY_PALETTE[((paletteIndex % CATEGORY_PALETTE.length) + CATEGORY_PALETTE.length) % CATEGORY_PALETTE.length];
}

/** Plain names for the palette, in the same order (colour pickers and screen readers). */
export const CATEGORY_PALETTE_NAMES: Record<(typeof CATEGORY_PALETTE)[number], string> = {
  '#3d9a6a': 'Green',
  '#4a8fd4': 'Blue',
  '#c47a2c': 'Orange',
  '#9a6ad4': 'Purple',
  '#d45a7a': 'Pink',
  '#5ab8a0': 'Teal',
  '#d4b84a': 'Mustard',
  '#6a8fd4': 'Periwinkle',
  '#a07050': 'Brown',
  '#70a0c0': 'Steel blue',
};

/** The palette name for a saved colour, or null for a custom one. */
export function paletteName(colour: string | null | undefined): string | null {
  const v = validColour(colour)?.toLowerCase();
  return v ? ((CATEGORY_PALETTE_NAMES as Record<string, string>)[v] ?? null) : null;
}

type ColourCategory = { id: string; colour?: string | null; type?: unknown; isIncome?: boolean | number | null; sortOrder?: number | null };

/**
 * The colour a category shows everywhere (Settings swatch, spend chart, Budget plans): its saved
 * colour, or for "Auto" the palette colour at its place among categories of the same type,
 * ordered by sort order then id (ids don't change on rename). It stays put from month to month
 * and through renames; adding or deleting a category of the same type can shift it.
 */
export function categoryColourFor(categories: readonly ColourCategory[], id: string): string {
  const own = categories.find((c) => c.id === id);
  const saved = validColour(own?.colour);
  if (saved) return saved;
  if (!own) return UNCATEGORISED_COLOUR;
  const type = normalizeCategoryType(own.type, own.isIncome);
  const sameType = categories
    .filter((c) => normalizeCategoryType(c.type, c.isIncome) === type)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return categoryColour(null, sameType.indexOf(own));
}
