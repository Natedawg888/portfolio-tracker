/**
 * Invoices for the signed-in user (KAN-71).
 *
 *   GET/PUT  /business                 business details printed on invoices
 *   GET/POST /clients (?businessId=), PUT/DELETE /clients/:id
 *   (every client and invoice belongs to a business, KAN-84; none given → the default one)
 *   GET      /export.csv               all invoices for an accountant
 *   GET/POST /                         list (filters: status, clientId, businessId, from, to) / create draft
 *   GET/PUT/DELETE /:id                read / edit draft / delete draft or void invoice
 *   GET      /:id/pdf                  download
 *   POST     /:id/mark-sent | /:id/void | /:id/duplicate
 *   POST/DELETE /:id/share             create / revoke the read-only share link
 *   POST     /:id/payments, DELETE /:id/payments/:paymentId
 *   GET      /:id/email-draft?kind=invoice|reminder   prefilled email for the preview
 *   POST     /:id/send                 { kind, to, subject, message, includeLink, confirm: true }
 *   POST     /:id/record-send          { kind, channel: email_app | share, to?, subject? } — the user
 *                                      sent it from their own email app or share sheet; logs it and
 *                                      marks the invoice sent
 *
 * Nothing is emailed without an explicit send request carrying confirm: true.
 */
import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import type { AuthedRequest } from '../middleware/requireAuth.ts';
import { requireUserId } from '../lib/userScope.ts';
import { getDb, queryOne } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import { isYmd, INVOICE_STATUS_LABELS } from '../../src/lib/invoiceCalc.ts';
import type { Invoice } from '../../src/types/index.ts';
import { parseBusinessProfile, parseClient, parseExternalSend, parseInvoice, parsePayment, parseSend } from '../invoices/model.ts';
import {
  addPayment,
  createClient,
  createInvoice,
  deleteClient,
  deleteInvoice,
  deletePayment,
  duplicateInvoice,
  enableShareLink,
  getBusinessProfile,
  getInvoice,
  invoicesCsv,
  listClients,
  listInvoices,
  logSend,
  markSent,
  revokeShareLink,
  saveBusinessProfile,
  sendProblem,
  sendsSince,
  toPublicInvoice,
  updateClient,
  updateInvoice,
  voidInvoice,
} from '../invoices/store.ts';
import { pdfFilename, renderInvoicePdf, formatDate, formatMoney } from '../invoices/pdf.ts';
import { emailEnabled, messageHtml, sendEmail, sendLimits } from '../invoices/email.ts';

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

/** Base for share links: PUBLIC_URL in production; the page's own origin locally. */
export function shareBase(req: Request): string {
  const configured = process.env.PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const origin = req.get('origin');
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) return origin;
  const referer = req.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      /* fall through */
    }
  }
  return `${req.protocol}://${req.get('host') ?? 'localhost'}`;
}

type Res = { status: (n: number) => { json: (b: unknown) => void } };

function reply<T>(res: Res & { json: (b: unknown) => void }, result: { ok: true; value: T } | { ok: false; status: number; error: string }, created = false) {
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  if (created) res.status(201).json(result.value);
  else res.json(result.value);
}

// ---------------------------------------------------------------- business details

router.get('/business', async (req, res) => {
  const db = await getDb();
  res.json(getBusinessProfile(db, uid(req)));
});

router.put('/business', async (req, res) => {
  const parsed = parseBusinessProfile(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  res.json(saveBusinessProfile(db, uid(req), parsed.value));
});

// ---------------------------------------------------------------- clients

router.get('/clients', async (req, res) => {
  const db = await getDb();
  const businessId = typeof req.query.businessId === 'string' && req.query.businessId.trim() ? req.query.businessId.trim() : null;
  res.json(listClients(db, uid(req), businessId));
});

router.post('/clients', async (req, res) => {
  const parsed = parseClient(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const created = createClient(db, uid(req), parsed.value);
  if (!created) {
    res.status(404).json({ error: 'Business not found' });
    return;
  }
  res.status(201).json(created);
});

router.put('/clients/:id', async (req, res) => {
  const parsed = parseClient(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  const saved = updateClient(db, uid(req), req.params.id, parsed.value);
  if (!saved) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }
  res.json(saved);
});

router.delete('/clients/:id', async (req, res) => {
  const db = await getDb();
  if (!deleteClient(db, uid(req), req.params.id)) {
    res.status(404).json({ error: 'Client not found' });
    return;
  }
  res.json({ ok: true, id: req.params.id });
});

// ---------------------------------------------------------------- export

router.get('/export.csv', async (req, res) => {
  const db = await getDb();
  const today = aucklandToday();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="invoices-${today}.csv"`);
  res.send(`﻿${invoicesCsv(db, uid(req), today)}`);
});

// ---------------------------------------------------------------- invoices

router.get('/', async (req, res) => {
  const db = await getDb();
  const q = req.query;
  const one = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const from = one(q.from);
  const to = one(q.to);
  if ((from && !isYmd(from)) || (to && !isYmd(to))) {
    res.status(400).json({ error: 'from and to must be YYYY-MM-DD' });
    return;
  }
  const status = one(q.status);
  if (status && !(status in INVOICE_STATUS_LABELS)) {
    res.status(400).json({ error: 'Unknown status' });
    return;
  }
  res.json({
    ...listInvoices(db, uid(req), { status, clientId: one(q.clientId), businessId: one(q.businessId), from, to }, aucklandToday()),
    emailEnabled: emailEnabled(),
  });
});

router.post('/', async (req, res) => {
  const today = aucklandToday();
  const parsed = parseInvoice(req.body, today);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  reply(res, createInvoice(db, uid(req), parsed.value, today, shareBase(req)), true);
});

router.get('/:id', async (req, res) => {
  const db = await getDb();
  const inv = getInvoice(db, uid(req), req.params.id, aucklandToday(), shareBase(req));
  if (!inv) {
    res.status(404).json({ error: 'Invoice not found' });
    return;
  }
  res.json(inv);
});

router.put('/:id', async (req, res) => {
  const today = aucklandToday();
  const parsed = parseInvoice(req.body, today);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  reply(res, updateInvoice(db, uid(req), req.params.id, parsed.value, today, shareBase(req)));
});

router.delete('/:id', async (req, res) => {
  const db = await getDb();
  const result = deleteInvoice(db, uid(req), req.params.id);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ ok: true, id: req.params.id });
});

router.get('/:id/pdf', async (req, res) => {
  const db = await getDb();
  const inv = getInvoice(db, uid(req), req.params.id, aucklandToday());
  if (!inv) {
    res.status(404).json({ error: 'Invoice not found' });
    return;
  }
  const pub = toPublicInvoice(inv);
  const bytes = await renderInvoicePdf(pub);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="${pdfFilename(pub)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(Buffer.from(bytes));
});

router.post('/:id/mark-sent', async (req, res) => {
  const db = await getDb();
  reply(res, markSent(db, uid(req), req.params.id, aucklandToday(), shareBase(req)));
});

router.post('/:id/void', async (req, res) => {
  const db = await getDb();
  reply(res, voidInvoice(db, uid(req), req.params.id, aucklandToday(), shareBase(req)));
});

router.post('/:id/duplicate', async (req, res) => {
  const db = await getDb();
  reply(res, duplicateInvoice(db, uid(req), req.params.id, aucklandToday(), shareBase(req)), true);
});

router.post('/:id/share', async (req, res) => {
  const db = await getDb();
  reply(res, enableShareLink(db, uid(req), req.params.id, aucklandToday(), shareBase(req)));
});

router.delete('/:id/share', async (req, res) => {
  const db = await getDb();
  reply(res, revokeShareLink(db, uid(req), req.params.id, aucklandToday(), shareBase(req)));
});

router.post('/:id/payments', async (req, res) => {
  const today = aucklandToday();
  const parsed = parsePayment(req.body, today);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const db = await getDb();
  reply(res, addPayment(db, uid(req), req.params.id, parsed.value, today, shareBase(req)), true);
});

router.delete('/:id/payments/:paymentId', async (req, res) => {
  const db = await getDb();
  reply(res, deletePayment(db, uid(req), req.params.id, req.params.paymentId, aucklandToday(), shareBase(req)));
});

// ---------------------------------------------------------------- email

type EmailKind = 'invoice' | 'reminder';

export function defaultEmail(inv: Invoice, kind: EmailKind): { to: string[]; subject: string; message: string } {
  const from = inv.business.businessName || 'us';
  const greeting = `Kia ora ${inv.clientName || 'there'},`;
  const due = inv.dueDate === inv.issueDate ? 'on receipt' : `by ${formatDate(inv.dueDate)}`;
  if (kind === 'reminder') {
    return {
      to: inv.clientEmail ? [inv.clientEmail] : [],
      subject: `Reminder: ${inv.title.toLowerCase()} ${inv.number} from ${from}`,
      message: `${greeting}\n\nThis is a friendly reminder that ${inv.title.toLowerCase()} ${inv.number} was due on ${formatDate(inv.dueDate)}. The balance still owing is ${formatMoney(inv.balanceNzd)}.\n\nIf you've already paid, thank you, and please ignore this email.\n\nNgā mihi,\n${from}`,
    };
  }
  return {
    to: inv.clientEmail ? [inv.clientEmail] : [],
    subject: `${inv.title} ${inv.number} from ${from}`,
    message: `${greeting}\n\nHere is ${inv.title.toLowerCase()} ${inv.number} for ${formatMoney(inv.amountDueNzd)}, due ${due}.\n\nNgā mihi,\n${from}`,
  };
}

function emailKind(raw: unknown): EmailKind {
  return raw === 'reminder' ? 'reminder' : 'invoice';
}

function reminderProblem(inv: Invoice): string | null {
  if (inv.storedStatus !== 'sent') return 'Reminders are for invoices that have been sent.';
  if (inv.balanceNzd <= 0) return 'This invoice is paid.';
  return null;
}

router.get('/:id/email-draft', async (req, res) => {
  const db = await getDb();
  const inv = getInvoice(db, uid(req), req.params.id, aucklandToday(), shareBase(req));
  if (!inv) {
    res.status(404).json({ error: 'Invoice not found' });
    return;
  }
  const kind = emailKind(req.query.kind);
  res.json({ ...defaultEmail(inv, kind), kind, emailEnabled: emailEnabled(), problem: kind === 'reminder' ? reminderProblem(inv) : sendProblem(inv) });
});

router.post('/:id/record-send', async (req, res) => {
  const userId = uid(req);
  const db = await getDb();
  const today = aucklandToday();
  const base = shareBase(req);
  const inv = getInvoice(db, userId, req.params.id, today, base);
  if (!inv) {
    res.status(404).json({ error: 'Invoice not found' });
    return;
  }
  const parsed = parseExternalSend(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  if (inv.storedStatus === 'void') {
    res.status(409).json({ error: 'This invoice is void' });
    return;
  }
  const { kind, channel, to, subject } = parsed.value;
  const problem = kind === 'reminder' ? reminderProblem(inv) : sendProblem(inv);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  logSend(db, userId, inv.id, { kind, channel, recipients: to, subject, status: 'sent' });
  const after = kind === 'invoice' ? markSent(db, userId, inv.id, today, base) : null;
  res.json(after && after.ok ? after.value : getInvoice(db, userId, inv.id, today, base));
});

router.post('/:id/send', async (req, res) => {
  const userId = uid(req);
  const db = await getDb();
  const today = aucklandToday();
  const base = shareBase(req);
  let inv = getInvoice(db, userId, req.params.id, today, base);
  if (!inv) {
    res.status(404).json({ error: 'Invoice not found' });
    return;
  }
  if (!emailEnabled()) {
    res.status(503).json({ error: 'Email sending is not set up yet. Download the PDF or copy the share link instead.' });
    return;
  }
  const parsed = parseSend(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const kind = emailKind((req.body ?? {}).kind);
  if (inv.storedStatus === 'void') {
    res.status(409).json({ error: 'This invoice is void' });
    return;
  }
  const problem = kind === 'reminder' ? reminderProblem(inv) : sendProblem(inv);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  const limits = sendLimits();
  const now = Date.now();
  if (sendsSince(db, userId, new Date(now - 3_600_000).toISOString()) >= limits.hourly) {
    res.status(429).json({ error: `You can send up to ${limits.hourly} invoice emails an hour. Try again later.` });
    return;
  }
  if (sendsSince(db, userId, new Date(now - 86_400_000).toISOString()) >= limits.daily) {
    res.status(429).json({ error: `You can send up to ${limits.daily} invoice emails a day. Try again tomorrow.` });
    return;
  }

  if ((req.body ?? {}).includeLink === true) {
    const shared = enableShareLink(db, userId, inv.id, today, base);
    if (shared.ok) inv = shared.value;
  }
  // The attached PDF shows the invoice as sent (not "draft").
  const forPdf = toPublicInvoice(inv);
  if (forPdf.status === 'draft') forPdf.status = 'sent';
  const pdf = await renderInvoicePdf(forPdf);
  const account = queryOne<{ email?: string }>(db, `SELECT email FROM users WHERE id = ?`, [userId]);
  const replyTo = inv.business.email || account?.email || null;
  const { to, subject, message } = parsed.value;
  const link = (req.body ?? {}).includeLink === true ? inv.shareUrl : null;
  const text = link ? `${message}\n\nView the invoice online: ${link}` : message;
  const idempotencyKey = crypto
    .createHash('sha256')
    .update(JSON.stringify([userId, inv.id, kind, to, subject, message, Math.floor(now / 60_000)]))
    .digest('hex');

  const result = await sendEmail({
    fromName: inv.business.businessName,
    replyTo,
    to,
    subject,
    text,
    html: messageHtml(message, link),
    attachment: { filename: pdfFilename(forPdf), content: pdf },
    idempotencyKey,
  });
  logSend(db, userId, inv.id, {
    kind,
    recipients: to,
    subject,
    status: result.ok ? 'sent' : 'failed',
    providerId: result.ok ? result.id : null,
    error: result.ok ? null : result.error,
  });
  if (!result.ok) {
    res.status(502).json({ error: result.error });
    return;
  }
  const after = kind === 'invoice' ? markSent(db, userId, inv.id, today, base) : null;
  res.json(after && after.ok ? after.value : getInvoice(db, userId, inv.id, today, base));
});

export default router;
