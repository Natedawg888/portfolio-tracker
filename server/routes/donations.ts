/**
 * Donations ledger for the signed-in user (NZD, Pacific/Auckland).
 * Stored: date, recipient, amount, notes, optional evidence URL, and an
 * optional pointer to a transaction that already has a receipt.
 * Counted on read: NZ tax year (1 April–31 March) and the tax-credit estimate.
 * Formulas: server/donations/model.ts.
 * A donation is not a receipt and is not written onto transactions.
 */
import { Router } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import { parseCreateDonation, parsePatchDonation, parseTaxYearQuery } from '../donations/model.ts';
import {
  createDonation,
  deleteDonation,
  getDonation,
  listDonations,
  summarizeDonations,
  updateDonation,
} from '../donations/store.ts';

const router = Router();

router.use((req, res, next) => {
  const userId = requireUserId(req as AuthedRequest, res);
  if (!userId) return;
  (req as AuthedRequest & { scopeUserId: string }).scopeUserId = userId;
  next();
});

function uid(req: { scopeUserId?: string; user?: { id?: string } | null }): string {
  return (req as AuthedRequest & { scopeUserId?: string }).scopeUserId
    || (req as AuthedRequest).user?.id
    || '';
}

function queryText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

router.get('/', async (req, res) => {
  const taxYear = parseTaxYearQuery(queryText(req.query.taxYear));
  if (!taxYear.ok) {
    res.status(400).json({ error: taxYear.error });
    return;
  }
  const db = await getDb();
  res.json(listDonations(db, uid(req), taxYear.value));
});

router.get('/summary', async (req, res) => {
  const taxYear = parseTaxYearQuery(queryText(req.query.taxYear));
  if (!taxYear.ok) {
    res.status(400).json({ error: taxYear.error });
    return;
  }
  const db = await getDb();
  res.json(summarizeDonations(db, uid(req), aucklandToday(), taxYear.value));
});

router.post('/', async (req, res) => {
  const parsed = parseCreateDonation(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const saved = createDonation(db, uid(req), parsed.value);
  if (!saved.ok) {
    res.status(400).json({ error: saved.error });
    return;
  }
  res.status(201).json(saved.donation);
});

router.get('/:id', async (req, res) => {
  const db = await getDb();
  const donation = getDonation(db, uid(req), req.params.id);
  if (!donation) {
    res.status(404).json({ error: 'Donation not found' });
    return;
  }
  res.json(donation);
});

router.patch('/:id', async (req, res) => {
  const parsed = parsePatchDonation(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const saved = updateDonation(db, uid(req), req.params.id, parsed.value);
  if (!saved) {
    res.status(404).json({ error: 'Donation not found' });
    return;
  }
  if (!saved.ok) {
    res.status(400).json({ error: saved.error });
    return;
  }
  res.json(saved.donation);
});

router.delete('/:id', async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const removed = deleteDonation(db, uid(req), id);
  if (!removed) {
    res.status(404).json({ error: 'Donation not found' });
    return;
  }
  res.json({ ok: true, id });
});

export default router;
