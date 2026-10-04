/**
 * The small consents workbook, not the regional CSV.
 * Run: npm run test:economy
 */
import { consentsWorkbookUrl, parseSaDwellingConsents } from './consents.ts';
import type { SheetGrid } from './xlsx.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function grid(rows: Array<Record<string, string>>): SheetGrid {
  const out: SheetGrid = new Map();
  rows.forEach((cells, index) => {
    out.set(index + 1, new Map(Object.entries(cells)));
  });
  return out;
}

let passed = 0;

{
  assert(
    consentsWorkbookUrl('https://example.test/building-consents-issued-august-2026.zip') ===
      'https://example.test/building-consents-issued-august-2026.xlsx',
    'workbook sits beside the zip',
  );
  passed += 1;
}

{
  const levels = parseSaDwellingConsents(
    grid([
      { D: '1100A1A', F: '1100A1S' },
      { A: '2024', C: 'Aug', D: '2881', F: '100' },
      { C: 'Sept', D: '2943', F: '110' },
      { A: 'Source: Stats NZ' },
    ]),
  );
  assert(levels.length === 2, `months ${levels.length}`);
  assert(levels[0]?.period === '2024-08' && levels[0]?.value === 100, `aug ${levels[0]?.period} ${levels[0]?.value}`);
  assert(levels[1]?.period === '2024-09' && levels[1]?.value === 110, `sept ${levels[1]?.period} ${levels[1]?.value}`);
  assert(levels[0]?.frequency === 'monthly', 'monthly');
  passed += 1;
}

{
  let threw = false;
  try {
    parseSaDwellingConsents(grid([{ A: '1100A1A', F: '999' }]));
  } catch (err) {
    threw = err instanceof Error && /1100A1S/.test(err.message);
  }
  assert(threw, 'missing seasonally adjusted series is an error, not a guessed number');
  passed += 1;
}

console.log(`${passed} consents tests passed`);
