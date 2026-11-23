/**
 * Alerts (KAN-64).
 *   GET  /api/alerts              raises anything new for today, then the latest alerts + unread count
 *   POST /api/alerts/read         { id? }  mark one (or all) read
 *   GET  /api/alerts/settings     the user's rules and email choice
 *   PUT  /api/alerts/settings     change them
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import { emailEnabled } from '../invoices/email.ts';
import { getAlertSettings, listAlerts, markRead, parseAlertSettings, raiseAlerts, saveAlertSettings } from '../alerts/store.ts';

const router = Router();

router.use((req, res, next) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  (req as AuthedRequest & { scopeUserId: string }).scopeUserId = userId;
  next();
});
const uid = (req: unknown) => (req as { scopeUserId: string }).scopeUserId;

router.get('/', async (req, res) => {
  const db = await getDb();
  raiseAlerts(db, uid(req), aucklandToday());
  res.json(listAlerts(db, uid(req)));
});

router.post('/read', async (req, res) => {
  const id = typeof req.body?.id === 'string' ? req.body.id : null;
  res.json({ unread: markRead(await getDb(), uid(req), id) });
});

router.get('/settings', async (req, res) => {
  res.json({ settings: getAlertSettings(await getDb(), uid(req)), emailAvailable: emailEnabled() });
});

router.put('/settings', async (req, res) => {
  const db = await getDb();
  const parsed = parseAlertSettings(req.body, getAlertSettings(db, uid(req)));
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  saveAlertSettings(db, uid(req), parsed.value);
  res.json({ settings: parsed.value, emailAvailable: emailEnabled() });
});

export default router;
