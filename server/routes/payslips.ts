/**
 * Payslips for the signed-in user (KAN-78).
 *   GET    /?year=2026&employer=  payslips for a tax year (optionally one saved employer), checks, YTD, history, plan, saved employers
 *   POST   /                  payslip fields (see parsePayslip)
 *   PUT    /:id               payslip fields
 *   DELETE /:id               also removes its file and its Income row; the bank deposit stays
 *   POST   /:id/file          { fileBase64 }  JPEG/PNG/WebP/GIF/PDF, max 8MB
 *   DELETE /:id/file
 */
import { Router, type Request, type Response } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { clearPayslipFile, createPayslip, deletePayslip, listPayslips, setPayslipFile, updatePayslip } from '../payslips/store.ts';

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

router.get('/', async (req, res) => {
  res.json(listPayslips(await getDb(), uid(req), req.query.year, req.query.employer));
});
router.post('/', async (req, res) => send(res, createPayslip(await getDb(), uid(req), req.body), true));
router.put('/:id', async (req, res) => send(res, updatePayslip(await getDb(), uid(req), req.params.id, req.body)));
router.delete('/:id', async (req, res) => {
  if (!deletePayslip(await getDb(), uid(req), req.params.id)) res.status(404).json({ error: 'Payslip not found' });
  else res.json({ ok: true });
});
router.post('/:id/file', async (req, res) => send(res, setPayslipFile(await getDb(), uid(req), req.params.id, req.body?.fileBase64)));
router.delete('/:id/file', async (req, res) => send(res, clearPayslipFile(await getDb(), uid(req), req.params.id)));

export default router;
