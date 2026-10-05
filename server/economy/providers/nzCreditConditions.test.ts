/**
 * The C60 parser reads the series id and the date label, not column position.
 * A swapped observation field order must not show the neighbouring series.
 * Run: npm run test:economy
 */
import { archiveCaptures, NZ_CREDIT_SERIES, parseC60PublishedDay, parseNzCreditAvailability } from './nzCreditConditions.ts';
import type { SheetGrid } from './xlsx.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function serial(iso: string): string {
  const days = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);
  return String(days);
}

/**
 * Two layouts of the same observations. The series id moves to a different
 * column, and the cells are inserted in the opposite order. A parser that
 * reads a fixed column, or the first number in the row, returns the decoy.
 */
function grid(layout: 'series-last' | 'series-first'): SheetGrid {
  if (layout === 'series-last') {
    return new Map([
      [5, new Map<string, string>([['D', 'Series Id'], ['C', 'CCS.Q73_AV'], ['B', NZ_CREDIT_SERIES]])],
      [9, new Map<string, string>([['D', serial('2024-09-30')], ['C', '80'], ['B', '2.5']])],
      [6, new Map<string, string>([['D', serial('2026-03-31')], ['C', '999.5'], ['B', '-4.25']])],
    ]);
  }
  return new Map([
    [5, new Map<string, string>([['C', NZ_CREDIT_SERIES], ['B', 'CCS.Q73_AV'], ['A', 'Series Id']])],
    [6, new Map<string, string>([['C', '-4.25'], ['B', '999.5'], ['A', serial('2026-03-31')]])],
    [9, new Map<string, string>([['C', '2.5'], ['B', '80'], ['A', serial('2024-09-30')]])],
  ]);
}

let passed = 0;

for (const layout of ['series-last', 'series-first'] as const) {
  const rows = parseNzCreditAvailability(grid(layout), NZ_CREDIT_SERIES);
  assert(rows.length === 2, `${layout} kept both quarters, got ${rows.length}`);
  const older = rows.find((row) => row.period === '2024-Q3');
  const newer = rows.find((row) => row.period === '2026-Q1');
  assert(older?.value === 2.5, `${layout} 2024-Q3 should be 2.5, not the decoy 80, got ${older?.value}`);
  assert(newer?.value === -4.25, `${layout} 2026-Q1 should be -4.25, not the decoy 999.5, got ${newer?.value}`);
  assert(newer?.frequency === 'quarterly' && newer.periodEnd === '2026-03-31', `${layout} quarter end`);
  passed += 1;
}

{
  let threw = false;
  try {
    parseNzCreditAvailability(
      new Map([[5, new Map([['A', 'Series Id'], ['B', 'CCS.Q73_AV']])]]),
      NZ_CREDIT_SERIES,
    );
  } catch (err) {
    threw = err instanceof Error && err.message.includes(NZ_CREDIT_SERIES);
  }
  assert(threw, 'a workbook without the corporate availability series is an error');
  passed += 1;
}

{
  const published = parseC60PublishedDay(
    new Map([[4, new Map([['B', '46136'], ['A', 'Published Date']])]]),
  );
  const swapped = parseC60PublishedDay(
    new Map([[4, new Map([['A', '46136'], ['B', 'Published Date']])]]),
  );
  assert(published === '2026-04-24', `published day ${published}`);
  assert(swapped === '2026-04-24', `swapped published day ${swapped}`);
  passed += 1;
}

{
  const file = 'hc60.xlsx';
  const original = `https://www.rbnz.govt.nz/-/media/project/sites/rbnz/files/statistics/series/c/c60/${file}`;
  const decoy = 'https://example.test/other.xlsx';
  const normal = archiveCaptures(
    [
      ['timestamp', 'original'],
      ['20261002043352', original],
      ['20240519062001', decoy],
    ],
    file,
  );
  const reversed = archiveCaptures(
    [
      ['original', 'timestamp'],
      [original, '20261002043352'],
      [decoy, '20260101000000'],
    ],
    file,
  );
  assert(normal.length === 1 && normal[0]?.timestamp === '20261002043352', 'keeps the C60 capture');
  assert(reversed.length === 1 && reversed[0]?.original === original, 'column order does not pair the decoy URL');
  assert(reversed[0]?.timestamp === '20261002043352', `reversed timestamp ${reversed[0]?.timestamp}`);
  passed += 1;
}

console.log(`${passed} NZ credit-conditions tests passed`);
