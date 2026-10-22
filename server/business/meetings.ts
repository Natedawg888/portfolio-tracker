/**
 * Client meetings for the Calendar: a meeting belongs to one of the user's businesses and
 * optionally to one of that business's clients. Times are entered in NZ time (or a given zone)
 * and stored as UTC instants. Every query filters on user_id; another user's id behaves like a
 * missing row.
 *
 * Reminders are in-app only: each lead time is a row that dueReminders hands out once, while the
 * meeting is still ahead and scheduled. A lead time that has already passed when the meeting is
 * saved is never shown (a "1 day before" for a meeting in an hour would only be noise).
 */
import type { Database } from 'sql.js';
import type { BusinessMeeting, CalendarResponse, MeetingReminder, MeetingStatus } from '../../src/types/index.ts';
import { isYmd } from '../../src/lib/invoiceCalc.ts';
import { NZ_TZ, addDays, isTimeZone, localDateRangeUtc, localToUtc, utcToLocal } from '../../src/lib/nzTime.ts';
import { newId, queryAll, queryOne, run } from '../db/index.ts';
import { businessRow } from './profile.ts';

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

export const DEFAULT_REMINDER_OFFSETS = [1440, 60];
const MAX_REMINDERS = 4;
/** The calendar asks for a month view at a time; a year keeps one request bounded. */
const MAX_RANGE_DAYS = 400;

export type MeetingDraft = {
  businessId: string;
  clientId: string | null;
  title: string;
  startsAtMs: number;
  durationMinutes: number;
  location: string;
  notes: string;
  reminderOffsets: number[];
};

function text(o: Record<string, unknown>, key: string, max: number): string {
  const v = o[key];
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function longText(o: Record<string, unknown>, key: string, max: number): string {
  const v = o[key];
  return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '';
}

function parseOffsets(raw: unknown): Parsed<number[]> {
  if (raw == null) return { ok: true, value: DEFAULT_REMINDER_OFFSETS };
  if (!Array.isArray(raw)) return { ok: false, error: 'Reminders must be a list of minutes before the meeting' };
  const offsets = [...new Set(raw.map(Number))].sort((a, b) => b - a);
  if (offsets.some((n) => !Number.isInteger(n) || n <= 0 || n > 60 * 24 * 28)) {
    return { ok: false, error: 'Each reminder must be a whole number of minutes, up to four weeks before' };
  }
  if (offsets.length > MAX_REMINDERS) return { ok: false, error: `Up to ${MAX_REMINDERS} reminders per meeting` };
  return { ok: true, value: offsets };
}

export function parseMeeting(raw: unknown): Parsed<MeetingDraft> {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: 'Body is required' };
  const businessId = text(o, 'businessId', 80);
  if (!businessId) return { ok: false, error: 'Choose a business' };
  const title = text(o, 'title', 120);
  if (!title) return { ok: false, error: 'Title is required' };
  const timeZone = o.timeZone == null || o.timeZone === '' ? NZ_TZ : o.timeZone;
  if (!isTimeZone(timeZone)) return { ok: false, error: 'Time zone is not recognised' };
  const date = o.date;
  const time = typeof o.time === 'string' ? o.time.trim() : '';
  if (!isYmd(date)) return { ok: false, error: 'Date must be YYYY-MM-DD' };
  const start = localToUtc(date, time, timeZone);
  if (!start.ok) {
    return {
      ok: false,
      error:
        start.reason === 'nonexistent'
          ? 'That time is skipped when daylight saving starts (clocks go forward an hour). Pick a time after the change.'
          : 'Time must be HH:MM (24-hour)',
    };
  }
  const durationMinutes = o.durationMinutes == null || o.durationMinutes === '' ? 60 : Number(o.durationMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 1440) {
    return { ok: false, error: 'Duration must be between 1 minute and 24 hours' };
  }
  const offsets = parseOffsets(o.reminderOffsets);
  if (!offsets.ok) return offsets;
  return {
    ok: true,
    value: {
      businessId,
      clientId: text(o, 'clientId', 80) || null,
      title,
      startsAtMs: start.utcMs,
      durationMinutes,
      location: text(o, 'location', 500),
      notes: longText(o, 'notes', 2000),
      reminderOffsets: offsets.value,
    },
  };
}

type Row = {
  id: string;
  business_id: string;
  client_id: string | null;
  title: string;
  starts_at: string;
  duration_minutes: number;
  location: string;
  notes: string;
  status: string;
  business_name: string | null;
  client_name: string | null;
};

const SELECT = `SELECT m.*, b.name AS business_name, c.name AS client_name FROM business_meetings m
  LEFT JOIN businesses b ON b.id = m.business_id AND b.user_id = m.user_id
  LEFT JOIN invoice_clients c ON c.id = m.client_id AND c.user_id = m.user_id`;

function offsetsByMeeting(db: Database, userId: string, ids: string[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  if (!ids.length) return map;
  for (const r of queryAll<{ meeting_id: string; offset_minutes: number }>(
    db,
    `SELECT meeting_id, offset_minutes FROM business_meeting_reminders WHERE user_id = ? AND meeting_id IN (${ids.map(() => '?').join(',')})
     ORDER BY offset_minutes DESC`,
    [userId, ...ids],
  )) {
    map.set(r.meeting_id, [...(map.get(r.meeting_id) ?? []), Number(r.offset_minutes)]);
  }
  return map;
}

function present(rows: Row[], offsets: Map<string, number[]>): BusinessMeeting[] {
  return rows.map((r) => {
    const local = utcToLocal(Date.parse(r.starts_at));
    return {
      id: r.id,
      businessId: r.business_id,
      businessName: r.business_name ?? '',
      clientId: r.client_id,
      clientName: r.client_name ?? '',
      title: r.title,
      startsAt: r.starts_at,
      date: local.date,
      time: local.time,
      durationMinutes: Number(r.duration_minutes),
      location: r.location,
      notes: r.notes,
      status: r.status as MeetingStatus,
      reminderOffsets: offsets.get(r.id) ?? [],
    };
  });
}

function load(db: Database, userId: string, where: string, params: unknown[], order = 'm.starts_at, m.id', limit?: number): BusinessMeeting[] {
  const rows = queryAll<Row>(db, `${SELECT} WHERE m.user_id = ? AND ${where} ORDER BY ${order}${limit ? ` LIMIT ${limit}` : ''}`, [userId, ...params]);
  return present(rows, offsetsByMeeting(db, userId, rows.map((r) => r.id)));
}

export function getMeeting(db: Database, userId: string, id: string): BusinessMeeting | null {
  return load(db, userId, 'm.id = ?', [id])[0] ?? null;
}

/** Meetings starting on NZ dates from..to inclusive, optionally for one business. */
export function listCalendar(db: Database, userId: string, from: string, to: string, businessId: string | null): Result<CalendarResponse> {
  if (!isYmd(from) || !isYmd(to)) return fail(400, 'from and to must be YYYY-MM-DD');
  if (to < from) return fail(400, 'to must be on or after from');
  if (addDays(from, MAX_RANGE_DAYS) < to) return fail(400, `Ask for at most ${MAX_RANGE_DAYS} days at a time`);
  const { startMs, endMs } = localDateRangeUtc(from, to);
  const where = ['m.starts_at >= ?', 'm.starts_at < ?'];
  const params: unknown[] = [new Date(startMs).toISOString(), new Date(endMs).toISOString()];
  if (businessId) {
    where.push('m.business_id = ?');
    params.push(businessId);
  }
  return { ok: true, value: { from, to, meetings: load(db, userId, where.join(' AND '), params) } };
}

/** For the client card: upcoming scheduled meetings and the latest past ones (any status). */
export function clientMeetings(db: Database, userId: string, clientId: string, nowMs: number): { next: BusinessMeeting[]; past: BusinessMeeting[] } {
  const now = new Date(nowMs).toISOString();
  return {
    next: load(db, userId, `m.client_id = ? AND m.starts_at >= ? AND m.status = 'scheduled'`, [clientId, now], 'm.starts_at, m.id', 5),
    past: load(db, userId, 'm.client_id = ? AND m.starts_at < ?', [clientId, now], 'm.starts_at DESC, m.id', 5),
  };
}

/** The business must be the user's; a client must be the user's and belong to that business. */
function checkOwners(db: Database, userId: string, d: MeetingDraft): Result<true> {
  if (!businessRow(db, userId, d.businessId)) return fail(404, 'Business not found');
  if (d.clientId) {
    const c = queryOne<{ business_id: string | null }>(db, `SELECT business_id FROM invoice_clients WHERE id = ? AND user_id = ?`, [d.clientId, userId]);
    if (!c) return fail(404, 'Client not found');
    if (c.business_id !== d.businessId) return fail(400, 'That client belongs to another business');
  }
  return { ok: true, value: true };
}

/** Replaces the meeting's reminders. Lead times already past at nowMs are stored as shown. */
function resetReminders(db: Database, userId: string, businessId: string, meetingId: string, startsAtMs: number, offsets: number[], nowMs: number) {
  run(db, `DELETE FROM business_meeting_reminders WHERE user_id = ? AND meeting_id = ?`, [userId, meetingId]);
  const now = new Date(nowMs).toISOString();
  for (const off of offsets) {
    const remindAtMs = startsAtMs - off * 60_000;
    run(
      db,
      `INSERT INTO business_meeting_reminders (id, user_id, business_id, meeting_id, offset_minutes, remind_at, shown_at) VALUES (?,?,?,?,?,?,?)`,
      [newId('mrem'), userId, businessId, meetingId, off, new Date(remindAtMs).toISOString(), remindAtMs <= nowMs ? now : null],
    );
  }
}

export function createMeeting(db: Database, userId: string, d: MeetingDraft, nowMs: number): Result<BusinessMeeting> {
  const owners = checkOwners(db, userId, d);
  if (!owners.ok) return owners;
  const id = newId('meet');
  const now = new Date(nowMs).toISOString();
  run(
    db,
    `INSERT INTO business_meetings (id, user_id, business_id, client_id, title, starts_at, duration_minutes, location, notes, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?, 'scheduled', ?, ?)`,
    [id, userId, d.businessId, d.clientId, d.title, new Date(d.startsAtMs).toISOString(), d.durationMinutes, d.location, d.notes, now, now],
  );
  resetReminders(db, userId, d.businessId, id, d.startsAtMs, d.reminderOffsets, nowMs);
  return { ok: true, value: getMeeting(db, userId, id)! };
}

/** Editing keeps reminders already shown unless the start time or the lead times change. */
export function updateMeeting(db: Database, userId: string, id: string, d: MeetingDraft, nowMs: number): Result<BusinessMeeting> {
  const before = getMeeting(db, userId, id);
  if (!before) return fail(404, 'Meeting not found');
  const owners = checkOwners(db, userId, d);
  if (!owners.ok) return owners;
  const startsAt = new Date(d.startsAtMs).toISOString();
  run(
    db,
    `UPDATE business_meetings SET business_id=?, client_id=?, title=?, starts_at=?, duration_minutes=?, location=?, notes=?, updated_at=?
     WHERE id=? AND user_id=?`,
    [d.businessId, d.clientId, d.title, startsAt, d.durationMinutes, d.location, d.notes, new Date(nowMs).toISOString(), id, userId],
  );
  const sameReminders = before.startsAt === startsAt && before.reminderOffsets.join() === d.reminderOffsets.join();
  if (!sameReminders) resetReminders(db, userId, d.businessId, id, d.startsAtMs, d.reminderOffsets, nowMs);
  else if (before.businessId !== d.businessId) {
    run(db, `UPDATE business_meeting_reminders SET business_id = ? WHERE user_id = ? AND meeting_id = ?`, [d.businessId, userId, id]);
  }
  return { ok: true, value: getMeeting(db, userId, id)! };
}

export function isMeetingStatus(v: unknown): v is MeetingStatus {
  return v === 'scheduled' || v === 'done' || v === 'cancelled';
}

/** Cancel, mark done, or reopen. Idempotent. Only scheduled meetings remind. */
export function setMeetingStatus(db: Database, userId: string, id: string, status: MeetingStatus, nowMs: number): Result<BusinessMeeting> {
  if (!getMeeting(db, userId, id)) return fail(404, 'Meeting not found');
  run(db, `UPDATE business_meetings SET status = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status != ?`, [
    status,
    new Date(nowMs).toISOString(),
    id,
    userId,
    status,
  ]);
  return { ok: true, value: getMeeting(db, userId, id)! };
}

/**
 * Reminders due at nowMs (lead time reached, meeting still ahead and scheduled), marked shown in
 * the same call so each is handed out once even with two tabs open.
 */
export function takeDueReminders(db: Database, userId: string, nowMs: number): MeetingReminder[] {
  const now = new Date(nowMs).toISOString();
  const due = queryAll<{ id: string; meeting_id: string; offset_minutes: number }>(
    db,
    `SELECT r.id, r.meeting_id, r.offset_minutes FROM business_meeting_reminders r
     JOIN business_meetings m ON m.id = r.meeting_id AND m.user_id = r.user_id
     WHERE r.user_id = ? AND r.shown_at IS NULL AND r.remind_at <= ? AND m.starts_at > ? AND m.status = 'scheduled'
     ORDER BY r.remind_at, r.id`,
    [userId, now, now],
  );
  if (!due.length) return [];
  run(db, `UPDATE business_meeting_reminders SET shown_at = ? WHERE user_id = ? AND shown_at IS NULL AND id IN (${due.map(() => '?').join(',')})`, [
    now,
    userId,
    ...due.map((r) => r.id),
  ]);
  const meetings = new Map(load(db, userId, `m.id IN (${due.map(() => '?').join(',')})`, due.map((r) => r.meeting_id)).map((m) => [m.id, m]));
  return due.flatMap((r) => {
    const m = meetings.get(r.meeting_id);
    return m
      ? [{ meetingId: m.id, title: m.title, clientName: m.clientName, businessName: m.businessName, startsAt: m.startsAt, date: m.date, time: m.time, offsetMinutes: Number(r.offset_minutes) }]
      : [];
  });
}

/** With the business: its meetings and their reminders go too. */
export function deleteBusinessMeetings(db: Database, userId: string, businessId: string) {
  run(db, `DELETE FROM business_meeting_reminders WHERE user_id = ? AND business_id = ?`, [userId, businessId]);
  run(db, `DELETE FROM business_meetings WHERE user_id = ? AND business_id = ?`, [userId, businessId]);
}
