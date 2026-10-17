/**
 * Businesses for the signed-in user (KAN-84).
 *   GET    /?taxYear=2027            business cards with the tax year's totals
 *   POST   /                         create
 *   GET    /:id?taxYear=             one business: totals, assets, clients, invoices, tagged money
 *   PUT    /:id | DELETE /:id        edit | delete (not while it has invoices)
 *   POST   /:id/logo { image } | DELETE /:id/logo
 *   POST   /:id/assets               { category, name, quantity, … }
 *   PUT    /assets/:assetId | DELETE /assets/:assetId
 *   POST   /assets/:assetId/movements { date, kind, quantity, amountNzd?, notes? }
 *   DELETE /movements/:id
 *   GET    /money/candidates?taxYear=&q=   untagged transactions and income to pick from
 *   POST   /money/tag { kind, id, businessId | null }
 *   GET    /produce/candidates | POST /produce/link { commodityId, businessId | null }
 *                                   commodities held as a business's produce (KAN-81)
 *   GET    /clients/:clientId        client view: invoices, billed, outstanding, last payment
 *
 * Clients are created and edited through /api/invoices/clients with a businessId.
 */
import { Router, type Request, type Response } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import { taxYearOf, taxYearRange } from '../../src/lib/business.ts';
import {
  addMovement,
  createAsset,
  createBusiness,
  deleteAsset,
  deleteBusiness,
  deleteMovement,
  getBusinessDetail,
  getClientView,
  linkProduce,
  listBusinesses,
  moneyCandidates,
  parseAsset,
  parseBusiness,
  parseMovement,
  produceCandidates,
  removeBusinessLogo,
  setBusinessLogo,
  tagMoney,
  updateAsset,
  updateBusiness,
} from '../business/store.ts';

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

/** ?taxYear=2027 → 2027; missing or out of range → null (the current year). */
function taxYearParam(req: Request): number | null {
  const n = Number(req.query.taxYear);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
}

router.get('/', async (req, res) => {
  const db = await getDb();
  res.json(listBusinesses(db, uid(req), aucklandToday(), taxYearParam(req)));
});

router.post('/', async (req, res) => {
  const parsed = parseBusiness(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  res.status(201).json(createBusiness(db, uid(req), parsed.value));
});

router.get('/money/candidates', async (req, res) => {
  const db = await getDb();
  const { start, end } = taxYearRange(taxYearParam(req) ?? taxYearOf(aucklandToday()));
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
  res.json(moneyCandidates(db, uid(req), start, end, q));
});

router.post('/money/tag', async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  if ((b.kind !== 'transaction' && b.kind !== 'income') || typeof b.id !== 'string' || !b.id) {
    res.status(400).json({ error: 'kind (transaction or income) and id are required' });
    return;
  }
  const businessId = typeof b.businessId === 'string' && b.businessId ? b.businessId : null;
  const db = await getDb();
  reply(res, tagMoney(db, uid(req), b.kind, b.id, businessId));
});

router.get('/produce/candidates', async (req, res) => {
  const db = await getDb();
  res.json(produceCandidates(db, uid(req), aucklandToday()));
});

router.post('/produce/link', async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (typeof b.commodityId !== 'string' || !b.commodityId) {
    res.status(400).json({ error: 'commodityId is required' });
    return;
  }
  const db = await getDb();
  reply(res, linkProduce(db, uid(req), b.commodityId, typeof b.businessId === 'string' && b.businessId ? b.businessId : null));
});

router.get('/clients/:clientId', async (req, res) => {
  const db = await getDb();
  const view = getClientView(db, uid(req), req.params.clientId, aucklandToday());
  if (!view) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }
  res.json(view);
});

router.put('/assets/:assetId', async (req, res) => {
  const parsed = parseAsset(req.body, aucklandToday());
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  reply(res, updateAsset(db, uid(req), req.params.assetId, parsed.value));
});

router.delete('/assets/:assetId', async (req, res) => {
  const db = await getDb();
  if (!deleteAsset(db, uid(req), req.params.assetId)) {
    res.status(404).json({ error: 'Asset not found' });
    return;
  }
  res.json({ ok: true, id: req.params.assetId });
});

router.post('/assets/:assetId/movements', async (req, res) => {
  const parsed = parseMovement(req.body, aucklandToday());
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  reply(res, addMovement(db, uid(req), req.params.assetId, parsed.value), true);
});

router.delete('/movements/:id', async (req, res) => {
  const db = await getDb();
  reply(res, deleteMovement(db, uid(req), req.params.id));
});

router.get('/:id', async (req, res) => {
  const db = await getDb();
  const detail = getBusinessDetail(db, uid(req), req.params.id, aucklandToday(), taxYearParam(req));
  if (!detail) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }
  res.json(detail);
});

router.put('/:id', async (req, res) => {
  const parsed = parseBusiness(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const saved = updateBusiness(db, uid(req), req.params.id, parsed.value);
  if (!saved) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }
  res.json(saved);
});

router.delete('/:id', async (req, res) => {
  const db = await getDb();
  const out = deleteBusiness(db, uid(req), req.params.id);
  if (!out.ok) {
    res.status(out.status).json({ error: out.error });
    return;
  }
  res.json({ ok: true, id: req.params.id });
});

router.post('/:id/logo', async (req, res) => {
  const image = (req.body as { image?: unknown } | undefined)?.image;
  if (typeof image !== 'string' || !image) {
    res.status(400).json({ error: 'image is required' });
    return;
  }
  const db = await getDb();
  reply(res, setBusinessLogo(db, uid(req), req.params.id, image));
});

router.delete('/:id/logo', async (req, res) => {
  const db = await getDb();
  reply(res, removeBusinessLogo(db, uid(req), req.params.id));
});

router.post('/:id/assets', async (req, res) => {
  const parsed = parseAsset(req.body, aucklandToday());
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  reply(res, createAsset(db, uid(req), req.params.id, parsed.value), true);
});

export default router;
