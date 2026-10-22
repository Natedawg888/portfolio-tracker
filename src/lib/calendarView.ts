/**
 * Calendar page helpers: the month grid (weeks start on Monday, as in NZ), meetings grouped by
 * their NZ date, the agenda list, and the words the page uses for reminders and links.
 */
import type { BusinessMeeting, MeetingWriteBody } from '../types';
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
    title: m.title,
    date: m.date,
    time: m.time,
    durationMinutes: m.durationMinutes,
    location: m.location,
    notes: m.notes,
    reminderOffsets: m.reminderOffsets,
  };
}

export function newMeetingBody(o: { businessId: string; clientId?: string | null; date: string; title?: string }): MeetingWriteBody {
  return {
    businessId: o.businessId,
    clientId: o.clientId ?? null,
    title: o.title ?? '',
    date: o.date,
    time: '10:00',
    durationMinutes: 60,
    location: '',
    notes: '',
    reminderOffsets: [1440, 60],
  };
}
