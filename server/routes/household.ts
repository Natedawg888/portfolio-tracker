/**
 * Household for the signed-in user (KAN-77, phase 1). Every route reads the caller's
 * membership fresh from the database, so a removed member loses access immediately.
 *   GET    /                      household, members, invites (owner), activity, plan
 *   POST   /                      { name }                      create (Plus)
 *   PATCH  /                      { name }                      owner
 *   DELETE /                                                    owner (always allowed)
 *   POST   /invites               { email, role }               owner; emails the link when email is set up
 *   DELETE /invites/:id                                         owner
 *   POST   /invites/preview       { token }                     the invited person
 *   POST   /invites/accept        { token }                     the invited person
 *   PATCH  /members/:userId       { role }                      owner
 *   DELETE /members/:userId                                     owner
 *   POST   /transfer              { userId }                    owner
 *   POST   /leave                                               member (always allowed)
 * Sharing (phase 2):
 *   GET    /shareable                    my items, each with shared on / off
 *   PUT    /shares                       { kind, itemId, shared }      my own items only
 *   GET    /dashboard                    shared net worth, budgets, bills, goals, transactions
 *   PATCH  /shared/budget/:categoryId    { amountNzd }                 adults: this month's plan
 *   PATCH  /shared/goal/:id              { targetNzd?, currentAmountNzd? }  adults
 *   PATCH  /shared/bill/:id              { amountNzd?, nextDue? }      adults
 * Splits and settle-up (phase 3):
 *   GET    /splits                       splits, payments, balances, suggested payments
 *   POST   /splits                       { transactionId, method, shares: [{ memberId, value? }] }  adults
 *   PUT    /splits/:id                   { method, shares }                                     adults
 *   DELETE /splits/:id                                                                          adults
 *   POST   /settlements                  { fromId, toId, amountNzd, paidOn?, note? }            adults
 *   DELETE /settlements/:id                                                                     adults
 */
import { Router, type Request, type Response } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { emailEnabled, messageHtml, safeDisplayName, sendEmail } from '../invoices/email.ts';
import { shareBase } from './invoices.ts';
import {
  acceptInvite,
  createHousehold,
  createInvite,
  deleteHousehold,
  getHousehold,
  leaveHousehold,
  previewInvite,
  removeMember,
  renameHousehold,
  revokeInvite,
  setRole,
  transferOwnership,
} from '../households/store.ts';
import { createSplit, deleteSettlement, deleteSplit, listSplits, recordSettlement, updateSplit } from '../households/splits.ts';
import { dashboard, setShared, setSharedBudgetPlan, shareable, updateSharedBill, updateSharedGoal } from '../households/sharing.ts';

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
  res.json(getHousehold(await getDb(), uid(req)));
});

router.post('/', async (req, res) => send(res, createHousehold(await getDb(), uid(req), req.body), true));
router.patch('/', async (req, res) => send(res, renameHousehold(await getDb(), uid(req), req.body)));
router.delete('/', async (req, res) => send(res, deleteHousehold(await getDb(), uid(req))));

router.post('/invites', async (req, res) => {
  const r = createInvite(await getDb(), uid(req), req.body, shareBase(req));
  if (!r.ok) return send(res, r);
  const { view, link, email, householdName, inviterName } = r.value;
  let emailed = false;
  if (emailEnabled()) {
    const text = `${inviterName} has invited you to join the household “${householdName}” on KoruLedger.\n\nOpen this link within 7 days to accept. You'll keep your own finances private; only items members choose to share are visible to the household.`;
    const sent = await sendEmail({
      fromName: safeDisplayName(`${inviterName} via KoruLedger`),
      replyTo: null,
      to: [email],
      subject: `${inviterName} invited you to a KoruLedger household`,
      text: `${text}\n\n${link}`,
      html: messageHtml(text, link, 'Accept the invite'),
      attachment: null,
      idempotencyKey: link.slice(-24),
    });
    emailed = sent.ok;
  }
  // The link is returned so the owner can share it directly when email isn't set up.
  res.status(201).json({ ...view, invite: { link, emailed } });
});

router.delete('/invites/:id', async (req, res) => send(res, revokeInvite(await getDb(), uid(req), req.params.id)));
router.post('/invites/preview', async (req, res) => send(res, previewInvite(await getDb(), uid(req), req.body?.token)));
router.post('/invites/accept', async (req, res) => send(res, acceptInvite(await getDb(), uid(req), req.body?.token)));
router.patch('/members/:userId', async (req, res) => send(res, setRole(await getDb(), uid(req), req.params.userId, req.body)));
router.delete('/members/:userId', async (req, res) => send(res, removeMember(await getDb(), uid(req), req.params.userId)));
router.post('/transfer', async (req, res) => send(res, transferOwnership(await getDb(), uid(req), req.body)));
router.post('/leave', async (req, res) => send(res, leaveHousehold(await getDb(), uid(req))));

router.get('/shareable', async (req, res) => send(res, shareable(await getDb(), uid(req))));
router.put('/shares', async (req, res) => send(res, setShared(await getDb(), uid(req), req.body)));
router.get('/dashboard', async (req, res) => send(res, await dashboard(await getDb(), uid(req))));
router.patch('/shared/budget/:categoryId', async (req, res) => send(res, setSharedBudgetPlan(await getDb(), uid(req), req.params.categoryId, req.body)));
router.patch('/shared/goal/:id', async (req, res) => send(res, updateSharedGoal(await getDb(), uid(req), req.params.id, req.body)));
router.patch('/shared/bill/:id', async (req, res) => send(res, updateSharedBill(await getDb(), uid(req), req.params.id, req.body)));

router.get('/splits', async (req, res) => send(res, listSplits(await getDb(), uid(req))));
router.post('/splits', async (req, res) => send(res, createSplit(await getDb(), uid(req), req.body), true));
router.put('/splits/:id', async (req, res) => send(res, updateSplit(await getDb(), uid(req), req.params.id, req.body)));
router.delete('/splits/:id', async (req, res) => send(res, deleteSplit(await getDb(), uid(req), req.params.id)));
router.post('/settlements', async (req, res) => send(res, recordSettlement(await getDb(), uid(req), req.body), true));
router.delete('/settlements/:id', async (req, res) => send(res, deleteSettlement(await getDb(), uid(req), req.params.id)));

export default router;
