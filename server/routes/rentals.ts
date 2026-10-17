/**
 * Rental income for the signed-in user (KAN-66), with rooms and tenancies (KAN-83).
 *   GET    /                  properties, entries (newest first), rooms and tenancies
 *   POST   /properties        { name, address?, notes?, letType?: whole | rooms, ownHome?, newBuild?, purchaseDate?,
 *                              purchaseCostNzd?, saleAgreementDate?, salePriceNzd?, saleCostsNzd?, mainHome? } (KAN-93)
 *   PATCH  /properties/:id    any of the fields above
 *   DELETE /properties/:id    also deletes its rooms, tenancies, entries and their Budget / Income rows
 *   POST   /entries           { propertyId, date, kind, category, amountNzd, description?, addToMoney?, roomId?, shared? }
 *   PATCH  /entries/:id       any of the fields above
 *   DELETE /entries/:id       also removes its Budget / Income row (a linked bank deposit or debit is kept)
 *   POST   /rooms             { propertyId, name, note?, share? }
 *   PATCH  /rooms/:id         { name?, note?, share? }
 *   DELETE /rooms/:id         also deletes its tenancies; its rent stays on the property
 *   POST   /tenancies         { roomId, tenantLabel, rentAmount, rentFrequency, billsIncluded?, startDate, endDate?, bondAmount?, bondLodged? }
 *   PATCH  /tenancies/:id     any of the fields above except roomId
 *   DELETE /tenancies/:id
 *   PUT    /settings          { lossBasis: portfolio | property } (KAN-93)
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
  checkProperty,
  setLossBasis,
  type EntryDraft,
  type PropertyDraft,
} from '../rentals/store.ts';
import {
  NO_ROOM,
  NO_TENANCY,
  createRoom,
  createTenancy,
  deleteRoom,
  deleteTenancy,
  parseRoom,
  parseTenancy,
  updateRoom,
  updateTenancy,
  type RoomDraft,
  type TenancyDraft,
} from '../rentals/rooms.ts';

const router = Router();
const NO_PROPERTY = 'Property not found';
const NO_ENTRY = 'Entry not found';
const NOT_FOUND = new Set([NO_PROPERTY, NO_ROOM, NO_TENANCY]);

function failStatus(error: string): number {
  return NOT_FOUND.has(error) ? 404 : 400;
}

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
  const err = checkProperty(parsed.value as PropertyDraft);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }
  const db = await getDb();
  res.status(201).json(createProperty(db, uid(req), parsed.value as PropertyDraft));
});

router.put('/settings', async (req, res) => {
  const db = await getDb();
  const saved = setLossBasis(db, uid(req), req.body);
  if (!saved.ok) {
    res.status(400).json({ error: saved.error });
    return;
  }
  res.json(saved.value);
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
  if (!saved.ok) {
    res.status(400).json({ error: saved.error });
    return;
  }
  res.json(saved.value);
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
    res.status(failStatus(saved.error)).json({ error: saved.error });
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
    res.status(failStatus(saved.error)).json({ error: saved.error });
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

router.post('/rooms', async (req, res) => {
  const parsed = parseRoom(req.body, false);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const saved = createRoom(db, uid(req), parsed.value as RoomDraft);
  if (!saved.ok) {
    res.status(failStatus(saved.error)).json({ error: saved.error });
    return;
  }
  res.status(201).json(saved.value);
});

router.patch('/rooms/:id', async (req, res) => {
  const parsed = parseRoom(req.body, true);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const saved = updateRoom(db, uid(req), req.params.id, parsed.value);
  if (!saved) {
    res.status(404).json({ error: NO_ROOM });
    return;
  }
  res.json(saved);
});

router.delete('/rooms/:id', async (req, res) => {
  const db = await getDb();
  if (!deleteRoom(db, uid(req), req.params.id)) {
    res.status(404).json({ error: NO_ROOM });
    return;
  }
  res.json({ ok: true, id: req.params.id });
});

router.post('/tenancies', async (req, res) => {
  const parsed = parseTenancy(req.body, false);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const saved = createTenancy(db, uid(req), parsed.value as TenancyDraft);
  if (!saved.ok) {
    res.status(failStatus(saved.error)).json({ error: saved.error });
    return;
  }
  res.status(201).json(saved.value);
});

router.patch('/tenancies/:id', async (req, res) => {
  const parsed = parseTenancy(req.body, true);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const saved = updateTenancy(db, uid(req), req.params.id, parsed.value);
  if (!saved) {
    res.status(404).json({ error: NO_TENANCY });
    return;
  }
  if (!saved.ok) {
    res.status(failStatus(saved.error)).json({ error: saved.error });
    return;
  }
  res.json(saved.value);
});

router.delete('/tenancies/:id', async (req, res) => {
  const db = await getDb();
  if (!deleteTenancy(db, uid(req), req.params.id)) {
    res.status(404).json({ error: NO_TENANCY });
    return;
  }
  res.json({ ok: true, id: req.params.id });
});

export default router;
