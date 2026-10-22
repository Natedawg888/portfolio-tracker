/**
 * Calendar page helpers. Run: node --import tsx src/lib/calendarView.test.ts
 */
import type { BusinessMeeting } from '../types';
import { agenda, byDate, dayLabel, gridRange, monthGrid, newMeetingBody, reminderLabel, reminderMessage, shiftMonth, timeSpan, videoLink } from './calendarView.ts';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

// December 2026 starts on a Tuesday and has 31 days: 5 weeks, Mon 30 Nov to Sun 3 Jan.
const dec = monthGrid('2026-12');
assert(dec.length === 5 && dec.every((w) => w.length === 7), 'December 2026 is five full weeks');
assert(dec[0][0].date === '2026-11-30' && !dec[0][0].inMonth && dec[0][1].date === '2026-12-01' && dec[0][1].inMonth, 'weeks start on Monday');
assert(dec[4][6].date === '2027-01-03', 'the grid ends on a Sunday');
assert(monthGrid('2027-02').length === 4, 'February 2027 (starts Monday, 28 days) is exactly four weeks');
assert(JSON.stringify(gridRange('2026-12')) === JSON.stringify({ from: '2026-11-30', to: '2027-01-03' }), 'grid range');
assert(shiftMonth('2026-12', 1) === '2027-01' && shiftMonth('2027-01', -1) === '2026-12', 'months shift across years');

const meeting = (id: string, date: string, time: string, startsAt: string): BusinessMeeting => ({
  id, businessId: 'b', businessName: 'B', clientId: null, clientName: '', kind: 'meeting', title: id, startsAt, date, time,
  durationMinutes: 45, location: '', notes: '', status: 'scheduled', reminderOffsets: [],
});
const list = [
  meeting('late', '2026-12-01', '15:00', '2026-12-01T02:00:00.000Z'),
  meeting('early', '2026-12-01', '10:00', '2026-11-30T21:00:00.000Z'),
  meeting('before', '2026-11-20', '09:00', '2026-11-19T20:00:00.000Z'),
];
assert(byDate(list).get('2026-12-01')!.map((m) => m.id).join() === 'early,late', 'grouped by NZ date, in time order');
assert(agenda(list, '2026-11-25').map((d) => d.date).join() === '2026-12-01', 'the agenda starts at the given date');

assert(dayLabel('2026-12-01') === 'Tuesday 1 December', 'day label');
assert(timeSpan({ time: '10:00', durationMinutes: 45 }) === '10am–10:45am', 'time span');
assert(timeSpan({ time: '23:30', durationMinutes: 60 }) === '11:30pm–12:30am', 'a span past midnight');
assert(videoLink(' https://meet.example.com/x ') === 'https://meet.example.com/x' && videoLink('Level 2, 10 Queen St') === null, 'video links');
assert(videoLink('javascript:alert(1)') === null && videoLink('http://insecure.example.com') === null, 'only https links open');
assert(reminderLabel(1440) === '1 day before' && reminderLabel(60) === '1 hour before' && reminderLabel(10080) === '7 days before' && reminderLabel(15) === '15 minutes before', 'reminder labels');
assert(reminderMessage({ title: 'Review', clientName: 'Tui Ltd', offsetMinutes: 60, time: '10:00' }) === 'Review with Tui Ltd starts in 1 hour (10am).', 'reminder message');

console.log('calendar view: ok');

// New entries: a business books meetings with an optional client; personal ones have neither.
const biz = newMeetingBody({ businessId: 'b', clientId: 'c', kind: 'event', date: '2026-12-01' });
assert(biz.businessId === 'b' && biz.clientId === 'c' && biz.kind === 'meeting', 'a business entry is always a meeting');
const personal = newMeetingBody({ businessId: null, clientId: 'c', kind: 'event', date: '2026-12-01' });
assert(personal.businessId === null && personal.clientId === null && personal.kind === 'event', 'a personal entry has no client and keeps its kind');
assert(newMeetingBody({ businessId: null, date: '2026-12-01' }).kind === 'meeting', 'personal entries default to a meeting');
console.log('calendar new entries: ok');
