/**
 * Derived rates stay on the official periods and skip gaps.
 * Run: npm run test:economy
 */
import { changeOverMonths, subtractSeries, type DatedValue } from './derive.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function month(period: string, value: number): DatedValue {
  const [year, mm] = period.split('-');
  const endDay = new Date(Date.UTC(Number(year), Number(mm), 0)).getUTCDate();
  return {
    period,
    periodStart: `${period}-01`,
    periodEnd: `${period}-${String(endDay).padStart(2, '0')}`,
    value,
    frequency: 'monthly',
  };
}

let passed = 0;

{
  const rates = changeOverMonths(
    [month('2024-08', 110), month('2024-05', 100), month('2024-07', 108)],
    3,
  );
  assert(rates.length === 1, `expected one 3-month change, got ${rates.length}`);
  assert(rates[0]?.period === '2024-08', `period ${rates[0]?.period}`);
  assert(rates[0]?.value === 10, `value ${rates[0]?.value}`);
  passed += 1;
}

{
  const spread = subtractSeries(
    [month('2024-08', 4.5), month('2024-07', 4.2)],
    [month('2024-08', 3.0)],
  );
  assert(spread.length === 1, `spread count ${spread.length}`);
  assert(spread[0]?.value === 1.5, `spread ${spread[0]?.value}`);
  passed += 1;
}

console.log(`${passed} derive tests passed`);
