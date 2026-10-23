/**
 * Calendar for the signed-in user: business meetings and personal meetings and events. Earnings
 * and dividend dates join later.
 *   GET    /?from=YYYY-MM-DD&to=YYYY-MM-DD&businessId=   meetings starting on those NZ dates
 *   POST   /meetings                 { businessId? (none: personal), clientId?, kind? (meeting | event, events personal), title, date, time, timeZone?, durationMinutes?, location?, notes?, reminderOffsets? }
 *   GET    /meetings/:id | PUT /meetings/:id
 *   POST   /meetings/:id/status      { status: scheduled | done | cancelled }   cancel is a status, not a delete
 *   POST   /reminders/due            reminders due now, each handed out once (POST: it marks them shown)
 *   GET    /earnings?from=&to=       report dates for the user's US-listed stocks (Finnhub), on NZ dates
 *   GET    /holidays?from=&to=       NZ national public holidays (Nager.Date)
 */
import { Router, type Request, type Response } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb, queryAll } from '../db/index.ts';
import { earningsFor } from '../calendar/earnings.ts';
import { holidaysBetween } from '../calendar/holidays.ts';
import { isYmd } from '../../src/lib/invoiceCalc.ts';
import { addDays, utcToLocal } from '../../src/lib/nzTime.ts';
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

/** The same NZ date range rules as the meetings list: both dates, in order, at most 400 days. */
function rangeOr400(req: Request, res: Response): { from: string; to: string } | null {
  const from = param(req.query.from);
  const to = param(req.query.to);
  const error = !isYmd(from) || !isYmd(to) ? 'from and to must be YYYY-MM-DD' : to < from ? 'to must be on or after from' : addDays(from, 400) < to ? 'Ask for at most 400 days at a time' : null;
  if (error) {
    res.status(400).json({ error });
    return null;
  }
  return { from, to };
}

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

router.get('/earnings', async (req, res) => {
  const range = rangeOr400(req, res);
  if (!range) return;
  const db = await getDb();
  const holdings = queryAll<{ symbol: string; exchange: string | null }>(
    db,
    `SELECT symbol, exchange FROM holdings WHERE user_id = ? AND asset_class = 'stock' AND symbol IS NOT NULL AND TRIM(symbol) != ''`,
    [uid(req)],
  );
  res.json(await earningsFor(holdings, range.from, range.to, utcToLocal(Date.now()).date));
});

router.get('/holidays', async (req, res) => {
  const range = rangeOr400(req, res);
  if (!range) return;
  res.json(await holidaysBetween(range.from, range.to));
});

router.post('/reminders/due', async (req, res) => {
  const db = await getDb();
  res.json(takeDueReminders(db, uid(req), Date.now()));
});

export default router;
