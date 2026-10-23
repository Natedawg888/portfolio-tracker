/**
 * Calendar page helpers: the month grid (weeks start on Monday, as in NZ), meetings grouped by
 * their NZ date, the agenda list, and the words the page uses for reminders and links.
 */
import type { BusinessMeeting, EarningsEvent, MeetingKind, MeetingWriteBody } from '../types';
import { addDays, formatTime12 } from './nzTime.ts';

export type CalendarDay = { date: string; inMonth: boolean };

/** 'YYYY-MM' → whole weeks (Mon–Sun) covering the month. */
export function monthGrid(month: string): CalendarDay[][] {
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const start = addDays(first, -weekday);
  const cells = Math.ceil((weekday + daysInMonth) / 7) * 7;
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < cells; i++) {
    const date = addDays(start, i);
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push({ date, inMonth: date.startsWith(month) });
  }
  return weeks;
}

/** The dates the grid shows, for the calendar request. */
export function gridRange(month: string): { from: string; to: string } {
  const weeks = monthGrid(month);
  return { from: weeks[0][0].date, to: weeks[weeks.length - 1][6].date };
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function byDate(meetings: BusinessMeeting[]): Map<string, BusinessMeeting[]> {
  const map = new Map<string, BusinessMeeting[]>();
  for (const m of [...meetings].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    map.set(m.date, [...(map.get(m.date) ?? []), m]);
  }
  return map;
}

/** Agenda: days that have meetings, in order, from `from` on. */
export function agenda(meetings: BusinessMeeting[], from: string): { date: string; meetings: BusinessMeeting[] }[] {
  return [...byDate(meetings)].filter(([date]) => date >= from).sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({ date, meetings: list }));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** 'Tuesday 1 December' */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return `${DAYS[weekday]} ${d} ${MONTHS[m - 1]}`;
}

/** '10am–10:45am' */
export function timeSpan(m: Pick<BusinessMeeting, 'time' | 'durationMinutes'>): string {
  const [h, min] = m.time.split(':').map(Number);
  const end = (h * 60 + min + m.durationMinutes) % 1440;
  return `${formatTime12(m.time)}–${formatTime12(`${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`)}`;
}

/** A location that is a web address opens as a link (a video call); anything else is a place. */
export function videoLink(location: string): string | null {
  return /^https:\/\/\S+$/i.test(location.trim()) ? location.trim() : null;
}

/** 1440 → '1 day before', 60 → '1 hour before', 90 → '90 minutes before'. */
export function reminderLabel(offsetMinutes: number): string {
  if (offsetMinutes % 1440 === 0) return `${offsetMinutes / 1440} day${offsetMinutes === 1440 ? '' : 's'} before`;
  if (offsetMinutes % 60 === 0) return `${offsetMinutes / 60} hour${offsetMinutes === 60 ? '' : 's'} before`;
  return `${offsetMinutes} minutes before`;
}

export const REMINDER_CHOICES = [10080, 1440, 120, 60, 15];

/** The toast for a due reminder: 'Quarterly review with Tui Ltd starts in 1 hour (10am).' */
export function reminderMessage(r: { title: string; clientName: string; offsetMinutes: number; time: string }): string {
  const when = reminderLabel(r.offsetMinutes).replace(/ before$/, '');
  return `${r.title}${r.clientName ? ` with ${r.clientName}` : ''} starts in ${when} (${formatTime12(r.time)}).`;
}

export function meetingBody(m: BusinessMeeting): MeetingWriteBody {
  return {
    businessId: m.businessId,
    clientId: m.clientId,
    kind: m.kind,
    title: m.title,
    date: m.date,
    time: m.time,
    durationMinutes: m.durationMinutes,
    location: m.location,
    notes: m.notes,
    reminderOffsets: m.reminderOffsets,
  };
}

/** A business meeting when businessId is given; otherwise a personal meeting or event. */
export function newMeetingBody(o: { businessId: string | null; clientId?: string | null; kind?: MeetingKind; date: string; title?: string }): MeetingWriteBody {
  return {
    businessId: o.businessId,
    clientId: o.businessId ? (o.clientId ?? null) : null,
    kind: o.businessId ? 'meeting' : (o.kind ?? 'meeting'),
    title: o.title ?? '',
    date: o.date,
    time: '10:00',
    durationMinutes: 60,
    location: '',
    notes: '',
    reminderOffsets: [1440, 60],
  };
}

/**
 * Calendar layers, each toggled by a filter pill: earnings calls for holdings, client meetings
 * from businesses, and the user's own meetings and events. Each has its own icon so the layers
 * differ by shape as well as colour.
 */
export type CalendarLayer = 'earnings' | 'business' | 'personal';
export const CALENDAR_LAYERS: { id: CalendarLayer; label: string; icon: string }[] = [
  { id: 'earnings', label: 'Earnings calls', icon: '📈' },
  { id: 'business', label: 'Client meetings', icon: '●' },
  { id: 'personal', label: 'My meetings & events', icon: '◆' },
];

export function meetingLayer(m: Pick<BusinessMeeting, 'businessId'>): CalendarLayer {
  return m.businessId ? 'business' : 'personal';
}

/** Meetings in the month (not the grid's spill-over days), counted per layer. */
export function layerCounts(meetings: Pick<BusinessMeeting, 'businessId' | 'date'>[], month: string, earnings = 0): Record<CalendarLayer, number> {
  const counts: Record<CalendarLayer, number> = { earnings, business: 0, personal: 0 };
  for (const m of meetings) if (m.date.startsWith(month)) counts[meetingLayer(m)]++;
  return counts;
}

export function toggleLayer(on: ReadonlySet<CalendarLayer>, layer: CalendarLayer): Set<CalendarLayer> {
  const next = new Set(on);
  if (next.has(layer)) next.delete(layer);
  else next.add(layer);
  return next;
}

const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Wed 28 Oct' */
export function shortDayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return `${SHORT_DAYS[weekday]} ${d} ${SHORT_MONTHS[m - 1]}`;
}

/** One thing on a calendar day: a meeting (business or personal) or an earnings report. */
export type CalendarItem = { kind: 'meeting'; key: string; meeting: BusinessMeeting } | { kind: 'earnings'; key: string; earnings: EarningsEvent };

export function itemLayer(item: CalendarItem): CalendarLayer {
  return item.kind === 'earnings' ? 'earnings' : meetingLayer(item.meeting);
}

export function itemDate(item: CalendarItem): string {
  return item.kind === 'earnings' ? item.earnings.nzDate : item.meeting.date;
}

/**
 * Each day's items in the shown layers. Earnings reports have no time, so they lead the day;
 * meetings follow by start time.
 */
export function itemsByDate(meetings: BusinessMeeting[], earnings: EarningsEvent[], layers: ReadonlySet<CalendarLayer>): Map<string, CalendarItem[]> {
  const items: CalendarItem[] = [
    ...earnings.map((e): CalendarItem => ({ kind: 'earnings', key: `e:${e.symbol}:${e.usDate}`, earnings: e })),
    ...meetings.map((m): CalendarItem => ({ kind: 'meeting', key: `m:${m.id}`, meeting: m })),
  ].filter((i) => layers.has(itemLayer(i)));
  const rank = (i: CalendarItem) => (i.kind === 'earnings' ? `0${i.earnings.symbol}` : `1${i.meeting.startsAt}`);
  const map = new Map<string, CalendarItem[]>();
  for (const i of items.sort((a, b) => itemDate(a).localeCompare(itemDate(b)) || rank(a).localeCompare(rank(b)))) {
    map.set(itemDate(i), [...(map.get(itemDate(i)) ?? []), i]);
  }
  return map;
}

/** At most `max` chips in a day cell; the rest are "+N more". */
export function chipOverflow<T>(items: T[], max = 3): { shown: T[]; more: number } {
  return items.length <= max ? { shown: items, more: 0 } : { shown: items.slice(0, max), more: items.length - max };
}

/** A stable colour slot (0–5) per business, from its id, so a business keeps its colour. */
export function businessColourSlot(businessId: string): number {
  let h = 0;
  for (const ch of businessId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 6;
}

/** 'Q4 FY2026' (Finnhub's quarter and fiscal year), or null when it doesn't give them. */
export function quarterLabel(e: Pick<EarningsEvent, 'quarter' | 'year'>): string | null {
  if (e.quarter == null) return null;
  return `Q${e.quarter}${e.year != null ? ` FY${e.year}` : ''}`;
}

/** When, in words. Finnhub never gives an exact time, so the time is always to be confirmed. */
export function earningsTiming(e: Pick<EarningsEvent, 'session' | 'nzDateKnown'>): string {
  switch (e.session) {
    case 'amc':
      return 'After the US market closes (NZ morning) · time to be confirmed';
    case 'dmh':
      return 'During US market hours (NZ early morning) · time to be confirmed';
    case 'bmo':
      return 'Before the US market opens · NZ day and time to be confirmed';
    default:
      return 'Time to be confirmed';
  }
}

/** The date line: the NZ day, or the US date when the NZ day can't be known. */
export function earningsDateLine(e: Pick<EarningsEvent, 'nzDate' | 'nzDateKnown' | 'usDate'>): string {
  return e.nzDateKnown ? `${dayLabel(e.nzDate)} (NZ)` : `${dayLabel(e.usDate)} (US date)`;
}

export function itemTitle(item: CalendarItem): string {
  if (item.kind === 'earnings') return `${item.earnings.symbol} earnings call`;
  const m = item.meeting;
  return `${formatTime12(m.time)} ${m.title}${m.clientName ? ` with ${m.clientName}` : ''}${m.status === 'cancelled' ? ' (cancelled)' : ''}`;
}

/** Accessible name for a grid cell: 'Wed 28 Oct, Labour Day, MSFT earnings call, 10am Review with Tui Ltd'. */
export function cellLabel(date: string, holiday: string | null, items: CalendarItem[]): string {
  const parts = [shortDayLabel(date), holiday, ...items.map(itemTitle)].filter(Boolean);
  return items.length || holiday ? parts.join(', ') : `${parts[0]}, nothing on`;
}

/** Agenda: from `from` on, days with items or a holiday, headed 'Today · Fri 23 Oct' for today. */
export function agendaDays(
  byDay: Map<string, CalendarItem[]>,
  holidays: Map<string, string>,
  from: string,
  today: string,
): { date: string; heading: string; holiday: string | null; items: CalendarItem[] }[] {
  const dates = [...new Set([...byDay.keys(), ...holidays.keys()])].filter((d) => d >= from).sort();
  return dates.map((date) => ({
    date,
    heading: date === today ? `Today · ${shortDayLabel(date)}` : date === addDays(today, 1) ? `Tomorrow · ${shortDayLabel(date)}` : shortDayLabel(date),
    holiday: holidays.get(date) ?? null,
    items: byDay.get(date) ?? [],
  }));
}

/** '10 am', '1:30 pm' (spaced, for the booking summary line). */
export function spacedTime(time: string): string {
  return formatTime12(time).replace(/(am|pm)$/, ' $1');
}

/** 'Fri 23 Oct, 10 am – 11 am'. A meeting past midnight ends on the next day's clock. */
export function meetingSummary(date: string, time: string, durationMinutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const end = (h * 60 + m + durationMinutes) % 1440;
  const endTime = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
  return `${shortDayLabel(date)}, ${spacedTime(time)} – ${spacedTime(endTime)}`;
}

/** '30 min', '1 hr', '1.5 hrs', '2 hrs', '45 min', '2 hr 15 min'. */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 30 === 0) {
    const hrs = minutes / 60;
    return `${hrs} hr${hrs === 1 ? '' : 's'}`;
  }
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

/** Booking lengths offered as buttons on the business page. */
export const MEETING_LENGTHS = [30, 60, 90, 120];
