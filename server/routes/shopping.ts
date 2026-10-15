/**
 * Shopping lists and crowdsourced prices for the signed-in user (KAN-74).
 *   GET    /lists                       summaries
 *   POST   /lists                       { name, categoryId? }
 *   GET    /lists/:id                   items, totals, budget comparison
 *   PATCH  /lists/:id                   { name?, categoryId? }
 *   DELETE /lists/:id
 *   POST   /lists/:id/reset             untick every item
 *   POST   /lists/:id/items             { name, quantity?, estPriceNzd?, categoryId? }
 *   PATCH  /items/:id                   any item field, ticked, productKey (match correction)
 *   DELETE /items/:id
 *   POST   /lists/:id/prices            { chain, branch, prices: [{ itemId, priceNzd }] }
 *   GET    /lists/:id/compare           per-store totals from shared prices
 *   GET    /prefs  PUT /prefs           { contributePrices?, stores?, windowDays? }
 *   GET    /products?q=                 shared product names (2+ contributors)
 *   GET    /branches?chain=&q=          branch names already used
 *   DELETE /prices/mine                 remove the prices this user shared
 */
import { Router, type Request, type Response } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import { CHAINS, isChain } from '../shopping/prices.ts';
import {
  addItem,
  compareList,
  createList,
  deleteItem,
  deleteList,
  getList,
  getPrefs,
  listLists,
  mySharedCount,
  parseItem,
  recordPrices,
  removeMyPrices,
  resetList,
  searchBranches,
  searchProducts,
  updateItem,
  updateList,
  updatePrefs,
  type ItemDraft,
} from '../shopping/store.ts';

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

function send<T>(res: Response, r: { ok: true; value: T } | { ok: false; status: number; error: string }, created = false) {
  if (!r.ok) res.status(r.status).json({ error: r.error });
  else res.status(created ? 201 : 200).json(r.value);
}

const notFound = (res: Response, what: string) => res.status(404).json({ error: `${what} not found` });

router.get('/lists', async (req, res) => {
  res.json(listLists(await getDb(), uid(req)));
});

router.post('/lists', async (req, res) => {
  send(res, createList(await getDb(), uid(req), req.body, aucklandToday()), true);
});

router.get('/lists/:id', async (req, res) => {
  const list = getList(await getDb(), uid(req), req.params.id, aucklandToday());
  if (!list) return notFound(res, 'List');
  res.json(list);
});

router.patch('/lists/:id', async (req, res) => {
  send(res, updateList(await getDb(), uid(req), req.params.id, req.body, aucklandToday()));
});

router.delete('/lists/:id', async (req, res) => {
  if (!deleteList(await getDb(), uid(req), req.params.id)) return notFound(res, 'List');
  res.json({ ok: true, id: req.params.id });
});

router.post('/lists/:id/reset', async (req, res) => {
  const list = resetList(await getDb(), uid(req), req.params.id, aucklandToday());
  if (!list) return notFound(res, 'List');
  res.json(list);
});

router.post('/lists/:id/items', async (req, res) => {
  const parsed = parseItem(req.body, false);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  send(res, addItem(await getDb(), uid(req), req.params.id, parsed.value as ItemDraft, aucklandToday()), true);
});

router.patch('/items/:id', async (req, res) => {
  const parsed = parseItem(req.body, true);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  send(res, updateItem(await getDb(), uid(req), req.params.id, parsed.value, aucklandToday()));
});

router.delete('/items/:id', async (req, res) => {
  const list = deleteItem(await getDb(), uid(req), req.params.id, aucklandToday());
  if (!list) return notFound(res, 'Item');
  res.json(list);
});

router.post('/lists/:id/prices', async (req, res) => {
  send(res, recordPrices(await getDb(), uid(req), req.params.id, req.body, aucklandToday()));
});

router.get('/lists/:id/compare', async (req, res) => {
  send(res, compareList(await getDb(), uid(req), req.params.id, aucklandToday()));
});

router.get('/prefs', async (req, res) => {
  const db = await getDb();
  res.json({ ...getPrefs(db, uid(req)), sharedCount: mySharedCount(db, uid(req)), chains: CHAINS });
});

router.put('/prefs', async (req, res) => {
  const db = await getDb();
  const r = updatePrefs(db, uid(req), req.body);
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  res.json({ ...r.value, sharedCount: mySharedCount(db, uid(req)), chains: CHAINS });
});

router.get('/products', async (req, res) => {
  res.json(searchProducts(await getDb(), typeof req.query.q === 'string' ? req.query.q : ''));
});

router.get('/branches', async (req, res) => {
  const chain = req.query.chain;
  if (!isChain(chain)) return res.status(400).json({ error: 'Unknown supermarket' });
  res.json(searchBranches(await getDb(), chain, typeof req.query.q === 'string' ? req.query.q : ''));
});

router.delete('/prices/mine', async (req, res) => {
  res.json({ ok: true, removed: removeMyPrices(await getDb(), uid(req)) });
});

export default router;
