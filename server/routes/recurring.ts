/**
 * Bills and subscriptions for the signed-in user (KAN-26).
 *   GET    /                    saved items (next due rolled forward, last paid), suggestions
 *                               detected from transactions, totals (active items)
 *   POST   /                    { name, kind, amountNzd, cadence, nextDue, categoryId?, notes?,
 *                                 merchantKey?, source? }  confirm a suggestion or add by hand
 *   PATCH  /:id                 any of the fields above, plus status (active | paused | cancelled)
 *   POST   /:id/link            { transactionId }  link a payment: its payee becomes the bill's payee
 *   DELETE /:id
 *   POST   /dismiss             { merchantKey }  not a bill: stop suggesting it
 *   POST   /dismissed/restore   bring dismissed suggestions back
 */
import { Router, type Request } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import {
  createRecurring,
  deleteRecurring,
  dismissSuggestion,
  linkPayment,
  listRecurring,
  parseRecurring,
  restoreDismissed,
  updateRecurring,
  type RecurringDraft,
} from '../recurring/store.ts';

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

router.get('/', async (req, res) => {
  const db = await getDb();
  res.json(listRecurring(db, uid(req), aucklandToday()));
});

router.post('/dismiss', async (req, res) => {
  const db = await getDb();
  const result = dismissSuggestion(db, uid(req), (req.body ?? {}).merchantKey);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true, ...result.value });
});

router.post('/dismissed/restore', async (req, res) => {
  const db = await getDb();
  res.json({ ok: true, restored: restoreDismissed(db, uid(req)) });
});

router.post('/', async (req, res) => {
  const parsed = parseRecurring(req.body, false);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  res.status(201).json(createRecurring(db, uid(req), parsed.value as RecurringDraft, aucklandToday()));
});

router.patch('/:id', async (req, res) => {
  const parsed = parseRecurring(req.body, true);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const saved = updateRecurring(db, uid(req), req.params.id, parsed.value, aucklandToday());
  if (!saved) {
    res.status(404).json({ error: 'Bill or subscription not found' });
    return;
  }
  res.json(saved);
});

router.post('/:id/link', async (req, res) => {
  const db = await getDb();
  const result = linkPayment(db, uid(req), req.params.id, (req.body ?? {}).transactionId, aucklandToday());
  if (!result) {
    res.status(404).json({ error: 'Bill or subscription not found' });
    return;
  }
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result.value);
});

router.delete('/:id', async (req, res) => {
  const db = await getDb();
  if (!deleteRecurring(db, uid(req), req.params.id)) {
    res.status(404).json({ error: 'Bill or subscription not found' });
    return;
  }
  res.json({ ok: true, id: req.params.id });
});

export default router;
