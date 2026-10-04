/**
 * Census housing-starts workbook: national seasonally adjusted total, then an annual percent change.
 * Run: npm run test:economy
 */
import { housingGrowthFromLevels, excelSerialToIsoDate, parseCensusHousingStarts, publishedDay } from './housingStarts.ts';
import type { SheetGrid } from './xlsx.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

let passed = 0;

{
  assert(excelSerialToIsoDate(21551) === '1959-01-01', `excel epoch ${excelSerialToIsoDate(21551)}`);
  assert(excelSerialToIsoDate(1) === null, 'rejects serials outside the housing history');
  assert(publishedDay('Thu, 24 Sep 2026 12:46:38 GMT') === '2026-09-24', 'last-modified day');
  assert(publishedDay(null) === null, 'missing last-modified');
  passed += 1;
}

{
  const grid: SheetGrid = new Map();
  grid.set(5, new Map([['A', 'Month'], ['B', 'United States']]));
  grid.set(6, new Map([['B', 'Total'], ['C', '1 unit']]));
  for (let index = 0; index < 13; index += 1) {
    const month = index + 1;
    const year = 2023 + Math.floor((month - 1) / 12);
    const mm = ((month - 1) % 12) + 1;
    const iso = `${year}-${String(mm).padStart(2, '0')}-01`;
    const serial = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);
    grid.set(7 + index, new Map([['A', String(serial)], ['B', String(1000 + index * 10)], ['C', '(NA)']]));
  }
  grid.set(20, new Map([['A', 'Footnotes:']]));
  const levels = parseCensusHousingStarts(grid);
  assert(levels.length === 13, `levels ${levels.length}`);
  assert(levels[0]?.period === '2023-01', `first ${levels[0]?.period}`);
  assert(levels[0]?.value === 1000, 'uses the United States total, not another column');
  const rates = housingGrowthFromLevels(levels);
  assert(rates.length === 1, `rates ${rates.length}`);
  assert(rates[0]?.period === '2024-01', `rate period ${rates[0]?.period}`);
  assert(rates[0]?.value === 12, `12 percent from 1000 to 1120, got ${rates[0]?.value}`);
  passed += 1;
}

{
  let threw = false;
  try {
    parseCensusHousingStarts(new Map([[1, new Map([['A', 'no total']])]]));
  } catch (err) {
    threw = err instanceof Error && /United States total/.test(err.message);
  }
  assert(threw, 'a workbook without the national total is an error');
  passed += 1;
}

console.log(`${passed} housing-starts tests passed`);
