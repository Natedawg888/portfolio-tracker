/**
 * Warranties for the signed-in user (KAN-61).
 *   GET    /                  warranties (status, days left, linked purchase), totals
 *   GET    /purchases?q=      the user's purchases to link a warranty to
 *   POST   /                  { itemName, retailer?, priceNzd?, startsOn, endsOn, transactionId?, notes? }
 *   PATCH  /:id               any of the fields above
 *   DELETE /:id               also removes its receipt file
 *   POST   /:id/receipt       { receiptBase64 }  JPEG/PNG/WebP/GIF/PDF, max 8MB
 *   DELETE /:id/receipt
 */
import { Router, type Request } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import {
  clearWarrantyReceipt,
  createWarranty,
  deleteWarranty,
  listWarranties,
  parseWarranty,
  searchPurchases,
  setWarrantyReceipt,
  updateWarranty,
  type WarrantyDraft,
} from '../warranties/store.ts';

const router = Router();
const NOT_FOUND = 'Warranty not found';

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
  res.json(listWarranties(db, uid(req), aucklandToday()));
});

router.get('/purchases', async (req, res) => {
  const db = await getDb();
  res.json(searchPurchases(db, uid(req), typeof req.query.q === 'string' ? req.query.q : ''));
});

router.post('/', async (req, res) => {
  const parsed = parseWarranty(req.body, false);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const saved = createWarranty(db, uid(req), parsed.value as WarrantyDraft, aucklandToday());
  if (!saved.ok) {
    res.status(400).json({ error: saved.error });
    return;
  }
  res.status(201).json(saved.value);
});

router.patch('/:id', async (req, res) => {
  const parsed = parseWarranty(req.body, true);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const saved = updateWarranty(db, uid(req), req.params.id, parsed.value, aucklandToday());
  if (!saved) {
    res.status(404).json({ error: NOT_FOUND });
    return;
  }
  if (!saved.ok) {
    res.status(400).json({ error: saved.error });
    return;
  }
  res.json(saved.value);
});

router.delete('/:id', async (req, res) => {
  const db = await getDb();
  if (!deleteWarranty(db, uid(req), req.params.id)) {
    res.status(404).json({ error: NOT_FOUND });
    return;
  }
  res.json({ ok: true, id: req.params.id });
});

router.post('/:id/receipt', async (req, res) => {
  const b64 = (req.body ?? {}).receiptBase64;
  if (typeof b64 !== 'string' || !b64.trim()) {
    res.status(400).json({ error: 'receiptBase64 (data URL or base64) required' });
    return;
  }
  const db = await getDb();
  let saved;
  try {
    saved = setWarrantyReceipt(db, uid(req), req.params.id, b64, aucklandToday());
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid receipt' });
    return;
  }
  if (!saved) {
    res.status(404).json({ error: NOT_FOUND });
    return;
  }
  res.json(saved);
});

router.delete('/:id/receipt', async (req, res) => {
  const db = await getDb();
  const saved = clearWarrantyReceipt(db, uid(req), req.params.id, aucklandToday());
  if (!saved) {
    res.status(404).json({ error: NOT_FOUND });
    return;
  }
  res.json(saved);
});

export default router;
