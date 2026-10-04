/**
 * Period alignment. Run: npm run test:economy
 */
import {
  latestAsOf,
  latestCompletedQuarter,
  listQuarters,
  periodFromOecd,
  periodFromStatsNz,
  titleRecencyKey,
} from './periods.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

let passed = 0;

{
  const gdp = periodFromStatsNz('2026.06', 'quarterly');
  assert(gdp?.period === '2026-Q2', `gdp period ${gdp?.period}`);
  assert(gdp?.start === '2026-04-01', `start ${gdp?.start}`);
  assert(gdp?.end === '2026-06-30', `end ${gdp?.end}`);
  assert(periodFromStatsNz('2026.05', 'quarterly') === null, 'May is not a quarter end');
  const jobs = periodFromStatsNz('2026.08', 'monthly');
  assert(jobs?.period === '2026-08', `jobs ${jobs?.period}`);
  assert(jobs?.end === '2026-08-31', `jobs end ${jobs?.end}`);
  passed += 1;
}

{
  assert(periodFromOecd('2026-Q2')?.period === '2026-Q2', 'oecd quarter');
  assert(periodFromOecd('2026-08')?.end === '2026-08-31', 'oecd month');
  passed += 1;
}

{
  const asOf = latestCompletedQuarter(new Date('2026-10-04T12:00:00+13:00'));
  assert(asOf === '2026-Q3', `completed quarter ${asOf}`);
  const onQuarterEnd = latestCompletedQuarter(new Date('2026-06-30T12:00:00+12:00'));
  assert(onQuarterEnd === '2026-Q2', `quarter end day ${onQuarterEnd}`);
  const justAfter = latestCompletedQuarter(new Date('2026-07-01T12:00:00+12:00'));
  assert(justAfter === '2026-Q2', `day after quarter end ${justAfter}`);
  passed += 1;
}

{
  const rows = [
    { id: 'old', periodEnd: '2024-03-31' },
    { id: 'mid', periodEnd: '2024-06-30' },
    { id: 'future', periodEnd: '2024-09-30' },
  ];
  const picked = latestAsOf(rows, '2024-06-30');
  assert(picked?.id === 'mid', `as-of picked ${picked?.id}`);
  passed += 1;
}

{
  const quarters = listQuarters('2024-Q3', '2025-Q2');
  assert(quarters.join(',') === '2024-Q3,2024-Q4,2025-Q1,2025-Q2', quarters.join(','));
  assert(titleRecencyKey('Retail trade survey: June 2026 quarter') > titleRecencyKey('Retail trade survey: March 2025'), 'june 2026 is later');
  passed += 1;
}

console.log(`${passed} period tests passed`);
