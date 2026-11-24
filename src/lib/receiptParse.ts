/**
 * Receipt text → merchant, date and total (KAN-60). Works on the plain text OCR returns, so it's
 * pure and testable. NZ receipts: dates are day-first; the total is the line saying TOTAL /
 * AMOUNT DUE / BALANCE DUE / EFTPOS / PAID (never SUBTOTAL, GST or CHANGE), else the largest
 * amount. Anything it can't find is null, never guessed.
 */

export type ParsedReceipt = { merchant: string | null; date: string | null; amountNzd: number | null };

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** Money values in a line, e.g. "$1,234.50" or "12.99" (needs two decimals so codes aren't read as money). */
export function moneyIn(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(/(?:NZ)?\$?\s?(-?\d{1,3}(?:,\d{3})*|\d+)[.,](\d{2})(?!\d)/g)) {
    const n = Number(`${m[1].replace(/,/g, '')}.${m[2]}`);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

const valid = (y: number, m: number, d: number) => {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
};

/** The first date on the receipt (YYYY-MM-DD), day-first. */
export function findDate(text: string): string | null {
  const iso = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(text);
  if (iso) {
    const v = valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (v) return v;
  }
  const dmy = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(text);
  if (dmy) {
    const y = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    const v = valid(y, Number(dmy[2]), Number(dmy[1]));
    if (v) return v;
  }
  const named = /\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?[\s,-]+(\d{2,4})\b/i.exec(text);
  if (named) {
    const y = named[3].length === 2 ? 2000 + Number(named[3]) : Number(named[3]);
    const v = valid(y, MONTHS[named[2].toLowerCase()], Number(named[1]));
    if (v) return v;
  }
  return null;
}

const TOTAL_WORDS = /\b(total|amount due|balance due|eftpos|paid|card|visa|mastercard|amount)\b/i;
const NOT_TOTAL = /\b(sub\s*-?total|gst|tax|change|cash\s*out|rounding|discount|saving|points)\b/i;

/** The amount paid. */
export function findTotal(lines: string[]): number | null {
  let best: number | null = null;
  for (const line of lines) {
    if (!TOTAL_WORDS.test(line) || NOT_TOTAL.test(line)) continue;
    const vals = moneyIn(line).filter((n) => n > 0);
    if (vals.length) best = vals[vals.length - 1];
    if (/\btotal\b/i.test(line) && vals.length) return vals[vals.length - 1];
  }
  if (best != null) return best;
  const all = lines.flatMap(moneyIn).filter((n) => n > 0);
  return all.length ? Math.max(...all) : null;
}

const NOT_MERCHANT = /\b(tax invoice|invoice|receipt|gst|ird|welcome|thank|phone|ph:|tel|www\.|https?:|\.co\.nz|\.com|abn|nzbn|store\s*#?\d|date|time|till|operator|cashier)\b/i;

/** The merchant: the first line near the top that's mostly letters and isn't boilerplate. */
export function findMerchant(lines: string[]): string | null {
  for (const raw of lines.slice(0, 8)) {
    const line = raw.replace(/[|_*=~#]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (line.length < 3 || NOT_MERCHANT.test(line)) continue;
    const letters = (line.match(/[A-Za-z]/g) ?? []).length;
    if (letters < 3 || letters / line.length < 0.6 || moneyIn(line).length) continue;
    return line.slice(0, 80).replace(/\b([A-Z])([A-Z]+)\b/g, (_, a: string, b: string) => a + b.toLowerCase());
  }
  return null;
}

export function parseReceipt(text: string): ParsedReceipt {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return { merchant: findMerchant(lines), date: findDate(text), amountNzd: findTotal(lines) };
}
