/**
 * NZ wall-clock time ↔ UTC across both daylight saving changes.
 * Run: node --import tsx src/lib/nzTime.test.ts
 */
import { addDays, formatTime12, isTimeZone, localDateRangeUtc, localToUtc, utcToLocal } from './nzTime.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function utcOf(date: string, time: string, tz?: string): string | null {
  const r = localToUtc(date, time, tz);
  return r.ok ? new Date(r.utcMs).toISOString() : null;
}

// NZST (+12) in winter, NZDT (+13) in summer.
const cases: [string, string, string][] = [
  ['2026-07-15', '09:00', '2026-07-14T21:00:00.000Z'],
  ['2026-12-15', '09:00', '2026-12-14T20:00:00.000Z'],
  // 2026 spring forward: Sun 27 Sep, 2:00am NZST becomes 3:00am NZDT.
  ['2026-09-27', '01:59', '2026-09-26T13:59:00.000Z'],
  ['2026-09-27', '03:00', '2026-09-26T14:00:00.000Z'],
  // 2027 fall back: Sun 4 Apr, 3:00am NZDT becomes 2:00am NZST.
  ['2027-04-04', '01:59', '2027-04-03T12:59:00.000Z'],
  ['2027-04-04', '03:00', '2027-04-03T15:00:00.000Z'],
];
for (const [date, time, iso] of cases) {
  assert(utcOf(date, time) === iso, `${date} ${time} NZ is ${iso} (got ${utcOf(date, time)})`);
}

const gap = localToUtc('2026-09-27', '02:30');
assert(!gap.ok && gap.reason === 'nonexistent', '2:30am on the spring-forward day does not exist and is refused');
assert(!localToUtc('2026-09-27', '02:00').ok, '2:00am on the spring-forward day is refused too');

// 2:30am on the fall-back day happens at 13:30Z (NZDT) and again at 14:30Z (NZST); the first wins.
assert(utcOf('2027-04-04', '02:30') === '2027-04-03T13:30:00.000Z', 'an ambiguous time is the first (daylight) one');

for (const [, , iso] of cases) {
  const back = utcToLocal(Date.parse(iso));
  assert(utcOf(back.date, back.time) === iso, `round trip of ${iso}`);
}
const second = utcToLocal(Date.parse('2027-04-03T14:30:00.000Z'));
assert(second.date === '2027-04-04' && second.time === '02:30', 'the repeated hour still shows as 2:30am');

assert(!localToUtc('2026-02-30', '09:00').ok, 'a date that does not exist is invalid');
assert(!localToUtc('2026-07-15', '24:00').ok, '24:00 is invalid');
assert(!localToUtc('2026-7-15', '9:00').ok, 'loose formats are invalid');

assert(utcOf('2026-07-15', '09:00', 'Australia/Sydney') === '2026-07-14T23:00:00.000Z', 'another zone works');
assert(isTimeZone('Pacific/Auckland') && !isTimeZone('Mars/Olympus'), 'time zones are checked');

const day = localDateRangeUtc('2026-09-27', '2026-09-27');
assert(day.endMs - day.startMs === 23 * 3_600_000, 'the spring-forward day is 23 hours long');
const autumn = localDateRangeUtc('2027-04-04', '2027-04-04');
assert(autumn.endMs - autumn.startMs === 25 * 3_600_000, 'the fall-back day is 25 hours long');

assert(addDays('2026-12-31', 1) === '2027-01-01' && addDays('2026-03-01', -1) === '2026-02-28', 'addDays crosses months');
assert(formatTime12('14:30') === '2:30pm' && formatTime12('00:00') === '12am' && formatTime12('12:05') === '12:05pm', 'times read as 2:30pm');

console.log('nz time tests passed');
