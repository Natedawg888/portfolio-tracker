/**
 * Advanced crypto for the signed-in user (KAN-47, Pro). Non-Pro users get 402 PRO_REQUIRED.
 *   GET    /summary?year=2026         gains for a tax year, positions with unrealised gains, ledger, DeFi, wallets
 *   POST   /txns                      ledger entry (see parseTxn)
 *   PUT    /txns/:id
 *   DELETE /txns/:id
 *   GET    /price?asset=ETH&date=YYYY-MM-DD   NZD value on a day (Yahoo Finance × Frankfurter)
 *   PUT    /settings                  { costMethod: 'fifo' | 'wac' }
 *   GET    /import/:walletId          transfers not yet in the ledger, with suggested kinds and values
 *   POST   /import                    { walletId, items }  save classified transfers / ignore them
 *   POST   /defi, PUT /defi/:id, DELETE /defi/:id   DeFi positions
 */
import { Router, type Request, type Response } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { getCryptoQuoteNzd } from '../quotes/crypto.ts';
import {
  createTxn,
  cryptoSummary,
  deleteDefi,
  deleteTxn,
  importCommit,
  importPreview,
  lookupPrice,
  saveDefi,
  setCostMethod,
  updateTxn,
} from '../crypto/store.ts';

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

function send<T>(res: Response, r: { ok: true; value: T } | { ok: false; status: number; error: string; code?: string }, created = false) {
  if (!r.ok) res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  else res.status(created ? 201 : 200).json(r.value);
}

const livePrice = async (asset: string) => {
  const q = await getCryptoQuoteNzd(asset);
  return { price: q.price != null && Number.isFinite(q.price) && (q.status === 'ok' || q.status === 'stale') ? q.price : null, status: q.status };
};

router.get('/summary', async (req, res) => send(res, await cryptoSummary(await getDb(), uid(req), req.query.year, livePrice)));
router.post('/txns', async (req, res) => send(res, createTxn(await getDb(), uid(req), req.body), true));
router.put('/txns/:id', async (req, res) => send(res, updateTxn(await getDb(), uid(req), req.params.id, req.body)));
router.delete('/txns/:id', async (req, res) => send(res, deleteTxn(await getDb(), uid(req), req.params.id)));
router.get('/price', async (req, res) => send(res, await lookupPrice(await getDb(), uid(req), req.query.asset, req.query.date)));
router.put('/settings', async (req, res) => send(res, setCostMethod(await getDb(), uid(req), req.body)));
router.get('/import/:walletId', async (req, res) => send(res, await importPreview(await getDb(), uid(req), req.params.walletId)));
router.post('/import', async (req, res) => send(res, importCommit(await getDb(), uid(req), req.body)));
router.post('/defi', async (req, res) => send(res, saveDefi(await getDb(), uid(req), null, req.body), true));
router.put('/defi/:id', async (req, res) => send(res, saveDefi(await getDb(), uid(req), req.params.id, req.body)));
router.delete('/defi/:id', async (req, res) => send(res, deleteDefi(await getDb(), uid(req), req.params.id)));

export default router;
