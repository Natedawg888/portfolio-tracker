/**
 * Category colours. A colour saved on the category (Manage categories) wins;
 * otherwise the palette is used in spend order, as the spend chart always has.
 */
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
