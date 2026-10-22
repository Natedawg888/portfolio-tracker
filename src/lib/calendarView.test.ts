/**
 * Calendar page helpers. Run: node --import tsx src/lib/calendarView.test.ts
 */
import type { BusinessMeeting, EarningsEvent } from '../types';
import { durationLabel, meetingSummary, agendaDays, businessColourSlot, cellLabel, chipOverflow, earningsDateLine, earningsTiming, itemsByDate, quarterLabel, shortDayLabel, agenda, byDate, dayLabel, gridRange, layerCounts, meetingLayer, monthGrid, newMeetingBody, reminderLabel, reminderMessage, shiftMonth, timeSpan, toggleLayer, videoLink } from './calendarView.ts';

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

// Layers and their pill counts.
const entries = [
  { businessId: 'b', date: '2026-12-01' },
  { businessId: 'b', date: '2026-12-09' },
  { businessId: null, date: '2026-12-02' },
  { businessId: 'b', date: '2026-11-30' },
];
assert(meetingLayer({ businessId: 'b' }) === 'business' && meetingLayer({ businessId: null }) === 'personal', 'business and personal layers');
assert(JSON.stringify(layerCounts(entries, '2026-12', 2)) === JSON.stringify({ earnings: 2, business: 2, personal: 1 }), 'counts are for the month only');
const off = toggleLayer(new Set(['earnings', 'business', 'personal'] as const), 'business');
assert(!off.has('business') && off.has('personal') && toggleLayer(off, 'business').has('business'), 'pills toggle a layer off and on');
console.log('calendar layers: ok');

// Items, chips, earnings wording, cell labels and the agenda.
const mtg = (id: string, date: string, time: string, businessId: string | null, extra: Partial<BusinessMeeting> = {}): BusinessMeeting => ({
  id, businessId, businessName: businessId ? 'Honey Co' : '', clientId: null, clientName: '', kind: 'meeting', title: id, startsAt: `${date}T${time}:00.000Z`, date, time,
  durationMinutes: 60, location: '', notes: '', status: 'scheduled', reminderOffsets: [], ...extra,
});
const earn = (symbol: string, nzDate: string, session: EarningsEvent['session'] = 'amc'): EarningsEvent => ({ symbol, usDate: nzDate, session, nzDate, nzDateKnown: session === 'amc', quarter: 4, year: 2026 });
const allOn = new Set(['earnings', 'business', 'personal'] as const);
const days = itemsByDate([mtg('late', '2026-10-28', '15:00', 'b', { clientName: 'Tui Ltd' }), mtg('early', '2026-10-28', '09:00', null)], [earn('MSFT', '2026-10-28')], allOn);
assert(days.get('2026-10-28')!.map((i) => (i.kind === 'earnings' ? i.earnings.symbol : i.meeting.id)).join() === 'MSFT,early,late', 'earnings lead the day, meetings by time');
assert(itemsByDate([mtg('a', '2026-10-28', '09:00', 'b')], [earn('MSFT', '2026-10-28')], new Set(['personal'] as const)).size === 0, 'layers that are off are left out');
assert(JSON.stringify(chipOverflow([1, 2, 3, 4, 5])) === JSON.stringify({ shown: [1, 2, 3], more: 2 }) && chipOverflow([1, 2, 3]).more === 0, 'three chips, then +N more');
assert(businessColourSlot('biz_1') === businessColourSlot('biz_1') && businessColourSlot('biz_1') >= 0 && businessColourSlot('biz_1') < 6, 'a business keeps one colour slot');
assert(quarterLabel({ quarter: 4, year: 2026 }) === 'Q4 FY2026' && quarterLabel({ quarter: null, year: 2026 }) === null, 'quarter label only when given');
assert(/time to be confirmed/.test(earningsTiming({ session: 'amc', nzDateKnown: true })) && earningsTiming({ session: null, nzDateKnown: false }) === 'Time to be confirmed', 'a time is never claimed');
assert(earningsDateLine({ nzDate: '2026-11-03', nzDateKnown: true, usDate: '2026-11-02' }) === 'Tuesday 3 November (NZ)', 'NZ day when known');
assert(earningsDateLine({ nzDate: '2027-01-27', nzDateKnown: false, usDate: '2027-01-27' }) === 'Wednesday 27 January (US date)', 'US date when the NZ day is not known');
assert(shortDayLabel('2026-10-28') === 'Wed 28 Oct', 'short day label');
assert(cellLabel('2026-10-28', null, days.get('2026-10-28')!) === 'Wed 28 Oct, MSFT earnings call, 9am early, 3pm late with Tui Ltd', `cell label (got ${cellLabel('2026-10-28', null, days.get('2026-10-28')!)})`);
assert(cellLabel('2026-10-26', 'Labour Day', []) === 'Mon 26 Oct, Labour Day' && cellLabel('2026-10-27', null, []) === 'Tue 27 Oct, nothing on', 'holiday and empty cells');
const ag = agendaDays(days, new Map([['2026-10-26', 'Labour Day'], ['2026-10-20', 'Past']]), '2026-10-23', '2026-10-23');
assert(ag.map((d) => d.heading).join('|') === 'Mon 26 Oct|Wed 28 Oct' && ag[0].holiday === 'Labour Day', 'agenda from today on, with holidays');
assert(agendaDays(new Map([['2026-10-23', []]]), new Map(), '2026-10-23', '2026-10-23')[0].heading === 'Today · Fri 23 Oct', 'today is headed Today');
console.log('calendar items: ok');

// Booking summary line and lengths.
assert(meetingSummary('2026-10-23', '10:00', 60) === 'Fri 23 Oct, 10 am – 11 am', `summary (got ${meetingSummary('2026-10-23', '10:00', 60)})`);
assert(meetingSummary('2026-10-23', '13:30', 90) === 'Fri 23 Oct, 1:30 pm – 3 pm', 'summary with minutes');
assert(meetingSummary('2026-10-23', '23:30', 60) === 'Fri 23 Oct, 11:30 pm – 12:30 am', 'summary past midnight');
assert(['30 min', '1 hr', '1.5 hrs', '2 hrs', '45 min', '2 hr 15 min'].join() === [30, 60, 90, 120, 45, 135].map(durationLabel).join(), 'length labels');
console.log('booking summary: ok');
