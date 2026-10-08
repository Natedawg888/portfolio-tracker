/**
 * Read-only invoice share links (KAN-71). No sign-in: the unguessable token is the key.
 *   GET /api/public/invoices/:token       the invoice as printed (no ids, payments or other data)
 *   GET /api/public/invoices/:token/pdf   the same invoice as a PDF
 * A revoked or unknown token is a plain 404. Requests are rate-limited per client address.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { getDb } from '../db/index.ts';
import { aucklandToday } from '../debts/model.ts';
import { getInvoice, resolveShareToken, toPublicInvoice } from '../invoices/store.ts';
import { pdfFilename, renderInvoicePdf } from '../invoices/pdf.ts';

const router = Router();

const WINDOW_MS = 15 * 60 * 1000;
export const PUBLIC_INVOICE_LIMIT = 120;
const hits = new Map<string, number[]>();

function limit(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= PUBLIC_INVOICE_LIMIT) {
    res.status(429).json({ error: 'Too many requests. Try again shortly.' });
    return;
  }
  recent.push(now);
  hits.set(key, recent);
  next();
}

/** Tests only. */
export function resetPublicInvoiceLimitForTest(): void {
  hits.clear();
}

router.use(limit);
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

async function load(token: string) {
  const db = await getDb();
  const found = resolveShareToken(db, token);
  if (!found) return null;
  const inv = getInvoice(db, found.userId, found.invoiceId, aucklandToday());
  return inv ? toPublicInvoice(inv) : null;
}

router.get('/invoices/:token', async (req, res) => {
  const inv = await load(req.params.token);
  if (!inv) {
    res.status(404).json({ error: 'This invoice link is not valid or has been turned off.' });
    return;
  }
  res.json(inv);
});

router.get('/invoices/:token/pdf', async (req, res) => {
  const inv = await load(req.params.token);
  if (!inv) {
    res.status(404).json({ error: 'This invoice link is not valid or has been turned off.' });
    return;
  }
  const bytes = await renderInvoicePdf(inv);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename(inv)}"`);
  res.send(Buffer.from(bytes));
});

export default router;
