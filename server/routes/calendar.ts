/**
 * Calendar for the signed-in user. Client meetings for now; earnings and dividend dates join later.
 *   GET    /?from=YYYY-MM-DD&to=YYYY-MM-DD&businessId=   meetings starting on those NZ dates
 *   POST   /meetings                 { businessId, clientId?, title, date, time, timeZone?, durationMinutes?, location?, notes?, reminderOffsets? }
 *   GET    /meetings/:id | PUT /meetings/:id
 *   POST   /meetings/:id/status      { status: scheduled | done | cancelled }   cancel is a status, not a delete
 *   POST   /reminders/due            reminders due now, each handed out once (POST: it marks them shown)
 */
import { Router, type Request, type Response } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import {
  createMeeting,
  getMeeting,
  isMeetingStatus,
  listCalendar,
  parseMeeting,
  setMeetingStatus,
  takeDueReminders,
  updateMeeting,
} from '../business/meetings.ts';

const router = Router();

router.use((req, res, next) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  (req as AuthedRequest & { scopeUserId: string }).scopeUserId = userId;
  next();
});

function uid(req: Request): string {
  return (req as AuthedRequest & { scopeUserId?: string }).scopeUserId || (req as AuthedRequest).user?.id || '';
}

function reply<T>(res: Response, result: { ok: true; value: T } | { ok: false; status: number; error: string }, created = false) {
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(created ? 201 : 200).json(result.value);
}

const param = (v: unknown) => (typeof v === 'string' ? v : '');

router.get('/', async (req, res) => {
  const db = await getDb();
  reply(res, listCalendar(db, uid(req), param(req.query.from), param(req.query.to), param(req.query.businessId) || null));
});

router.post('/meetings', async (req, res) => {
  const parsed = parseMeeting(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  reply(res, createMeeting(db, uid(req), parsed.value, Date.now()), true);
});

router.get('/meetings/:id', async (req, res) => {
  const db = await getDb();
  const m = getMeeting(db, uid(req), req.params.id);
  if (!m) {
    res.status(404).json({ error: 'Meeting not found' });
    return;
  }
  res.json(m);
});

router.put('/meetings/:id', async (req, res) => {
  const parsed = parseMeeting(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  reply(res, updateMeeting(db, uid(req), req.params.id, parsed.value, Date.now()));
});

router.post('/meetings/:id/status', async (req, res) => {
  const status = (req.body as { status?: unknown } | undefined)?.status;
  if (!isMeetingStatus(status)) {
    res.status(400).json({ error: 'Status must be scheduled, done or cancelled' });
    return;
  }
  const db = await getDb();
  reply(res, setMeetingStatus(db, uid(req), req.params.id, status, Date.now()));
});

router.post('/reminders/due', async (req, res) => {
  const db = await getDb();
  res.json(takeDueReminders(db, uid(req), Date.now()));
});

export default router;
