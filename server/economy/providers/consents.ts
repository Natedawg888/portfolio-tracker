/**
 * National new-dwelling consents from the small Stats NZ monthly workbook.
 * The full consents CSV is a large regional extract and is not downloaded.
 */
import { monthRange } from '../periods.ts';
import { attachPrevious, changeOverMonths, type DatedValue, type WithPrevious } from './derive.ts';
import { fetchBuffer } from './http.ts';
import type { CatalogDoc } from './statsNz.ts';
import { readXlsxSheets, sheetWithCell, type SheetGrid } from './xlsx.ts';

/** Seasonally adjusted number of new dwellings consented, New Zealand, all dwellings. */
export const NZ_SA_DWELLINGS_CODE = '1100A1S';

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/** The catalogue lists the large CSV zip. The workbook sits beside it. */
export function consentsWorkbookUrl(csvZipUrl: string): string {
  return csvZipUrl.replace(/\.zip$/i, '.xlsx');
}

export function parseSaDwellingConsents(grid: SheetGrid): DatedValue[] {
  let codeColumn = '';
  let codeRow = 0;
  for (const [rowNumber, row] of grid) {
    for (const [column, value] of row) {
      if (value === NZ_SA_DWELLINGS_CODE) {
        codeColumn = column;
        codeRow = rowNumber;
      }
    }
  }
  if (!codeColumn) {
    throw new Error(`The building-consents workbook has no ${NZ_SA_DWELLINGS_CODE} series.`);
  }

  const out: DatedValue[] = [];
  let year: number | null = null;
  const rows = [...grid.keys()].filter((row) => row > codeRow).sort((a, b) => a - b);
  for (const rowNumber of rows) {
    const row = grid.get(rowNumber);
    if (!row) continue;
    const yearCell = row.get('A');
    if (yearCell && /^\d{4}$/.test(yearCell)) year = Number(yearCell);
    let month: number | null = null;
    for (const [column, value] of row) {
      if (column === codeColumn) continue;
      const found = MONTHS[value.toLowerCase()];
      if (found) month = found;
    }
    const count = Number(row.get(codeColumn));
    if (!year || !month || !Number.isFinite(count)) continue;
    const range = monthRange(year, month);
    out.push({
      period: range.period,
      periodStart: range.start,
      periodEnd: range.end,
      value: count,
      frequency: 'monthly',
    });
  }
  return out;
}

export async function loadNzHousingGrowth(doc: CatalogDoc): Promise<WithPrevious[]> {
  const url = consentsWorkbookUrl(doc.url);
  const bytes = await fetchBuffer(url, { timeoutMs: 30_000, maxBytes: 2_000_000 });
  const grid = sheetWithCell(readXlsxSheets(bytes), NZ_SA_DWELLINGS_CODE);
  if (!grid) throw new Error(`The building-consents workbook has no ${NZ_SA_DWELLINGS_CODE} series.`);
  const levels = parseSaDwellingConsents(grid);
  const rates = changeOverMonths(levels, 12);
  if (rates.length === 0) {
    throw new Error('The building-consents workbook does not include a year of seasonally adjusted counts.');
  }
  return attachPrevious(rates);
}
