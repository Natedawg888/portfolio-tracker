/**
 * Holding value helpers shared by the Portfolio page and the net-worth calculation.
 */

/**
 * True when a price_quotes row holds an Akahu *total* for a position with no
 * share count, rather than a price per unit. Older syncs wrote these under the
 * shared STOCK:/CRYPTO: key; they must never be multiplied by a quantity.
 */
export function isTotalNotUnitQuote(notes: string | null | undefined): boolean {
  return Boolean(notes && /quantity unknown|price holds total/i.test(notes));
}

/**
 * Parse NZD market value from Akahu / holding notes.
 * Only accepts an explicit NZD figure — never treats USD/other as NZD.
 */
export function parseNzdValueFromNotes(notes?: string | null): number | null {
  if (!notes) return null;
  // Prefer explicit FX conversion: "44.78 USD → 79.33 NZD @ rate"
  const arrow = notes.match(/→\s*([\d.]+)\s*NZD\b/i);
  if (arrow) {
    const n = Number(arrow[1]);
    return Number.isFinite(n) ? n : null;
  }
  // Reject notes that only carry a non-NZD value (e.g. "11.89 USD (no FX applied)")
  if (/\b(?:USD|AUD|EUR|GBP)\b/i.test(notes) && /\bno FX\b|\bFX unavailable\b/i.test(notes)) {
    return null;
  }
  const nzdMatch = notes.match(
    /(?:Akahu\s+(?:market\s+)?value[:\s]*|Akahu\s+portfolio\s+value\s+|Akahu\s+total\s+value\s+|value\s+)([\d.]+)\s*NZD\b/i,
  );
  if (nzdMatch) {
    const n = Number(nzdMatch[1]);
    return Number.isFinite(n) ? n : null;
  }
  // Broader: any "NUMBER NZD" in notes
  const anyNzd = notes.match(/\b([\d.]+)\s*NZD\b/i);
  if (anyNzd) {
    const n = Number(anyNzd[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * True when a quantity is recorded and is 0 (a sold position). A missing
 * quantity means unknown, not sold: manual stocks can be saved with a cost only.
 */
export function isClosedQuantity(quantity: unknown): boolean {
  return quantity != null && quantity !== '' && !(Number(quantity) > 0);
}
