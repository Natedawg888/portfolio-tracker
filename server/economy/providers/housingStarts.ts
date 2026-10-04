/**
 * United States housing starts from the Census Bureau workbook.
 * Seasonally adjusted annual rate, national total. The growth rate is calculated here.
 */
import { monthRange } from '../periods.ts';
import { attachPrevious, changeOverMonths, type DatedValue, type WithPrevious } from './derive.ts';
import { fetchDownload } from './http.ts';
import { readXlsxSheets, type SheetGrid } from './xlsx.ts';

export const CENSUS_STARTS_URL = 'https://www.census.gov/construction/nrc/xls/starts_cust.xlsx';

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/** Census stores months as Excel serials. Dates after the 1900 leap bug use this epoch. */
export function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const date = new Date(EXCEL_EPOCH_MS + Math.round(serial) * 86_400_000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function parseCensusHousingStarts(grid: SheetGrid): DatedValue[] {
  let headerRow = 0;
  let valueColumn = '';
  for (const [rowNumber, row] of grid) {
    for (const [column, value] of row) {
      if (value.replace(/\s+/g, ' ').trim() !== 'United States') continue;
      const below = grid.get(rowNumber + 1)?.get(column)?.replace(/\s+/g, ' ').trim();
      if (below === 'Total') {
        headerRow = rowNumber + 1;
        valueColumn = column;
      }
    }
  }
  if (!valueColumn) {
    throw new Error('The Census housing-starts workbook has no United States total.');
  }

  const out: DatedValue[] = [];
  for (const rowNumber of [...grid.keys()].filter((row) => row > headerRow).sort((a, b) => a - b)) {
    const row = grid.get(rowNumber);
    if (!row) continue;
    const iso = excelSerialToIsoDate(Number(row.get('A')));
    const value = Number(row.get(valueColumn));
    if (!iso || !Number.isFinite(value)) continue;
    const year = Number(iso.slice(0, 4));
    const month = Number(iso.slice(5, 7));
    const range = monthRange(year, month);
    out.push({
      period: range.period,
      periodStart: range.start,
      periodEnd: range.end,
      value,
      frequency: 'monthly',
    });
  }
  return out;
}

export function housingGrowthFromLevels(levels: DatedValue[]): WithPrevious[] {
  return attachPrevious(changeOverMonths(levels, 12).filter((row) => row.period >= '2012-01'));
}

export function publishedDay(lastModified: string | null): string | null {
  if (!lastModified) return null;
  const time = Date.parse(lastModified);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}

export async function loadUsHousingGrowth(): Promise<{ rates: WithPrevious[]; publishedAt: string | null }> {
  const download = await fetchDownload(CENSUS_STARTS_URL, { timeoutMs: 30_000, maxBytes: 2_000_000 });
  const grid = readXlsxSheets(download.body).get('Seasonally Adjusted');
  if (!grid) throw new Error('The Census housing-starts workbook has no Seasonally Adjusted sheet.');
  const rates = housingGrowthFromLevels(parseCensusHousingStarts(grid));
  if (rates.length === 0) {
    throw new Error('The Census housing-starts workbook did not produce an annual percent change.');
  }
  return { rates, publishedAt: publishedDay(download.lastModified) };
}
