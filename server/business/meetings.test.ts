/**
 * Client meetings (Calendar): NZ time in, UTC stored, the calendar range in NZ dates, the client
 * card, reminders shown once, user isolation, and deletion with the business, client and account.
 * Run: node --import tsx server/business/meetings.test.ts
 *
 * Uses a throwaway sqlite file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

const dbPath = path.join(os.tmpdir(), `pt-meetings-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;
for (const suffix of ['', '.tmp', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const { getDb, queryAll, queryOne, run } = await import('../db/index.ts');
const { deleteScopedDataForUser, SCOPED_TABLES } = await import('../lib/userScope.ts');
const { createSession, SESSION_COOKIE } = await import('../auth/sessions.ts');
const { attachUser, requireAuth, isPublicApiPath } = await import('../middleware/requireAuth.ts');
const { createMeeting, parseMeeting, setMeetingStatus, takeDueReminders, updateMeeting } = await import('./meetings.ts');
const { migratePersonalCalendar } = await import('../db/index.ts');
const { default: initSqlJs } = await import('sql.js');
const { default: invoicesRouter } = await import('../routes/invoices.ts');
const { default: businessRouter } = await import('../routes/business.ts');
const { default: calendarRouter } = await import('../routes/calendar.ts');

const userA = 'meet_user_a';
const userB = 'meet_user_b';
const now = '2026-10-05T00:00:00.000Z';

const db = await getDb();
for (const t of ['business_meetings', 'business_meeting_reminders']) {
  assert(queryOne(db, `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [t]), `schema creates ${t}`);
  assert((SCOPED_TABLES as readonly string[]).includes(t), `${t} is user-scoped (export and delete)`);
}
for (const [id, email] of [[userA, 'a@example.com'], [userB, 'b@example.com']]) {
  run(db, `INSERT INTO users (id, email, password_hash, first_name, created_at, updated_at) VALUES (?,?,?,?,?,?)`, [id, email, 'hash', 'X', now, now]);
}

const app = express();
app.use(express.json());
app.use('/api', attachUser);
app.use('/api', (req, res, next) => (isPublicApiPath(req.path) ? next() : requireAuth(req, res, next)));
app.use('/api/invoices', invoicesRouter);
app.use('/api/business', businessRouter);
app.use('/api/calendar', calendarRouter);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

type Json = Record<string, any>;
async function call(method: string, p: string, cookie: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { Accept: 'application/json', Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${p}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Json) : {} };
}

function draft(o: Record<string, unknown>) {
  const p = parseMeeting(o);
  if (!p.ok) throw new Error(`FAIL: draft ${p.error}`);
  return p.value;
}

try {
  const A = `${SESSION_COOKIE}=${(await createSession(userA)).rawToken}`;
  const B = `${SESSION_COOKIE}=${(await createSession(userB)).rawToken}`;

  const biz = (await call('POST', '/api/business', A, { name: 'Kauri Consulting', type: 'sole_trader' })).json.id as string;
  const biz2 = (await call('POST', '/api/business', A, { name: 'Side Gig', type: 'sole_trader' })).json.id as string;
  const bizB = (await call('POST', '/api/business', B, { name: 'B Co', type: 'sole_trader' })).json.id as string;
  const client = (await call('POST', '/api/invoices/clients', A, { businessId: biz, name: 'Tui Ltd' })).json.id as string;
  const client2 = (await call('POST', '/api/invoices/clients', A, { businessId: biz2, name: 'Other client' })).json.id as string;
  const clientB = (await call('POST', '/api/invoices/clients', B, { businessId: bizB, name: 'B client' })).json.id as string;
  assert(biz && biz2 && bizB && client && client2 && clientB, 'businesses and clients made');

  // 10am on 1 Dec 2026 in NZ (NZDT, +13) is 9pm on 30 Nov UTC.
  const made = await call('POST', '/api/calendar/meetings', A, {
    businessId: biz, clientId: client, title: 'Quarterly review', date: '2026-12-01', time: '10:00', durationMinutes: 45, location: 'https://meet.example.com/abc',
  });
  assert(made.status === 201, `meeting created (${made.status} ${made.json.error ?? ''})`);
  const m = made.json;
  assert(m.startsAt === '2026-11-30T21:00:00.000Z', `stored as UTC (got ${m.startsAt})`);
  assert(m.date === '2026-12-01' && m.time === '10:00', 'shown in NZ time');
  assert(m.status === 'scheduled' && m.clientName === 'Tui Ltd' && m.businessName === 'Kauri Consulting', 'names and status');
  assert(JSON.stringify(m.reminderOffsets) === '[1440,60]', 'default reminders are 1 day and 1 hour before');

  const winter = (await call('POST', '/api/calendar/meetings', A, { businessId: biz, title: 'Winter catch-up', date: '2026-07-01', time: '10:00' })).json;
  assert(winter.startsAt === '2026-06-30T22:00:00.000Z', 'NZST (+12) in winter');
  const sydney = (await call('POST', '/api/calendar/meetings', A, { businessId: biz, title: 'Sydney call', date: '2026-12-02', time: '09:00', timeZone: 'Australia/Sydney' })).json;
  assert(sydney.startsAt === '2026-12-01T22:00:00.000Z' && sydney.time === '11:00', 'a Sydney time is stored as UTC and shown in NZ time');

  const gap = await call('POST', '/api/calendar/meetings', A, { businessId: biz, title: 'Early', date: '2026-09-27', time: '02:30' });
  assert(gap.status === 400 && /daylight saving/.test(gap.json.error), 'a time skipped by daylight saving is refused');
  assert((await call('POST', '/api/calendar/meetings', A, { businessId: biz, title: 'x', date: '2026-12-01', time: '25:00' })).status === 400, 'a bad time is refused');
  assert((await call('POST', '/api/calendar/meetings', A, { businessId: biz, title: '', date: '2026-12-01', time: '10:00' })).status === 400, 'a title is required');
  assert((await call('POST', '/api/calendar/meetings', A, { businessId: biz, clientId: client2, title: 'x', date: '2026-12-01', time: '10:00' })).status === 400, "another business's client is refused");

  // The calendar asks in NZ dates: the 10am meeting is on 1 Dec even though its UTC date is 30 Nov.
  const dec1 = (await call('GET', '/api/calendar?from=2026-12-01&to=2026-12-01', A)).json;
  assert(dec1.meetings.map((x: Json) => x.id).join() === m.id, 'the 1 Dec NZ day holds the meeting');
  assert((await call('GET', '/api/calendar?from=2026-11-30&to=2026-11-30', A)).json.meetings.length === 0, 'not on 30 Nov (its UTC date)');
  const all = (await call('GET', '/api/calendar?from=2026-06-01&to=2026-12-31', A)).json.meetings as Json[];
  assert(all.map((x) => x.title).join('|') === 'Winter catch-up|Quarterly review|Sydney call', 'sorted by start');
  const onlyBiz2 = (await call('GET', `/api/calendar?from=2026-06-01&to=2026-12-31&businessId=${biz2}`, A)).json.meetings;
  assert(onlyBiz2.length === 0, 'the business filter applies');
  assert((await call('GET', '/api/calendar?from=2026-12-01', A)).status === 400, 'a range is required');
  assert((await call('GET', '/api/calendar?from=2026-01-01&to=2028-01-01', A)).status === 400, 'a range is capped');

  // Isolation: B sees none of A's meetings and can't touch them.
  assert((await call('GET', '/api/calendar?from=2026-01-01&to=2026-12-31', B)).json.meetings.length === 0, "B's calendar is empty");
  assert((await call('GET', `/api/calendar/meetings/${m.id}`, B)).status === 404, "B can't open A's meeting");
  assert((await call('PUT', `/api/calendar/meetings/${m.id}`, B, { businessId: bizB, title: 'mine', date: '2026-12-01', time: '10:00' })).status === 404, "B can't edit A's meeting");
  assert((await call('POST', `/api/calendar/meetings/${m.id}/status`, B, { status: 'cancelled' })).status === 404, "B can't cancel A's meeting");
  assert((await call('POST', '/api/calendar/meetings', B, { businessId: biz, title: 'x', date: '2026-12-01', time: '10:00' })).status === 404, "B can't add to A's business");
  assert((await call('POST', '/api/calendar/meetings', B, { businessId: bizB, clientId: client, title: 'x', date: '2026-12-01', time: '10:00' })).status === 404, "B can't use A's client");
  assert((await call('GET', `/api/calendar/meetings/${m.id}`, A)).json.status === 'scheduled', "A's meeting is unchanged");

  // Edit, cancel (a status, idempotent), reopen.
  const edited = await call('PUT', `/api/calendar/meetings/${m.id}`, A, { ...m, title: 'Quarterly review (moved)', time: '11:30', reminderOffsets: [60] });
  assert(edited.status === 200 && edited.json.startsAt === '2026-11-30T22:30:00.000Z' && edited.json.reminderOffsets.join() === '60', 'edited');
  for (let i = 0; i < 2; i++) {
    const c = await call('POST', `/api/calendar/meetings/${m.id}/status`, A, { status: 'cancelled' });
    assert(c.status === 200 && c.json.status === 'cancelled', 'cancelled (twice is fine)');
  }
  assert((await call('GET', '/api/calendar?from=2026-12-01&to=2026-12-01', A)).json.meetings[0].status === 'cancelled', 'a cancelled meeting stays on the calendar');
  assert((await call('POST', `/api/calendar/meetings/${m.id}/status`, A, { status: 'gone' })).status === 400, 'unknown status refused');
  assert((await call('POST', `/api/calendar/meetings/${m.id}/status`, A, { status: 'scheduled' })).json.status === 'scheduled', 'reopened');

  // Reminders: one per lead time, shown once, only while the meeting is ahead and scheduled.
  const T = Date.parse('2027-03-10T01:00:00.000Z');
  const min = 60_000;
  const r1 = createMeeting(db, userA, draft({ businessId: biz, clientId: client, title: 'Pitch', date: '2027-03-10', time: '14:00' }), T - 3 * 1440 * min);
  assert(r1.ok && r1.value.startsAt === '2027-03-10T01:00:00.000Z', 'reminder meeting made');
  const id1 = r1.ok ? r1.value.id : '';
  const titles = (nowMs: number) => takeDueReminders(db, userA, nowMs).filter((r) => r.meetingId === id1).map((r) => r.offsetMinutes).join();
  assert(titles(T - 2 * 1440 * min) === '', 'nothing due two days before');
  assert(titles(T - 1440 * min + min) === '1440', 'the 1-day reminder is due');
  assert(titles(T - 1440 * min + 2 * min) === '', 'and is not shown again');
  assert(takeDueReminders(db, userB, T).length === 0, "B never gets A's reminders");
  assert(titles(T - 59 * min) === '60', 'the 1-hour reminder is due');
  assert(titles(T - 30 * min) === '', 'each reminder is shown once');

  // Editing the title keeps what was shown; moving the meeting re-arms its reminders.
  const later = T + 2 * 1440 * min;
  updateMeeting(db, userA, id1, draft({ businessId: biz, clientId: client, title: 'Pitch v2', date: '2027-03-10', time: '14:00' }), T - 20 * min);
  assert(titles(T - 10 * min) === '', 'a title edit does not re-show reminders');
  updateMeeting(db, userA, id1, draft({ businessId: biz, clientId: client, title: 'Pitch v2', date: '2027-03-12', time: '14:00' }), T - 10 * min);
  assert(titles(later - 1440 * min) === '1440' && titles(later - 60 * min) === '60', 'moving the meeting re-arms both reminders');
  assert(titles(later + min) === '', 'nothing after the start');

  // A reminder that fell due while the app was closed still shows after a title-only edit.
  const r3 = createMeeting(db, userA, draft({ businessId: biz, title: 'Offline', date: '2027-03-10', time: '14:00', reminderOffsets: [60] }), T - 3 * 1440 * min);
  const id3 = r3.ok ? r3.value.id : '';
  updateMeeting(db, userA, id3, draft({ businessId: biz, title: 'Offline (renamed)', date: '2027-03-10', time: '14:00', reminderOffsets: [60] }), T - 30 * min);
  assert(takeDueReminders(db, userA, T - 29 * min).some((r) => r.meetingId === id3 && r.offsetMinutes === 60), 'an unseen due reminder survives a title edit');

  const r2 = createMeeting(db, userA, draft({ businessId: biz, title: 'Soon', date: '2027-03-10', time: '14:00' }), T - 120 * min);
  const id2 = r2.ok ? r2.value.id : '';
  const soon = (nowMs: number) => takeDueReminders(db, userA, nowMs).filter((r) => r.meetingId === id2).map((r) => r.offsetMinutes).join();
  assert(soon(T - 119 * min) === '', 'a lead time already past when the meeting is saved is never shown');
  setMeetingStatus(db, userA, id2, 'cancelled', T - 90 * min);
  assert(soon(T - 59 * min) === '', 'a cancelled meeting does not remind');

  // Through the route, at the real time: due now, then gone.
  const nowMs = Date.now();
  const startLocal = new Date(nowMs + 30 * min);
  const nz = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(startLocal).reduce<Record<string, string>>((o, p) => ({ ...o, [p.type]: p.value }), {});
  const live = createMeeting(db, userA, draft({ businessId: biz, title: 'Live', date: `${nz.year}-${nz.month}-${nz.day}`, time: `${nz.hour}:${nz.minute}`, reminderOffsets: [60] }), nowMs - 90 * min);
  assert(live.ok, 'live meeting made');
  assert(((await call('POST', '/api/calendar/reminders/due', B)).json as unknown as Json[]).length === 0, 'B has no reminders due');
  const dueNow = (await call('POST', '/api/calendar/reminders/due', A)).json as unknown as Json[];
  assert(dueNow.some((r) => r.title === 'Live' && r.offsetMinutes === 60), 'the route hands out a due reminder');
  assert(!((await call('POST', '/api/calendar/reminders/due', A)).json as unknown as Json[]).some((r) => r.title === 'Live'), 'and only once');

  // The client card: next scheduled meetings and recent past ones.
  const past = createMeeting(db, userA, draft({ businessId: biz, clientId: client, title: 'Kick-off', date: '2026-01-15', time: '09:00' }), Date.parse('2026-01-01T00:00:00Z'));
  assert(past.ok, 'past meeting made');
  const view = (await call('GET', `/api/business/clients/${client}`, A)).json;
  assert(view.meetings.past.map((x: Json) => x.title).join() === 'Kick-off', 'past meetings on the client card');
  assert(view.meetings.next.map((x: Json) => x.title).join() === 'Quarterly review (moved),Pitch v2', `next meetings on the client card (got ${view.meetings.next.map((x: Json) => x.title).join()})`);
  assert((await call('GET', `/api/business/clients/${client}`, B)).status === 404, "B can't open A's client card");

  // Deleting a client keeps its meetings, without the client.
  const temp = (await call('POST', '/api/invoices/clients', A, { businessId: biz2, name: 'Short-lived' })).json.id as string;
  const tm = await call('POST', '/api/calendar/meetings', A, { businessId: biz2, clientId: temp, title: 'One-off', date: '2026-12-05', time: '09:00' });
  assert((await call('DELETE', `/api/invoices/clients/${temp}`, A)).status < 300, 'client deleted');
  const after = (await call('GET', `/api/calendar/meetings/${tm.json.id}`, A)).json;
  assert(after.title === 'One-off' && after.clientId === null, 'its meeting stays, without the client');

  // Personal meetings and events: no business, no client, set up on the Calendar page.
  const ev = await call('POST', '/api/calendar/meetings', A, { kind: 'event', title: 'Dentist', date: '2026-12-03', time: '15:00', durationMinutes: 30 });
  assert(ev.status === 201 && ev.json.businessId === null && ev.json.kind === 'event' && ev.json.businessName === '', `personal event created (${ev.status} ${ev.json.error ?? ''})`);
  const pm = await call('POST', '/api/calendar/meetings', A, { title: 'Accountant', date: '2026-12-04', time: '09:00' });
  assert(pm.status === 201 && pm.json.businessId === null && pm.json.kind === 'meeting', 'a personal meeting defaults to kind meeting');
  assert(m.kind === 'meeting', 'business meetings are kind meeting');
  assert((await call('POST', '/api/calendar/meetings', A, { clientId: client, title: 'x', date: '2026-12-01', time: '10:00' })).status === 400, 'a client needs a business');
  assert((await call('POST', '/api/calendar/meetings', A, { businessId: biz, kind: 'event', title: 'x', date: '2026-12-01', time: '10:00' })).status === 400, 'a business books meetings, not events');
  assert((await call('POST', '/api/calendar/meetings', A, { kind: 'party', title: 'x', date: '2026-12-01', time: '10:00' })).status === 400, 'unknown kind refused');
  const decAll = (await call('GET', '/api/calendar?from=2026-12-01&to=2026-12-31', A)).json.meetings as Json[];
  assert(decAll.some((x) => x.id === ev.json.id) && decAll.some((x) => x.id === m.id), 'personal and business entries share the calendar');
  assert(!(await call('GET', `/api/calendar?from=2026-12-01&to=2026-12-31&businessId=${biz}`, A)).json.meetings.some((x: Json) => x.id === ev.json.id), 'a business filter leaves personal entries out');
  assert((await call('GET', `/api/calendar/meetings/${ev.json.id}`, B)).status === 404, "B can't open A's personal event");
  assert(!(await call('GET', '/api/calendar?from=2026-12-01&to=2026-12-31', B)).json.meetings.some((x: Json) => x.id === ev.json.id), "B's calendar has none of A's personal entries");
  const evMoved = await call('PUT', `/api/calendar/meetings/${ev.json.id}`, A, { ...ev.json, time: '16:00' });
  assert(evMoved.status === 200 && evMoved.json.time === '16:00' && evMoved.json.kind === 'event', 'a personal event is edited in place');
  const toBiz = await call('PUT', `/api/calendar/meetings/${pm.json.id}`, A, { ...pm.json, businessId: biz });
  assert(toBiz.status === 200 && toBiz.json.businessId === biz, 'a personal meeting can be moved onto a business');
  await call('PUT', `/api/calendar/meetings/${pm.json.id}`, A, { ...pm.json, businessId: null });
  const evT = Date.parse('2027-04-01T01:00:00.000Z');
  const evR = createMeeting(db, userA, draft({ kind: 'event', title: 'Flight', date: '2027-04-01', time: '14:00', reminderOffsets: [60] }), evT - 1440 * 60_000);
  assert(evR.ok, 'personal event with a reminder made');
  const evDue = takeDueReminders(db, userA, evT - 59 * 60_000).filter((r) => evR.ok && r.meetingId === evR.value.id);
  assert(evDue.length === 1 && evDue[0].businessName === '' && evDue[0].clientName === '', 'a personal event reminds, with no business or client');
  const personalCount = queryAll(db, `SELECT id FROM business_meetings WHERE user_id = ? AND business_id IS NULL`, [userA]).length;
  assert(personalCount === 3, `three personal entries (got ${personalCount})`);

  // Deleting a business removes its meetings and reminders, nothing else.
  const countFor = (table: string, userId: string, businessId?: string) =>
    queryAll(db, `SELECT id FROM ${table} WHERE user_id = ?${businessId ? ' AND business_id = ?' : ''}`, businessId ? [userId, businessId] : [userId]).length;
  assert(countFor('business_meetings', userA, biz2) === 1 && countFor('business_meeting_reminders', userA, biz2) === 2, 'biz2 has a meeting and reminders');
  const kept = countFor('business_meetings', userA, biz);
  assert((await call('DELETE', `/api/business/${biz2}`, A)).status === 200, 'business deleted');
  assert(countFor('business_meetings', userA, biz2) === 0 && countFor('business_meeting_reminders', userA, biz2) === 0, "the business's meetings and reminders go with it");
  assert(countFor('business_meetings', userA, biz) === kept, "another business's meetings stay");
  assert(queryAll(db, `SELECT id FROM business_meetings WHERE user_id = ? AND business_id IS NULL`, [userA]).length === personalCount, 'personal entries stay');

  // Account delete.
  await call('POST', '/api/calendar/meetings', B, { businessId: bizB, clientId: clientB, title: 'B meeting', date: '2026-12-01', time: '10:00' });
  const wiped = deleteScopedDataForUser(db, userA);
  assert(wiped.tables.business_meetings === kept + personalCount && wiped.tables.business_meeting_reminders > 0, 'meetings, personal entries and reminders removed with the account');
  assert(countFor('business_meetings', userA) === 0 && countFor('business_meeting_reminders', userA) === 0, 'none left for A');
  assert(countFor('business_meetings', userB) === 1 && countFor('business_meeting_reminders', userB) === 2, 'B untouched');

  // Old databases: business_id NOT NULL on both tables and no kind. The rebuild keeps every row,
  // column and index, and is a no-op the second time.
  const SQL = await initSqlJs();
  const old = new SQL.Database();
  old.run(`CREATE TABLE business_meetings (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, business_id TEXT NOT NULL, client_id TEXT, title TEXT NOT NULL,
    starts_at TEXT NOT NULL, duration_minutes INTEGER NOT NULL DEFAULT 60, location TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'scheduled', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  old.run(`CREATE INDEX idx_business_meetings_user_start ON business_meetings(user_id, starts_at)`);
  old.run(`CREATE TABLE business_meeting_reminders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, business_id TEXT NOT NULL, meeting_id TEXT NOT NULL,
    offset_minutes INTEGER NOT NULL, remind_at TEXT NOT NULL, shown_at TEXT)`);
  old.run(`INSERT INTO business_meetings (id, user_id, business_id, title, starts_at, created_at, updated_at) VALUES ('m1','u','b','Old','2026-01-01T00:00:00.000Z','t','t')`);
  old.run(`INSERT INTO business_meeting_reminders (id, user_id, business_id, meeting_id, offset_minutes, remind_at) VALUES ('r1','u','b','m1',60,'2025-12-31T23:00:00.000Z')`);
  migratePersonalCalendar(old);
  migratePersonalCalendar(old);
  const info = (t: string) => old.exec(`PRAGMA table_info(${t})`)[0].values.map((r) => ({ name: String(r[1]), notNull: Number(r[3]) }));
  assert(info('business_meetings').find((c) => c.name === 'business_id')?.notNull === 0, 'meetings.business_id is nullable after migrating');
  assert(info('business_meeting_reminders').find((c) => c.name === 'business_id')?.notNull === 0, 'reminders.business_id is nullable after migrating');
  assert(info('business_meetings').some((c) => c.name === 'kind'), 'kind column added');
  assert(String(old.exec(`SELECT title || '/' || kind FROM business_meetings WHERE id = 'm1'`)[0].values[0][0]) === 'Old/meeting', 'old rows kept, as meetings');
  assert(Number(old.exec(`SELECT COUNT(*) FROM business_meeting_reminders`)[0].values[0][0]) === 1, 'old reminders kept');
  assert(old.exec(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_business_meetings_user_start'`).length === 1, 'indexes recreated');
  old.run(`INSERT INTO business_meetings (id, user_id, business_id, title, starts_at, created_at, updated_at) VALUES ('m2','u',NULL,'Personal','2026-01-02T00:00:00.000Z','t','t')`);
  let badKind = false;
  try {
    old.run(`INSERT INTO business_meetings (id, user_id, kind, title, starts_at, created_at, updated_at) VALUES ('m3','u','party','x','2026-01-02T00:00:00.000Z','t','t')`);
  } catch {
    badKind = true;
  }
  assert(badKind, 'the kind CHECK holds on a migrated database');
  old.close();

  console.log('meetings tests passed');
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  for (const suffix of ['', '.tmp', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
