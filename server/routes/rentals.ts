/**
 * Rental income for the signed-in user (KAN-66).
 *   GET    /                  properties and entries (newest first)
 *   POST   /properties        { name, address?, notes? }
 *   PATCH  /properties/:id    any of the fields above
 *   DELETE /properties/:id    also deletes its entries and their Budget / Income rows
 *   POST   /entries           { propertyId, date, kind, category, amountNzd, description?, addToMoney? }
 *   PATCH  /entries/:id       any of the fields above
 *   DELETE /entries/:id       also removes its Budget / Income row
 */
import { Router, type Request } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import {
  createEntry,
  createProperty,
  deleteEntry,
  deleteProperty,
  listRentals,
  parseEntry,
  parseProperty,
  updateEntry,
  updateProperty,
  type EntryDraft,
  type PropertyDraft,
} from '../rentals/store.ts';

const router = Router();
const NO_PROPERTY = 'Property not found';
const NO_ENTRY = 'Entry not found';

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
  res.json(listRentals(db, uid(req), aucklandToday()));
});

router.post('/properties', async (req, res) => {
  const parsed = parseProperty(req.body, false);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  res.status(201).json(createProperty(db, uid(req), parsed.value as PropertyDraft));
});

router.patch('/properties/:id', async (req, res) => {
  const parsed = parseProperty(req.body, true);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const saved = updateProperty(db, uid(req), req.params.id, parsed.value);
  if (!saved) {
    res.status(404).json({ error: NO_PROPERTY });
    return;
  }
  res.json(saved);
});

router.delete('/properties/:id', async (req, res) => {
  const db = await getDb();
  if (!deleteProperty(db, uid(req), req.params.id)) {
    res.status(404).json({ error: NO_PROPERTY });
    return;
  }
  res.json({ ok: true, id: req.params.id });
});

router.post('/entries', async (req, res) => {
  const parsed = parseEntry(req.body, false);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const saved = createEntry(db, uid(req), parsed.value as EntryDraft);
  if (!saved.ok) {
    res.status(saved.error === NO_PROPERTY ? 404 : 400).json({ error: saved.error });
    return;
  }
  res.status(201).json(saved.value);
});

router.patch('/entries/:id', async (req, res) => {
  const parsed = parseEntry(req.body, true);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const saved = updateEntry(db, uid(req), req.params.id, parsed.value);
  if (!saved) {
    res.status(404).json({ error: NO_ENTRY });
    return;
  }
  if (!saved.ok) {
    res.status(saved.error === NO_PROPERTY ? 404 : 400).json({ error: saved.error });
    return;
  }
  res.json(saved.value);
});

router.delete('/entries/:id', async (req, res) => {
  const db = await getDb();
  if (!deleteEntry(db, uid(req), req.params.id)) {
    res.status(404).json({ error: NO_ENTRY });
    return;
  }
  res.json({ ok: true, id: req.params.id });
});

export default router;
